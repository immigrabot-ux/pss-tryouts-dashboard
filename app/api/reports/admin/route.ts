import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { isAdminPassword, unauthorized } from "@/lib/auth";
import { REPORT_SEASON, TEAMS, APP_URL, isComplete, type PlayerReport } from "@/lib/reports";
import { sendPlayerReport } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!isAdminPassword(req.headers.get("x-admin-password"))) return unauthorized();
  const sb = getSupabaseAdmin();
  const [{ data: teams }, { data: players, error }] = await Promise.all([
    sb.from("report_teams").select("team, coach_name, coach_token").eq("season", REPORT_SEASON),
    sb.from("player_reports").select("*").eq("season", REPORT_SEASON).order("player_first"),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    appUrl: APP_URL,
    teams: (teams || []).map((t) => ({ ...t, link: `${APP_URL}/coach/${t.coach_token}` })),
    players,
  });
}

export async function POST(req: NextRequest) {
  if (!isAdminPassword(req.headers.get("x-admin-password"))) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const sb = getSupabaseAdmin();

  if (body.action === "assign") {
    const team = body.team === "" || body.team == null ? null : String(body.team);
    if (team && !(TEAMS as readonly string[]).includes(team)) return NextResponse.json({ error: "bad team" }, { status: 400 });
    const { error } = await sb.from("player_reports").update({ team }).eq("id", body.id).eq("season", REPORT_SEASON);
    return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ ok: true });
  }

  if (body.action === "email") {
    const e = String(body.email || "").trim().toLowerCase();
    if (e && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return NextResponse.json({ error: "That email doesn't look right" }, { status: 400 });
    const { error } = await sb.from("player_reports").update({ parent_email: e || null }).eq("id", body.id).eq("season", REPORT_SEASON).is("sent_at", null);
    return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ ok: true });
  }

  if (body.action === "skip") {
    const { error } = await sb.from("player_reports").update({ skip: !!body.skip }).eq("id", body.id).eq("season", REPORT_SEASON);
    return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ ok: true });
  }

  if (body.action === "test") {
    // Send one report to an admin address only (never the parent) so it can be checked.
    const to = String(body.to || "").trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return NextResponse.json({ error: "bad test email" }, { status: 400 });
    const { data } = await sb.from("player_reports").select("*").eq("id", body.id).maybeSingle();
    if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
    const r = await sendPlayerReport(data as PlayerReport, { overrideTo: to });
    return NextResponse.json(r);
  }

  if (body.action === "send") {
    // Sends completed, unsent, non-skipped reports for the given teams (or all). Requires confirm=SEND.
    if (body.confirm !== "SEND") return NextResponse.json({ error: "confirmation missing" }, { status: 400 });
    let q = sb.from("player_reports").select("*").eq("season", REPORT_SEASON).eq("skip", false).is("sent_at", null);
    if (Array.isArray(body.teams) && body.teams.length) q = q.in("team", body.teams);
    const { data, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const ready = ((data || []) as PlayerReport[]).filter((r) => r.team && isComplete(r) && r.parent_email);
    let sent = 0;
    const failed: string[] = [];
    for (const r of ready.slice(0, 40)) {
      // Claim first so a double-click can never email a family twice.
      const { data: claimed } = await sb.from("player_reports").update({ sent_at: new Date().toISOString() }).eq("id", r.id).is("sent_at", null).select("id");
      if (!claimed || !claimed.length) continue;
      const res = await sendPlayerReport(r);
      if (res.ok) sent++;
      else {
        failed.push(`${r.player_first} ${r.player_last}: ${res.error}`);
        await sb.from("player_reports").update({ sent_at: null }).eq("id", r.id);
      }
    }
    return NextResponse.json({ ok: true, sent, failed, remaining: Math.max(0, ready.length - 40) });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
