// DV-2: what a page may know about its clients' DevOps (versions and check times, never an item), Refresh's answer
// and Find an item's. Types only, shared by the server and the page.
import type { FindLine } from "./find-item.ts";

/** One client's DevOps version and freshness. */
export type Freshness = {
  clientKey: string;
  /** Moves whenever a change for the client reaches the store (null: none yet). */
  version: string | null;
  checkedAt: string | null;
  okAt: string | null;
  /** When the next check is due (null: now, or not known). */
  nextAt: string | null;
  problem: FreshProblem | null;
};
export type FreshProblem = { kind: "slowed" | "refused" | "failed" | "first"; words: string };
/** Refresh's answer for one client. `changes` is what the check it ran (or the one just before) found. */
export type ForcedCheck = Freshness & { forced: boolean; pending: boolean; changes: number | null };

export type VersionsAnswer = { clients: (Freshness & { clientName: string })[]; serverNow: string };
export type RefreshAnswer = { clients: (ForcedCheck & { clientName: string })[]; line: string; problems: string[]; serverNow: string };
export type FindAnswer = { clientName: string; id: number; lines: FindLine[] };
