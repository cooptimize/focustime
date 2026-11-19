// MC-1: meeting capture's actions. Registering a client's weekly call (Admin › Clients › <client> › Meetings, an
// admin), the calls I review or attend, uploading a transcript for a dated occurrence (a reviewer), "No transcript
// this week", and the review: one screen per occurrence where a reviewer ticks, edits or skips each proposal and one
// Confirm makes them through the existing writes: a gap becomes my draft and then the existing DevOps create, a
// comment the existing DevOps comment (both with the write framework's preview, read back, audit log and undo), a
// commitment a shared commitment that shows in the committer's own Promises (a Cooptimizer's) or my Waiting on (the
// client's). Nothing writes without Confirm; nobody's plan but my own is written.
//
// MC-2: Calls. A call that isn't registered, from my own calendar (`meeting.calls` lists them, kept nowhere) or added
// by hand (`meeting.call_add`), is kept only from my press (`meeting.call_start`): the client it is about (my choice),
// me its one reviewer, the Cooptimizers on my invite its attendees. Get it from Teams (`meeting.call_fetch`) checks the
// call on my own calendar again and opens one press (actions/call-press.ts) the Graph gate lets through for that one
// try; a refusal says why in plain words and points to the upload. Nothing reads such a call in the background.
//
// Transcript text never goes to a log or an error message; logs carry ids-free counts and outcomes only.
import { INTERNAL_CLIENT } from "../week/follow.ts";
import type { CheckNowResult } from "../plan/meetings.ts";
import type { ClientEntry } from "../ai/guard.ts";
import type { AiService } from "../ai/service.ts";
import type { AppConfig } from "../config/schema.ts";
import type { LogRecord } from "../log/logger.ts";
import { fromPocket, pastedAs, speakersNamed, attendeeIds, canConfirm, isCall, mayRead, commentLevelOk, defaultReviewers, detectSource, joinKey, lastReadLine, MEETING_ROLES, newOnly, nextRetry, nudgesFor, outcomeOf, parseOutcome, proposalOrder, retryable, ROLE_LABEL, toReview, type MeetingRole, type MeetingSeries, type Occurrence, type Proposal, type ProposalBody, type TranscriptKind, type TranscriptSource } from "../plan/meetings.ts";
import { AnswersError, parseAnswers, type Answers } from "../plan/three-questions.ts";
import { callWriteWords, CALL_LIST, CALL_ROW, FETCH_WORDS, fetchFound, type FetchOutcome, type ProposalCheck, type RequiredField, CHAT_OTHER_CLIENT, DISMISS_TEXT } from "../plan/call-words.ts";
import { inWindow, isOtherCall, OTHER_CALL_DAYS, otherCallsWindow, type CalendarMeeting } from "../plan/calls.ts";
import type { PressGrants } from "./call-press.ts";
import { CHECK_CAP, type ExistsGrants, type ExistsHold, type HeldAnswer } from "./call-exists.ts";
import type { ChatCallPresses } from "./chat-call-press.ts";
import type { ChatCallsPort, ChatCallEntry } from "./chat-calls-port.ts";
import { AdhocRefused, readChatTranscript, type AdhocCallsClient } from "../sources/graph/adhoc-calls.ts";
import { callIdOfKey, chatCallKey } from "../plan/cowork.ts";
import { splitNeeded, type NeededAnswer, type NeededFill } from "../plan/needed.ts";
import { pocketAdd, pocketAddressAdd, pocketAddressRemove, pocketBring, pocketList, type MeetingPocket } from "./meeting-pocket.ts";

/** RQ-1: devops.needed's answer as a row reads it. */
export type NeededCheck = NeededAnswer & { level: "story" | "above" | null; projectName?: string };
import { aiFailedLine, aiNextLine, PASTE_TEXT } from "../plan/call-words.ts";
import { readPaste, type PasteAs } from "../plan/transcript.ts";
import type { ProcessModel } from "../plan/process.ts";
import { atOf, joinTranscriptParts, parseVtt, TranscriptError, type TranscriptLine } from "../plan/transcript.ts";
import { AuthFailure } from "../sources/oauth/oauth.ts";
import { HttpError } from "../sources/calendar/http.ts";
import { graphFailureOf, MeetingRefused, pressTranscript, TranscriptsOff, type ExistsAsk, type GraphFailure, type MeetingsClient, type SeriesCandidate } from "../sources/graph/meetings.ts";
import { MEETING_CHAT, type ConversationStore } from "../store/conversation-store.ts";
import type { MeetingStore } from "../store/meeting-store.ts";
import type { PlanStore } from "../store/plan-store.ts";
import { PlanError } from "../store/plan-store.ts";
import type { WorkItem } from "../week/types.ts";
import { userZone } from "../week/zone.ts";
import { capturePass } from "./meeting-capture.ts";
import { READS, IntakeError, readTranscriptFile, type ReadPdf, type TranscriptRead } from "./transcript-file.ts";
import type { CallOutcome, OccurrenceView, OtherCallView, SeriesView } from "../plan/meeting-views.ts";
import { closedAtOf, outcomeOfCall } from "../plan/call-list.ts";
export type { MeetingNudgeView, OccurrenceView, OtherCallView, SeriesView } from "../plan/meeting-views.ts";
import type { ActionResponse } from "./types.ts";

export const MEETING_ACTIONS = ["meeting.list", "meeting.candidates", "meeting.register", "meeting.update", "meeting.remove", "meeting.mine", "meeting.review", "meeting.edit", "meeting.no_transcript", "meeting.keep", "meeting.unkeep", "meeting.rerun", "meeting.check_now", "meeting.transcript", "meeting.calls", "meeting.call_start", "meeting.call_fetch", "meeting.call_add", "meeting.pocket_list", "meeting.pocket_bring", "meeting.pocket_add", "meeting.pocket_address_add", "meeting.pocket_address_remove", "meeting.calls_check", "meeting.call_hides", "meeting.call_hide", "meeting.call_unhide", "meeting.skip_all", "meeting.unskip_all", "meeting.call_remove", "meeting.call_restore", "meeting.call_close_none", "meeting.call_reopen"] as const;
export type MeetingAction = (typeof MEETING_ACTIONS)[number];

/** A FocusTime user as registration matches them: id, name and every address that is them. */
export type MeetingUser = { id: string; name: string; emails: string[] };

/** What one client's AI pass needs besides the transcript (null when that client can't be read now). */
export type CaptureContext = { clientName: string; internal: boolean; items: WorkItem[]; model: ProcessModel | null; directory: ClientEntry[] };

export type MeetingContext = {
  meetings: MeetingStore | undefined;
  conversations: ConversationStore | undefined;
  plan: PlanStore | undefined;
  me: () => Promise<string | null>;
  isAdmin: () => Promise<boolean>;
  config: () => Promise<AppConfig | null>;
  now: () => string;
  homeDomains: () => Promise<string[]>;
  /** My Graph meetings client (my calendar; the meetings token), or null when I'm not signed in with Microsoft. */
  graph: (cfg: AppConfig) => MeetingsClient | null;
  users: () => Promise<MeetingUser[]>;
  /** PK-1: the PDF reader (server/pdf-text.ts: a worker thread, 500 pages, 10 seconds); absent: a PDF is refused. */
  readPdf?: ReadPdf;
  /** MC-1d: the meeting job runs here (production), so a failed pass is tried again by itself; the page says so only then. */
  retriesHere?: boolean;
  /** ENV-1: Check now (server/meeting-job.ts): one look, with my sign-in only. Absent: not available here. */
  checkNow?: (seriesId: number, userId: string) => Promise<CheckNowResult>;
  /**
   * MC-1c: a client in the organization's list (the one Admin › Clients shows, clientAccounts()), matched the way the
   * rest of the app matches keys (case-insensitive), as its own key and name; null for anything that isn't a client.
   * Never the admin's personal client settings. "unavailable" when the list can't be read now (it fails closed).
   */
  client: (clientKey: string) => Promise<{ key: string; name: string } | null | "unavailable">;
  /** The client's leads' user ids (Dataverse's with admins' overrides). */
  leads: (clientKey: string) => Promise<string[]>;
  capture: (cfg: AppConfig, clientKey: string) => Promise<CaptureContext | null>;
  /** The meeting AI: my switches, the app's cap (a background pass, like the conversations pipeline). */
  ai: () => Promise<AiService | null>;
  /**
   * MC-1e: the fields the client's process requires on a new item of each type, with no default, read with my write
   * PAT (null when they can't be read now). The rows ask for them before any preview; the writes themselves go only
   * through the DevOps write framework's one preview (kinds meeting_create and meeting_comment), never from here.
   */
  required?: (clientKey: string, types: readonly string[]) => Promise<{ projectName: string; types: Record<string, RequiredField[]> } | null>;
  /**
   * RQ-1: DevOps's own check of a new item without saving it (the write framework's devops.needed): a row's item as it
   * would be created, and the same item with only a title (what the process requires at all). Its answer wins over
   * `required`, which stays the first hint for when DevOps can't be asked.
   */
  needed?: (clientKey: string, change: Record<string, unknown>) => Promise<NeededCheck | null>;
  /** Whether I have a checked write PAT for the client. */
  canWrite: (clientKey: string) => Promise<boolean>;
  log: (r: LogRecord) => void;
  /** MC-2: the presses the Graph gate lets through; absent: Get it from Teams isn't available here. */
  press?: PressGrants;
  /** MC-2: a Cooptimizer by the people rule (never a guest or an automation account); absent: nobody is. */
  cooptimizer?: (userId: string) => Promise<boolean>;
  /** MC-6: whether a key is Cooptimize Internal (clientAccounts()'s why "internal"); a chat call may be filed there. */
  isInternal?: (clientKey: string) => Promise<boolean>;
  /** MC-2b: my own Pocket (my key, the one client), the shared 5 minute hold and my addresses; absent: not here. */
  pocket?: MeetingPocket;
  /** MC-4: the "exists" allowances the Graph gate lets through and the 15 minute memory of answers; absent: not checked here. */
  exists?: { grants: ExistsGrants; hold: ExistsHold };
  /** MC-2c: the calls started in my registered client chats with a transcript event (what the poll kept); absent: none here. */
  chatCalls?: ChatCallsPort;
  /** MC-2c: the presses the chat call transcript client lets through; absent: Get it from Teams isn't here for a chat call. */
  chatPress?: ChatCallPresses;
  /** MC-2c: my chat call transcript client (CallTranscripts.Read.All, behind my press), or null when I'm not signed in. */
  adhoc?: (cfg: AppConfig) => AdhocCallsClient | null;
};

class Invalid extends Error {}
const bad = (error: string, status = 400): ActionResponse => ({ ok: false, status, error });
const obj = (input: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> => {
  const o = input === undefined || input === null ? {} : input;
  if (typeof o !== "object" || Array.isArray(o)) throw new Invalid("Expected an object");
  const r = o as Record<string, unknown>;
  const extra = Object.keys(r).find((k) => !required.includes(k) && !optional.includes(k));
  if (extra) throw new Invalid(`Unknown field ${extra}`);
  const missing = required.find((k) => r[k] === undefined);
  if (missing) throw new Invalid(`${missing} is required`);
  return r;
};
const text = (v: unknown, name: string, max: number, optional = false): string | null => {
  if (v === undefined || v === null) {
    if (optional) return null;
    throw new Invalid(`${name} is required`);
  }
  if (typeof v !== "string" || !v.trim() || v.length > max) throw new Invalid(`${name} must be text up to ${max} characters`);
  return v.trim();
};
const id = (v: unknown, name: string): number => {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v <= 0) throw new Invalid(`${name} must be an id`);
  return v;
};
const JOIN_URL = /^https:\/\/teams\.microsoft\.com\/l\/meetup-join\/[^\s]{10,3900}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const lower = (s: string) => s.toLowerCase();

