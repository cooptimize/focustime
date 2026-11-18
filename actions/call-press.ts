// MC-2: a press, the third way the transcript rule lets FocusTime read a call (plan/meetings.ts `mayRead`). When a
// Cooptimizer who was on a call that isn't registered presses Get it from Teams, the action checks the call on their own
// calendar and opens a press: for that one person, for that one call's join link (and then the online meeting it
// resolves to), for one try. The Graph client's gate (sources/graph/meetings.ts) asks here before every request, so
// nothing else passes: not another person's sign-in, not another call, not the meeting job, not a second try after the
// press ends. Held in memory only, never stored or logged, and gone after PRESS_MS even if the press never ends.
import { joinKey } from "../plan/meetings.ts";

/** The longest one press stays open (a read of a few hours' transcript takes seconds). */
export const PRESS_MS = 2 * 60_000;

export type PressQuery = { joinUrl?: string; onlineMeetingId?: string };
export type OpenPress = {
  /** The online meeting the press's join link resolved to, for the transcript reads that follow. */
  meeting: (onlineMeetingId: string) => void;
  /** The press is over: nothing more passes for it. */
  done: () => void;
};
export type PressGrants = {
  open: (userId: string, joinUrl: string) => OpenPress;
  /** True only while this person's press for this call is open. */
  allowed: (userId: string, q: PressQuery) => boolean;
};

export function createPressGrants(now: () => number = () => Date.now()): PressGrants {
  type Grant = { id: number; userId: string; join: string; meeting: string | null; until: number };
  const open = new Map<number, Grant>();
  let next = 1;
  const low = (s: string) => s.trim().toLowerCase();
  const sweep = () => {
    for (const [k, g] of open) if (g.until <= now()) open.delete(k);
  };
  return {
    open(userId, joinUrl) {
      sweep();
      const g: Grant = { id: next++, userId: low(userId), join: joinKey(joinUrl), meeting: null, until: now() + PRESS_MS };
      open.set(g.id, g);
      return {
        meeting: (id) => void (open.has(g.id) && (g.meeting = id)),
        done: () => void open.delete(g.id),
      };
    },
    allowed(userId, q) {
      sweep();
      const who = low(userId);
      for (const g of open.values()) {
        if (g.userId !== who) continue;
        if (q.joinUrl && joinKey(q.joinUrl) === g.join) return true;
        if (q.onlineMeetingId && g.meeting && q.onlineMeetingId === g.meeting) return true;
      }
      return false;
    },
  };
}
