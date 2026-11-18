// MC-2b: my own Pocket recordings in Calls. Pocket is asked only from two presses, each with my own key from my own
// sealed secrets, for me alone:
//   meeting.pocket_list    "Get my Pocket recordings": my recordings of Calls' last 14 days (whose they are by
//                          plan/pocket-recordings.ts `whoseKept`; others' are only counted), held 5 minutes in this
//                          server's memory for me (and the page's while Calls is open). Never stored or logged.
//   meeting.pocket_bring   Continue on a setup with "Use my Pocket recording": one recording by an id from my own
//                          list of the last 5 minutes, onto a call I review that it goes with, its part during the
//                          call when it is much longer (or all of it when I chose so). Its transcript becomes the
//                          call's under every rule a transcript has, then the same AI pass as an upload.
// meeting.pocket_add makes a recording that goes with no call its own call (a call only I see, as one added by hand),
// from the hold, without asking Pocket. Nothing here runs from a job, a schedule, a page load, the assistant or the
// Teams bot. Logs say only the outcome: never a title, an id, a count, a date or a word of a recording.
import type { ActionResponse } from "./types.ts";
import { PocketError, POCKET_FAILURE_TEXT, type PocketFailure, type PocketRecording } from "../sources/pocket/client.ts";
import type { PocketPort } from "./pocket-actions.ts";
import type { MeetingStore } from "../store/meeting-store.ts";
import { canConfirm, type MeetingSeries, type Occurrence } from "../plan/meetings.ts";
import { otherCallsWindow } from "../plan/calls.ts";
import { goesWith, hasTimes, inSeconds, lengthWords, longerThanCall, partDuring, pocketLines, POCKET_HOLD_MS, whoseKept } from "../plan/pocket-recordings.ts";
import { POCKET_CALL_WORDS } from "../plan/pocket-words.ts";

/** One listed recording as the page gets it: never who recorded it, its words or anything else Pocket sent. */
export type PocketRecordingView = { id: string; startAt: string; endAt: string; minutes: number; title: string };
export type PocketListView = { recordings: PocketRecordingView[]; others: number; more: boolean; at: string; days: number };

/**
 * MC-2b: each person's last list, in this server's memory only, for 5 minutes: a recording can be brought in only by
 * an id from the person's own list of the last 5 minutes. Keyed by user id; nothing else can read another's.
 */
export function createPocketHold(now: () => number) {
  const held = new Map<string, { at: number; recs: Map<string, PocketRecording> }>();
  const sweep = () => {
    for (const [k, v] of held) if (now() - v.at > POCKET_HOLD_MS) held.delete(k);
  };
  return {
    put(userId: string, recs: readonly PocketRecording[]): void {
      sweep();
      held.set(userId.toLowerCase(), { at: now(), recs: new Map(recs.map((r) => [r.id, r])) });
    },
    get(userId: string, id: string): PocketRecording | null {
      sweep();
      return held.get(userId.toLowerCase())?.recs.get(id) ?? null;
    },
    /** For tests: how many people have a list held. */
    size: () => (sweep(), held.size),
  };
}
export type PocketHold = ReturnType<typeof createPocketHold>;

/** What the meeting actions need for Pocket: my own port (key and client), the shared hold, my addresses. */
export type MeetingPocket = { port: PocketPort; hold: PocketHold; myEmails: () => Promise<string[]> };

/** The bits of the meeting actions' context these use. */
export type PocketCallContext = {
  pocket?: MeetingPocket;
  now: () => string;
  log: (r: { source: "plan"; op: string; kind?: string }) => void;
  cooptimizer?: (userId: string) => Promise<boolean>;
};

const bad = (error: string, status = 400, code?: string): ActionResponse => ({ ok: false, status, error, ...(code ? { code } : {}) });
const endAt = (r: PocketRecording) => Temporal.Instant.from(r.startAt).add({ seconds: r.seconds }).toString();
const view = (r: PocketRecording): PocketRecordingView => ({ id: r.id, startAt: r.startAt, endAt: endAt(r), minutes: Math.max(1, Math.round(r.seconds / 60)), title: r.title });

