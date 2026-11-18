// MC-2b, PK-4: my own Pocket recordings in Calls. Pocket is asked only from these, each with my own key from my own
// sealed secrets, for me alone:
//   meeting.pocket_list    when I open Calls, press Refresh or press Check Pocket again (PK-4): my recordings of Calls'
//                          last 14 days (whose they are by plan/pocket-recordings.ts `whoseKept`; the rest only
//                          counted), held 5 minutes in this server's memory for me (and the page's while Calls is
//                          open). At most one list in 5 minutes, unless my Pocket addresses changed since. Never stored
//                          or logged.
//   meeting.pocket_bring   Continue on a setup with "Use my Pocket recording": one recording by an id from my own
//                          list of the last 5 minutes, onto a call I review that it goes with, its part during the
//                          call when it is much longer (or all of it when I chose so). Its transcript becomes the
//                          call's under every rule a transcript has, then the same AI pass as an upload.
// meeting.pocket_add makes a recording that goes with no call its own call (a call only I see, as one added by hand),
// from the hold, without asking Pocket. PK-4's meeting.pocket_address_add checks an address I type against the
// recorders of the list just read (held as hashes) without asking Pocket; _remove forgets one. Nothing here runs from
// a job, a schedule, the assistant or the Teams bot. Logs say only the outcome: never a title, an id, a count, an
// address, a date or a word of a recording.
import type { ActionResponse } from "./types.ts";
import { PocketError, POCKET_FAILURE_TEXT, recorderHash, type PocketFailure, type PocketRecording } from "../sources/pocket/client.ts";
import { POCKET_ADDRESS_MAX, type PocketPort } from "./pocket-actions.ts";
import type { MeetingStore } from "../store/meeting-store.ts";
import { canConfirm, type MeetingSeries, type Occurrence } from "../plan/meetings.ts";
import { otherCallsWindow } from "../plan/calls.ts";
import { goesWith, hasTimes, inSeconds, lengthWords, longerThanCall, partDuring, pocketLines, POCKET_HOLD_MS, whoseKept, type ListCounts } from "../plan/pocket-recordings.ts";
import { POCKET_CALL_WORDS } from "../plan/pocket-words.ts";

import type { PocketListView, PocketRecordingView } from "./pocket-types.ts";
export type { PocketListView, PocketRecordingView };

/** PK-4: refused addresses on one held list before Set my Pocket address waits for the next list. */
export const POCKET_ADDRESS_TRIES = 5;

type Held = { at: number; recs: Map<string, PocketRecording>; view: PocketListView; recorders: ReadonlySet<string>; sig: string; refused: number };

/**
 * MC-2b, PK-4: each person's last list, in this server's memory only, for 5 minutes: a recording can be brought in only
 * by an id from the person's own list of the last 5 minutes; opening Calls again within them shows that list without
 * asking Pocket; Set my Pocket address checks against its recorders (hashes only). Keyed by user id; nothing else can
 * read another's.
 */
export function createPocketHold(now: () => number) {
  const held = new Map<string, Held>();
  const sweep = () => {
    for (const [k, v] of held) if (now() - v.at > POCKET_HOLD_MS) held.delete(k);
  };
  const k = (u: string) => u.toLowerCase();
  return {
    put(userId: string, recs: readonly PocketRecording[], x: { view: PocketListView; recorders: ReadonlySet<string>; sig: string }): void {
      sweep();
      held.set(k(userId), { at: now(), recs: new Map(recs.map((r) => [r.id, r])), view: x.view, recorders: x.recorders, sig: x.sig, refused: 0 });
    },
    get(userId: string, id: string): PocketRecording | null {
      sweep();
      return held.get(k(userId))?.recs.get(id) ?? null;
    },
    /** PK-4: my held list, or null after 5 minutes. */
    list(userId: string): Readonly<Held> | null {
      sweep();
      return held.get(k(userId)) ?? null;
    },
    /** PK-4: one more refused address on my held list; how many now. */
    refuse(userId: string): number {
      const h = held.get(k(userId));
      return h ? ++h.refused : POCKET_ADDRESS_TRIES;
    },
    /** PK-4: Disconnect forgets my held list at once. */
    drop(userId: string): void {
      held.delete(k(userId));
    },
    /** For tests: how many people have a list held. */
    size: () => (sweep(), held.size),
  };
}
export type PocketHold = ReturnType<typeof createPocketHold>;

