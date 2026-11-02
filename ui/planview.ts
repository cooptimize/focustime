// The committed plan as the week view sees it: picks per day, and ticking one done (local status only).
import type { FollowUpView } from "../actions/types.ts";
import { createContext, useContext } from "react";
import { liveFocused } from "../plan/focus.ts";
import { SIZE_MINUTES, type Pick, type PlanWeek, type Size, type WeekFeature } from "../plan/types.ts";
import type { Half, IsoDate, Slot, WorkItem } from "../week/types.ts";
import { type Fit } from "../plan/rules.ts";
import { planFit } from "../plan/fit.ts";

/**
 * `sizes`: minutes per pick size from Settings > Planning (step 6c). `focused`: seconds per pick from the focus log,
 * with the running timer and the clock so a live session counts as it goes (step 6d).
 */
export type PlanView = {
  week: PlanWeek | null;
  toggle: (id: number, done: boolean) => void;
  sizes: Readonly<Record<Size, number>>;
  /** Step 15.1 (D273): the shortest useful time per size, for Timebox my day. */
  minSizes?: Readonly<Record<Size, number>>;
  focused: Readonly<Record<number, number>>;
  timer: { pickId: number | null; runningSince: string | null } | null;
  nowMs: number;
  /** The latest resume note per client (step 7), for Plan the day blocks. */
  resumeNotes?: Readonly<Record<string, ResumeNote>>;
  /** The note to show on a week card ("date:half"): each client's next block after its note. */
  resumeOn?: Readonly<Record<string, ResumeNote>>;
  /** Features committed to the weeks in view (step 8), for the week cards. */
  weekFeatures?: readonly WeekFeature[];
  /** Timeboxes on the week (step 12): they count as planned time in fit. */
  timeboxes?: readonly TimeboxLike[];
  /** Open follow-ups (step 13.5), for the week's cards, and today's date for their due badges. */
  followUps?: readonly FollowUpView[];
  today?: IsoDate;
};
type TimeboxLike = { date: IsoDate; pickId: number | null; start: string; end: string; removedAt: string | null };
export type ResumeNote = { clientKey: string; date: IsoDate; note: string };

/**
 * Where each client's latest resume note shows in the week (step 7): on that client's first focus block after the
 * note's day, from today on. Blocks outside the week shown get nothing.
 */
export function resumeSlots(days: readonly { date: IsoDate; am: Slot; pm: Slot }[], notes: Readonly<Record<string, ResumeNote>>, today: IsoDate): Record<string, ResumeNote> {
  const out: Record<string, ResumeNote> = {};
  for (const n of Object.values(notes)) {
    for (const d of days) {
      if (d.date <= n.date || d.date < today) continue;
      const half = d.am.focus.some((b) => b.clientKey === n.clientKey) ? "AM" : d.pm.focus.some((b) => b.clientKey === n.clientKey) ? "PM" : null;
      if (half) {
        out[`${d.date}:${half}`] = n;
        break;
      }
    }
  }
  return out;
}
type FeatureOnWeek = { clientKey: string; itemId: number; title: string; blocks: number | null; slots: readonly { date: IsoDate; half: "AM" | "PM" }[]; tier?: "must" | "nice"; doneAt?: string | null };

/**
 * Week items to show on a block (step 11): those pinned to it, then (on a client's own block) that client's musts not
 * pinned anywhere and not marked done. An Open half-day (no client) shows only what is pinned to it.
 */
export function featuresOn<T extends FeatureOnWeek>(features: readonly T[], date: IsoDate, half: Half, clientKey: string | null): T[] {
  const here = features.filter((f) => f.slots.some((s) => s.date === date && s.half === half));
  const floating = clientKey ? features.filter((f) => f.clientKey === clientKey && !here.includes(f) && !f.slots.length && (f.tier ?? "must") === "must" && !f.doneAt) : [];
  return [...here, ...floating];
}

export const PlanCtx = createContext<PlanView>({ week: null, toggle: () => {}, sizes: SIZE_MINUTES, focused: {}, timer: null, nowMs: 0 });

/** Seconds focused on a pick, live while its session runs. */
export function useFocused(): (id: number) => number {
  const v = useContext(PlanCtx);
  return (id) => liveFocused(id, v.focused, v.timer, v.nowMs);
}

/** "about 1 h" for a size's minutes. */
export function sizeNote(minutes: number): string {
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return `about ${h ? `${h} h` : ""}${h && m ? " " : ""}${m ? `${m} min` : ""}`;
}

/** The checklist for a half-day: shown once the day is committed; planned and done picks only. */
export function checklistFor(week: PlanWeek | null, date: IsoDate, half: Half): Pick[] {
  const day = week?.[date];
  if (!day?.committedAt) return [];
  return day.picks.filter((p) => p.half === half && (p.status === "planned" || p.status === "done"));
}

/** How many work items a card lists before "+N more". */
export const CARD_ITEMS = 3;

export type CardPlan = {
  /** The committed picks (empty before commit: the card keeps its step 6 look). */
  picks: Pick[];
  /** How the picks still to do fit the block's free time; null with none left to do. */
  fit: Fit | null;
  /** The block's DevOps items, without the ones already picked here. */
  items: WorkItem[];
  /** Committed: the list starts collapsed behind "+N more items". */
  collapsed: boolean;
};

/**
 * A card's plan (step 6.1). Once the day is committed: its picks, their fit against the block's whole free time
 * (step 15, D266: the same number Plan the day uses), the DevOps list without items picked here, and
 * that list collapsed. Before commit: no picks, every item, not collapsed (unchanged).
 */
export function cardPlan(week: PlanWeek | null, slot: Slot, clientKey: string | null, items: readonly WorkItem[], now: string, sizes: Readonly<Record<Size, number>> = SIZE_MINUTES, timeboxes: readonly TimeboxLike[] = []): CardPlan {
  const picks = checklistFor(week, slot.date, slot.half);
  if (!week?.[slot.date]?.committedAt) return { picks: [], fit: null, items: [...items], collapsed: false };
  const picked = new Set(picks.filter((p) => p.kind === "item" && p.clientKey === clientKey && p.itemId !== null).map((p) => p.itemId));
  return {
    picks,
    // Fit only matters while something is left to do: all done shows no pill (not "nothing picked").
    // A block that has ended has no time left to fit anything into, so no fit is shown (Plan any day).
    fit: picks.some((p) => p.status === "planned") && Temporal.Instant.compare(Temporal.Instant.from(now), Temporal.Instant.from(slot.end)) < 0 ? planFit(picks, sizes, timeboxes, slot) : null,
    items: items.filter((i) => !picked.has(i.id)),
    collapsed: true,
  };
}

/**
 * U2: one client name everywhere. The plan's name (from the focus blocks) wins; DevOps's configured name is only a
 * fallback for a client with no blocks, so "Northwind" never shows as "Northwind Foods" on one screen.
 */
export function clientNames(data: { planClients: readonly { clientKey: string; clientName: string }[]; devops?: readonly { clientKey: string; clientName: string }[] | null }): (key: string) => string {
  const m = new Map<string, string>();
  for (const c of data.devops ?? []) m.set(c.clientKey, c.clientName);
  for (const c of data.planClients) m.set(c.clientKey, c.clientName);
  return (k) => m.get(k) ?? k;
}
