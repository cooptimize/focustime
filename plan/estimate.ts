// Simple estimating (step 16.4, D334): two units, whole numbers only. Features are planned in whole blocks (a block is
// one half-day of client focus time); stories are sized S, M or L. Internally a block holds four S, two M or one L
// (quarters); that math is never shown. A story whose feature is on the week list fills that feature's blocks and
// never adds to the client's total. Pure: no I/O.

export type StorySize = "S" | "M" | "L";
export const STORY_SIZES: readonly StorySize[] = ["S", "M", "L"];
/** S about an hour, M about half a block, L about a whole block: quarters of a block. */
export const STORY_QUARTERS: Record<StorySize, number> = { S: 1, M: 2, L: 4 };
const Q = 4;
export const MAX_BLOCKS = 20;
/** A new story's size on the week list. */
export const DEFAULT_STORY_SIZE: StorySize = "M";

/** A whole number of blocks, 1 to 20. */
export const validWholeBlocks = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= MAX_BLOCKS;
export const validStorySize = (s: unknown): s is StorySize => s === "S" || s === "M" || s === "L";

/** Whole blocks for some stories, rounded up (never shown as a fraction). */
export const blocksFor = (sizes: readonly (StorySize | null)[]): number => Math.ceil(sizes.reduce((n, s) => n + STORY_QUARTERS[s ?? DEFAULT_STORY_SIZE], 0) / Q);

/** "1 block", "3 blocks". */
export const blocksWord = (n: number) => `${n} block${n === 1 ? "" : "s"}`;

export type EstItem = {
  clientKey: string;
  itemId: number;
  level: "feature" | "story";
  tier: "must" | "nice";
  /** Features: whole blocks, or null to take what its stories add up to. Stories: ignored. */
  blocks: number | null;
  /** Stories: S, M or L (null: M). Features: ignored. */
  size?: StorySize | null;
  /** A story's parent feature in DevOps, when known. */
  parentId?: number | null;
  done?: unknown;
};

export type Fill = "filled" | "needs_stories" | "over";
export type Envelope<T> = {
  feature: T;
  /** The stories on the list under it (they take its tier). */
  stories: T[];
  /** Its whole blocks: the count set, or what its stories add up to (at least 1). */
  blocks: number;
  auto: boolean;
  fill: Fill;
  /** Over: the whole blocks its stories need ("Raise to 3?"). */
  raiseTo: number | null;
  /** Whole blocks done: all when the feature is done, else its done stories' share rounded down. */
  doneBlocks: number;
};
export type Estimate<T> = { envelopes: Envelope<T>[]; loose: T[] };

/**
 * Features as envelopes: each listed story whose parent feature is on the same client's list nests under it; the rest
 * stay loose (their own rows). Fill compares the stories' sizes with the feature's blocks.
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
    const q = stories.reduce((n, s) => n + STORY_QUARTERS[s.size ?? DEFAULT_STORY_SIZE], 0);
    const doneQ = stories.filter((s) => !!s.done).reduce((n, s) => n + STORY_QUARTERS[s.size ?? DEFAULT_STORY_SIZE], 0);
    const auto = f.blocks === null;
    const blocks = auto ? Math.max(1, Math.ceil(q / Q)) : f.blocks!;
    const fill: Fill = auto ? (q === 0 ? "needs_stories" : "filled") : q > blocks * Q ? "over" : q < blocks * Q ? "needs_stories" : "filled";
    return { feature: f, stories, blocks, auto, fill, raiseTo: fill === "over" ? Math.min(MAX_BLOCKS, Math.ceil(q / Q)) : null, doneBlocks: f.done ? blocks : Math.min(blocks, Math.floor(doneQ / Q)) };
  });
  return { envelopes, loose };
}

/** A story's tier: its feature's when nested (no separate rule), else its own. */
export function tierOf<T extends EstItem>(e: Estimate<T>, item: T): "must" | "nice" {
  if (item.level === "story") for (const env of e.envelopes) if (env.stories.includes(item)) return env.feature.tier;
  return item.tier;
}

/**
 * Whole blocks planned per client and tier: each feature's blocks, plus loose stories rounded up together. Nested
 * stories never add to the total.
 */
export function plannedBlocks<T extends EstItem>(e: Estimate<T>, clientKey: string, tier: "must" | "nice"): number {
  const features = e.envelopes.filter((x) => x.feature.clientKey === clientKey && x.feature.tier === tier).reduce((n, x) => n + x.blocks, 0);
  return features + blocksFor(e.loose.filter((s) => s.clientKey === clientKey && s.tier === tier).map((s) => s.size ?? null));
}

/** "1 of 2 blocks done". */
export const progressWords = (env: Pick<Envelope<unknown>, "blocks" | "doneBlocks">) => `${env.doneBlocks} of ${blocksWord(env.blocks)} done`;

/** The row's plain status: "needs more stories", or the one-click raise prompt. Nothing when filled. */
export function fillWords(env: Pick<Envelope<unknown>, "fill" | "blocks" | "raiseTo">): string | null {
  if (env.fill === "needs_stories") return "needs more stories";
  if (env.fill === "over") return `Stories need more than ${blocksWord(env.blocks)}. Raise to ${env.raiseTo}?`;
  return null;
}

/** The client's plain status against its budget: "All 3 planned", "1 block free", "4 planned, 3 available". */
export function budgetWords(budget: number, planned: number): { kind: "none" | "all" | "free" | "over"; text: string } {
  if (planned > budget) return { kind: "over", text: `${planned} planned, ${budget} available` };
  if (!budget) return { kind: "none", text: "No blocks this week" };
  if (planned === budget) return { kind: "all", text: `All ${budget} planned` };
  return { kind: planned ? "free" : "none", text: `${blocksWord(budget - planned)} free` };
}

/** Old half-block counts (before step 16.4): features round up to whole blocks; a story becomes M (half) or L. */
export function migrateBlocks(level: "feature" | "story", blocks: number): { blocks: number; size: StorySize | null } {
  if (level === "story") return { blocks: Math.max(1, Math.ceil(blocks)), size: blocks <= 0.5 ? "M" : "L" };
  return { blocks: Math.min(MAX_BLOCKS, Math.max(1, Math.ceil(blocks))), size: null };
}

/**
 * U4: the one amber line under a client's musts when they need more blocks than it has: "2 blocks of musts, 1 block
 * free. Move one to nice to have, or borrow Friday." Friday is offered only when the week has a catch-up day.
 */
export function overLine(budget: number, planned: number, friday: boolean): string | null {
  if (planned <= budget) return null;
  const free = budget ? `${blocksWord(budget)} free` : "no blocks free";
  return `${blocksWord(planned)} of musts, ${free}. Move one to nice to have${friday ? ", or borrow Friday" : ""}.`;
}
