// WD-1: the Add work panel beside Week, and the lines that lead to it. Pure: which block the panel opens on, the
// block's room, the panel's sections for a selected block (the client rule of Plan the day's pane, AddPaneDay, and
// Plan the week's, AddWeek, kept exactly), where a row is already placed, the week's features without a Plan mode
// (the star and the remove rule), the notice line's counts and the header's tag.
import { addSections, type PriorityRow, type RestRow } from "./addpane.ts";
import { hm, OVER_GRACE } from "./fit.ts";
import type { DraftStory } from "./types.ts";
import type { Half, IsoDate, WorkItem } from "../week/types.ts";

/** The stories under a feature in one client's DevOps read: my own (items) and the rest (children), once each. */
export function storiesUnder(work: { items: readonly { id: number; parentId?: number | null }[]; children: readonly { id: number; parentId?: number | null }[] } | null | undefined, featureId: number): number[] {
  if (!work) return [];
  return [...new Set([...work.items, ...work.children].filter((c) => c.parentId === featureId).map((c) => c.id))];
}

/** A block the panel can open on (one per AM or PM of a working day, the whole day for PTO, catch-up and weekends). */
export type BlockAt = { date: IsoDate; half: Half; end: string; plannable: boolean };

/**
 * The block "+ Add" in the header and A open on: the one asked for (or its day's first) when it can take work, else the block under way,
 * else the next one that isn't over (in the week shown), else the week's first plannable block, else null.
 */
export function defaultAddBlock(blocks: readonly BlockAt[], now: string, asked?: { date: IsoDate | null; half: Half | null } | null): { date: IsoDate; half: Half } | null {
  if (asked?.date) {
    const sameDay = blocks.filter((b) => b.date === asked.date);
    // A block that can't take work (past, PTO, ended) isn't opened on: the panel goes to the next one that can.
    const hit = (asked.half ? sameDay.find((b) => b.half === asked.half && b.plannable) : null) ?? sameDay.find((b) => b.plannable);
    if (hit) return { date: hit.date, half: hit.half };
  }
  const t = Temporal.Instant.from(now);
  const next = blocks.find((b) => b.plannable && Temporal.Instant.compare(Temporal.Instant.from(b.end), t) > 0);
  const any = next ?? blocks.find((b) => b.plannable) ?? null;
  return any ? { date: any.date, half: any.half } : null;
}

/**
 * The block's room under the panel's title: "1h 45m free", "Full" within the grace, "a little over" under 45
 * minutes, else "about 2h over". `planned` counts unsized work at the person's unsized size (SZ-1, 1h by default).
 */
export function roomWords(freeMinutes: number, plannedMinutes: number): { text: string; over: boolean } {
  const left = freeMinutes - plannedMinutes;
  if (left > OVER_GRACE) return { text: `${hm(left)} free`, over: false };
  if (left >= -OVER_GRACE) return { text: freeMinutes > 0 ? "Full" : "No free time", over: false };
  const by = -left;
  return { text: by < 45 ? "a little over" : `about ${Math.round(by / 60)}h over`, over: true };
}

/** What waits to be placed (the notice line and the panel's To place section). */
export type ToPlace = { unfinished: number; lastWeek: number; sent: number };
export const toPlaceCount = (t: ToPlace) => t.unfinished + t.lastWeek + t.sent;

/** "3 to place · 1 unfinished, 2 from last week" (and "1 sent to you"); null when nothing waits. */
export function toPlaceLine(t: ToPlace): string | null {
  const n = toPlaceCount(t);
  if (!n) return null;
  const parts = [t.unfinished ? `${t.unfinished} unfinished` : "", t.lastWeek ? `${t.lastWeek} from last week` : "", t.sent ? `${t.sent} sent to you` : ""].filter(Boolean);
  return `${n} to place · ${parts.join(", ")}`;
}
/** The phone's notice: "3 to place"; null when nothing waits. */
export const toPlaceShort = (t: ToPlace): string | null => (toPlaceCount(t) ? `${toPlaceCount(t)} to place` : null);

/** Thursday and Friday, when next week has nothing placed: "Next week is empty". */
export function nextWeekEmpty(i: { today: IsoDate; thisWeek: IsoDate; shownWeek: IsoDate; nextWeekPicks: number; nextWeekFeatures: number }): boolean {
  const dow = Temporal.PlainDate.from(i.today).dayOfWeek;
  return i.shownWeek === i.thisWeek && (dow === 4 || dow === 5) && i.nextWeekPicks === 0 && i.nextWeekFeatures === 0;
}