/** What the meeting actions need for Pocket: my own port (key and client), the shared hold, my addresses. */
export type MeetingPocket = {
  port: PocketPort;
  hold: PocketHold;
  /** The addresses FocusTime knows me by (my sign-in's email and UPN). */
  myEmails: () => Promise<string[]>;
  /** PK-4: the addresses other FocusTime people are known by: never kept as one recorder's, never accepted as mine. */
  theirEmails?: () => Promise<string[]>;
};

/** The bits of the meeting actions' context these use. */
export type PocketCallContext = {
  pocket?: MeetingPocket;
  now: () => string;
  log: (r: { source: "plan"; op: string; kind?: string }) => void;
  cooptimizer?: (userId: string) => Promise<boolean>;
};

const bad = (error: string, status = 400, code?: string): ActionResponse => ({ ok: false, status, error, ...(code ? { code } : {}) });
const endAt = (r: PocketRecording) => Temporal.Instant.from(r.startAt).add({ seconds: r.seconds }).toString();
const viewOf = (r: PocketRecording): PocketRecordingView => ({ id: r.id, startAt: r.startAt, endAt: endAt(r), minutes: Math.max(1, Math.round(r.seconds / 60)), title: r.title });

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

const lower = (e: string) => e.trim().toLowerCase();
/** PK-4: what a held list was sorted with: my Pocket addresses. A list sorted with others is asked for again. */
const sigOf = (addresses: readonly string[]) => [...addresses].map(lower).sort().join("\n");

/**
 * MC-2b, PK-4: my recordings of Calls' window, when I open Calls, press Refresh or press Check Pocket again; held for me
 * 5 minutes. Within them the held list answers and Pocket isn't asked, unless my Pocket addresses changed since.
 */
export async function pocketList(ctx: PocketCallContext, me: string, zone: string): Promise<ActionResponse> {
  const p = ctx.pocket;
  if (!p || !(await p.port.key.has())) return bad(POCKET_CALL_WORDS.notConnected, 409, "pocket_not_connected");
  const addresses = await p.port.addresses.get();
  const sig = sigOf(addresses);
  const held = p.hold.list(me);
  if (held && held.sig === sig) {
    ctx.log({ source: "plan", op: "meeting_pocket_list", kind: "held" });
    return { ok: true, data: held.view };
  }
  const w = otherCallsWindow(ctx.now(), zone);
  const utc = (iso: string) => iso.slice(0, 10);
  const mine = [...(await p.myEmails()), ...addresses];
  // Fails closed: when who else FocusTime knows can't be read, no one-recorder list is kept as mine.
  let others = true;
  const theirs = p.theirEmails ? await p.theirEmails().catch(() => ((others = false), [] as string[])) : [];
  let list;
  try {
    list = await p.port.client.listRecordings(keyOf(p.port), utc(w.fromIso), utc(Temporal.Instant.from(w.toIso).toString()), (rs, isRecording) => whoseKept(rs, { mine, theirs, others }, isRecording));
  } catch (e) {
    return failed(ctx, e, "meeting_pocket_list");
  }
  // Only Calls' window, and only recordings that have ended: Pocket's dates are whole UTC days.
  const now = Date.parse(ctx.now());
  const kept = list.recordings.filter((r) => Date.parse(r.startAt) + r.seconds * 1000 >= Date.parse(w.fromIso) && Date.parse(r.startAt) <= now);
  const counts: ListCounts = { ...list.counts, kept: kept.length, outside: list.counts.kept - kept.length };
  const view: PocketListView = {
    recordings: kept.map(viewOf).sort((a, b) => b.startAt.localeCompare(a.startAt)), counts, more: list.more, at: ctx.now(), days: 14,
    canSetAddress: counts.address > 0 && addresses.length < POCKET_ADDRESS_MAX,
  };
  p.hold.put(me, kept, { view, recorders: list.recorders, sig });
  ctx.log({ source: "plan", op: "meeting_pocket_list", kind: list.more ? "more" : "ok" });
  return { ok: true, data: view };
}

