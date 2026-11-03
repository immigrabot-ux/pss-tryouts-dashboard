import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store"; // never reuse old Meta responses

const G = "https://graph.facebook.com/v18.0";

/**
 * GET /api/meta/test-lead?password=ADMIN_PASSWORD&form=FORM_ID
 * Optional: &name=...&email=...&phone=...  (fills the test lead, if the form has those fields)
 *
 * Creates a Meta *test* lead on a lead form (replacing the form's previous test lead),
 * so we can confirm the poller picks it up end to end. Admin only.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const pw = process.env.ADMIN_PASSWORD?.trim();
  if (!pw || q.get("password") !== pw) return NextResponse.json({ ok: false, error: "Not authorized" }, { status: 401 });

  const formId = q.get("form") || "1099008258775050";
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) return NextResponse.json({ ok: false, error: "META_ACCESS_TOKEN not set" }, { status: 500 });

  // Find the page that owns the form, then use its Page token.
  const f = await (await fetch(`${G}/${formId}?fields=name,page&access_token=${encodeURIComponent(token)}`, { cache: "no-store" })).json();
  let pageToken = token;
  if (f?.page?.id) {
    const p = await (await fetch(`${G}/${f.page.id}?fields=access_token&access_token=${encodeURIComponent(token)}`, { cache: "no-store" })).json();
    if (p?.access_token) pageToken = p.access_token;
  }

  // Diagnostic mode: report what Meta returns for this form with each token, change nothing.
  if (q.get("check") === "1") {
    const probe = async (label: string, tok: string, path: string) => {
      const r = await fetch(`${G}/${formId}/${path}?fields=id,created_time&limit=5&access_token=${encodeURIComponent(tok)}`, { cache: "no-store" });
      const j = await r.json();
      return { label, path, status: r.status, count: j?.data?.length ?? null, sample: (j?.data || []).slice(0, 2), error: j?.error ? { message: j.error.message, code: j.error.code, subcode: j.error.error_subcode } : null };
    };
    const me = await (await fetch(`${G}/me?fields=id,name&access_token=${encodeURIComponent(token)}`, { cache: "no-store" })).json();
    const perms = await (await fetch(`${G}/me/permissions?access_token=${encodeURIComponent(token)}`, { cache: "no-store" })).json();
    const formInfo = await (await fetch(`${G}/${formId}?fields=name,status,page,leads_count,created_time&access_token=${encodeURIComponent(pageToken)}`, { cache: "no-store" })).json();
    return NextResponse.json({
      form: formInfo,
      tokenOwner: me?.name ? { name: me.name, id: me.id } : me?.error?.message,
      granted: (perms?.data || []).filter((x: any) => x.status === "granted").map((x: any) => x.permission),
      pageTokenDiffers: pageToken !== token,
      probes: [
        await probe("page token", pageToken, "leads"),
        await probe("configured token", token, "leads"),
        await probe("page token", pageToken, "test_leads"),
      ],
    });
  }

  // Meta allows one test lead per form: delete the old one first.
  const existing = await (await fetch(`${G}/${formId}/test_leads?access_token=${encodeURIComponent(pageToken)}`, { cache: "no-store" })).json();
  const deleted: string[] = [];
  for (const l of existing?.data || []) {
    const d = await fetch(`${G}/${l.id}?access_token=${encodeURIComponent(pageToken)}`, { method: "DELETE", cache: "no-store" });
    if (d.ok) deleted.push(l.id);
  }

  const fieldData: { name: string; values: string[] }[] = [];
  if (q.get("name")) fieldData.push({ name: "full_name", values: [q.get("name")!] });
  if (q.get("email")) fieldData.push({ name: "email", values: [q.get("email")!] });
  if (q.get("phone")) fieldData.push({ name: "phone_number", values: [q.get("phone")!] });

  const create = async (withFields: boolean) => {
    const body = new URLSearchParams({ access_token: pageToken });
    if (withFields && fieldData.length) body.set("field_data", JSON.stringify(fieldData));
    const r = await fetch(`${G}/${formId}/test_leads`, { method: "POST", cache: "no-store", body });
    return { ok: r.ok, data: await r.json() };
  };
  let made = await create(true);
  if (!made.ok && fieldData.length) made = await create(false); // form may not have those fields

  return NextResponse.json({
    ok: made.ok,
    form: { id: formId, name: f?.name ?? null },
    deletedOldTestLeads: deleted,
    result: made.data,
    next: made.ok ? "Wait ~1 minute, then check /api/meta/poll-leads for newLeads: 1" : undefined,
  });
}
