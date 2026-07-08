"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AnalyticsPanel from "./_components/AnalyticsPanel";

type Lead = {
  id: string;
  created_at: string;
  parent_name: string;
  player_name: string;
  player_age: number;
  parent_phone: string;
  parent_email: string;
  whatsapp_opt_in: boolean;
  whatsapp_confirmed: boolean;
  whatsapp_confirmed_at?: string | null;
  status: string;
  tryout_date: string | null;
  tryout_day?: string | null;
  age_group?: string | null;
  whatsapp_send_status?: string | null;
  whatsapp_send_error?: string | null;
  source?: string | null;
  nurture_stage?: string | null;
  nurture_sequence_stopped_reason?: string | null;
  hidden?: boolean | null;
  hidden_reason?: string | null;
  notes: string | null;
};

const HIDE_REASONS = [
  "test_lead",
  "duplicate",
  "invalid_phone",
  "fake",
  "not_a_real_signup",
  "other",
];

const DAY_BADGE: Record<string, { label: string; cls: string }> = {
  day1: { label: "Day 1", cls: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  day2: { label: "Day 2", cls: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30" },
  both: { label: "Both", cls: "bg-pss-red/15 text-red-300 border-pss-red/30" },
};

const SOURCE_BADGE: Record<string, { label: string; cls: string }> = {
  website: { label: "Website", cls: "bg-blue-500/15 text-blue-300 border-blue-500/30" },
  meta_lead_ad: { label: "Meta Lead Ad", cls: "bg-orange-500/15 text-orange-300 border-orange-500/30" },
};

const STATUSES = [
  "new",
  "contacted",
  "confirmed",
  "attended",
  "registered",
  "no_show",
  "dropped",
];

const STATUS_COLORS: Record<string, string> = {
  new: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  contacted: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  confirmed: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  attended: "bg-purple-500/15 text-purple-300 border-purple-500/30",
  registered: "bg-pss-red/20 text-red-300 border-pss-red/40",
  no_show: "bg-neutral-700/30 text-neutral-300 border-neutral-600/40",
  dropped: "bg-neutral-700/30 text-neutral-400 border-neutral-600/40",
};

const NURTURE_STAGE_COLORS: Record<string, string> = {
  new: "bg-neutral-500/15 text-neutral-300 border-neutral-500/30",
  welcomed: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  nudged: "bg-yellow-500/15 text-yellow-300 border-yellow-500/30",
  urgency_low: "bg-orange-500/15 text-orange-300 border-orange-500/30",
  urgency_high: "bg-red-500/15 text-red-300 border-red-500/30",
  converted: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  stopped: "bg-neutral-900/40 text-neutral-500 border-neutral-800/40",
};

const LS_KEY = "pss-admin-password";

export default function AdminPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [pwInput, setPwInput] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);

  // hydrate from localStorage
  useEffect(() => {
    const stored = typeof window !== "undefined" ? localStorage.getItem(LS_KEY) : null;
    if (stored) {
      setPassword(stored);
      verify(stored).then((ok) => {
        if (ok) {
          setAuthed(true);
        } else {
          localStorage.removeItem(LS_KEY);
          setAuthed(false);
        }
      });
    } else {
      setAuthed(false);
    }
  }, []);

  async function verify(pw: string): Promise<boolean> {
    const res = await fetch("/api/leads", {
      headers: { "x-admin-password": pw },
    });
    return res.ok;
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setPwError(null);
    const ok = await verify(pwInput);
    if (ok) {
      localStorage.setItem(LS_KEY, pwInput);
      setPassword(pwInput);
      setAuthed(true);
    } else {
      setPwError("Incorrect password.");
    }
  }

  function handleLogout() {
    localStorage.removeItem(LS_KEY);
    setPassword("");
    setAuthed(false);
  }

  if (authed === null) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="text-neutral-500 text-sm">Loading…</div>
      </main>
    );
  }

  if (!authed) {
    return (
      <main className="min-h-screen flex items-center justify-center px-6">
        <form
          onSubmit={handleLogin}
          className="w-full max-w-sm bg-pss-panel border border-pss-border rounded-xl p-8 space-y-5"
        >
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 text-pss-red font-semibold tracking-widest text-[10px] uppercase">
              <span className="w-1.5 h-1.5 rounded-full bg-pss-red" />
              Peace Soccer School
            </div>
            <h1 className="text-2xl font-bold">Admin sign-in</h1>
            <p className="text-sm text-neutral-400">
              Enter the admin password to access the tryouts dashboard.
            </p>
          </div>
          <div className="space-y-1">
            <label className="text-xs uppercase tracking-wider text-neutral-500">
              Password
            </label>
            <input
              type="password"
              autoFocus
              value={pwInput}
              onChange={(e) => setPwInput(e.target.value)}
              className="w-full bg-black border border-pss-border rounded-md px-3 py-2.5 text-white focus:border-pss-red outline-none transition"
            />
            {pwError && (
              <div className="text-xs text-pss-red pt-1">{pwError}</div>
            )}
          </div>
          <button
            type="submit"
            className="w-full bg-pss-red hover:bg-pss-redhover transition rounded-md py-2.5 font-medium"
          >
            Sign in
          </button>
        </form>
      </main>
    );
  }

  return <Dashboard password={password} onLogout={handleLogout} />;
}

