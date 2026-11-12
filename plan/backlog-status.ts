// BL-1: the Backlog's Status, pure. One chip per row: the item's health when it has one (the roadmap state of a feature
// or epic: Blocked, At risk, Not scoped, Stalled, Watch, Needs a date, On track, Done) with its reason; otherwise its
// most important gap (Needs stories, No target date, Unassigned, Unsized, Stale). A calm health (On track, Done) asks for
// nothing, so a gap goes before it (a row in Needs attention never leads with "On track"). Every other reason is a
// quiet "+N" listing them. Two reasons that say one thing are one reason: Needs a date is No target date, Not scoped is Needs
// stories, Stalled is Stale; the health wins and the gap is dropped. A closed item has no status.
import { GAP_ACTION, GAP_WORDS, type GapKind } from "./fixnext.ts";
import { STATE_WORDS, type RoadmapStateKind } from "./roadmap.ts";

/** A gap, or Stale (an open item with no change in DevOps for the person's weeks). */
export type Need = GapKind | "stale";
/** The order gaps are weighed in: the first one a row has is its status when it has no health. */
export const NEED_ORDER: readonly Need[] = ["needs_stories", "no_dates", "unassigned", "unsized", "stale"];
export const NEED_WORDS: Record<Need, string> = { ...GAP_WORDS, stale: "Stale" };
/** The fix beside a need in Needs attention (Stale has none: the title opens the item to look at it). */
export const NEED_ACTION: Record<Need, string | null> = { ...GAP_ACTION, stale: null };

/** Health states that ask for nothing. */
const CALM: ReadonlySet<RoadmapStateKind> = new Set(["on_track", "done"]);
/** A health state and the gap that says the same thing. */
const SAME: Partial<Record<RoadmapStateKind, Need>> = { needs_date: "no_dates", not_scoped: "needs_stories", stalled: "stale" };

export type StatusReason = {
  key: string;
  text: string;
  /** The reason in words, for the tooltip and screen readers. */
  title: string;
  /** Something to do (amber dot); On track and Done ask for nothing. */
  action: boolean;
  need?: Need;
};
export type Status = { main: StatusReason | null; more: StatusReason[] };

export function statusOf(o: {
  open: boolean;
  health: { state: RoadmapStateKind; reason: string } | null;
  gaps: readonly GapKind[];
  /** "8 weeks" when the item is stale, else null. */
  stale: string | null;
}): Status {
  if (!o.open) return { main: null, more: [] };
  const out: StatusReason[] = [];
  const dropped = new Set<Need>();
  if (o.health) {
    const s = o.health.state;
    out.push({ key: `state:${s}`, text: STATE_WORDS[s], title: `${STATE_WORDS[s]}: ${o.health.reason}`, action: !CALM.has(s) });
    const same = SAME[s];
    if (same) dropped.add(same);
  }
  const needs: Need[] = [...o.gaps, ...(o.stale ? (["stale"] as const) : [])];
  for (const n of NEED_ORDER) {
    if (!needs.includes(n) || dropped.has(n)) continue;
    const title = n === "stale" ? `Stale: no change in DevOps for ${o.stale}` : `${NEED_WORDS[n]}: ${GAP_ACTION[n]}`;
    out.push({ key: `need:${n}`, text: NEED_WORDS[n], title, action: true, need: n });
  }
  // A calm health goes after the gaps; never two that read alike.
  const ordered = [...out.filter((r) => r.action), ...out.filter((r) => !r.action)];
  const seen = new Set<string>();
  const unique = ordered.filter((r) => (seen.has(r.text) ? false : (seen.add(r.text), true)));
  return { main: unique[0] ?? null, more: unique.slice(1) };
}

/** Everything a row's status says, in one line for a screen reader ("At risk: …; Unassigned"). */
export function statusWords(s: Status): string {
  if (!s.main) return "nothing to fix";
  return [s.main, ...s.more].map((r) => r.title).join("; ");
}