const DAY = (d: IsoDate) => Temporal.PlainDate.from(d).toLocaleString("en-US", { weekday: "short" });
/** "Tue PM", "Sat" (a weekend's one block), "Tue Evening". */
export function blockWord(date: IsoDate, half: Half, wholeDay = false): string {
  return wholeDay ? DAY(date) : `${DAY(date)} ${half === "EVE" ? "Evening" : half}`;
}

type PickLike = { id: number; date: IsoDate; half: Half; clientKey: string; itemId: number | null; draftId: number | null; followUpId: number | null; status: string };
const live = (p: PickLike) => p.status === "planned" || p.status === "done";

/**
 * Where a row's item is already placed this week: "On this block" when it is on the selected block, else its first
 * other block ("Tue PM"), else null.
 */
/** The day's order of halves (AM, PM, then Evening), not the alphabet's. */
const HALF_ORDER: Record<Half, number> = { AM: 0, PM: 1, EVE: 2 };

export function placedWhere(ref: { clientKey: string; itemId?: number; draftId?: number; followUpId?: number }, picks: readonly PickLike[], selected: { date: IsoDate; half: Half }, weekDays: readonly { date: IsoDate; whole: boolean }[]): string | null {
  const mine = picks.filter((p) => live(p) && (ref.itemId !== undefined ? p.clientKey === ref.clientKey && p.itemId === ref.itemId : ref.draftId !== undefined ? p.draftId === ref.draftId : p.followUpId === ref.followUpId));
  if (!mine.length) return null;
  if (mine.some((p) => p.date === selected.date && p.half === selected.half)) return "On this block";
  const p = [...mine].sort((a, b) => (a.date === b.date ? HALF_ORDER[a.half] - HALF_ORDER[b.half] : a.date.localeCompare(b.date)))[0]!;
  return blockWord(p.date, p.half, !!weekDays.find((d) => d.date === p.date)?.whole);
}

/** One client's group under "This week's features" (Plan the day's priorities for that client, in its block's terms). */
export type FeatureGroup<R> = { clientKey: string; selected: boolean; rows: PriorityRow<R & Ref>[] };
type Ref = { clientKey: string; itemId: number; title: string; url: string | null; slots: readonly { date: IsoDate; half: "AM" | "PM" }[]; level?: "feature" | "story"; done?: boolean; parentId?: number | null };
type FollowLike = { id: number; clientKey: string | null; due: string | null; openedAt: string };

export type PanelInput<R extends Ref, F extends FollowLike> = {
  /** The selected block. */
  date: IsoDate;
  half: Half;
  /**
   * The client whose work this block takes: its focus block's client, or for an Open half-day or catch-up the client
   * chosen (Plan the day's chooser). Null: none chosen yet, so only the chooser shows.
   */
  clientKey: string | null;
  /** The clients whose work the panel lists under This week's features (followed, with blocks or features this week). */
  clients: readonly string[];
  workOf: (clientKey: string) => { items: readonly WorkItem[]; children: readonly WorkItem[]; committed?: readonly WorkItem[]; types?: readonly import("../week/types.ts").TypeLook[] } | undefined;
  /** The week's features and stories (all clients), in list order. */
  week: readonly R[];
  followUps: readonly F[];
  drafts: readonly DraftStory[];
  /** Keys of what is on the selected day: "i<client>:<id>", "d<draftId>", "f<followUpId>". */
  picked: ReadonlySet<string>;
  /** Keys on the selected block. */
  here: ReadonlySet<string>;
  query?: string;
};

export type PanelModel<R extends Ref, F extends FollowLike> = {
  /** This week's features: the selected block's client first, then the others, each under its own heading. */
  features: FeatureGroup<R>[];
  /** The selected client's open promises not on the plan. */
  promises: F[];
  /** More from DevOps for the selected client (search narrows it). */
  more: RestRow[];
  /** Draft stories of the selected client with no feature yet. */
  loose: DraftStory[];
};

/**
 * The panel's sections for a selected block. Every client's rows come from addSections with that client's own key,
 * so one client's items never show under another's heading (GD-2). Which ones can go on the selected block is the
 * drop rule's (another client's focus block refuses), never widened here.
 */
