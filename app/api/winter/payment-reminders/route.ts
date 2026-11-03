import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { sendWinterPaymentReminder, type PaymentReminderKind } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 60;

/**
 * Hourly (vercel.json): reminds Winter families whose invoice is still unpaid.
 *  - "day1"     24 hours after sign-up
 *  - "day3"     72 hours after sign-up
 *  - "lastcall" on Nov 13 (early bird ends Nov 14), once
 * Only 9 AM – 8 PM Eastern. Stops the moment the invoice is paid or voided.
 * Kill switch: WINTER_REMINDERS_OFF=1.
 */
const H = 3600 * 1000;

function easternNow() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) % 24 };
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  const cronSecret = process.env.CRON_SECRET;
  const isCron = !!cronSecret && auth === `Bearer ${cronSecret}`;
  const isVercelCron = req.headers.get("x-vercel-cron") === "1" || (req.headers.get("user-agent") || "").startsWith("vercel-cron");
  if (!isCron && !isVercelCron) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (process.env.WINTER_REMINDERS_OFF === "1") return NextResponse.json({ ok: true, skipped: "off" });

  const et = easternNow();
  if (et.hour < 9 || et.hour >= 20) return NextResponse.json({ ok: true, skipped: "outside 9am-8pm ET", et });

  const db = getSupabaseAdmin();
  const { data: invs, error } = await db
    .from("registration_invoices")
    .select("id, created_at, registration_id, player_name, guardian_email, amount, balance, pay_url, status, reminders_sent, eb_reminder_at, last_reminder_at")
    .eq("registration_table", "winter_2026_registrations")
    .in("status", ["open", "partial"])
    .not("pay_url", "is", null)
    .limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Group invoice lines into one reminder per family invoice email (siblings may share).
  const now = Date.now();
  let sent = 0;
  const failed: string[] = [];
  const done = new Set<string>();

  for (const inv of invs ?? []) {
    const { data: reg } = await db
      .from("winter_2026_registrations")
      .select("guardian1_first_name, guardian1_email, payment_status, waitlisted, duplicate_of")
      .eq("id", inv.registration_id)
      .maybeSingle();
    if (!reg || reg.payment_status === "paid" || reg.waitlisted || reg.duplicate_of) continue;

    const age = now - Date.parse(inv.created_at);
    // Never two reminders within 20 hours of each other.
    if (inv.last_reminder_at && now - Date.parse(inv.last_reminder_at) < 20 * H) continue;
    let kind: PaymentReminderKind | null = null;
    if (et.date === "2026-11-13" && !inv.eb_reminder_at && age >= 12 * H) kind = "lastcall";
    else if ((inv.reminders_sent ?? 0) === 0 && age >= 24 * H) kind = "day1";
    else if ((inv.reminders_sent ?? 0) === 1 && age >= 72 * H) kind = "day3";
    if (!kind) continue;

    const to = (inv.guardian_email || reg.guardian1_email || "").trim();
    const key = `${to.toLowerCase()}|${inv.pay_url}|${kind}`;
    if (!to || done.has(key)) {
      if (done.has(key)) await markSent(db, inv, kind);
      continue;
    }
    const r = await sendWinterPaymentReminder({
      to,
      parentFirst: reg.guardian1_first_name,
      players: inv.player_name || "",
      amount: Number(inv.balance ?? inv.amount ?? 0) || Number(inv.amount ?? 0),
      payUrl: inv.pay_url,
      kind,
    });
    if (r.ok) {
      sent++;
      done.add(key);
      await markSent(db, inv, kind);
    } else failed.push(`${inv.id}: ${r.error}`);
  }
  return NextResponse.json({ ok: true, checked: invs?.length ?? 0, sent, failed, et });
}

async function markSent(db: ReturnType<typeof getSupabaseAdmin>, inv: any, kind: PaymentReminderKind) {
  const nowIso = new Date().toISOString();
  const upd: Record<string, unknown> = { last_reminder_at: nowIso };
  if (kind === "lastcall") upd.eb_reminder_at = nowIso;
  else upd.reminders_sent = (inv.reminders_sent ?? 0) + 1;
  await db.from("registration_invoices").update(upd).eq("id", inv.id);
}
