// Estimating in half blocks (E1, D438; was step 16.4, D334). A block is one half-day of client focus time. All
// arithmetic is in quarters of a block, integers only: S = 1, M = 2, L = 4, a block = 4. What is shown is always a
// half-block amount ("½ block", "1½ blocks"), never a quarter and never a decimal.
//
// A feature's load this week:
// - derived: when stories under it are on the week list and at least one is sized, the sum of the sized ones, rounded
//   up to the next half block. Its typed estimate is ignored (and its stepper hidden).
// - estimate: otherwise, the person's estimate in half-block steps (½ to 20), 1 block when none was set.
// A story on the list without its feature counts its own size, rounded up to a half block (an unsized one counts as M).
// Nested stories never add to the client's total. Pure: no I/O.

export type StorySize = "S" | "M" | "L";
export const STORY_SIZES: readonly StorySize[] = ["S", "M", "L"];
/** S about an hour, M a couple of hours, L about a whole block: quarters of a block. */
export const STORY_QUARTERS: Record<StorySize, number> = { S: 1, M: 2, L: 4 };
/** Quarters in a block. */
export const Q = 4;
export const MAX_BLOCKS = 20;
/** A feature with no estimate and no sized stories: 1 block. */
export const DEFAULT_FEATURE_QUARTERS = Q;
/** An unsized story counts as this when it stands alone on the list. */
export const DEFAULT_STORY_SIZE: StorySize = "M";

/** A feature estimate in blocks: ½ to 20 in half-block steps (whole blocks from before E1 are valid as they are). */
export const validHalfBlocks = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && Number.isInteger(n * 2) && n >= 0.5 && n <= MAX_BLOCKS;
export const validStorySize = (s: unknown): s is StorySize => s === "S" || s === "M" || s === "L";

/** Blocks (a half-block amount) to quarters, and back. */
export const quartersOf = (blocks: number) => Math.round(blocks * Q);
export const blocksOf = (quarters: number) => quarters / Q;
/** Up to the next half block (2 quarters). */
export const upToHalf = (q: number) => Math.ceil(q / 2) * 2;
const downToHalf = (q: number) => Math.floor(q / 2) * 2;

/** A half-block amount as a number word: "½", "1", "1½", "12". Quarters round up to a half: never shown. */
export function blocksNumber(q: number): string {
  const halves = Math.ceil(Math.max(0, q) / 2);
  const whole = Math.floor(halves / 2);
  const half = halves % 2 === 1;
  if (!whole) return half ? "½" : "0";
  return `${whole}${half ? "½" : ""}`;
}
/** "½ block", "1 block", "1½ blocks", "2 blocks". */
export const blocksWord = (q: number) => `${blocksNumber(q)} block${upToHalf(q) === Q || upToHalf(q) === 2 ? "" : "s"}`;
/** What is free: "half a block", else blocksWord. */
const freeWord = (q: number) => (upToHalf(q) === 2 ? "half a block" : blocksWord(q));

/** Loose stories' quarters for the budget: each its own size rounded up to a half block. */
export const looseQuarters = (sizes: readonly (StorySize | null | undefined)[]) => sizes.reduce((n, s) => n + upToHalf(STORY_QUARTERS[s ?? DEFAULT_STORY_SIZE]), 0);

export type EstItem = {
  clientKey: string;
  itemId: number;
  level: "feature" | "story";
  tier: "must" | "nice";
  /** Features: the person's estimate in blocks (half-block steps), or null for the default (1 block). Stories: ignored. */
  blocks: number | null;
  /** Stories: S, M or L, or null when not sized yet. Features: ignored. */
  size?: StorySize | null;
  /** A story's parent feature in DevOps, when known. */
  parentId?: number | null;
  done?: unknown;
};

export type Envelope<T> = {
  feature: T;
  /** The stories on the list under it (they take its tier). */
  stories: T[];
  /** Its load this week in quarters (always a half-block amount). */
  quarters: number;
  /** True when the load comes from its sized stories (the estimate is ignored and its stepper hidden). */
  derived: boolean;
  /** Stories under it on the list but none sized: the estimate applies, and the row says so. */
  unsized: boolean;
  /** Quarters done: all when the feature is done, else its done stories' share, down to a half block. */
  doneQuarters: number;
};
export type Estimate<T> = { envelopes: Envelope<T>[]; loose: T[] };

/**
 * Features as envelopes: each listed story whose parent feature is on the same client's list nests under it; the rest
 * stay loose (their own rows). A feature's load is derived from its sized stories, or its estimate.
 */
