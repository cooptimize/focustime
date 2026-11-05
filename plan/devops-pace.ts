// DV-1: how often the central DevOps poller checks a client, and how it slows down. Pure: the clock and the response
// signals come in, the next pace goes out. One pace per client, so one client slowing down never touches another.
//
// Azure DevOps (docs/azure verified 2026-11-05, learn.microsoft.com/azure/devops/integrate/concepts/rate-limits): a
// request over the limit is delayed (200 with X-RateLimit-Delay) or, past that, refused with 429 and Retry-After.
// X-RateLimit-Limit and X-RateLimit-Remaining come before delays start; Remaining is 0 once requests are delayed.

/** The Rule's default: once a minute in working hours. */
export const DEFAULT_MINUTES = 1;
/** Outside everyone's hours (and only while someone is using FocusTime). */
export const OUTSIDE_MINUTES = 10;
/** A slowed client is checked at most this rarely (unless the Rule asks for longer). */
export const MAX_SLOW_MINUTES = 15;
/** A token DevOps refuses is tried again this rarely. */
export const BAD_TOKEN_MINUTES = 30;
/** Refresh forces a check of a client at most this often, shared by everyone. */
export const REFRESH_GAP_MS = 30_000;
/** Changed-since reads start this far before the watermark, so a change landing during a read is seen next time. */
export const OVERLAP_MS = 2 * 60_000;
/** A refusal without Retry-After waits this long. */
export const DEFAULT_RETRY_S = 60;
/** Below this share of the budget left, slow down. */
export const LOW_REMAINING = 0.2;
/** The slow factor stops here (16 × 1 minute is past the 15-minute cap already). */
export const MAX_SLOW_FACTOR = 16;
/** Calm checks before stepping back toward the normal interval. */
export const CALM_TO_RECOVER = 5;

/** What one response said about the limits (absent headers are null). */
export type RateSignal = { status: number; retryAfterS: number | null; delayS: number | null; limit: number | null; remaining: number | null; cost: number | null };

/** The worst of a check's responses, or a calm check when there were none to worry about. */
export type CheckSignal = { refused: boolean; retryAfterS: number | null; delayed: boolean; low: boolean };

export type Pace = {
  /** 1 normally; doubled on each slow-down, halved back after calm checks. */
  slow: number;
  calm: number;
  /** No request before this (a refusal's Retry-After). */
  retryAt: string | null;
  /** Plain words for Status, while slowed. */
  reason: string | null;
};

export const NORMAL: Pace = { slow: 1, calm: 0, retryAt: null, reason: null };

const num = (v: string | null): number | null => {
  if (v === null || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** The rate-limit headers of one response. */
export function readRate(status: number, headers: { get(name: string): string | null }): RateSignal {
  return {
    status,
    retryAfterS: num(headers.get("retry-after")),
    delayS: num(headers.get("x-ratelimit-delay")),
    limit: num(headers.get("x-ratelimit-limit")),
    remaining: num(headers.get("x-ratelimit-remaining")),
    cost: num(headers.get("x-ratelimit-cost")),
  };
}

/** Folds one response into the check's worst signal so far. */
export function worse(s: CheckSignal, r: RateSignal): CheckSignal {
  const refused = r.status === 429 || r.status === 503;
  const low = r.limit !== null && r.remaining !== null && r.limit > 0 && r.remaining / r.limit < LOW_REMAINING;
  // The docs say Retry-After can come on a 200 too: it is honored either way.
  const ra = refused ? (r.retryAfterS ?? DEFAULT_RETRY_S) : r.retryAfterS;
  return {
    refused: s.refused || refused,
    retryAfterS: ra === null ? s.retryAfterS : Math.max(s.retryAfterS ?? 0, ra),
    delayed: s.delayed || (r.delayS !== null && r.delayS > 0),
    low: s.low || low,
  };
}

export const CALM: CheckSignal = { refused: false, retryAfterS: null, delayed: false, low: false };

/** The pace after a check. A refusal or a delay doubles the interval; calm checks step it back, one halving at a time. */
export function nextPace(p: Pace, s: CheckSignal, now: Temporal.Instant): Pace {
  const asked = s.retryAfterS && s.retryAfterS > 0 ? now.add({ milliseconds: Math.round(s.retryAfterS * 1000) }) : null;
  // A Retry-After still pending holds until it passes, whatever this check said.
  const pending = p.retryAt && Temporal.Instant.compare(Temporal.Instant.from(p.retryAt), now) > 0 ? Temporal.Instant.from(p.retryAt) : null;
  const later = asked && pending ? (Temporal.Instant.compare(asked, pending) >= 0 ? asked : pending) : (asked ?? pending);
  const retryAt = later ? later.toString() : null;
  const reason = s.refused ? "DevOps asked FocusTime to wait" : s.delayed ? "DevOps is delaying requests" : s.low ? "Close to the DevOps usage limit" : null;
  if (reason) return { slow: Math.min(p.slow * 2, MAX_SLOW_FACTOR), calm: 0, retryAt: retryAt ?? (s.refused ? now.add({ seconds: DEFAULT_RETRY_S }).toString() : null), reason };
  if (p.slow <= 1) return { ...NORMAL, retryAt };
  const calm = p.calm + 1;
  if (calm < CALM_TO_RECOVER) return { ...p, calm, retryAt };
  const slow = Math.max(1, Math.floor(p.slow / 2));
  return { slow, calm: 0, retryAt, reason: slow > 1 ? p.reason : null };
}

/** Minutes until the next check: the Rule's interval in hours, 10 outside, doubled while slowed (up to 15, or the Rule). */
export function intervalMinutes(o: { ruleMinutes: number; inHours: boolean; pace: Pace; badToken?: boolean }): number {
  if (o.badToken) return BAD_TOKEN_MINUTES;
  const base = o.inHours ? o.ruleMinutes : Math.max(OUTSIDE_MINUTES, o.ruleMinutes);
  const cap = Math.max(MAX_SLOW_MINUTES, base);
  return Math.min(base * o.pace.slow, cap);
}

/** When a client's next check is due (null: never checked, so now). */
export function nextDue(o: { checkedAt: string | null; minutes: number; retryAt: string | null }): Temporal.Instant | null {
  const after = o.checkedAt ? Temporal.Instant.from(o.checkedAt).add({ milliseconds: o.minutes * 60_000 }) : null;
  const retry = o.retryAt ? Temporal.Instant.from(o.retryAt) : null;
  if (!after) return retry;
  if (!retry) return after;
  return Temporal.Instant.compare(after, retry) >= 0 ? after : retry;
}

/** Whether a check is due now. A pending Retry-After holds even a Refresh. */
export function isDue(o: { checkedAt: string | null; minutes: number; retryAt: string | null; force?: boolean }, now: Temporal.Instant): boolean {
  if (o.retryAt && Temporal.Instant.compare(Temporal.Instant.from(o.retryAt), now) > 0) return false;
  if (o.force) return true;
  const due = nextDue(o);
  return !due || Temporal.Instant.compare(due, now) <= 0;
}

/** Whether a Refresh may force a check now (once per 30 s per client, shared by everyone). */
export function refreshAllowed(lastForcedAt: number | null, nowMs: number): boolean {
  return lastForcedAt === null || nowMs - lastForcedAt >= REFRESH_GAP_MS;
}

/** The changed-since lower bound: the watermark (DevOps's own newest ChangedDate seen) less the overlap. */
export function sinceOf(watermark: string): string {
  return Temporal.Instant.from(watermark).subtract({ milliseconds: OVERLAP_MS }).toString({ smallestUnit: "second" });
}
