/**
 * Single source of truth for the Fall 2026 tryout schedule.
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
    label: "Day 1",
    date: "2026-07-25",
    startHour: 10,
    startMinute: 0,
    endHour: 12,
    endMinute: 0,
    displayDate: "Saturday, July 25, 2026",
    displayTime: "10:00 AM – 12:00 PM",
  },
  {
    label: "Day 2",
    date: "2026-07-26",
    startHour: 16,
    startMinute: 0,
    endHour: 18,
    endMinute: 0,
    displayDate: "Sunday, July 26, 2026",
    displayTime: "4:00 PM – 6:00 PM",
  },
];

export const TRYOUT_LOCATION =
  process.env.TRYOUT_LOCATION || "Bliss Fields, Rehoboth MA";

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
  if (sel === "day2") return [TRYOUT_DAYS[1]];
  return TRYOUT_DAYS;
}

export function selectionLabel(
  selection: string | null | undefined
): string {
  const sel = (selection || "both").toLowerCase();
  if (sel === "day1") return "Day 1 only";
  if (sel === "day2") return "Day 2 only";
  return "Both days";
}
