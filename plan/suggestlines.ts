// PS-1: when the board's "Keep all · Clear" lines show, so the same two controls aren't repeated on every block and
// again for the day. A block with one suggestion has no line (the row's + and × are enough); two or more keep one
// quiet line. The day's line shows only when two or more blocks have suggestions; with one, that block's line is the
// only one. Pure.

/** A block's "Suggested · Keep all · Clear" line: only for two or more suggestions. */
export const blockLineShows = (suggestions: number): boolean => suggestions >= 2;

/** A day's "N suggested · Keep all · Clear" line: only when two or more of its blocks have suggestions. */
export function dayLineShows(perBlock: readonly { half: string }[]): boolean {
  return new Set(perBlock.map((s) => s.half)).size >= 2;
}
