// HK-1: operations for telemetry. A request or a background job is one operation with a W3C trace id
// (traceparent: https://www.w3.org/TR/trace-context/); every log record, dependency and exception made while it runs
// carries that id, so Application Insights shows them under it. Jobs get their own operation each run.
//
// What an operation may hold is closed like the logger's fields: a name from code (a route, a registered action, a job
// name), a client KEY that the sender turns into a one-way ref (never sent or printed as is: a client key is the
// client's Dataverse nickname or name), counts, short flags and an outcome. Nothing from a request body, a header, a
// URL or a message. Pure: no I/O; node:async_hooks and node:crypto only.
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomBytes } from "node:crypto";

export type Outcome = "ok" | "failed" | "partial" | "skipped";

export type Operation = {
  kind: "request" | "job";
  /** 32 lowercase hex: the W3C trace id (App Insights' operation id). */
  traceId: string;
  /** 16 lowercase hex: this operation's own span id (the request's or job's id). */
  spanId: string;
  /** The caller's span id from an incoming traceparent, if any. */
  parentId: string | null;
  name: string;
  /** A client key (sent only as clientRef). */
  client: string | null;
  counts: Record<string, number>;
  flags: Record<string, string>;
  outcome: Outcome | null;
  startedMs: number;
};

const store = new AsyncLocalStorage<Operation>();
const hex = (bytes: number) => randomBytes(bytes).toString("hex");

/** The operation running now (inherited by everything it awaits or starts), or undefined. */
export const currentOperation = (): Operation | undefined => store.getStore();

/** traceparent "00-<32 hex>-<16 hex>-<2 hex>" → its ids; null when it isn't one (all zeros is invalid). */
export function parseTraceparent(h: string | undefined | null): { traceId: string; parentId: string } | null {
  const m = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/.exec((h ?? "").trim());
  if (!m || m[1] === "ff" || /^0+$/.test(m[2]!) || /^0+$/.test(m[3]!)) return null;
  return { traceId: m[2]!, parentId: m[3]! };
}

export const traceparentOf = (op: Pick<Operation, "traceId" | "spanId">) => `00-${op.traceId}-${op.spanId}-01`;

export function newOperation(kind: Operation["kind"], name: string, o: { traceparent?: string | null; client?: string | null; now?: () => number } = {}): Operation {
  const parent = parseTraceparent(o.traceparent);
  return { kind, traceId: parent?.traceId ?? hex(16), spanId: hex(8), parentId: parent?.parentId ?? null, name, client: o.client ?? null, counts: {}, flags: {}, outcome: null, startedMs: (o.now ?? (() => performance.now()))() };
}

export const runInOperation = <T>(op: Operation, fn: () => T): T => store.run(op, fn);

/** What code may say about the operation it runs in: a finer name, its client, counts, flags, the outcome. */
export type OpNote = { name?: string; client?: string | null; counts?: Record<string, number>; flags?: Record<string, string>; outcome?: Outcome };

const FLAG = /^[a-z0-9_.-]{1,32}$/i;
export function note(op: Operation | undefined, n: OpNote): void {
  if (!op) return;
  if (n.name) op.name = n.name;
  if (n.client !== undefined) op.client = n.client;
  for (const [k, v] of Object.entries(n.counts ?? {})) if (FLAG.test(k) && Number.isFinite(v)) op.counts[k] = v;
  // Flags are short words (yes, no, load, refresh), never free text.
  for (const [k, v] of Object.entries(n.flags ?? {})) if (FLAG.test(k) && FLAG.test(v)) op.flags[k] = v;
  if (n.outcome) op.outcome = n.outcome;
}
export const noteCurrent = (n: OpNote) => note(currentOperation(), n);

/** A job run's handle: say what it did. */
export type Job = { set: (n: OpNote) => void };
/** Runs fn as its own job operation (or just runs it, when nobody records jobs). */
export type JobRunner = <T>(name: string, o: { client?: string | null }, fn: (job: Job) => Promise<T>) => Promise<T>;
export const plainJob: JobRunner = (_name, _o, fn) => fn({ set: () => {} });

/**
 * A job runner that records each run: a new operation (never the caller's request: a job a request starts is still
 * its own run), timed, its outcome "failed" when it throws (the error goes to `onError` and is thrown on), and handed
 * to `done` when it ends.
 */
export function jobRunner(o: { done: (op: Operation, durationMs: number) => void; onError?: (e: unknown) => void; now?: () => number }): JobRunner {
  const now = o.now ?? (() => performance.now());
  return async (name, { client = null }, fn) => {
    const op = newOperation("job", name, { client, now });
    return runInOperation(op, async () => {
      try {
        const r = await fn({ set: (n) => note(op, n) });
        op.outcome ??= "ok";
        return r;
      } catch (e) {
        op.outcome = "failed";
        o.onError?.(e);
        throw e;
      } finally {
        o.done(op, now() - op.startedMs);
      }
    });
  };
}

/**
 * A client key as telemetry may carry it: "c-" and 10 hex of a SHA-256, the same for a key everywhere. One-way: to
 * find a client's events, compute its ref (`node scripts/focustime.ts client-ref <key>`) and search for that.
 */
export const clientRef = (key: string): string => `c-${createHash("sha256").update(`focustime-client\0${key}`).digest("hex").slice(0, 10)}`;
