// TB-2: the bot's daily rhythm. Each person's scheduler pass (server/ticks.ts) hands in their settings and the
// notification gate's facts; when a kind is due (plan/teams-rhythm.ts) its occasion is claimed with a unique insert
// (store/teams-rhythm-store.ts), so it is sent once even with two replicas, and at most once: a claim that never
// reached Teams is logged as lost, never sent again. Only to the person's own 1:1 chat with the bot, only with "Let
// FocusTime message me in Teams" and that kind's switch on.
//
// Taps: Done, Undo and Not yet on a pick are the app's own pick.mark_done (a plan-store write with undo, run at once:
// the rule's exception for an explicit tap). Confirm today, Move…, Move the rest and Close out are proposals through
// the assistant's propose() (no AI), shown inside the card and run only on Confirm. "capture: …" saves the text as
// typed with capture.add, with Undo. Sends are paced (10 a second for the app, 3 retries with backoff and jitter); a
// 403 MessageWritesBlocked turns Teams messages off for the person. Nothing here logs text, people or chat ids.
import type { ActionResponse, WeekLoadData } from "../../actions/types.ts";
import { withoutUpdate } from "../../actions/status-actions.ts";
import { nextStatusNudge, nudgeLineFor, statusNudgeDue } from "../../plan/status-report.ts";
import type { StatusLoad } from "../../plan/status-types.ts";
import type { AppConfig } from "../../config/schema.ts";
import type { LogRecord } from "../../log/logger.ts";
import { nextBlockFor } from "../../plan/suggest.ts";
import { doneFromWords, NUDGE_CHECK_MINUTES, NUDGE_MAX, nudgeAllowed, nudgeOccasion, nudges, nextRhythmWake, occasionOf, rhythmDay, rhythmDue, type Nudge, type NudgeFacts, type RhythmKind, type TeamsKind } from "../../plan/teams-rhythm.ts";
import type { Pick as PlanPick } from "../../plan/types.ts";
import type { PlanStore } from "../../store/plan-store.ts";
import type { TeamsBotStore } from "../../store/teams-bot-store.ts";
import type { TeamsRhythmStore } from "../../store/teams-rhythm-store.ts";
import { dayEndOf, hoursOn } from "../../week/hours.ts";
import type { Day, Slot } from "../../week/types.ts";
import { userZone } from "../../week/zone.ts";
import type { AssistantService, ConfirmResult, Proposal } from "./assistant.ts";
import type { Address, InvokeBody, OutActivity, Sender } from "./bot.ts";
import { attach, CARD_TYPE, type Card } from "./cards.ts";
import { durationText, parseLeft, validLeft } from "../../plan/progress.ts";
import type { AppliedSession, SessionView } from "../../actions/types.ts";
import { captureCard, plainRows, rhythmCard, rhythmTapOf, type SessionCard, type BriefModel, type CaptureTap, type CheckinModel, type Choice, type CloseoutModel, type InlineProposal, type NudgeModel, type PickRow, type RhythmModel, type RhythmTap, type StatusModel, type MeetingsModel } from "./rhythm-cards.ts";

/** The facts a person's pass already has (the notifier's gate facts and their settings). */
export type PassFacts = { config: AppConfig; inHours: boolean; pto: boolean; focusRunning: boolean };

/** A takeover from DV-1's change log: an item assigned to me given to someone else by someone else. */
export type Takeover = { key: string; itemId: number; title: string | null; clientName: string | null; byName: string; at: string };

export type RhythmDeps = {
  publicUrl: string;
  /** The paced sender (pacedSender below). */
  sender: Sender;
  botStore: (userId: string) => TeamsBotStore;
  store: (userId: string) => TeamsRhythmStore;
  plan: (userId: string) => Promise<PlanStore | undefined>;
  /** An action as the person (their own context, the same dispatch the app's buttons use). */
  run: (userId: string, action: string, input: unknown) => Promise<ActionResponse>;
  config: (userId: string) => Promise<AppConfig | null>;
  assistant: Pick<AssistantService, "propose" | "confirm" | "cancel"> | null;
  /** DV-1's change log since an instant, for the takeover nudge; [] where it isn't set up. */
  takeovers: (userId: string, since: string) => Promise<Takeover[]>;
  /** 403 MessageWritesBlocked: Teams messages off for the person (their setting), and Settings says why. */
  blocked: (userId: string) => Promise<void>;
  log: (r: Pick<LogRecord, "op" | "kind" | "count" | "status">) => void;
  now: () => Temporal.Instant;
};

export const BLOCKED_KEY = "teams_blocked";

// ---- Pacing ----

/** Teams refused to deliver: the person blocked or removed the app (403 MessageWritesBlocked). */
export class Blocked extends Error {}

const statusOf = (e: unknown): number | null => {
  const r = (e as { response?: { status?: unknown }; status?: unknown; statusCode?: unknown } | null) ?? null;
  const s = r?.response?.status ?? r?.status ?? r?.statusCode;
  return typeof s === "number" ? s : null;
};
const retryAfterMs = (e: unknown): number | null => {
  const h = (e as { response?: { headers?: Record<string, unknown> } } | null)?.response?.headers;
  const v = h?.["retry-after"] ?? h?.["Retry-After"];
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.min(n * 1000, 60_000) : null;
};
const isBlocked = (e: unknown) => {
  if (statusOf(e) !== 403) return false;
  let body = "";
  try {
    body = JSON.stringify((e as { response?: { data?: unknown } }).response?.data ?? "");
  } catch {
    body = "";
  }
  return /MessageWritesBlocked|ConversationBlockedByUser|BotDisabledByAdmin/i.test(body);
};
const RETRY = new Set([429, 412, 502, 504]);

/**
 * Microsoft's limits (learn.microsoft.com/microsoftteams/platform/bots/how-to/rate-limit, checked Nov 5): 7 sends a
 * second per chat, 50 requests a second per app per tenant. FocusTime paces itself to 10 a second for all its own
 * messages, and retries 429, 412, 502 and 504 three times with exponential backoff and jitter (2 to 20 s, or
 * Retry-After). A 403 MessageWritesBlocked is thrown as Blocked.
 */