/** A Pocket failure in PK-2's words, with what to do; the status the page reads. */
function failed(ctx: PocketCallContext, e: unknown, op: string): ActionResponse {
  const kind: PocketFailure = e instanceof PocketError ? e.kind : "no_answer";
  ctx.log({ source: "plan", op, kind });
  return bad(`${POCKET_FAILURE_TEXT[kind]}.`, kind === "not_accepted" ? 422 : kind === "refused" ? 400 : kind === "too_long" ? 422 : 502, `pocket_${kind}`);
}

/** My key, read only now and only for this press. */
const keyOf = (p: PocketPort) => async () => {
  const k = await p.key.get();
  if (!k) throw new PocketError("not_accepted", 0, POCKET_FAILURE_TEXT.not_accepted);
  return k;
};

/** Get my Pocket recordings: one press, my key, Calls' window; held for me 5 minutes. */
export async function pocketList(ctx: PocketCallContext, me: string, zone: string): Promise<ActionResponse> {
  const p = ctx.pocket;
  if (!p || !(await p.port.key.has())) return bad(POCKET_CALL_WORDS.notConnected, 409, "pocket_not_connected");
  const w = otherCallsWindow(ctx.now(), zone);
  const utc = (iso: string) => iso.slice(0, 10);
  const mine = await p.myEmails();
  let list;
  try {
    list = await p.port.client.listRecordings(keyOf(p.port), utc(w.fromIso), utc(Temporal.Instant.from(w.toIso).toString()), (rs) => whoseKept(rs, mine));
  } catch (e) {
    return failed(ctx, e, "meeting_pocket_list");
  }
  // Only Calls' window, and only recordings that have ended: Pocket's dates are whole UTC days.
  const now = Date.parse(ctx.now());
  const kept = list.recordings.filter((r) => Date.parse(r.startAt) + r.seconds * 1000 >= Date.parse(w.fromIso) && Date.parse(r.startAt) <= now);
  p.hold.put(me, kept);
  ctx.log({ source: "plan", op: "meeting_pocket_list", kind: list.more ? "more" : "ok" });
  const data: PocketListView = { recordings: kept.map(view).sort((a, b) => b.startAt.localeCompare(a.startAt)), others: list.others, more: list.more, at: ctx.now(), days: 14 };
  return { ok: true, data };
}

/** A recording from my own list of the last 5 minutes, or the words to get it again. Pocket isn't asked. */
function held(ctx: PocketCallContext, me: string, id: unknown): PocketRecording | ActionResponse {
  if (typeof id !== "string" || id.length > 128) return bad("recordingId must be a recording from your list", 400);
  const r = ctx.pocket?.hold.get(me, id) ?? null;
  return r ?? bad(POCKET_CALL_WORDS.getAgain, 410, "pocket_get_again");
}
const isResponse = (x: unknown): x is ActionResponse => typeof x === "object" && x !== null && "ok" in x;

/**
 * Continue with "Use my Pocket recording" on a call I review: the recording (from my own held list) must go with the
 * call; a call that has a transcript asks first; a recording much longer than the call brings in its part during the
 * call unless I chose all of it, and when Pocket gave no line times asks before bringing in the whole. Then one call
 * to Pocket, the upload's line rules, the store's transcript rules, and the AI pass as an upload's.
 */
