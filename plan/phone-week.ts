// PH-2: what the phone's Week and a day at a glance say, pure. The words live here, in one place
// (docs/design/wording.md lists them); everything they count or judge comes from the rules the computer's cards use:
// the block's status (plan/blockstatus.ts), done and not done (plan/day-fold.ts), the meetings line (ui/BlockCard.tsx's
// meetingsLine) and the due badge's words (ui/inbox/model.ts's dueWords). No new rule for risk, counts or free time.

const ms = (iso: string) => Date.parse(iso.replace(/\[.*\]$/, ""));

/** What a tile is given: what a block card is given, in the few facts its line needs. */
export type TileFacts = {
  start: string;
  end: string;
  /** The clock. */
  now: string;
  /** The block is on a day before today (the card is then quieter: no status). */
  past: boolean;
  /** The card's status (blockStatus): at risk with its short reason, or nothing. */
  atRisk: { short: string | null } | null;
  /** The block's to-dos (planned or done; dropped and moved ones aren't the block's any more). */
  done: number;
  notDone: number;
};

/** Which line a tile says, in the order they are tried. */
export type TileState = "now" | "at_risk" | "not_done" | "counts" | "nothing";

/** The second line's states, in the order the first that applies wins (the block under way also says the next one). */
export const TILE_ORDER: readonly TileState[] = ["now", "at_risk", "not_done", "counts", "nothing"];

export const underWay = (f: Pick<TileFacts, "start" | "end" | "now">) => ms(f.start) <= ms(f.now) && ms(f.now) < ms(f.end);
const ended = (f: Pick<TileFacts, "end" | "now">) => ms(f.end) <= ms(f.now);

/** The line after "Now", or the whole line: at risk, ended with to-dos not done, the counts, nothing planned. */
function rest(f: TileFacts): { state: Exclude<TileState, "now">; text: string } {
  if (f.atRisk && !f.past) return { state: "at_risk", text: WEEK_TEXT.atRisk(f.atRisk.short) };
  const total = f.done + f.notDone;
  if (ended(f) && f.notDone > 0) return { state: "not_done", text: WEEK_TEXT.ended(f.done, f.notDone) };
  if (total > 0) return { state: "counts", text: ended(f) ? WEEK_TEXT.ended(f.done, 0) : WEEK_TEXT.counts(f.done, total) };
  return { state: "nothing", text: WEEK_TEXT.nothingPlanned };
}

/**
 * A tile's second line, the first of these that applies: the block is under way ("Now", then what follows); it is at
 * risk ("At risk · Dentist 12:00"); it has ended with to-dos not done ("1 done · 2 not done"); how many to-dos are
 * to do or done ("3 to-dos", "1 of 3 to-dos done", "3 done" once ended); nothing planned. A day before today never
 * says At risk, as its card doesn't.
 */
export function tileLine(f: TileFacts): { state: TileState; text: string } {
  const r = rest(f);
  if (!f.past && underWay(f)) return { state: "now", text: `${WEEK_TEXT.now} · ${r.text}` };
  return r;
}

/** One thing on an evening or a weekend day: its title and, when it has one, when it starts. */
export type Thing = { title: string; start: string | null };

/** "7:00 Deploy" for one, "7:00 Deploy · 2 more" for several; the first in time order (things with no time last). */
export function firstThing(things: readonly Thing[], clock: (iso: string) => string): string | null {
  if (!things.length) return null;
  const sorted = [...things].sort((a, b) => (a.start && b.start ? ms(a.start) - ms(b.start) : a.start ? -1 : b.start ? 1 : 0));
  const t = sorted[0]!;
  const one = t.start ? `${clock(t.start)} ${t.title}` : t.title;
  return sorted.length > 1 ? `${one} · ${WEEK_TEXT.more(sorted.length - 1)}` : one;
}

/** A day row's promise line: the due badge's own words for that day, with how many when more than one. */
export const promisesLine = (n: number, badge: string): string | null => (n <= 0 ? null : n === 1 ? badge : `${badge} · ${n}`);

/** Every word the phone's Week and a day at a glance say (PH-2), beside PHONE_TEXT (plan/phone-now.ts). */
export const WEEK_TEXT = {
  now: "Now",
  atRisk: (short: string | null) => (short ? `At risk · ${short}` : "At risk"),
  /** Day-fold's words (plan/day-fold.ts foldWords): "2 done · 1 not done", "3 done". */
  ended: (done: number, notDone: number) => [done ? `${done} done` : null, notDone ? `${notDone} not done` : null].filter(Boolean).join(" · "),
  /** NowStrip's words: "3 to-dos", "1 of 3 to-dos done". */
  counts: (done: number, total: number) => (done ? `${done} of ${total} ${total === 1 ? "to-do" : "to-dos"} done` : `${total} ${total === 1 ? "to-do" : "to-dos"}`),
  nothingPlanned: "Nothing planned",
  more: (n: number) => `${n} more`,
  open: "Open",
  catchUp: "Catch-up",
  pto: "PTO",
  off: "You're off",
  holiday: "Holiday",
  evening: "Evening",
  weekend: "Weekend",
  noHours: "No working hours",
  previousWeek: "Previous week",
  nextWeek: "Next week",
  thisWeek: "This week",
  weekLabel: (dates: string) => `Week of ${dates}`,
  dayLabel: "Days of the week. Tap a day or a block to open it; swipe sideways to change the week.",
  openDay: (day: string) => `Open ${day}`,
  today: "Today",
  // A day at a glance.
  previousDay: "Previous day",
  nextDay: "Next day",
  backToWeek: "Week",
  backToWeekLabel: "Back to Week",
  nothingPlannedDay: (day: string) => `Nothing planned ${day}.`,
  openBlock: (name: string, half: string) => `${name}, ${half}: open the block`,
  meetingsOf: (name: string) => `Meetings, ${name}`,
  todosOf: (name: string) => `To-dos, ${name}`,
} as const;
