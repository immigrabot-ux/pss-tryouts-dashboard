import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { isAdminPassword, unauthorized } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/analytics/summary?password=...&range=7d|30d
 *
 * Admin-only. Reads from analytics_events and returns aggregated stats:
 *   - unique visitors, page views, sessions
 *   - top pages, top traffic sources, top countries
 *   - daily visitors trend
 *   - event-type breakdown
 */
export async function GET(req: NextRequest) {
  const password =
    req.nextUrl.searchParams.get("password") ||
    req.headers.get("x-admin-password");
  if (!isAdminPassword(password)) return unauthorized();

  const range = req.nextUrl.searchParams.get("range") === "30d" ? "30d" : "7d";
  const days = range === "30d" ? 30 : 7;
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();

  const supabase = getSupabaseAdmin();

  // Pull everything in the range — we aggregate in memory. Fine up to ~50k events;
  // beyond that we'd want a Postgres view or rpc.
  const { data: events, error } = await supabase
    .from("analytics_events")
    .select("*")
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(50000);

  if (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error.message,
        hint:
          error.code === "42P01"
            ? "Run sql/analytics_events.sql in Supabase to create the table."
            : null,
      },
      { status: 500 }
    );
  }

  const all = events || [];

  // ── totals ────────────────────────────────────────────────────────────────
  const uniqueVisitors = new Set(
    all
      .filter((e) => e.visitor_id || e.session_id)
      .map((e) => e.visitor_id || e.session_id)
  ).size;
  const uniqueSessions = new Set(
    all.filter((e) => e.session_id).map((e) => e.session_id)
  ).size;
  const pageViews = all.filter((e) =>
    isPageView(e.event_type)
  ).length;
  const totalEvents = all.length;

  // ── daily ─────────────────────────────────────────────────────────────────
  const dailyMap = new Map<string, { date: string; visitors: Set<string>; views: number }>();
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.now() - (days - 1 - i) * 86_400_000);
    const key = d.toISOString().slice(0, 10);
    dailyMap.set(key, { date: key, visitors: new Set(), views: 0 });
  }
  for (const e of all) {
    const key = (e.created_at as string).slice(0, 10);
    const bucket = dailyMap.get(key);
    if (!bucket) continue;
    if (e.visitor_id) bucket.visitors.add(e.visitor_id);
    else if (e.session_id) bucket.visitors.add(e.session_id);
    if (isPageView(e.event_type)) bucket.views += 1;
  }
  const daily = Array.from(dailyMap.values()).map((b) => ({
    date: b.date,
    visitors: b.visitors.size,
    views: b.views,
  }));

  // ── breakdowns ────────────────────────────────────────────────────────────
  const topPages = countTop(
    all.filter((e) => isPageView(e.event_type)).map((e) => e.page_path),
    8
  );

  const topSources = countTop(
    all.map((e) => {
      const s = (e.utm_source as string) || sourceFromReferrer(e.referrer);
      return s || "(direct)";
    }),
    8
  );

  const topCountries = countTop(
    all.map((e) => e.country).filter(Boolean),
    8
  );

  const eventBreakdown = countTop(
    all.map((e) => e.event_type),
    12
  );

  // ── most recent events (for live feed) ────────────────────────────────────
  const recent = all.slice(0, 20).map((e) => ({
    id: e.id,
    created_at: e.created_at,
    event_type: e.event_type,
    event_name: e.event_name,
    page_path: e.page_path,
    referrer: e.referrer,
    utm_source: e.utm_source,
    country: e.country,
    city: e.city,
  }));

  return NextResponse.json({
    ok: true,
    range,
    totals: {
      uniqueVisitors,
      uniqueSessions,
      pageViews,
      totalEvents,
    },
    daily,
    topPages,
    topSources,
    topCountries,
    eventBreakdown,
    recent,
  });
}

function isPageView(t: string | null | undefined): boolean {
  if (!t) return false;
  const s = String(t).toLowerCase();
  return s === "page_view" || s === "pageview" || s === "page";
}

function countTop(
  values: (string | null | undefined)[],
  limit: number
): { label: string; count: number }[] {
  const map = new Map<string, number>();
  for (const v of values) {
    const k = (v && String(v).trim()) || "(unknown)";
    map.set(k, (map.get(k) || 0) + 1);
  }
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }));
}

function sourceFromReferrer(ref: string | null | undefined): string {
  if (!ref) return "";
  try {
    const u = new URL(ref);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
