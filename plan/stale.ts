// BH-1: Stale, pure (its own module since AH-6, so the model can filter by it in every mode).
import { isOpen as isOpenCategory } from "./process.ts";

const dayOf = (at: string): string | null => (/^\d{4}-\d{2}-\d{2}/.test(at) ? at.slice(0, 10) : null);

/** Whole days since an instant's day, or null when it isn't known. */
export function ageDays(changedAt: string | null | undefined, today: string): number | null {
  const d = changedAt ? dayOf(changedAt) : null;
  if (!d) return null;
  return Math.max(0, Temporal.PlainDate.from(d).until(Temporal.PlainDate.from(today), { largestUnit: "days" }).days);
}

/** Open and untouched for at least `weeks` weeks. */
export function isStale(i: { stateCategory: string; changedAt: string | null | undefined }, today: string, weeks: number): boolean {
  if (!isOpenCategory(i.stateCategory)) return false;
  const days = ageDays(i.changedAt, today);
  return days !== null && days >= weeks * 7;
}

