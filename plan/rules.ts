// Plan the day rules: capacity, fit, carry-over, block client and story level. Pure, no I/O.
import { freeMinutes } from "../week/free.ts";
import type { IsoDate, WorkItem } from "../week/types.ts";
import { SIZE_MINUTES, type Pick, type Size } from "./types.ts";


/**
 * Real capacity of a half-day: the same total free time the week view shows (week/free.ts, D100), counting
 * only time from `now` on, so planning at 9:40 doesn't plan the 9:00 to 9:40 that has passed. PTO lowers it.
 */
export function capacityMinutes(slot: Parameters<typeof freeMinutes>[0], now: string): number {
  return freeMinutes(slot, now);
}

/** Planned minutes of the picks still to do (planned); done, moved and dropped don't use capacity. */
export function plannedMinutes(picks: readonly Pick[], sizes: Readonly<Record<Size, number>> = SIZE_MINUTES): number {
  return picks.filter((p) => p.status === "planned").reduce((sum, p) => sum + sizes[p.size], 0);
}

export type Fit = { kind: "empty" } | { kind: "fits"; spare: number } | { kind: "tight"; spare: number } | { kind: "over"; by: number };

/** Less than this much slack left counts as tight. */
export const TIGHT_SLACK_MINUTES = 30;

export function fitOf(planned: number, capacity: number): Fit {
  if (planned === 0) return { kind: "empty" };
  if (planned > capacity) return { kind: "over", by: planned - capacity };
  const spare = capacity - planned;
  return spare < TIGHT_SLACK_MINUTES ? { kind: "tight", spare } : { kind: "fits", spare };
}

/** How far back unfinished picks are offered again. */
export const CARRY_DAYS = 7;

/**
 * Carry-over for `today`: picks still planned on an earlier date within CARRY_DAYS. Moving a pick marks
 * the original "moved", and done or dropped picks are settled, so each unfinished pick shows once until
 * it is carried, done or dropped. Newest day first, then block and position.
 */
export function carryOver(picks: readonly Pick[], today: IsoDate, days = CARRY_DAYS): Pick[] {
  if (days <= 0) return [];
  const t = Temporal.PlainDate.from(today);
  const from = t.subtract({ days });
  return picks
    .filter((p) => p.status === "planned")
    .filter((p) => {
      const d = Temporal.PlainDate.from(p.date);
      return Temporal.PlainDate.compare(d, t) < 0 && Temporal.PlainDate.compare(d, from) >= 0;
    })
    .sort((a, b) => b.date.localeCompare(a.date) || a.half.localeCompare(b.half) || a.position - b.position);
}

export type BlockClient = { clientKey: string | null; mixed: boolean; clients: string[] };

/**
 * The client of a block: its focus block's client, or for an Open half-day the client of the first pick.
 * Mixing clients in one block is allowed but flagged. Only picks still in play (planned or done) count.
 */
export function blockClient(focusClientKey: string | null, picks: readonly Pick[]): BlockClient {
  const live = [...picks].filter((p) => p.status === "planned" || p.status === "done").sort((a, b) => a.position - b.position);
  const clients = [...new Set(live.map((p) => p.clientKey))];
  const clientKey = focusClientKey ?? clients[0] ?? null;
  return { clientKey, mixed: clients.some((c) => c !== clientKey), clients };
}

/** Only story-level items (requirement, task and bug backlog categories) can be picked. */
export const isPickable = (item: { level: WorkItem["level"] }) => item.level === "story";

/** Why an item can't be picked, in plain words, or null when it can. */
export function unpickableReason(item: { level: WorkItem["level"]; type: string }): string | null {
  if (item.level === "story") return null;
  if (item.level === "portfolio") return `${item.type} is above story level. Pick one of its child items, or add a draft story if it has none`;
  return `${item.type} is not on the story, task or bug backlog, so it can't be picked`;
}

/**
 * Pickable descendants of a portfolio item from the children read for it (up to two levels: epic, feature, story).
 * Empty means "Needs breakdown".
 */
export function pickableChildren(parentId: number, children: readonly WorkItem[]): WorkItem[] {
  const direct = children.filter((c) => c.parentId === parentId);
  const below = direct.filter((c) => c.level === "portfolio").flatMap((c) => children.filter((g) => g.parentId === c.id));
  return [...direct, ...below].filter(isPickable);
}
