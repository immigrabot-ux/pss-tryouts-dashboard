export const REPORT_SEASON = "fall-2026";
export const REPORT_SEASON_LABEL = "Fall 2026";
export const APP_URL = process.env.APP_URL || "https://pss-tryouts-system.vercel.app";
export const TEAMS = ["7U", "8U", "9U", "10U", "13U"] as const;

export const SKILLS = [
  { key: "ball_control", label: "Ball control", hint: "First touch, dribbling, keeping the ball close" },
  { key: "passing", label: "Passing", hint: "Accuracy, weight of pass, seeing teammates" },
  { key: "shooting", label: "Shooting", hint: "Technique, power and placement" },
  { key: "defending", label: "Defending", hint: "Pressure, tackling, tracking back" },
  { key: "game_iq", label: "Game IQ", hint: "Positioning, decisions, reading the game" },
  { key: "effort", label: "Effort & attitude", hint: "Work rate, coachability, being a good teammate" },
] as const;

export type SkillKey = (typeof SKILLS)[number]["key"];

export const RATING_WORDS: Record<number, string> = {
  1: "Just starting",
  2: "Developing",
  3: "Solid",
  4: "Strong",
  5: "Excellent",
};

export type PlayerReport = {
  id: string;
  season: string;
  player_first: string | null;
  player_last: string | null;
  player_dob: string | null;
  parent_first: string | null;
  parent_email: string | null;
  parent2_email: string | null;
  team: string | null;
  ball_control: number | null;
  passing: number | null;
  shooting: number | null;
  defending: number | null;
  game_iq: number | null;
  effort: number | null;
  strength: string | null;
  work_on: string | null;
  coach_note: string | null;
  rated_by: string | null;
  rated_at: string | null;
  skip: boolean;
  report_token: string;
  sent_at: string | null;
  viewed_at: string | null;
};

export function ageFromDob(dob: string | null): number | null {
  if (!dob) return null;
  const d = new Date(dob + "T00:00:00");
  if (isNaN(d.getTime())) return null;
  const n = new Date();
  let a = n.getFullYear() - d.getFullYear();
  if (n.getMonth() < d.getMonth() || (n.getMonth() === d.getMonth() && n.getDate() < d.getDate())) a--;
  return a >= 3 && a <= 19 ? a : null;
}

export function isComplete(r: Pick<PlayerReport, SkillKey | "strength" | "work_on">): boolean {
  return SKILLS.every((s) => typeof r[s.key] === "number") && !!(r.strength || "").trim() && !!(r.work_on || "").trim();
}

export function clampRating(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const r = Math.round(n);
  return r >= 1 && r <= 5 ? r : null;
}
