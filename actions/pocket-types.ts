// PK-2: what the browser gets about a person's Pocket: connected or not, and the last check. Never the key.
import type { ListCounts } from "../plan/pocket-recordings.ts";

/**
 * PK-4 adds my own Pocket addresses (only to me, on my own Settings page) and the counts of the last list Calls asked
 * for, held in memory with that list for 5 minutes (numbers only, never a title, a name or anyone else's address).
 */
export type PocketView = { connected: boolean; checkedAt: string | null; recordings: number | null; addresses?: string[]; last?: { at: string; counts: ListCounts } | null };

/** One listed recording as the page gets it: never who recorded it, its words or anything else Pocket sent. */
export type PocketRecordingView = { id: string; startAt: string; endAt: string; minutes: number; title: string };
/**
 * PK-4: the list as the page gets it: my recordings, the counts (numbers only), whether pages were left, when Pocket
 * was asked, and whether setting my Pocket address could help (something is under an address FocusTime doesn't know
 * me by and I have room for another).
 */
export type PocketListView = { recordings: PocketRecordingView[]; counts: ListCounts; more: boolean; at: string; days: number; canSetAddress: boolean };

