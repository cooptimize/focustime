// PK-2: a person's own Pocket recorder (Pocket's public API, docs.heypocketai.com/docs/api), read with their own key.
// Three calls and no other (MC-2b added the last two):
//   count       the list between two dates asked for one item, so that only Pocket's total is read (PK-2's check);
//   list        the list between two dates, 100 a page, pages 1 to 3, for "Get my Pocket recordings": of each listed
//               recording only who recorded it is read first, then, for the ones kept (plan/pocket-recordings.ts:
//               mine, or one recorder for the whole list), its id, when it was recorded, its length and its title;
//               every other field (the transcript, summaries, speakers, tags, translation) and every recording by
//               someone else are dropped unread;
//   recording   one recording by an id from that list, with its transcript and without its summaries, on Continue;
//               of the answer only the transcript's segments (start, end, speaker label, text) and the length are read.
// Nothing of an answer is kept here, returned beyond that, or logged. Every other method,
// host, path or parameter is refused before the key is read or the network is touched, as the Azure client refuses
// what it wasn't built for (sources/azure/client.ts). One try, with a time limit; never in the background: only a
// person's press (Check and save, Check again) calls it. Log lines carry the call's kind, its status and its time,
// never the key, a count or any of Pocket's answer.
import { inspect } from "node:util";
import type { Logger } from "../../log/logger.ts";
import { POCKET_FAILURE_TEXT } from "../../plan/pocket-words.ts";

export { POCKET_FAILURE_TEXT };

/** Pocket's API host and the paths FocusTime calls (docs.heypocketai.com/docs/api, read Nov 17 and Nov 18, 2026). */
export const POCKET_ORIGIN = "https://public.heypocketai.com";
export const POCKET_LIST_PATH = "/api/v1/public/recordings";
export const POCKET_TIMEOUT_MS = 15_000;
/** MC-2b: the list's page size (Pocket's largest) and how many pages a press reads at most. */
export const POCKET_PAGE_SIZE = 100;
export const POCKET_MAX_PAGES = 3;
/** MC-2b: the most of one recording's answer read (its transcript), as the upload's unpacked limit. */
/** A page of the list, read up to this many bytes (each listed recording comes with its transcript). */
export const POCKET_PAGE_MAX_BYTES = 40 * 1024 * 1024;
export const POCKET_RECORDING_MAX_BYTES = 20 * 1024 * 1024;
/**
 * MC-2b: a recording's id as FocusTime accepts it. Pocket's docs say only "Recording ID" (a string); this is the
 * narrowest form that takes the ids its examples show (letters, digits, - and _), so nothing else can reach the path.
 */
export const POCKET_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

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
/** The count, exactly as FocusTime builds it: two dates, the first page, one item. */
const countUrl = (from: string, to: string) => `${POCKET_ORIGIN}${POCKET_LIST_PATH}?start_date=${from}&end_date=${to}&page=1&limit=1`;
/** MC-2b: one page of the list: two dates, a page from 1 to 3, 100 items. */
const pageUrl = (from: string, to: string, page: number) => `${POCKET_ORIGIN}${POCKET_LIST_PATH}?start_date=${from}&end_date=${to}&page=${page}&limit=${POCKET_PAGE_SIZE}`;
/** MC-2b: one recording, with its transcript and without its summaries (Pocket's default includes both). */
const recordingUrl = (id: string) => `${POCKET_ORIGIN}${POCKET_LIST_PATH}/${id}?include_transcript=true&include_summarizations=false`;

export type PocketCallKind = "count" | "list" | "recording";

/** Which allowed call a request is, or null: refused. Only the three calls, character for character. */
export function allowedPocketCall(method: string, url: string): PocketCallKind | null {
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
  if (rawPath.startsWith(`${POCKET_LIST_PATH}/`)) {
    // MC-2b: one recording by an id of the accepted form, with exactly the two parameters FocusTime sends.
    const rid = rawPath.slice(POCKET_LIST_PATH.length + 1);
    if (!POCKET_ID.test(rid) || u.pathname !== rawPath || url !== recordingUrl(rid)) return null;
    return "recording";
  }
  if (rawPath !== POCKET_LIST_PATH || u.pathname !== POCKET_LIST_PATH) return null;
  // Pinned to the calls FocusTime builds (review): no other parameter, page or size, and no encoded spelling of one.
  const from = u.searchParams.get("start_date") ?? "";
  const to = u.searchParams.get("end_date") ?? "";
  if (!DATE.test(from) || !DATE.test(to)) return null;
  if (url === countUrl(from, to)) return "count";
  for (let p = 1; p <= POCKET_MAX_PAGES; p++) if (url === pageUrl(from, to, p)) return "list";
  return null;
}

