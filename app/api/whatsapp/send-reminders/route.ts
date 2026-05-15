import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { sendWhatsAppTemplate } from "@/lib/whatsapp";
import { logActivity } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/whatsapp/send-reminders
 * Triggered daily by Vercel cron at 14:00 UTC.
 *
 * Buckets leads into T-3, T-1, and same-day, then sends the matching template
 * to any lead with whatsapp_confirmed = true.
 *
 * Templates expected in Meta Business Manager:
 *   - pss_reminder_3day   ({{1}}=parent, {{2}}=player, {{3}}=location)
 *   - pss_reminder_1day   ({{1}}=parent, {{2}}=player, {{3}}=time, {{4}}=location)
 *   - pss_reminder_today  ({{1}}=parent, {{2}}=player, {{3}}=time, {{4}}=location)
 */
export async function GET(req: NextRequest) {
  // Vercel cron sends an Authorization: Bearer <CRON_SECRET> header if configured.
  // We also accept a manual run for debugging via ?password=ADMIN_PASSWORD.
  const auth = req.headers.get("authorization") || "";
  const cronSecret = process.env.CRON_SECRET;
  const manual = req.nextUrl.searchParams.get("password");

  const isCron =
    cronSecret && auth === `Bearer ${cronSecret}`;
  const isAdmin =
    !!process.env.ADMIN_PASSWORD && manual === process.env.ADMIN_PASSWORD;

  // If no CRON_SECRET is set, allow Vercel's default cron header (best-effort).
  // In production you should configure CRON_SECRET.
  const isVercelCron = req.headers.get("x-vercel-cron") === "1";

  if (!isCron && !isAdmin && !isVercelCron) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  const location = process.env.TRYOUT_LOCATION || "Bliss Fields, Rehoboth MA";
  const time = process.env.TRYOUT_TIME || "09:00";

  const today = todayISO();
  const t1 = addDays(today, 1);
  const t3 = addDays(today, 3);

  const buckets: { date: string; template: string; params: (l: any) => string[] }[] = [
    {
      date: t3,
      template: "pss_reminder_3day",
      params: (l) => [l.parent_name, l.player_name, location],
    },
    {
      date: t1,
      template: "pss_reminder_1day",
      params: (l) => [l.parent_name, l.player_name, time, location],
    },
    {
      date: today,
      template: "pss_reminder_today",
      params: (l) => [l.parent_name, l.player_name, time, location],
    },
  ];

  const results: Array<{
    bucket: string;
    template: string;
    leadId: string;
    ok: boolean;
    error?: string;
  }> = [];

  for (const bucket of buckets) {
    const { data: leads, error } = await supabase
      .from("leads")
      .select("*")
      .eq("tryout_date", bucket.date)
      .eq("whatsapp_confirmed", true);

    if (error) {
      console.error(
        `[reminders] query failed for ${bucket.date}:`,
        error.message
      );
      continue;
    }

    for (const lead of leads || []) {
      const r = await sendWhatsAppTemplate(
        lead.parent_phone,
        bucket.template,
        bucket.params(lead)
      );
      await logActivity(
        lead.id,
        "whatsapp",
        bucket.template,
        r.error || null,
        r.ok
      );
      results.push({
        bucket: bucket.date,
        template: bucket.template,
        leadId: lead.id,
        ok: r.ok,
        error: r.error,
      });
    }
  }

  const summary = {
    ran_at: new Date().toISOString(),
    today,
    sent: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  };
  console.log("[reminders] summary:", JSON.stringify(summary));
  return NextResponse.json(summary);
}

function todayISO(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map((x) => parseInt(x, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}
