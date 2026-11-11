// MC-1: meeting capture's actions. Registering a client's weekly call (Admin › Clients › <client> › Meetings, an
// admin), the calls I review or attend, uploading a transcript for a dated occurrence (a reviewer), "No transcript
// this week", and the review: one screen per occurrence where a reviewer ticks, edits or skips each proposal and one
// Confirm makes them through the existing writes: a gap becomes my draft and then the existing DevOps create, a
// comment the existing DevOps comment (both with the write framework's preview, read back, audit log and undo), a
// commitment a shared commitment that shows in the committer's own Promises (a Cooptimizer's) or my Waiting on (the
// client's). Nothing writes without Confirm; nobody's plan but my own is written.
//
// Transcript text never goes to a log or an error message; logs carry ids-free counts and outcomes only.
import type { CheckNowResult } from "../plan/meetings.ts";
import type { ClientEntry } from "../ai/guard.ts";
import type { AiService } from "../ai/service.ts";
import { AI_MESSAGES } from "../ai/types.ts";
import type { AppConfig } from "../config/schema.ts";
import type { LogRecord } from "../log/logger.ts";
import { attendeeIds, canConfirm, defaultReviewers, detectSource, joinKey, lastReadLine, MEETING_ROLES, nudgesFor, proposalOrder, ROLE_LABEL, type MeetingRole, type MeetingSeries, type Occurrence, type ProposalBody, type TranscriptSource } from "../plan/meetings.ts";
import { levelOfType, type ProcessModel } from "../plan/process.ts";
import { TranscriptError, type TranscriptLine } from "../plan/transcript.ts";
import { graphFailureOf, type GraphFailure, type MeetingsClient, type SeriesCandidate } from "../sources/graph/meetings.ts";
import { MEETING_CHAT, type ConversationStore } from "../store/conversation-store.ts";
import type { MeetingStore } from "../store/meeting-store.ts";
import type { PlanStore } from "../store/plan-store.ts";
import { PlanError } from "../store/plan-store.ts";
import type { WorkItem } from "../week/types.ts";
import { userZone } from "../week/zone.ts";
import { capturePass } from "./meeting-capture.ts";
import { readTranscriptFile } from "./transcript-file.ts";
import type { OccurrenceView, SeriesView } from "../plan/meeting-views.ts";
export type { MeetingNudgeView, OccurrenceView, SeriesView } from "../plan/meeting-views.ts";
import type { ActionResponse } from "./types.ts";

export const MEETING_ACTIONS = ["meeting.list", "meeting.candidates", "meeting.register", "meeting.update", "meeting.remove", "meeting.mine", "meeting.review", "meeting.edit", "meeting.no_transcript", "meeting.prepare", "meeting.confirm", "meeting.rerun", "meeting.check_now"] as const;
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
  /** The DevOps write framework, as the app's buttons call it (devops.preview, devops.confirm). */
  devops: (action: "devops.preview" | "devops.confirm", input: unknown) => Promise<ActionResponse>;
  /** Whether I have a checked write PAT for the client. */
  canWrite: (clientKey: string) => Promise<boolean>;
  log: (r: LogRecord) => void;
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
const ids = (v: unknown, name: string, max = 100): number[] => {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > max) throw new Invalid(`${name} must be up to ${max} ids`);
  return v.map((x) => id(x, name));
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
    id: s.id, clientKey: s.clientKey, clientName, name: s.name, role: s.role, roleLabel: ROLE_LABEL[s.role], source: s.source, detected: s.detected, organizer: s.organizer,
    when: whenOf(s), weekday: s.weekday, start: s.start, minutes: s.minutes, zone: s.zone, reviewers: s.reviewers.map((r) => ({ id: r, name: name(r) })), attendees: s.attendees.length,
    mine: { review: s.reviewers.some((r) => lower(r) === lower(me)), attend: s.attendees.some((a) => lower(a) === lower(me)) },
  };
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
  setup: { status: 503, error: "FocusTime's Microsoft sign-in isn't set up here. A FocusTime admin can see why in Admin › Status" },
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

