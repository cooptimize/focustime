// Where "⋯ → Add to the plan" can put an item (step 15.2). Pure: which blocks, in what order, and why some can't take it.
// Order: the block selected in Plan the day, this client's blocks on the day being planned, its other blocks, Open
// half-days (and Friday catch-up), then other clients' blocks last (the menu labels those "Different client" and asks
// first). Past days and halves with no working time are left out; a day off, a block with no free time, or one that
// already has the item stays listed but disabled, with the reason.
import type { Half, IsoDate } from "../week/types.ts";
import type { Pick } from "./types.ts";
import { alreadyPlanned, type PickRef } from "./dup.ts";

export type TargetBlock = {
  date: IsoDate;
  half: Half;
  /** The focus block's client (Dataverse or standing), or null for an Open half-day, Friday or an evening. */
  focusClient: string | null;
  /** Clients of flex sessions in this slot (evenings). */
  flexClients: readonly string[];
  /** Friday catch-up: no focus blocks, always offered. */
  overflow: boolean;
  pto: boolean;
  /** No working time in this half (a day off, a weekend half). */
  off: boolean;
  /** Free time in the block after meetings and personal events, in minutes. */
  freeMinutes: number;
};

export type TargetGroup = "here" | "client" | "open" | "other";
export type AddTarget = { date: IsoDate; half: Half; group: TargetGroup; otherClient: string | null; selected: boolean; disabled?: string };

export type TargetInput = {
  blocks: readonly TargetBlock[];
  clientKey: string;
  /** The day being planned (Plan the day's date, or the selection's day). */
  planDate: IsoDate;
  /** The block selected in Plan the day, if any. */
  selected: { date: IsoDate; half: Half } | null;
  today: IsoDate;
  /** Picks on the listed days. */
  picks: readonly Pick[];
  ref: PickRef;
};

const HALF_ORDER: Record<Half, number> = { AM: 0, PM: 1, EVE: 2 };
const GROUP_ORDER: Record<TargetGroup, number> = { here: 0, client: 1, open: 2, other: 3 };
const HALF_WORD: Record<Half, string> = { AM: "the morning", PM: "the afternoon", EVE: "the evening" };

function groupOf(b: TargetBlock, clientKey: string, planDate: IsoDate): { group: TargetGroup; otherClient: string | null } {
  const owner = b.focusClient ?? (b.flexClients.includes(clientKey) ? clientKey : (b.flexClients[0] ?? null));
  if (owner === clientKey) return { group: b.date === planDate ? "here" : "client", otherClient: null };
  if (owner === null || b.overflow) return { group: "open", otherClient: null };
  return { group: "other", otherClient: owner };
}

function reason(b: TargetBlock, i: TargetInput): string | undefined {
  if (b.pto) return "Day off";
  if (!b.off && b.freeMinutes <= 0) return "No free time left: meetings fill it";
  if (alreadyPlanned(i.picks, i.ref, b.date, b.half)) return "Already planned here";
  const ref = i.ref;
  const same = i.picks.find(
    (p) =>
      p.date === b.date &&
      p.clientKey === ref.clientKey &&
      (p.status === "planned" || p.status === "done") &&
      ((ref.itemId != null && p.itemId === ref.itemId) || (ref.draftId != null && p.draftId === ref.draftId) || (ref.followUpId != null && p.followUpId === ref.followUpId)),
  );
  return same ? `Already planned for ${HALF_WORD[same.half]} that day` : undefined;
}

export function addTargets(i: TargetInput): AddTarget[] {
  const list = i.blocks
    .filter((b) => b.date >= i.today && (!b.off || b.overflow || b.pto))
    .map((b): AddTarget => {
      const why = reason(b, i);
      const selected = !!i.selected && i.selected.date === b.date && i.selected.half === b.half;
      return { date: b.date, half: b.half, ...groupOf(b, i.clientKey, i.planDate), selected, ...(why ? { disabled: why } : {}) };
    });
  // The selected block leads, unless it belongs to another client.
  const lead = (t: AddTarget) => (t.selected && t.group !== "other" ? 0 : 1);
  for (const t of list) if (t.selected && t.group === "other") t.selected = false;
  return list.sort((a, b) => lead(a) - lead(b) || GROUP_ORDER[a.group] - GROUP_ORDER[b.group] || a.date.localeCompare(b.date) || HALF_ORDER[a.half] - HALF_ORDER[b.half]);
}