const WEEKDAYS = ["", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"];
function whenOf(s: Pick<MeetingSeries, "weekday" | "start" | "minutes" | "interval">): string {
  const [h, m] = s.start.split(":").map(Number);
  const t = (mins: number) => {
    const hh = Math.floor(mins / 60) % 24;
    return `${hh % 12 || 12}:${String(mins % 60).padStart(2, "0")} ${hh < 12 ? "AM" : "PM"}`;
  };
  const start = h! * 60 + m!;
  return `${s.interval > 1 ? `Every ${s.interval} weeks on ${WEEKDAYS[s.weekday]}` : WEEKDAYS[s.weekday]} ${t(start)} to ${t(start + s.minutes)}`;
}

function viewOf(s: MeetingSeries, clientName: string, users: readonly MeetingUser[], me: string): SeriesView {
  const name = (uid: string) => users.find((u) => lower(u.id) === lower(uid))?.name ?? "A former teammate";
  return {
    id: s.id, clientKey: s.clientKey, clientName, name: s.name, role: s.role, roleLabel: isCall(s) ? "Call" : ROLE_LABEL[s.role], source: s.source, detected: s.detected, organizer: s.organizer,
    when: isCall(s) ? callWhen(s) : whenOf(s), weekday: s.weekday, start: s.start, minutes: s.minutes, zone: s.zone, reviewers: s.reviewers.map((r) => ({ id: r, name: name(r) })), attendees: s.attendees.length,
    mine: { review: s.reviewers.some((r) => lower(r) === lower(me)), attend: s.attendees.some((a) => lower(a) === lower(me)) },
    call: s.callKind, teams: (s.callKind === "calendar" && /^https:\/\//.test(s.joinUrl) && s.organizer !== "other") || s.callKind === "chat",
  };
}
/** MC-2: a call's one time, "9:30 to 10:15 AM" style, in its own zone (its day is the occurrence's). */
function callWhen(s: Pick<MeetingSeries, "start" | "minutes">): string {
  const [h, m] = s.start.split(":").map(Number);
  const t = (mins: number) => `${Math.floor(mins / 60) % 24 % 12 || 12}:${String(mins % 60).padStart(2, "0")} ${Math.floor(mins / 60) % 24 < 12 ? "AM" : "PM"}`;
  return `${t(h! * 60 + m!)} to ${t(h! * 60 + m! + s.minutes)}`;
}

// MC-1c: a Graph meeting call that failed, in plain words with a next step, never "bad request". `code` lets the
// form answer it (Sign in again for "signin"; the pattern fields for a pasted link).
const NOT_A_CLIENT = "That isn't one of FocusTime's clients";
const NO_CLIENT_LIST = "FocusTime couldn't read the client list just now. Try again in a minute";
/** MC-1c: the organization's name for each client key (the key itself when the list can't say). */
async function namesOf(ctx: MeetingContext, keys: readonly string[]): Promise<(k: string) => string> {
  const m = new Map<string, string>();
  for (const k of new Set(keys)) {
    const c = await ctx.client(k).catch(() => null);
    m.set(k, c && c !== "unavailable" ? c.name : k);
  }
  return (k) => m.get(k) ?? k;
}
/** The organization's client for a key, or the refusal (not a client: 404; the list can't be read: 503). */
async function clientOf(ctx: MeetingContext, key: string): Promise<{ key: string; name: string } | ActionResponse> {
  const c = await ctx.client(key);
  if (c === "unavailable") return { ok: false, status: 503, error: NO_CLIENT_LIST, code: "busy" };
  return c ?? bad(NOT_A_CLIENT, 404);
}
const isRefusal = (x: unknown): x is ActionResponse => typeof x === "object" && x !== null && "ok" in x;
export const GRAPH_WORDS: Record<Exclude<GraphFailure, "missing">, { status: number; error: string }> = {
  signin: { status: 409, error: "Sign in with Microsoft again to see your calendar's meetings" },
  consent: { status: 403, error: "Microsoft refused FocusTime access to your calendar (Calendars.ReadWrite). A Cooptimize admin grants it once for everyone in the Entra admin center" },
  refused: { status: 502, error: "Microsoft didn't accept that request. Paste the meeting's Teams join link instead" },
  busy: { status: 503, error: "Microsoft isn't answering right now. Try again in a minute" },
  setup: { status: 503, error: "FocusTime's Microsoft sign-in isn't set up here. A FocusTime admin can see why in Admin › Health" },
};
const NOT_ON_CALENDAR = "That meeting isn't a weekly Teams meeting on your calendar";
type Refusal = { ok: false; status: number; error: string; code: string };
/** The answer for a failed Graph call (logged by kind only: never a token, header, body, link or id), or null. */
function graphProblem(ctx: Pick<MeetingContext, "log">, e: unknown): Refusal | null {
  const kind = graphFailureOf(e);
  if (!kind) return null;
  const code = kind === "refused" ? "graph_refused" : kind;
  ctx.log({ source: "plan", op: "meeting_graph_failed", kind: code });
  if (kind === "missing") return { ok: false, status: 404, error: NOT_ON_CALENDAR, code };
  return { ok: false, ...GRAPH_WORDS[kind], code };
}

/** ENV-1: Check now's answer in plain words (never a meeting name, link or person). */
const CHECK_NOW_WORDS: Record<CheckNowResult, string> = {
  found: "Found the transcript. Its reviewers can review it now.",
  not_yet: "No transcript yet for the last call. Try again later.",
  no_token: "Your Microsoft sign-in couldn't read this call. Sign in again, then try again.",
  consent: "Your sign-in needs the meetings permission first. Sign in again and allow it.",
  missing: "This call isn't on your calendar, so your sign-in can't read it.",
  busy: "Microsoft is busy. Try again in a few minutes.",
  failed: "The transcript couldn't be read. Its reviewers can upload it instead.",
  upload: "This call's transcript is uploaded by its reviewers, so there is nothing to look for.",
  none: "There's no ended call in the last two days to look for.",
  not_found: "No such meeting.",
};


export async function meetingAction(ctx: MeetingContext, action: MeetingAction, input: unknown): Promise<ActionResponse> {
  try {
    const store = ctx.meetings;
    const me = await ctx.me();
    if (!store || !me) return bad("Meetings aren't available here", 503);
    const cfg = await ctx.config();
    if (!cfg) return bad("Fix the config first", 409);
    switch (action) {
      case "meeting.list": {
        // Admin › Clients › <client> › Meetings: the client's registered calls (admins only; no transcripts here).
        const o = obj(input, ["clientKey"]);
        if (!(await ctx.isAdmin())) return bad("Only FocusTime admins register meetings", 403);
        const client = await clientOf(ctx, text(o.clientKey, "clientKey", 100)!);
        if (isRefusal(client)) return client;
        const users = await ctx.users();
        // The reviewer picker's people: FocusTime users by name (ids for the picker, never an address).
        const nameOf = (uid: string) => users.find((u) => lower(u.id) === lower(uid))?.name ?? null;
        const from = Temporal.Instant.from(ctx.now()).subtract({ hours: 24 * 21 }).toZonedDateTimeISO("UTC").toPlainDate().toString();
        const meetings = await Promise.all((await store.seriesOf(client.key)).map(async (s) => ({ ...viewOf(s, client.name, users, me), lastRead: lastReadLine(s, await store.occurrencesOf(s.id, { from }), ctx.now(), userZone(cfg), nameOf) })));
        return { ok: true, data: { meetings, people: users.map((u) => ({ id: u.id.toLowerCase(), name: u.name })).sort((a, b) => a.name.localeCompare(b.name)) } };
      }
      case "meeting.candidates": {
        // My recurring online meetings with people from outside Cooptimize, the client's name first.
        const o = obj(input, ["clientKey"]);
        if (!(await ctx.isAdmin())) return bad("Only FocusTime admins register meetings", 403);
        const client = await clientOf(ctx, text(o.clientKey, "clientKey", 100)!);
        if (isRefusal(client)) return client;
        const g = ctx.graph(cfg);
        if (!g) return { ok: false, status: 409, error: GRAPH_WORDS.signin.error, code: "signin" };
        const names = [client.key, client.name].filter(Boolean).map(lower);
        const zone = userZone(cfg);
        let all: SeriesCandidate[];
        try {
          all = await g.seriesOnMyCalendar(zone, ctx.now());
        } catch (e) {
          const p = graphProblem(ctx, e);
          if (p) return p;
          throw e;
        }
        // Taken by any admin: by join link (event ids are per mailbox, so another admin's registration has another id).
        const taken = new Set((await store.allSeries()).map((s) => joinKey(s.joinUrl)));
        const home = await ctx.homeDomains();
        const rows = all
          .filter((c) => !taken.has(joinKey(c.joinUrl)))
          .map((c) => ({ eventId: c.eventId, subject: c.subject, organizerName: c.organizerName, organizer: detectSource(c.organizerEmail, home).organizer, when: whenOf({ ...c }), outside: c.outside, match: names.some((n) => lower(c.subject).includes(n)) }))
          .sort((a, b) => Number(b.match) - Number(a.match) || a.subject.localeCompare(b.subject));
        return { ok: true, data: { candidates: rows } };
      }
      case "meeting.register": return await register(ctx, store, cfg, me, input);
      case "meeting.update": {
        const o = obj(input, ["seriesId"], ["name", "role", "reviewers", "source"]);
        if (!(await ctx.isAdmin())) return bad("Only FocusTime admins change registered meetings", 403);
        const s = await store.series(id(o.seriesId, "seriesId"));
        // MC-2: a call that isn't registered is its person's own; Admin never changes one.
        if (!s || s.removedAt || isCall(s)) return bad("No such meeting", 404);
        const users = await ctx.users();
        const clientName = (await namesOf(ctx, [s.clientKey]))(s.clientKey);
        const reviewers = o.reviewers === undefined ? undefined : reviewerIds(o.reviewers, users);
        const role = o.role === undefined ? undefined : roleOf(o.role);
        const source = o.source === undefined ? undefined : sourceOf(o.source);
        // A client-hosted meeting is never read from Graph, whatever the override says (D: Upload only).
        if (source === "automatic" && s.organizer === "other") return bad("This meeting is organized outside Cooptimize, so its transcript can only be uploaded", 409);
        const next = await store.updateSeries(s.id, { ...(o.name !== undefined ? { name: text(o.name, "name", 200)! } : {}), ...(role ? { role } : {}), ...(reviewers ? { reviewers } : {}), ...(source ? { source } : {}) });
        return { ok: true, data: { meeting: viewOf(next, clientName, users, me) } };
      }
      case "meeting.check_now": {
        // ENV-1: Admin › Clients › <client> › Meetings › Check now: look once for the latest ended occurrence's
        // transcript, with my own sign-in only. Schedules nothing; on a test site it is how capture is tried.
        const o = obj(input, ["seriesId"]);
        if (!(await ctx.isAdmin())) return bad("Only FocusTime admins check registered meetings", 403);
        if (!ctx.checkNow) return bad("Check now isn't available here", 503);
        const s = await store.series(id(o.seriesId, "seriesId"));
        if (!s || s.removedAt || isCall(s)) return bad("No such meeting", 404);
        const result = await ctx.checkNow(s.id, me);
        return { ok: true, data: { result, message: CHECK_NOW_WORDS[result] } };
      }
      case "meeting.remove": {
        const o = obj(input, ["seriesId"]);
        if (!(await ctx.isAdmin())) return bad("Only FocusTime admins change registered meetings", 403);
        await store.removeSeries(id(o.seriesId, "seriesId"));
        ctx.log({ source: "plan", op: "meeting_removed" });
        return { ok: true, data: { removed: true } };
      }
      case "meeting.mine": {
        // The calls I review or attend, with their last 5 weeks of occurrences (Week's call marker, the review list).
        obj(input, [], []);
        const users = await ctx.users();
        const from = Temporal.Instant.from(ctx.now()).subtract({ hours: 24 * 35 }).toZonedDateTimeISO("UTC").toPlainDate().toString();
        // MC-2: with the calls that aren't registered that I pressed Review on, was on, or added (their marks on Day and
        // Week, their rows in Calls); nudges stay the registered calls' (nudgesFor).
        // MC-2c: a kept chat call shows to its reviewers, and to the others on it only while they're in its chat and follow its client.
        const mine = [...(await store.viewer(me).series()), ...seenChatCalls(me, await store.viewer(me).calls(from))];
        const occs = await store.recentOccurrences(mine.map((s) => s.id), from);
        const counts = new Map<number, { all: number; open: number; done: CallOutcome; closedAt: string | null }>();
        for (const o of occs) {
          const ps = await store.proposals(o.id);
          counts.set(o.id, { all: ps.length, open: ps.filter(toReview).length, done: outcomeOfCall(ps), closedAt: closedAtOf(ps) });
        }
        const kept = await store.withTranscript(occs.map((o) => o.id));
        const vo = (o: Occurrence): ViewOpts => ({ counts: counts.get(o.id), hasTranscript: kept.has(o.id), retriesHere: !!ctx.retriesHere, zone: userZone(cfg) });
        // The nudges (in-app and the Teams kind): ready to review, or a transcript to upload; once each by key.
        const nameOf = await namesOf(ctx, mine.map((s) => s.clientKey));
        const nudges = nudgesFor(me, mine, occs).map((n) => ({ ...n, clientName: nameOf(n.clientKey), dateLabel: Temporal.PlainDate.from(n.date).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" }) }));
        // WK-6: each occurrence's meeting by its iCalUId: kept on the occurrence (a registered call's, from its instances),
        // or a calendar call's own (MC-2 keeps it as the call's event id). A call added by hand has none.
        const calendarKey = new Map(mine.filter((s) => s.callKind === "calendar" && s.eventId).map((s) => [s.id, s.eventId!]));
        return { ok: true, data: { meetings: mine.map((s) => viewOf(s, nameOf(s.clientKey), users, me)), occurrences: occs.map((o) => ({ ...occView(o, vo(o)), eventKey: o.eventKey ?? calendarKey.get(o.seriesId) ?? null })), nudges } };
      }
      case "meeting.review": return await review(ctx, store, cfg, me, input);
      case "meeting.transcript": return await transcriptOf(ctx, store, me, input);
      case "meeting.edit": {
        // Edit or skip one proposal (a reviewer); a decided one stays as it is.
        const o = obj(input, ["proposalId"], ["skip", "title", "description", "parentId", "parentTitle", "type", "what", "due", "text", "assignTo", "date", "size", "answers"]);
        const p = await store.proposal(id(o.proposalId, "proposalId"));
        if (!p) return bad("No such proposal", 404);
        if (p.state === "confirmed") return bad("That one is already done", 409);
        // MC-1e: a decided proposal's words stay as they were; Bring back first.
        if (p.state === "skipped" && o.skip === undefined) return bad("Bring it back first", 409);
        if (o.skip !== undefined) {
          if (typeof o.skip !== "boolean") throw new Invalid("skip must be true or false");
          const next = await store.viewer(me).updateProposal(p.id, { state: o.skip ? "skipped" : "open", decidedBy: o.skip ? me : null, decidedAt: o.skip ? ctx.now() : null });
          // MC-4: a skip that leaves nothing undecided closes the call; putting one back opens it again.
          if (o.skip) await settledCall(store, p.occurrenceId, me);
          else await reopenCall(store, p.occurrenceId);
          return { ok: true, data: { proposal: next } };
        }
        const body = edited(p.body, o);
        return { ok: true, data: { proposal: await store.viewer(me).updateProposal(p.id, { body }) } };
      }
      case "meeting.no_transcript": {
        const o = obj(input, ["occurrenceId"]);
        const occ = await store.viewer(me).updateOccurrence(id(o.occurrenceId, "occurrenceId"), { state: "no_transcript", dismissedBy: me, nextCheckAt: null });
        ctx.log({ source: "plan", op: "meeting_no_transcript" });
        return { ok: true, data: { occurrence: occView(occ) } };
      }
      case "meeting.rerun": {
        // Run the AI pass again on the stored transcript (a reviewer; e.g. after AI was allowed for the client).
        const o = obj(input, ["occurrenceId"]);
        const { o: occ, series } = await store.viewer(me).reviewer(id(o.occurrenceId, "occurrenceId"));
        const lines = await store.transcript(occ.id);
        if (!lines) return bad("There's no transcript for this meeting any more", 409);
        const r = await runPass({ store, ai: ctx.ai, capture: (k) => ctx.capture(cfg, k), users: ctx.users, log: ctx.log, now: ctx.now, ...(ctx.retriesHere ? { retriesHere: true } : {}) }, series, occ, lines);
        return { ok: true, data: r };
      }
      case "meeting.keep": return await keep(ctx, store, me, input);
      case "meeting.unkeep": return await unkeep(ctx, store, me, input);
      case "meeting.calls": return await otherCalls(ctx, store, cfg, input);
      case "meeting.call_start": return await startCall(ctx, store, cfg, me, input);
      case "meeting.call_fetch": {
        const o = obj(input, ["occurrenceId"]);
        const { o: occ, series } = await store.viewer(me).reviewer(id(o.occurrenceId, "occurrenceId"));
        if (series.callKind === "chat") return await fetchChatCall(ctx, store, cfg, me, series, occ);
        if (series.callKind !== "calendar") return bad("Only a call from your calendar can be asked of Teams; upload its transcript instead", 409);
        return await fetchFromTeams(ctx, store, cfg, me, series, occ);
      }
      case "meeting.call_add": return await addCall(ctx, store, cfg, me, input);
      // MC-4: only from Calls' own opening and its Refresh (ui/meetings/Meetings.tsx), never a job, the assistant or the bot.
      case "meeting.calls_check": return await checkCalls(ctx, store, cfg, me, input);
      // MC-4: Hide a meeting nobody asked FocusTime to read, for me only; Put back. Only which meeting is kept.
      case "meeting.call_hides": {
        obj(input, []);
        if (!ctx.plan) return bad("Hiding isn't available here", 503);
        const h = await ctx.plan.callHides();
        return { ok: true, data: { keys: [...h.keys], series: [...h.series] } };
      }
      case "meeting.call_hide":
      case "meeting.call_unhide": {
        if (!ctx.plan) return bad("Hiding isn't available here", 503);
        const items = hideItems(input);
        if (action === "meeting.call_hide") {
          // Hide is for a call nobody asked FocusTime to read: a call it keeps stays where it is.
          for (const i of items) if (i.kind === "one" && (await store.callByKey(i.key))) return bad("Someone asked FocusTime to review this call, so it can't be hidden. Skip all and close it instead.", 409);
          await ctx.plan.hideCalls(items);
        } else await ctx.plan.unhideCalls(items);
        ctx.log({ source: "plan", op: action === "meeting.call_hide" ? "meeting_call_hide" : "meeting_call_unhide", count: items.length });
        return { ok: true, data: { count: items.length } };
      }
      // MC-4: Skip all and close (one call or several I review), and its Undo. Nothing is written to DevOps or kept as a promise.
      case "meeting.skip_all": return await skipAll(store, me, input, ctx);
      case "meeting.call_remove":
      case "meeting.call_close_none": return await dismissCall(ctx, store, me, input, action === "meeting.call_remove" ? "remove" : "close");
      case "meeting.call_restore": {
        const o = obj(input, ["seriesId"]);
        if (!(await store.restoreHandCall(id(o.seriesId, "seriesId"), me))) return bad(DISMISS_TEXT.notMine, 403);
        ctx.log({ source: "plan", op: "meeting_call_restored", count: 1 });
        return { ok: true, data: { restored: true } };
      }
      case "meeting.call_reopen": {
        const o = obj(input, ["occurrenceId", "state"]);
        const state = o.state === "needs_upload" || o.state === "waiting" ? o.state : null;
        if (!state) throw new Invalid("state must be needs_upload or waiting");
        const { o: occ, series } = await store.viewer(me).reviewer(id(o.occurrenceId, "occurrenceId"));
        if (!isCall(series) || occ.state !== "no_transcript" || occ.dismissedBy?.toLowerCase() !== me.toLowerCase() || occ.transcriptAt) return bad(DISMISS_TEXT.notClosed, 409);
        await store.viewer(me).updateOccurrence(occ.id, { state, dismissedBy: null });
        ctx.log({ source: "plan", op: "meeting_call_reopened", count: 1 });
        return { ok: true, data: { reopened: true } };
      }
      case "meeting.unskip_all": return await unskipAll(store, me, input, ctx);
      // MC-2b, PK-4: only from Calls' opening, its Refresh, Check Pocket again, and Continue on a setup.
      case "meeting.pocket_list": {
        obj(input, []);
        return await pocketList(ctx, me, userZone(cfg));
      }
      case "meeting.pocket_bring": {
        const o = obj(input, ["recordingId", "occurrenceId"], ["part", "replace", "move"]);
        const pass = (series: MeetingSeries, occ: Occurrence, lines: TranscriptLine[]) => runPass({ store, ai: ctx.ai, capture: (k) => ctx.capture(cfg, k), users: ctx.users, log: ctx.log, now: ctx.now }, series, occ, lines);
        return await pocketBring(ctx, store, me, { recordingId: o.recordingId, occurrenceId: id(o.occurrenceId, "occurrenceId"), part: o.part, replace: o.replace, move: o.move }, pass);
      }
      case "meeting.pocket_add": {
        const o = obj(input, ["recordingId", "name", "clientKey"]);
        const name = text(o.name, "name", 200)!;
        const client = await clientOf(ctx, text(o.clientKey, "clientKey", 100)!);
        if (isRefusal(client)) return client;
        return await pocketAdd(ctx, store, me, userZone(cfg), { recordingId: o.recordingId, name, clientKey: client.key });
      }
      // PK-4: Set my Pocket address (Calls) and remove one (Calls, Settings). Pocket isn't asked.
      case "meeting.pocket_address_add": {
        const o = obj(input, ["address"]);
        return await pocketAddressAdd(ctx, me, { address: o.address });
      }
      case "meeting.pocket_address_remove": {
        const o = obj(input, ["address"]);
        return await pocketAddressRemove(ctx, { address: o.address });
      }
    }
  } catch (e) {
    if (e instanceof Invalid) return bad(e.message);
    if (e instanceof TranscriptError) return bad(e.message, 422);
    if (e instanceof PlanError) return bad(e.message, /No such/.test(e.message) ? 404 : /already registered/.test(e.message) ? 409 : 403);
    // MC-1c: never "bad request": anything else is said plainly and logged by its kind only.
    const kind = graphFailureOf(e);
    ctx.log({ source: "plan", op: "meeting_action_failed", kind: kind ?? (e instanceof Error ? e.name : "unknown") });
    if (kind && kind !== "missing") return { ok: false, ...GRAPH_WORDS[kind === "refused" ? "refused" : kind], code: kind === "refused" ? "graph_refused" : kind };
    return { ok: false, status: 500, error: "FocusTime couldn't finish that. Try again; if it keeps happening, a FocusTime admin can look in Admin › Health", code: "failed" };
  }
}

/** What the page, the mark and the list are told of an occurrence (MC-1d: the failed pass's words, the next try). */
type ViewOpts = { counts?: { all: number; open: number; done?: CallOutcome; closedAt?: string | null } | undefined; hasTranscript?: boolean; retriesHere?: boolean; zone?: string };
function occView(o: Occurrence, x: ViewOpts = {}): OccurrenceView {
  const failed = o.state === "failed";
  const kind = o.aiOutcome ? parseOutcome(o.aiOutcome).kind : "";
  const retryAt = failed && x.retriesHere ? o.nextCheckAt : null;
  const at = (iso: string) => Temporal.Instant.from(iso).toZonedDateTimeISO(x.zone ?? "UTC").toLocaleString("en-US", { hour: "numeric", minute: "2-digit" });
  return {
    id: o.id, seriesId: o.seriesId, date: o.date, startAt: o.startAt, endAt: o.endAt, state: o.state, transcriptFrom: o.transcriptFrom, proposals: x.counts?.all ?? 0, open: x.counts?.open ?? 0, aiOutcome: o.aiOutcome,
    aiMessage: failed ? aiFailedLine(o.aiOutcome) : null,
    aiNext: failed ? aiNextLine({ retryAt, tries: o.checks, retryable: retryable(kind), retriesHere: !!x.retriesHere, at }) : null,
    retryAt,
    hasTranscript: !!x.hasTranscript,
    readFailed: o.state === "needs_upload" && o.lastRead?.kind === "failed",
    ...(x.counts?.done ? { done: x.counts.done, closedAt: x.counts.closedAt ?? null } : {}),
  };
}


const roleOf = (v: unknown): MeetingRole => {
  if (!MEETING_ROLES.includes(v as MeetingRole)) throw new Invalid("role must be status or planning");
  return v as MeetingRole;
};
const sourceOf = (v: unknown): TranscriptSource => {
  if (v !== "automatic" && v !== "upload") throw new Invalid("source must be automatic or upload");
  return v;
};
function reviewerIds(v: unknown, users: readonly MeetingUser[]): string[] {
  if (!Array.isArray(v) || v.length === 0 || v.length > 20) throw new Invalid("reviewers must be 1 to 20 FocusTime users");
  return v.map((x) => {
    const u = typeof x === "string" ? users.find((y) => lower(y.id) === lower(x)) : undefined;
    if (!u) throw new Invalid("reviewers must be FocusTime users");
    return lower(u.id);
  });
}

async function register(ctx: MeetingContext, store: MeetingStore, cfg: AppConfig, me: string, input: unknown): Promise<ActionResponse> {
  const o = obj(input, ["clientKey", "role"], ["eventId", "joinUrl", "name", "reviewers", "source", "weekday", "start", "minutes"]);
  if (!(await ctx.isAdmin())) return bad("Only FocusTime admins register meetings", 403);
  const client = await clientOf(ctx, text(o.clientKey, "clientKey", 100)!);
  if (isRefusal(client)) return client;
  const clientKey = client.key;
  const role = roleOf(o.role);
  if ((o.eventId === undefined) === (o.joinUrl === undefined)) throw new Invalid("Pick a meeting from your calendar or paste its Teams join link");
  const g = ctx.graph(cfg);
  const zone = userZone(cfg);
  const home = await ctx.homeDomains();
  const typed = { weekday: typeof o.weekday === "number" && Number.isInteger(o.weekday) && o.weekday >= 1 && o.weekday <= 5 ? o.weekday : null, start: typeof o.start === "string" && TIME.test(o.start) ? o.start : null, minutes: typeof o.minutes === "number" && Number.isInteger(o.minutes) && o.minutes >= 15 && o.minutes <= 240 ? o.minutes : null };
  const hasPattern = typed.weekday !== null && typed.start !== null && typed.minutes !== null;
  let c: SeriesCandidate | null = null;
  let joinUrl: string;
  if (o.eventId !== undefined) {
    const eventId = text(o.eventId, "eventId", 1000)!;
    if (!g) return { ok: false, status: 409, error: GRAPH_WORDS.signin.error, code: "signin" };
    try {
      c = await g.series(eventId, zone);
    } catch (e) {
      const p = graphProblem(ctx, e);
      if (p) return p;
      throw e;
    }
    if (!c) return bad(NOT_ON_CALENDAR, 404);
    joinUrl = c.joinUrl;
  } else {
    joinUrl = text(o.joinUrl, "joinUrl", 4000)!;
    if (!JOIN_URL.test(joinUrl)) throw new Invalid("Paste the meeting's Teams join link (https://teams.microsoft.com/l/meetup-join/…)");
    // Only what my own calendar shows of it: its event in the next 5 weeks, if it's there. When Microsoft can't be
    // asked, say why; with the pattern typed in, it registers from that alone (organizer unknown, so Upload).
    if (!g && !hasPattern) return { ok: false, status: 422, error: `${GRAPH_WORDS.signin.error}. Or give its weekday, start time and length below to register it now; its transcript is then uploaded`, code: "signin" };
    if (g) {
      try {
        c = await g.seriesByJoinUrl(joinUrl, zone, ctx.now());
      } catch (e) {
        const p = graphProblem(ctx, e);
        if (!p) throw e;
        if (!hasPattern) return { ...p, status: 422, error: `${p.error.replace(/\. Paste the meeting's Teams join link instead$/, "")}. Or give its weekday, start time and length below to register it now; its transcript is then uploaded` };
      }
    }
  }
  const ALREADY = "That meeting is already registered";
  if ((await store.allSeries()).some((s) => joinKey(s.joinUrl) === joinKey(joinUrl))) return bad(ALREADY, 409);
  // The pattern: from the calendar, else typed in (a pasted link with no event on my calendar).
  const weekday = c?.weekday ?? typed.weekday;
  const start = c?.start ?? typed.start;
  const minutes = c?.minutes ?? typed.minutes;
  if (weekday === null || start === null || minutes === null) return bad("That link isn't on your calendar in the next 5 weeks. Give its weekday, start time and length", 422);
  const detected = detectSource(c?.organizerEmail ?? null, home);
  const source = o.source === undefined ? detected.source : sourceOf(o.source);
  if (source === "automatic" && detected.organizer !== "home") return bad("Only meetings organized in Cooptimize's tenant can be read automatically. Use Upload for this one", 409);
  const users = await ctx.users();
  const reviewers = o.reviewers === undefined ? defaultReviewers(me, await ctx.leads(clientKey).catch(() => [])).filter((r) => users.some((u) => lower(u.id) === r)) : reviewerIds(o.reviewers, users);
  const attendees = attendeeIds((c?.homeAttendees ?? []).map((email) => ({ email })), users);
  const s = await store.addSeries({
    clientKey, name: text(o.name, "name", 200, true) ?? c?.subject ?? `${client.name} weekly call`, role, source, detected: detected.source, organizer: detected.organizer,
    joinUrl, eventId: c?.eventId ?? null, registrantId: me, weekday, start, minutes, zone: c?.zone ?? zone, interval: c?.interval ?? 1, reviewers, attendees,
  });
  ctx.log({ source: "plan", op: "meeting_registered", kind: source });
  return { ok: true, data: { meeting: viewOf(s, client.name, users, me) } };
}

function edited(b: ProposalBody, o: Record<string, unknown>): ProposalBody {
  if (b.kind === "gap") {
    const parentId = o.parentId === undefined ? b.parentId : o.parentId === null ? null : id(o.parentId, "parentId");
    // MC-1e: the New form's fields. Checked again by the write framework's preview before anything is sent.
    const parentTitle = parentId === b.parentId ? b.parentTitle : o.parentTitle !== undefined ? text(o.parentTitle, "parentTitle", 255, true) : null;
    const assignTo = o.assignTo === undefined ? undefined : o.assignTo === null || o.assignTo === "" || o.assignTo === "none" ? null : o.assignTo === "me" ? "me" : typeof o.assignTo === "string" && o.assignTo.length <= 320 && /^[^\s@]+@[^\s@]+$/.test(o.assignTo) ? o.assignTo.toLowerCase() : (() => { throw new Invalid("assignTo must be me, nobody or an email"); })();
    const date = o.date === undefined ? undefined : o.date === null || o.date === "" ? null : typeof o.date === "string" && DATE.test(o.date) ? o.date : (() => { throw new Invalid("date must be a date"); })();
    const size = o.size === undefined ? undefined : o.size === null || o.size === "" ? null : typeof o.size === "number" && Number.isFinite(o.size) && o.size >= 0 && o.size <= 10_000 ? o.size : (() => { throw new Invalid("size must be a number from 0 to 10000"); })();
    let answers: Answers | null | undefined;
    try {
      answers = o.answers === undefined ? undefined : o.answers === null ? null : parseAnswers(o.answers);
    } catch (e) {
      if (e instanceof AnswersError) throw new Invalid(e.message);
      throw e;
    }
    return {
      ...b, ...(o.title !== undefined ? { title: text(o.title, "title", 255)! } : {}), ...(o.description !== undefined ? { description: o.description === null || o.description === "" ? "" : text(o.description, "description", 8000)! } : {}), ...(o.type !== undefined ? { type: text(o.type, "type", 200)! } : {}), parentId, parentTitle,
      ...(assignTo !== undefined ? { assignTo } : {}), ...(date !== undefined ? { date } : {}), ...(size !== undefined ? { size } : {}), ...(answers !== undefined ? { answers } : {}),
    };
  }
  if (b.kind === "commitment") {
    const due = o.due === undefined ? b.due : o.due === null ? null : typeof o.due === "string" && DATE.test(o.due) ? o.due : (() => { throw new Invalid("due must be a date"); })();
    return { ...b, ...(o.what !== undefined ? { what: text(o.what, "what", 200)! } : {}), due };
  }
  return { ...b, ...(o.text !== undefined ? { text: text(o.text, "text", 2000)! } : {}) };
}

/** MC-6: a promise that goes to my own Promises: a Cooptimizer's, and that Cooptimizer is me. */
const isMine = (p: Proposal, me: string) => p.body.kind === "commitment" && p.body.side === "cooptimize" && !!p.body.whoId && p.body.whoId.toLowerCase() === me.toLowerCase();

/** The review screen: the call, the occurrence, its proposals in order with quotes, and what I may do. */
async function review(ctx: MeetingContext, store: MeetingStore, cfg: AppConfig, me: string, input: unknown): Promise<ActionResponse> {
  const o = obj(input, ["occurrenceId"]);
  const v = store.viewer(me);
  const r = await v.occurrence(id(o.occurrenceId, "occurrenceId"));
  if (!r || !(await seesChatCall(ctx, me, r.series))) return bad("No such meeting", 404);
  let ps = (await v.proposals(r.o.id)).sort(proposalOrder);
  const lines = await store.transcript(r.o.id);
  const users = await ctx.users();
  const reviewer = canConfirm(r.series, me);
  // MC-1e: a failed write that the preview's Retry (or Settings › Your data) later confirmed counts as done here too.
  if (reviewer && ctx.plan) {
    let changed = false;
    for (const p of ps.filter((x) => x.state === "failed" && x.result?.writeId)) {
      const w = await ctx.plan.devopsWrite(p.result!.writeId!).catch(() => null);
      if (w?.status === "confirmed" && w.undoneBy === null) {
        await store.updateProposal(p.id, { state: "confirmed", result: { ...p.result, ...(w.itemId ? { itemId: w.itemId } : {}), message: w.message ?? "Done" } });
        changed = true;
      }
    }
    if (changed) {
      await settledCall(store, r.o.id, me);
      ps = (await v.proposals(r.o.id)).sort(proposalOrder);
    }
  }
  const canWrite = reviewer ? await ctx.canWrite(r.series.clientKey).catch(() => false) : false;
  return {
    ok: true,
    data: {
      meeting: viewOf(r.series, (await namesOf(ctx, [r.series.clientKey]))(r.series.clientKey), users, me),
      occurrence: occView(r.o, { counts: { all: ps.length, open: ps.filter(toReview).length }, hasTranscript: !!lines, retriesHere: !!ctx.retriesHere, zone: userZone(cfg) }),
      proposals: ps,
      // MC-6: which promises are mine ("your Promises"), said by the server; the page never compares a name.
      mine: ps.filter((p) => isMine(p, me)).map((p) => p.id),
      transcript: lines ? { lines: lines.length, speakers: [...new Set(lines.map((l) => l.speaker))].length } : null,
      // MC-2: what was discussed and decided (at most 5 lines), on every call; null for one reviewed before MC-2.
      summary: lines ? await store.summary(r.o.id) : null,
      // PK-1: a Pocket export's speakers are numbered, never named, and its lines have no times (kept past 30 days).
      // MC-2b: a Pocket recording brought in from Pocket is numbered too, with times.
      pocket: fromPocket(r.o.transcriptKind),
      // MC-2c: Teams gave this chat call's transcript without speaker names.
      noSpeakers: r.o.transcriptKind === "teams_unnamed",
      // MC-7: what a reviewer pasted, a transcript or their notes; null for any other source.
      pasted: pastedAs(r.o.transcriptKind),
      transcriptKind: lines ? r.o.transcriptKind ?? null : null,
      // MC-2b: whose Pocket recording it was, said only as mine or a reviewer's (never a name); null otherwise.
      pocketFrom: r.o.transcriptKind === "pocket_api" && lines ? ((await store.transcriptBy(r.o.id))?.toLowerCase() === me.toLowerCase() ? "mine" : "reviewer") : null,
      canConfirm: reviewer,
      canWrite,
      // MC-1e: each row's check before any preview (a reviewer's only; an attendee only looks).
      checks: reviewer ? await checksOf(ctx, cfg, r.series.clientKey, ps) : {},
    },
  };
}

/**
 * MC-1d: the call's transcript, read only, for the same people as its review (the call's reviewers and attendees:
 * `viewer`), loaded only when the Transcript view opens. Every line with its speaker and time; which proposals rest on
 * a line comes from the proposals the review already returned. Never logged: the log line is a count. Gone after 30
 * days with the stored transcript (`gone`).
 */
async function transcriptOf(ctx: MeetingContext, store: MeetingStore, me: string, input: unknown): Promise<ActionResponse> {
  const o = obj(input, ["occurrenceId"]);
  const r = await store.viewer(me).occurrence(id(o.occurrenceId, "occurrenceId"));
  if (!r || !(await seesChatCall(ctx, me, r.series))) return bad("No such meeting", 404);
  const lines = await store.transcript(r.o.id);
  ctx.log({ source: "plan", op: "meeting_transcript_read", count: lines?.length ?? 0 });
  if (!lines) return { ok: true, data: { lines: [], gone: !!r.o.transcriptAt, missing: !r.o.transcriptAt } };
  return { ok: true, data: { lines: lines.map((l) => ({ n: l.n, speaker: l.speaker, at: atOf(l), sec: l.at, text: l.text })), gone: false, missing: false } };
}

/**
 * MC-1e: a promise from its row, saved at once (nothing leaves FocusTime, so no DevOps preview): shared like CV-1's, a
 * Cooptimizer's shows in their own Promises, the client's in my Waiting on ("noted with this call"). Nobody's plan.
 */
async function keep(ctx: MeetingContext, store: MeetingStore, me: string, input: unknown): Promise<ActionResponse> {
  const o = obj(input, ["proposalId"]);
  const p = await store.proposal(id(o.proposalId, "proposalId"));
  if (!p) return bad("No such proposal", 404);
  const { o: occ, series } = await store.viewer(me).reviewer(p.occurrenceId);
  const b = p.body;
  if (b.kind !== "commitment") return bad("Only a promise is kept from its row; DevOps changes go through the preview", 409);
  if (!toReview(p)) return bad(p.state === "confirmed" ? "That one is already done" : "Bring it back first", 409);
  if (!ctx.conversations) return bad("Promises aren't available here", 503);
  const k = await ctx.conversations.addCommitment({
    // PK-1: a promise a Pocket export didn't say whose it is ("unknown") is noted with the call, like the client's: in
    // the reviewer's Waiting on as "Someone on the call", never in anyone's Promises.
    conversationId: null, chatId: `${MEETING_CHAT}${series.id}`, clientKey: series.clientKey, whoId: b.side === "cooptimize" ? b.whoId : null, whoName: b.side === "unknown" ? CALL_ROW.someone : b.who, toId: b.side === "cooptimize" ? null : me, toName: b.side === "cooptimize" ? b.toName : null,
    what: b.what, dueAt: null, dueDate: b.due, impliesItem: false, messageIds: [], reason: `From ${series.name}, ${occ.date}`, closeHow: null, closeNote: null,
  });
  const message = b.side === "cooptimize" ? (isMine(p, me) ? CALL_ROW.keptMine : CALL_ROW.keptPromise(b.who)) : b.side === "unknown" ? CALL_ROW.keptNobody : CALL_ROW.keptNote(b.who);
  const next = await store.updateProposal(p.id, { state: "confirmed", result: { commitmentId: k.id, message }, decidedBy: me, decidedAt: ctx.now() });
  await settledCall(store, occ.id, me);
  ctx.log({ source: "plan", op: "meeting_kept", count: 1 });
  return { ok: true, data: { proposal: next, message } };
}

/** MC-1e: Undo a promise kept from its row: the shared commitment goes (while nobody has acted on it) and the row is open again. */
async function unkeep(ctx: MeetingContext, store: MeetingStore, me: string, input: unknown): Promise<ActionResponse> {
  const o = obj(input, ["proposalId"]);
  const p = await store.proposal(id(o.proposalId, "proposalId"));
  if (!p) return bad("No such proposal", 404);
  const { o: occ, series } = await store.viewer(me).reviewer(p.occurrenceId);
  const cid = p.result?.commitmentId;
  if (p.body.kind !== "commitment" || p.state !== "confirmed" || !cid) return bad("There's nothing to undo", 409);
  if (!ctx.conversations) return bad("Promises aren't available here", 503);
  const gone = await ctx.conversations.removeMeetingCommitment(cid, `${MEETING_CHAT}${series.id}`);
  if (!gone) return bad("That promise was already changed in Promises, so it stays", 409);
  const next = await store.updateProposal(p.id, { state: "open", result: null, decidedBy: null, decidedAt: null });
  if (occ.state === "reviewed") await store.updateOccurrence(occ.id, { state: "ready", reviewedBy: null });
  ctx.log({ source: "plan", op: "meeting_unkept", count: 1 });
  return { ok: true, data: { proposal: next } };
}

/** MC-4: a proposal put back on a reviewed call opens it again (its mark and nudge come back). */
async function reopenCall(store: MeetingStore, occurrenceId: number): Promise<void> {
  const occ = await store.occurrence(occurrenceId);
  if (occ?.state === "reviewed" && (await store.proposals(occurrenceId)).some(toReview)) await store.updateOccurrence(occurrenceId, { state: "ready", reviewedBy: null });
}

/** MC-4: Hide's input: single meetings by their calendar key, series by their key on my calendar; 60 at most. */
function hideItems(input: unknown): { kind: "one" | "every"; key: string }[] {
  const o = obj(input, [], ["keys", "series"]);
  const list = (v: unknown, kind: "one" | "every") => {
    if (v === undefined) return [];
    if (!Array.isArray(v) || v.some((k) => typeof k !== "string" || !k.trim() || k.length > 300)) throw new Invalid("keys must be meetings' keys");
    return (v as string[]).map((key) => ({ kind, key }));
  };
  const items = [...list(o.keys, "one"), ...list(o.series, "every")];
  if (!items.length || items.length > 60) throw new Invalid("Hide 1 to 60 meetings at a time");
  return items;
}

/** MC-4: what Skip all and close changed on one proposal: its state before, for Undo. */
/** What Skip all and close changed on one proposal: what it was (and, for a failed one, who decided it and when), and when the skip was. */
type Skipped = { id: number; was: "open" | "failed"; skippedAt: string; by: string | null; decidedAt: string | null };

/**
 * MC-4: Skip all and close, on one call or several ticked together: every undecided proposal (open, or failed and waiting
 * for its fix) on calls I review is skipped, and each call closes. Nothing goes to DevOps, no promise is kept, and the
 * answer says what each was, for Undo.
 */
/**
 * MC-6: Dismiss on a kept call with no transcript (any reviewer of it). Remove: a call I added by hand, by me only, goes
 * (removed_at; it exists nowhere else). Close: any other kept call closes as No transcript (in Closed until a transcript
 * comes: the pass sets it ready again). Both refuse a call with a transcript (Skip all and close closes that one).
 * Nothing is read, sent or written anywhere but this call's own row.
 */
async function dismissCall(ctx: MeetingContext, store: MeetingStore, me: string, input: unknown, kind: "remove" | "close"): Promise<ActionResponse> {
  const o = obj(input, ["occurrenceId"]);
  const { o: occ, series } = await store.viewer(me).reviewer(id(o.occurrenceId, "occurrenceId"));
  if (!isCall(series)) return bad(DISMISS_TEXT.notACall, 409);
  if (occ.transcriptAt || (await store.transcript(occ.id))) return bad(DISMISS_TEXT.hasTranscript, 409);
  if (kind === "remove") {
    if (series.callKind !== "hand" || series.registrantId.toLowerCase() !== me.toLowerCase()) return bad(DISMISS_TEXT.notMine, 403);
    const seriesId = await store.removeHandCall(occ.id, me);
    if (seriesId === null) return bad(DISMISS_TEXT.notMine, 403);
    ctx.log({ source: "plan", op: "meeting_call_removed", count: 1 });
    return { ok: true, data: { removed: true, seriesId, message: DISMISS_TEXT.removed(series.name) } };
  }
  const prior = occ.state === "waiting" ? "waiting" : "needs_upload";
  if (occ.state !== "no_transcript") await store.viewer(me).updateOccurrence(occ.id, { state: "no_transcript", dismissedBy: me, nextCheckAt: null });
  ctx.log({ source: "plan", op: "meeting_call_closed_none", count: 1 });
  return { ok: true, data: { closed: true, prior, message: DISMISS_TEXT.closed(series.name) } };
}

async function skipAll(store: MeetingStore, me: string, input: unknown, ctx: MeetingContext): Promise<ActionResponse> {
  const o = obj(input, ["occurrenceIds"]);
  if (!Array.isArray(o.occurrenceIds) || !o.occurrenceIds.length || o.occurrenceIds.length > 30) throw new Invalid("Close 1 to 30 calls at a time");
  const ids = [...new Set(o.occurrenceIds.map((v) => id(v, "occurrenceIds")))];
  // Every call first: only one I review (a refusal changes nothing).
  for (const oid of ids) await store.viewer(me).reviewer(oid);
  const out: { occurrenceId: number; skipped: Skipped[] }[] = [];
  const at = ctx.now();
  for (const oid of ids) {
    const skipped: Skipped[] = [];
    for (const p of await store.proposals(oid)) {
      if (!toReview(p)) continue;
      await store.viewer(me).updateProposal(p.id, { state: "skipped", decidedBy: me, decidedAt: at });
      skipped.push({ id: p.id, was: p.state as Skipped["was"], skippedAt: at, by: p.state === "failed" ? p.decidedBy : null, decidedAt: p.state === "failed" ? p.decidedAt : null });
    }
    await settledCall(store, oid, me);
    out.push({ occurrenceId: oid, skipped });
  }
  ctx.log({ source: "plan", op: "meeting_skip_all", count: out.reduce((n, c) => n + c.skipped.length, 0) });
  return { ok: true, data: { calls: out } };
}

/** MC-4: Undo of Skip all and close: each proposal it skipped goes back as it was, while it is still skipped by me; the call opens again. */
async function unskipAll(store: MeetingStore, me: string, input: unknown, ctx: MeetingContext): Promise<ActionResponse> {
  const o = obj(input, ["items"]);
  if (!Array.isArray(o.items) || !o.items.length || o.items.length > 500) throw new Invalid("items must be what Skip all and close answered");
  const items = o.items.map((x) => {
    const i = obj(x, ["id", "was", "skippedAt"], ["by", "decidedAt"]);
    if (i.was !== "open" && i.was !== "failed") throw new Invalid("was must be open or failed");
    const str = (v: unknown, k: string) => {
      if (v === null || v === undefined) return null;
      if (typeof v !== "string" || v.length > 320) throw new Invalid(`${k} must be what Skip all and close answered`);
      return v;
    };
    const skippedAt = str(i.skippedAt, "skippedAt");
    if (!skippedAt) throw new Invalid("skippedAt must be what Skip all and close answered");
    return { id: id(i.id, "id"), was: i.was as Skipped["was"], skippedAt, by: str(i.by, "by"), decidedAt: str(i.decidedAt, "decidedAt") };
  });
  const calls = new Set<number>();
  let back = 0;
  for (const i of items) {
    const p = await store.proposal(i.id);
    if (!p) continue;
    await store.viewer(me).reviewer(p.occurrenceId);
    // Only this Skip all's own skip, still mine and still a skip: anything decided since (even skipped again by me) stays.
    if (p.state !== "skipped" || (p.decidedBy ?? "").toLowerCase() !== me.toLowerCase() || p.decidedAt !== i.skippedAt) continue;
    await store.viewer(me).updateProposal(p.id, i.was === "open" ? { state: "open", decidedBy: null, decidedAt: null } : { state: "failed", decidedBy: i.by, decidedAt: i.decidedAt });
    calls.add(p.occurrenceId);
    back++;
  }
  for (const oid of calls) await reopenCall(store, oid);
  ctx.log({ source: "plan", op: "meeting_unskip_all", count: back });
  return { ok: true, data: { back } };
}

/** Nothing left to review: the call is reviewed (its mark and nudge go). */
async function settledCall(store: MeetingStore, occurrenceId: number, me: string): Promise<void> {
  const left = (await store.proposals(occurrenceId)).filter(toReview).length;
  const occ = await store.occurrence(occurrenceId);
  if (!left && occ && occ.state === "ready") await store.updateOccurrence(occurrenceId, { state: "reviewed", reviewedBy: me });
}

/**
 * MC-1e: what the DevOps write framework needs from a call's review, so a call's write goes through the one preview
 * like every other screen's: the proposal (only for one of the call's reviewers, only while it is still to review, with
 * the call's client), and the end of its write (confirmed, or the reason in plain words on the row).
 */
export type MeetingWritePort = {
  proposal: (proposalId: number) => Promise<{ body: ProposalBody; clientKey: string } | null>;
  written: (proposalId: number, r: { ok: boolean; writeId: number | null; itemId: number | null; message: string; type: string | null }) => Promise<void>;
};
export function meetingWrites(store: MeetingStore, me: string, now: () => string, log: (r: LogRecord) => void): MeetingWritePort {
  return {
    proposal: async (proposalId) => {
      const p = await store.proposal(proposalId);
      if (!p || !toReview(p)) return null;
      const r = await store.viewer(me).reviewer(p.occurrenceId).catch(() => null);
      return r ? { body: p.body, clientKey: r.series.clientKey } : null;
    },
    written: async (proposalId, r) => {
      const p = await store.proposal(proposalId);
      // A failure never overwrites a row decided since (a success is recorded: the item exists in DevOps).
      if (!p || (!r.ok && !toReview(p))) return;
      const at = now();
      if (r.ok) await store.updateProposal(p.id, { state: "confirmed", result: { ...p.result, ...(r.writeId ? { writeId: r.writeId } : {}), ...(r.itemId ? { itemId: r.itemId } : {}), message: r.message }, decidedBy: me, decidedAt: at });
      else await store.updateProposal(p.id, { state: "failed", result: { ...p.result, ...(r.writeId ? { writeId: r.writeId } : {}), message: callWriteWords(r.message, p.body.kind === "gap" ? (r.type ?? p.body.type) : null) }, decidedBy: me, decidedAt: at });
      await settledCall(store, p.occurrenceId, me);
      log({ source: "plan", op: "meeting_written", count: 1, kind: r.ok ? "ok" : "failed" });
    },
  };
}

/**
 * MC-1e: each row's check before any preview: a new item's fields the client's process requires (asked for on the
 * row, or said in the New form's words when the form can't fill them), and a comment on an item above story level
 * (it won't be sent). Read only.
 */
async function checksOf(ctx: MeetingContext, cfg: AppConfig, clientKey: string, ps: readonly Proposal[]): Promise<Record<number, ProposalCheck>> {
  const open = ps.filter(toReview);
  const out: Record<number, ProposalCheck> = {};
  const comments = open.filter((p) => p.body.kind === "comment");
  if (comments.length) {
    const model = (await ctx.capture(cfg, clientKey).catch(() => null))?.model ?? null;
    if (model) for (const p of comments) if (p.body.kind === "comment" && !commentLevelOk(model.levels, p.body.itemType)) out[p.id] = { blocked: CALL_ROW.commentAboveStory(p.body.itemType) };
  }
  const gaps = open.filter((p) => p.body.kind === "gap");
  // RQ-1: DevOps checks each row's item without saving it; where it answers, its fields decide.
  const asked = new Set<number>();
  if (gaps.length && ctx.needed)
    for (const p of gaps) {
      const b = p.body;
      if (b.kind !== "gap") continue;
      const now = await ctx.needed(clientKey, { kind: "meeting_create", proposalId: p.id }).catch(() => null);
      if (!now?.checked) continue;
      const bare = await ctx.needed(clientKey, { kind: "new_item", type: b.type, title: "", ...(b.parentId !== null ? { parentId: b.parentId } : {}) }).catch(() => null);
      asked.add(p.id);
      // The row's controls; the third question is a story's only (RQ-1), so above story level it can't fill acceptance.
      const has = new Set<NeededFill>(["title", "date", "size", "description", "assignTo", ...(now.level === "story" ? (["check"] as const) : [])]);
      const { fill, cant } = splitNeeded(now.needed, has);
      const all = [...(bare?.checked ? bare.needed : []), ...now.needed];
      const required = [...new Set(all.flatMap((f) => (f.fill && f.fill !== "title" && has.has(f.fill) ? [f.fill as NonNullable<RequiredField["fill"]>] : [])))];
      const needs = fill.flatMap((f) => (f.fill && f.fill !== "title" ? [{ fill: f.fill as NonNullable<RequiredField["fill"]>, name: f.name }] : []));
      if (required.length || cant.length || needs.length) out[p.id] = { ...(needs.length ? { needs } : {}), ...(required.length ? { required } : {}), ...(cant.length ? { cant: CALL_ROW.cantFill(now.projectName ?? "This client", cant.map((f) => f.name), b.type) } : {}) };
    }
  const unasked = gaps.filter((p) => !asked.has(p.id));
  if (unasked.length && ctx.required) {
    const req = await ctx.required(clientKey, [...new Set(unasked.map((p) => (p.body.kind === "gap" ? p.body.type : "")))]).catch(() => null);
    if (req)
      for (const p of unasked) {
        const b = p.body;
        if (b.kind !== "gap") continue;
        const fields = req.types[b.type] ?? [];
        const has = { date: !!b.date, size: b.size !== undefined && b.size !== null, description: !!b.description?.trim(), check: !!b.answers?.check?.trim(), assignTo: b.assignTo !== null } as const;
        const needs = fields.flatMap((f) => (f.fill && !has[f.fill] ? [{ fill: f.fill, name: f.name }] : []));
        const cant = fields.filter((f) => !f.fill);
        const required = fields.flatMap((f) => (f.fill ? [f.fill] : []));
        if (required.length || cant.length) out[p.id] = { ...(needs.length ? { needs } : {}), ...(required.length ? { required } : {}), ...(cant.length ? { cant: CALL_ROW.cantFill(req.projectName, cant.map((f) => f.name), b.type) } : {}) };
      }
  }
  return out;
}

// ---- The AI pass, shared by uploads and the poll job ----

export type PassDeps = {
  store: MeetingStore;
  /** MC-1d: the clock for a retry's time (the job's; an action's otherwise). */
  now?: () => string;
  ai: () => Promise<AiService | null>;
  capture: (clientKey: string) => Promise<CaptureContext | null>;
  users: () => Promise<MeetingUser[]>;
  log: (r: LogRecord) => void;
  /** MC-1d: the meeting job runs here (production), so a failed pass gets a next try; elsewhere none is set. */
  retriesHere?: boolean;
};

/**
 * Runs the AI pass on a stored transcript and records its proposals and outcome. MC-1d: a pass that ran is "ready"
 * (with its proposals, or none); one that failed is "failed" with its kind (and, for a call sent in parts, which part),
 * its open proposals untouched, and when FocusTime tries again by itself (`nextRetry`; only the job, in production,
 * acts on it). `retry`: this run is one of those tries (the job counted it in `checks` before the run).
 */
export async function runPass(d: PassDeps, series: MeetingSeries, occ: Occurrence, lines: readonly TranscriptLine[], o: { retry?: boolean } = {}): Promise<{ outcome: string; /** Open proposals after the pass. */ proposals: number; /** MC-1e: how many of them this pass added, and how many it left out as the same as one already done, skipped or failed. */ added: number; same: number }> {
  const ai = await d.ai().catch(() => null);
  const cap = await d.capture(series.clientKey).catch(() => null);
  let outcome = "done";
  let n = 0;
  let added = 0;
  let same = 0;
  if (!ai) outcome = "not_set_up";
  // MC-1d: FocusTime couldn't read the client's items (DevOps, the client list): its own failure, not the AI service's.
  else if (!cap) outcome = "no_context";
  else {
    const users = await d.users().catch((): MeetingUser[] => []);
    const cooptimizers = series.attendees.flatMap((a) => users.filter((u) => lower(u.id) === lower(a)).map((u) => ({ id: lower(u.id), name: u.name })));
    // PK-1: a Pocket export's speakers are numbered, never named: the AI is told so, and promises' owners checked for it.
    // MC-2: a call that isn't registered has no role (it isn't a weekly status or planning call): none is said.
    const r = await capturePass(ai, { clientKey: series.clientKey, clientName: cap.clientName, internal: cap.internal, meeting: { name: series.name, role: isCall(series) ? null : series.role, date: occ.date }, cooptimizers, items: cap.items, model: cap.model, directory: cap.directory, lines, speakersNamed: speakersNamed(occ.transcriptKind, [...new Set(lines.map((l) => l.speaker))]) });
    if (r.ok) {
      await d.store.saveSummary(occ.id, r.summary);
      // MC-1e: what the page already has done, skipped or failed stays as it is, and the same thing again is left out.
      const fresh = newOnly(r.proposals, await d.store.proposals(occ.id));
      same = r.proposals.length - fresh.length;
      added = fresh.length;
      n = (await d.store.replaceProposals(occ.id, fresh)).filter((p) => p.state === "open").length;
      d.log({ source: "ai", op: "meeting_capture", count: n, kind: `windows:${r.windows} masked_client:${r.masked.client} masked_email:${r.masked.email} dropped:${r.dropped} same:${same}` });
    } else outcome = outcomeOf(r.kind === "client_off" || r.kind === "off" ? "no_ai" : refusedRequest(r.kind, r.httpStatus) ? "provider_refused" : r.kind, r.part, r.parts);
  }
  if (outcome === "done") await d.store.updateOccurrence(occ.id, { state: "ready", aiOutcome: outcome, nextCheckAt: null, checks: 0 });
  else {
    const kind = parseOutcome(outcome).kind;
    // A person's try (Propose again, an upload, Check now) starts a fresh series of tries by itself; the job's go on.
    const tries = o.retry ? occ.checks : 0;
    const next = d.retriesHere ? nextRetry(kind, tries, d.now?.() ?? Temporal.Now.instant().toString()) : null;
    await d.store.updateOccurrence(occ.id, { state: "failed", aiOutcome: outcome, checks: tries, nextCheckAt: next });
    // A try by itself is logged once, by the job, with its number.
    if (!o.retry) d.log({ source: "ai", op: "meeting_capture", kind: parseOutcome(outcome).kind });
  }
  return { outcome, proposals: n, added, same };
}

/**
 * MC-1d: the provider refused the request itself (a 4xx other than 408, 409 and 429: a bad request, a key or a model
 * it won't take). The same request would be refused again, so it isn't tried again by itself.
 */
const refusedRequest = (kind: string, status: number | undefined) => kind === "provider" && status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 409 && status !== 429;

/**
 * An uploaded transcript for a series' dated occurrence (a reviewer): parsed, stored, then the AI pass. PK-1: the kind
 * of file comes from its content (a Teams .vtt or .docx, a Pocket export's PDF or the zip holding it; never its name).
 * A Pocket export dated another day than the call is not stored: the answer asks (`ask`: both dates and the
 * recording's length), and the page sends the file again with `dateOk` only on a yes. The log has kinds, sizes and
 * counts, never a word, a title, a label or a file's name.
 */
export async function uploadTranscript(ctx: MeetingContext, q: { seriesId: number; date: string; bytes: Uint8Array; dateOk?: boolean; /** MC-7: pasted text, read as a transcript or as notes. */ paste?: PasteAs | "bad" }): Promise<ActionResponse> {
  const store = ctx.meetings;
  const me = await ctx.me();
  const cfg = await ctx.config();
  if (!store || !me || !cfg) return bad("Meetings aren't available here", 503);
  if (!DATE.test(q.date)) return bad("Pick the meeting's date", 400);
  const v = store.viewer(me);
  const series = await v.seriesById(q.seriesId);
  if (!series) return bad("No such meeting", 404);
  if (!canConfirm(series, me)) return bad("Only this meeting's reviewers can upload its transcript", 403);
  // MC-2: a call has one occurrence; its transcript goes there, never under another day.
  if (series.callKind && !(await store.occurrencesOf(series.id)).some((o) => o.date === q.date)) return bad("Upload this call's transcript on its own day", 422);
  if (q.paste) return savePaste(ctx, { store, me, cfg, series, date: q.date, bytes: q.bytes, as: q.paste });
  let read: TranscriptRead;
  try {
    read = await readTranscriptFile(q.bytes, { readPdf: ctx.readPdf });
  } catch (e) {
    if (e instanceof TranscriptError) {
      ctx.log({ source: "plan", op: "meeting_upload_refused", kind: e instanceof IntakeError ? e.code : "unreadable", count: q.bytes.length });
      return bad(e.message, 422);
    }
    // PK-1 review: anything else (a parser's own error can quote a file's contents) is refused in fixed words, and
    // only its kind is logged.
    ctx.log({ source: "plan", op: "meeting_upload_refused", kind: "error", count: q.bytes.length });
    return bad(`FocusTime couldn't read that file. ${READS}`, 422);
  }
  const { lines, facts } = read;
  const kind: TranscriptKind = read.format === "pocket" ? "pocket" : "teams";
  // PK-1: the recording's own date, when the export has one and it isn't the call's: ask first, keep nothing.
  if (read.recorded && read.recorded.date !== q.date && !q.dateOk) {
    ctx.log({ source: "plan", op: "meeting_upload_ask", kind: facts.kind, count: lines.length });
    return { ok: true, data: { ask: { recorded: read.recorded.date, length: read.recorded.length, call: q.date } } };
  }
  const start = Temporal.PlainDate.from(q.date).toZonedDateTime({ timeZone: series.zone, plainTime: Temporal.PlainTime.from(series.start) });
  const occ = await v.ensureOccurrence(series.id, q.date, start.toInstant().toString(), start.add({ minutes: series.minutes }).toInstant().toString());
  await v.saveTranscript(occ.id, lines, kind);
  ctx.log({ source: "plan", op: "meeting_upload", kind: facts.kind, count: lines.length });
  ctx.log({ source: "plan", op: "meeting_upload_bytes", kind: facts.kind, count: facts.bytes });
  if (facts.entries) ctx.log({ source: "plan", op: "meeting_upload_unpacked", kind: `entries:${facts.entries}`, count: facts.unpacked });
  if (facts.pages) ctx.log({ source: "plan", op: "meeting_upload_pages", kind: facts.kind, count: facts.pages });
  const r = await runPass({ store, ai: ctx.ai, capture: (k) => ctx.capture(cfg, k), users: ctx.users, log: ctx.log, now: ctx.now, ...(ctx.retriesHere ? { retriesHere: true } : {}) }, series, (await store.occurrence(occ.id))!, lines);
  return { ok: true, data: { occurrenceId: occ.id, lines: lines.length, kind, ...r } };
}

/**
 * MC-7: a pasted transcript or notes for a call, after uploadTranscript's checks (who may, the call's day): read as
 * the box said, refused when nearly empty or longer than a transcript may be (nothing saved), stored as the call's
 * transcript ("pasted" or "pasted_notes"), then the same AI pass as a file. The log says only that a paste was saved,
 * its kind and its line count: never a word of it, a name or a title.
 */
async function savePaste(ctx: MeetingContext, x: { store: MeetingStore; me: string; cfg: AppConfig; series: MeetingSeries; date: string; bytes: Uint8Array; as: PasteAs | "bad" }): Promise<ActionResponse> {
  if (x.as !== "transcript" && x.as !== "notes") return bad("Say whether it is a transcript or notes", 400);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(x.bytes);
  } catch {
    ctx.log({ source: "plan", op: "meeting_paste_refused", kind: "not_text", count: x.bytes.length });
    return bad("That isn't plain text. Paste the words themselves", 422);
  }
  // MC-6: a chat call's words are its chat's client's, or Internal's: never pasted under another client.
  if (x.series.callKind === "chat") {
    const callId = x.series.eventId ? callIdOfKey(x.series.eventId) : null;
    const c = callId && ctx.chatCalls ? await ctx.chatCalls.one(callId).catch(() => null) : null;
    if (!(await chatClientAllowed(ctx, c && c.chatId === chatIdOf(x.series) ? c.clientKey : "", x.series.clientKey))) {
      ctx.log({ source: "plan", op: "meeting_paste_refused", kind: "chat_other_client" });
      return { ok: false, status: 403, error: CHAT_OTHER_CLIENT, code: "chat_other_client" };
    }
  }
  const read = readPaste(text, x.as);
  const kind: TranscriptKind = x.as === "notes" ? "pasted_notes" : "pasted";
  if (read.tooLong || read.tooShort) {
    ctx.log({ source: "plan", op: "meeting_paste_refused", kind: read.tooLong ? "long" : "short", count: read.lines.length });
    return bad(read.tooLong ? PASTE_TEXT.tooLong : PASTE_TEXT.tooShort, 422);
  }
  const v = x.store.viewer(x.me);
  const start = Temporal.PlainDate.from(x.date).toZonedDateTime({ timeZone: x.series.zone, plainTime: Temporal.PlainTime.from(x.series.start) });
  const occ = await v.ensureOccurrence(x.series.id, x.date, start.toInstant().toString(), start.add({ minutes: x.series.minutes }).toInstant().toString());
  await v.saveTranscript(occ.id, read.lines, kind);
  ctx.log({ source: "plan", op: "meeting_paste", kind, count: read.lines.length });
  const r = await runPass({ store: x.store, ai: ctx.ai, capture: (k) => ctx.capture(x.cfg, k), users: ctx.users, log: ctx.log, now: ctx.now, ...(ctx.retriesHere ? { retriesHere: true } : {}) }, x.series, (await x.store.occurrence(occ.id))!, read.lines);
  return { ok: true, data: { occurrenceId: occ.id, lines: read.lines.length, kind, ...r } };
}

// ---- MC-2: calls that aren't registered ----

const KEY = /^[\x21-\x7e]{1,2000}$/;
const isoAt = (v: unknown, name: string): string => {
  if (typeof v !== "string" || v.length > 40 || !Number.isFinite(Date.parse(v))) throw new Invalid(`${name} must be a time`);
  return Temporal.Instant.from(v).toString();
};

/** The registered calls' join links (any admin's), so my calendar's occurrence of one is never an "other call". */
async function registeredLinks(store: MeetingStore): Promise<Set<string>> {
  return new Set((await store.allSeries()).map((s) => joinKey(s.joinUrl)));
}

/**
 * Calls › Your other calls: the calls on my own calendar in my last 14 local days that count (plan/calls.ts) and
 * aren't registered, newest first, as names, times and counts only (never a link or an address). Read now, kept
 * nowhere. With each, its kept call when someone on it pressed Review and I can see it.
 */
async function otherCalls(ctx: MeetingContext, store: MeetingStore, cfg: AppConfig, input: unknown): Promise<ActionResponse> {
  obj(input, []);
  const me = (await ctx.me())!;
  const g = ctx.graph(cfg);
  if (!g) return { ok: false, status: 409, error: GRAPH_WORDS.signin.error, code: "signin" };
  const zone = userZone(cfg);
  const w = otherCallsWindow(ctx.now(), zone);
  let all: CalendarMeeting[];
  try {
    all = await g.recentCalls(w.fromIso, w.toIso);
  } catch (e) {
    const p = graphProblem(ctx, e);
    if (p) return p;
    throw e;
  }
  const taken = await registeredLinks(store);
  const home = await ctx.homeDomains();
  const v = store.viewer(me);
  const rows: OtherCallView[] = [];
  for (const c of all) {
    if (!isOtherCall(c) || !inWindow(c.startAt, w) || (c.joinUrl && taken.has(joinKey(c.joinUrl)))) continue;
    const kept = await store.callByKey(c.key);
    const seen = kept ? await v.occurrence(kept.occurrence.id) : null;
    const outside = detectSource(c.organizerEmail, home).organizer === "other";
    rows.push({ key: c.key, name: c.subject, startAt: c.startAt, endAt: c.endAt, minutes: Math.round((Date.parse(c.endAt) - Date.parse(c.startAt)) / 60_000), people: c.others + 1, teams: !!c.joinUrl && !outside, outside, occurrenceId: seen ? seen.o.id : null, seriesKey: c.seriesKey ?? null, allHome: c.allHome === true });
  }
  // MC-2c: the calls started in my registered client chats whose transcript Teams said is ready (only what the poll kept).
  if (ctx.chatCalls && (await ctx.cooptimizer?.(me).catch(() => false))) {
    for (const c of await ctx.chatCalls.listed(w.fromIso)) {
      if (!inWindow(c.startedAt!, w)) continue;
      const key = chatCallKey(c.callId);
      const kept = await store.callByKey(key);
      // Kept by someone else and I'm not its reviewer: still a row I can press Review on (which makes me one).
      const seen = kept && canConfirm(kept.series, me) ? await v.occurrence(kept.occurrence.id) : null;
      const endAt = chatCallEnd(c);
      rows.push({ key, name: CALL_LIST.chatCallName(c.chatName), startAt: c.startedAt!, endAt, minutes: Math.max(0, Math.round((Date.parse(endAt) - Date.parse(c.startedAt!)) / 60_000)), people: 0, teams: true, outside: false, occurrenceId: seen ? seen.o.id : null, seriesKey: null, allHome: false, chat: { name: c.chatName, clientKey: c.clientKey }, endKnown: !!c.endedAt });
    }
  }
  rows.sort((a, b) => b.startAt.localeCompare(a.startAt));
  ctx.log({ source: "plan", op: "meeting_other_calls", count: rows.length });
  return { ok: true, data: { calls: rows, days: OTHER_CALL_DAYS } };
}

/** MC-2c: a chat call's end: its call-ended event's time, else when Teams said its transcript was ready. */
const chatCallEnd = (c: Pick<ChatCallEntry, "endedAt" | "transcriptAt" | "startedAt">): string => {
  const end = c.endedAt ?? c.transcriptAt;
  return Date.parse(end) > Date.parse(c.startedAt!) ? end : Temporal.Instant.from(c.startedAt!).add({ minutes: 1 }).toString();
};
const chatIdOf = (s: Pick<MeetingSeries, "joinUrl">) => (s.joinUrl.startsWith("chat:") ? s.joinUrl.slice(5) : null);
/**
 * MC-2c: whether I may see a kept chat call: its reviewers always (they pressed Review on it); anyone else on it only
 * while they're in its chat now and follow its client. Any other call: yes (the store's viewer already decided).
 */
async function seesChatCall(ctx: MeetingContext, me: string, s: MeetingSeries): Promise<boolean> {
  if (s.callKind !== "chat" || canConfirm(s, me)) return true;
  const chatId = chatIdOf(s);
  return !!chatId && !!ctx.chatCalls && (await ctx.chatCalls.sees(chatId).catch(() => false));
}
/** In my list a kept chat call shows only to its reviewers: the others in the chat see it as a call to review (otherCalls), not twice. */
const seenChatCalls = (me: string, calls: MeetingSeries[]): MeetingSeries[] => calls.filter((s) => s.callKind !== "chat" || canConfirm(s, me));

/**
 * MC-2c: Review on a call started in a client's registered chat. Checked here before anything is kept: I'm a
 * Cooptimizer; the call is held with its transcript event in a chat that is still registered, that I'm in now and whose
 * client I follow (the port's `one`). The client is the one I confirmed (the chat's registration's by default). Kept as
 * MC-2 keeps a call: I'm its reviewer, the other Cooptimizers in the chat who use FocusTime are on it, its event id the
 * call's key. Nothing is asked of Microsoft here.
 */
/** MC-6: the clients a chat call may be filed under: its chat's registration's, and Internal. */
export async function chatClientAllowed(ctx: Pick<MeetingContext, "isInternal">, chatClient: string, asked: string): Promise<boolean> {
  if (asked.toLowerCase() === chatClient.toLowerCase()) return true;
  return ctx.isInternal ? await ctx.isInternal(asked).catch(() => false) : asked.toLowerCase() === INTERNAL_CLIENT.toLowerCase();
}

async function startChatCall(ctx: MeetingContext, store: MeetingStore, cfg: AppConfig, me: string, key: string, clientKey: string): Promise<ActionResponse> {
  if (!ctx.cooptimizer || !(await ctx.cooptimizer(me).catch(() => false))) return { ok: false, status: 403, error: FETCH_WORDS.not_cooptimizer, code: "not_cooptimizer" };
  const callId = callIdOfKey(key);
  const c = callId && ctx.chatCalls ? await ctx.chatCalls.one(callId) : null;
  if (!c || !c.startedAt) {
    ctx.log({ source: "plan", op: "meeting_call_start", kind: "not_in_chat" });
    return { ok: false, status: 403, error: FETCH_WORDS.not_in_chat, code: "not_in_chat" };
  }
  const client = await clientOf(ctx, clientKey);
  if (isRefusal(client)) return client;
  // MC-6: a call started in a client's chat is about that chat's client, or Internal; never another client, whoever asks.
  if (!(await chatClientAllowed(ctx, c.clientKey, client.key))) {
    ctx.log({ source: "plan", op: "meeting_call_start", kind: "chat_other_client" });
    return { ok: false, status: 403, error: CHAT_OTHER_CLIENT, code: "chat_other_client" };
  }
  const kept = await store.callByKey(key);
  if (kept) {
    // Someone else in the chat kept it first (their Review, perhaps refused): my own Review makes me a reviewer too, so
    // whoever was on the call can get it from Teams. Only after the checks above (in the chat now, following its client).
    if (kept.series.callKind === "chat" && !canConfirm(kept.series, me)) {
      const add = (xs: string[]) => (xs.some((x) => x.toLowerCase() === me.toLowerCase()) ? xs : [...xs, me]);
      await store.updateSeries(kept.series.id, { reviewers: add(kept.series.reviewers), attendees: add(kept.series.attendees) });
      ctx.log({ source: "plan", op: "meeting_call_start", kind: "reviewer_added" });
    }
    const seen = await store.viewer(me).occurrence(kept.occurrence.id);
    if (!seen) return bad("FocusTime can't open this call for you. Upload its transcript with Add a call instead.", 409);
    return { ok: true, data: { occurrenceId: kept.occurrence.id, existed: true } };
  }
  const zone = userZone(cfg);
  const endAt = chatCallEnd(c);
  const local = Temporal.Instant.from(c.startedAt).toZonedDateTimeISO(zone);
  const attendees = await ctx.chatCalls!.cooptimizersIn(c.chatId);
  const r = await store.addCall({
    callKind: "chat", clientKey: client.key, name: CALL_LIST.chatCallName(c.chatName), organizer: "home", joinUrl: `chat:${c.chatId}`, eventId: key, registrantId: me,
    start: local.toPlainTime().toString({ smallestUnit: "minute" }), minutes: Math.max(1, Math.round((Date.parse(endAt) - Date.parse(c.startedAt)) / 60_000)), zone, attendees, day: local.toPlainDate().toString(), startAt: c.startedAt, endAt,
  });
  ctx.log({ source: "plan", op: "meeting_call_start", kind: r.existed ? "existed" : "kept_chat", count: attendees.length });
  return { ok: true, data: { occurrenceId: r.occurrence.id, existed: r.existed } };
}

/**
 * MC-2c: Get it from Teams for a kept chat call, one try per press, with my own sign-in. Checked first: I'm a
 * Cooptimizer and a reviewer, and the call is still held with its event in a chat that is registered, that I'm in and
 * whose client I follow. Only then one press opens, for me and this call id, two minutes; the client's gate lets
 * nothing else through. The transcripts are listed (or the event's id used), read in time order, joined and kept 30
 * days; with speaker names off Teams is asked once more without them. Each of Microsoft's answers becomes plain words
 * with the way on. Logged by outcome and count only.
 */
async function fetchChatCall(ctx: MeetingContext, store: MeetingStore, cfg: AppConfig, me: string, series: MeetingSeries, occ: Occurrence): Promise<ActionResponse> {
  const say = (outcome: Exclude<FetchOutcome, "found">, status = 200): ActionResponse => {
    ctx.log({ source: "plan", op: "meeting_call_fetch", kind: outcome });
    return status === 200 ? { ok: true, data: { outcome, message: FETCH_WORDS[outcome] } } : { ok: false, status, error: FETCH_WORDS[outcome], code: outcome };
  };
  if (!ctx.cooptimizer || !(await ctx.cooptimizer(me).catch(() => false))) return say("not_cooptimizer", 403);
  if (!ctx.chatPress || !ctx.chatCalls) return say("unavailable");
  const callId = series.eventId ? callIdOfKey(series.eventId) : null;
  const c = callId ? await ctx.chatCalls.one(callId) : null;
  if (!c || c.chatId !== chatIdOf(series)) return say("not_in_chat", 403);
  // MC-6: a chat call kept under another client before the rule is never read again under it: nothing is asked of Teams and nothing goes to the AI.
  if (!(await chatClientAllowed(ctx, c.clientKey, series.clientKey))) {
    ctx.log({ source: "plan", op: "meeting_call_fetch", kind: "chat_other_client" });
    return { ok: false, status: 403, error: CHAT_OTHER_CLIENT, code: "chat_other_client" };
  }
  const client = ctx.adhoc?.(cfg) ?? null;
  if (!client) return say("signin");
  const press = ctx.chatPress.open(me, c.callId);
  try {
    const read = await readChatTranscript(client, c.callId, c.transcriptId);
    const lines = joinTranscriptParts(read.parts, read.named);
    await store.saveTranscript(occ.id, lines, "automatic", null, read.named ? "teams" : "teams_unnamed");
    await store.updateOccurrence(occ.id, { lastRead: { kind: "found", by: me, at: ctx.now() } });
    const r = await runPass({ store, ai: ctx.ai, capture: (k) => ctx.capture(cfg, k), users: ctx.users, log: ctx.log, now: ctx.now }, series, (await store.occurrence(occ.id))!, lines);
    ctx.log({ source: "plan", op: "meeting_call_fetch", kind: read.named ? "found" : "found_unnamed", count: lines.length });
    // Without speaker names the review says so once, in its note (noSpeakers).
    const message = fetchFound(lines.length, r.proposals, r.outcome === "done");
    return { ok: true, data: { ...r, aiOutcome: r.outcome, outcome: "found", message, lines: lines.length, noSpeakers: !read.named } };
  } catch (e) {
    if (e instanceof AdhocRefused) return say("not_in_chat", 403);
    if (e instanceof TranscriptsOff) return say("tenant_off");
    if (e instanceof TranscriptError) return say("unreadable");
    if (e instanceof HttpError && e.status === 413) return say("unreadable");
    if (e instanceof AuthFailure && e.kind === "consent") return say("chat_not_granted");
    const k = graphFailureOf(e);
    if (k === "missing") return say("chat_none");
    if (k === "signin" || k === "setup") return say("signin");
    if (k === "busy") return say("busy");
    if (k === "consent" || k === "refused") return say("chat_refused");
    throw e;
  } finally {
    press.done();
  }
}

/** MC-4: what one check answers for a call: a transcript in Teams, none, the tenant's setting off, or not checked yet. */
export type CheckAnswer = HeldAnswer | "unchecked";

/**
 * MC-4: which calls on my own calendar have a transcript in Teams, asked when I open Calls and on Refresh (`refresh`
 * forgets what is held), or for the next CHECK_CAP with `more`. Only a Teams meeting organized at Cooptimize that
 * nobody asked FocusTime to read yet, in the list's window, not hidden, is asked; with my own sign-in, the newest
 * first, at most CHECK_CAP a press. Answers are held in the server's memory for 15 minutes and in the page while Calls
 * is open: never stored, logged or exported. The answer is each call's key and yes, no, off or unchecked: nothing else.
 */
async function checkCalls(ctx: MeetingContext, store: MeetingStore, cfg: AppConfig, me: string, input: unknown): Promise<ActionResponse> {
  const o = obj(input, [], ["refresh", "more"]);
  if (o.refresh !== undefined && typeof o.refresh !== "boolean") throw new Invalid("refresh must be true or false");
  if (o.more !== undefined && typeof o.more !== "boolean") throw new Invalid("more must be true or false");
  if (!ctx.exists) return { ok: true, data: { answers: {}, unchecked: 0, failed: false, unavailable: true } };
  const g = ctx.graph(cfg);
  if (!g) return { ok: false, status: 409, error: GRAPH_WORDS.signin.error, code: "signin" };
  const zone = userZone(cfg);
  const w = otherCallsWindow(ctx.now(), zone);
  let all: CalendarMeeting[];
  try {
    all = await g.recentCalls(w.fromIso, w.toIso);
  } catch (e) {
    const p = graphProblem(ctx, e);
    if (p) return p;
    throw e;
  }
  if (o.refresh) ctx.exists.hold.clear(me);
  const taken = await registeredLinks(store);
  const home = await ctx.homeDomains();
  // A meeting I hid isn't asked about.
  const hidden = ctx.plan ? await ctx.plan.callHides() : null;
  const asks: ExistsAsk[] = [];
  for (const c of all) {
    if (!isOtherCall(c) || !inWindow(c.startAt, w) || !c.joinUrl || taken.has(joinKey(c.joinUrl))) continue;
    if (detectSource(c.organizerEmail, home).organizer === "other") continue;
    if (hidden && (hidden.keys.has(c.key) || (c.seriesKey && hidden.series.has(c.seriesKey)))) continue;
    if (await store.callByKey(c.key)) continue;
    asks.push({ key: c.key, joinUrl: c.joinUrl, startAt: c.startAt, endAt: c.endAt });
  }
  asks.sort((a, b) => b.startAt.localeCompare(a.startAt));
  const answers: Record<string, CheckAnswer> = {};
  const toAsk: ExistsAsk[] = [];
  const exists = ctx.exists;
  // Opening Calls and Refresh ask only about the newest 40; only Check more goes past them, 40 at a time.
  asks.forEach((a, i) => {
    const h = exists.hold.get(me, a.key);
    if (h) answers[a.key] = h;
    else if (toAsk.length < CHECK_CAP && (o.more || i < CHECK_CAP)) toAsk.push(a);
    else answers[a.key] = "unchecked";
  });
  let failed = false;
  if (toAsk.length) {
    const grant = ctx.exists.grants.open(me, toAsk.map((a) => a.joinUrl));
    try {
      const got = await g.transcriptsExist(toAsk);
      for (const a of toAsk) {
        const v = got.get(a.key) ?? "failed";
        if (v === "failed") (failed = true), (answers[a.key] = "unchecked");
        else ctx.exists.hold.set(me, a.key, v), (answers[a.key] = v);
      }
    } catch (e) {
      if (e instanceof MeetingRefused) throw e;
      if (e instanceof TranscriptsOff) for (const a of toAsk) ctx.exists.hold.set(me, a.key, "off"), (answers[a.key] = "off");
      else {
        if (!graphFailureOf(e)) throw e;
        failed = true;
        for (const a of toAsk) answers[a.key] = "unchecked";
      }
    } finally {
      grant.done();
    }
  }
  const n = (v: CheckAnswer) => Object.values(answers).filter((x) => x === v).length;
  ctx.log({ source: "plan", op: "meeting_calls_check", count: toAsk.length, kind: failed ? "failed" : "ok" });
  return { ok: true, data: { answers, yes: n("yes"), unchecked: n("unchecked"), off: n("off") > 0, failed } };
}

/** The Cooptimizers among FocusTime users on a call's invite (never a guest, an automation account or anyone outside). */
async function invitedCooptimizers(ctx: MeetingContext, emails: readonly string[]): Promise<string[]> {
  const ids = attendeeIds(emails.map((email) => ({ email })), await ctx.users());
  const out: string[] = [];
  for (const uid of ids) if (ctx.cooptimizer && (await ctx.cooptimizer(uid).catch(() => false))) out.push(uid);
  return out;
}

/**
 * MC-2: Review on one of my other calls, after its setup: the client it is about (my choice, one of FocusTime's
 * clients; the suggestion was only that) and where its transcript comes from. The press checks the call on my own
 * calendar now (on it, not declined, not registered) and keeps it: me its one reviewer, the Cooptimizers on my invite
 * its attendees. A call someone on it already pressed Review on opens as it is. Nothing goes to the AI here.
 */
async function startCall(ctx: MeetingContext, store: MeetingStore, cfg: AppConfig, me: string, input: unknown): Promise<ActionResponse> {
  const o = obj(input, ["key", "startAt", "endAt", "clientKey"]);
  const key = text(o.key, "key", 2000)!;
  if (!KEY.test(key)) throw new Invalid("key must be a call's key");
  if (key.startsWith("chat:")) return await startChatCall(ctx, store, cfg, me, key, text(o.clientKey, "clientKey", 100)!);
  const startAt = isoAt(o.startAt, "startAt");
  const endAt = isoAt(o.endAt, "endAt");
  if (!ctx.cooptimizer || !(await ctx.cooptimizer(me).catch(() => false))) return { ok: false, status: 403, error: FETCH_WORDS.not_cooptimizer, code: "not_cooptimizer" };
  const client = await clientOf(ctx, text(o.clientKey, "clientKey", 100)!);
  if (isRefusal(client)) return client;
  const g = ctx.graph(cfg);
  if (!g) return { ok: false, status: 409, error: GRAPH_WORDS.signin.error, code: "signin" };
  const zone = userZone(cfg);
  let c: CalendarMeeting | null;
  try {
    c = await g.callAt(key, startAt, endAt);
  } catch (e) {
    const p = graphProblem(ctx, e);
    if (p) return p;
    throw e;
  }
  // Only a call I was on: on my own calendar now, counting as a call, in my last 14 days, not a registered one.
  if (!c || !isOtherCall(c) || !inWindow(c.startAt, otherCallsWindow(ctx.now(), zone)) || (c.joinUrl && (await registeredLinks(store)).has(joinKey(c.joinUrl)))) {
    ctx.log({ source: "plan", op: "meeting_call_start", kind: "not_on_invite" });
    return { ok: false, status: 403, error: FETCH_WORDS.not_on_invite, code: "not_on_invite" };
  }
  const kept = await store.callByKey(c.key);
  if (kept) {
    const seen = await store.viewer(me).occurrence(kept.occurrence.id);
    if (!seen) return bad("FocusTime can't open this call for you. Upload its transcript with Add a call instead.", 409);
    return { ok: true, data: { occurrenceId: kept.occurrence.id, existed: true } };
  }
  const local = Temporal.Instant.from(c.startAt).toZonedDateTimeISO(zone);
  const organizer = detectSource(c.organizerEmail, await ctx.homeDomains()).organizer;
  const attendees = await invitedCooptimizers(ctx, c.homeAttendees);
  const r = await store.addCall({
    callKind: "calendar", clientKey: client.key, name: c.subject, organizer, joinUrl: c.joinUrl ?? `none:${c.key}`.slice(0, 2000), eventId: c.key, registrantId: me,
    start: local.toPlainTime().toString({ smallestUnit: "minute" }), minutes: Math.max(1, Math.round((Date.parse(c.endAt) - Date.parse(c.startAt)) / 60_000)), zone, attendees, day: local.toPlainDate().toString(), startAt: c.startAt, endAt: c.endAt,
  });
  ctx.log({ source: "plan", op: "meeting_call_start", kind: r.existed ? "existed" : "kept", count: attendees.length });
  return { ok: true, data: { occurrenceId: r.occurrence.id, existed: r.existed } };
}

/**
 * MC-2: Add a call that isn't on my calendar (a teammates' call, a phone call): its name, day, start, length and the
 * client it is about. Only I see it (no attendees); its transcript is uploaded. Kept because I asked for it here.
 */
async function addCall(ctx: MeetingContext, store: MeetingStore, cfg: AppConfig, me: string, input: unknown): Promise<ActionResponse> {
  const o = obj(input, ["name", "date", "start", "minutes", "clientKey"]);
  const name = text(o.name, "name", 200)!;
  if (typeof o.date !== "string" || !DATE.test(o.date)) throw new Invalid("Pick the call's day");
  if (typeof o.start !== "string" || !TIME.test(o.start)) throw new Invalid("Give the call's start time");
  if (typeof o.minutes !== "number" || !Number.isInteger(o.minutes) || o.minutes < 5 || o.minutes > 480) throw new Invalid("A call's length is 5 minutes to 8 hours");
  if (!ctx.cooptimizer || !(await ctx.cooptimizer(me).catch(() => false))) return { ok: false, status: 403, error: FETCH_WORDS.not_cooptimizer, code: "not_cooptimizer" };
  const client = await clientOf(ctx, text(o.clientKey, "clientKey", 100)!);
  if (isRefusal(client)) return client;
  const zone = userZone(cfg);
  const w = otherCallsWindow(ctx.now(), zone);
  const start = Temporal.PlainDate.from(o.date).toZonedDateTime({ timeZone: zone, plainTime: Temporal.PlainTime.from(o.start) });
  if (Temporal.PlainDate.compare(Temporal.PlainDate.from(o.date), Temporal.PlainDate.from(w.fromDay)) < 0 || Temporal.Instant.compare(start.toInstant(), Temporal.Instant.from(ctx.now())) > 0) return bad("Add a call from the last 14 days that has started", 422);
  const r = await store.addCall({
    callKind: "hand", clientKey: client.key, name, organizer: "unknown", joinUrl: `hand:${crypto.randomUUID()}`, eventId: null, registrantId: me,
    start: o.start, minutes: o.minutes, zone, attendees: [], day: o.date, startAt: start.toInstant().toString(), endAt: start.add({ minutes: o.minutes }).toInstant().toString(),
  });
  ctx.log({ source: "plan", op: "meeting_call_add" });
  return { ok: true, data: { occurrenceId: r.occurrence.id } };
}

/**
 * MC-2: Get it from Teams, one try per press, for a calendar call I pressed Review on. The call is checked on my own
 * calendar again (still on it, not declined, the same Teams meeting), an outside organizer is never asked, and only then
 * one press is opened for me and this call's join link, the same rule as everywhere (`mayRead`); the Graph gate lets
 * nothing else through. Microsoft's answers each become plain words that point to the upload. The transcript is kept
 * 30 days like any other; the AI pass runs on it once, under my switches. Logged by outcome only.
 */
async function fetchFromTeams(ctx: MeetingContext, store: MeetingStore, cfg: AppConfig, me: string, series: MeetingSeries, occ: Occurrence): Promise<ActionResponse> {
  const say = (outcome: Exclude<FetchOutcome, "found">, status = 200): ActionResponse => {
    ctx.log({ source: "plan", op: "meeting_call_fetch", kind: outcome });
    return status === 200 ? { ok: true, data: { outcome, message: FETCH_WORDS[outcome] } } : { ok: false, status, error: FETCH_WORDS[outcome], code: outcome };
  };
  const cooptimizer = !!ctx.cooptimizer && (await ctx.cooptimizer(me).catch(() => false));
  if (!cooptimizer) return say("not_cooptimizer", 403);
  if (!ctx.press) return say("unavailable");
  const g = ctx.graph(cfg);
  if (!g) return say("signin");
  let c: CalendarMeeting | null;
  try {
    c = series.eventId ? await g.callAt(series.eventId, occ.startAt, occ.endAt) : null;
  } catch (e) {
    const k = graphFailureOf(e);
    if (!k) throw e;
    return say(k === "consent" ? "consent" : k === "signin" || k === "setup" ? "signin" : "busy");
  }
  const onInvite = !!c && isOtherCall(c);
  if (!onInvite) return say("not_on_invite", 403);
  if (!c!.joinUrl) return say("not_online");
  if (detectSource(c!.organizerEmail, await ctx.homeDomains()).organizer === "other" || series.organizer === "other") return say("outside");
  const thisCall = joinKey(c!.joinUrl) === joinKey(series.joinUrl);
  if (!mayRead({ registered: null, press: { cooptimizer, onInvite, thisCall } })) return say("not_on_invite", 403);
  const press = ctx.press.open(me, c!.joinUrl);
  try {
    const meetingId = await g.onlineMeetingId(c!.joinUrl);
    if (!meetingId) return say("none");
    press.meeting(meetingId);
    const ref = pressTranscript(await g.transcripts(meetingId), occ.startAt, occ.endAt);
    if (!ref) return say("none");
    const lines = parseVtt(await g.transcriptVtt(meetingId, ref.id));
    await store.saveTranscript(occ.id, lines, "automatic", null, "teams");
    await store.updateOccurrence(occ.id, { lastRead: { kind: "found", by: me, at: ctx.now() } });
    // The pass runs once now, for me; nothing tries it again by itself (no retriesHere for a call).
    const r = await runPass({ store, ai: ctx.ai, capture: (k) => ctx.capture(cfg, k), users: ctx.users, log: ctx.log, now: ctx.now }, series, (await store.occurrence(occ.id))!, lines);
    ctx.log({ source: "plan", op: "meeting_call_fetch", kind: "found", count: lines.length });
    return { ok: true, data: { ...r, aiOutcome: r.outcome, outcome: "found", message: fetchFound(lines.length, r.proposals, r.outcome === "done"), lines: lines.length } };
  } catch (e) {
    if (e instanceof MeetingRefused) return say("not_on_invite", 403);
    if (e instanceof TranscriptsOff) return say("tenant_off");
    if (e instanceof TranscriptError) return say("unreadable");
    if (e instanceof HttpError && e.status === 413) return say("unreadable");
    const k = graphFailureOf(e);
    if (k === "missing") return say("none");
    if (k === "consent") return say("not_allowed");
    if (k === "signin" || k === "setup") return say("signin");
    if (k === "busy") return say("busy");
    if (k === "refused") return say("not_allowed");
    throw e;
  } finally {
    press.done();
  }
}
