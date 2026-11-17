// IB-4: the slim Inbox's due words, shared by Promises and the rows that open from Day and Week.
export type Tone = "late" | "soon" | "plain" | "done";
const SHORT_DAY = (d: string) => Temporal.PlainDate.from(d).toLocaleString("en-US", { weekday: "short" });

/** "1 day late", "3 days late" (whole days since the due day). */
export function lateText(due: string, today: string): string {
  const n = Math.max(1, Temporal.PlainDate.from(due).until(Temporal.PlainDate.from(today)).days);
  return `${n} ${n === 1 ? "day" : "days"} late`;
}

/** A due day in words: Due today, Due tomorrow, Due Fri (this week), Due Nov 18. */
export function dueWords(due: string, today: string): string {
  if (due === today) return "Due today";
  const t = Temporal.PlainDate.from(today);
  if (due === t.add({ days: 1 }).toString()) return "Due tomorrow";
  if (due > today && due <= t.add({ days: 6 }).toString()) return `Due ${SHORT_DAY(due)}`;
  return `Due ${Temporal.PlainDate.from(due).toLocaleString("en-US", { month: "short", day: "numeric" })}`;
}

/**
 * UC-1: how many things need me per client, for the chips: the rows the tab's number counts (the "needs_you" view:
 * suggestions from chats, and my promises late or due today), by their client. A client with none isn't in the map.
 */
export function needCounts(items: readonly { clientKey: string | null; views: readonly string[] }[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of items) if (r.clientKey && r.views.includes("needs_you")) out.set(r.clientKey, (out.get(r.clientKey) ?? 0) + 1);
  return out;
}

/** UC-2: the "No client" chip's name. */
export const NO_CLIENT = "No client";

/**
 * UC-2: how many of the rows the tab counts have no client (a promise I added with none): the "No client" chip's
 * number, so the chips add up to the tab's. Zero: no such chip.
 */
export const needNoClient = (items: readonly { clientKey: string | null; views: readonly string[] }[]): number => items.filter((r) => !r.clientKey && r.views.includes("needs_you")).length;

/** A chip's name for a screen reader: the client, then its number when it has one ("Harbor, 2 need you"). */
export const chipName = (name: string, n: number) => (n > 0 ? `${name}, ${n} ${n === 1 ? "needs" : "need"} you` : name);

/** A chip's hover line, saying what its number counts (review 1: the number alone didn't say). Null with no number. */
export const chipHint = (name: string | null, n: number) =>
  n > 0 ? `${n} ${n === 1 ? "needs" : "need"} you${name === NO_CLIENT ? " with no client" : name ? ` in ${name}` : ""}: suggestions from chats, and promises late or due today. The same count as the Inbox tab's` : null;
