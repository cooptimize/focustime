// MC-2c: the transcript of a call started in a client's registered delivery chat (an ad hoc call in Graph), read only on
// a Cooptimizer's own press for that one call, with their own delegated CallTranscripts.Read.All (its own token, apart
// from the meetings token). Exactly two requests, both under /me, and nothing else:
//   GET /me/adhocCalls/{callId}/transcripts?$select=id,createdDateTime,endDateTime
//   GET /me/adhocCalls/{callId}/transcripts/{transcriptId}/content
// Never /users/{id}/..., getAllTranscripts, communications/adhocCalls, a subscription, a change notification or a
// recording. Every request asks the gate first (this person's press for this call id, actions/chat-call-press.ts) and
// is checked against those two shapes; anything else throws AdhocRefused before a request is sent.
//
// Microsoft's pages (read Nov 18, 2026): Get callTranscript documents both ad hoc paths under /me with delegated
// CallTranscripts.Read.All, text/vtt by default, and application/vnd.microsoft.graph.transcript+text (no speakers),
// chosen only with the Accept header; a 403 with GraphAccessToTranscriptsDisabled (the organization's setting) or
// SpeakerAttributionNotAllowed (ask again without names). No v1.0 page lists one ad hoc call's transcripts for a
// delegated sign-in (only the SDK reference does), so a list Microsoft answers 400, 404 or 405 is "not a thing" and the
// transcript id the chat's event carried is used instead (`readChatTranscript`).
// Logs carry the op, status, count and duration: never a call id, a transcript id, a name or any text.
import type { Logger } from "../../log/logger.ts";
import { HttpError, NetworkError } from "../calendar/http.ts";
import { MAX_TRANSCRIPT_BYTES, TranscriptsOff, type TranscriptRef } from "./meetings.ts";

const GRAPH = "https://graph.microsoft.com/v1.0";
const LIST_SELECT = "$select=id,createdDateTime,endDateTime";
/** Graph's format without speaker names; the default text/vtt names them. */
export const UNNAMED_FORMAT = "application/vnd.microsoft.graph.transcript+text";

export class AdhocRefused extends Error {
  constructor() {
    super("FocusTime reads a chat call's transcript only on your own press, for that one call");
    this.name = "AdhocRefused";
  }
}
/** Microsoft answered the list of one call's transcripts as not a thing (400, 404 or 405): use the event's id. */
export class ListUnavailable extends Error {
  readonly status: number;
  constructor(status: number) {
    super("The list of a call's transcripts isn't available");
    this.name = "ListUnavailable";
    this.status = status;
  }
}
/** 403 SpeakerAttributionNotAllowed: the organization doesn't allow speaker names; ask once more without them. */
export class SpeakerNamesOff extends HttpError {
  constructor() {
    super(403);
    this.name = "SpeakerNamesOff";
  }
}

/** Asked before every request: true only while this sign-in's person has a press open for this call id. */
export type AdhocGate = { allowed: (callId: string) => boolean | Promise<boolean> };
export type AdhocCallsDeps = {
  fetch: typeof fetch;
  /** The call_transcripts token (CallTranscripts.Read.All), asked for only here, so only at a press. */
  token: () => Promise<string>;
  invalidate: () => void;
  gate: AdhocGate;
  log: Logger;
  timeoutMs?: number;
};

