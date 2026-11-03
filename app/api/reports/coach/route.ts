import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { REPORT_SEASON, SKILLS, ageFromDob, clampRating } from "@/lib/reports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function teamForToken(token: string | null) {
  if (!token || token.length < 16) return null;
  const sb = getSupabaseAdmin();
  const { data } = await sb.from("report_teams").select("season, team, coach_name").eq("coach_token", token).eq("season", REPORT_SEASON).maybeSingle();
  return data as { season: string; team: string; coach_name: string } | null;
}

const FIELDS = "id, player_first, player_last, player_dob, team, ball_control, passing, shooting, defending, game_iq, effort, strength, work_on, coach_note, rated_at, sent_at, skip";

export async function GET(req: NextRequest) {
  const team = await teamForToken(req.nextUrl.searchParams.get("t"));
  if (!team) return NextResponse.json({ error: "This link isn't valid." }, { status: 404 });
  const sb = getSupabaseAdmin();
  const { data, error } = await sb.from("player_reports").select(FIELDS).eq("season", REPORT_SEASON).eq("team", team.team).eq("skip", false).order("player_first");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const players = (data || []).map((p) => ({ ...p, age: ageFromDob(p.player_dob as string | null), player_dob: undefined }));
  return NextResponse.json({ team: team.team, coach: team.coach_name, players });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const team = await teamForToken(body.t);
  if (!team) return NextResponse.json({ error: "This link isn't valid." }, { status: 404 });
  if (typeof body.id !== "string") return NextResponse.json({ error: "missing player" }, { status: 400 });
  const sb = getSupabaseAdmin();
  const { data: row } = await sb.from("player_reports").select("id, team, sent_at").eq("id", body.id).eq("season", REPORT_SEASON).maybeSingle();
  if (!row || row.team !== team.team) return NextResponse.json({ error: "That player isn't on your team." }, { status: 403 });
  if (row.sent_at) return NextResponse.json({ error: "This report was already sent to the parents, so it's locked." }, { status: 409 });

  const update: Record<string, unknown> = {};
  for (const s of SKILLS) if (s.key in body) update[s.key] = clampRating(body[s.key]);
  for (const k of ["strength", "work_on", "coach_note"]) if (k in body) update[k] = String(body[k] ?? "").slice(0, 600).trim() || null;
  update.rated_by = team.coach_name;
  update.rated_at = new Date().toISOString();
  const { error } = await sb.from("player_reports").update(update).eq("id", body.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, rated_at: update.rated_at });
}
