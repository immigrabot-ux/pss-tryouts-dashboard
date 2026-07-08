import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { isAdminPassword, unauthorized } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/nurture/stats
 * Get statistics about the nurture system
 */
export async function GET(req: NextRequest) {
  const password = req.headers.get("x-admin-password");
  if (!isAdminPassword(password)) return unauthorized();

  const supabase = getSupabaseAdmin();

  // Get counts by nurture stage
  const { data: leads, error: leadsError } = await supabase
    .from("leads")
    .select("nurture_stage");

  if (leadsError) {
    return NextResponse.json(
      { error: "stats_read_failed", detail: leadsError.message },
      { status: 500 }
    );
  }

  // Count by stage
  const stageCounts: Record<string, number> = {
    new: 0,
    welcomed: 0,
    nudged: 0,
    urgency_low: 0,
    urgency_high: 0,
    converted: 0,
    stopped: 0,
  };

  for (const lead of leads || []) {
    const stage = lead.nurture_stage || "new";
    if (stage in stageCounts) {
      stageCounts[stage]++;
    }
  }

  // Get today's nurture message count from lead_activities
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { count: todayCount, error: activityError } = await supabase
    .from("lead_activities")
    .select("*", { count: "exact", head: true })
    .eq("channel", "whatsapp")
    .like("kind", "nurture_%")
    .gte("created_at", today.toISOString());

  if (activityError) {
    console.error("[nurture-stats] activity count error:", activityError);
  }

  // Get last cron run time (most recent nurture activity)
  const { data: lastActivity } = await supabase
    .from("lead_activities")
    .select("created_at")
    .eq("channel", "whatsapp")
    .like("kind", "nurture_%")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  let lastCronMinutesAgo: number | null = null;
  if (lastActivity) {
    const lastTime = new Date(lastActivity.created_at).getTime();
    const now = Date.now();
    lastCronMinutesAgo = Math.floor((now - lastTime) / (1000 * 60));
  }

  return NextResponse.json({
    stage_counts: stageCounts,
    messages_sent_today: todayCount || 0,
    last_cron_minutes_ago: lastCronMinutesAgo,
  });
}
