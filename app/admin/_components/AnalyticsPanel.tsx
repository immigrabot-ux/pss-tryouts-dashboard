"use client";

import { useEffect, useMemo, useState } from "react";

type Lead = {
  id: string;
  created_at: string;
  whatsapp_opt_in: boolean;
  whatsapp_confirmed: boolean;
  whatsapp_send_status?: string | null;
  status: string;
  tryout_day?: string | null;
};

type AnalyticsSummary = {
  ok: boolean;
  error?: string;
  totals: {
    uniqueVisitors: number;
    uniqueSessions: number;
    pageViews: number;
    totalEvents: number;
  };
  daily: { date: string; visitors: number; views: number }[];
  topPages: { label: string; count: number }[];
  topSources: { label: string; count: number }[];
  topCountries: { label: string; count: number }[];
  eventBreakdown: { label: string; count: number }[];
  recent: Array<{
    id: string;
    created_at: string;
    event_type: string;
    event_name?: string | null;
    page_path?: string | null;
    referrer?: string | null;
    utm_source?: string | null;
    country?: string | null;
    city?: string | null;
  }>;
};

export default function AnalyticsPanel({
  leads,
  password,
}: {
  leads: Lead[];
  password: string;
}) {
  const [range, setRange] = useState<"7d" | "30d">("30d");
  const [web, setWeb] = useState<AnalyticsSummary | null>(null);
  const [webLoading, setWebLoading] = useState(true);

  const stats = useMemo(() => compute(leads, range), [leads, range]);

  useEffect(() => {
    let abort = false;
    setWebLoading(true);
    fetch(`/api/analytics/summary?password=${encodeURIComponent(password)}&range=${range}`)
      .then((r) => r.json())
      .then((d: AnalyticsSummary) => {
        if (!abort) setWeb(d);
      })
      .catch(() => {
        if (!abort)
          setWeb({ ok: false, error: "fetch_failed" } as AnalyticsSummary);
      })
      .finally(() => {
        if (!abort) setWebLoading(false);
      });
    return () => {
      abort = true;
    };
  }, [range, password]);

  // Conversion rate: signups ÷ unique visitors
  const conversionRate =
    web?.ok && web.totals.uniqueVisitors > 0
      ? Math.round((stats.newThisRange / web.totals.uniqueVisitors) * 10000) / 100
      : null;

  return (
    <section className="space-y-6">
      {/* HEADER */}
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-lg font-semibold">Analytics</h2>
          <p className="text-sm text-neutral-500">
            Real-time stats on PSS tryout signups.
          </p>
        </div>
        <div className="inline-flex rounded-lg border border-pss-border bg-pss-panel p-0.5 text-xs">
          {(["7d", "30d"] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-3 py-1.5 rounded-md transition ${
                range === r
                  ? "bg-pss-red text-white"
                  : "text-neutral-400 hover:text-white"
              }`}
            >
              {r === "7d" ? "Last 7 days" : "Last 30 days"}
            </button>
          ))}
        </div>
      </div>

      {/* STAT CARDS */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard
          label="Total signups"
          value={stats.total}
          sub={`${stats.newThisRange} this ${range === "7d" ? "week" : "month"}`}
          icon="👥"
          accent="text-white"
        />
        <StatCard
          label="WA confirmed"
          value={stats.waConfirmed}
          sub={`${stats.waConfirmRate}% reply rate`}
          icon="✓"
          accent="text-emerald-400"
        />
        <StatCard
          label="WA opt-in"
          value={stats.waOptIn}
          sub={`${stats.waOptInRate}% of all`}
          icon="📱"
          accent="text-blue-400"
        />
        <StatCard
          label="Both days"
          value={stats.both}
          sub={pct(stats.both, stats.total)}
          icon="📅"
          accent="text-pss-red"
        />
        <StatCard
          label="Day 1 only"
          value={stats.day1}
          sub={pct(stats.day1, stats.total)}
          icon="1️⃣"
          accent="text-amber-400"
        />
        <StatCard
          label="Day 2 only"
          value={stats.day2}
          sub={pct(stats.day2, stats.total)}
          icon="2️⃣"
          accent="text-cyan-400"
        />
      </div>

      {/* WEB ANALYTICS — VISITORS (events from peacesoccerschool.com) */}
      <WebSection
        data={web}
        loading={webLoading}
        conversionRate={conversionRate}
        range={range}
      />

      {/* CHART + QUICK STATS */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* LEAD ACTIVITY CHART */}
        <div className="lg:col-span-2 bg-pss-panel border border-pss-border rounded-xl p-5">
          <div className="flex items-start justify-between mb-4">
            <div>
              <div className="text-sm font-semibold">Signup activity</div>
              <div className="text-xs text-neutral-500">
                Daily new signups over the {range === "7d" ? "last 7" : "last 30"} days
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="w-2 h-2 rounded-full bg-pss-red" />
              <span className="text-neutral-400">New leads</span>
            </div>
          </div>
          <LineChart data={stats.dailySignups} />
        </div>

        {/* QUICK STATS — horizontal bars */}
        <div className="bg-pss-panel border border-pss-border rounded-xl p-5">
          <div className="text-sm font-semibold">Quick stats</div>
          <div className="text-xs text-neutral-500 mb-4">
            Funnel based on all {stats.total} leads
          </div>
          <div className="space-y-4">
            <Bar
              label="New"
              value={stats.statusNew}
              total={stats.total}
              color="bg-blue-400"
            />
            <Bar
              label="WhatsApp confirmed"
              value={stats.waConfirmed}
              total={stats.total}
              color="bg-emerald-400"
            />
            <Bar
              label="Contacted"
              value={stats.statusContacted}
              total={stats.total}
              color="bg-amber-400"
            />
            <Bar
              label="Attended"
              value={stats.statusAttended}
              total={stats.total}
              color="bg-purple-400"
            />
            <Bar
              label="Registered"
              value={stats.statusRegistered}
              total={stats.total}
              color="bg-pss-red"
            />
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function compute(leads: Lead[], range: "7d" | "30d") {
  const now = new Date();
  const days = range === "7d" ? 7 : 30;
  const cutoffMs = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - (days - 1)
  );

  const total = leads.length;
  const newThisRange = leads.filter(
    (l) => new Date(l.created_at).getTime() >= cutoffMs
  ).length;

  const waOptIn = leads.filter((l) => l.whatsapp_opt_in).length;
  const waConfirmed = leads.filter((l) => l.whatsapp_confirmed).length;
  const waOptInRate = total ? Math.round((waOptIn / total) * 100) : 0;
  const waConfirmRate = waOptIn ? Math.round((waConfirmed / waOptIn) * 100) : 0;

  const day1 = leads.filter((l) => l.tryout_day === "day1").length;
  const day2 = leads.filter((l) => l.tryout_day === "day2").length;
  const both = leads.filter((l) => (l.tryout_day || "both") === "both").length;

  const statusCount = (s: string) =>
    leads.filter((l) => l.status === s).length;

  // Daily signups bucket
  const bucket = new Map<string, number>();
  for (let i = 0; i < days; i++) {
    const d = new Date(cutoffMs + i * 86_400_000);
    const key = d.toISOString().slice(0, 10);
    bucket.set(key, 0);
  }
  for (const l of leads) {
    const key = l.created_at.slice(0, 10);
    if (bucket.has(key)) bucket.set(key, (bucket.get(key) || 0) + 1);
  }
  const dailySignups = Array.from(bucket.entries()).map(([date, count]) => ({
    date,
    count,
  }));

  return {
    total,
    newThisRange,
    waOptIn,
    waOptInRate,
    waConfirmed,
    waConfirmRate,
    day1,
    day2,
    both,
    statusNew: statusCount("new"),
    statusContacted: statusCount("contacted"),
    statusAttended: statusCount("attended"),
    statusRegistered: statusCount("registered"),
    dailySignups,
  };
}

function pct(part: number, whole: number): string {
  if (!whole) return "0%";
  return `${Math.round((part / whole) * 100)}%`;
}

// ─── visual components ──────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  icon,
  accent,
}: {
  label: string;
  value: number;
  sub: string;
  icon: string;
  accent: string;
}) {
  return (
    <div className="bg-pss-panel border border-pss-border rounded-xl p-4 hover:border-neutral-700 transition">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] uppercase tracking-wider text-neutral-500 font-medium">
          {label}
        </div>
        <div className="w-7 h-7 rounded-md bg-black/40 border border-pss-border flex items-center justify-center text-xs">
          {icon}
        </div>
      </div>
      <div className={`text-3xl font-bold ${accent}`}>{value}</div>
      <div className="text-xs text-neutral-500 mt-1">{sub}</div>
    </div>
  );
}

function Bar({
  label,
  value,
  total,
  color,
}: {
  label: string;
  value: number;
  total: number;
  color: string;
}) {
  const ratio = total ? value / total : 0;
  const percent = Math.round(ratio * 100);
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5 text-xs">
        <span className="text-neutral-300">{label}</span>
        <span className="text-neutral-500">
          {value} · <span className="text-neutral-300">{percent}%</span>
        </span>
      </div>
      <div className="h-1.5 w-full bg-black/40 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${color} transition-all duration-500`}
          style={{ width: `${Math.max(2, percent)}%` }}
        />
      </div>
    </div>
  );
}

function LineChart({
  data,
}: {
  data: { date: string; count: number }[];
}) {
  // Layout
  const w = 800;
  const h = 220;
  const pad = { top: 20, right: 16, bottom: 28, left: 30 };
  const innerW = w - pad.left - pad.right;
  const innerH = h - pad.top - pad.bottom;

  const maxY = Math.max(1, ...data.map((d) => d.count));
  const stepX = data.length > 1 ? innerW / (data.length - 1) : innerW;

  const points = data.map((d, i) => ({
    x: pad.left + i * stepX,
    y: pad.top + innerH - (d.count / maxY) * innerH,
    raw: d,
  }));

  // Smooth path via Catmull-Rom-ish curves
  const linePath = points
    .map((p, i) => {
      if (i === 0) return `M ${p.x} ${p.y}`;
      const prev = points[i - 1];
      const cx = (prev.x + p.x) / 2;
      return `Q ${cx} ${prev.y} ${cx} ${(prev.y + p.y) / 2} T ${p.x} ${p.y}`;
    })
    .join(" ");

  const areaPath =
    points.length === 0
      ? ""
      : `${linePath} L ${points[points.length - 1].x} ${pad.top + innerH} L ${
          points[0].x
        } ${pad.top + innerH} Z`;

  // Y-axis ticks (4 lines)
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((r) => ({
    y: pad.top + innerH - r * innerH,
    label: Math.round(maxY * r),
  }));

  // X-axis labels — show every Nth date
  const labelInterval =
    data.length <= 7 ? 1 : data.length <= 14 ? 2 : data.length <= 30 ? 5 : 7;

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="w-full h-auto"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#DC2626" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#DC2626" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Y grid lines */}
        {yTicks.map((t, i) => (
          <g key={i}>
            <line
              x1={pad.left}
              x2={w - pad.right}
              y1={t.y}
              y2={t.y}
              stroke="#1f1f1f"
              strokeDasharray="2 4"
            />
            <text
              x={pad.left - 6}
              y={t.y + 3}
              textAnchor="end"
              fontSize="10"
              fill="#525252"
            >
              {t.label}
            </text>
          </g>
        ))}

        {/* Area fill */}
        {points.length > 0 && (
          <path d={areaPath} fill="url(#areaGrad)" stroke="none" />
        )}

        {/* Line */}
        {points.length > 0 && (
          <path
            d={linePath}
            fill="none"
            stroke="#DC2626"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {/* Data points */}
        {points.map((p, i) => (
          <g key={i}>
            <circle
              cx={p.x}
              cy={p.y}
              r="3"
              fill="#0a0a0a"
              stroke="#DC2626"
              strokeWidth="2"
            />
            <title>
              {p.raw.date}: {p.raw.count} signup{p.raw.count === 1 ? "" : "s"}
            </title>
          </g>
        ))}

        {/* X labels */}
        {points.map((p, i) =>
          i % labelInterval === 0 || i === points.length - 1 ? (
            <text
              key={`xl-${i}`}
              x={p.x}
              y={h - 8}
              textAnchor="middle"
              fontSize="10"
              fill="#525252"
            >
              {shortDate(p.raw.date)}
            </text>
          ) : null
        )}
      </svg>
    </div>
  );
}

function shortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map((n) => parseInt(n, 10));
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

// ─── web analytics section (events from peacesoccerschool.com) ──────────────

function WebSection({
  data,
  loading,
  conversionRate,
  range,
}: {
  data: AnalyticsSummary | null;
  loading: boolean;
  conversionRate: number | null;
  range: "7d" | "30d";
}) {
  if (loading) {
    return (
      <div className="bg-pss-panel border border-pss-border rounded-xl p-5 text-sm text-neutral-500">
        Loading visitor data…
      </div>
    );
  }

  if (!data || !data.ok) {
    return (
      <div className="bg-pss-panel border border-pss-border rounded-xl p-5 space-y-2">
        <div className="text-sm font-semibold text-neutral-300">
          🌐 Web analytics
        </div>
        <div className="text-xs text-neutral-500">
          {data?.error?.includes("does not exist") || data?.error?.includes("42P01")
            ? "Run sql/analytics_events.sql in Supabase to create the table."
            : data?.error || "No data."}
        </div>
      </div>
    );
  }

  const noData = data.totals.totalEvents === 0;

  return (
    <div className="bg-pss-panel border border-pss-border rounded-xl p-5 space-y-4">
      <div className="flex items-baseline justify-between">
        <div>
          <div className="text-sm font-semibold">🌐 Web visitors</div>
          <div className="text-xs text-neutral-500">
            From peacesoccerschool.com ·{" "}
            {range === "7d" ? "last 7 days" : "last 30 days"}
          </div>
        </div>
      </div>

      {noData ? (
        <div className="text-sm text-neutral-500 py-6 text-center">
          No events received yet. Once peacesoccerschool.com starts POSTing to
          <code className="mx-1 px-1.5 py-0.5 bg-black border border-pss-border rounded text-xs">
            /api/analytics/event
          </code>
          you'll see stats here.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <MiniStat
              label="Visitors"
              value={data.totals.uniqueVisitors.toLocaleString()}
              accent="text-cyan-300"
            />
            <MiniStat
              label="Page views"
              value={data.totals.pageViews.toLocaleString()}
              accent="text-blue-300"
            />
            <MiniStat
              label="Sessions"
              value={data.totals.uniqueSessions.toLocaleString()}
              accent="text-purple-300"
            />
            <MiniStat
              label="Total events"
              value={data.totals.totalEvents.toLocaleString()}
              accent="text-amber-300"
            />
            <MiniStat
              label="Conv. rate"
              value={conversionRate !== null ? `${conversionRate}%` : "—"}
              accent="text-emerald-300"
              tip="Signups ÷ unique visitors"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <TopList label="Top pages" rows={data.topPages} />
            <TopList label="Top sources" rows={data.topSources} />
            <TopList label="Top countries" rows={data.topCountries} />
          </div>

          <div className="border-t border-pss-border pt-3">
            <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-2">
              Event breakdown
            </div>
            <div className="flex flex-wrap gap-1.5">
              {data.eventBreakdown.map((e) => (
                <span
                  key={e.label}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-black/40 border border-pss-border text-neutral-300"
                >
                  <span className="text-neutral-500">{e.label}</span>
                  <span className="font-semibold">{e.count}</span>
                </span>
              ))}
            </div>
          </div>

          {data.recent.length > 0 && (
            <div className="border-t border-pss-border pt-3">
              <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-2">
                Recent events (live)
              </div>
              <div className="space-y-1 max-h-48 overflow-y-auto pr-2">
                {data.recent.map((e) => (
                  <div
                    key={e.id}
                    className="flex items-center gap-2 text-[11px] text-neutral-400 font-mono"
                  >
                    <span className="text-neutral-600 w-16 shrink-0">
                      {new Date(e.created_at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <span className="text-emerald-400 w-24 shrink-0 truncate">
                      {e.event_type}
                    </span>
                    {e.page_path && (
                      <span className="text-neutral-300 truncate">
                        {e.page_path}
                      </span>
                    )}
                    {e.utm_source && (
                      <span className="text-amber-300 truncate">
                        ← {e.utm_source}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TopList({
  label,
  rows,
}: {
  label: string;
  rows: { label: string; count: number }[];
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-2">
        {label}
      </div>
      <ul className="space-y-1.5">
        {rows.slice(0, 5).map((r) => (
          <li
            key={r.label}
            className="flex items-center justify-between text-xs"
          >
            <span className="text-neutral-300 truncate mr-2">{r.label}</span>
            <span className="text-neutral-500 tabular-nums">
              {r.count.toLocaleString()}
            </span>
          </li>
        ))}
        {rows.length === 0 && (
          <li className="text-xs text-neutral-600">No data yet.</li>
        )}
      </ul>
    </div>
  );
}

function MiniStat({
  label,
  value,
  accent,
  tip,
}: {
  label: string;
  value: string;
  accent: string;
  tip?: string;
}) {
  return (
    <div
      title={tip}
      className="bg-black/30 border border-pss-border rounded-lg p-3"
    >
      <div className="text-[10px] uppercase tracking-wider text-neutral-500">
        {label}
      </div>
      <div className={`text-xl font-bold mt-0.5 ${accent}`}>{value}</div>
    </div>
  );
}
