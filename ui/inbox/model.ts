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
