// HK-3: when someone last really used FocusTime (in memory). Moved only by a page call marked "active" (visible, with
// input in the last N minutes) or the page's once-a-minute report; background calls (polls, the quiet refresh) never
// move it. The idle rule (D431), DevOps' outside-hours checks (DV-1) and, through the scheduler, the chat poller read
// active(). N is the team's Rule `org.idle_minutes` (10 by default, 5 to 60), read from memory: never a database call.

// DV-2: also who (a person's id, in memory only), so DevOps checks a late worker's own clients at the hours pace.
export type UseSignal = { used: (userId?: string) => void; active: () => boolean; minutes: () => number; /** DV-2: this person used FocusTime in the last N minutes. */ activeUser: (userId: string) => boolean };

export function createUseSignal(o: { now: () => number; idleMinutes: () => number }): UseSignal {
  let last = Number.NEGATIVE_INFINITY;
  const by = new Map<string, number>();
  const fresh = (t: number) => o.now() - t < o.idleMinutes() * 60_000;
  return {
    used: (userId) => {
      last = o.now();
      if (!userId) return;
      by.set(userId.toLowerCase(), last);
      // Forget people who went idle, so the map stays small.
      if (by.size > 200) for (const [k, t] of by) if (!fresh(t)) by.delete(k);
    },
    active: () => fresh(last),
    minutes: () => o.idleMinutes(),
    activeUser: (userId) => fresh(by.get(userId.toLowerCase()) ?? Number.NEGATIVE_INFINITY),
  };
}