export async function pocketBring(
  ctx: PocketCallContext,
  store: MeetingStore,
  me: string,
  input: { recordingId: unknown; occurrenceId: number; part?: unknown; replace?: unknown },
  pass: (series: MeetingSeries, occ: Occurrence, lines: ReturnType<typeof pocketLines>) => Promise<{ outcome: string; proposals: number; added: number; same: number }>,
): Promise<ActionResponse> {
  const p = ctx.pocket;
  if (!p || !(await p.port.key.has())) return bad(POCKET_CALL_WORDS.notConnected, 409, "pocket_not_connected");
  if (input.part !== undefined && input.part !== "call" && input.part !== "all") return bad("part is call or all", 400);
  const rec = held(ctx, me, input.recordingId);
  if (isResponse(rec)) return rec;
  const v = store.viewer(me);
  const seen = await v.occurrence(input.occurrenceId);
  if (!seen) return bad("No such call", 404);
  if (!canConfirm(seen.series, me)) return bad("Only this call's reviewers can bring in its transcript", 403);
  const call = { startAt: seen.o.startAt, endAt: seen.o.endAt };
  if (!goesWith(rec, call)) return bad(POCKET_CALL_WORDS.notThisCall, 422, "pocket_not_this_call");
  if ((await store.withTranscript([seen.o.id])).has(seen.o.id) && input.replace !== true) return { ok: true, data: { ask: "replace" } };
  const longer = longerThanCall(rec, call);
  const part = longer ? ((input.part as "call" | "all" | undefined) ?? "call") : "all";
  let t;
  try {
    t = await p.port.client.recording(keyOf(p.port), rec.id);
  } catch (e) {
    return failed(ctx, e, "meeting_pocket_bring");
  }
  const segs = inSeconds(t.segments, t.seconds ?? rec.seconds);
  if (part === "call" && !hasTimes(segs)) {
    // Nothing kept: the setup says the whole recording would come in, and how long it is, before a second Continue.
    ctx.log({ source: "plan", op: "meeting_pocket_bring", kind: "ask_whole" });
    return { ok: true, data: { ask: "whole", length: lengthWords(rec.seconds) } };
  }
  const lines = pocketLines(part === "call" ? partDuring(segs, rec, call) : segs);
  if (!lines.length) {
    ctx.log({ source: "plan", op: "meeting_pocket_bring", kind: "empty" });
    return bad(POCKET_CALL_WORDS.noWords, 422, "pocket_no_words");
  }
  await v.saveTranscript(seen.o.id, lines, "pocket_api");
  ctx.log({ source: "plan", op: "meeting_pocket_bring", kind: part });
  const r = await pass(seen.series, (await store.occurrence(seen.o.id))!, lines);
  return { ok: true, data: { occurrenceId: seen.o.id, part, ...r } };
}

/**
 * A recording that goes with no call, as its own call: its name (the title, mine to change), the client it is about
 * (my choice), its time from the recording. Only I see it, as a call added by hand. Pocket isn't asked here.
 */
export async function pocketAdd(
  ctx: PocketCallContext,
  store: MeetingStore,
  me: string,
  zone: string,
  input: { recordingId: unknown; name: string; clientKey: string },
): Promise<ActionResponse> {
  if (!ctx.pocket || !(await ctx.pocket.port.key.has())) return bad(POCKET_CALL_WORDS.notConnected, 409, "pocket_not_connected");
  const rec = held(ctx, me, input.recordingId);
  if (isResponse(rec)) return rec;
  if (!ctx.cooptimizer || !(await ctx.cooptimizer(me).catch(() => false))) return bad("Only a Cooptimizer can keep a call", 403, "not_cooptimizer");
  const start = Temporal.Instant.from(rec.startAt).toZonedDateTimeISO(zone);
  const minutes = Math.min(480, Math.max(1, Math.round(rec.seconds / 60)));
  const r = await store.addCall({
    callKind: "hand", clientKey: input.clientKey, name: input.name, organizer: "unknown", joinUrl: `hand:${crypto.randomUUID()}`, eventId: null, registrantId: me,
    start: start.toPlainTime().toString({ smallestUnit: "minute" }), minutes, zone, attendees: [], day: start.toPlainDate().toString(), startAt: rec.startAt, endAt: start.add({ minutes }).toInstant().toString(),
  });
  ctx.log({ source: "plan", op: "meeting_pocket_add" });
  return { ok: true, data: { occurrenceId: r.occurrence.id } };
}