const aiMessage = (o: string | null) => (!o || o === "done" ? null : o === "no_ai" ? "AI isn't on for this client, so nothing was proposed. A FocusTime admin allows it in Admin › AI." : (AI_MESSAGES as Record<string, string>)[o] ?? "The AI pass didn't finish");

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
        if (!s || s.removedAt) return bad("No such meeting", 404);
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
        if (!s || s.removedAt) return bad("No such meeting", 404);
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
        const mine = await store.viewer(me).series();
        const from = Temporal.Instant.from(ctx.now()).subtract({ hours: 24 * 35 }).toZonedDateTimeISO("UTC").toPlainDate().toString();
        const occs = await store.recentOccurrences(mine.map((s) => s.id), from);
        const counts = new Map<number, { all: number; open: number }>();
        for (const o of occs) {
          const ps = await store.proposals(o.id);
          counts.set(o.id, { all: ps.length, open: ps.filter((p) => p.state === "open").length });
        }
        // The nudges (in-app and the Teams kind): ready to review, or a transcript to upload; once each by key.
        const nameOf = await namesOf(ctx, mine.map((s) => s.clientKey));
        const nudges = nudgesFor(me, mine, occs).map((n) => ({ ...n, clientName: nameOf(n.clientKey), dateLabel: Temporal.PlainDate.from(n.date).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" }) }));
        return { ok: true, data: { meetings: mine.map((s) => viewOf(s, nameOf(s.clientKey), users, me)), occurrences: occs.map((o) => occView(o, counts.get(o.id))), nudges } };
      }
      case "meeting.review": return await review(ctx, store, me, input);
      case "meeting.edit": {
        // Edit or skip one proposal (a reviewer); a decided one stays as it is.
        const o = obj(input, ["proposalId"], ["skip", "title", "description", "parentId", "type", "what", "due", "text"]);
        const p = await store.proposal(id(o.proposalId, "proposalId"));
        if (!p) return bad("No such proposal", 404);
        if (p.state === "confirmed") return bad("That one is already done", 409);
        if (o.skip !== undefined) {
          if (typeof o.skip !== "boolean") throw new Invalid("skip must be true or false");
          const next = await store.viewer(me).updateProposal(p.id, { state: o.skip ? "skipped" : "open", decidedBy: o.skip ? me : null, decidedAt: o.skip ? ctx.now() : null });
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
        const r = await runPass({ store, ai: ctx.ai, capture: (k) => ctx.capture(cfg, k), users: ctx.users, log: ctx.log }, series, occ, lines);
        return { ok: true, data: r };
      }
      case "meeting.prepare": return await prepare(ctx, store, cfg, me, input);
      case "meeting.confirm": return await confirm(ctx, store, me, input);
    }
  } catch (e) {
    if (e instanceof Invalid) return bad(e.message);
    if (e instanceof TranscriptError) return bad(e.message, 422);
    if (e instanceof PlanError) return bad(e.message, /No such/.test(e.message) ? 404 : /already registered/.test(e.message) ? 409 : 403);
    // MC-1c: never "bad request": anything else is said plainly and logged by its kind only.
    const kind = graphFailureOf(e);
    ctx.log({ source: "plan", op: "meeting_action_failed", kind: kind ?? (e instanceof Error ? e.name : "unknown") });
    if (kind && kind !== "missing") return { ok: false, ...GRAPH_WORDS[kind === "refused" ? "refused" : kind], code: kind === "refused" ? "graph_refused" : kind };
    return { ok: false, status: 500, error: "FocusTime couldn't finish that. Try again; if it keeps happening, a FocusTime admin can look in Admin › Status", code: "failed" };
  }
}

const occView = (o: Occurrence, c?: { all: number; open: number }): OccurrenceView => ({ id: o.id, seriesId: o.seriesId, date: o.date, startAt: o.startAt, endAt: o.endAt, state: o.state, transcriptFrom: o.transcriptFrom, proposals: c?.all ?? 0, open: c?.open ?? 0, aiOutcome: o.aiOutcome, aiMessage: aiMessage(o.aiOutcome) });

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
    return { ...b, ...(o.title !== undefined ? { title: text(o.title, "title", 200)! } : {}), ...(o.description !== undefined ? { description: text(o.description, "description", 2000, true) ?? "" } : {}), ...(o.type !== undefined ? { type: text(o.type, "type", 100)! } : {}), parentId, parentTitle: parentId === b.parentId ? b.parentTitle : null };
  }
  if (b.kind === "commitment") {
    const due = o.due === undefined ? b.due : o.due === null ? null : typeof o.due === "string" && DATE.test(o.due) ? o.due : (() => { throw new Invalid("due must be a date"); })();
    return { ...b, ...(o.what !== undefined ? { what: text(o.what, "what", 200)! } : {}), due };
  }
  return { ...b, ...(o.text !== undefined ? { text: text(o.text, "text", 2000)! } : {}) };
}

