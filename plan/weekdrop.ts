// PV-1 (D571): dropping a story onto a Week block (drag and drop, or Add to… / Move to…). Which blocks take it and
// what the target shows while dragging: "2h of 3h free", or amber "Over your Wednesday PM hours by 1h" (the block's
// whole free time after its planned picks, as Plan the day's fit, D266). AS-2 (supersedes PV-1's PTO refusal): the day
// never refuses it; a PTO day, a weekend, Friday's catch-up or a day without hours takes it with a note (placeNote,
// shared with pick.move and the assistant). Only a half-day that has ended, another client's block or a block that
// already has it refuse. Pure.
import { overNote, placeNote } from "./days.ts";
import { freeMinutes } from "../week/free.ts";
import { hoursText, storyMinutes, type SizeScale, type StorySize } from "./estimate.ts";
import { planMinutes } from "./fit.ts";
import type { FreeGap, Half, IsoDate } from "../week/types.ts";

type SlotLike = { date: IsoDate; half: Half; start: string; end: string; pto: boolean; off: boolean; freeGaps: FreeGap[]; longestFreeMinutes: number; focus?: readonly { clientKey: string; clientName: string }[] };
type PickLike = { id: number; date: IsoDate; half: Half; clientKey: string; itemId: number | null; status: string; size: string | null };
type BoxLike = { date: IsoDate; pickId: number | null; start: string; end: string; removedAt: string | null };

/** What's dragged: a story not planned in that block yet, or a planned pick moving. */
export type Dragged = { clientKey: string; itemId: number; size: StorySize | null; title: string; pickId?: number | undefined };

export type DropCheck = { ok: true; text: string; over: boolean } | { ok: false; why: string };

export function dropCheck(i: {
  slot: SlotLike;
  /** The whole day is PTO. */
  ptoDay: boolean;
  /** A day without working hours (Friday's catch-up): it takes work, with no fit to show. */
  catchUp: boolean;
  /** The real clock and today's date. */
  now: string;
  today: IsoDate;
  /** That block's picks. */
  picks: readonly PickLike[];
  sizes: SizeScale;
  timeboxes?: readonly BoxLike[] | undefined;
  dragged: Dragged;
}): DropCheck {
  const { slot, dragged } = i;
  if (slot.date < i.today || Temporal.Instant.compare(Temporal.Instant.from(slot.end), Temporal.Instant.from(i.now)) <= 0) return { ok: false, why: "Already over" };
  // Another client's block refuses it: a story stays in its own client's blocks (or an Open half-day, or catch-up).
  const owner = slot.focus ?? [];
  if (owner.length && !owner.some((f) => f.clientKey === dragged.clientKey)) return { ok: false, why: `${owner[0]!.clientName}'s block` };
  const live = i.picks.filter((p) => p.date === slot.date && p.half === slot.half && (p.status === "planned" || p.status === "done"));
  const here = live.find((p) => p.clientKey === dragged.clientKey && p.itemId === dragged.itemId);
  if (here) return { ok: false, why: here.id === dragged.pickId ? "Planned here" : "Already planned here" };
  const note = placeNote(slot.date, { pto: i.ptoDay || slot.pto, hasHours: !i.catchUp && !slot.off });
  if (note) return { ok: true, text: note, over: false };
  const free = freeMinutes(slot);
  const left = Math.max(0, free - planMinutes(live, i.sizes, i.timeboxes, slot));
  const need = storyMinutes(dragged.size, i.sizes);
  if (need <= left) return { ok: true, text: `${hoursText(need)} of ${hoursText(left)} free`, over: false };
  return { ok: true, text: overNote(slot.date, slot.half, hoursText(need - left)), over: true };
}
