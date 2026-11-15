// Step 17.5: when the loader shows, when the app is revealed and what each source says while loading. BR-1: the
// mark's pass, and the one line the loader may show after 8 seconds. Pure; every time is in ms since the loader's mark started (its CSS, ui/brand/boot.css).
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

/** BR-1: the mark's pass (ui/brand/boot.css): a block lights every STEP_MS in reading order, every block is lit from
 *  ALL_LIT_MS into the pass, and a pass is PASS_MS long, the first starting as the mark appears (LOADER_DELAY_MS). */
export const STEP_MS = 120;
export const ALL_LIT_MS = 960;
export const PASS_MS = 1600;
/** The move into the top bar's mark while the app fades in. */
export const FLY_MS = 400;
/** The loader's one line shows only after this long (CSS, ui/brand/boot.css). */
export const WAIT_LINE_MS = 8000;


/** The loader's only words, after 8 seconds: what it is still waiting on, two names at most, then "and N more". */
export function waitingLine(lines: readonly SourceLine[]): string | null {
  const n = lines.filter((l) => l.state === "waiting").map((l) => l.name);
  if (!n.length) return null;
  if (n.length === 1) return `Still waiting on ${n[0]}`;
  if (n.length === 2) return `Still waiting on ${n[0]} and ${n[1]}`;
  return `Still waiting on ${n[0]}, ${n[1]} and ${n.length - 2} more`;
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
