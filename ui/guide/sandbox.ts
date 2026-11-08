// G1, E2: Chapter 3's sizing sandbox. The math is the app's own, never a copy: story hours from plan/estimate.ts (S 1h,
// M 2h, L 4h, unsized counts as the default, 1h), the fit words from plan/fit.ts and plan/rules.ts, so the Guide says what every
// card says.
import { DEFAULT_SIZE_SCALE, hoursText, sizeChipText, storyMinutes, type StorySize } from "../../plan/estimate.ts";
import { blockFitWords, type FitWords } from "../../plan/fit.ts";
import { fitOf } from "../../plan/rules.ts";

export type Sandbox = {
  /** Minutes planned: each story's hours, an unsized one as the default. */
  minutes: number;
  /** Whole hours of the block's free time filled, and how many hours spill past it. */
  filled: number;
  spill: number;
  /** Plan the day's fit words for this block (blockFitWords). */
  fit: FitWords;
  /** "3h of 4h". */
  load: { planned: string; free: string };
  /** Each story's chip: "M · 2h", "Size? · 1h". */
  chips: string[];
};

export function sandbox(stories: readonly (StorySize | null)[], block: { freeMinutes: number }): Sandbox {
  const minutes = stories.reduce((n, s) => n + storyMinutes(s, DEFAULT_SIZE_SCALE), 0);
  const hours = Math.round(minutes / 60), free = Math.round(block.freeMinutes / 60);
  return {
    minutes,
    filled: Math.min(hours, free),
    spill: Math.max(0, hours - free),
    fit: blockFitWords(fitOf(minutes, block.freeMinutes)),
    load: { planned: hoursText(minutes), free: hoursText(block.freeMinutes) },
    chips: stories.map((s) => sizeChipText(s, DEFAULT_SIZE_SCALE)),
  };
}
