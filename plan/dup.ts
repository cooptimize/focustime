// Duplicate picks (D277): the same DevOps item, draft or follow-up planned twice in one block.
import type { Half } from "../week/types.ts";
import type { Pick } from "./types.ts";

export type PickRef = { clientKey: string; itemId?: number | null; draftId?: number | null; followUpId?: number | null };

/** The pick in this block that already holds the same item (planned or done), or null. `exceptId` is the pick being moved. */
export function alreadyPlanned(picks: readonly Pick[], ref: PickRef, date: string, half: Half, exceptId?: number): Pick | null {
  const same = (p: Pick) =>
    (ref.itemId != null && p.itemId === ref.itemId) ||
    (ref.draftId != null && p.draftId === ref.draftId) ||
    (ref.followUpId != null && p.followUpId === ref.followUpId);
  if (ref.itemId == null && ref.draftId == null && ref.followUpId == null) return null;
  return picks.find((p) => p.id !== exceptId && p.date === date && p.half === half && p.clientKey === ref.clientKey && (p.status === "planned" || p.status === "done") && same(p)) ?? null;
}
