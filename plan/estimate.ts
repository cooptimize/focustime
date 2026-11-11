// Estimating in hours (E2, D446; was half blocks, E1). A block is only the calendar unit: the half-day where the work
// happens. How much work is always time, kept in minutes and shown as whole hours ("about 6h"), never a fraction, a
// decimal or a block. XS, S, M and L are shortcuts: 30 min (TX-1), 1h, 2h and 4h. Sizing is optional: an unsized story counts as the
// person's own assumption (SZ-1: Settings › Planning, 1h by default) in every fit and budget, marked as an assumption,
// never an error. That one value travels in the SizeScale; no other code holds the number.
//
// A feature's load this week:
// - from its stories: when stories under it are on the week list and at least one is sized, the sum of all of them
//   (unsized ones as the person's assumption). Its typed estimate is ignored then (and its stepper hidden: "from its stories").
// - its estimate: otherwise, the person's estimate in whole hours (1 to 80), 4h when none was set.
// A story on the list without its feature counts its own size (or the assumption). Nested stories never add to the client's
// total beyond their feature's load. Pure: no I/O.

export type StorySize = "XS" | "S" | "M" | "L";
export const STORY_SIZES: readonly StorySize[] = ["XS", "S", "M", "L"];
/** The one table of sizes: XS 30 min (TX-1), S 1h, M 2h, L 4h, in minutes. */
export const STORY_MINUTES: Readonly<Record<StorySize, number>> = { XS: 30, S: 60, M: 120, L: 240 };
/** SZ-1: what a person may count unsized work as, in minutes (Settings › Planning, `[plan] unsized_minutes`). */
export const UNSIZED_CHOICES: readonly number[] = [30, 60, 120, 180];
/** SZ-1: the one default for unsized work: 1h. The only place this number is written. */
export const DEFAULT_UNSIZED_MINUTES = 60;
export const validUnsizedMinutes = (n: unknown): n is number => typeof n === "number" && UNSIZED_CHOICES.includes(n);
/** The scale every fit, budget and chip reads: the fixed S, M and L, and what this person counts unsized work as. */
export type SizeScale = Readonly<Record<StorySize, number> & { unsized: number }>;
export const DEFAULT_SIZE_SCALE: SizeScale = { ...STORY_MINUTES, unsized: DEFAULT_UNSIZED_MINUTES };
/** A feature with no estimate and no sized stories: 4h. */
export const DEFAULT_FEATURE_MINUTES = 240;
/** A feature estimate in whole hours: 1 to 80. */
export const MIN_ESTIMATE_HOURS = 1;
export const MAX_ESTIMATE_HOURS = 80;

export const validStorySize = (s: unknown): s is StorySize => s === "XS" || s === "S" || s === "M" || s === "L";
/** Whole hours, 1 to 80. */
export const validEstimateHours = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= MIN_ESTIMATE_HOURS && n <= MAX_ESTIMATE_HOURS;
/** A stored estimate: whole hours in minutes, 60 to 4800. */
export const validEstimateMinutes = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n % 60 === 0 && validEstimateHours(n / 60);

/** A story's or a to-do's minutes: its size, or the person's assumption when unsized. */
export const storyMinutes = (size: string | null | undefined, scale: SizeScale): number => (size && validStorySize(size) ? scale[size] : scale.unsized);
/**
 * The named size unsized work stands in for where a size has to be named (shortest useful time, sort order, Make
 * smaller): the smallest one that holds the assumption. 30 min and 1h are S, 2h is M, 3h is L.
 */
export const namedSize = (size: StorySize | null | undefined, scale: SizeScale): StorySize => size ?? STORY_SIZES.find((z) => scale.unsized <= scale[z]) ?? "L";

/** Whole hours: "6h". More than nothing but under half an hour reads "under 1h"; nothing is "0h". */
export function hoursText(minutes: number): string {
  const m = Math.max(0, minutes);
  if (m > 0 && m < 30) return "under 1h";
  return `${Math.round(m / 60)}h`;
}
/** An estimate: "about 6h". */
export const aboutText = (minutes: number) => `about ${hoursText(minutes)}`;
/** The assumption in words: "30 min", "1h", "2h", "3h" (under an hour is the one place a size isn't whole hours). */
export const unsizedText = (scale: SizeScale) => (scale.unsized < 60 ? `${scale.unsized} min` : hoursText(scale.unsized));
/** A size in words: "2h", or "30 min" for XS (like SZ-1's 30 minute assumption, the rounded "1h" would misstate it). */
export const sizeWords = (size: StorySize, scale: SizeScale) => (scale[size] < 60 ? `${scale[size]} min` : hoursText(scale[size]));
/** A size chip: "M · 2h", or "Size? · 1h" for an unsized story (the words say it is an assumption). */
export const sizeChipText = (size: StorySize | null | undefined, scale: SizeScale) => (size && validStorySize(size) ? `${size} · ${sizeWords(size, scale)}` : `Size? · ${unsizedText(scale)}`);

