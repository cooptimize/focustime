// WP-1: how DevOps patterns reads DevOps in the hosted app: through a second app-level DevOps source (the same client
// code as the poller's, the poller's target with the company read PAT, kept in memory as before) with a limiter of its
// own, so its responses never count toward the poller's pace. It always gives way to the poller:
// - while DevOps asked the poller to wait (the shared limiter's hold), nothing;
// - while the poller's next check of the client is due within 15 s, or was due in the last minute (it is probably
//   running), nothing;
// - while the last response this reader saw left less than half the budget (the poller slows at a fifth), nothing for a
//   minute; a delayed response, nothing for five.
// A refusal (429 or Retry-After) on this reader's request holds the shared limiter too: DevOps asked, and the poller
// would only be refused. Plain words for each wait go to the page.
import type { Limiter } from "../sources/devops/source.ts";
import { DevOpsFailure, type DevOpsInternal } from "../sources/devops/source.ts";
import type { DevOpsTarget } from "../sources/devops/types.ts";
import { readRate } from "../plan/devops-pace.ts";
import { countsAsDone, isClosed, isProposed } from "../plan/process.ts";
import type { Freshness } from "../plan/devops-fresh-types.ts";
import type { PatternsReader } from "./patterns-run.ts";
import type { ClientLimiter } from "./devops-poll.ts";

/** Wait while less than this share of the budget is left (the poller slows down at 0.2). */
export const LOW_SHARE = 0.5;
export const LOW_WAIT_MS = 60_000;
export const DELAY_WAIT_MS = 5 * 60_000;
/** The poller's next check closer than this (or this recently past): give way. */
export const POLLER_AHEAD_MS = 15_000;
export const POLLER_BEHIND_MS = 60_000;

export type PatternsLimiter = Limiter & {
  /** Why to wait now, from this limiter's own responses (null: go). */
  why(clientKey: string): string | null;
};

export function createPatternsLimiter(shared: Pick<ClientLimiter, "waiting" | "hold">, now: () => Temporal.Instant): PatternsLimiter {
  const seen = new Map<string, { low: number | null; delayed: number | null; until: number | null }>();
  const of = (k: string) => seen.get(k) ?? seen.set(k, { low: null, delayed: null, until: null }).get(k)!;
  return {
    before(k) {
      const s = of(k);
      if (shared.waiting(k) || (s.until !== null && s.until > now().epochMilliseconds)) throw new DevOpsFailure("error", "DevOps asked FocusTime to wait");
    },
    after(k, status, headers) {
      const r = readRate(status, headers);
      const s = of(k);
      const t = now().epochMilliseconds;
      if (r.limit !== null && r.remaining !== null && r.limit > 0) s.low = r.remaining / r.limit < LOW_SHARE ? t : null;
      if (r.delayS !== null && r.delayS > 0) s.delayed = t;
      const refused = status === 429 || status === 503;
      const wait = refused ? (r.retryAfterS ?? 60) : r.retryAfterS;
      if (wait && wait > 0) {
        s.until = t + wait * 1000;
        shared.hold(k, new Date(s.until).toISOString());
      }
    },
    why(k) {
      const s = of(k);
      const t = now().epochMilliseconds;
      if (shared.waiting(k) || (s.until !== null && s.until > t)) return "DevOps asked FocusTime to wait";
      if (s.delayed !== null && t - s.delayed < DELAY_WAIT_MS) return "DevOps is delaying requests";
      if (s.low !== null && t - s.low < LOW_WAIT_MS) return "Waiting for DevOps budget";
      return null;
    },
  };
}

export function createPatternsReader(d: {
  /** The second app-level source, built with `limiter`. */
  source: () => DevOpsInternal;
  limiter: PatternsLimiter;
  /** The poller's target for a client (the read PAT in memory), null when it has none. */
  target: (clientKey: string) => Promise<DevOpsTarget | null>;
  /** The poller's freshness (when its next check of each client is due). */
  freshness: (clientKeys: readonly string[]) => Promise<Freshness[]>;
  clients: () => Promise<string[]>;
  now: () => Temporal.Instant;
}): PatternsReader {
  const targetOf = async (k: string) => {
    const t = await d.target(k);
    if (!t) throw new DevOpsFailure("error", "DevOps isn't set up for this client");
    return t;
  };
  return {
    clients: d.clients,
    async process(k) {
      const m = await d.source().meta(await targetOf(k));
      const cat = (type: string, state: string) => m.meta.categories.get(type)?.get(state.toLowerCase()) ?? null;
      const estimateFields = [...new Set([...(m.fields.size ? [m.fields.size] : []), ...Object.values(m.fields.sizes ?? {})])];
      return { closed: (t, s) => countsAsDone(cat(t, s)) || isClosed(cat(t, s)), proposed: (t, s) => isProposed(cat(t, s)), estimateFields };
    },
    async ids(k, wiql, top) {
      return (await d.source().ids(await targetOf(k), wiql, top)).ids;
    },
    async batch(k, ids, fields) {
      return d.source().batch(await targetOf(k), ids, [...fields]);
    },
    async updates(k, id) {
      return d.source().updates(await targetOf(k), id);
    },
    async wait(k) {
      const own = d.limiter.why(k);
      if (own) return own;
      const f = (await d.freshness([k]).catch(() => []))[0];
      if (f?.nextAt) {
        const gap = Date.parse(f.nextAt) - d.now().epochMilliseconds;
        if (gap < POLLER_AHEAD_MS && gap > -POLLER_BEHIND_MS) return "Giving way to FocusTime's own DevOps check";
      }
      return null;
    },
  };
}
