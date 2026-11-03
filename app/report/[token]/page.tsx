import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSupabaseAdmin } from "@/lib/supabase";
import { SKILLS, RATING_WORDS, REPORT_SEASON_LABEL, ageFromDob, type PlayerReport } from "@/lib/reports";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Player Report | Peace Soccer School", robots: { index: false, follow: false } };

const NAVY = "#0b2f63";

export default async function ReportPage({ params, searchParams }: { params: { token: string }; searchParams: { preview?: string } }) {
  if (!/^[a-f0-9]{32}$/.test(params.token)) notFound();
  const sb = getSupabaseAdmin();
  const { data } = await sb.from("player_reports").select("*").eq("report_token", params.token).maybeSingle();
  const r = data as PlayerReport | null;
  if (!r) notFound();
  if (!r.viewed_at && r.sent_at && searchParams.preview !== "1") {
    await sb.from("player_reports").update({ viewed_at: new Date().toISOString() }).eq("id", r.id);
  }
  const name = `${r.player_first || ""} ${r.player_last || ""}`.trim();
  const age = ageFromDob(r.player_dob);
  const rated = SKILLS.map((s) => ({ ...s, v: r[s.key] as number | null })).filter((s) => typeof s.v === "number");
  const avg = rated.length ? rated.reduce((a, s) => a + (s.v as number), 0) / rated.length : null;

  return (
    <main style={{ minHeight: "100vh", background: "#eef3fb", padding: "24px 14px 48px", fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif", color: NAVY }}>
      <div style={{ maxWidth: 640, margin: "0 auto", background: "#fff", borderRadius: 18, overflow: "hidden", boxShadow: "0 6px 30px rgba(11,47,99,.08)" }}>
        <div style={{ background: NAVY, color: "#fff", padding: "28px 24px" }}>
          <div style={{ fontSize: 12, letterSpacing: 2, textTransform: "uppercase", color: "#bfd7f5", fontWeight: 700 }}>Peace Soccer School · {REPORT_SEASON_LABEL} Player Report</div>
          <h1 style={{ fontSize: 30, fontWeight: 800, margin: "8px 0 4px" }}>{name}</h1>
          <div style={{ color: "#dbe7f7", fontSize: 15 }}>
            {r.team ? `${r.team} team` : ""}{age ? ` · Age ${age}` : ""}{r.rated_by ? ` · ${r.rated_by}` : ""}
          </div>
        </div>

        <div style={{ padding: "24px" }}>
          <h2 style={{ fontSize: 18, fontWeight: 800, margin: "0 0 14px" }}>Skill ratings</h2>
          <div style={{ display: "grid", gap: 14 }}>
            {SKILLS.map((s) => {
              const v = r[s.key] as number | null;
              return (
                <div key={s.key}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>{s.label}</div>
                    <div style={{ fontSize: 13, color: "#475569", whiteSpace: "nowrap" }}>{v ? `${RATING_WORDS[v]} · ${v}/5` : "Not rated"}</div>
                  </div>
                  <div style={{ display: "flex", gap: 4, marginTop: 6 }} aria-label={v ? `${v} out of 5` : "not rated"}>
                    {[1, 2, 3, 4, 5].map((i) => (
                      <div key={i} style={{ flex: 1, height: 10, borderRadius: 5, background: v && i <= v ? "#1d4ed8" : "#e2e8f0" }} />
                    ))}
                  </div>
                  <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>{s.hint}</div>
                </div>
              );
            })}
          </div>
          {avg !== null && (
            <div style={{ marginTop: 18, fontSize: 14, color: "#334155" }}>
              Overall: <strong>{RATING_WORDS[Math.round(avg)]}</strong> ({avg.toFixed(1)} out of 5)
            </div>
          )}

          {r.strength && (
            <section style={{ marginTop: 24, background: "#f1f6fd", borderLeft: "4px solid #1d4ed8", borderRadius: 10, padding: "14px 16px" }}>
              <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1, textTransform: "uppercase", color: "#1d4ed8", marginBottom: 4 }}>Biggest strength</div>
              <div style={{ fontSize: 16, lineHeight: 1.6 }}>{r.strength}</div>
            </section>
          )}
          {r.work_on && (
            <section style={{ marginTop: 14, background: "#fff7ed", borderLeft: "4px solid #f59e0b", borderRadius: 10, padding: "14px 16px" }}>
              <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1, textTransform: "uppercase", color: "#b45309", marginBottom: 4 }}>Next step to work on</div>
              <div style={{ fontSize: 16, lineHeight: 1.6 }}>{r.work_on}</div>
            </section>
          )}
          {r.coach_note && (
            <section style={{ marginTop: 14, padding: "4px 2px" }}>
              <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1, textTransform: "uppercase", color: "#475569", marginBottom: 4 }}>Note from {r.rated_by || "the coach"}</div>
              <div style={{ fontSize: 16, lineHeight: 1.7, fontStyle: "italic", color: "#1e293b" }}>&ldquo;{r.coach_note}&rdquo;</div>
            </section>
          )}

          <section style={{ marginTop: 28, background: NAVY, color: "#fff", borderRadius: 14, padding: "20px" }}>
            <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 6 }}>Keep the progress going this winter</div>
            <div style={{ fontSize: 15, lineHeight: 1.6, color: "#dbe7f7", marginBottom: 14 }}>14 Saturday nights of indoor training at Teamworks Seekonk, starting Nov 21. A great time to work on the next step above.</div>
            <a href="https://www.peacesoccerschool.com/winter-indoor-soccer?utm_source=report&utm_medium=email&utm_campaign=fall2026_report" style={{ display: "inline-block", background: "#fff", color: NAVY, fontWeight: 800, padding: "12px 20px", borderRadius: 10, textDecoration: "none" }}>See Winter training</a>
          </section>

          <p style={{ marginTop: 22, fontSize: 13, color: "#64748b", lineHeight: 1.6 }}>
            Ratings describe where {r.player_first || "your player"} is today compared with what we coach at this age group, not compared with teammates. Questions? Email info@peacesoccerschool.com or call (774) 250-2370.
          </p>
        </div>
      </div>
    </main>
  );
}
