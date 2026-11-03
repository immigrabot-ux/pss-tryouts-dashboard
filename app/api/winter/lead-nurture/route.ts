import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { sendWinterLeadNurture, type LeadNurtureKind } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 60;

/**
 * Hourly (vercel.json): follow-up emails for Winter leads (Meta lead form, website) who
 * have NOT registered yet.
 *   day2      48 hours after they asked
 *   day5      5 days after they asked
 *   lastcall  Nov 13 (early bird ends Nov 14), once
 * Only leads from Oct 31 on (older leads already got the Winter launch email).
 * Stops as soon as they register (matched by email or phone), unsubscribe, or are marked
 * "not interested" / dead. 9 AM – 8 PM Eastern. Kill switch: WINTER_LEAD_NURTURE_OFF=1.
 */
const H = 3600 * 1000;
const START = "2026-10-31T00:00:00Z";

function easternNow() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) % 24 };
}
const digits = (s: unknown) => String(s ?? "").replace(/\D/g, "").slice(-10);

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  const cronSecret = process.env.CRON_SECRET;
  const isCron = !!cronSecret && auth === `Bearer ${cronSecret}`;
  const isVercelCron = req.headers.get("x-vercel-cron") === "1" || (req.headers.get("user-agent") || "").startsWith("vercel-cron");
  if (!isCron && !isVercelCron) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (process.env.WINTER_LEAD_NURTURE_OFF === "1") return NextResponse.json({ ok: true, skipped: "off" });

  const et = easternNow();
  if (et.hour < 9 || et.hour >= 20) return NextResponse.json({ ok: true, skipped: "outside 9am-8pm ET", et });

  const db = getSupabaseAdmin();
  const [{ data: leads, error }, { data: regs }, { data: unsubs }] = await Promise.all([
    db.from("leads")
      .select("id, created_at, parent_name, parent_email, parent_phone, status, hidden, contact_outcome, winter_nurture_step, winter_nurture_last_at, winter_lastcall_at")
      .gte("created_at", START)
      .not("parent_email", "is", null)
      .limit(500),
    db.from("winter_2026_registrations").select("guardian1_email, guardian1_cell_phone"),
    db.from("email_unsubscribes").select("email"),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const regEmails = new Set((regs ?? []).map((r) => (r.guardian1_email || "").trim().toLowerCase()).filter(Boolean));
  const regPhones = new Set((regs ?? []).map((r) => digits(r.guardian1_cell_phone)).filter((p) => p.length === 10));
  const unsub = new Set((unsubs ?? []).map((u) => (u.email || "").trim().toLowerCase()));

  const now = Date.now();
  let sent = 0;
  const failed: string[] = [];
  const skipped: Record<string, number> = {};
  const seenEmail = new Set<string>();
  const skip = (k: string) => (skipped[k] = (skipped[k] ?? 0) + 1);

  for (const l of leads ?? []) {
    if (sent >= 40) break;
    const email = (l.parent_email || "").trim().toLowerCase();
    if (!email || !email.includes("@")) { skip("no email"); continue; }
    if (l.hidden || l.status === "dead" || l.contact_outcome === "not_interested") { skip("closed"); continue; }
    if (regEmails.has(email) || regPhones.has(digits(l.parent_phone))) { skip("registered"); continue; }
    if (unsub.has(email)) { skip("unsubscribed"); continue; }
    if (seenEmail.has(email)) { skip("duplicate"); continue; }
    if (l.winter_nurture_last_at && now - Date.parse(l.winter_nurture_last_at) < 20 * H) { skip("too soon"); continue; }

    const age = now - Date.parse(l.created_at);
    const step = l.winter_nurture_step ?? 0;
    let kind: LeadNurtureKind | null = null;
    if (et.date === "2026-11-13" && !l.winter_lastcall_at && age >= 12 * H) kind = "lastcall";
    else if (step === 0 && age >= 48 * H) kind = "day2";
    else if (step === 1 && age >= 120 * H) kind = "day5";
    if (!kind) { skip("not due"); continue; }

    seenEmail.add(email);
    const r = await sendWinterLeadNurture({ leadId: l.id, to: email, parentName: l.parent_name, kind });
    if (!r.ok) { failed.push(`${l.id}: ${r.error}`); continue; }
    sent++;
    const upd: Record<string, unknown> = { winter_nurture_last_at: new Date().toISOString() };
    if (kind === "lastcall") upd.winter_lastcall_at = new Date().toISOString();
    else upd.winter_nurture_step = step + 1;
    await db.from("leads").update(upd).eq("id", l.id);
    await db.from("lead_activities").insert({ lead_id: l.id, channel: "email", kind: `winter_nurture_${kind}`, detail: `Winter follow-up email (${kind}) to ${email}` }).then(() => null, () => null);
  }

  return NextResponse.json({ ok: true, checked: leads?.length ?? 0, sent, skipped, failed, et });
}
