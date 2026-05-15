"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

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
  notes: string | null;
};

type Activity = {
  id: string;
  created_at: string;
  channel: "email" | "whatsapp" | "system";
  kind: string;
  detail: string | null;
  success: boolean;
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

const LS_KEY = "pss-admin-password";

export default function LeadDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [password, setPassword] = useState<string | null>(null);
  const [lead, setLead] = useState<Lead | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [sending, setSending] = useState<string | null>(null);

  useEffect(() => {
    const stored =
      typeof window !== "undefined" ? localStorage.getItem(LS_KEY) : null;
    if (!stored) {
      router.push("/admin");
      return;
    }
    setPassword(stored);
  }, [router]);

  const load = useCallback(async () => {
    if (!password) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/leads/${params.id}`, {
        headers: { "x-admin-password": password },
        cache: "no-store",
      });
      if (res.status === 401) {
        localStorage.removeItem(LS_KEY);
        router.push("/admin");
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setLead(data.lead);
      setActivities(data.activities || []);
      setNotes(data.lead?.notes || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load.");
    } finally {
      setLoading(false);
    }
  }, [params.id, password, router]);

  useEffect(() => {
    load();
  }, [load]);

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }

  async function patch(update: Partial<Lead>) {
    if (!password || !lead) return;
    const res = await fetch(`/api/leads/${lead.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-admin-password": password,
      },
      body: JSON.stringify(update),
    });
    if (res.ok) {
      const data = await res.json();
      setLead(data.lead);
      flash("Saved");
    } else {
      flash("Save failed");
    }
  }

  async function trigger(action: string, label: string) {
    if (!password || !lead) return;
    setSending(action);
    try {
      const res = await fetch(`/api/leads/${lead.id}/send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-password": password,
        },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        flash(`${label} sent ✓`);
      } else {
        flash(`${label} failed: ${data.error || "unknown error"}`);
      }
      await load();
    } catch (err) {
      flash(`${label} failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      setSending(null);
    }
  }

  async function handleDelete() {
    if (!password || !lead) return;
    if (!confirm("Delete this lead permanently?")) return;
    const res = await fetch(`/api/leads/${lead.id}`, {
      method: "DELETE",
      headers: { "x-admin-password": password },
    });
    if (res.ok) router.push("/admin");
  }

  if (!password) return null;

  return (
    <main className="min-h-screen">
      <header className="border-b border-pss-border bg-pss-panel/40 backdrop-blur sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/admin"
              className="text-sm text-neutral-400 hover:text-white"
            >
              ← Back
            </Link>
            <div className="text-base font-semibold">Lead detail</div>
          </div>
          {toast && (
            <div className="text-xs px-3 py-1.5 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-300">
              {toast}
            </div>
          )}
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        {loading && (
          <div className="text-neutral-500 text-sm">Loading…</div>
        )}
        {error && (
          <div className="bg-red-950/40 border border-red-900 rounded-md px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {lead && (
          <>
            <section className="bg-pss-panel border border-pss-border rounded-xl p-6">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <div className="text-xs uppercase tracking-widest text-pss-red font-semibold">
                    {lead.status}
                  </div>
                  <h1 className="text-2xl font-bold mt-1">
                    {lead.player_name}{" "}
                    <span className="text-neutral-500 text-base font-normal">
                      (age {lead.player_age})
                    </span>
                  </h1>
                  <div className="text-neutral-400 mt-1">
                    Parent: {lead.parent_name}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={lead.status}
                    onChange={(e) => patch({ status: e.target.value })}
                    className="bg-black border border-pss-border rounded-md px-3 py-1.5 text-sm"
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={handleDelete}
                    className="px-3 py-1.5 text-sm rounded-md border border-red-900 text-red-400 hover:bg-red-950/40 transition"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </section>

            <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-pss-panel border border-pss-border rounded-xl p-6 space-y-4">
                <h2 className="text-sm uppercase tracking-widest text-neutral-500">
                  Contact
                </h2>
                <Row
                  label="Phone"
                  value={
                    <a
                      href={`https://wa.me/${lead.parent_phone.replace(
                        /\D/g,
                        ""
                      )}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-emerald-400 hover:underline"
                    >
                      {lead.parent_phone}
                    </a>
                  }
                />
                <Row
                  label="Email"
                  value={
                    <a
                      href={`mailto:${lead.parent_email}`}
                      className="text-blue-400 hover:underline"
                    >
                      {lead.parent_email}
                    </a>
                  }
                />
                <Row
                  label="WhatsApp opt-in"
                  value={lead.whatsapp_opt_in ? "Yes" : "No"}
                />
                <Row
                  label="WhatsApp confirmed"
                  value={
                    lead.whatsapp_confirmed
                      ? `Yes${
                          lead.whatsapp_confirmed_at
                            ? ` · ${new Date(
                                lead.whatsapp_confirmed_at
                              ).toLocaleString()}`
                            : ""
                        }`
                      : "Not yet"
                  }
                />
                <Row
                  label="Tryout date"
                  value={lead.tryout_date || "—"}
                />
                <Row
                  label="Submitted"
                  value={new Date(lead.created_at).toLocaleString()}
                />
              </div>

              <div className="bg-pss-panel border border-pss-border rounded-xl p-6 space-y-4">
                <h2 className="text-sm uppercase tracking-widest text-neutral-500">
                  Manual actions
                </h2>
                <ActionButton
                  label="Send Welcome Email"
                  hint="Re-sends the confirmation email + .ics invite"
                  busy={sending === "welcome_email"}
                  onClick={() => trigger("welcome_email", "Welcome email")}
                />
                <ActionButton
                  label="Send Welcome WhatsApp"
                  hint="Fires the pss_welcome template"
                  busy={sending === "welcome_whatsapp"}
                  onClick={() =>
                    trigger("welcome_whatsapp", "Welcome WhatsApp")
                  }
                />
                <ActionButton
                  label="Send Reminder Now"
                  hint="Fires the pss_reminder template immediately"
                  busy={sending === "reminder_whatsapp"}
                  onClick={() =>
                    trigger("reminder_whatsapp", "Reminder WhatsApp")
                  }
                />
              </div>
            </section>

            <section className="bg-pss-panel border border-pss-border rounded-xl p-6 space-y-3">
              <h2 className="text-sm uppercase tracking-widest text-neutral-500">
                Notes
              </h2>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                onBlur={() => {
                  if (notes !== (lead.notes || "")) {
                    patch({ notes: notes || null });
                  }
                }}
                rows={4}
                placeholder="Internal notes — visible only to admins."
                className="w-full bg-black border border-pss-border rounded-md px-3 py-2 text-sm focus:border-pss-red outline-none"
              />
            </section>

            <section className="bg-pss-panel border border-pss-border rounded-xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm uppercase tracking-widest text-neutral-500">
                  Activity log
                </h2>
                <button
                  onClick={load}
                  className="text-xs text-neutral-400 hover:text-white"
                >
                  ↻ Refresh
                </button>
              </div>
              {activities.length === 0 ? (
                <div className="text-sm text-neutral-500">
                  No activity yet.
                </div>
              ) : (
                <ul className="divide-y divide-pss-border">
                  {activities.map((a) => (
                    <li
                      key={a.id}
                      className="py-3 flex items-start gap-3 text-sm"
                    >
                      <div
                        className={`mt-1 w-2 h-2 rounded-full ${
                          a.success ? "bg-emerald-500" : "bg-red-500"
                        }`}
                      />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-black border border-pss-border text-neutral-400">
                            {a.channel}
                          </span>
                          <span className="font-medium">{a.kind}</span>
                          {!a.success && (
                            <span className="text-xs text-red-400">
                              failed
                            </span>
                          )}
                        </div>
                        {a.detail && (
                          <div className="text-xs text-neutral-500 mt-1">
                            {a.detail}
                          </div>
                        )}
                      </div>
                      <div className="text-xs text-neutral-500 whitespace-nowrap">
                        {new Date(a.created_at).toLocaleString()}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}

function Row({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-pss-border/40 pb-2 last:border-b-0 last:pb-0">
      <div className="text-xs uppercase tracking-wider text-neutral-500">
        {label}
      </div>
      <div className="text-sm text-right">{value}</div>
    </div>
  );
}

function ActionButton({
  label,
  hint,
  onClick,
  busy,
}: {
  label: string;
  hint: string;
  onClick: () => void;
  busy: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="w-full text-left bg-black border border-pss-border hover:border-pss-red rounded-lg px-4 py-3 transition disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <div className="font-medium">{busy ? "Sending…" : label}</div>
      <div className="text-xs text-neutral-500 mt-0.5">{hint}</div>
    </button>
  );
}
