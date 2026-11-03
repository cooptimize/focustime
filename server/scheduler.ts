// A2: the one scheduler for everyone's background work (server/ticks.ts): a fast pass every 5 seconds and a slow one
// every 30, each over every known person, reading what is due from their rows. A pass never overlaps one of its own
// kind; people run side by side, and one person's failure doesn't stop the others'. At start both passes run at once,
// so a timer that ended while the server was down ends now. (A4: one replica holds a lease before running passes.)
import type { Logger } from "../log/logger.ts";
import type { PersonTicks } from "./ticks.ts";

export type PassKind = "fast" | "slow";

export function createScheduler(o: { people: () => Iterable<PersonTicks>; log: Logger; fastMs?: number; slowMs?: number }) {
  const running: Record<PassKind, boolean> = { fast: false, slow: false };

  /** One pass of a kind for everyone; how many people it ran for (0 when one of its kind is still running). */
  async function pass(kind: PassKind): Promise<number> {
    if (running[kind]) return 0;
    running[kind] = true;
    try {
      const people = [...o.people()];
      const r = await Promise.allSettled(people.map((t) => t[kind]()));
      const failed = r.filter((x) => x.status === "rejected").length;
      if (failed) o.log({ source: "plan", op: "scheduler", kind: `${kind}_failed`, count: failed });
      return people.length;
    } finally {
      running[kind] = false;
    }
  }

  /** Starts the passes; returns the stop. */
  function start(): () => void {
    // The timer first, so a session that ended while the server was down ends before reminders are weighed.
    void pass("fast").then(() => pass("slow"));
    const timers = [setInterval(() => void pass("fast"), o.fastMs ?? 5_000), setInterval(() => void pass("slow"), o.slowMs ?? 30_000)];
    for (const t of timers) t.unref();
    return () => timers.forEach(clearInterval);
  }

  return { pass, start };
}
