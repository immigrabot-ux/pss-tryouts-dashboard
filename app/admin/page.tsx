"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

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
  notes: string | null;
};

const DAY_BADGE: Record<string, { label: string; cls: string }> = {
  day1: { label: "Day 1", cls: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  day2: { label: "Day 2", cls: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30" },
  both: { label: "Both", cls: "bg-pss-red/15 text-red-300 border-pss-red/30" },
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
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stats = useMemo(() => {
    const total = leads.length;
    const byStatus = (s: string) => leads.filter((l) => l.status === s).length;
    return {
      total,
      newCount: byStatus("new"),
      confirmed: leads.filter((l) => l.whatsapp_confirmed).length,
      attended: byStatus("attended"),
      registered: byStatus("registered"),
    };
  }, [leads]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return leads.filter((l) => {
      if (statusFilter !== "all" && l.status !== statusFilter) return false;
      if (!q) return true;
      return (
        l.parent_name.toLowerCase().includes(q) ||
        l.player_name.toLowerCase().includes(q) ||
        l.parent_phone.toLowerCase().includes(q) ||
        l.parent_email.toLowerCase().includes(q)
      );
    });
  }, [leads, statusFilter, search]);

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

  async function deleteLead(id: string) {
    if (!confirm("Delete this lead? This cannot be undone.")) return;
    const res = await fetch(`/api/leads/${id}`, {
      method: "DELETE",
      headers: { "x-admin-password": password },
    });
    if (res.ok) {
      setLeads((prev) => prev.filter((l) => l.id !== id));
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
              onClick={onLogout}
              className="px-3 py-1.5 text-sm rounded-md border border-pss-border hover:bg-pss-panel transition text-neutral-400"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatCard label="Total leads" value={stats.total} />
          <StatCard label="New" value={stats.newCount} accent="blue" />
          <StatCard
            label="WA Confirmed"
            value={stats.confirmed}
            accent="emerald"
          />
          <StatCard label="Attended" value={stats.attended} accent="purple" />
          <StatCard label="Registered" value={stats.registered} accent="red" />
        </section>

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
                  <th className="px-4 py-3 font-medium">Phone</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">WhatsApp</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Notes</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td
                      colSpan={10}
                      className="px-4 py-10 text-center text-neutral-500"
                    >
                      Loading leads…
                    </td>
                  </tr>
                )}
                {!loading && filtered.length === 0 && (
                  <tr>
                    <td
                      colSpan={10}
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
                      onDelete={() => deleteLead(lead.id)}
                    />
                  ))}
              </tbody>
            </table>
          </div>
        </section>

        <div className="text-center text-xs text-neutral-600 pt-2">
          {filtered.length} of {leads.length} leads shown · Auto-refresh disabled
        </div>
      </div>
    </main>
  );
}

function StatCard({
  label,
  value,
  accent = "default",
}: {
  label: string;
  value: number;
  accent?: "default" | "blue" | "emerald" | "purple" | "red";
}) {
  const accentMap: Record<string, string> = {
    default: "text-white",
    blue: "text-blue-400",
    emerald: "text-emerald-400",
    purple: "text-purple-400",
    red: "text-pss-red",
  };
  return (
    <div className="bg-pss-panel border border-pss-border rounded-xl p-4">
      <div className="text-xs uppercase tracking-wider text-neutral-500">
        {label}
      </div>
      <div className={`text-3xl font-bold mt-1 ${accentMap[accent]}`}>
        {value}
      </div>
    </div>
  );
}

function LeadRow({
  lead,
  expanded,
  onToggle,
  onPatch,
  onDelete,
}: {
  lead: Lead;
  expanded: boolean;
  onToggle: () => void;
  onPatch: (patch: Partial<Lead>) => void;
  onDelete: () => void;
}) {
  const [notes, setNotes] = useState(lead.notes || "");
  useEffect(() => setNotes(lead.notes || ""), [lead.notes]);

  return (
    <>
      <tr
        className="border-b border-pss-border/50 hover:bg-black/30 cursor-pointer"
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
          <div className="flex items-center gap-1.5">
            {lead.whatsapp_opt_in ? (
              <span
                title="Opted in for WhatsApp"
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
              >
                Opt-in
              </span>
            ) : (
              <span className="text-xs text-neutral-600">—</span>
            )}
            {lead.whatsapp_confirmed && (
              <span
                title="Replied to confirm"
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
              >
                ✓ Confirmed
              </span>
            )}
          </div>
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
          <button
            onClick={onDelete}
            className="text-xs text-red-400 hover:text-red-300"
          >
            Delete
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="bg-black/20 border-b border-pss-border/50">
          <td colSpan={10} className="px-6 py-4">
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