export function panelModel<R extends Ref, F extends FollowLike>(i: PanelInput<R, F>): PanelModel<R, F> {
  const order = i.clientKey ? [i.clientKey, ...i.clients.filter((k) => k !== i.clientKey)] : [...i.clients];
  const features: FeatureGroup<R>[] = [];
  for (const k of order) {
    const s = addSections<R & Ref, F>({ clientKey: k, date: i.date, half: i.half, work: i.workOf(k), week: i.week as readonly (R & Ref)[], followUps: [], drafts: i.drafts, picked: i.picked, here: i.here });
    if (s.priorities.length) features.push({ clientKey: k, selected: k === i.clientKey, rows: s.priorities });
  }
  const own = i.clientKey ? addSections<R & Ref, F>({ clientKey: i.clientKey, date: i.date, half: i.half, work: i.workOf(i.clientKey), week: i.week as readonly (R & Ref)[], followUps: i.followUps, drafts: i.drafts, picked: i.picked, here: i.here, query: i.query ?? "" }) : null;
  const loose = i.clientKey ? i.drafts.filter((d) => d.clientKey === i.clientKey && d.parentItemId === null && d.level === "story" && d.devopsId == null && !i.picked.has(`d${d.id}`)) : [];
  return { features, promises: own ? own.followUps.filter((f) => !i.picked.has(`f${f.id}`)) : [], more: own ? own.rest : [], loose };
}

/**
 * D.4: "Remove from this week" only while none of the feature's stories (or the feature as a placeholder) is placed
 * that week; otherwise where they are ("Tue AM, Wed PM").
 */
export function removeRule(f: { clientKey: string; itemId: number; slots: readonly { date: IsoDate; half: Half }[] }, storyIds: ReadonlySet<number>, weekPicks: readonly PickLike[], drafts: readonly { id: number; parentItemId: number | null }[] = []): { ok: true } | { ok: false; where: string[] } {
  const draftIds = new Set(drafts.filter((d) => d.parentItemId === f.itemId).map((d) => d.id));
  const placed = weekPicks.filter((p) => live(p) && p.clientKey === f.clientKey && ((p.itemId !== null && (storyIds.has(p.itemId) || p.itemId === f.itemId)) || (p.draftId !== null && draftIds.has(p.draftId))));
  const where = [...new Set([...placed.map((p) => `${p.date}|${p.half}`), ...f.slots.map((s) => `${s.date}|${s.half}`)])].sort().map((k) => {
    const [d, h] = k.split("|");
    return blockWord(d!, h as Half);
  });
  return where.length ? { ok: false, where } : { ok: true };
}

/**
 * A client chip in Week's header: the room left, "Northwind · 2h free" or "Northwind · 6h over" (amber only when over,
 * past the grace), with the count of what isn't ready. `plannedMinutes` is the one total, musts plus nice to have, used
 * by the chip and its popover alike (`detail`: "9h planned · 5h free in its blocks").
 */
export function clientChip(c: { name: string; plannedMinutes: number; freeMinutes: number; notReady: number }): { text: string; room: string; detail: string; over: boolean; badge: number | null } {
  const h = (m: number) => `${Math.round(m / 60)}h`;
  const left = c.freeMinutes - c.plannedMinutes;
  const over = -left > OVER_GRACE;
  const room = over ? `${Math.max(1, Math.round(-left / 60))}h over` : Math.round(left / 60) >= 1 ? `${Math.round(left / 60)}h free` : "Full";
  return { text: `${c.name} · ${room}`, room, detail: `${h(c.plannedMinutes)} planned · ${h(c.freeMinutes)} free in its blocks`, over, badge: c.notReady > 0 ? c.notReady : null };
}

/**
 * WD-1 review: how many of Week's client chips fit `room` px in the header row: all of them, or as many as still leave
 * room for the "+N" chip that opens the rest. Chips never clip.
 */
export function chipsThatFit(widths: readonly number[], room: number, gap: number, moreWidth: number): number {
  const total = widths.reduce((s, w, i) => s + w + (i ? gap : 0), 0);
  if (total <= room) return widths.length;
  let used = 0;
  for (let i = 0; i < widths.length; i++) {
    const next = used + (i ? gap : 0) + widths[i]!;
    if (next + gap + moreWidth > room) return i;
    used = next;
  }
  return widths.length;
}
