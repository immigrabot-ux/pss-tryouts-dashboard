import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { sendWinterWelcome, sendWinterWhatsAppInvite, type WinterReg } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 60;

/**
 * Every 15 minutes (vercel.json): families who paid for Winter get the "You're in!" email once.
 * Skips waitlisted and duplicate sign-ups. Safe to run any time.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  const cronSecret = process.env.CRON_SECRET;
  const isCron = !!cronSecret && auth === `Bearer ${cronSecret}`;
  const isVercelCron = req.headers.get("x-vercel-cron") === "1" || (req.headers.get("user-agent") || "").startsWith("vercel-cron");
  if (!isCron && !isVercelCron) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("winter_2026_registrations")
    .select("id, guardian1_first_name, guardian1_email, player_first_name, player_last_name")
    .eq("payment_status", "paid")
    .eq("waitlisted", false)
    .is("duplicate_of", null)
    .is("welcome_sent_at", null)
    .limit(25);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let sent = 0;
  const failed: string[] = [];
  for (const reg of (data ?? []) as WinterReg[]) {
    const r = await sendWinterWelcome(reg);
    if (r.ok) {
      sent++;
      // The welcome email now carries the WhatsApp join button, so this family has its invite too.
      await db.from("winter_2026_registrations").update({ welcome_sent_at: new Date().toISOString(), whatsapp_invite_sent_at: new Date().toISOString() }).eq("id", reg.id);
    } else failed.push(`${reg.id}: ${r.error}`);
  }
  // Families welcomed before the WhatsApp button existed get one short invite email (once per email address).
  let invited = 0;
  if (process.env.WINTER_WA_INVITE_OFF !== "1") {
    const { data: older } = await db
      .from("winter_2026_registrations")
      .select("id, guardian1_first_name, guardian1_email, player_first_name, player_last_name")
      .eq("payment_status", "paid")
      .not("welcome_sent_at", "is", null)
      .is("whatsapp_invite_sent_at", null)
      .limit(50);
    const seen = new Set<string>();
    for (const reg of (older ?? []) as WinterReg[]) {
      const key = (reg.guardian1_email || "").toLowerCase();
      let ok = seen.has(key);
      if (!ok) {
        const r = await sendWinterWhatsAppInvite(reg);
        ok = r.ok;
        if (ok) { invited++; seen.add(key); } else failed.push(`invite ${reg.id}: ${r.error}`);
      }
      if (ok) await db.from("winter_2026_registrations").update({ whatsapp_invite_sent_at: new Date().toISOString() }).eq("id", reg.id);
    }
  }
  return NextResponse.json({ ok: true, checked: data?.length ?? 0, sent, invited, failed });
}