export type PocketDeps = { fetch: typeof fetch; log: Logger; timeoutMs?: number };
export type PocketCount = { recordings: number };
/** MC-2b: what FocusTime reads of a listed recording it keeps: never its words, speakers, summaries or tags. */
export type PocketRecording = { id: string; startAt: string; seconds: number; title: string };
/** MC-2b: the list for one press: my recordings, how many by others were dropped, and whether pages were left. */
export type PocketList = { recordings: PocketRecording[]; others: number; more: boolean };
/** MC-2b: one transcript segment as Pocket gives it; times in Pocket's unit (not documented; see plan/pocket-recordings.ts). */
export type PocketSegment = { start: number | null; end: number | null; speaker: string; text: string };
export type PocketTranscript = { segments: PocketSegment[]; seconds: number | null };


const fail = (kind: PocketFailure, status = 0) => new PocketError(kind, status, POCKET_FAILURE_TEXT[kind]);

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
/** A recording's length: at most a day (anything longer isn't a call, and would overflow the time arithmetic). */
const length = (v: unknown): number | null => {
  const n = num(v);
  return n !== null && n <= 24 * 3600 ? n : null;
};

/** Only who recorded a listed recording: their address, or null. Nothing else of it is touched here. */
function recorderOf(r: unknown): string | null {
  const by = r && typeof r === "object" ? (r as { recorded_by?: unknown }).recorded_by : null;
  const email = by && typeof by === "object" ? (by as { email?: unknown }).email : null;
  return typeof email === "string" && email.includes("@") && email.length <= 320 ? email.trim().toLowerCase() : null;
}

/** A kept recording's four fields; null when one of them isn't in the shape the docs show. */
function readListed(r: unknown): PocketRecording | null {
  if (!r || typeof r !== "object") return null;
  const o = r as Record<string, unknown>;
  const id = o.id;
  const at = o.recording_at;
  const seconds = length(o.duration);
  if (typeof id !== "string" || !POCKET_ID.test(id) || typeof at !== "string" || at.length > 40 || seconds === null) return null;
  let startAt: string;
  try {
    // Pocket's docs: every date is UTC (the webhooks page: "When the recording started, in UTC (ISO 8601)").
    startAt = Temporal.Instant.from(/[zZ]|[+-]\d\d:?\d\d$/.test(at) ? at : `${at}Z`).toString();
  } catch {
    return null;
  }
  const title = typeof o.title === "string" && o.title.trim() ? o.title.trim().slice(0, 200) : "";
  return { id, startAt, seconds: Math.round(seconds), title };
}

/** A response's text, refused past `max` bytes (counted as it arrives, whatever its header says). */
async function textUpTo(res: Response, max: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > max) {
      await reader.cancel().catch(() => undefined);
      throw new PocketError("too_long", 200, POCKET_FAILURE_TEXT.too_long);
    }
    parts.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(parts));
}

