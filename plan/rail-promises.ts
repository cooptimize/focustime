// CV-3 (Q-CV2-6): my promises on Week's Board rail. One with a time on this week's rails sits at its time (amber
// with "was due …" once past). One overdue from an earlier day, or overdue with no time, is drawn once, amber, at
// "now" on today's block: the block under way, else today's next one, else today's last one (clamped into it).
// Never red. Pure.

export type RailSpan = { key: string; start: string; end: string };
export type RailPromise = { dueAt: string | null; dueDate: string; overdue: boolean };
export type RailMark<P> = { p: P; at: string; carried: boolean };

const ms = (iso: string) => Date.parse(iso.replace(/\[.*\]$/, ""));

/** Whether this promise is carried to today's block (overdue from an earlier day, or overdue with no time). */
export const carried = (p: RailPromise, today: string) => p.overdue && (!p.dueAt || p.dueDate < today);

/** Today's home rail for carried promises, among today's rails (in time order or not). */
export function homeRail(rails: readonly RailSpan[], now: string): RailSpan | null {
  const sorted = [...rails].sort((a, b) => ms(a.start) - ms(b.start));
  const t = ms(now);
  return sorted.find((r) => t >= ms(r.start) && t < ms(r.end)) ?? sorted.find((r) => ms(r.start) > t) ?? sorted.at(-1) ?? null;
}

/** How far apart carried marks stack, as a share of the rail's span (IB-1 slice 4: their labels never overlap). */
export const CARRIED_STEP = 0.07;

/**
 * The marks on one rail: its own timed promises at their time, and the carried ones when it is today's home rail. IB-1
 * slice 4: several carried ones (late promises I added are carried too now) stack downward from "now", a step apart,
 * moved up together when the stack would run past the rail's end, never above its start.
 */
export function railMarks<P extends RailPromise>(ps: readonly P[], rail: RailSpan, o: { today: string; now: string; home: RailSpan | null }): RailMark<P>[] {
  const out: RailMark<P>[] = [];
  const start = ms(rail.start);
  const last = ms(rail.end) - 60_000;
  const carry = o.home?.key === rail.key ? ps.filter((p) => carried(p, o.today)) : [];
  const step = (ms(rail.end) - start) * CARRIED_STEP;
  const top = Math.max(start, Math.min(Math.min(Math.max(ms(o.now), start), last), last - (carry.length - 1) * step));
  carry.forEach((p, i) => out.push({ p, at: new Date(Math.min(top + i * step, last)).toISOString(), carried: true }));
  for (const p of ps) if (!carried(p, o.today) && p.dueAt && ms(p.dueAt) >= start && ms(p.dueAt) < ms(rail.end)) out.push({ p, at: p.dueAt, carried: false });
  return out;
}

/** UI-9: one Week card's rail with the clients booked on it (its focus blocks, the first one first). */
export type CardRail = RailSpan & { date: string; clients: readonly string[] };
export type ClientPromise = RailPromise & { clientKey: string | null };

/**
 * UI-9: the late promises each card counts when it draws no rail to mark them, by the card's rail key. The same
 * placement as `railMarks` (a late one with a time today on the rail its time falls in; one carried from an earlier
 * day, or with no time, on today's block under way, else the next, else the last), narrowed to the card's own clients:
 * a promise counts only on a card booked for its client, and a carried one goes to that client's block today. One with
 * no client, or whose client has no block there, counts on no card (Today's strip and the Inbox still have it).
 */
export function lateOnCards<P extends ClientPromise>(ps: readonly P[], rails: readonly CardRail[], o: { today: string; now: string }): Map<string, P[]> {
  const out = new Map<string, P[]>();
  const add = (k: string, p: P) => out.set(k, [...(out.get(k) ?? []), p]);
  for (const p of ps) {
    if (!p.overdue || !p.clientKey) continue;
    const mine = rails.filter((r) => r.clients.includes(p.clientKey!));
    if (carried(p, o.today)) {
      const home = homeRail(mine.filter((r) => r.date === o.today), o.now);
      if (home) add(home.key, p);
    } else if (p.dueAt) {
      const t = ms(p.dueAt);
      for (const r of mine) if (t >= ms(r.start) && t < ms(r.end)) add(r.key, p);
    }
  }
  return out;
}
