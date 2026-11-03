"use client";

import { useEffect, useState } from "react";
import { SKILLS, RATING_WORDS, isComplete, type SkillKey } from "@/lib/reports";

type P = {
  id: string; player_first: string | null; player_last: string | null; age: number | null;
  ball_control: number | null; passing: number | null; shooting: number | null; defending: number | null; game_iq: number | null; effort: number | null;
  strength: string | null; work_on: string | null; coach_note: string | null; rated_at: string | null; sent_at: string | null;
};

const NAVY = "#0b2f63";

export default function CoachPage({ params }: { params: { token: string } }) {
  const [data, setData] = useState<{ team: string; coach: string; players: P[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/reports/coach?t=${params.token}`, { cache: "no-store" })
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || "Error"); setData(j); })
      .catch((e) => setErr(e.message));
  }, [params.token]);

  if (err) return <Shell><p style={{ fontSize: 16 }}>{err}</p></Shell>;
  if (!data) return <Shell><p>Loading…</p></Shell>;
  const done = data.players.filter((p) => isComplete(p)).length;

  return (
    <Shell>
      <div style={{ fontSize: 12, letterSpacing: 2, textTransform: "uppercase", color: "#64748b", fontWeight: 700 }}>Fall 2026 player reports</div>
      <h1 style={{ fontSize: 26, fontWeight: 800, margin: "4px 0" }}>{data.team} · {data.coach}</h1>
      <p style={{ color: "#334155", lineHeight: 1.6, margin: "8px 0 4px" }}>
        Rate each player 1–5 on the 6 skills, then write one strength and one thing to work on. The note is optional but parents love it. Tap a player to open them; tap Save when done.
      </p>
      <p style={{ color: "#64748b", fontSize: 13, margin: "0 0 14px" }}>1 Just starting · 2 Developing · 3 Solid · 4 Strong · 5 Excellent, for this age group. Parents see the ratings, so keep notes encouraging and specific.</p>
      <div style={{ background: "#e2e8f0", borderRadius: 8, height: 10, overflow: "hidden" }}>
        <div style={{ width: `${data.players.length ? (done / data.players.length) * 100 : 0}%`, height: "100%", background: "#16a34a" }} />
      </div>
      <div style={{ fontSize: 14, margin: "6px 0 18px", fontWeight: 700 }}>{done} of {data.players.length} done</div>

      <div style={{ display: "grid", gap: 12 }}>
        {data.players.map((p) => (
          <PlayerCard key={p.id} token={params.token} p={p} open={open === p.id} onToggle={() => setOpen(open === p.id ? null : p.id)}
            onSaved={(np) => setData({ ...data, players: data.players.map((x) => (x.id === np.id ? np : x)) })} />
        ))}
      </div>
      {data.players.length === 0 && <p>No players are assigned to this team yet. Ask Mina to assign them.</p>}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main style={{ minHeight: "100vh", background: "#eef3fb", padding: "20px 14px 60px", fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif", color: NAVY }}>
    <div style={{ maxWidth: 640, margin: "0 auto" }}>{children}</div></main>;
}

function PlayerCard({ token, p, open, onToggle, onSaved }: { token: string; p: P; open: boolean; onToggle: () => void; onSaved: (p: P) => void }) {
  const [f, setF] = useState<P>(p);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => setF(p), [p]);
  const complete = isComplete(f);
  const locked = !!p.sent_at;

  async function save() {
    setSaving(true); setMsg(null);
    const body: Record<string, unknown> = { t: token, id: p.id, strength: f.strength, work_on: f.work_on, coach_note: f.coach_note };
    for (const s of SKILLS) body[s.key] = f[s.key];
    try {
      const r = await fetch("/api/reports/coach", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Couldn't save");
      onSaved({ ...f, rated_at: j.rated_at });
      setMsg(isComplete(f) ? "Saved ✓" : "Saved. Still missing some ratings or the strength / work-on.");
      if (isComplete(f)) setTimeout(onToggle, 600);
    } catch (e) { setMsg(e instanceof Error ? e.message : "Couldn't save"); }
    setSaving(false);
  }

  return (
    <div style={{ background: "#fff", borderRadius: 14, border: `2px solid ${complete ? "#bbf7d0" : "#e2e8f0"}` }}>
      <button onClick={onToggle} style={{ width: "100%", textAlign: "left", padding: "14px 16px", background: "none", border: 0, display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", color: NAVY }}>
        <span style={{ fontWeight: 800, fontSize: 17 }}>{p.player_first} {p.player_last}{p.age ? <span style={{ fontWeight: 500, color: "#64748b", fontSize: 14 }}> · {p.age}</span> : null}</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: locked ? "#64748b" : complete ? "#16a34a" : "#b45309" }}>{locked ? "Sent" : complete ? "Done ✓" : p.rated_at ? "In progress" : "To do"}</span>
      </button>
      {open && (
        <div style={{ padding: "0 16px 16px" }}>
          {SKILLS.map((s) => (
            <div key={s.key} style={{ margin: "10px 0 14px" }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{s.label}</div>
              <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>{s.hint}</div>
              <div style={{ display: "flex", gap: 6 }}>
                {[1, 2, 3, 4, 5].map((n) => {
                  const on = f[s.key as SkillKey] === n;
                  return (
                    <button key={n} disabled={locked} onClick={() => setF({ ...f, [s.key]: n })}
                      style={{ flex: 1, height: 44, borderRadius: 10, border: `2px solid ${on ? "#1d4ed8" : "#cbd5e1"}`, background: on ? "#1d4ed8" : "#fff", color: on ? "#fff" : NAVY, fontWeight: 800, fontSize: 17 }}>{n}</button>
                  );
                })}
              </div>
              {f[s.key as SkillKey] ? <div style={{ fontSize: 12, color: "#1d4ed8", marginTop: 4 }}>{RATING_WORDS[f[s.key as SkillKey] as number]}</div> : null}
            </div>
          ))}
          <Field label="Biggest strength *" ph="e.g. Fearless 1v1 dribbler who takes players on and never hides" v={f.strength} on={(v) => setF({ ...f, strength: v })} locked={locked} />
          <Field label="One thing to work on *" ph="e.g. Using his weaker left foot for short passes" v={f.work_on} on={(v) => setF({ ...f, work_on: v })} locked={locked} />
          <Field label="Note to the family (optional)" ph="e.g. Always first to help a teammate up. Proud of how much his confidence grew this season." v={f.coach_note} on={(v) => setF({ ...f, coach_note: v })} locked={locked} rows={3} />
          {!locked && <button onClick={save} disabled={saving} style={{ width: "100%", height: 50, borderRadius: 12, background: NAVY, color: "#fff", fontWeight: 800, fontSize: 16, border: 0 }}>{saving ? "Saving…" : "Save"}</button>}
          {msg && <div style={{ marginTop: 8, fontSize: 14, color: msg.startsWith("Saved") ? "#16a34a" : "#b91c1c" }}>{msg}</div>}
        </div>
      )}
    </div>
  );
}

function Field({ label, ph, v, on, locked, rows = 2 }: { label: string; ph: string; v: string | null; on: (v: string) => void; locked: boolean; rows?: number }) {
  return (
    <label style={{ display: "block", margin: "0 0 12px" }}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{label}</div>
      <textarea rows={rows} maxLength={600} disabled={locked} placeholder={ph} value={v || ""} onChange={(e) => on(e.target.value)}
        style={{ width: "100%", boxSizing: "border-box", border: "2px solid #cbd5e1", borderRadius: 10, padding: 10, fontSize: 16, fontFamily: "inherit", color: NAVY }} />
    </label>
  );
}
