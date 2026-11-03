// G1: Chapter 3's sizing sandbox. The math is the app's own (plan/estimate.ts for blocks, plan/fit.ts and plan/rules.ts
// for the fit words, the default S, M and L minutes from config/schema.ts), never a copy, so the Guide says what every
// card says.
import { DEFAULT_PLAN } from "../../config/schema.ts";
import { blocksNumber, Q, STORY_QUARTERS, type StorySize } from "../../plan/estimate.ts";
import { blockFitWords, type FitWords } from "../../plan/fit.ts";
import { fitOf } from "../../plan/rules.ts";

const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

export type Sandbox = {
  /** Quarters planned (S 1, M 2, L 4); a block is 4. */
  quarters: number;
  /** Which of the block's four quarters are filled, and how many quarters spill past it. */
  filled: number;
  spill: number;
  /** Plan the day's fit words for this block (blockFitWords), or "" when empty. */
  fit: FitWords;
  /** "1½": the stories in half blocks, as Plan the week counts them. */
  blocks: string;
};

/** The example block's free time: its hours, no meetings. */
export const blockMinutes = (b: { start: string; end: string }) => minutesOf(b.end) - minutesOf(b.start);

export function sandbox(stories: readonly StorySize[], block: { start: string; end: string }, sizes: Readonly<Record<StorySize, number>> = DEFAULT_PLAN.sizes): Sandbox {
  const quarters = stories.reduce((n, s) => n + STORY_QUARTERS[s], 0);
  const minutes = stories.reduce((n, s) => n + sizes[s], 0);
  return {
    quarters,
    filled: Math.min(quarters, Q),
    spill: Math.max(0, quarters - Q),
    fit: blockFitWords(fitOf(minutes, blockMinutes(block))),
    blocks: blocksNumber(quarters),
  };
}