/** One path segment: no slash, query, fragment or space, and never "." or ".." (fetch would resolve them away). */
const SEGMENT = /^(?!\.+$)[^/?#\s]{1,2000}$/;
/** A transcript id from the list, before it is put in a path. */
export const okSegment = (v: string) => SEGMENT.test(v);
const enc = (s: string) => encodeURIComponent(s);
/** The two requests this client may send, and nothing else. */
export function allowedAdhocRequest(url: string): boolean {
  const base = `${GRAPH}/me/adhocCalls/`;
  // As fetch will send it: a URL that normalizing changes (dot segments, a backslash) is never one of the two.
  let href: string;
  try {
    href = new URL(url).href;
  } catch {
    return false;
  }
  if (href !== url || !url.startsWith(base)) return false;
  const rest = url.slice(base.length);
  const list = /^([^/?#]+)\/transcripts\?\$select=id,createdDateTime,endDateTime$/.exec(rest);
  if (list) return SEGMENT.test(list[1]!);
  const content = /^([^/?#]+)\/transcripts\/([^/?#]+)\/content$/.exec(rest);
  return !!content && SEGMENT.test(content[1]!) && SEGMENT.test(content[2]!);
}

/** Graph's inner error code from an error body, only that (the body is never kept or logged). */
function innerCode(j: unknown): string | null {
  const e = (j as { error?: { innerError?: { code?: unknown }; innererror?: { code?: unknown } } } | null)?.error;
  const c = e?.innerError?.code ?? e?.innererror?.code;
  return typeof c === "string" ? c : null;
}

export function createAdhocCallsClient(d: AdhocCallsDeps) {
  async function request(op: string, callId: string, url: string, o: { accept: string; text: boolean; max?: number }, retried = false): Promise<unknown> {
    if (!(await d.gate.allowed(callId)) || !allowedAdhocRequest(url)) throw new AdhocRefused();
    const t = await d.token();
    const started = performance.now();
    let res: Response;
    try {
      res = await d.fetch(url, { headers: { accept: o.accept, authorization: `Bearer ${t}` }, signal: AbortSignal.timeout(d.timeoutMs ?? 20_000) });
    } catch {
      d.log({ source: "outlook", op, kind: "network" });
      throw new NetworkError("network");
    }
    d.log({ source: "outlook", op, status: res.status, durationMs: performance.now() - started });
    if (res.status === 401 && !retried) {
      await res.body?.cancel().catch(() => {});
      d.invalidate();
      return request(op, callId, url, o, true);
    }
    if (!res.ok) {
      if (res.status === 403) {
        const code = innerCode(await res.json().catch(() => null));
        if (code === "GraphAccessToTranscriptsDisabled") throw new TranscriptsOff();
        if (code === "SpeakerAttributionNotAllowed") throw new SpeakerNamesOff();
      } else await res.body?.cancel().catch(() => {});
      throw new HttpError(res.status);
    }
    if (!o.text) return res.json().catch(() => null);
    const max = Math.min(o.max ?? MAX_TRANSCRIPT_BYTES, MAX_TRANSCRIPT_BYTES);
    if (Number(res.headers.get("content-length") ?? 0) > max) {
      await res.body?.cancel().catch(() => {});
      throw new HttpError(413);
    }
    const body = await res.text();
    if (new TextEncoder().encode(body).length > max) throw new HttpError(413);
    return body;
  }

  return {
    /** One chat call's transcripts (ids and times only), oldest first. ListUnavailable when Microsoft says the list isn't a thing. */
    async transcripts(callId: string): Promise<TranscriptRef[]> {
      let j: { value?: { id?: unknown; createdDateTime?: unknown; endDateTime?: unknown }[] } | null;
      try {
        j = (await request("adhoc_transcripts", callId, `${GRAPH}/me/adhocCalls/${enc(callId)}/transcripts?${LIST_SELECT}`, { accept: "application/json", text: false })) as typeof j;
      } catch (e) {
        if (e instanceof HttpError && !(e instanceof TranscriptsOff) && [400, 404, 405].includes(e.status)) throw new ListUnavailable(e.status);
        throw e;
      }
      const str = (v: unknown, max: number) => (typeof v === "string" && v.length && v.length <= max ? v : null);
      const refs = (j?.value ?? []).map((t) => ({ id: str(t.id, 2000), createdAt: str(t.createdDateTime, 40), endAt: str(t.endDateTime, 40) })).filter((t): t is TranscriptRef => !!t.id && okSegment(t.id) && !!t.createdAt);
      d.log({ source: "outlook", op: "adhoc_transcripts", count: refs.length });
      return refs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },
    /**
     * One transcript's text: with speaker names (text/vtt) or, when `named` is false, Graph's format without them. At most
     * `max` bytes (MAX_TRANSCRIPT_BYTES at most). Never logged.
     */
    async content(callId: string, transcriptId: string, o: { named: boolean; max?: number }): Promise<string> {
      return (await request(o.named ? "adhoc_transcript" : "adhoc_transcript_unnamed", callId, `${GRAPH}/me/adhocCalls/${enc(callId)}/transcripts/${enc(transcriptId)}/content`, { accept: o.named ? "text/vtt" : UNNAMED_FORMAT, text: true, ...(o.max !== undefined ? { max: o.max } : {}) })) as string;
    },
  };
}

export type AdhocCallsClient = ReturnType<typeof createAdhocCallsClient>;

/** One chat call's transcript as read: its pieces in time order (more than one when transcription stopped and started). */
export type ChatTranscriptRead = { parts: { createdAt: string | null; text: string }[]; named: boolean };

/**
 * MC-2c: the transcript of one chat call. Its transcripts are listed first; when Microsoft answers that the list isn't a
 * thing (400, 404 or 405), the id the chat's event carried is used. Each is read in time order and the pieces are joined
 * by the caller, inside MAX_TRANSCRIPT_BYTES in total. When the organization doesn't allow speaker names (403
 * SpeakerAttributionNotAllowed), the same transcript is asked for once more without them, and the rest without them.
 * Nothing found: HttpError 404 ("not there").
 */
export async function readChatTranscript(c: AdhocCallsClient, callId: string, eventTranscriptId: string | null): Promise<ChatTranscriptRead> {
  let refs: { id: string; createdAt: string | null }[];
  try {
    refs = await c.transcripts(callId);
  } catch (e) {
    if (!(e instanceof ListUnavailable)) throw e;
    refs = eventTranscriptId ? [{ id: eventTranscriptId, createdAt: null }] : [];
  }
  if (!refs.length) throw new HttpError(404);
  let named = true;
  let budget = MAX_TRANSCRIPT_BYTES;
  const parts: ChatTranscriptRead["parts"] = [];
  for (const r of refs) {
    let text: string;
    try {
      text = await c.content(callId, r.id, { named, max: budget });
    } catch (e) {
      if (!(e instanceof SpeakerNamesOff) || !named) throw e;
      named = false;
      text = await c.content(callId, r.id, { named: false, max: budget });
    }
    budget -= new TextEncoder().encode(text).length;
    if (budget < 0) throw new HttpError(413);
    parts.push({ createdAt: r.createdAt, text });
  }
  return { parts, named };
}
