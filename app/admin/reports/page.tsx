"use client";

import { useEffect, useState, useCallback } from "react";
import { TEAMS, isComplete, ageFromDob, type PlayerReport } from "@/lib/reports";

const LS_KEY = "pss-admin-password";
type Team = { team: string; coach_name: string; coach_token: string; link: string };

export default function ReportsAdmin() {
  const [pw, setPw] = useState("");
  const [pwInput, setPwInput] = useState("");
  const [teams, setTeams] = useState<Team[]>([]);
  const [players, setPlayers] = useState<PlayerReport[]>([]);
  const [appUrl, setAppUrl] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [testTo, setTestTo] = useState("info@peacesoccerschool.com");
  const [busy, setBusy] = useState(false);

  useEffect(() => { try { const s = localStorage.getItem(LS_KEY); if (s) setPw(s); } catch {} }, []);

  const load = useCallback(async (p: string) => {
    const r = await fetch("/api/reports/admin", { headers: { "x-admin-password": p }, cache: "no-store" });
    if (r.status === 401) { setPw(""); setErr("Wrong password"); return; }
    const j = await r.json();
    if (!r.ok) { setErr(j.error || "Error"); return; }
    setErr(null); setTeams(j.teams); setPlayers(j.players); setAppUrl(j.appUrl);
  }, []);
  useEffect(() => { if (pw) load(pw); }, [pw, load]);

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    const r = await fetch("/api/reports/admin", { method: "POST", headers: { "Content-Type": "application/json", "x-admin-password": pw }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok || j.ok === false) { setNote(`Error: ${j.error || r.status}`); return j; }
    await load(pw);
    return j;
  }

  if (!pw) return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-6">
      <div className="max-w-sm mx-auto mt-20 space-y-3">
        <h1 className="text-xl font-bold">Player reports · admin</h1>
        <input type="password" className="w-full rounded bg-slate-800 p-3" placeholder="Admin password" value={pwInput} onChange={(e) => setPwInput(e.target.value)} />
        <button className="w-full rounded bg-blue-600 p-3 font-bold" onClick={() => { try { localStorage.setItem(LS_KEY, pwInput); } catch {} setPw(pwInput); }}>Open</button>
        {err && <p className="text-red-400">{err}</p>}
      </div>
    </main>
  );

  const active = players.filter((p) => !p.skip);
  const unassigned = active.filter((p) => !p.team);
  const noEmail = active.filter((p) => !p.parent_email);
  const ready = active.filter((p) => p.team && isComplete(p) && !p.sent_at && p.parent_email);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Fall 2026 player reports</h1>
            <p className="text-slate-400 text-sm">{active.length} players · {active.filter((p) => isComplete(p)).length} rated · {active.filter((p) => p.sent_at).length} sent · {active.filter((p) => p.viewed_at).length} opened by parents</p>
          </div>
          <a href="/admin" className="text-sm text-blue-300 underline">← Leads dashboard</a>
        </div>
        {note && <div className="rounded bg-slate-800 p-3 text-sm">{note}</div>}
        {noEmail.length > 0 && <div className="rounded border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">{noEmail.length} player(s) have no parent email, so their report cannot be sent: {noEmail.map((p) => `${p.player_first} ${p.player_last}`).join(", ")}. Type the email in their row below.</div>}
        {unassigned.length > 0 && <div className="rounded border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">{unassigned.length} player(s) have no team. Pick one below so their coach can rate them.</div>}

        <section className="grid md:grid-cols-5 gap-3">
          {teams.sort((a, b) => TEAMS.indexOf(a.team as never) - TEAMS.indexOf(b.team as never)).map((t) => {
            const tp = active.filter((p) => p.team === t.team);
            const d = tp.filter((p) => isComplete(p)).length;
            return (
              <div key={t.team} className="rounded-lg bg-slate-900 border border-slate-800 p-3 space-y-2">
                <div className="font-bold">{t.team}</div>
                <div className="text-xs text-slate-400">{t.coach_name}</div>
                <div className="text-sm">{d}/{tp.length} rated</div>
                <button className="w-full text-xs rounded bg-slate-700 py-2" onClick={() => { navigator.clipboard?.writeText(t.link); setNote(`Copied ${t.team} coach link. Text it to ${t.coach_name}.`); }}>Copy coach link</button>
                <a className="block text-center text-xs rounded bg-slate-800 py-2" href={t.link} target="_blank" rel="noreferrer">Open</a>
              </div>
            );
          })}
        </section>

        <section className="rounded-lg bg-slate-900 border border-slate-800 p-4 space-y-3">
          <div className="font-bold">Send to parents</div>
          <p className="text-sm text-slate-400">Only fully rated, unsent reports go out. Each family gets one email, once. {ready.length} ready right now.</p>
          <div className="flex flex-wrap gap-2 items-center">
            <input className="rounded bg-slate-800 p-2 text-sm w-64" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
            <span className="text-xs text-slate-400">← test emails go here, never to parents</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {TEAMS.map((tm) => {
              const n = ready.filter((p) => p.team === tm).length;
              return <button key={tm} disabled={busy || !n} className="rounded bg-green-700 disabled:bg-slate-700 px-3 py-2 text-sm font-bold"
                onClick={async () => { if (prompt(`Email ${n} ${tm} report(s) to parents now? Type SEND to confirm.`) !== "SEND") return; const j = await act({ action: "send", teams: [tm], confirm: "SEND" }); if (j?.ok) setNote(`Sent ${j.sent}. ${j.failed?.length ? "Failed: " + j.failed.join("; ") : ""}${j.remaining ? ` ${j.remaining} left, click again.` : ""}`); }}>
                Send {tm} ({n})</button>;
            })}
          </div>
        </section>

        <section className="overflow-x-auto rounded-lg border border-slate-800">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-slate-400"><tr>
              <th className="text-left p-2">Player</th><th className="p-2">Age</th><th className="p-2">Team</th><th className="p-2">Status</th><th className="text-left p-2">Parent email</th><th className="p-2">Actions</th>
            </tr></thead>
            <tbody>
              {players.map((p) => (
                <tr key={p.id} className={`border-t border-slate-800 ${p.skip ? "opacity-40" : ""}`}>
                  <td className="p-2 font-semibold">{p.player_first} {p.player_last}</td>
                  <td className="p-2 text-center">{ageFromDob(p.player_dob) ?? "?"}</td>
                  <td className="p-2 text-center">
                    <select className="bg-slate-800 rounded p-1" value={p.team || ""} disabled={!!p.sent_at} onChange={(e) => act({ action: "assign", id: p.id, team: e.target.value })}>
                      <option value="">—</option>{TEAMS.map((t) => <option key={t}>{t}</option>)}
                    </select>
                  </td>
                  <td className="p-2 text-center">{p.viewed_at ? "Opened" : p.sent_at ? "Sent" : isComplete(p) ? "Ready" : p.rated_at ? "In progress" : "Not rated"}</td>
                  <td className="p-2 text-slate-400">
                    {p.sent_at ? p.parent_email : (
                      <input className={`w-56 rounded bg-slate-800 p-1 ${p.parent_email ? "" : "border border-red-500"}`} placeholder="add parent email" defaultValue={p.parent_email || ""}
                        onBlur={(e) => { const v = e.target.value.trim(); if (v !== (p.parent_email || "")) act({ action: "email", id: p.id, email: v }).then((j) => { if (j?.ok) setNote(`Saved email for ${p.player_first}.`); }); }} />
                    )}
                  </td>
                  <td className="p-2 whitespace-nowrap space-x-2 text-center">
                    {p.rated_at && <a className="underline text-blue-300" href={`${appUrl}/report/${p.report_token}?preview=1`} target="_blank" rel="noreferrer">Preview</a>}
                    {isComplete(p) && <button className="underline text-blue-300" disabled={busy} onClick={async () => { const j = await act({ action: "test", id: p.id, to: testTo }); if (j?.ok) setNote(`Test email for ${p.player_first} sent to ${testTo}.`); }}>Test email</button>}
                    {!p.sent_at && <button className="underline text-slate-400" onClick={() => act({ action: "skip", id: p.id, skip: !p.skip })}>{p.skip ? "Include" : "Skip"}</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );
}
