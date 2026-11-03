// Which clients FocusTime follows (step 6d): DevOps is fetched, and Open half-days offer work, only for these.
// Pure: Focus Time patterns (mine), today and the settings in, a state with its reason out.
import type { FocusPattern, IsoDate } from "./types.ts";

/** The internal account: always followed. */
export const INTERNAL_CLIENT = "Cooptimize";

export type FollowState =
  | { active: true; why: "internal" | "standing" | "kept" | "ongoing" }
  | { active: true; why: "until"; date: IsoDate }
  | { active: true; why: "grace"; date: IsoDate; until: IsoDate }
  | { active: false; why: "ended"; date: IsoDate }
  | { active: false; why: "none" };

export type FollowOptions = {
  today: IsoDate;
  /** Days after a pattern's end date the client is still followed (inclusive). */
  graceDays: number;
  /** Standing-block clients (config): always followed. */
  always: readonly string[];
  /** Clients set to "Keep following" in Settings > Clients. */
  kept: readonly string[];
};

const cmp = (a: IsoDate, b: IsoDate) => Temporal.PlainDate.compare(a, b);

export function followState(clientKey: string, patterns: readonly FocusPattern[], o: FollowOptions): FollowState {
  if (clientKey === INTERNAL_CLIENT) return { active: true, why: "internal" };
  if (o.always.includes(clientKey)) return { active: true, why: "standing" };
  const mine = patterns.filter((p) => p.active && p.clientKey === clientKey);
  if (mine.some((p) => p.endDate === null)) return { active: true, why: "ongoing" };
  const last = mine.map((p) => p.endDate!).sort(cmp).at(-1);
  if (last && cmp(last, o.today) >= 0) return { active: true, why: "until", date: last };
  if (last) {
    const until = Temporal.PlainDate.from(last).add({ days: o.graceDays }).toString();
    if (o.graceDays > 0 && cmp(until, o.today) >= 0) return { active: true, why: "grace", date: last, until };
  }
  if (o.kept.includes(clientKey)) return { active: true, why: "kept" };
  return last ? { active: false, why: "ended", date: last } : { active: false, why: "none" };
}

/** The followed clients of a list, in its order. */
export function followedKeys<T extends { clientKey: string }>(clients: readonly T[], patterns: readonly FocusPattern[], o: FollowOptions): T[] {
  return clients.filter((c) => followState(c.clientKey, patterns, o).active);
}
