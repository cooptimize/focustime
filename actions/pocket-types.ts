// PK-2: what the browser gets about a person's Pocket: connected or not, and the last check. Never the key.
export type PocketView = { connected: boolean; checkedAt: string | null; recordings: number | null };