/** The review screen: the call, the occurrence, its proposals in order with quotes, and what I may do. */
async function review(ctx: MeetingContext, store: MeetingStore, me: string, input: unknown): Promise<ActionResponse> {
  const o = obj(input, ["occurrenceId"]);
  const v = store.viewer(me);
  const r = await v.occurrence(id(o.occurrenceId, "occurrenceId"));
  if (!r) return bad("No such meeting", 404);
  const ps = (await v.proposals(r.o.id)).sort(proposalOrder);
  const lines = await store.transcript(r.o.id);
  const users = await ctx.users();
  const reviewer = canConfirm(r.series, me);
  return {
    ok: true,
    data: {
      meeting: viewOf(r.series, (await namesOf(ctx, [r.series.clientKey]))(r.series.clientKey), users, me),
      occurrence: occView(r.o, { all: ps.length, open: ps.filter((p) => p.state === "open").length }),
      proposals: ps,
      transcript: lines ? { lines: lines.length, speakers: [...new Set(lines.map((l) => l.speaker))].length } : null,
      canConfirm: reviewer,
      canWrite: reviewer ? await ctx.canWrite(r.series.clientKey).catch(() => false) : false,
    },
  };
}

/** The changes a Confirm would make, previewed through the DevOps write framework (a reviewer). */
async function prepare(ctx: MeetingContext, store: MeetingStore, cfg: AppConfig, me: string, input: unknown): Promise<ActionResponse> {
  const o = obj(input, ["occurrenceId", "keep"]);
  const { o: occ, series } = await store.viewer(me).reviewer(id(o.occurrenceId, "occurrenceId"));
  const keep = new Set(ids(o.keep, "keep"));
  const ps = (await store.proposals(occ.id)).filter((p) => p.state === "open" || p.state === "failed");
  const kept = ps.filter((p) => keep.has(p.id));
  if (!kept.length) return bad("Tick at least one proposal, or skip them all", 409);
  const writes = kept.filter((p) => p.kind !== "commitment");
  if (writes.length && !(await ctx.canWrite(series.clientKey).catch(() => false))) return bad("Enable DevOps writes for this client in Settings › Clients first", 409);
  const plan = ctx.plan;
  const changes: Record<string, unknown>[] = [];
  const draftOnly: { proposalId: number; title: string; message: string }[] = [];
  const cap = writes.length ? await ctx.capture(cfg, series.clientKey).catch(() => null) : null;
  for (const p of writes) {
    const b = p.body;
    if (b.kind === "comment") changes.push({ kind: "comment", itemId: b.itemId, text: b.text, key: `p${p.id}` });
    else if (b.kind === "gap") {
      if (!plan) return bad("The plan store isn't available", 503);
      // My own draft (the existing draft and create path), with the meeting's description; reused on a retry.
      const level = cap?.model ? (levelOfType(cap.model, b.type) === "parent" || levelOfType(cap.model, b.type) === "top" ? "feature" : "story") : "story";
      let draftId = p.result?.draftId ?? null;
      if (!draftId || !(await plan.getDraft(draftId))) {
        const d = await plan.addDraft({ clientKey: series.clientKey, parentItemId: b.parentId, title: b.title, size: "M", level });
        await plan.updateDraft(d.id, { description: b.description || null });
        draftId = d.id;
        await store.updateProposal(p.id, { result: { draftId } });
      }
      if (b.parentId === null) draftOnly.push({ proposalId: p.id, title: b.title, message: "Saved as your draft: put it under a feature or epic in Inbox › Captures and drafts, then create it" });
      else changes.push({ kind: "create", draftId, type: b.type, key: `p${p.id}` });
    }
  }
  let previews: unknown[] = [];
  let refused: unknown[] = [];
  let nothing: unknown[] = [];
  for (let i = 0; i < changes.length; i += 10) {
    const r = await ctx.devops("devops.preview", { clientKey: series.clientKey, changes: changes.slice(i, i + 10) });
    if (!r.ok) return r;
    const d = r.data as { previews: unknown[]; refused: unknown[]; nothing: unknown[] };
    previews = [...previews, ...d.previews];
    refused = [...refused, ...d.refused];
    nothing = [...nothing, ...d.nothing];
  }
  const commitments = kept.flatMap((p) => (p.body.kind === "commitment" ? [{ proposalId: p.id, who: p.body.who, side: p.body.side, what: p.body.what, due: p.body.due, shows: p.body.side === "cooptimize" ? `In ${p.body.who === "" ? "their" : `${p.body.who.split(/\s+/)[0]}'s`} Promises, for them to keep or dismiss` : "In your Waiting on" }] : []));
  return { ok: true, data: { previews, refused, nothing, draftOnly, commitments, skip: ps.filter((p) => !keep.has(p.id)).map((p) => p.id) } };
}

/** One Confirm: the previewed DevOps writes, the shared commitments, and the rest skipped. */
async function confirm(ctx: MeetingContext, store: MeetingStore, me: string, input: unknown): Promise<ActionResponse> {
  // GD-2: mentionsOk: I saw the flag on my own edited words and confirm them as written.
  const o = obj(input, ["occurrenceId", "keep"], ["previews", "mentionsOk"]);
  const { o: occ, series } = await store.viewer(me).reviewer(id(o.occurrenceId, "occurrenceId"));
  const keep = new Set(ids(o.keep, "keep"));
  const pairs = o.previews === undefined ? [] : Array.isArray(o.previews) && o.previews.length <= 50 ? o.previews.map((x) => {
    const r = obj(x, ["proposalId", "previewId"]);
    return { proposalId: id(r.proposalId, "proposalId"), previewId: text(r.previewId, "previewId", 100)! };
  }) : (() => { throw new Invalid("previews must be up to 50 pairs"); })();
  const ps = (await store.proposals(occ.id)).filter((p) => p.state === "open" || p.state === "failed");
  const at = ctx.now();
  const results: { proposalId: number; ok: boolean; message: string }[] = [];
  // DevOps writes first, through the framework (read back, audit log, undo).
  for (let i = 0; i < pairs.length; i += 10) {
    const batch = pairs.slice(i, i + 10).filter((x) => keep.has(x.proposalId) && ps.some((p) => p.id === x.proposalId));
    if (!batch.length) continue;
    const r = await ctx.devops("devops.confirm", { previewIds: batch.map((x) => x.previewId), ...(o.mentionsOk === true ? { mentionsOk: true } : {}) });
    const rs = r.ok ? ((r.data as { results: ({ entry: { id: number }; confirmed: boolean; message: string; itemId?: number | null } | { error: string })[] }).results) : batch.map(() => ({ error: r.ok ? "" : r.error }));
    for (const [j, x] of batch.entries()) {
      const p = ps.find((y) => y.id === x.proposalId)!;
      const res = rs[j];
      if (res && "entry" in res && res.confirmed) {
        await store.updateProposal(p.id, { state: "confirmed", result: { ...p.result, writeId: res.entry.id, ...(res.itemId ? { itemId: res.itemId } : {}), message: res.message }, decidedBy: me, decidedAt: at });
        results.push({ proposalId: p.id, ok: true, message: res.message });
      } else {
        const message = res && "error" in res ? res.error : res && "message" in res ? res.message : "That change didn't go through";
        await store.updateProposal(p.id, { state: "failed", result: { ...p.result, message }, decidedBy: me, decidedAt: at });
        results.push({ proposalId: p.id, ok: false, message });
      }
    }
  }
  for (const p of ps) {
    if (!keep.has(p.id)) {
      await store.updateProposal(p.id, { state: "skipped", decidedBy: me, decidedAt: at });
      continue;
    }
    const b = p.body;
    if (b.kind === "commitment") {
      if (!ctx.conversations) {
        results.push({ proposalId: p.id, ok: false, message: "Promises aren't available here" });
        continue;
      }
      // Shared, like CV-1's: a Cooptimizer's shows in their own Promises; the client's is my Waiting on. Nobody's plan.
      const k = await ctx.conversations.addCommitment({
        conversationId: null, chatId: `${MEETING_CHAT}${series.id}`, clientKey: series.clientKey, whoId: b.side === "cooptimize" ? b.whoId : null, whoName: b.who, toId: b.side === "client" ? me : null, toName: b.side === "client" ? null : b.toName,
        what: b.what, dueAt: null, dueDate: b.due, impliesItem: false, messageIds: [], reason: `From ${series.name}, ${occ.date}`, closeHow: null, closeNote: null,
      });
      await store.updateProposal(p.id, { state: "confirmed", result: { commitmentId: k.id }, decidedBy: me, decidedAt: at });
      results.push({ proposalId: p.id, ok: true, message: b.side === "cooptimize" ? `A promise for ${b.who}` : `Waiting on ${b.who}` });
    } else if (b.kind === "gap" && b.parentId === null && p.result?.draftId) {
      await store.updateProposal(p.id, { state: "confirmed", decidedBy: me, decidedAt: at });
      results.push({ proposalId: p.id, ok: true, message: "Saved as your draft" });
    }
  }
  const left = (await store.proposals(occ.id)).filter((p) => p.state === "open" || p.state === "failed").length;
  if (!left) await store.updateOccurrence(occ.id, { state: "reviewed", reviewedBy: me });
  ctx.log({ source: "plan", op: "meeting_confirmed", count: results.filter((r) => r.ok).length, kind: results.some((r) => !r.ok) ? "partial" : "ok" });
  return { ok: true, data: { results, left } };
}

// ---- The AI pass, shared by uploads and the poll job ----

export type PassDeps = {
  store: MeetingStore;
  ai: () => Promise<AiService | null>;
  capture: (clientKey: string) => Promise<CaptureContext | null>;
  users: () => Promise<MeetingUser[]>;
  log: (r: LogRecord) => void;
};

/** Runs the AI pass on a stored transcript and records its proposals and outcome; the occurrence becomes ready. */
export async function runPass(d: PassDeps, series: MeetingSeries, occ: Occurrence, lines: readonly TranscriptLine[]): Promise<{ outcome: string; proposals: number }> {
  const ai = await d.ai().catch(() => null);
  const cap = await d.capture(series.clientKey).catch(() => null);
  let outcome = "done";
  let n = 0;
  if (!ai) outcome = "not_set_up";
  else if (!cap) outcome = "provider";
  else {
    const users = await d.users().catch((): MeetingUser[] => []);
    const cooptimizers = series.attendees.flatMap((a) => users.filter((u) => lower(u.id) === lower(a)).map((u) => ({ id: lower(u.id), name: u.name })));
    const r = await capturePass(ai, { clientKey: series.clientKey, clientName: cap.clientName, internal: cap.internal, meeting: { name: series.name, role: series.role, date: occ.date }, cooptimizers, items: cap.items, model: cap.model, directory: cap.directory, lines });
    if (r.ok) {
      n = (await d.store.replaceProposals(occ.id, r.proposals)).filter((p) => p.state === "open").length;
      d.log({ source: "ai", op: "meeting_capture", count: n, kind: `windows:${r.windows} masked_client:${r.masked.client} masked_email:${r.masked.email} dropped:${r.dropped}` });
    } else outcome = r.kind === "client_off" || r.kind === "off" ? "no_ai" : r.kind;
  }
  await d.store.updateOccurrence(occ.id, { state: "ready", aiOutcome: outcome, nextCheckAt: null });
  if (outcome !== "done") d.log({ source: "ai", op: "meeting_capture", kind: outcome });
  return { outcome, proposals: n };
}

/** An uploaded transcript for a series' dated occurrence (a reviewer): parsed, stored, then the AI pass. */
export async function uploadTranscript(ctx: MeetingContext, q: { seriesId: number; date: string; name: string; bytes: Uint8Array }): Promise<ActionResponse> {
  const store = ctx.meetings;
  const me = await ctx.me();
  const cfg = await ctx.config();
  if (!store || !me || !cfg) return bad("Meetings aren't available here", 503);
  if (!DATE.test(q.date)) return bad("Pick the meeting's date", 400);
  const v = store.viewer(me);
  const series = await v.seriesById(q.seriesId);
  if (!series) return bad("No such meeting", 404);
  if (!canConfirm(series, me)) return bad("Only this meeting's reviewers can upload its transcript", 403);
  let lines: TranscriptLine[];
  try {
    lines = readTranscriptFile(q.name, q.bytes).lines;
  } catch (e) {
    if (e instanceof TranscriptError) return bad(e.message, 422);
    throw e;
  }
  const start = Temporal.PlainDate.from(q.date).toZonedDateTime({ timeZone: series.zone, plainTime: Temporal.PlainTime.from(series.start) });
  const occ = await v.ensureOccurrence(series.id, q.date, start.toInstant().toString(), start.add({ minutes: series.minutes }).toInstant().toString());
  await v.saveTranscript(occ.id, lines);
  ctx.log({ source: "plan", op: "meeting_upload", count: lines.length });
  const r = await runPass({ store, ai: ctx.ai, capture: (k) => ctx.capture(cfg, k), users: ctx.users, log: ctx.log }, series, (await store.occurrence(occ.id))!, lines);
  return { ok: true, data: { occurrenceId: occ.id, lines: lines.length, ...r } };
}