export function pacedSender(inner: Sender, o: { perSecond?: number; retries?: number; sleep?: (ms: number) => Promise<void>; random?: () => number } = {}): Sender {
  const gap = 1000 / (o.perSecond ?? 10);
  const retries = o.retries ?? 3;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((ok) => setTimeout(ok, ms)));
  const random = o.random ?? Math.random;
  let next = 0;
  const slot = async () => {
    const t = Date.now();
    const at = Math.max(t, next);
    next = at + gap;
    if (at > t) await sleep(at - t);
  };
  const tried = async <T,>(f: () => Promise<T>): Promise<T> => {
    for (let i = 0; ; i++) {
      await slot();
      try {
        return await f();
      } catch (e) {
        if (isBlocked(e)) throw new Blocked("blocked");
        const s = statusOf(e);
        if (s === null || !RETRY.has(s) || i >= retries) throw e;
        const base = Math.min(20_000, 2_000 * 2 ** i);
        await sleep(retryAfterMs(e) ?? Math.round(base * (0.8 + 0.4 * random())));
      }
    }
  };
  return {
    send: (to, a) => tried(() => inner.send(to, a)),
    update: (to, id, a) => tried(() => inner.update(to, id, a)),
  };
}

// ---- The engine ----

const dayLabel = (d: string) => Temporal.PlainDate.from(d).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" });
const HALF_WORDS: Record<string, string> = { AM: "Morning", PM: "Afternoon", EVE: "Evening" };
const hm = (iso: string, tz: string) => Temporal.Instant.from(iso).toZonedDateTimeISO(tz).toPlainTime().toString({ smallestUnit: "minute" });
const mondayOf = (d: string) => {
  const p = Temporal.PlainDate.from(d);
  return p.subtract({ days: p.dayOfWeek - 1 }).toString();
};
const rowOf = (p: PlanPick, name: (k: string) => string): PickRow => ({ id: p.id, title: p.title.slice(0, 200), client: name(p.clientKey), state: p.status === "done" ? "done" : p.status === "moved" ? "moved" : "open", note: p.status === "moved" ? "moved" : null });
const isMeeting = (s: Slot) => s.events.filter((e) => !e.event.isPersonal && e.event.source === "outlook" && !e.event.notMeeting && !e.event.allDay);

/** Where an unfinished pick may go: each one's next block, then the next few half-days with hours (not PTO, not ended). */
function destinationsOf(days: readonly Day[], now: Temporal.Instant, today: string): Choice[] {
  const out: Choice[] = [{ value: "next", label: "Each one's next block" }];
  for (const d of days) {
    if (d.kind !== "work" || d.pto || d.date < today) continue;
    for (const half of ["AM", "PM"] as const) {
      const s = half === "AM" ? d.am : d.pm;
      if (s.off || !s.windows.length || (d.ptoHalf && (d.ptoHalf as { half?: string }).half === half) || Temporal.Instant.compare(Temporal.Instant.from(s.end), now) <= 0) continue;
      const when = d.date === today ? (half === "AM" ? "This morning" : "This afternoon") : `${dayLabel(d.date)} ${half === "AM" ? "morning" : "afternoon"}`;
      out.push({ value: `${d.date}:${half}`, label: `${when}${s.focus[0]?.clientName ? ` (${s.focus[0].clientName})` : ""}` });
      if (out.length >= 6) return out;
    }
  }
  return out;
}

type Inbox = { promises: NudgeFacts["promises"]; sends: NudgeFacts["sends"] };

