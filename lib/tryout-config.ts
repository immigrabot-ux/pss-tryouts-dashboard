/**
 * Single source of truth for the tryout schedule (Spring 2027 tryouts: Feb 13, Teamworks Seekonk).
 *
 * Update only this file when dates/times change — everything else (homepage,
 * email, .ics, AI prompt, reminders) reads from here.
 */

export type TryoutDay = {
  label: string;
  date: string; // YYYY-MM-DD, ET-anchored
  startHour: number; // 24h
  startMinute: number;
  endHour: number;
  endMinute: number;
  displayDate: string; // human-readable
  displayTime: string; // human-readable
};

export const TRYOUT_DAYS: TryoutDay[] = [
  {
    label: "Spring 2027 tryouts",
    date: "2027-02-13",
    startHour: 19,
    startMinute: 0,
    endHour: 21,
    endMinute: 0,
    displayDate: "Saturday, February 13, 2027",
    displayTime: "7:00 PM – 9:00 PM",
  },
];

export const TRYOUT_LOCATION =
  "Teamworks, 1314 Fall River Ave, Seekonk, MA";

/** First tryout day — used as the canonical "tryout_date" anchor for reminders. */
export const TRYOUT_ANCHOR_DATE = TRYOUT_DAYS[0].date;

/** Short summary for one-line contexts (e.g. WhatsApp blasts). */
export const TRYOUT_SHORT_SUMMARY = TRYOUT_DAYS.map(
  (d) => `${d.label}: ${d.displayDate.replace(/, \d{4}$/, "")} ${d.displayTime}`
).join(" · ");

/**
 * Given a parent's day selection ("day1" | "day2" | "both" | null),
 * return only the days they're attending. Defaults to BOTH if unspecified.
 */
export function daysForSelection(
  selection: string | null | undefined
): TryoutDay[] {
  const sel = (selection || "both").toLowerCase();
  if (sel === "day1") return [TRYOUT_DAYS[0]];
  if (sel === "day2") return [TRYOUT_DAYS[1] ?? TRYOUT_DAYS[0]];
  return TRYOUT_DAYS;
}

export function selectionLabel(
  selection: string | null | undefined
): string {
  const sel = (selection || "both").toLowerCase();
  if (TRYOUT_DAYS.length === 1) return TRYOUT_DAYS[0].displayDate;
  if (sel === "day1") return "Day 1 only";
  if (sel === "day2") return "Day 2 only";
  return "Both days";
}

/** Display time used in WhatsApp reminders. */
export const TRYOUT_TIME_LABEL = "7:00 PM";
