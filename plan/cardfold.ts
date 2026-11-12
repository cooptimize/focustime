// PS-1: which done to-dos a block's card folds to "N done" (a click opens them). On a day other than today they always
// fold (U3). On today they stay in place, ticked, while the block is light, so a tick never makes a row jump away; a
// heavy block (HEAVY to-dos or more) folds them too, so what's left to do stays in view. Pure.

/** A block with this many to-dos (done or not) or more folds its done ones on today too. */
export const HEAVY = 6;

export function foldDone<T extends { status: string }>(picks: readonly T[], o: { isToday: boolean }): { shown: T[]; done: T[] } {
  const fold = !o.isToday || picks.length >= HEAVY;
  if (!fold) return { shown: [...picks], done: [] };
  return { shown: picks.filter((p) => p.status !== "done"), done: picks.filter((p) => p.status === "done") };
}

/** PS-1: a card shows at most this many chips (late promises, due dates); the rest fold to "+N", which opens the block. */
export const CARD_CHIPS = 3;
export function chipFold<T>(chips: readonly T[]): { shown: T[]; more: number } {
  return chips.length <= CARD_CHIPS ? { shown: [...chips], more: 0 } : { shown: chips.slice(0, CARD_CHIPS - 1), more: chips.length - (CARD_CHIPS - 1) };
}
