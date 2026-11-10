// FN-1: Wrap it up, the one sheet for finishing work on a DevOps story (a tick anywhere, the check-ins, the Teams
// card). Pure rules: which states to offer, the outcome word on the comment, and the one-line summary of every write.
// Never a state name: states come from the item's type in the process model, by category.
import type { StateInfo } from "./devopswrite.ts";
import { isCompleted, isProposed, isResolved, isRemoved, isOpen } from "./process.ts";

export type WrapOutcome = "finished" | "progress";

/** The person's pick in Settings › Today and Week: ask (the sheet) or always skip DevOps (a plain tick). */
export type WrapSetting = "ask" | "never";

/**
 * Finished's states: every state in the Completed category, then the Resolved ones, in the process's order. The one
 * chosen: the Completed state this person used most on this client (from the write log), else the first Completed,
 * else the first Resolved. Empty when the type has neither (no Finished in DevOps, only in FocusTime).
 */
export function finishChoices(states: readonly StateInfo[], used: Readonly<Record<string, number>> = {}): { choices: string[]; chosen: string | null } {
  const completed = states.filter((s) => isCompleted(s.category)).map((s) => s.name);
  const resolved = states.filter((s) => isResolved(s.category)).map((s) => s.name);
  const choices = [...completed, ...resolved];
  if (!choices.length) return { choices, chosen: null };
  const best = [...completed].sort((a, b) => (used[b] ?? 0) - (used[a] ?? 0))[0];
  const chosen = best && (used[best] ?? 0) > 0 ? best : (completed[0] ?? resolved[0]!);
  return { choices, chosen };
}

/**
 * Made progress keeps the item's state, with one exception: an item still in a Proposed state (New) moves to the
 * type's first In Progress state (Active), because work has started. Null when it stays as it is.
 */
export function progressState(states: readonly StateInfo[], current: string): string | null {
  const now = states.find((s) => s.name === current)?.category;
  if (!isProposed(now)) return null;
  // The first open state that isn't Proposed: the type's In Progress state.
  return states.find((s) => isOpen(s.category) && !isProposed(s.category) && !isRemoved(s.category))?.name ?? null;
}

const OUTCOME_WORD: Record<WrapOutcome, string> = { finished: "Done", progress: "Progress" };
/** Words that already say the outcome at the start of a comment, so nothing is added. */
const SAYS = /^\s*(done|finished|complete|completed|closed|progress|partly|partially|in progress|wip)\b/i;

/** The comment as posted: the outcome word first ("Done: …", "Progress: …") unless the person wrote one. Empty stays empty. */
export function withOutcome(outcome: WrapOutcome, text: string): string {
  const t = text.trim();
  if (!t) return "";
  return SAYS.test(t) ? t : `${OUTCOME_WORD[outcome]}: ${t}`;
}

/** The placeholder for the comment box. */
export const commentPlaceholder = (outcome: WrapOutcome) => (outcome === "finished" ? "Done: …" : "Progress: … Next: …");

/** Hours for Remaining Work from minutes left, in 0.5 hour steps (DevOps keeps hours). */
export const leftHours = (minutes: number) => Math.round((Math.max(0, minutes) / 60) * 2) / 2;

/** One write in the sheet's preview line. A state write may carry the comment in the same change. */
export type WrapStep = { itemId: number; kind: "state" | "comment" | "remaining_work"; before?: string | null; after?: string | null; comment?: boolean };

/** "#504: state Active → Closed · add comment · Remaining Work 0 · #500: add comment" */
export function wrapSummary(steps: readonly WrapStep[]): string {
  const byItem = new Map<number, string[]>();
  for (const s of steps) {
    const words = s.kind === "state" ? [`state ${s.before ?? "?"} → ${s.after ?? "?"}`, ...(s.comment ? ["add comment"] : [])] : s.kind === "comment" ? ["add comment"] : [`Remaining Work ${s.after ?? "0"}`];
    byItem.set(s.itemId, [...(byItem.get(s.itemId) ?? []), ...words]);
  }
  return [...byItem.entries()].map(([id, w]) => `#${id}: ${w.join(" · ")}`).join(" · ");
}

/** Quick picks for time left, in minutes (TX-1's). */
export const LEFT_PICKS: readonly [number, string][] = [[30, "30m"], [60, "1h"], [90, "1.5h"], [120, "2h"]];

/** "45m", "2.5h", "2h 30m", "90" (minutes) → minutes, or null. 5 minutes to 40 hours. */
export function parseLeftText(s: string): number | null {
  const t = s.trim().toLowerCase();
  let m: RegExpExecArray | null;
  let v: number | null = null;
  if ((m = /^(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?\s*(?:(\d+)\s*m(?:in(?:utes?)?)?)?$/.exec(t))) v = Math.round(Number(m[1]) * 60) + (m[2] ? Number(m[2]) : 0);
  else if ((m = /^(\d+)\s*m(?:in(?:utes?)?)?$/.exec(t))) v = Number(m[1]);
  else if ((m = /^(\d+)$/.exec(t))) v = Number(m[1]);
  if (v === null || !Number.isFinite(v)) return null;
  v = Math.round(v / 5) * 5;
  return v >= 5 && v <= 2400 ? v : null;
}
