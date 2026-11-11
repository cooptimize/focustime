// Step 17.5: when the loader shows, when the app is revealed, what each source says while loading, and whether
// today's work is all done (for the Close out moment). Pure.
import type { SourceSummary } from "../../actions/types.ts";
import type { ClientWork } from "../../week/types.ts";

/** A first load that finishes within this shows the app directly, with no loader. */
export const LOADER_DELAY_MS = 400;
/** Once shown, the loader stays at least this long, so it never flashes. */
export const LOADER_MIN_MS = 600;

/**
 * The opening for a first load that finished at `loadedAt` ms after the window opened (null while still loading):
 * whether the loader is up at `now`, and when the app is revealed (null until known). A failed source still counts
 * as loaded: it never holds the reveal back.
 */
export function openingAt(now: number, loadedAt: number | null): { loader: boolean; revealAt: number | null } {
  if (loadedAt !== null && loadedAt <= LOADER_DELAY_MS) return { loader: false, revealAt: loadedAt };
  const revealAt = loadedAt === null ? null : Math.max(loadedAt, LOADER_DELAY_MS + LOADER_MIN_MS);
  return { loader: now >= LOADER_DELAY_MS && (revealAt === null || now < revealAt), revealAt };
}

export type SourceState = "waiting" | "done" | "failed";
export type SourceLine = { name: string; state: SourceState };

const NAMES = { dataverse: "Dataverse", outlook: "Outlook", google: "Google" } as const;

/**
 * Dataverse, Outlook, Google and DevOps, each done, waiting or failed. Before the week arrives every source is
 * waiting (they load together); after, a source is done only when it loaded live or from its cache without a
 * problem. DevOps is failed when any client's fetch failed or Dataverse wasn't usable to find them.
 */
export function sourceLines(sources: readonly SourceSummary[] | null, devops: readonly ClientWork[] | null | undefined): SourceLine[] {
  const ids = ["dataverse", "outlook", "google"] as const;
  if (!sources) return [...ids.map((id) => ({ name: NAMES[id], state: "waiting" as const })), { name: "DevOps", state: "waiting" }];
  const lines: SourceLine[] = ids.flatMap((id) => {
    const s = sources.find((x) => x.source === id);
    return s ? [{ name: NAMES[id], state: s.status === "ok" ? "done" : "failed" } as SourceLine] : [];
  });
  const devopsFailed = devops == null || devops.some((c) => c.status !== "ok" && c.status !== "not_set_up");
  lines.push({ name: "DevOps", state: devopsFailed ? "failed" : "done" });
  return lines;
}

/** The words for a source line. */
export const sourceWord = (s: SourceState) => (s === "done" ? "done" : s === "failed" ? "didn't load" : "waiting");

type DayPick = { status: string };

/** CF-1: whether today's work is all done: at least one to-do planned or done today, and every one of them done. */
export function allDone(picks: readonly DayPick[]): boolean {
  const live = picks.filter((p) => p.status === "planned" || p.status === "done");
  return live.length > 0 && live.every((p) => p.status === "done");
}