/** A UTC calendar date, as Pocket reads start_date and end_date. */
const utcDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function createPocketClient(d: PocketDeps) {
  const timeoutMs = d.timeoutMs ?? POCKET_TIMEOUT_MS;

  /** Every request: the allowlist first, then the key, then the network, once. */
  async function send(method: string, url: string, key: () => Promise<PocketKey>, expect?: PocketCallKind): Promise<Response> {
    const call = allowedPocketCall(method, url);
    if (!call || (expect && call !== expect)) {
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
    const url = countUrl(from, to);
    const res = await send("GET", url, key, "count");
    let total: unknown;
    try {
      const j = (await res.json()) as { success?: unknown; pagination?: { total?: unknown } } | null;
      total = j && j.success !== false ? j.pagination?.total : undefined;
    } catch {
      total = undefined;
    }
    if (typeof total !== "number" || !Number.isInteger(total) || total < 0) {
      d.log({ source: "pocket", op: "count", kind: "unexpected" });
      throw fail("unexpected", res.status);
    }
    return { recordings: total };
  }

  /**
   * MC-2b: my recordings between two UTC dates (inclusive), page by page, 3 pages at most. `keep` decides from the
   * recorders' addresses alone (plan/pocket-recordings.ts `whoseKept`); only a kept recording's id, time, length and
   * title are then read. Every other field, and every dropped recording, is never read; the answers go out of scope here.
   */
  async function listRecordings(key: () => Promise<PocketKey>, from: string, to: string, keep: (recorders: readonly (string | null)[]) => boolean[]): Promise<PocketList> {
    if (!DATE.test(from) || !DATE.test(to)) throw fail("refused");
    const listed: unknown[] = [];
    let more = false;
    for (let page = 1; page <= POCKET_MAX_PAGES; page++) {
      const res = await send("GET", pageUrl(from, to, page), key, "list");
      let j: { success?: unknown; data?: unknown; pagination?: { has_more?: unknown } } | null;
      // A page of 100 carries each recording's transcript (no field filter): read up to its own limit, then refused.
      const text = await textUpTo(res, POCKET_PAGE_MAX_BYTES);
      try {
        j = JSON.parse(text) as typeof j;
      } catch {
        j = null;
      }
      if (!j || j.success === false || !Array.isArray(j.data) || typeof j.pagination?.has_more !== "boolean") {
        d.log({ source: "pocket", op: "list", kind: "unexpected" });
        throw fail("unexpected", res.status);
      }
      listed.push(...j.data);
      if (!j.pagination.has_more) break;
      if (page === POCKET_MAX_PAGES) more = true;
    }
    const recorders = listed.map((r) => recorderOf(r));
    const kept = keep(recorders);
    const out: PocketRecording[] = [];
    let others = 0;
    let unreadable = 0;
    listed.forEach((r, i) => {
      if (!kept[i]) return void others++;
      const x = readListed(r);
      if (x) out.push(x);
      else unreadable++;
    });
    if (unreadable) d.log({ source: "pocket", op: "list", kind: "unreadable" });
    return { recordings: out, others, more };
  }

  /** MC-2b: one recording's transcript, by an id the caller took from this person's own list. */
  async function recording(key: () => Promise<PocketKey>, id: string): Promise<PocketTranscript> {
    if (typeof id !== "string" || !POCKET_ID.test(id)) throw fail("refused");
    const res = await send("GET", recordingUrl(id), key, "recording");
    let j: { success?: unknown; data?: { transcript?: { segments?: unknown } | null; duration?: unknown } | null } | null;
    try {
      j = JSON.parse(await textUpTo(res, POCKET_RECORDING_MAX_BYTES)) as typeof j;
    } catch (e) {
      if (e instanceof PocketError) throw e;
      j = null;
    }
    const segs = j && j.success !== false ? j.data?.transcript?.segments : undefined;
    if (!Array.isArray(segs)) {
      d.log({ source: "pocket", op: "recording", kind: "unexpected" });
      throw fail("unexpected", res.status);
    }
    const segments: PocketSegment[] = [];
    for (const g of segs) {
      if (!g || typeof g !== "object") continue;
      const o = g as Record<string, unknown>;
      // Only these four: speakerName and originalText are never read (Pocket doesn't name speakers reliably).
      const text = typeof o.text === "string" ? o.text : "";
      if (!text.trim()) continue;
      segments.push({ start: num(o.start), end: num(o.end), speaker: typeof o.speaker === "string" ? o.speaker.slice(0, 40) : "", text });
    }
    const seconds = length(j?.data?.duration);
    return { segments, seconds };
  }
  return {
    /** The last 7 days, today included, as UTC dates (Pocket reads its dates as UTC). */
    countLastWeek: (key: () => Promise<PocketKey>, nowMs: number) => countRecordings(key, utcDate(nowMs - 6 * 86_400_000), utcDate(nowMs)),
    countRecordings,
    listRecordings,
    recording,
    /** Any request, through the same allowlist (tests; nothing in FocusTime calls this). */
    request: (method: string, url: string, key: () => Promise<PocketKey>) => send(method, url, key),
  };
}
export type PocketClient = ReturnType<typeof createPocketClient>;