export function estimate<T extends EstItem>(items: readonly T[]): Estimate<T> {
  const features = items.filter((i) => i.level === "feature");
  const key = (k: string, id: number) => `${k}:${id}`;
  const byFeature = new Map<string, T[]>(features.map((f) => [key(f.clientKey, f.itemId), []]));
  const loose: T[] = [];
  for (const s of items.filter((i) => i.level === "story")) {
    const home = s.parentId != null ? byFeature.get(key(s.clientKey, s.parentId)) : undefined;
    if (home) home.push(s);
    else loose.push(s);
  }
  const envelopes = features.map((f) => {
    const stories = byFeature.get(key(f.clientKey, f.itemId))!;
    const sized = stories.filter((s) => validStorySize(s.size));
    const derived = sized.length > 0;
    const quarters = derived ? upToHalf(sized.reduce((n, s) => n + STORY_QUARTERS[s.size!], 0)) : f.blocks != null && validHalfBlocks(f.blocks) ? quartersOf(f.blocks) : DEFAULT_FEATURE_QUARTERS;
    const doneQuarters = f.done
      ? quarters
      : derived
        ? Math.min(quarters, downToHalf(sized.filter((s) => !!s.done).reduce((n, s) => n + STORY_QUARTERS[s.size!], 0)))
        : stories.length
          ? downToHalf(Math.floor((quarters * stories.filter((s) => !!s.done).length) / stories.length))
          : 0;
    return { feature: f, stories, quarters, derived, unsized: !derived && stories.length > 0, doneQuarters };
  });
  return { envelopes, loose };
}

/** A story's tier: its feature's when nested (no separate rule), else its own. */
export function tierOf<T extends EstItem>(e: Estimate<T>, item: T): "must" | "nice" {
  if (item.level === "story") for (const env of e.envelopes) if (env.stories.includes(item)) return env.feature.tier;
  return item.tier;
}

/** Quarters planned per client and tier: each feature's load, plus loose stories each rounded up to a half block. */
export function plannedQuarters<T extends EstItem>(e: Estimate<T>, clientKey: string, tier: "must" | "nice"): number {
  const features = e.envelopes.filter((x) => x.feature.clientKey === clientKey && x.feature.tier === tier).reduce((n, x) => n + x.quarters, 0);
  return features + looseQuarters(e.loose.filter((s) => s.clientKey === clientKey && s.tier === tier).map((s) => s.size));
}

/** "½ of 1½ blocks done". */
export const progressWords = (env: Pick<Envelope<unknown>, "quarters" | "doneQuarters">) => `${blocksNumber(env.doneQuarters)} of ${blocksWord(env.quarters)} done`;

/** The row's plain status: stories on the list that aren't sized yet (so its estimate applies). Nothing otherwise. */
export function fillWords(env: Pick<Envelope<unknown>, "unsized">): string | null {
  return env.unsized ? "size its stories to plan from them" : null;
}

/** The client's plain status against its budget, in quarters: "All 3 planned", "half a block free", "2½ planned, 2 available". */
export function budgetWords(budgetQ: number, plannedQ: number): { kind: "none" | "all" | "free" | "over"; text: string } {
  if (plannedQ > budgetQ) return { kind: "over", text: `${blocksNumber(plannedQ)} planned, ${blocksNumber(budgetQ)} available` };
  if (!budgetQ) return { kind: "none", text: "No blocks this week" };
  if (plannedQ === budgetQ) return { kind: "all", text: `All ${blocksNumber(budgetQ)} planned` };
  return { kind: plannedQ ? "free" : "none", text: `${freeWord(budgetQ - plannedQ)} free` };
}

/** Old half-block counts (before step 16.4): features round up to whole blocks; a story becomes M (half) or L. */
export function migrateBlocks(level: "feature" | "story", blocks: number): { blocks: number; size: StorySize | null } {
  if (level === "story") return { blocks: Math.max(1, Math.ceil(blocks)), size: blocks <= 0.5 ? "M" : "L" };
  return { blocks: Math.min(MAX_BLOCKS, Math.max(1, Math.ceil(blocks))), size: null };
}

/**
 * U4: the one amber line under a client's musts when they need more than it has, in quarters: "2½ blocks of musts,
 * 2 blocks free. Move one to nice to have, or borrow Friday." Friday is offered only when the week has a catch-up day.
 */
export function overLine(budgetQ: number, plannedQ: number, friday: boolean): string | null {
  if (plannedQ <= budgetQ) return null;
  const free = budgetQ ? `${freeWord(budgetQ)} free` : "no blocks free";
  return `${blocksWord(plannedQ)} of musts, ${free}. Move one to nice to have${friday ? ", or borrow Friday" : ""}.`;
}
