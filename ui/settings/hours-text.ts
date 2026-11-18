// SA-2: working hours as people type them. "9:00 to 13:00", "9:00-13:00" and "09:00–13:00" all read as the app's one
// format, "09:00-13:00"; anything else is refused with an example. Pure, so it is tested on its own.

const ONE = /^(\d{1,2}):([0-5]\d)\s*(?:-|–|—|to)\s*(\d{1,2}):([0-5]\d)$/i;
const pad = (h: string) => h.padStart(2, "0");

/** One span in the app's format, or null when it isn't one (an end before its start, an hour past 24). */
export function readSpan(text: string): { start: string; end: string } | null {
  const m = ONE.exec(text.trim());
  if (!m) return null;
  const [, h1, m1, h2, m2] = m as unknown as [string, string, string, string, string];
  if (Number(h1) > 23 || Number(h2) > 24 || (Number(h2) === 24 && m2 !== "00")) return null;
  const start = `${pad(h1)}:${m1}`;
  const end = `${pad(h2)}:${m2}`;
  return end >= start ? { start, end } : null;
}

export const DAY_EXAMPLE = "Like 9:00-17:00 or 9:00 to 17:00. Two spans take a comma: 9:00-12:00, 13:00-17:00";
export const LUNCH_EXAMPLE = "Like 12:00-12:30. Empty splits the day in the middle";
export const ZERO_LUNCH = "A lunch needs a length, like 12:30-13:00. Empty splits the day in the middle";

/** A day's spans ("" is a day off), or the problem with an example. */
export function readDay(text: string): { value: string } | { problem: string } {
  const parts = text.split(/[,;]/).map((x) => x.trim()).filter(Boolean);
  const spans = parts.map(readSpan);
  if (spans.some((s) => !s)) return { problem: DAY_EXAMPLE };
  return { value: spans.map((s) => `${s!.start}-${s!.end}`).join(", ") };
}

/** Lunch ("" is none), or the problem. A zero-length lunch is refused unless it is the one already saved. */
export function readLunch(text: string, saved: string): { value: string } | { problem: string } {
  if (!text.trim()) return { value: "" };
  const s = readSpan(text);
  if (!s) return { problem: LUNCH_EXAMPLE };
  const value = `${s.start}-${s.end}`;
  if (s.start === s.end && value !== saved) return { problem: ZERO_LUNCH };
  return { value };
}
