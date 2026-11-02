// How to notice a new day while the window stays open for days (step 16.2: nothing opens by itself any more), and fit words.
import type { Fit } from "../plan/rules.ts";

/** True when the local date has moved past the day the loaded data calls today (midnight while running). */
export function dayRolledOver(now: Temporal.ZonedDateTime, loadedToday: string): boolean {
  return Temporal.PlainDate.compare(now.toPlainDate(), Temporal.PlainDate.from(loadedToday)) > 0;
}

export const formatMinutes = (m: number) => {
  const h = Math.floor(m / 60);
  const r = Math.round(m % 60);
  return h && r ? `${h}h ${r}m` : h ? `${h}h` : `${r}m`;
};

/** The fit in a few words, the same in Plan the day and on committed cards. */
export function fitLabel(f: Fit): string {
  switch (f.kind) {
    case "empty": return "nothing planned";
    case "fits": return `fits, ${formatMinutes(f.spare)} to spare`;
    case "tight": return f.spare ? `just fits, ${formatMinutes(f.spare)} to spare` : "just fits, no time to spare";
    case "over": return `too much: ${formatMinutes(f.by)} more than the free time`;
  }
}
