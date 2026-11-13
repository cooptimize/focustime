// RS-2: changing week or day answers at once. The header shows the week or day asked for straight away; until its read
// is in, the screen says "Loading…" (the old week's or day's blocks dimmed, the screen marked busy), and if the read
// failed, "This week didn't load" (or "This day didn't load") with Retry. Pure; App and Day use it.
import type { IsoDate } from "../week/types.ts";

export type WeekRead = "loading" | "failed" | null;

/** Where the read for the asked week stands: null once that week is on screen (or nothing is asked). */
export function weekRead(o: { asked: IsoDate | null; shown: IsoDate | null; failed: IsoDate | null }): WeekRead {
  if (!o.asked || !o.shown || o.asked === o.shown) return null;
  return o.failed === o.asked ? "failed" : "loading";
}

/** The line for a failed read. */
export const failedWords = (what: "week" | "day") => (what === "week" ? "This week didn't load" : "This day didn't load");

/**
 * Day while the asked day's week is being read: the day it draws (dimmed) is the last day it drew, when that day is in
 * the week on screen; otherwise the asked day, which shows "Opening…" as before.
 */
export function dayDrawn(asked: IsoDate, loaded: readonly IsoDate[], last: IsoDate | null): IsoDate {
  if (loaded.includes(asked)) return asked;
  return last && loaded.includes(last) ? last : asked;
}
