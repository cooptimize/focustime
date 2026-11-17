// PK-2: a person's own Pocket recorder (Pocket's public API, docs.heypocketai.com/docs/api), read with their own key.
// One call and no other: list recordings between two dates (GET /api/v1/public/recordings), asked for one item so
// that only Pocket's total is read; nothing else of the answer is kept, returned or logged (a listed recording carries
// its title, transcript and summaries, so the answer is dropped as soon as the total is read). Every other method,
// host, path or parameter is refused before the key is read or the network is touched, as the Azure client refuses
// what it wasn't built for (sources/azure/client.ts). One try, with a time limit; never in the background: only a
// person's press (Check and save, Check again) calls it. Log lines carry the call's kind, its status and its time,
// never the key, a count or any of Pocket's answer.
import { inspect } from "node:util";
import type { Logger } from "../../log/logger.ts";
import { POCKET_FAILURE_TEXT } from "../../plan/pocket-words.ts";

export { POCKET_FAILURE_TEXT };

/** Pocket's API host and the one path FocusTime calls (docs.heypocketai.com/docs/api, read Nov 17, 2026). */
export const POCKET_ORIGIN = "https://public.heypocketai.com";
export const POCKET_LIST_PATH = "/api/v1/public/recordings";
export const POCKET_TIMEOUT_MS = 15_000;

/** A Pocket key held in memory only: String(), JSON and inspect show "[Pocket key]"; only bearer() reads it. */
export class PocketKey {
  readonly #value: string;
  constructor(value: string) {
    this.#value = value;
  }
  /** The Authorization header value, as Pocket's docs say: Bearer pk_… */
  bearer(): string {
    return `Bearer ${this.#value}`;
  }
  toString(): string {
    return "[Pocket key]";
  }
  toJSON(): string {
    return "[Pocket key]";
  }
  [inspect.custom](): string {
    return "[Pocket key]";
  }
}

/** A pasted key: one line with no spaces, as Pocket's keys start ("pk_"). Never echoed in the error. */
export function keyProblem(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return "Paste your Pocket key first";
  const t = v.trim();
  if (/\s/.test(t) || t.length > 512) return "That doesn't look like a Pocket key: it is one line with no spaces";
  if (!t.startsWith("pk_") || t.length < 8) return "That doesn't look like a Pocket key: Pocket's keys start with pk_";
  return null;
}

import type { PocketFailure } from "../../plan/pocket-words.ts";
export type { PocketFailure };
export class PocketError extends Error {
  readonly kind: PocketFailure;
  readonly status: number;
  constructor(kind: PocketFailure, status: number, message: string) {
    super(message);
    this.name = "PocketError";
    this.kind = kind;
    this.status = status;
  }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PARAMS: Record<string, RegExp> = { start_date: DATE, end_date: DATE, page: /^[1-9]\d{0,3}$/, limit: /^(100|[1-9]\d?)$/ };

/** Which allowed call a request is ("list"), or null: refused. GET on the one path, known parameters only. */
export function allowedPocketCall(method: string, url: string): "list" | null {
  if (method !== "GET" || typeof url !== "string" || /[\u0000-\u001f\u007f\s]/.test(url)) return null;
  if (!url.startsWith(`${POCKET_ORIGIN}/`)) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.origin !== POCKET_ORIGIN || u.username || u.password || u.hash || url.includes("#")) return null;
  const rawPath = url.slice(POCKET_ORIGIN.length).split("?")[0]!;
  if (rawPath !== POCKET_LIST_PATH || u.pathname !== POCKET_LIST_PATH) return null;
  const keys = [...u.searchParams.keys()];
  if (new Set(keys).size !== keys.length) return null;
  for (const [k, v] of u.searchParams) if (!PARAMS[k]?.test(v)) return null;
  return "list";
}

export type PocketDeps = { fetch: typeof fetch; log: Logger; timeoutMs?: number };
export type PocketCount = { recordings: number };


const fail = (kind: PocketFailure, status = 0) => new PocketError(kind, status, POCKET_FAILURE_TEXT[kind]);

/** A UTC calendar date, as Pocket reads start_date and end_date. */
const utcDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function createPocketClient(d: PocketDeps) {
  const timeoutMs = d.timeoutMs ?? POCKET_TIMEOUT_MS;

  /** Every request: the allowlist first, then the key, then the network, once. */
  async function send(method: string, url: string, key: () => Promise<PocketKey>): Promise<Response> {
    const call = allowedPocketCall(method, url);
    if (!call) {
      d.log({ source: "pocket", op: "refused", kind: "refused" });
      throw fail("refused");
    }
    const k = await key();
    const started = performance.now();
    let res: Response;
    try {
      res = await d.fetch(url, { method, headers: { accept: "application/json", authorization: k.bearer() }, redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      d.log({ source: "pocket", op: call, kind: "no_answer", durationMs: performance.now() - started });
      throw fail("no_answer");
    }
    d.log({ source: "pocket", op: call, status: res.status, durationMs: performance.now() - started });
    if (res.ok) return res;
    await res.body?.cancel().catch(() => undefined);
    if (res.status === 401 || res.status === 403) throw fail("not_accepted", res.status);
    if (res.status === 429 || res.status === 503) throw fail("busy", res.status);
    if (res.status >= 500) throw fail("no_answer", res.status);
    throw fail("unexpected", res.status);
  }

  /**
   * How many recordings Pocket has between two UTC dates (inclusive). Asks for one item and reads only
   * pagination.total; the rest of the answer is dropped here.
   */
  async function countRecordings(key: () => Promise<PocketKey>, from: string, to: string): Promise<PocketCount> {
    if (!DATE.test(from) || !DATE.test(to)) throw fail("refused");
    const url = `${POCKET_ORIGIN}${POCKET_LIST_PATH}?start_date=${from}&end_date=${to}&page=1&limit=1`;
    const res = await send("GET", url, key);
    let total: unknown;
    try {
      const j = (await res.json()) as { success?: unknown; pagination?: { total?: unknown } } | null;
      total = j && j.success !== false ? j.pagination?.total : undefined;
    } catch {
      total = undefined;
    }
    if (typeof total !== "number" || !Number.isInteger(total) || total < 0) {
      d.log({ source: "pocket", op: "list", kind: "unexpected" });
      throw fail("unexpected", res.status);
    }
    return { recordings: total };
  }

  return {
    /** The last 7 days, today included, as UTC dates (Pocket reads its dates as UTC). */
    countLastWeek: (key: () => Promise<PocketKey>, nowMs: number) => countRecordings(key, utcDate(nowMs - 6 * 86_400_000), utcDate(nowMs)),
    countRecordings,
    /** Any request, through the same allowlist (tests; nothing in FocusTime calls this). */
    request: (method: string, url: string, key: () => Promise<PocketKey>) => send(method, url, key),
  };
}
export type PocketClient = ReturnType<typeof createPocketClient>;
