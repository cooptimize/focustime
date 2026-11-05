// HK-3: when someone last really used FocusTime (in memory). Moved only by a page call marked "active" (visible, with
// input in the last N minutes) or the page's once-a-minute report; background calls (polls, the quiet refresh) never
// move it. The idle rule (D431), DevOps' outside-hours checks (DV-1) and, through the scheduler, the chat poller read
// active(). N is the team's Rule `org.idle_minutes` (10 by default, 5 to 60), read from memory: never a database call.

export type UseSignal = { used: () => void; active: () => boolean; minutes: () => number };

export function createUseSignal(o: { now: () => number; idleMinutes: () => number }): UseSignal {
  let last = Number.NEGATIVE_INFINITY;
  return {
    used: () => void (last = o.now()),
    active: () => o.now() - last < o.idleMinutes() * 60_000,
    minutes: () => o.idleMinutes(),
  };
}