/**
 * The shared stepper (Plan the week, Plan ahead, the detail panel): 1h steps up to 8h, 2h above, within 1 and 80.
 * A typed value off the 2h grid above 8h steps to the next even hour.
 */
export function stepHours(hours: number, delta: 1 | -1): number {
  const h = Math.round(hours);
  const next = delta > 0 ? (h < 8 ? h + 1 : h % 2 ? h + 1 : h + 2) : h <= 8 ? h - 1 : h % 2 ? h - 1 : h - 2;
  return Math.max(MIN_ESTIMATE_HOURS, Math.min(MAX_ESTIMATE_HOURS, next));
}
/** A typed stepper value: whole hours 1 to 80 ("6" or "6h"), else null (the box keeps the old value). */
export function parseHours(text: string): number | null {
  const t = text.trim().replace(/h$/i, "").trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return validEstimateHours(n) ? n : null;
}

/** TX-1: what a story still needs: the time left once a check-in has said, else its size. */
export const storyLoad = (s: { size?: string | null; remainingMinutes?: number | null }, scale: SizeScale): number => s.remainingMinutes ?? storyMinutes(s.size, scale);

export type EstItem = {
  clientKey: string;
  itemId: number;
  level: "feature" | "story";
  /** Features: the person's estimate in minutes (whole hours), or null for the default (4h). Stories: ignored. */
  estimate: number | null;
  /** Stories: XS, S, M or L, or null when not sized yet. Features: ignored. */
  size?: StorySize | null;
  /** TX-1: time left once a check-in has said. */
  remainingMinutes?: number | null;
  /** A story's parent feature in DevOps, when known. */
  parentId?: number | null;
  done?: unknown;
};

export type Envelope<T> = {
  feature: T;
  /** The stories on the list under it. */
  stories: T[];
  /** Its load this week in minutes. */
  minutes: number;
  /** True when the load comes from its stories (at least one sized): the estimate is ignored and its stepper hidden. */
  derived: boolean;
  /** Most of its stories on the list aren't sized: the row says "estimate · stories not sized", not "from stories". */
  unsized: boolean;
  /** Minutes done: all when the feature is done, else its done stories' share. */
  doneMinutes: number;
};
export type Estimate<T> = { envelopes: Envelope<T>[]; loose: T[]; /** SZ-1: the scale it was made with. */ scale: SizeScale };

/**
 * Features as envelopes: each listed story whose parent feature is on the same client's list nests under it; the rest
 * stay loose (their own rows). A feature's load comes from its stories when one is sized, else its estimate.
 */
export function estimate<T extends EstItem>(items: readonly T[], scale: SizeScale): Estimate<T> {
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
    const sized = stories.filter((s) => validStorySize(s.size)).length;
    const derived = sized > 0;
    const minutes = derived ? stories.reduce((n, s) => n + storyLoad(s, scale), 0) : f.estimate != null && validEstimateMinutes(f.estimate) ? f.estimate : DEFAULT_FEATURE_MINUTES;
    const doneStories = stories.filter((s) => !!s.done);
    const doneMinutes = f.done
      ? minutes
      : derived
        ? Math.min(minutes, doneStories.reduce((n, s) => n + storyLoad(s, scale), 0))
        : stories.length
          ? Math.round((minutes * doneStories.length) / stories.length)
          : 0;
    return { feature: f, stories, minutes, derived, unsized: stories.length > 0 && stories.length - sized > stories.length / 2, doneMinutes };
  });
  return { envelopes, loose, scale };
}

/**
 * Minutes planned per client (CF-1: one total, every feature on the week the same): each feature's load, plus loose stories by size (unsized as the assumption). PL-1: work marked
 * done in the estimate (weekBudget marks what DevOps has resolved, closed or removed) counts zero: a resolved feature
 * all of it, a resolved story under a feature its share, a resolved loose story its size.
 */
export function plannedMinutesOf<T extends EstItem>(e: Estimate<T>, clientKey: string): number {
  const features = e.envelopes.filter((x) => x.feature.clientKey === clientKey).reduce((n, x) => n + Math.max(0, x.minutes - x.doneMinutes), 0);
  return features + e.loose.filter((s) => s.clientKey === clientKey && !s.done).reduce((n, s) => n + storyLoad(s, e.scale), 0);
}

