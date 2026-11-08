// BD-1: Break down, pure. The label follows the parent's type (from the process model, never a fixed word), the
// review's running total in hours (unsized as the person's assumption, dropped cards out), and moving a card for drag or keyboard reorder.
import { aboutText, storyMinutes, type SizeScale, type StorySize } from "./estimate.ts";

/** "Break down Feature", "Break down Recurring": the parent's type name as DevOps has it. */
export const breakdownLabel = (type: string | null | undefined) => `Break down ${type?.trim() || "item"}`;

/** "5 items · about 9h" for the kept proposals; none kept says so. */
export function reviewTotal(cards: readonly { keep: boolean; size: StorySize | null }[], sizes: SizeScale): string {
  const kept = cards.filter((c) => c.keep);
  if (!kept.length) return "Nothing kept";
  const minutes = kept.reduce((n, c) => n + storyMinutes(c.size, sizes), 0);
  return `${kept.length} ${kept.length === 1 ? "item" : "items"} · ${aboutText(minutes)}`;
}

/** The list with the card at `from` moved to `to` (both clamped); the same list when nothing moves. */
export function moveCard<T>(cards: readonly T[], from: number, to: number): T[] {
  const n = cards.length;
  if (from < 0 || from >= n) return [...cards];
  const j = Math.max(0, Math.min(n - 1, to));
  if (j === from) return [...cards];
  const next = [...cards];
  const [c] = next.splice(from, 1);
  next.splice(j, 0, c!);
  return next;
}
