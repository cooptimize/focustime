// Target dates on Plan the week's rows and in the detail panel, and the other people who own a feature's stories
// (D461, D460). Pure: words and tones from DevOps target dates already read, no I/O.
import type { IsoDate } from "../week/types.ts";

const plain = (d: IsoDate) => Temporal.PlainDate.from(d);
const weekdayOf = (d: IsoDate) => plain(d).toLocaleString("en-US", { weekday: "short" });
const monthDay = (d: IsoDate) => plain(d).toLocaleString("en-US", { month: "short", day: "numeric" });
/** Friday of the week that starts on the given Monday (the catch-up day is part of the week shown). */
const weekEnd = (weekStart: IsoDate) => plain(weekStart).add({ days: 4 }).toString();

/** A date in the panel's words: its weekday when it falls in the week shown ("Fri"), else "Nov 12". */
export function dateInWeekWords(date: IsoDate, weekStart: IsoDate): string {
  return date >= weekStart && date <= weekEnd(weekStart) ? weekdayOf(date) : monthDay(date);
}

export type RowDue = { text: string; /** Amber: past, or before the work is planned to happen. Never red. */ late: boolean; title: string };

/**
 * A row's target date, only when it matters for the week being planned: in that week ("due Thu") or already past
 * ("was due Nov 2"). Amber when past, when it falls before the item's pinned block, or before its client's last block
 * that week (the work may land after it). A target date counts as the end of its day. Null otherwise.
 */
export function rowDue(target: IsoDate | null | undefined, ctx: { weekStart: IsoDate; today: IsoDate; pinned?: readonly IsoDate[]; lastBlock?: IsoDate | null }): RowDue | null {
  if (!target) return null;
  if (target < ctx.today) return { text: `was due ${monthDay(target)}`, late: true, title: `Target date ${monthDay(target)} has passed` };
  if (target < ctx.weekStart || target > weekEnd(ctx.weekStart)) return null;
  const firstPin = [...(ctx.pinned ?? [])].sort()[0] ?? null;
  const beforePin = firstPin !== null && target < firstPin;
  const beforeLast = !firstPin && !!ctx.lastBlock && target < ctx.lastBlock;
  const why = beforePin ? `, before its pinned block (${weekdayOf(firstPin)})` : beforeLast ? `, before ${weekdayOf(ctx.lastBlock!)}, its client's last block this week` : "";
  return { text: `due ${weekdayOf(target)}`, late: beforePin || beforeLast, title: `Target date ${weekdayOf(target)}, ${monthDay(target)}${why}` };
}

export type Owner = { name: string; email: string | null };

/** The distinct other people who own open stories of a feature not on the list (the "N assigned to others" line), in order. */
export function otherOwners(children: readonly { level: string; open: boolean; id: number; mine: boolean; assignedTo: string | null; assignedToEmail?: string | null }[], listed: ReadonlySet<number>): Owner[] {
  const out: Owner[] = [];
  const seen = new Set<string>();
  for (const c of children) {
    if (c.level !== "story" || !c.open || listed.has(c.id) || c.mine || c.assignedTo == null) continue;
    const key = (c.assignedToEmail ?? c.assignedTo).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name: c.assignedTo, email: c.assignedToEmail ?? null });
  }
  return out;
}

/** Up to three avatars, then "+N" for the rest; the names for the tooltip. */
export function avatarStack(owners: readonly Owner[], max = 3): { shown: Owner[]; more: number; names: string } {
  return { shown: owners.slice(0, max), more: Math.max(0, owners.length - max), names: owners.map((o) => o.name).join(", ") };
}
