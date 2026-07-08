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
 * Template parameters (pss_reminder in Meta Business Manager):
 *   {{1}} = parent name
 *   {{2}} = player name
 *   {{3}} = tryout date/location info
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
  const startTime = Date.now();
  const TIMEOUT_MS = 55000; // Bail at 55s to avoid Vercel's 60s hard limit

  const password = req.nextUrl.searchParams.get("password");
  if (!isAdminPassword(password)) return unauthorized();

  const dryRun = req.nextUrl.searchParams.get("dry_run") === "1";

  const supabase = getSupabaseAdmin();

  // Third parameter for pss_reminder template - tryout date/location info
  // Configurable via env var, falls back to generic message
  const tryoutInfo =
    process.env.REMINDER_TRYOUT_INFO ||
    process.env.TRYOUT_DATE ||
    "the upcoming tryout at Bliss Fields";

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

  let circuitBreakerTripped = false;
  let timedOut = false;

  for (const lead of eligible) {
    // Timeout guard: bail at 55s to avoid hitting Vercel's 60s hard limit
    if (Date.now() - startTime > TIMEOUT_MS) {
      console.warn(
        `[send-reminder] timeout guard triggered at ${Date.now() - startTime}ms`
      );
      timedOut = true;
      break;
    }

    // Circuit breaker: if we hit a template parameter mismatch error,
    // stop immediately instead of hammering Meta with more failed calls
    if (circuitBreakerTripped) {
      break;
    }

    const r = await sendWhatsAppTemplate(
      lead.parent_phone,
      REMINDER_TEMPLATE_NAME,
      [
        lead.parent_name,
        lead.player_name || "your player",
        tryoutInfo,
      ]
    );

    await logActivity(
      lead.id,
      "whatsapp",
      "reminder_send",
      r.ok ? null : r.error || "unknown error",
      r.ok
    );

    // Circuit breaker: error 132000 = template parameter mismatch
    // Stop the loop immediately if we hit this error
    if (!r.ok && r.error?.includes("132000")) {
      console.error(
        `[send-reminder] CIRCUIT BREAKER: template parameter mismatch (132000). Stopping send loop.`
      );
      circuitBreakerTripped = true;
      results.push({
        leadId: lead.id,
        name: lead.parent_name,
        ok: false,
        error: r.error + " (circuit breaker tripped - stopping all sends)",
      });
      break;
    }

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
  const processed = results.length;
  const notProcessed = eligible.length - processed;

  console.log(
    `[send-reminder] guard=${GUARD_HOURS}h eligible=${eligible.length} sent=${sent} failed=${failed} skipped=${skipped.length} circuit_breaker=${circuitBreakerTripped} timed_out=${timedOut}`
  );

  return NextResponse.json({
    guard_hours: GUARD_HOURS,
    total_unconfirmed: (leads || []).length,
    eligible_count: eligible.length,
    skipped_count: skipped.length,
    sent,
    failed,
    processed,
    not_processed: notProcessed,
    circuit_breaker_tripped: circuitBreakerTripped,
    timed_out: timedOut,
    results,
    timestamp: new Date().toISOString(),
  });
}
