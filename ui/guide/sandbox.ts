// G1, E2: Chapter 3's sizing sandbox. The math is the app's own, never a copy: story hours from plan/estimate.ts (S 1h,
// M 2h, L 4h, unsized counts as the default, 1h), and QT-1's free time words from the block panel (roomWords), so the
// Guide says what every block says: "1h free" or "No free time", never "over".
import { DEFAULT_SIZE_SCALE, hoursText, sizeChipText, storyMinutes, type StorySize } from "../../plan/estimate.ts";
import { roomWords } from "../../plan/addwork.ts";

export type Sandbox = {
  /** Minutes planned: each story's hours, an unsized one as the default. */
  minutes: number;
  /** Whole hours of the block's free time filled, and how many hours spill past it. */
  filled: number;
  spill: number;
  /** The block's free time words (the panel's roomWords): neutral, never amber. */
  fit: { text: string; tone: "neutral" };
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
    fit: { text: roomWords(block.freeMinutes, minutes).text, tone: "neutral" },
    load: { planned: hoursText(minutes), free: hoursText(block.freeMinutes) },
    chips: stories.map((s) => sizeChipText(s, DEFAULT_SIZE_SCALE)),
  };
}
