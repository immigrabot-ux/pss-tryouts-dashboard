import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase";
import { sendWelcomeEmail, sendAdminNotification } from "@/lib/email";
import { sendWhatsAppTemplate, WELCOME_TEMPLATE_NAME } from "@/lib/whatsapp";
import { logActivity } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/meta/lead-webhook
 *
 * Meta's webhook subscription verification handshake.
 * Meta sends ?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");

  const expected = process.env.META_VERIFY_TOKEN;

  if (mode === "subscribe" && token && expected && token === expected) {
    console.log("[meta-leads] webhook verified");
    return new NextResponse(challenge || "ok", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  console.warn("[meta-leads] webhook verification failed", {
    mode,
    tokenProvided: !!token,
    expectedSet: !!expected,
  });
  return new NextResponse("forbidden", { status: 403 });
}

/**
 * POST /api/meta/lead-webhook
 *
 * Meta posts leadgen events here whenever someone submits a Lead Form
 * on a Facebook/Instagram ad. The payload has metadata (leadgen_id, form_id,
 * page_id); we have to call back into Meta's Graph API to get the actual
 * field values.
 *
 * Per Meta's docs, we should ALWAYS return 200 — otherwise they retry the
 * delivery. Even when we fail to process, we log and respond 200.
 */
export async function POST(req: NextRequest) {
  // Read the raw body first so we can verify the signature against the exact bytes.
  const rawBody = await req.text();
  const signature = req.headers.get("x-hub-signature-256");

  if (!verifySignature(rawBody, signature)) {
    console.warn("[meta-leads] invalid signature — rejecting webhook delivery");
    // Even on signature failure, returning 200 stops retries.
    // But it's reasonable to return 401 here so Meta surfaces the misconfig in their dashboard.
    return NextResponse.json({ ok: false, error: "bad_signature" }, { status: 401 });
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch (err) {
    console.error("[meta-leads] payload not JSON:", err);
    return NextResponse.json({ ok: true, note: "invalid_json_ignored" });
  }

  try {
    await handleLeadgenPayload(payload);
  } catch (err) {
    // Log but DO NOT throw — we always 200 so Meta doesn't retry.
    console.error("[meta-leads] handler error:", err);
  }

  return NextResponse.json({ ok: true });
}

// ─── webhook handling ──────────────────────────────────────────────────────

async function handleLeadgenPayload(payload: any) {
  const entries: any[] = payload?.entry || [];
  for (const entry of entries) {
    const changes: any[] = entry.changes || [];
    for (const change of changes) {
      if (change.field !== "leadgen") continue;
      const value = change.value || {};
      const leadgenId = value.leadgen_id;
      const pageId = value.page_id;
      const formId = value.form_id;
      const adId = value.ad_id || null;
      const createdTime = value.created_time || null;

      if (!leadgenId) {
        console.warn("[meta-leads] change missing leadgen_id — skipping");
        continue;
      }

      await processOneLead({
        leadgenId,
        pageId,
        formId,
        adId,
        createdTime,
      });
    }
  }
}

async function processOneLead({
  leadgenId,
  pageId,
  formId,
  adId,
  createdTime,
}: {
  leadgenId: string;
  pageId?: string;
  formId?: string;
  adId?: string | null;
  createdTime?: number | null;
}) {
  const accessToken = process.env.META_ACCESS_TOKEN;
  if (!accessToken) {
    console.error("[meta-leads] META_ACCESS_TOKEN not set — cannot fetch lead details");
    return;
  }

  // Step 1 — fetch full lead details from Meta Graph API
  const detailUrl = `https://graph.facebook.com/v18.0/${encodeURIComponent(
    leadgenId
  )}?access_token=${encodeURIComponent(accessToken)}`;

  let detail: any;
  try {
    const res = await fetch(detailUrl);
    detail = await res.json();
    if (!res.ok) {
      console.error("[meta-leads] graph API error:", detail?.error || res.status);
      return;
    }
  } catch (err) {
    console.error("[meta-leads] graph API fetch failed:", err);
    return;
  }

  // Step 2 — extract field values from Meta's field_data array
  // field_data shape: [{ name: "email", values: ["a@b.com"] }, ...]
  const fieldData: Array<{ name: string; values: string[] }> = detail?.field_data || [];
  const fields = new Map<string, string>();
  for (const f of fieldData) {
    if (!f?.name || !Array.isArray(f.values)) continue;
    const value = (f.values[0] || "").toString().trim();
    fields.set(f.name.toLowerCase(), value);
  }

  // Step 3 — map Meta field names to our lead schema, with sensible aliases
  const parent_name = pick(fields, ["full_name", "name", "first_name_last_name"]);
  const parent_email = pick(fields, ["email", "email_address"]);
  const parent_phone = pick(fields, ["whatsapp_number", "phone_number", "phone"]);
  const player_name = pick(fields, [
    "child_s_full_name",
    "child_full_name",
    "player_name",
    "child_name",
  ]);
  const player_age_raw = pick(fields, [
    "child_s_age",
    "child_age",
    "player_age",
    "age_group",
    "age",
  ]);

  if (!parent_email && !parent_phone) {
    console.warn(`[meta-leads] lead ${leadgenId} has no email or phone — skipping`);
    return;
  }

  // Step 4 — derive numeric age from the age group label if present
  const { player_age, age_group } = parseAge(player_age_raw);

  const supabase = getSupabaseAdmin();

  // Check if we've already processed this leadgen_id (dedupe against polling)
  const { data: existing } = await supabase
    .from("leads")
    .select("id")
    .eq("meta_leadgen_id", leadgenId)
    .maybeSingle();

  if (existing) {
    console.log(
      `[meta-leads] lead ${leadgenId} already exists (id=${existing.id}) — skipping`
    );
    return; // Already processed via polling or previous webhook
  }

  const insertRow: Record<string, unknown> = {
    parent_name: parent_name || "(unknown)",
    player_name: player_name || "(unknown)",
    player_age,
    parent_phone: parent_phone || "",
    parent_email: parent_email || "",
    whatsapp_opt_in: true,                // Lead Ads opt-in is implicit
    whatsapp_confirmed: false,
    status: "new",
    tryout_date: "2026-07-25",            // anchor to Day 1; admin can change later
    tryout_day: "both",                   // default — Meta forms don't usually capture this
  };
  if (age_group) insertRow.age_group = age_group;

  // Attempt to include source + meta_leadgen_id — if column doesn't exist yet, retry without.
  insertRow.source = "meta_lead_ad";
  insertRow.meta_leadgen_id = leadgenId;
  insertRow.notes = buildNotes({ leadgenId, formId, pageId, adId, createdTime });

  let { data, error } = await supabase
    .from("leads")
    .insert(insertRow)
    .select()
    .single();

  if (error && (/source/i.test(error.message) || /meta_leadgen_id/i.test(error.message))) {
    // Schema doesn't have source or meta_leadgen_id columns yet — retry without them.
    delete insertRow.source;
    delete insertRow.meta_leadgen_id;
    const retry = await supabase.from("leads").insert(insertRow).select().single();
    data = retry.data;
    error = retry.error;
  }

  if (error || !data) {
    console.error("[meta-leads] insert failed:", error?.message);
    return;
  }

  console.log(
    `[meta-leads] inserted lead ${data.id} from Meta leadgen_id=${leadgenId}`
  );

  // Step 5 — fire welcome flow (email + admin notif + WhatsApp template).
  const [emailResult, adminResult, waResult] = await Promise.all([
    sendWelcomeEmail(data),
    sendAdminNotification(data),
    data.whatsapp_opt_in
      ? sendWhatsAppTemplate(data.parent_phone, WELCOME_TEMPLATE_NAME, [
          data.parent_name,
          data.player_name,
        ])
      : Promise.resolve({ ok: true } as { ok: boolean; error?: string }),
  ]);

  await Promise.all([
    logActivity(
      data.id,
      "system",
      "meta_lead_ad",
      `leadgen_id=${leadgenId} form_id=${formId || ""} ad_id=${adId || ""}`,
      true
    ),
    logActivity(
      data.id,
      "email",
      "welcome",
      emailResult.ok ? null : emailResult.error || "unknown error",
      emailResult.ok
    ),
    logActivity(
      data.id,
      "email",
      "admin_notification",
      adminResult.ok ? null : adminResult.error || "unknown error",
      adminResult.ok
    ),
    data.whatsapp_opt_in
      ? logActivity(
          data.id,
          "whatsapp",
          "welcome",
          waResult.ok ? null : (waResult as any).error || "unknown error",
          waResult.ok
        )
      : Promise.resolve(),
  ]);

  // Persist the WhatsApp send outcome onto the lead for the dashboard badge.
  if (data.whatsapp_opt_in) {
    await supabase
      .from("leads")
      .update({
        whatsapp_send_status: waResult.ok ? "sent" : "failed",
        whatsapp_send_error: waResult.ok
          ? null
          : (waResult as any).error || "unknown error",
      })
      .eq("id", data.id);
  }
}

// ─── helpers ───────────────────────────────────────────────────────────────

function pick(
  fields: Map<string, string>,
  names: string[]
): string {
  for (const n of names) {
    const v = fields.get(n.toLowerCase());
    if (v) return v;
  }
  return "";
}

function parseAge(raw: string): { player_age: number; age_group: string | null } {
  if (!raw) return { player_age: 0, age_group: null };
  const trimmed = raw.trim();
  // U-group label, e.g. "U10 (9-10 yrs)" / "U-12"
  const u = trimmed.match(/u\s*-?\s*(\d{1,2})/i);
  if (u) return { player_age: parseInt(u[1], 10), age_group: trimmed };
  // First number found
  const n = trimmed.match(/\d{1,2}/);
  if (n) return { player_age: parseInt(n[0], 10), age_group: trimmed };
  return { player_age: 0, age_group: trimmed };
}

function buildNotes({
  leadgenId,
  formId,
  pageId,
  adId,
  createdTime,
}: {
  leadgenId: string;
  formId?: string;
  pageId?: string;
  adId?: string | null;
  createdTime?: number | null;
}): string {
  const lines = [`Source: Meta Lead Ad (leadgen_id=${leadgenId})`];
  if (formId) lines.push(`form_id=${formId}`);
  if (pageId) lines.push(`page_id=${pageId}`);
  if (adId) lines.push(`ad_id=${adId}`);
  if (createdTime)
    lines.push(`submitted=${new Date(createdTime * 1000).toISOString()}`);
  return lines.join(" · ");
}

function verifySignature(rawBody: string, signature: string | null): boolean {
  if (!signature) return false;
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) {
    console.warn("[meta-leads] META_APP_SECRET not set — refusing all webhook posts");
    return false;
  }

  const expected =
    "sha256=" +
    createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");

  try {
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
