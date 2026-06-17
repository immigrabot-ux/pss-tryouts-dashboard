import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { sendWhatsAppTemplate, WELCOME_TEMPLATE_NAME } from "@/lib/whatsapp";
import { logActivity } from "@/lib/activity";
import { isAdminPassword, unauthorized } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/whatsapp/resend-welcome-unconfirmed
 *
 * Smart nudge — re-fires the welcome WhatsApp to opted-in leads that haven't
 * replied YET, but skips anyone we've recently messaged. Designed to be
 * clicked daily without spamming the same people.
 *
 * Eligibility rules (ALL must be true):
 *   1. whatsapp_opt_in = true
 *   2. whatsapp_confirmed = false       (still no reply)
 *   3. NOT hidden                        (admin hasn't dismissed)
 *   4. welcome_whatsapp_sent_at < (now − cooldown)  (waited since original)
 *   5. last_nudged_at IS NULL OR last_nudged_at < (now − cooldown)
 *   6. nudge_count IS NULL OR < max_nudges                (cap reached)
 *
 * Query params:
 *   password    admin password (required)
 *   dry_run=1   preview only, no sends
 *   cooldown    hours between contacts (default 48)
 *   max_nudges  total nudges per lead before we give up (default 3)
 */
export async function GET(req: NextRequest) {
  const password = req.nextUrl.searchParams.get("password");
  if (!isAdminPassword(password)) return unauthorized();

  const dryRun = req.nextUrl.searchParams.get("dry_run") === "1";
  const cooldownHours = clamp(
    parseInt(req.nextUrl.searchParams.get("cooldown") || "48", 10) || 48,
    1,
    24 * 30
  );
  const maxNudges = clamp(
    parseInt(req.nextUrl.searchParams.get("max_nudges") || "3", 10) || 3,
    1,
    10
  );

  const supabase = getSupabaseAdmin();

  // Pull everyone who is opt-in + unconfirmed + not hidden.
  // We filter on time/cooldown in JS because the Supabase JS client's
  // OR-with-IS-NULL composition is finicky.
  const { data: leads, error } = await supabase
    .from("leads")
    .select("*")
    .eq("whatsapp_opt_in", true)
    .eq("whatsapp_confirmed", false)
    .or("hidden.is.null,hidden.eq.false");

  if (error) {
    return NextResponse.json(
      { error: "db_read_failed", detail: error.message },
      { status: 500 }
    );
  }

  const now = Date.now();
  const cooldownMs = cooldownHours * 60 * 60 * 1000;

  // Split into eligible vs skipped, with the reason for skipping so the
  // dry-run preview can show what's happening.
  type Reason =
    | "cap_reached"
    | "in_cooldown_after_nudge"
    | "in_cooldown_after_welcome"
    | "no_welcome_yet"
    | "ok";

  function classify(l: any): Reason {
    const count = l.nudge_count || 0;
    if (count >= maxNudges) return "cap_reached";

    const lastNudgeMs = l.last_nudged_at ? new Date(l.last_nudged_at).getTime() : 0;
    if (lastNudgeMs && now - lastNudgeMs < cooldownMs)
      return "in_cooldown_after_nudge";

    const welcomeMs = l.welcome_whatsapp_sent_at
      ? new Date(l.welcome_whatsapp_sent_at).getTime()
      : 0;
    if (!welcomeMs) return "no_welcome_yet";
    if (now - welcomeMs < cooldownMs) return "in_cooldown_after_welcome";

    return "ok";
  }

  const classified = (leads || []).map((l: any) => ({
    lead: l,
    reason: classify(l),
  }));

  const eligible = classified.filter((c) => c.reason === "ok").map((c) => c.lead);
  const skipped = classified.filter((c) => c.reason !== "ok");

  const skipBreakdown = skipped.reduce((acc, s) => {
    acc[s.reason] = (acc[s.reason] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  if (dryRun) {
    return NextResponse.json({
      dry_run: true,
      cooldown_hours: cooldownHours,
      max_nudges: maxNudges,
      total_unconfirmed: classified.length,
      eligible_count: eligible.length,
      skipped_count: skipped.length,
      skipped_breakdown: skipBreakdown,
      eligible: eligible.map((l: any) => ({
        id: l.id,
        name: l.parent_name,
        phone: l.parent_phone,
        nudge_count: l.nudge_count || 0,
        welcome_sent_at: l.welcome_whatsapp_sent_at,
        last_nudged_at: l.last_nudged_at,
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
      WELCOME_TEMPLATE_NAME,
      [lead.parent_name, lead.player_name]
    );

    await logActivity(
      lead.id,
      "whatsapp",
      "welcome_resend",
      r.ok ? null : r.error || "unknown error",
      r.ok
    );

    if (r.ok) {
      await supabase
        .from("leads")
        .update({
          last_nudged_at: new Date().toISOString(),
          nudge_count: (lead.nudge_count || 0) + 1,
          whatsapp_send_status: "sent",
          whatsapp_send_error: null,
          welcome_whatsapp_sent_at: new Date().toISOString(),
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
    `[resend-welcome] cooldown=${cooldownHours}h cap=${maxNudges} eligible=${eligible.length} sent=${sent} failed=${failed} skipped=${skipped.length}`
  );

  return NextResponse.json({
    cooldown_hours: cooldownHours,
    max_nudges: maxNudges,
    total_unconfirmed: classified.length,
    eligible_count: eligible.length,
    skipped_count: skipped.length,
    skipped_breakdown: skipBreakdown,
    sent,
    failed,
    results,
  });
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
