"use client";

import { useEffect, useState } from "react";

type NurtureConfig = {
  dry_run: boolean;
  paused: boolean;
  rate_limit_per_hour: number;
  tryout_info: string;
  updated_at: string;
};

type NurtureStats = {
  stage_counts: {
    new: number;
    welcomed: number;
    nudged: number;
    urgency_low: number;
    urgency_high: number;
    converted: number;
    stopped: number;
  };
  messages_sent_today: number;
  last_cron_minutes_ago: number | null;
};

type TemplateStatus = {
  name: string;
  status: string;
  exists: boolean;
};

export default function NurtureControlPanel({
  password,
  activeFilter,
  onStageClick,
}: {
  password: string;
  activeFilter?: string;
  onStageClick?: (stage: string) => void;
}) {
  const [config, setConfig] = useState<NurtureConfig | null>(null);
  const [stats, setStats] = useState<NurtureStats | null>(null);
  const [templates, setTemplates] = useState<TemplateStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [lastRunResult, setLastRunResult] = useState<any>(null);

  useEffect(() => {
    loadAll();
    // Refresh stats every minute
    const interval = setInterval(loadStats, 60000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadAll() {
    setLoading(true);
    await Promise.all([loadConfig(), loadStats(), loadTemplates()]);
    setLoading(false);
  }

  async function loadConfig() {
    try {
      const res = await fetch("/api/nurture/config", {
        headers: { "x-admin-password": password },
        cache: "no-store",
      });
      if (res.ok) {
        const data = await res.json();
        setConfig(data);
      }
    } catch (err) {
      console.error("Failed to load config:", err);
    }
  }

  async function loadStats() {
    try {
      const res = await fetch("/api/nurture/stats", {
        headers: { "x-admin-password": password },
        cache: "no-store",
      });
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch (err) {
      console.error("Failed to load stats:", err);
    }
  }

  async function loadTemplates() {
    try {
      const res = await fetch("/api/nurture/templates", {
        headers: { "x-admin-password": password },
        cache: "no-store",
      });
      if (res.ok) {
        const data = await res.json();
        setTemplates(data.templates || []);
      }
    } catch (err) {
      console.error("Failed to load templates:", err);
    }
  }

  async function updateConfig(updates: Partial<NurtureConfig>) {
    try {
      const res = await fetch("/api/nurture/config", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-admin-password": password,
        },
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        const data = await res.json();
        setConfig(data);
        return true;
      }
      return false;
    } catch (err) {
      console.error("Failed to update config:", err);
      return false;
    }
  }

  async function toggleDryRun() {
    if (!config) return;
    const newValue = !config.dry_run;
    const message = newValue
      ? "Enable DRY RUN mode?\n\nNo actual messages will be sent - only logged."
      : "⚠️ DISABLE DRY RUN?\n\nThis will send REAL WhatsApp messages to leads.\n\nContinue?";

    if (!window.confirm(message)) return;

    await updateConfig({ dry_run: newValue });
  }

  async function togglePause() {
    if (!config) return;
    const newValue = !config.paused;
    const message = newValue
      ? "PAUSE all nurture?\n\nThe hourly cron will do nothing while paused."
      : "RESUME nurture?\n\nThe hourly cron will resume sending messages.";

    if (!window.confirm(message)) return;

    await updateConfig({ paused: newValue });
  }

  async function setRateLimit() {
    if (!config) return;
    const value = window.prompt(
      `Set rate limit (messages per hour)\n\nCurrent: ${config.rate_limit_per_hour}\n\nEnter new value (5-50):`,
      String(config.rate_limit_per_hour)
    );

    if (!value) return;
    const num = parseInt(value, 10);
    if (isNaN(num) || num < 5 || num > 50) {
      alert("Invalid rate limit. Must be between 5 and 50.");
      return;
    }

    await updateConfig({ rate_limit_per_hour: num });
  }

  async function runNow() {
    if (!config) return;

    const estimated = stats?.stage_counts
      ? Math.min(
          config.rate_limit_per_hour,
          stats.stage_counts.welcomed +
            stats.stage_counts.nudged +
            stats.stage_counts.urgency_low
        )
      : config.rate_limit_per_hour;

    const message = config.dry_run
      ? `Run nurture sequence now (DRY RUN mode)?\n\nUp to ${estimated} leads will be processed (no actual sends).`
      : `⚠️ Run nurture sequence now?\n\nThis will send up to ${estimated} REAL messages.\n\nContinue?`;

    if (!window.confirm(message)) return;

    setRunning(true);
    setLastRunResult(null);

    try {
      const res = await fetch("/api/nurture/trigger", {
        method: "POST",
        headers: { "x-admin-password": password },
      });
      const data = await res.json();
      setLastRunResult(data);

      // Refresh stats after run
      await loadStats();

      const summary = data.dry_run
        ? `DRY RUN: ${data.actions?.sent || 0} would be sent`
        : `✓ Sent ${data.actions?.sent || 0} messages\n✗ ${data.actions?.failed || 0} failed`;

      alert(summary);
    } catch (err) {
      alert(`Error: ${err instanceof Error ? err.message : err}`);
    } finally {
      setRunning(false);
    }
  }

  if (loading || !config || !stats) {
    return (
      <section className="bg-pss-panel border border-pss-border rounded-xl p-6">
        <div className="text-neutral-500">Loading nurture system...</div>
      </section>
    );
  }

  const totalActive =
    stats.stage_counts.welcomed +
    stats.stage_counts.nudged +
    stats.stage_counts.urgency_low +
    stats.stage_counts.urgency_high;

  return (
    <section className="bg-pss-panel border border-pss-border rounded-xl p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Nurture System Control Panel</h2>
        <button
          onClick={loadAll}
          className="text-xs text-neutral-400 hover:text-white"
        >
          ↻ Refresh
        </button>
      </div>

      {/* Status Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-black/40 rounded-md p-3">
          <div className="text-xs text-neutral-500 mb-1">Dry Run Mode</div>
          <div
            className={`text-sm font-medium ${
              config.dry_run ? "text-blue-400" : "text-red-400"
            }`}
          >
            {config.dry_run ? "ON (safe)" : "OFF (live)"}
          </div>
        </div>

        <div className="bg-black/40 rounded-md p-3">
          <div className="text-xs text-neutral-500 mb-1">System Status</div>
          <div
            className={`text-sm font-medium ${
              config.paused ? "text-amber-400" : "text-emerald-400"
            }`}
          >
            {config.paused ? "PAUSED" : "ACTIVE"}
          </div>
        </div>

        <div className="bg-black/40 rounded-md p-3">
          <div className="text-xs text-neutral-500 mb-1">Rate Limit</div>
          <div className="text-sm font-medium">
            {config.rate_limit_per_hour}/hour
          </div>
        </div>

        <div className="bg-black/40 rounded-md p-3">
          <div className="text-xs text-neutral-500 mb-1">Last Cron Run</div>
          <div className="text-sm font-medium">
            {stats.last_cron_minutes_ago === null
              ? "Never"
              : `${stats.last_cron_minutes_ago}m ago`}
          </div>
        </div>
      </div>

      {/* Leads by Stage */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs uppercase tracking-wider text-neutral-500">
            Leads by Nurture Stage
          </div>
          {activeFilter && activeFilter !== "all" && (
            <button
              onClick={() => onStageClick?.("all")}
              className="text-xs text-neutral-400 hover:text-white"
            >
              Clear filter
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          {Object.entries(stats.stage_counts).map(([stage, count]) => {
            const isActive = activeFilter === stage;
            return (
              <div
                key={stage}
                onClick={() => onStageClick?.(isActive ? "all" : stage)}
                className={`bg-black/40 rounded-md p-3 text-center border cursor-pointer transition ${
                  isActive
                    ? "border-pss-red bg-pss-red/10 ring-1 ring-pss-red/50"
                    : "border-transparent hover:border-pss-border"
                }`}
              >
                <div className="text-xl font-bold">{count}</div>
                <div className="text-[10px] text-neutral-500 uppercase">
                  {stage.replace(/_/g, " ")}
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-2 text-xs text-neutral-500">
          {stats.messages_sent_today} messages sent today • {totalActive} in
          active sequence
        </div>
      </div>

      {/* Control Buttons */}
      <div>
        <div className="text-xs uppercase tracking-wider text-neutral-500 mb-3">
          Controls
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={toggleDryRun}
            className={`px-4 py-2 rounded-md border font-medium text-sm transition ${
              config.dry_run
                ? "border-red-500 text-red-400 hover:bg-red-500/10"
                : "border-blue-500 text-blue-400 hover:bg-blue-500/10"
            }`}
          >
            {config.dry_run ? "Disable" : "Enable"} Dry Run
          </button>

          <button
            onClick={togglePause}
            className={`px-4 py-2 rounded-md border font-medium text-sm transition ${
              config.paused
                ? "border-emerald-500 text-emerald-400 hover:bg-emerald-500/10"
                : "border-amber-500 text-amber-400 hover:bg-amber-500/10"
            }`}
          >
            {config.paused ? "Resume" : "Pause"} All Nurture
          </button>

          <button
            onClick={setRateLimit}
            className="px-4 py-2 rounded-md border border-pss-border text-white hover:bg-pss-panel transition font-medium text-sm"
          >
            Set Rate Limit ({config.rate_limit_per_hour})
          </button>

          <button
            onClick={runNow}
            disabled={running}
            className="px-4 py-2 rounded-md bg-pss-red hover:bg-pss-redhover transition font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {running ? "Running..." : "Run Nurture Now"}
          </button>
        </div>
      </div>

      {/* Template Status */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs uppercase tracking-wider text-neutral-500">
            WhatsApp Templates
          </div>
          <button
            onClick={loadTemplates}
            className="text-xs text-neutral-400 hover:text-white"
          >
            Refresh
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {templates.map((t) => (
            <div
              key={t.name}
              className="bg-black/40 rounded-md p-3 border border-pss-border"
            >
              <div className="text-sm font-medium mb-1">{t.name}</div>
              <div
                className={`text-xs ${
                  t.status === "APPROVED"
                    ? "text-emerald-400"
                    : t.status === "PENDING"
                      ? "text-amber-400"
                      : t.exists
                        ? "text-red-400"
                        : "text-neutral-500"
                }`}
              >
                {t.status === "NOT_FOUND" ? "Not created yet" : t.status}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
