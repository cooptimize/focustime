// PK-2: what the browser gets about a person's Pocket: connected or not, and the last check. Never the key.
import type { ListCounts } from "../plan/pocket-recordings.ts";

/**
 * PK-4 adds my own Pocket addresses (only to me, on my own Settings page) and the counts of the last list Calls asked
 * for, held in memory with that list for 5 minutes (numbers only, never a title, a name or anyone else's address).
 */
export type PocketView = { connected: boolean; checkedAt: string | null; recordings: number | null; addresses?: string[]; last?: { at: string; counts: ListCounts } | null };
