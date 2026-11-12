// WP-2: one client's inventory as the page shows it now, from its items in scope and each type's kind (the person's
// choice, else the guess): the kinds with the numbers behind each guess, Build work's numbers (the default view), and
// Tickets and support in short. Worked out on each request, so a changed kind shows at once; the snapshot a run saves
// keeps what it was then. Also the small numbers rule, shared by the page and the summary. Pure.
import { inventoryOf, ticketsOf, type Snapshot, type Tickets } from "./inventory.ts";
import { kindFacts, kindOfType, kindsOf, type Kind, type KindFacts } from "./kinds.ts";
import type { PatternItem } from "./types.ts";

/** WP-2: any figure built on fewer than this many items is marked "too few to read". */
export const FEW = 20;
export const FEW_WORDS = "too few to read";
export const tooFew = (n: number | null | undefined): boolean => (n ?? 0) < FEW;

/** A share as words, with its base: "42% of 310", or "too few to read (12)" under FEW. */
export function shareWords(v: number | null | undefined, n: number | null | undefined, o: { base?: boolean } = {}): string {
  if (v === null || v === undefined || !n) return "n/a";
  if (tooFew(n)) return `${FEW_WORDS} (${n})`;
  return `${Math.round(v * 100)}%${o.base === false ? "" : ` of ${n}`}`;
}
/** A count as words, marked under FEW. */
export const countWords = (c: number): string => (tooFew(c) ? `${c}, ${FEW_WORDS}` : String(c));

export type KindRow = KindFacts & { kind: Kind; chosen: boolean };
export type ClientAnalysis = { kinds: KindRow[]; build: Snapshot; tickets: Tickets; leftOut: number; kindsMap: Record<string, Kind> };

export function analysisOf(items: readonly PatternItem[], chosen: Readonly<Record<string, Kind>>, o: { firstItemAt: string | null; windowFrom: string }): ClientAnalysis {
  const facts = kindFacts(items);
  const kinds = kindsOf(facts, chosen);
  const kindOf = (t: string) => kindOfType(kinds, t);
  const inScope = items.filter((i) => i.inWindow);
  return {
    kinds: facts.map((f) => ({ ...f, kind: kinds[f.type] ?? f.guess, chosen: f.type in chosen })),
    // Build work: its items in scope, with every parent read for structure (whatever its kind) so chains stay whole.
    build: inventoryOf(items.filter((i) => !i.inWindow || kindOf(i.type) === "build"), o),
    tickets: ticketsOf(inScope.filter((i) => kindOf(i.type) === "tickets")),
    leftOut: inScope.filter((i) => kindOf(i.type) === "leave_out").length,
    kindsMap: kinds,
  };
}
