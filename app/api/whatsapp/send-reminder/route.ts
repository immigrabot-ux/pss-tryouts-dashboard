import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { sendWhatsAppTemplate, REMINDER_TEMPLATE_NAME } from "@/lib/whatsapp";
import { logActivity } from "@/lib/activity";
import { isAdminPassword, unauthorized } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/whatsapp/send-reminder
 *
 * Sends reminder WhatsApp (pss_reminder template) to unconfirmed leads.
 *
 * Eligibility rules (ALL must be true):
 *   1. whatsapp_confirmed = false
 *   2. welcome_whatsapp_sent_at IS NOT NULL
 *   3. status != 'dead'
 *   4. last_reminder_sent_at IS NULL OR > 24 hours ago (24-hour guard)
 *
 * Query params:
 *   password    admin password (required)
 *   dry_run=1   preview only, no sends
 */
export async function GET(req: NextRequest) {
  const password = req.nextUrl.searchParams.get("password");
  if (!isAdminPassword(password)) return unauthorized();

  const dryRun = req.nextUrl.searchParams.get("dry_run") === "1";

  const supabase = getSupabaseAdmin();

  // Query all unconfirmed leads that have received welcome message and aren't dead
  const { data: leads, error } = await supabase
    .from("leads")
    .select("*")
    .eq("whatsapp_confirmed", false)
    .not("welcome_whatsapp_sent_at", "is", null)
    .neq("status", "dead");

  if (error) {
    return NextResponse.json(
      { error: "db_read_failed", detail: error.message },
      { status: 500 }
    );
  }

  const now = Date.now();
  const GUARD_HOURS = 24;
  const guardMs = GUARD_HOURS * 60 * 60 * 1000;

  // Filter out leads that have been reminded in the last 24 hours
  const eligible = (leads || []).filter((l: any) => {
    if (!l.last_reminder_sent_at) return true;
    const lastReminderMs = new Date(l.last_reminder_sent_at).getTime();
    return now - lastReminderMs >= guardMs;
  });

  const skipped = (leads || []).filter((l: any) => {
    if (!l.last_reminder_sent_at) return false;
    const lastReminderMs = new Date(l.last_reminder_sent_at).getTime();
    return now - lastReminderMs < guardMs;
  });

  if (dryRun) {
    return NextResponse.json({
      dry_run: true,
      guard_hours: GUARD_HOURS,
      total_unconfirmed: (leads || []).length,
      eligible_count: eligible.length,
      skipped_count: skipped.length,
      eligible: eligible.slice(0, 10).map((l: any) => ({
        id: l.id,
        name: l.parent_name,
        phone: l.parent_phone,
        welcome_sent_at: l.welcome_whatsapp_sent_at,
        last_reminder_sent_at: l.last_reminder_sent_at,
      })),
    });
  }

  // Real send
  const results: Array<{
    leadId: string;
    name: string;
    ok: boolean;
    error?: string;
  }> = [];

  for (const lead of eligible) {
    const r = await sendWhatsAppTemplate(
      lead.parent_phone,
      REMINDER_TEMPLATE_NAME,
      [lead.parent_name, lead.player_name]
    );

    await logActivity(
      lead.id,
      "whatsapp",
      "reminder_send",
      r.ok ? null : r.error || "unknown error",
      r.ok
    );

    if (r.ok) {
      await supabase
        .from("leads")
        .update({
          last_reminder_sent_at: new Date().toISOString(),
          whatsapp_send_status: "sent",
          whatsapp_send_error: null,
        })
        .eq("id", lead.id);
    }

    results.push({
      leadId: lead.id,
      name: lead.parent_name,
      ok: r.ok,
      error: r.error,
    });
  }

  const sent = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;

  console.log(
    `[send-reminder] guard=${GUARD_HOURS}h eligible=${eligible.length} sent=${sent} failed=${failed} skipped=${skipped.length}`
  );

  return NextResponse.json({
    guard_hours: GUARD_HOURS,
    total_unconfirmed: (leads || []).length,
    eligible_count: eligible.length,
    skipped_count: skipped.length,
    sent,
    failed,
    results,
    timestamp: new Date().toISOString(),
  });
}
