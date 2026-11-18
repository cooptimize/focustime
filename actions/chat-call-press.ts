// MC-2c: a press on a call started in a client's registered delivery chat. When a Cooptimizer who is in that chat and
// follows its client presses Review (or Get it from Teams) on it, the action checks the call and opens a press: for that
// one person, for that one call id, for PRESS_MS. The ad hoc call client's gate (sources/graph/adhoc-calls.ts) asks here
// before each of its two requests, so nothing else passes: not another person's sign-in, not another call, not the poll,
// a job, the assistant or the Teams bot, not a request after the press ends. Held in memory only, never stored or
// logged, and gone after PRESS_MS even if the press never ends. The same shape as actions/call-press.ts for a calendar
// call, kept apart so neither can let the other's requests through.
import { PRESS_MS } from "./call-press.ts";

export { PRESS_MS };

export type ChatCallPress = {
  /** The press is over: nothing more passes for it. */
  done: () => void;
};
export type ChatCallPresses = {
  open: (userId: string, callId: string) => ChatCallPress;
  /** True only while this person's press for this call id is open. */
  allowed: (userId: string, callId: string) => boolean;
};

export function createChatCallPresses(now: () => number = () => Date.now()): ChatCallPresses {
  type Grant = { id: number; userId: string; callId: string; until: number };
  const open = new Map<number, Grant>();
  let next = 1;
  const low = (s: string) => s.trim().toLowerCase();
  const sweep = () => {
    for (const [k, g] of open) if (g.until <= now()) open.delete(k);
  };
  return {
    open(userId, callId) {
      sweep();
      const g: Grant = { id: next++, userId: low(userId), callId, until: now() + PRESS_MS };
      open.set(g.id, g);
      return { done: () => void open.delete(g.id) };
    },
    allowed(userId, callId) {
      sweep();
      const who = low(userId);
      for (const g of open.values()) if (g.userId === who && g.callId === callId) return true;
      return false;
    },
  };
}