/** PK-4: an address as typed: one line, one @, no spaces, as an email address is written. */
const ADDRESS = /^[^\s@]{1,64}@[^\s@]{1,255}$/;

/**
 * PK-4: Set my Pocket address. Accepted only when it is the recorder on at least one item that may be a recording on the
 * list just read for me (its hash among the held recorders) and not an address another FocusTime person is known by;
 * otherwise refused in the same words, so a refusal never says whose an address is. Up to 3; 5 refusals a list.
 * Pocket isn't asked; the next list (Calls asks for it right after) is sorted with the new address.
 */
export async function pocketAddressAdd(ctx: PocketCallContext, me: string, input: { address: unknown }): Promise<ActionResponse> {
  const p = ctx.pocket;
  if (!p || !(await p.port.key.has())) return bad(POCKET_CALL_WORDS.notConnected, 409, "pocket_not_connected");
  const typed = typeof input.address === "string" ? input.address.trim() : "";
  if (typed.length > 320 || !ADDRESS.test(typed)) return bad(POCKET_CALL_WORDS.addressShape, 400, "pocket_address_shape");
  const a = lower(typed);
  const list = await p.port.addresses.get();
  if (list.includes(a)) return { ok: true, data: { addresses: list } };
  if ((await p.myEmails()).map(lower).includes(a)) return bad(POCKET_CALL_WORDS.addressKnown, 409, "pocket_address_known");
  if (list.length >= POCKET_ADDRESS_MAX) return bad(POCKET_CALL_WORDS.addressMax, 409, "pocket_address_max");
  const held = p.hold.list(me);
  if (!held) return bad(POCKET_CALL_WORDS.addressListFirst, 409, "pocket_get_again");
  if (held.refused >= POCKET_ADDRESS_TRIES) return bad(POCKET_CALL_WORDS.addressTries, 429, "pocket_address_tries");
  // Fails closed: when who else FocusTime knows can't be read, nothing is accepted (and no try is spent).
  let theirs: string[];
  try {
    theirs = p.theirEmails ? (await p.theirEmails()).map(lower) : [];
  } catch {
    ctx.log({ source: "plan", op: "meeting_pocket_address", kind: "unchecked" });
    return bad(POCKET_CALL_WORDS.addressUnchecked, 503, "pocket_address_unchecked");
  }
  if (theirs.includes(a) || !held.recorders.has(recorderHash(a))) {
    p.hold.refuse(me);
    ctx.log({ source: "plan", op: "meeting_pocket_address", kind: "refused" });
    return bad(POCKET_CALL_WORDS.addressRefused, 422, "pocket_address_refused");
  }
  const next = [...list, a];
  await p.port.addresses.set(next);
  ctx.log({ source: "plan", op: "meeting_pocket_address", kind: "added" });
  return { ok: true, data: { addresses: next } };
}

/** PK-4: forget one of my Pocket addresses (Settings). Pocket isn't asked. */
export async function pocketAddressRemove(ctx: PocketCallContext, input: { address: unknown }): Promise<ActionResponse> {
  const p = ctx.pocket;
  if (!p) return bad(POCKET_CALL_WORDS.notConnected, 409, "pocket_not_connected");
  if (typeof input.address !== "string" || input.address.length > 320) return bad(POCKET_CALL_WORDS.addressShape, 400, "pocket_address_shape");
  const a = lower(input.address);
  const next = (await p.port.addresses.get()).filter((x) => x !== a);
  await p.port.addresses.set(next);
  ctx.log({ source: "plan", op: "meeting_pocket_address", kind: "removed" });
  return { ok: true, data: { addresses: next } };
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