export function createRhythm(d: RhythmDeps) {
  const lastNudgeCheck = new Map<string, number>();
  const lastStatusCheck = new Map<string, number>();
  const lastMeetingsCheck = new Map<string, number>();
  const lastSweep = new Map<string, number>();
  const log = d.log;

  const address = async (userId: string): Promise<Address | null> => {
    const c = await d.botStore(userId).chat().catch(() => null);
    return c && !c.removedAt ? { conversationId: c.conversationId, serviceUrl: c.serviceUrl } : null;
  };
  const dataOf = <T,>(r: ActionResponse): T | null => (r.ok ? (r.data as T) : null);
  const week = async (userId: string, date: string) => dataOf<WeekLoadData>(await d.run(userId, "week.load", { weekStart: mondayOf(date) }));
  const names = (w: WeekLoadData) => {
    const m = new Map(w.planClients.map((c) => [c.clientKey, c.clientName]));
    return (k: string) => m.get(k) ?? k;
  };
  const picksOn = (w: WeekLoadData, date: string) => (w.plan?.[date]?.picks ?? []).filter((p) => p.status === "planned" || p.status === "done" || p.status === "moved");

  /**
   * Promises and sends to me. IB-1's read model (inbox.list `items`: key, kind, clientKey, at, title, who, due, done,
   * sendState) once its items carry titles; until then (slice 1 has no titles) the week's own lists (follow-ups and
   * chat promises on week.load, sends from team.commit).
   */
  async function inbox(userId: string, w: WeekLoadData | null, today: string): Promise<Inbox> {
    type Item = { key: string; kind: string; clientKey: string | null; at: string; title?: string | null; who?: string | null; due?: string | null; done?: boolean; sendState?: string };
    const r = dataOf<{ items?: Item[] }>(await d.run(userId, "inbox.list", {}).catch(() => ({ ok: false, error: "", status: 500 }) as ActionResponse));
    const name = w ? names(w) : (k: string) => k;
    const mine = (r?.items ?? []).filter((x) => x.kind === "promise" || x.kind === "send");
    if (mine.length && mine.every((x) => typeof x.title === "string" && x.title)) {
      return {
        promises: mine.filter((x) => x.kind === "promise").map((x) => ({ key: x.key, title: x.title!, clientName: x.clientKey ? name(x.clientKey) : null, due: x.due ?? null, done: !!x.done })),
        sends: mine.filter((x) => x.kind === "send").map((x) => ({ key: x.key, title: x.title!, clientName: x.clientKey ? name(x.clientKey) : null, waiting: x.sendState === "waiting" && !x.done, at: x.at, from: x.who ?? null })),
      };
    }
    const promises: Inbox["promises"][number][] = [];
    for (const f of w?.followUps ?? []) promises.push({ key: `f${f.id}`, title: f.what, clientName: f.clientKey ? name(f.clientKey) : null, due: f.due, done: false });
    for (const p of w?.promises ?? []) promises.push({ key: `c${p.id}`, title: p.what, clientName: p.clientName, due: p.dueDate, done: false });
    const sends: Inbox["sends"][number][] = [];
    const c = dataOf<{ clients: { clientKey: string; incoming: { id: number; title: string; state: string; createdAt?: string; updatedAt?: string; from: { name: string } }[] }[] }>(await d.run(userId, "team.commit", { weekStart: mondayOf(today) }).catch(() => ({ ok: false, error: "", status: 500 }) as ActionResponse));
    for (const k of c?.clients ?? []) for (const s of k.incoming ?? []) sends.push({ key: `s${s.id}`, title: s.title, clientName: name(k.clientKey), waiting: s.state === "sent", at: s.createdAt ?? s.updatedAt ?? d.now().toString(), from: s.from?.name ?? null });
    return { promises, sends };
  }

  // ---- Models ----

  async function briefModel(userId: string, occasion: string, date: string, test: boolean): Promise<BriefModel | null> {
    const w = await week(userId, date);
    if (!w) return null;
    const tz = userZone(w);
    const name = names(w);
    const day = w.week.days.find((x) => x.date === date) ?? null;
    const picks = picksOn(w, date);
    const blocks: BriefModel["blocks"] = [];
    for (const [half, s] of (day ? ([["AM", day.am], ["PM", day.pm], ["EVE", day.eve]] as const) : []) as readonly (readonly [string, Slot | null])[]) {
      if (!s || s.off || !s.windows.length) continue;
      const mine = picks.filter((p) => p.half === half).sort((a, b) => a.position - b.position).map((p) => rowOf(p, name));
      const meetings = isMeeting(s).map((e) => `${hm(e.clipStart, tz)} ${e.event.title.slice(0, 80)}`);
      const client = s.focus[0]?.clientName ?? null;
      if (!client && !mine.length && !meetings.length) continue;
      blocks.push({ label: `${HALF_WORDS[half]} ${hm(s.windows[0]!.start, tz)}–${hm(s.windows.at(-1)!.end, tz)}`, client, meetings, picks: mine });
    }
    const ib = await inbox(userId, w, date);
    return {
      kind: "brief",
      occasion,
      date,
      dateLabel: dayLabel(date),
      test,
      blocks: blocks.slice(0, 3),
      more: Math.max(0, blocks.length - 3),
      promises: ib.promises.filter((p) => !p.done && p.due !== null && p.due <= date).map((p) => `${p.title}${p.clientName ? ` (${p.clientName})` : ""}${p.due! < date ? ", overdue" : ""}`),
      sends: ib.sends.filter((s) => s.waiting).map((s) => `${s.title}${s.clientName ? ` (${s.clientName})` : ""}${s.from ? `, from ${s.from}` : ""}`),
      committed: !!w.plan?.[date]?.committedAt,
      destinations: destinationsOf(w.week.days, d.now(), date),
    };
  }

  /** TX-1: what the moment's check-in asks about (nothing when nothing qualifies: then the card has no such section). */
  async function sessionCards(userId: string, date: string, moment: "midday" | "end"): Promise<SessionCard[]> {
    const rows = dataOf<{ rows: SessionView[] }>(await d.run(userId, "checkin.sessions", { date, moment }))?.rows ?? [];
    return rows.map((r) => ({ pickId: r.pickId, title: r.title.slice(0, 200), client: r.clientName, minutes: r.minutes, state: "open" }));
  }

  async function checkinModel(userId: string, occasion: string, date: string, test: boolean): Promise<CheckinModel | null> {
    const w = await week(userId, date);
    if (!w) return null;
    const name = names(w);
    const picks = picksOn(w, date).filter((p) => p.half === "AM" && p.status !== "moved").sort((a, b) => a.position - b.position).map((p) => rowOf(p, name));
    return { kind: "checkin", occasion, date, dateLabel: dayLabel(date), test, picks, destinations: destinationsOf(w.week.days, d.now(), date), sessions: test ? [] : await sessionCards(userId, date, "midday") };
  }

  async function closeoutModel(userId: string, occasion: string, date: string, test: boolean): Promise<CloseoutModel | null> {
    const w = await week(userId, date);
    if (!w) return null;
    const name = names(w);
    const order = ["AM", "PM", "EVE"];
    const picks = picksOn(w, date).filter((p) => p.status !== "moved").sort((a, b) => order.indexOf(a.half) - order.indexOf(b.half) || a.position - b.position).map((p) => rowOf(p, name));
    const plan = await d.plan(userId);
    return { kind: "closeout", occasion, date, dateLabel: dayLabel(date), test, picks, closed: !!(await plan?.day(date))?.closedOutAt, sessions: test ? [] : await sessionCards(userId, date, "end") };
  }

  const modelFor = (kind: RhythmKind, userId: string, occasion: string, date: string, test: boolean) => (kind === "brief" ? briefModel(userId, occasion, date, test) : kind === "checkin" ? checkinModel(userId, occasion, date, test) : closeoutModel(userId, occasion, date, test));

  async function nudgeFacts(userId: string, c: AppConfig): Promise<NudgeFacts> {
    const tz = userZone(c);
    const now = d.now();
    const today = now.toZonedDateTimeISO(tz).toPlainDate().toString();
    const w = await week(userId, today);
    const ib = await inbox(userId, w, today);
    const end = dayEndOf(c.week.hours, today);
    const dayEnd = end ? Temporal.PlainDate.from(today).toZonedDateTime({ timeZone: tz, plainTime: end === "24:00" ? "23:59" : end }).toInstant() : null;
    return { now, today, dayEnd, promises: ib.promises, sends: ib.sends, takeovers: await d.takeovers(userId, now.subtract({ hours: 24 }).toString()).catch(() => []) };
  }

  // ---- Sending ----

  /** Sends a claimed occasion's card; true when Teams took it. */
  async function deliver(userId: string, to: Address, model: RhythmModel, kind: string): Promise<boolean> {
    const store = d.store(userId);
    try {
      const r = await d.sender.send(to, { type: "message", attachments: [attach(rhythmCard(model, d.publicUrl))] });
      await store.sent(model.occasion, r.id, model);
      log({ op: "rhythm", kind: `${kind}_sent` });
      return true;
    } catch (e) {
      await store.settle(model.occasion, "failed").catch(() => undefined);
      if (e instanceof Blocked) {
        log({ op: "rhythm", kind: "blocked", status: 403 });
        await d.blocked(userId).catch(() => log({ op: "rhythm", kind: "blocked_not_saved" }));
      } else log({ op: "rhythm", kind: `${kind}_failed`, ...(statusOf(e) ? { status: statusOf(e)! } : {}) });
      return false;
    }
  }

  /** One person's pass: the rhythm kinds due now, then nudges (at most every 10 minutes, one card an hour). */
  async function tick(userId: string, f: PassFacts): Promise<void> {
    const c = f.config;
    if (!c.notify.teamsMessages) return;
    const s = c.notify.teams;
    if (!s.brief && !s.checkin && !s.closeout && !s.nudges && !s.status && !s.meetings) return;
    const to = await address(userId);
    if (!to) return;
    const store = d.store(userId);
    const t = d.now();
    if ((lastSweep.get(userId) ?? 0) < t.epochMilliseconds - 3600_000) {
      lastSweep.set(userId, t.epochMilliseconds);
      const sw = await store.sweep().catch(() => ({ lost: 0, removed: 0 }));
      if (sw.lost) log({ op: "rhythm", kind: "lost", count: sw.lost });
    }
    const tz = userZone(c);
    const now = t.toZonedDateTimeISO(tz);
    const quietNow = c.notify.quiet === "outside_hours" && !f.inHours;
    const sent = await store.occasions(t.subtract({ hours: 24 * 9 }).toString());
    const due = rhythmDue({ now, model: c.week.hours, master: true, settings: s, quietNow, pto: f.pto, focusRunning: f.focusRunning }, sent);
    for (const wtg of due.waiting) log({ op: "rhythm", kind: `${wtg.kind}_waits_${wtg.why}` });
    for (const x of due.due) {
      if (!(await store.claim(x.occasion, x.kind))) continue;
      const model = await modelFor(x.kind, userId, x.occasion, x.date, false).catch(() => null);
      if (!model) {
        await store.settle(x.occasion, "failed");
        log({ op: "rhythm", kind: `${x.kind}_unavailable` });
        continue;
      }
      if (model.kind === "checkin" && !model.picks.some((p) => p.state !== "done") && !model.sessions?.length) {
        // Nothing to tick: everything this morning is done, or nothing was planned.
        await store.settle(x.occasion, "skipped");
        log({ op: "rhythm", kind: "checkin_skipped" });
        continue;
      }
      if (!(await deliver(userId, to, model, x.kind))) return;
    }
    if (s.status && !f.focusRunning) await statusTick(userId, to, c, f, now, sent);
    if (s.meetings && !f.focusRunning && !quietNow && rhythmDay(now.toPlainDate().toString(), { ...s, friday: true }, f.pto)) await meetingsTick(userId, to, t);
    if (!s.nudges || !rhythmDay(now.toPlainDate().toString(), s, f.pto) || quietNow || f.focusRunning) return;
    if ((lastNudgeCheck.get(userId) ?? 0) > t.epochMilliseconds - NUDGE_CHECK_MINUTES * 60_000) return;
    lastNudgeCheck.set(userId, t.epochMilliseconds);
    if (!nudgeAllowed(await store.lastSent("nudges"), t)) return;
    const fresh = nudges(await nudgeFacts(userId, c)).filter((n) => !sent.has(`nudge:${n.key}`));
    if (!fresh.length) return;
    await sendNudges(userId, to, fresh, nudgeOccasion(t));
  }

  /** SR-1: Monday's status report as a model: the features with no update yet, by client; null when unreadable. */
  async function statusModel(userId: string, occasion: string, test: boolean): Promise<StatusModel | null> {
    const l = dataOf<StatusLoad>(await d.run(userId, "status.load", {}).catch(() => ({ ok: false, error: "", status: 500 }) as ActionResponse));
    const w = l ? withoutUpdate(l) : null;
    if (!l || !w) return null;
    const MAX_ROWS = 8;
    let left = MAX_ROWS;
    const clients = w.clients.map((c) => {
      const features = c.features.slice(0, Math.max(0, left));
      left -= features.length;
      return { name: c.name, features };
    }).filter((c) => c.features.length);
    return { kind: "status", occasion, test, line: w.without ? nudgeLineFor(w.needsYou, w.rest) : "Every feature has an update for Monday's report", needsYou: w.needsYou, reportLabel: l.title.replace(/^Status report · /, ""), clients, more: Math.max(0, w.without - MAX_ROWS) };
  }

  /**
   * SR-1: Friday afternoon (and Sunday evening when turned on), once per occasion, when some feature has no update
   * yet. Its own times keep it out of quiet hours; never on a PTO day or during focus (it waits). Status is read at
   * most every 30 minutes inside the window; nothing to say settles the day's occasion as skipped.
   */
  async function statusTick(userId: string, to: Address, c: AppConfig, f: PassFacts, now: Temporal.ZonedDateTime, sent: ReadonlySet<string>): Promise<void> {
    const date = now.toPlainDate().toString();
    const due = statusNudgeDue({ localDate: date, localTime: now.toPlainTime().toString({ smallestUnit: "minute" }), s: { ...c.notify.status, friday: true }, dayEnd: dayEndOf(c.week.hours, date), pto: f.pto, without: 1 });
    if (!due || sent.has(due.occasion)) return;
    const t = now.epochMilliseconds;
    if ((lastStatusCheck.get(userId) ?? 0) > t - 30 * 60_000) return;
    lastStatusCheck.set(userId, t);
    const model = await statusModel(userId, due.occasion, false).catch(() => null);
    if (!model) return void log({ op: "rhythm", kind: "status_unavailable" });
    const store = d.store(userId);
    if (!(await store.claim(due.occasion, "status"))) return;
    if (!model.clients.length) {
      await store.settle(due.occasion, "skipped");
      return void log({ op: "rhythm", kind: "status_skipped" });
    }
    await deliver(userId, to, model, "status");
  }

  /** MC-1: the calls I review with something new, from meeting.mine (the same nudges as the app's), each with its key. */
  async function meetingNudges(userId: string): Promise<{ key: string; item: MeetingsModel["items"][number] }[] | null> {
    const r = await d.run(userId, "meeting.mine", {}).catch(() => null);
    if (!r?.ok) return null;
    const nudges = (r.data as { nudges: { key: string; kind: "review" | "upload"; occurrenceId: number; clientName: string; meeting: string; dateLabel: string }[] }).nudges;
    return nudges.map((n) => ({ key: n.key, item: { clientName: n.clientName, meeting: n.meeting, dateLabel: n.dateLabel, upload: n.kind === "upload", route: `#/meetings/${n.occurrenceId}` } }));
  }

  /**
   * MC-1: client calls to review, at most every 15 minutes, inside working hours, never during focus or on a PTO
   * day; each occurrence's nudge (review or upload) is claimed once, so a card never repeats one.
   */
  async function meetingsTick(userId: string, to: Address, t: Temporal.Instant): Promise<void> {
    if ((lastMeetingsCheck.get(userId) ?? 0) > t.epochMilliseconds - 15 * 60_000) return;
    lastMeetingsCheck.set(userId, t.epochMilliseconds);
    const found = await meetingNudges(userId).catch(() => null);
    if (!found?.length) return;
    const store = d.store(userId);
    const items: MeetingsModel["items"] = [];
    for (const n of found) if (await store.claim(`mtg:${n.key}`.slice(0, 120), "meeting_item")) items.push(n.item);
    if (!items.length) return;
    const occasion = `meetings:${t.epochMilliseconds}`;
    if (!(await store.claim(occasion, "meetings"))) return;
    await deliver(userId, to, { kind: "meetings", occasion, items }, "meetings");
  }

  async function sendNudges(userId: string, to: Address, fresh: readonly Nudge[], occasion: string): Promise<void> {
    const store = d.store(userId);
    if (!(await store.claim(occasion, "nudges"))) return;
    const items: Nudge[] = [];
    for (const n of fresh) {
      if (items.length >= NUDGE_MAX) break;
      if (await store.claim(`nudge:${n.key}`.slice(0, 120), "nudge_item")) items.push(n);
    }
    if (!items.length) return void (await store.settle(occasion, "skipped"));
    const model: NudgeModel = { kind: "nudges", occasion, items };
    await deliver(userId, to, model, "nudges");
    log({ op: "rhythm", kind: "nudge_items", count: items.length });
  }

  /** The next moment this person's rhythm could be due (A3's idle rule), or null. */
  async function wake(userId: string, c: AppConfig | null): Promise<Temporal.Instant | null> {
    if (!c?.notify.teamsMessages) return null;
    const s = c.notify.teams;
    if (!s.brief && !s.checkin && !s.closeout && !s.nudges && !s.status && !s.meetings) return null;
    const t = d.now();
    const sent = await d.store(userId).occasions(t.subtract({ hours: 24 * 9 }).toString()).catch(() => new Set<string>());
    const st = s.status ? nextStatusNudge(t.toZonedDateTimeISO(userZone(c)), { ...c.notify.status, friday: true }, (x) => dayEndOf(c.week.hours, x), (o) => sent.has(o)) : null;
    const w = nextRhythmWake({ now: t.toZonedDateTimeISO(userZone(c)), model: c.week.hours, master: true, settings: s }, sent, (s.nudges || s.meetings) && hoursOn(c.week.hours, t.toZonedDateTimeISO(userZone(c)).toPlainDate().toString()).segments.length ? NUDGE_CHECK_MINUTES : null);
    return st && (!w || Temporal.Instant.compare(st, w) < 0) ? st : w;
  }

  // ---- Taps ----

  const answer = (c: Card): InvokeBody => ({ statusCode: 200, type: CARD_TYPE, value: c });
  const inline = (p: Proposal, message?: string | null): InlineProposal => ({ proposalId: p.id, title: p.title, whoSees: p.whoSees, changes: [...p.changes], note: p.note ?? null, expiresAt: p.expiresAt, state: "open", message: message ?? null });

  /** After a confirm: the picks', the day's and the plan's state as the store has them now. */
  async function refreshed<M extends RhythmModel>(userId: string, m: M): Promise<M> {
    if (m.kind === "nudges" || m.kind === "status" || m.kind === "meetings") return m;
    const plan = await d.plan(userId);
    if (!plan) return m;
    const fix = async (rows: PickRow[]) =>
      Promise.all(
        rows.map(async (r) => {
          const p = await plan.getPick(r.id).catch(() => null);
          if (!p) return r;
          if (p.status === "done") return { ...r, state: "done" as const };
          if (p.status === "moved") return { ...r, state: "moved" as const, note: p.carriedTo ? `moved to ${dayLabel(p.carriedTo.date)} ${p.carriedTo.half}` : p.date !== m.date ? `moved to ${dayLabel(p.date)} ${p.half}` : "moved" };
          if (p.status === "dropped") return { ...r, state: "moved" as const, note: "dropped" };
          if (p.date !== m.date) return { ...r, state: "moved" as const, note: `moved to ${dayLabel(p.date)} ${p.half}` };
          return { ...r, state: r.state === "not_yet" ? ("not_yet" as const) : ("open" as const) };
        }),
      );
    const day = await plan.day(m.date).catch(() => null);
    if (m.kind === "brief") return { ...m, blocks: await Promise.all(m.blocks.map(async (b) => ({ ...b, picks: await fix(b.picks) }))), committed: !!day?.committedAt } as M;
    if (m.kind === "checkin") return { ...m, picks: await fix(m.picks) } as M;
    return { ...m, picks: await fix(m.picks), closed: !!day?.closedOutAt } as M;
  }

  async function propose(userId: string, m: Exclude<RhythmModel, NudgeModel | StatusModel | MeetingsModel>, tool: Parameters<AssistantService["propose"]>[0]["tool"], args: Record<string, unknown>): Promise<Exclude<RhythmModel, NudgeModel | StatusModel | MeetingsModel>> {
    if (!d.assistant) return { ...m, notice: "That isn't available right now. Open FocusTime to do it there." };
    const r = await d.assistant.propose({ person: { userId }, tool, args });
    if (!r.ok) return { ...m, notice: r.message, proposal: null };
    // The proposal's row in the bot's card table: Confirm claims it, so a double tap runs it once.
    const row = await d.store(userId).get(m.occasion);
    await d.botStore(userId).cardSent(r.proposal.id, row?.activityId ?? null, r.proposal.expiresAt, r.proposal.title);
    return { ...m, notice: null, proposal: inline(r.proposal) };
  }

  /** PK-1: the DevOps follow-up to a Done or Undo tap, through propose(); quiet when there's nothing to offer. */
  async function offerDevOps(userId: string, m: Exclude<RhythmModel, NudgeModel | StatusModel | MeetingsModel>, tool: "item_done" | "item_undo", pickId: number): Promise<Exclude<RhythmModel, NudgeModel | StatusModel | MeetingsModel>> {
    const c = await d.config(userId).catch(() => null);
    if (!d.assistant || (tool === "item_done" && c?.plan.devopsOnDone === "never")) return m;
    const r = await d.assistant.propose({ person: { userId }, tool, args: tool === "item_done" ? { pickId, state: null } : { pickId } });
    if (!r.ok) return m;
    const row = await d.store(userId).get(m.occasion);
    await d.botStore(userId).cardSent(r.proposal.id, row?.activityId ?? null, r.proposal.expiresAt, r.proposal.title);
    log({ op: "rhythm_tap", kind: tool });
    return { ...m, notice: null, proposal: inline(r.proposal) };
  }

  /** Where "moveTo" sends a pick: a half-day, or the pick's client's next block after today (UI-B's rule). */
  async function target(userId: string, m: { date: string }, pick: { clientKey: string }, moveTo: string): Promise<{ date: string; half: "AM" | "PM" } | null> {
    const hit = /^(\d{4}-\d{2}-\d{2}):(AM|PM)$/.exec(moveTo);
    if (hit) return { date: hit[1]!, half: hit[2] as "AM" | "PM" };
    if (moveTo !== "next") return null;
    const w = await week(userId, m.date);
    return w ? nextBlockFor(w.week.days.filter((x) => x.date > m.date), pick.clientKey, d.now().toString()) : null;
  }

  async function confirmInline(userId: string, m: Exclude<RhythmModel, NudgeModel | StatusModel | MeetingsModel>, proposalId: string): Promise<Exclude<RhythmModel, NudgeModel | StatusModel | MeetingsModel>> {
    const p = m.proposal;
    if (!p || p.proposalId !== proposalId || p.state !== "open" || !d.assistant) return m;
    const bot = d.botStore(userId);
    if (!(await bot.claim(proposalId))) return m;
    let r: ConfirmResult;
    try {
      r = await d.assistant.confirm({ person: { userId }, proposalId });
    } catch {
      r = { status: "not_allowed", message: "Something went wrong. Check FocusTime before trying again." };
    }
    if (r.status === "changed") {
      // TB-3: the service keeps the proposal's id for its new preview, so its row opens again for the next tap.
      await bot.reopen(proposalId);
      await bot.cardSent(r.proposal.id, null, r.proposal.expiresAt, r.proposal.title);
      log({ op: "rhythm_tap", kind: "changed" });
      return { ...(await refreshed(userId, m)), proposal: inline(r.proposal, r.message) };
    }
    const state = r.status === "ok" ? "done" : r.status === "expired" ? "expired" : "failed";
    await bot.settle(proposalId, state, null);
    log({ op: "rhythm_tap", kind: state });
    return { ...(await refreshed(userId, m)), proposal: { ...p, state, message: r.message } };
  }

  async function tapRhythm(userId: string, t: RhythmTap): Promise<{ model: RhythmModel | null; card: Card | null }> {
    const store = d.store(userId);
    const row = await store.get(t.occasion);
    if (!row?.model) return { model: null, card: null };
    let m = row.model as RhythmModel;
    if (m.kind === "nudges" || m.kind === "status" || m.kind === "meetings") return { model: m, card: rhythmCard(m, d.publicUrl) };
    const allPicks = m.kind === "brief" ? m.blocks.flatMap((b) => b.picks) : m.picks;
    const onCard = (id: number | undefined) => (id ? allPicks.find((p) => p.id === id) : undefined);
    const setPick = (id: number, state: PickRow["state"]) => {
      const f = (r: PickRow) => (r.id === id ? { ...r, state } : r);
      m = m.kind === "brief" ? { ...m, blocks: m.blocks.map((b) => ({ ...b, picks: b.picks.map(f) })) } : ({ ...m, picks: (m as CheckinModel | CloseoutModel).picks.map(f) } as typeof m);
    };
    switch (t.op) {
      case "done":
      case "undone": {
        const p = onCard(t.pickId);
        if (!p) break;
        // The app's own button: pick.mark_done (local, with undo: Undo here is mark_done false).
        const r = await d.run(userId, "pick.mark_done", { id: p.id, done: t.op === "done" });
        if (r.ok) setPick(p.id, t.op === "done" ? "done" : "open");
        m = { ...m, notice: r.ok ? ((r.data as { notice?: string | null }).notice ?? null) : r.error };
        log({ op: "rhythm_tap", kind: r.ok ? t.op : `${t.op}_refused` });
        // PK-1: on a check-in or close out card, Done offers the item's DevOps done state and Undo that write's undo,
        // as a proposal in the card (only when none is open there; nothing to offer leaves the card as it is).
        if (r.ok && m.kind !== "brief" && m.proposal?.state !== "open") m = await offerDevOps(userId, m, t.op === "done" ? "item_done" : "item_undo", p.id);
        break;
      }
      case "session_done":
      case "session_partly":
      case "session_left":
      case "session_none":
      case "session_back":
      case "session_undo":
      case "session_all":
        if (m.kind === "checkin" || m.kind === "closeout") m = await sessionTap(userId, m, t);
        break;
      case "not_yet": {
        const p = onCard(t.pickId);
        if (p) setPick(p.id, "not_yet");
        break;
      }
      case "confirm_today":
        if (m.kind === "brief") m = await propose(userId, m, "confirm_day", { date: m.date });
        break;
      case "move": {
        const p = onCard(Number(t.movePick));
        const plan = await d.plan(userId);
        const full = p ? await plan?.getPick(p.id).catch(() => null) : null;
        const to = full && t.moveTo ? await target(userId, m, full, t.moveTo) : null;
        m = !full ? { ...m, notice: "Choose a to-do to move" } : !to ? { ...m, notice: "There's no block left for it this week. Choose a day." } : await propose(userId, m, "move_pick", { pickId: full.id, date: to.date, half: to.half });
        break;
      }
      case "move_rest": {
        const plan = await d.plan(userId);
        const moves: { pickId: number; date: string; half: string }[] = [];
        let none = 0;
        for (const r of allPicks.filter((x) => x.state === "open" || x.state === "not_yet")) {
          const full = await plan?.getPick(r.id).catch(() => null);
          if (!full || full.status !== "planned") continue;
          const to = t.moveTo ? await target(userId, m, full, t.moveTo) : null;
          if (to) moves.push({ pickId: full.id, ...to });
          else none++;
        }
        m = moves.length ? await propose(userId, m, "move_picks", { moves }) : { ...m, notice: none ? "There's no block left this week for those. Choose a day." : "Nothing left to move" };
        if (moves.length && none) m = { ...m, notice: `${none} ha${none === 1 ? "s" : "ve"} no block left this week and stay${none === 1 ? "s" : ""} where ${none === 1 ? "it is" : "they are"}.` };
        break;
      }
      case "close_out":
        if (m.kind === "closeout") m = await propose(userId, m, "close_day", { date: m.date, donePickIds: [] });
        break;
      case "closeout_text":
        if (m.kind === "closeout") m = await closeoutFromWords(userId, m, t.closeoutText ?? "");
        break;
      case "confirm":
        if (t.proposalId) m = await confirmInline(userId, m, t.proposalId);
        break;
      case "cancel":
        if (t.proposalId && m.proposal?.proposalId === t.proposalId && m.proposal.state === "open") {
          await d.assistant?.cancel({ person: { userId }, proposalId: t.proposalId }).catch(() => undefined);
          if (await d.botStore(userId).claim(t.proposalId)) await d.botStore(userId).settle(t.proposalId, "cancelled", null);
          m = { ...m, proposal: { ...m.proposal, state: "cancelled" } };
        }
        break;
    }
    await store.setModel(t.occasion, m);
    if (t.op !== "done" && t.op !== "undone") log({ op: "rhythm_tap", kind: t.op });
    return { model: m, card: rhythmCard(m, d.publicUrl) };
  }

  /** TX-1: a check-in answer from the card: the app's own actions, at once, with Undo. Done offers the DevOps state as Done does. */
  async function sessionTap(userId: string, m0: CheckinModel | CloseoutModel, t: RhythmTap): Promise<CheckinModel | CloseoutModel> {
    let m = m0;
    const moment = m.kind === "checkin" ? "midday" : "end";
    const rows = m.sessions ?? [];
    const row = rows.find((r) => r.pickId === t.pickId);
    const put = (pickId: number, f: (r: SessionCard) => SessionCard) => (m = { ...m, sessions: (m.sessions ?? []).map((r) => (r.pickId === pickId ? f(r) : r)) } as typeof m);
    const setPicks = (ids: readonly number[], state: PickRow["state"]) => (m = { ...m, picks: m.picks.map((p) => (ids.includes(p.id) ? { ...p, state } : p)) } as typeof m);
    const answer = async (answer: "done" | "partly" | "none", left?: number) => {
      if (!row) return;
      const r = await d.run(userId, "checkin.answer", { date: m.date, moment, pickId: row.pickId, answer, ...(left ? { left } : {}) });
      if (!r.ok) {
        m = { ...m, notice: r.error };
        return;
      }
      const { timeboxIds: ids, notice } = r.data as { timeboxIds: number[]; notice: string | null };
      put(row.pickId, (x) => ({ ...x, state: answer, undoIds: ids, note: answer === "done" ? (notice ? `done · ${notice}` : "done") : answer === "partly" ? `${durationText(left!)} left` : "back to not timeboxed" }));
      m = { ...m, notice: null };
      if (answer === "done") {
        setPicks([row.pickId], "done");
        if (m.proposal?.state !== "open") m = (await offerDevOps(userId, m, "item_done", row.pickId)) as typeof m;
      }
    };
    switch (t.op) {
      case "session_done":
        await answer("done");
        break;
      case "session_partly":
        if (row) put(row.pickId, (x) => ({ ...x, state: "asking" }));
        break;
      case "session_back":
        if (row) put(row.pickId, (x) => ({ ...x, state: "open" }));
        break;
      case "session_left": {
        const left = t.left ?? (t.sessionLeft ? parseLeft(t.sessionLeft) : null);
        if (left && validLeft(left)) await answer("partly", left);
        else m = { ...m, notice: "Type the time left like 45m or 2.5h" };
        break;
      }
      case "session_none":
        await answer("none");
        break;
      case "session_undo": {
        if (!row?.undoIds?.length) break;
        const r = await d.run(userId, "checkin.undo", { timeboxIds: row.undoIds });
        m = { ...m, notice: r.ok ? null : r.error };
        if (r.ok) {
          const wasDone = row.state === "done";
          put(row.pickId, (x) => ({ ...x, state: "open", note: null, undoIds: [] }));
          if (wasDone) {
            setPicks([row.pickId], "open");
            // TX-1b: the DevOps change a Done made is offered back, like the plain row's Undo. A change still waiting on the card is the person's to confirm or cancel.
            if (m.proposal?.state === "open") m = { ...m, notice: "This Undo doesn't change DevOps. Confirm or cancel the change above." };
            else m = (await offerDevOps(userId, m, "item_undo", row.pickId)) as typeof m;
          }
        }
        break;
      }
      case "session_all": {
        const r = await d.run(userId, "checkin.all_to_plan", { date: m.date, moment });
        if (!r.ok) {
          m = { ...m, notice: `${r.error}. Nothing was changed. Tap All went to plan to try again.` };
          break;
        }
        const data = r.data as { applied: AppliedSession[]; done: number[] };
        // TX-1b: the server read the rows afresh. One answered elsewhere leaves the card; one that ended since joins it.
        const had = m.sessions ?? [];
        const applied = new Set(data.applied.map((a) => a.pickId));
        m = { ...m, sessions: [...had.filter((q) => (q.state !== "open" && q.state !== "asking") || applied.has(q.pickId)), ...data.applied.filter((a) => !had.some((q) => q.pickId === a.pickId)).map((a): SessionCard => ({ pickId: a.pickId, title: a.title.slice(0, 200), client: a.clientName, minutes: a.minutes, state: "open" }))] } as typeof m;
        for (const a of data.applied) put(a.pickId, (q) => ({ ...q, state: a.as === "done" ? "done" : "partly", undoIds: a.timeboxIds, note: a.as === "done" ? (a.notice ? `done · ${a.notice}` : "done") : `${durationText(a.left)} left` }));
        setPicks(data.done, "done");
        m = { ...m, notice: null };
        // TX-1b: PK-1's offer, as a Done on one row makes it. A card holds one proposal, so any others wait for Close out.
        const toOffer = data.applied.filter((a) => a.as === "done" && a.itemId !== null);
        if (toOffer.length && m.proposal?.state !== "open") {
          m = (await offerDevOps(userId, m, "item_done", toOffer[0]!.pickId)) as typeof m;
          if (toOffer.length > 1 && m.proposal?.state === "open") m = { ...m, notice: `${toOffer.length - 1} more to set in DevOps: review ${toOffer.length === 2 ? "it" : "them"} in Close out.` };
        }
        break;
      }
    }
    // End of day, once everything is answered: say what could go to DevOps (the offer itself is previewed in Close out).
    if (m.kind === "closeout" && !(m.sessions ?? []).some((r) => r.state === "open" || r.state === "asking")) {
      const offers = dataOf<{ offers: { mode: string }[] }>(await d.run(userId, "devops.progress_offer", { date: m.date }))?.offers ?? [];
      const remaining = offers.filter((o) => o.mode === "remaining").length;
      m = { ...m, progressOffer: offers.length ? { remaining, comment: offers.length - remaining } : null };
    }
    return m;
  }

  /** Close out in my words: the picks they name (no AI), then one close_day proposal for the whole day. */
  async function closeoutFromWords(userId: string, m: CloseoutModel, words: string): Promise<CloseoutModel> {
    if (!words.trim()) return { ...m, notice: "Tell me what got done, or tick the to-dos above" };
    const ids = doneFromWords(words, plainRows(m));
    const open = new Set(m.picks.filter((p) => p.state !== "done" && p.state !== "moved").map((p) => p.id));
    const next = (await propose(userId, m, "close_day", { date: m.date, donePickIds: ids.filter((id) => open.has(id)) })) as CloseoutModel;
    return ids.length || !next.proposal ? next : { ...next, notice: "I couldn't match that to a to-do, so nothing is marked done. Tick them above, or confirm to move them on." };
  }

  return {
    tick,
    wake,
    /** A card tap of ours (a rhythm card or a capture reply), or null when it isn't one. */
    tapOf: rhythmTapOf,
    async tap(userId: string, t: RhythmTap | CaptureTap): Promise<InvokeBody> {
      if (t.ft === "capture_undo") {
        const r = await d.run(userId, "capture.undo", { id: t.captureId });
        log({ op: "rhythm_tap", kind: r.ok ? "capture_undo" : "capture_undo_refused" });
        return answer(r.ok ? captureCard({ id: t.captureId, text: "", undone: true }, d.publicUrl) : captureCard({ id: t.captureId, text: "", failed: "It was already sorted or removed, so there's nothing to undo." }, d.publicUrl));
      }
      const { card } = await tapRhythm(userId, t);
      return card ? answer(card) : answer(captureCard({ id: 0, text: "", failed: "FocusTime doesn't know this card any more. Open FocusTime to do it there." }, d.publicUrl));
    },
    /** "capture: …": saved as typed (capture.add, no AI), answered with the Undo card. */
    async capture(userId: string, text: string): Promise<{ card: Card }> {
      if (!text) return { card: captureCard({ id: 0, text: "", failed: "Type something after capture:, like \"capture: call Dana about the export\"." }, d.publicUrl) };
      const r = await d.run(userId, "capture.add", { text: text.slice(0, 2000) });
      log({ op: "capture", kind: r.ok ? "saved" : "refused" });
      if (!r.ok) return { card: captureCard({ id: 0, text: "", failed: r.error }, d.publicUrl) };
      const cap = (r.data as { capture: { id: number } }).capture;
      return { card: captureCard({ id: cap.id, text }, d.publicUrl) };
    },
    /**
     * A plain message while today's close out card is open (sent in the last 3 hours, not closed, no proposal open):
     * the close out in my words, drawn into that card in place. Null when no close out is waiting.
     */
    async closeoutReply(userId: string, text: string): Promise<string | null> {
      const c = await d.config(userId);
      if (!c) return null;
      const today = d.now().toZonedDateTimeISO(userZone(c)).toPlainDate().toString();
      const store = d.store(userId);
      const row = await store.get(occasionOf("closeout", today));
      const m = row?.model as CloseoutModel | undefined;
      if (!row || row.state !== "sent" || !m || m.closed || m.proposal?.state === "open" || d.now().since(Temporal.Instant.from(row.createdAt)).total("hours") > 3) return null;
      const next = await closeoutFromWords(userId, m, text);
      await store.setModel(row.occasion, next);
      const to = await address(userId);
      if (to && row.activityId) await d.sender.update(to, row.activityId, { type: "message", attachments: [attach(rhythmCard(next, d.publicUrl))] }).catch(() => log({ op: "rhythm", kind: "update_failed" }));
      log({ op: "rhythm", kind: "closeout_reply" });
      return next.proposal?.state === "open" ? "Here's your close out to confirm, on the Close out card above." : (next.notice ?? "Open FocusTime to close out.");
    },
    /** Settings › Notifications › In Teams › Send me a test now: one of a kind, now, past the switches and the gate. */
    async test(userId: string, kind: TeamsKind): Promise<{ ok: true } | { ok: false; message: string }> {
      const to = await address(userId);
      if (!to) return { ok: false, message: "Message FocusTime in Teams once first, so it knows where to reach you." };
      const c = await d.config(userId);
      if (!c) return { ok: false, message: "Fix your settings first." };
      const t = d.now();
      const today = t.toZonedDateTimeISO(userZone(c)).toPlainDate().toString();
      const occasion = `test:${kind}:${t.epochMilliseconds}`;
      const store = d.store(userId);
      if (!(await store.claim(occasion, `test_${kind}`.slice(0, 20)))) return { ok: false, message: "A test is already on its way." };
      let model: RhythmModel | null;
      if (kind === "nudges") {
        const items = nudges(await nudgeFacts(userId, c)).slice(0, NUDGE_MAX);
        model = { kind: "nudges", occasion, test: true, items: items.length ? items : [{ key: "sample", kind: "promise_tonight", title: "Sample: send Dana the export notes", clientName: null, line: "Due tonight, still open (a sample: nothing is due)", route: "#/inbox/my-promises" }] };
      } else if (kind === "status") model = await statusModel(userId, occasion, true).catch(() => null);
      else if (kind === "meetings") {
        const found = await meetingNudges(userId).catch(() => null);
        model = found && { kind: "meetings", occasion, test: true, items: found.length ? found.map((n) => n.item) : [{ clientName: "a client", meeting: "Sample: weekly status call", dateLabel: "a sample: nothing to review", upload: false, route: "#/meetings" }] };
      }
      else model = await modelFor(kind, userId, occasion, today, true).catch(() => null);
      if (!model) {
        await store.settle(occasion, "failed");
        return { ok: false, message: "I couldn't read your week just now. Open FocusTime to see what's wrong." };
      }
      return (await deliver(userId, to, model, `test_${kind}`)) ? { ok: true } : { ok: false, message: "Teams didn't take it. Check that the FocusTime app is still added in Teams, then try again." };
    },
  };
}
export type Rhythm = ReturnType<typeof createRhythm>;
export type { OutActivity };