function Dashboard({
  password,
  onLogout,
}: {
  password: string;
  onLogout: () => void;
}) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [resending, setResending] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [unconfirmedCount, setUnconfirmedCount] = useState<number | null>(null);
  const [lastBatch, setLastBatch] = useState<{
    sent: number;
    skipped: number;
    timestamp: string;
  } | null>(null);

  async function loadLeads() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/leads", {
        headers: { "x-admin-password": password },
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setLeads(data.leads || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load leads.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadLeads();
    loadUnconfirmedCount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadUnconfirmedCount() {
    try {
      const res = await fetch(
        `/api/whatsapp/send-reminder?password=${encodeURIComponent(password)}&dry_run=1`,
        { cache: "no-store" }
      );
      if (res.ok) {
        const data = await res.json();
        setUnconfirmedCount(data.eligible_count || 0);
      }
    } catch (err) {
      console.error("Failed to load unconfirmed count:", err);
    }
  }

  // Visible leads = non-hidden by default; "Show hidden" reveals everything.
  const visibleLeads = useMemo(
    () => (showHidden ? leads : leads.filter((l) => !l.hidden)),
    [leads, showHidden]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return visibleLeads.filter((l) => {
      if (statusFilter !== "all" && l.status !== statusFilter) return false;
      if (sourceFilter !== "all" && (l.source || "website") !== sourceFilter) return false;
      if (!q) return true;
      return (
        l.parent_name.toLowerCase().includes(q) ||
        l.player_name.toLowerCase().includes(q) ||
        l.parent_phone.toLowerCase().includes(q) ||
        l.parent_email.toLowerCase().includes(q)
      );
    });
  }, [visibleLeads, statusFilter, sourceFilter, search]);

  const hiddenCount = useMemo(
    () => leads.filter((l) => l.hidden).length,
    [leads]
  );

  async function patchLead(id: string, patch: Partial<Lead>) {
    setLeads((prev) =>
      prev.map((l) => (l.id === id ? { ...l, ...patch } : l))
    );
    const res = await fetch(`/api/leads/${id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-admin-password": password,
      },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      console.error("patch failed", await res.text());
      // refetch on failure to undo the optimistic update
      loadLeads();
    }
  }

  /**
   * Soft-delete a lead by setting `hidden = true`.
   * Keeps the meta_leadgen_id so the cron's dedupe still recognizes it
   * and won't re-process the lead on the next poll.
   */
  async function hideLead(id: string) {
    const reason = window.prompt(
      "Hide this lead? Pick a reason (or type your own):\n" +
        HIDE_REASONS.map((r, i) => `${i + 1}. ${r}`).join("\n"),
      "test_lead"
    );
    if (!reason) return;
    // Allow the user to enter "1" / "2" etc. as a shortcut.
    const trimmed = reason.trim();
    const asNumber = parseInt(trimmed, 10);
    const finalReason =
      !isNaN(asNumber) && asNumber >= 1 && asNumber <= HIDE_REASONS.length
        ? HIDE_REASONS[asNumber - 1]
        : trimmed;

    await patchLead(id, {
      hidden: true,
      hidden_reason: finalReason,
    } as Partial<Lead>);
  }

  /** Restore a previously hidden lead. */
  async function unhideLead(id: string) {
    await patchLead(id, { hidden: false, hidden_reason: null } as Partial<Lead>);
  }

  /** Stop the automated nurture sequence for a lead. */
  async function stopNurture(id: string) {
    const reason = window.prompt(
      "Stop nurture sequence for this lead?\n\nReason:\n- opted_out (parent asked not to contact)\n- dead_lead (not responsive)\n- manual_stop (other)\n\nEnter reason:",
      "opted_out"
    );
    if (!reason) return;

    await patchLead(id, {
      nurture_stage: "stopped",
      nurture_sequence_stopped_reason: reason.trim(),
    } as Partial<Lead>);
  }

  /**
   * Send reminder WhatsApp to unconfirmed leads using pss_reminder template.
   * Queries DB on click for fresh count, shows confirmation, and prevents
   * duplicate sends within 24 hours.
   */
  async function resendWelcomeToUnconfirmed() {
    setResending(true);
    try {
      // Step 1: Query Supabase for current count (dry-run)
      const previewRes = await fetch(
        `/api/whatsapp/send-reminder?password=${encodeURIComponent(
          password
        )}&dry_run=1`,
        { cache: "no-store" }
      );
      const preview = await previewRes.json();
      if (!previewRes.ok) {
        alert(`Couldn't preview: ${preview.error || previewRes.status}`);
        return;
      }

      const eligibleCount = preview.eligible_count || 0;
      const totalUnconfirmed = preview.total_unconfirmed || 0;

      // Update the count display
      setUnconfirmedCount(eligibleCount);

      if (eligibleCount === 0) {
        alert(
          totalUnconfirmed === 0
            ? "🎉 Everyone has confirmed — nothing to send."
            : `0 leads eligible for reminder right now.\n\n${totalUnconfirmed} unconfirmed lead${totalUnconfirmed === 1 ? "" : "s"} total, but ${preview.skipped_count} skipped (reminded within last 24 hours).`
        );
        return;
      }

      // Step 2: Show confirmation dialog with current count
      const ok = window.confirm(
        `Send reminder WhatsApp to ${eligibleCount} unconfirmed lead${eligibleCount === 1 ? "" : "s"}?\n\nThis will use template pss_reminder.\n\n${preview.skipped_count > 0 ? `Skipping ${preview.skipped_count} (reminded within last 24 hours).\n\n` : ""}Continue?`
      );
      if (!ok) return;

      // Step 3: Send the reminders
      const res = await fetch(
        `/api/whatsapp/send-reminder?password=${encodeURIComponent(password)}`,
        { cache: "no-store" }
      );
      const data = await res.json();
      if (!res.ok) {
        alert(`Send failed: ${data.error || res.status}`);
        return;
      }

      // Step 4: Update last batch info
      setLastBatch({
        sent: data.sent,
        skipped: data.skipped_count,
        timestamp: data.timestamp,
      });

      // Build result message with warnings
      let message = `✓ Sent ${data.sent} / ${data.eligible_count}`;
      if (data.failed > 0) message += `\n✗ ${data.failed} failed`;
      if (data.skipped_count > 0)
        message += `\n\nSkipped ${data.skipped_count} (reminded within last 24 hours)`;
      if (data.not_processed > 0)
        message += `\n\n⚠️  ${data.not_processed} not processed`;
      if (data.circuit_breaker_tripped)
        message += `\n\n🚨 Circuit breaker tripped - template parameter mismatch detected. Check logs.`;
      if (data.timed_out)
        message += `\n\n⏱️  Timeout - processing stopped at 55 seconds to avoid Vercel limit.`;

      alert(message);

      // Step 5: Refresh data
      await loadLeads();
      await loadUnconfirmedCount();
    } catch (err) {
      alert(`Error: ${err instanceof Error ? err.message : err}`);
    } finally {
      setResending(false);
    }
  }

  function exportCSV() {
    const headers = [
      "created_at",
      "parent_name",
      "player_name",
      "player_age",
      "age_group",
      "tryout_day",
      "parent_phone",
      "parent_email",
      "whatsapp_opt_in",
      "whatsapp_confirmed",
      "status",
      "tryout_date",
      "notes",
    ];
    const rows = filtered.map((l) =>
      headers.map((h) => csvCell((l as any)[h])).join(",")
    );
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const stamp = new Date().toISOString().slice(0, 10);
    a.download = `pss-leads-${stamp}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="min-h-screen">
      <header className="border-b border-pss-border bg-pss-panel/40 backdrop-blur sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-pss-red flex items-center justify-center font-bold">
              ⚽
            </div>
            <div>
              <div className="text-xs uppercase tracking-widest text-pss-red font-semibold">
                Peace Soccer School
              </div>
              <div className="text-base font-semibold">Tryouts Dashboard</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={loadLeads}
              className="px-3 py-1.5 text-sm rounded-md border border-pss-border hover:bg-pss-panel transition"
            >
              ↻ Refresh
            </button>
            <button
              onClick={exportCSV}
              className="px-3 py-1.5 text-sm rounded-md bg-pss-red hover:bg-pss-redhover transition font-medium"
            >
              Export CSV
            </button>
            <button
              onClick={resendWelcomeToUnconfirmed}
              disabled={resending}
              title="Send reminder WhatsApp (pss_reminder template) to unconfirmed leads"
              className="px-3 py-1.5 text-sm rounded-md border border-pss-border hover:border-pss-red hover:bg-pss-panel transition disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {resending
                ? "Sending…"
                : unconfirmedCount !== null
                  ? `📱 Resend to ${unconfirmedCount} unconfirmed`
                  : "📱 Resend to unconfirmed"}
            </button>
            <button
              onClick={onLogout}
              className="px-3 py-1.5 text-sm rounded-md border border-pss-border hover:bg-pss-panel transition text-neutral-400"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        <AnalyticsPanel leads={visibleLeads} password={password} />

        {lastBatch && (
          <div className="bg-pss-panel border border-pss-border rounded-md px-4 py-3 text-sm">
            <div className="flex items-center gap-2 text-neutral-400">
              <span className="font-medium">Last resend batch:</span>
              <span className="text-green-400">{lastBatch.sent} sent</span>
              <span className="text-neutral-500">•</span>
              <span className="text-amber-400">{lastBatch.skipped} skipped</span>
              <span className="text-neutral-500">•</span>
              <span className="text-neutral-500">
                at {new Date(lastBatch.timestamp).toLocaleString()}
              </span>
            </div>
          </div>
        )}

        <section className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, phone, or email…"
              className="w-full bg-pss-panel border border-pss-border rounded-md px-4 py-2.5 text-sm focus:border-pss-red outline-none"
            />
          </div>
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="bg-pss-panel border border-pss-border rounded-md px-3 py-2.5 text-sm focus:border-pss-red outline-none"
          >
            <option value="all">All sources</option>
            <option value="website">Website</option>
            <option value="meta_lead_ad">Meta Lead Ad</option>
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-pss-panel border border-pss-border rounded-md px-3 py-2.5 text-sm focus:border-pss-red outline-none"
          >
            <option value="all">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </section>

        {error && (
          <div className="bg-red-950/40 border border-red-900 rounded-md px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <section className="bg-pss-panel border border-pss-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-black/40 border-b border-pss-border">
                <tr className="text-left text-xs uppercase tracking-wider text-neutral-500">
                  <th className="px-4 py-3 font-medium">Created</th>
                  <th className="px-4 py-3 font-medium">Parent</th>
                  <th className="px-4 py-3 font-medium">Player</th>
                  <th className="px-4 py-3 font-medium">Day</th>
                  <th className="px-4 py-3 font-medium">Source</th>
                  <th className="px-4 py-3 font-medium">Phone</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">WhatsApp</th>
                  <th className="px-4 py-3 font-medium">Nurture</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Notes</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td
                      colSpan={12}
                      className="px-4 py-10 text-center text-neutral-500"
                    >
                      Loading leads…
                    </td>
                  </tr>
                )}
                {!loading && filtered.length === 0 && (
                  <tr>
                    <td
                      colSpan={12}
                      className="px-4 py-10 text-center text-neutral-500"
                    >
                      No leads match your filters.
                    </td>
                  </tr>
                )}
                {!loading &&
                  filtered.map((lead) => (
                    <LeadRow
                      key={lead.id}
                      lead={lead}
                      expanded={expanded === lead.id}
                      onToggle={() =>
                        setExpanded(expanded === lead.id ? null : lead.id)
                      }
                      onPatch={(patch) => patchLead(lead.id, patch)}
                      onHide={() => hideLead(lead.id)}
                      onUnhide={() => unhideLead(lead.id)}
                      onStopNurture={() => stopNurture(lead.id)}
                    />
                  ))}
              </tbody>
            </table>
          </div>
        </section>

        <div className="text-center text-xs text-neutral-600 pt-2">
          {filtered.length} of {visibleLeads.length} leads shown
          {hiddenCount > 0 && (
            <>
              {" · "}
              <button
                onClick={() => setShowHidden(!showHidden)}
                className="text-pss-red hover:underline"
              >
                {showHidden
                  ? `Hide ${hiddenCount} hidden leads`
                  : `Show ${hiddenCount} hidden leads`}
              </button>
            </>
          )}
        </div>
      </div>
    </main>
  );
}

function LeadRow({
  lead,
  expanded,
  onToggle,
  onPatch,
  onHide,
  onUnhide,
  onStopNurture,
}: {
  lead: Lead;
  expanded: boolean;
  onToggle: () => void;
  onPatch: (patch: Partial<Lead>) => void;
  onHide: () => void;
  onUnhide: () => void;
  onStopNurture: () => void;
}) {
  const [notes, setNotes] = useState(lead.notes || "");
  useEffect(() => setNotes(lead.notes || ""), [lead.notes]);

  return (
    <>
      <tr
        className={`border-b border-pss-border/50 hover:bg-black/30 cursor-pointer ${
          lead.hidden ? "opacity-50 italic" : ""
        }`}
        onClick={(e) => {
          // don't toggle when clicking interactive elements
          if (
            (e.target as HTMLElement).closest(
              "a, button, select, input, textarea"
            )
          )
            return;
          onToggle();
        }}
      >
        <td className="px-4 py-3 text-neutral-400 whitespace-nowrap">
          {formatDate(lead.created_at)}
        </td>
        <td className="px-4 py-3 font-medium">{lead.parent_name}</td>
        <td className="px-4 py-3">
          <div>{lead.player_name}</div>
          <div className="text-xs text-neutral-500">
            {lead.age_group || `age ${lead.player_age}`}
          </div>
        </td>
        <td className="px-4 py-3">
          {(() => {
            const key = (lead.tryout_day || "both").toLowerCase();
            const badge = DAY_BADGE[key] || DAY_BADGE.both;
            return (
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium border ${badge.cls}`}
              >
                {badge.label}
              </span>
            );
          })()}
        </td>
        <td className="px-4 py-3">
          {(() => {
            const source = lead.source || "website";
            const badge = SOURCE_BADGE[source] || SOURCE_BADGE.website;
            return (
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium border ${badge.cls}`}
              >
                {badge.label}
              </span>
            );
          })()}
        </td>
        <td className="px-4 py-3">
          <a
            href={`https://wa.me/${lead.parent_phone.replace(/\D/g, "")}`}
            target="_blank"
            rel="noreferrer"
            className="text-emerald-400 hover:underline"
          >
            {lead.parent_phone}
          </a>
        </td>
        <td className="px-4 py-3">
          <a
            href={`mailto:${lead.parent_email}`}
            className="text-blue-400 hover:underline"
          >
            {lead.parent_email}
          </a>
        </td>
        <td className="px-4 py-3">
          {(() => {
            if (!lead.whatsapp_opt_in)
              return <span className="text-xs text-neutral-600">—</span>;

            // Confirmed (parent has replied at least once)
            if (lead.whatsapp_confirmed) {
              return (
                <span
                  title={`Confirmed ${
                    lead.whatsapp_confirmed_at
                      ? `at ${new Date(lead.whatsapp_confirmed_at).toLocaleString()}`
                      : ""
                  }`}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                >
                  ✓ Confirmed
                </span>
              );
            }

            // Failed to send
            if (lead.whatsapp_send_status === "failed") {
              return (
                <span
                  title={lead.whatsapp_send_error || "Send failed"}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider bg-red-500/15 text-red-300 border border-red-500/40"
                >
                  ✗ Send failed
                </span>
              );
            }

            // Sent but waiting for reply
            if (lead.whatsapp_send_status === "sent") {
              return (
                <span
                  title="Welcome template sent — waiting for parent to reply"
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider bg-amber-500/15 text-amber-300 border border-amber-500/30"
                >
                  ⏳ Sent · awaiting reply
                </span>
              );
            }

            // Opted in but template hasn't fired yet (or not tracked)
            return (
              <span
                title="Opted in but template send not yet recorded"
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider bg-blue-500/10 text-blue-300 border border-blue-500/30"
              >
                Opt-in
              </span>
            );
          })()}
        </td>
        <td className="px-4 py-3">
          {(() => {
            const stage = lead.nurture_stage || "new";
            const color = NURTURE_STAGE_COLORS[stage] || NURTURE_STAGE_COLORS.new;
            const displayName = stage.replace(/_/g, " ");
            return (
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium border ${color}`}
                title={lead.nurture_sequence_stopped_reason ? `Stopped: ${lead.nurture_sequence_stopped_reason}` : undefined}
              >
                {displayName}
              </span>
            );
          })()}
        </td>
        <td className="px-4 py-3">
          <select
            value={lead.status}
            onChange={(e) => onPatch({ status: e.target.value })}
            className={`bg-transparent border rounded px-2 py-1 text-xs font-medium ${
              STATUS_COLORS[lead.status] ||
              "bg-neutral-700/30 text-neutral-300 border-neutral-600/40"
            }`}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s} className="bg-pss-panel text-white">
                {s}
              </option>
            ))}
          </select>
        </td>
        <td className="px-4 py-3 min-w-[200px]">
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => {
              if (notes !== (lead.notes || "")) {
                onPatch({ notes: notes || null });
              }
            }}
            placeholder="Add a note…"
            className="w-full bg-transparent border border-transparent hover:border-pss-border focus:border-pss-red rounded px-2 py-1 text-sm outline-none"
          />
        </td>
        <td className="px-4 py-3 text-right whitespace-nowrap">
          <Link
            href={`/admin/leads/${lead.id}`}
            className="text-xs text-neutral-400 hover:text-white mr-3"
          >
            View
          </Link>
          {lead.nurture_stage !== "stopped" && lead.nurture_stage !== "converted" && (
            <button
              onClick={onStopNurture}
              className="text-xs text-red-400 hover:text-red-300 mr-3"
              title="Stop automated nurture sequence"
            >
              Stop nurture
            </button>
          )}
          {lead.hidden ? (
            <button
              onClick={onUnhide}
              className="text-xs text-emerald-400 hover:text-emerald-300"
              title={
                lead.hidden_reason
                  ? `Hidden — reason: ${lead.hidden_reason}`
                  : "Hidden"
              }
            >
              Unhide
            </button>
          ) : (
            <button
              onClick={onHide}
              className="text-xs text-amber-400 hover:text-amber-300"
              title="Soft-delete: lead stays in DB so the cron's dedupe still recognizes it"
            >
              Hide
            </button>
          )}
        </td>
      </tr>
      {expanded && (
        <tr className="bg-black/20 border-b border-pss-border/50">
          <td colSpan={12} className="px-6 py-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <Field label="Lead ID" value={lead.id} />
              <Field
                label="Days attending"
                value={
                  lead.tryout_day === "day1"
                    ? "Day 1 only (Sat Jul 25)"
                    : lead.tryout_day === "day2"
                    ? "Day 2 only (Sun Jul 26)"
                    : "Both days (Jul 25 & 26)"
                }
              />
              <Field label="Age group" value={lead.age_group || `age ${lead.player_age}`} />
              <Field
                label="WhatsApp confirmed at"
                value={
                  lead.whatsapp_confirmed_at
                    ? formatDate(lead.whatsapp_confirmed_at)
                    : "—"
                }
              />
            </div>
            <div className="mt-4">
              <Link
                href={`/admin/leads/${lead.id}`}
                className="text-xs text-pss-red hover:underline"
              >
                Open full lead details →
              </Link>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-neutral-500">
        {label}
      </div>
      <div className="text-neutral-200 break-all">{value}</div>
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "2-digit",
  });
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v).replace(/"/g, '""');
  if (/[",\n]/.test(s)) return `"${s}"`;
  return s;
}
