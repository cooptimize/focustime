// MC-4: which calls on my own calendar have a transcript in Teams, asked only when I open Calls (or press Refresh
// there), never on a schedule, in a job, from the assistant or the Teams bot.
//   - ExistsGrants: while one check runs, the Graph client's gate (sources/graph/meetings.ts) lets through, for that
//     person only, the "exists" requests for the join links of the calls the check took from their own calendar, and
//     the online meetings those resolve to. Never a transcript's text: the gate's "read" purpose never looks here.
//   - ExistsHold: the answers (yes, no, the tenant's setting off), per person, for 15 minutes, in the server's memory
//     only. Never in the database, a log, Export or the browser's storage. A failed request isn't held.
import { joinKey } from "../plan/meetings.ts";
import type { GateQuery } from "../sources/graph/meetings.ts";

/** The longest one check stays open (two or four batches of 20 take seconds). */
export const CHECK_MS = 2 * 60_000;
/** How long an answer is held in memory for its person. */
export const HOLD_MS = 15 * 60_000;
/** The most calls one opening of Calls (or one Check more) asks about; the rest say Not checked. */
export const CHECK_CAP = 40;

export type ExistsGrants = {
  /** Opens a check for this person and these join links; done() ends it. */
  open: (userId: string, joinUrls: readonly string[]) => { done: () => void };
  /** True only for an "exists" request on one of an open check's links (a meeting's transcripts come with the link it was found from). */
  allowed: (userId: string, q: GateQuery) => boolean;
};

export function createExistsGrants(now: () => number = () => Date.now()): ExistsGrants {
  type Grant = { id: number; userId: string; joins: Set<string>; until: number };
  const open = new Map<number, Grant>();
  let next = 1;
  const low = (s: string) => s.trim().toLowerCase();
  const sweep = () => {
    for (const [k, g] of open) if (g.until <= now()) open.delete(k);
  };
  return {
    open(userId, joinUrls) {
      sweep();
      const g: Grant = { id: next++, userId: low(userId), joins: new Set(joinUrls.map(joinKey)), until: now() + CHECK_MS };
      open.set(g.id, g);
      return { done: () => void open.delete(g.id) };
    },
    allowed(userId, q) {
      sweep();
      if (q.purpose !== "exists") return false;
      const who = low(userId);
      for (const g of open.values()) {
        if (g.userId !== who) continue;
        // A meeting's transcripts are asked with the join link Graph resolved it from, which must be one of this check's.
        if (q.joinUrl && g.joins.has(joinKey(q.joinUrl))) return true;
      }
      return false;
    },
  };
}

/** What a person's check said of one call (by its calendar key): held, never "failed". */
export type HeldAnswer = "yes" | "no" | "off";

export type ExistsHold = {
  get: (userId: string, key: string) => HeldAnswer | null;
  set: (userId: string, key: string, a: HeldAnswer) => void;
  /** Refresh: forget this person's answers. */
  clear: (userId: string) => void;
};

export function createExistsHold(now: () => number = () => Date.now()): ExistsHold {
  const held = new Map<string, Map<string, { a: HeldAnswer; at: number }>>();
  const low = (s: string) => s.trim().toLowerCase();
  return {
    get(userId, key) {
      const m = held.get(low(userId));
      const h = m?.get(key);
      if (!h) return null;
      if (now() - h.at > HOLD_MS) {
        m!.delete(key);
        return null;
      }
      return h.a;
    },
    set(userId, key, a) {
      const who = low(userId);
      let m = held.get(who);
      if (!m) held.set(who, (m = new Map()));
      for (const [k, h] of m) if (now() - h.at > HOLD_MS) m.delete(k);
      m.set(key, { a, at: now() });
    },
    clear(userId) {
      held.delete(low(userId));
    },
  };
}