/** A feature's load in words: "6h" when every story under it is sized, else "about 6h". */
export function loadText(env: Pick<Envelope<Pick<EstItem, "size">>, "minutes" | "derived" | "stories">): string {
  const exact = env.derived && env.stories.every((s) => validStorySize(s.size));
  return exact ? hoursText(env.minutes) : aboutText(env.minutes);
}

/** Where the load comes from, under the row: "from stories", "estimate · stories not sized", or nothing (no stories). */
export function sourceWords(env: Pick<Envelope<unknown>, "derived" | "unsized">): string | null {
  if (env.unsized) return "estimate · stories not sized";
  return env.derived ? "from stories" : null;
}

/** "2h of about 6h done". */
export const progressWords = (env: Pick<Envelope<Pick<EstItem, "size">>, "minutes" | "doneMinutes" | "derived" | "stories">) => `${hoursText(env.doneMinutes)} of ${loadText(env)} done`;

/** Over by this much or less still fits (sizes are estimates): the same grace as a block's fit (plan/fit.ts). */
export const OVER_GRACE_MINUTES = 10;
/** Planned past free time by more than the grace. */
export const isOver = (plannedMinutes: number, freeMinutes: number) => plannedMinutes - freeMinutes > OVER_GRACE_MINUTES;
/**
 * Hours over, as the words beside it show them: the rounded planned hours less the rounded free hours, so "8h free ·
 * 10h planned" is "about 2h over", never 3h. Under an hour that way (but over the grace) is "a little over".
 */
export const overHours = (plannedMinutes: number, freeMinutes: number) => Math.round(Math.max(0, plannedMinutes) / 60) - Math.round(Math.max(0, freeMinutes) / 60);
/** "about 2h over", or "a little over". */
export const overText = (plannedMinutes: number, freeMinutes: number) => {
  const h = overHours(plannedMinutes, freeMinutes);
  return h < 1 ? "a little over" : `about ${h}h over`;
};

/**
 * A client's week in words (Plan the week's line and header, Plan ahead): "7h free" and "9h planned", with the amber
 * "about 2h over" when what's on its week needs more than its free time. Never red.
 */
export function budgetWords(freeMin: number, plannedMin: number, planShare = 100, keepOpen = 0): { kind: "none" | "all" | "free" | "over"; free: string; planned: string | null; over: string | null; text: string; /** PL-1: minutes it plans up to (the over line). */ line: number } {
  // ADM-1: "Plan up to N% of free time" (a person's guidance) moves only where the amber over line falls; it never
  // blocks. PL-1: a client's "Keep open" share joins it: planned up to = free × share × (1 − keep open).
  const share = Math.min(100, Math.max(50, Math.round(planShare)));
  const keep = Math.min(80, Math.max(0, Math.round(keepOpen)));
  const reduced = share < 100 || keep > 0;
  const line = reduced ? Math.round((freeMin * share * (100 - keep)) / 10_000) : freeMin;
  const free = freeMin > 0 ? `${hoursText(freeMin)} free` : "No focus time this week";
  const upTo = reduced && freeMin > 0 ? `plan up to ${hoursText(line)}` : null;
  const planned = plannedMin > 0 ? `${hoursText(plannedMin)} planned` : null;
  const text = [free, upTo, planned].filter(Boolean).join(" · ");
  if (isOver(plannedMin, line)) return { kind: "over", free, planned, over: overText(plannedMin, line), text, line };
  if (!plannedMin) return { kind: "none", free, planned, over: null, text, line };
  return { kind: line - plannedMin < 30 ? "all" : "free", free, planned, over: null, text, line };
}

/**
 * The one amber line when a client's week needs more than its free time: "About 2h more than Northwind's free time
 * this week. Move one to another week, or borrow Friday." Friday only when the week has a catch-up day.
 */
export function overLine(clientName: string, freeMin: number, plannedMin: number, friday: boolean): string | null {
  if (!isOver(plannedMin, freeMin)) return null;
  const h = overHours(plannedMin, freeMin);
  const amount = h < 1 ? "A little more" : `About ${h}h more`;
  return `${amount} than ${clientName}'s free time this week. Move one to another week${friday ? ", or borrow Friday" : ""}.`;
}

/** 1 block = 4h: what E1 (half blocks) and step 16.4 (whole blocks) stored, as minutes to the nearest hour (1h to 80h). */
export function blocksToMinutes(blocks: number): number {
  const hours = Math.round(blocks * 4);
  return Math.max(MIN_ESTIMATE_HOURS, Math.min(MAX_ESTIMATE_HOURS, hours)) * 60;
}
