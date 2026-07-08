import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { sendWhatsAppTemplate, NURTURE_TEMPLATES } from "@/lib/whatsapp";
import { logActivity } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/whatsapp/nurture-sequence
 *
 * Automated smart nurture sequence with escalating urgency.
 * Runs hourly via Vercel cron.
 *
 * Nurture stages and timing:
 *   welcomed → nudged (24h)         pss_nudge
 *   nudged → urgency_low (48h)      pss_urgency_low
 *   urgency_low → urgency_high (96h) pss_urgency_high
 *
 * Guards:
 *   - Skip if last_nurture_sent_at < 20 hours ago
 *   - Skip if hidden=true or status='dead'
 *   - Skip if whatsapp_confirmed=true (auto-convert)
 *   - Skip if nurture_stage='stopped' or 'converted'
 *   - Rate limit: max 30 sends per run
 *   - Circuit breaker: stop on template error 132000
 *
 * DRY RUN MODE (until templates created in Meta):
 *   Set NURTURE_DRY_RUN=false in env to enable real sends
 */
export async function GET(req: NextRequest) {
  const startTime = Date.now();
  const TIMEOUT_MS = 55000;

  // Auth: Vercel cron header or admin password
  const auth = req.headers.get("authorization") || "";
  const cronSecret = process.env.CRON_SECRET;
  const isVercelCron = req.headers.get("x-vercel-cron") === "1";
  const isCron = cronSecret && auth === `Bearer ${cronSecret}`;

  const manual = req.nextUrl.searchParams.get("password");
  const isAdmin = !!process.env.ADMIN_PASSWORD && manual === process.env.ADMIN_PASSWORD;

  if (!isCron && !isAdmin && !isVercelCron) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();

  // Read configuration from database (not env vars!)
  const { data: config, error: configError } = await supabase
    .from("nurture_config")
    .select("*")
    .eq("id", 1)
    .single();

  if (configError) {
    console.error("[nurture] config read failed:", configError);
    return NextResponse.json(
      { error: "config_read_failed", detail: configError.message },
      { status: 500 }
    );
  }

  // Check master pause flag
  if (config.paused) {
    console.log("[nurture] system paused - skipping run");
    return NextResponse.json({
      paused: true,
      message: "Nurture system is paused",
    });
  }

  const dryRun = config.dry_run;
  const tryoutInfo = config.tryout_info;
  const MAX_SENDS_PER_RUN = config.rate_limit_per_hour;

  const now = Date.now();

  // Timing thresholds (in milliseconds)
  const GUARD_HOURS = 20; // Never send 2 nurture messages within 20 hours
  const guardMs = GUARD_HOURS * 60 * 60 * 1000;

  const STAGE_TIMINGS = {
    welcomed_to_nudged: 24 * 60 * 60 * 1000,        // 24h
    nudged_to_urgency_low: 48 * 60 * 60 * 1000,     // 48h
    urgency_low_to_urgency_high: 96 * 60 * 60 * 1000, // 96h (4 days)
  };

  // Fetch all active leads in the nurture sequence
  const { data: leads, error } = await supabase
    .from("leads")
    .select("*")
    .not("nurture_stage", "in", '("stopped","converted")')
    .or("hidden.is.null,hidden.eq.false")
    .neq("status", "dead");

  if (error) {
    return NextResponse.json(
      { error: "db_read_failed", detail: error.message },
      { status: 500 }
    );
  }

  const results: Array<{
    leadId: string;
    name: string;
    stage: string;
    action: string;
    template?: string;
    ok?: boolean;
    error?: string;
  }> = [];

  let circuitBreakerTripped = false;
  let sendsThisRun = 0;

  for (const lead of leads || []) {
    // Timeout guard
    if (Date.now() - startTime > TIMEOUT_MS) {
      console.warn(`[nurture] timeout guard triggered at ${Date.now() - startTime}ms`);
      break;
    }

    // Rate limit guard
    if (sendsThisRun >= MAX_SENDS_PER_RUN) {
      console.warn(`[nurture] rate limit reached: ${MAX_SENDS_PER_RUN} sends`);
      break;
    }

    // Circuit breaker guard
    if (circuitBreakerTripped) {
      break;
    }

    // Auto-convert if they replied
    if (lead.whatsapp_confirmed) {
      await supabase
        .from("leads")
        .update({
          nurture_stage: "converted",
          nurture_sequence_stopped_reason: "confirmed",
        })
        .eq("id", lead.id);

      results.push({
        leadId: lead.id,
        name: lead.parent_name,
        stage: lead.nurture_stage || "unknown",
        action: "auto_converted",
      });
      continue;
    }

    // Guard: respect 20-hour minimum between nurture sends
    if (lead.last_nurture_sent_at) {
      const lastNurtureMs = new Date(lead.last_nurture_sent_at).getTime();
      if (now - lastNurtureMs < guardMs) {
        results.push({
          leadId: lead.id,
          name: lead.parent_name,
          stage: lead.nurture_stage || "unknown",
          action: "skipped_guard",
        });
        continue;
      }
    }

    // Determine next action based on current stage
    let shouldSend = false;
    let templateName = "";
    let nextStage = "";

    const currentStage = lead.nurture_stage || "new";
    const lastNurtureMs = lead.last_nurture_sent_at
      ? new Date(lead.last_nurture_sent_at).getTime()
      : 0;

    switch (currentStage) {
      case "welcomed":
        if (lastNurtureMs && now - lastNurtureMs >= STAGE_TIMINGS.welcomed_to_nudged) {
          shouldSend = true;
          templateName = NURTURE_TEMPLATES.nudge;
          nextStage = "nudged";
        }
        break;

      case "nudged":
        if (lastNurtureMs && now - lastNurtureMs >= STAGE_TIMINGS.nudged_to_urgency_low) {
          shouldSend = true;
          templateName = NURTURE_TEMPLATES.urgency_low;
          nextStage = "urgency_low";
        }
        break;

      case "urgency_low":
        if (lastNurtureMs && now - lastNurtureMs >= STAGE_TIMINGS.urgency_low_to_urgency_high) {
          shouldSend = true;
          templateName = NURTURE_TEMPLATES.urgency_high;
          nextStage = "urgency_high";
        }
        break;

      case "urgency_high":
        // Terminal stage - no further automatic nurture
        results.push({
          leadId: lead.id,
          name: lead.parent_name,
          stage: currentStage,
          action: "terminal_stage",
        });
        continue;

      default:
        // Stage 'new' or unknown - skip
        results.push({
          leadId: lead.id,
          name: lead.parent_name,
          stage: currentStage,
          action: "skipped_stage",
        });
        continue;
    }

    if (!shouldSend) {
      results.push({
        leadId: lead.id,
        name: lead.parent_name,
        stage: currentStage,
        action: "not_due_yet",
      });
      continue;
    }

    // Send the nurture message (or log in dry-run mode)
    if (dryRun) {
      console.log(
        `[nurture] DRY RUN: would send ${templateName} to ${lead.parent_name} (${lead.parent_phone}) - stage ${currentStage} → ${nextStage}`
      );

      results.push({
        leadId: lead.id,
        name: lead.parent_name,
        stage: currentStage,
        action: "dry_run",
        template: templateName,
        ok: true,
      });

      // In dry-run, still update the database to track progression
      await supabase
        .from("leads")
        .update({
          nurture_stage: nextStage,
          last_nurture_sent_at: new Date().toISOString(),
        })
        .eq("id", lead.id);

      await logActivity(
        lead.id,
        "whatsapp",
        `nurture_${nextStage}_dry_run`,
        `Would send ${templateName}`,
        true
      );

      sendsThisRun++;
      continue;
    }

    // Real send
    const r = await sendWhatsAppTemplate(
      lead.parent_phone,
      templateName,
      [
        lead.parent_name,
        lead.player_name || "your player",
        tryoutInfo,
      ]
    );

    await logActivity(
      lead.id,
      "whatsapp",
      `nurture_${nextStage}`,
      r.ok ? null : r.error || "unknown error",
      r.ok
    );

    // Circuit breaker: error 132000 = template parameter mismatch
    if (!r.ok && r.error?.includes("132000")) {
      console.error(
        `[nurture] CIRCUIT BREAKER: template ${templateName} parameter mismatch (132000). Stopping.`
      );
      circuitBreakerTripped = true;
      results.push({
        leadId: lead.id,
        name: lead.parent_name,
        stage: currentStage,
        action: "circuit_breaker",
        template: templateName,
        ok: false,
        error: r.error,
      });
      break;
    }

    if (r.ok) {
      await supabase
        .from("leads")
        .update({
          nurture_stage: nextStage,
          last_nurture_sent_at: new Date().toISOString(),
          whatsapp_send_status: "sent",
          whatsapp_send_error: null,
        })
        .eq("id", lead.id);

      sendsThisRun++;
    }

    results.push({
      leadId: lead.id,
      name: lead.parent_name,
      stage: currentStage,
      action: r.ok ? "sent" : "failed",
      template: templateName,
      ok: r.ok,
      error: r.error,
    });
  }

  const summary = {
    ran_at: new Date().toISOString(),
    dry_run: dryRun,
    total_leads_checked: (leads || []).length,
    actions: {
      sent: results.filter((r) => r.action === "sent" || r.action === "dry_run").length,
      failed: results.filter((r) => r.action === "failed").length,
      auto_converted: results.filter((r) => r.action === "auto_converted").length,
      skipped: results.filter((r) =>
        ["skipped_guard", "skipped_stage", "not_due_yet", "terminal_stage"].includes(r.action)
      ).length,
    },
    circuit_breaker_tripped: circuitBreakerTripped,
    rate_limit_hit: sendsThisRun >= MAX_SENDS_PER_RUN,
    results,
  };

  console.log("[nurture] summary:", JSON.stringify(summary, null, 2));

  return NextResponse.json(summary);
}
