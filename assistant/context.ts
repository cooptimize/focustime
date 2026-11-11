// AS-3: what the assistant answers a question from, built on the server from the person's own reads (the same actions
// the buttons call, through their own dispatch), scoped to clients that are theirs (isMine) and to the period asked
// about. Nothing here goes to an AI by itself: the answer is composed on the server (assistant/answer.ts), and only a
// one-client context (`forClient`) is ever sent, as quoted data, for a question the composer has no section for.
// Bounded: at most CONTEXT_LIMITS rows of each kind, and the JSON for the model at most CONTEXT_MAX_CHARS.
import type { ActionName } from "../actions/registry.ts";
import type { ActionResponse, AheadLoad, WeekLoadData } from "../actions/types.ts";
import { buildRows, isOpen } from "../plan/ahead-model.ts";
import { GAP_WORDS } from "../plan/fixnext.ts";
import { windowText } from "../plan/deploy.ts";
import type { InboxListData } from "../plan/inbox-items.ts";
import type { MeetingNudgeView } from "../plan/meeting-views.ts";
import type { StatusLoad } from "../plan/status-types.ts";
import { pickNeed, SIZE_MINUTES, sizeMinutes, type Pick } from "../plan/types.ts";
import type { Link } from "./types.ts";

export type PeriodKind = "today" | "tomorrow" | "this_week" | "next_week" | "weekend" | "last_week" | "day";
export type Period = { kind: PeriodKind; from: string; to: string; label: string };

/** At most this many of each kind of row, per answer (the whole context, every client). */
export const CONTEXT_LIMITS = { days: 14, todos: 40, promises: 12, waiting: 10, gaps: 12, statusMissing: 12, calls: 6, afterHours: 10 } as const;
/** The one-client context sent to the model for a general question, as JSON: at most this many characters (about 4k tokens). */
export const CONTEXT_MAX_CHARS = 16_000;

export type CtxBlock = { date: string; half: "AM" | "PM"; clientKey: string; clientName: string; freeMinutes: number; plannedMinutes: number; meetingMinutes: number; risk: string | null; pto: boolean };
export type CtxDay = { date: string; label: string; kind: "work" | "overflow" | "weekend"; pto: boolean; ptoHalf: "AM" | "PM" | null; workMinutes: number; meetingMinutes: number; freeMinutes: number; plannedMinutes: number; blocks: CtxBlock[] };
export type CtxTodo = { pickId: number; clientKey: string; title: string; date: string; half: "AM" | "PM" | "EVE"; done: boolean; minutes: number; size: string | null; itemId: number | null; feature: { id: number; title: string } | null; deployment: string | null };
/** A promise of mine: from the Inbox's Promises view (`key`, chat promises and the ones I added) or the week's list. */
export type CtxPromise = { id: number; key: string | null; clientKey: string; what: string; to: string | null; due: string; late: boolean };
export type CtxWaiting = { key: string; clientKey: string | null; title: string; who: string | null; due: string | null; late: boolean };
export type CtxGap = { clientKey: string; id: number; title: string; tier: string; gaps: string[]; target: string | null; why: "dated" | "planned" | "on_week" };
export type CtxFeature = { clientKey: string; id: number; title: string };
export type CtxCall = { clientKey: string; meeting: string; date: string; kind: "review" | "upload" };

export type AnswerContext = {
  period: Period;
  today: string;
  days: CtxDay[];
  todos: CtxTodo[];
  promises: CtxPromise[];
  waiting: CtxWaiting[];
  gaps: CtxGap[];
  /** Features on Monday's report with no update in its window yet; null when the report wasn't read. */
  statusMissing: CtxFeature[] | null;
  statusTitle: string | null;
  calls: CtxCall[];
  afterHours: { minutes: number; parts: { pickId: number | null; date: string; title: string; minutes: number; why: string }[] };
  /** The person's clients that appear anywhere above, in first-seen order. */
  clients: { key: string; name: string }[];
  /** What couldn't be read, in plain words ("Ahead couldn't be read: …"): the answer says so instead of guessing. */
  unknown: string[];
};

export type ContextDeps = {
  run: (action: ActionName, input: unknown) => Promise<ActionResponse>;
  today: string;
  isMine: (clientKey: string) => boolean;
  clientName: (clientKey: string) => string;
  link: (href: string, label: string) => Link;
};

const P = (d: string) => Temporal.PlainDate.from(d);
const mondayOf = (d: string) => P(d).subtract({ days: P(d).dayOfWeek - 1 }).toString();
const dayLabel = (d: string) => P(d).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" });
const range = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = P(from); Temporal.PlainDate.compare(d, P(to)) <= 0; d = d.add({ days: 1 })) out.push(d.toString());
  return out;
};
const inP = (p: Period, d: string | null | undefined) => !!d && d >= p.from && d <= p.to;
const minutesOf = (a: string, b: string) => Math.max(0, Math.round((Temporal.Instant.from(b).epochMilliseconds - Temporal.Instant.from(a).epochMilliseconds) / 60_000));

/** The period a question asks about, from the intent's words (a day for "day"); this week when nothing fits. */
export function periodOf(kind: PeriodKind | null | undefined, today: string, date?: string | null): Period {
  const t = P(today);
  const mon = P(mondayOf(today));
  const span = (k: PeriodKind, from: Temporal.PlainDate, to: Temporal.PlainDate, label: string): Period => ({ kind: k, from: from.toString(), to: to.toString(), label });
  switch (kind) {
    case "today": return span("today", t, t, `today (${dayLabel(today)})`);
    case "tomorrow": { const d = t.add({ days: 1 }); return span("tomorrow", d, d, `tomorrow (${dayLabel(d.toString())})`); }
    case "next_week": { const m = mon.add({ days: 7 }); return span("next_week", m, m.add({ days: 6 }), `next week (${dayLabel(m.toString())} to ${dayLabel(m.add({ days: 4 }).toString())})`); }
    case "last_week": { const m = mon.subtract({ days: 7 }); return span("last_week", m, m.add({ days: 6 }), `last week (${dayLabel(m.toString())} to ${dayLabel(m.add({ days: 4 }).toString())})`); }
    case "weekend": { const sat = mon.add({ days: 5 }); return span("weekend", sat, sat.add({ days: 1 }), `this weekend (${dayLabel(sat.toString())} and ${dayLabel(sat.add({ days: 1 }).toString())})`); }
    case "day": if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) return span("day", P(date), P(date), dayLabel(date)); return periodOf("today", today);
    default: return span("this_week", mon, mon.add({ days: 6 }), `this week (${dayLabel(mon.toString())} to ${dayLabel(mon.add({ days: 4 }).toString())})`);
  }
}

async function data<T>(r: Promise<ActionResponse>): Promise<T | string> {
  try {
    const x = await r;
    return x.ok ? (x.data as T) : x.error;
  } catch {
    return "it couldn't be read";
  }
}

export type Want = { ahead?: boolean; status?: boolean; inbox?: boolean; calls?: boolean };

/**
 * The answer context for a period: one week read per week it touches, and only the other reads the question needs.
 * `client` narrows every row to one client of mine; null keeps all of mine (the reader is the person, who sees them).
 */
export async function buildContext(d: ContextDeps, period: Period, client: string | null, want: Want = { ahead: true, status: true, inbox: true, calls: true }): Promise<AnswerContext> {
  const ok = (k: string | null | undefined): k is string => !!k && d.isMine(k) && (client === null || k === client);
  const unknown: string[] = [];
  const ctx: AnswerContext = { period, today: d.today, days: [], todos: [], promises: [], waiting: [], gaps: [], statusMissing: null, statusTitle: null, calls: [], afterHours: { minutes: 0, parts: [] }, clients: [], unknown };
  const dates = range(period.from, period.to);
  const weeks = [...new Set(dates.map(mondayOf))];
  const promiseSeen = new Set<number>();
  const picks: Pick[] = [];

  for (const weekStart of weeks) {
    const w = await data<WeekLoadData>(d.run("week.load", { weekStart }));
    if (typeof w === "string") {
      unknown.push(`The week of ${dayLabel(weekStart)} couldn't be read: ${w}`);
      continue;
    }
    const sizes = w.planning?.sizes ?? SIZE_MINUTES;
    for (const day of w.week.days) {
      if (!inP(period, day.date)) continue;
      const dayPicks = (w.plan?.[day.date]?.picks ?? []).filter((p) => ok(p.clientKey) && (p.status === "planned" || p.status === "done"));
      picks.push(...dayPicks);
      const blocks: CtxBlock[] = [];
      let work = 0, meet = 0, free = 0;
      for (const slot of [day.am, day.pm]) {
        const windows = slot.windows.reduce((n, x) => n + minutesOf(x.start, x.end), 0);
        const freeHere = slot.pto ? 0 : slot.freeGaps.reduce((n, g) => n + g.minutes, 0);
        work += slot.pto ? 0 : windows;
        meet += slot.busyMeetingMinutes;
        free += freeHere;
        const f = slot.focus[0];
        if (!f || !ok(f.clientKey)) continue;
        const planned = dayPicks.filter((p) => p.half === slot.half && p.clientKey === f.clientKey && p.status === "planned").reduce((n, p) => n + pickNeed(p, sizes), 0);
        const risk = slot.risks.find((r) => r.severity === "at_risk") ?? null;
        blocks.push({ date: day.date, half: slot.half as "AM" | "PM", clientKey: f.clientKey, clientName: d.clientName(f.clientKey), freeMinutes: freeHere, plannedMinutes: planned, meetingMinutes: slot.busyMeetingMinutes, risk: risk ? (risk.short ?? risk.reason) : null, pto: slot.pto });
      }
      const plannedDay = dayPicks.filter((p) => p.status === "planned").reduce((n, p) => n + pickNeed(p, sizes), 0);
      ctx.days.push({ date: day.date, label: dayLabel(day.date), kind: day.kind, pto: !!day.pto, ptoHalf: day.ptoHalf?.half ?? null, workMinutes: work, meetingMinutes: meet, freeMinutes: free, plannedMinutes: plannedDay, blocks });
      for (const p of dayPicks) ctx.todos.push({ pickId: p.id, clientKey: p.clientKey, title: p.title, date: p.date, half: p.half === "PM" ? "PM" : p.half === "AM" ? "AM" : "EVE", done: p.status === "done", minutes: p.status === "planned" ? pickNeed(p, sizes) : p.minutes ?? sizeMinutes(p.size, sizes), size: p.size, itemId: p.itemId, feature: null, deployment: p.todoKind === "deployment" && p.window ? windowText(p.window) : null });
    }
    for (const part of w.afterHours?.parts ?? []) {
      if (!inP(period, part.date)) continue;
      const pk = part.pickId === null ? null : picks.find((p) => p.id === part.pickId);
      if (pk && !ok(pk.clientKey)) continue;
      if (!pk && client !== null) continue;
      ctx.afterHours.parts.push({ pickId: part.pickId, date: part.date, title: part.title, minutes: part.minutes, why: part.why });
      ctx.afterHours.minutes += part.minutes;
    }
    for (const p of w.promises ?? []) {
      if (!ok(p.clientKey) || promiseSeen.has(p.id)) continue;
      // Late ones always (whatever the period); the rest when due in it.
      if (!p.overdue && !inP(period, p.dueDate) && !(period.from <= d.today && p.dueDate <= period.to)) continue;
      promiseSeen.add(p.id);
      ctx.promises.push({ id: p.id, key: null, clientKey: p.clientKey, what: p.what, to: p.toName, due: p.dueAt ?? p.dueDate, late: p.overdue });
    }
  }

  if (want.ahead !== false) {
    const a = await data<AheadLoad>(d.run("ahead.load", {}));
    if (typeof a === "string") unknown.push(`Ahead couldn't be read, so readiness gaps aren't known: ${a}`);
    else {
      for (const c of a.clients) {
        if (!ok(c.clientKey)) continue;
        const byId = new Map(c.items.map((i) => [i.id, i]));
        // Each to-do's parent feature (or epic), by its item's parent.
        for (const t of ctx.todos) {
          if (t.clientKey !== c.clientKey || t.itemId === null) continue;
          const it = byId.get(t.itemId);
          const parent = it?.parentId != null ? byId.get(it.parentId) : undefined;
          if (parent) t.feature = { id: parent.id, title: parent.title };
        }
        const planned = new Set(ctx.todos.filter((t) => t.clientKey === c.clientKey).flatMap((t) => [t.itemId, t.feature?.id]).filter((x): x is number => typeof x === "number"));
        for (const r of buildRows(a, c)) {
          if (!r.gaps.length || !isOpen(r.item)) continue;
          const why: CtxGap["why"] | null = inP(period, r.eff.target) || inP(period, r.eff.start) ? "dated" : planned.has(r.item.id) ? "planned" : null;
          if (!why) continue;
          ctx.gaps.push({ clientKey: c.clientKey, id: r.item.id, title: r.item.title, tier: r.tier ?? "item", gaps: r.gaps.map((g) => GAP_WORDS[g]), target: r.eff.target, why });
        }
      }
    }
  }

  if (want.status) {
    const s = await data<StatusLoad>(d.run("status.load", {}));
    if (typeof s === "string") unknown.push(`Monday's status report couldn't be read: ${s}`);
    else {
      ctx.statusTitle = s.title;
      ctx.statusMissing = [];
      for (const c of s.clients) {
        if (!ok(c.clientKey)) continue;
        if (c.status === "error") unknown.push(`${c.clientName}'s status report couldn't be read${c.message ? `: ${c.message}` : ""}`);
        for (const f of c.features) if (f.thisWeek !== null && f.thisWeek.length === 0) ctx.statusMissing.push({ clientKey: c.clientKey, id: f.id, title: f.title });
      }
    }
  }

  if (want.inbox) {
    const l = await data<InboxListData>(d.run("inbox.list", {}));
    if (typeof l === "string") unknown.push(`The Inbox couldn't be read: ${l}`);
    else {
      // The Inbox's Promises view is the whole list (chat promises too); it replaces the week's when it was read.
      const fromInbox: CtxPromise[] = [];
      for (const r of l.items) {
        if (r.clientKey === null ? client !== null : !ok(r.clientKey)) continue;
        if (r.views.includes("waiting")) ctx.waiting.push({ key: r.key, clientKey: r.clientKey, title: r.title, who: r.who, due: r.due, late: !!r.late });
        if (r.views.includes("promises") && r.clientKey && !r.done && (r.late || inP(period, r.due) || (!!r.due && period.from <= d.today && r.due <= period.to)))
          fromInbox.push({ id: Number(/(\d+)$/.exec(r.key)?.[1] ?? 0), key: r.key, clientKey: r.clientKey, what: r.title, to: r.who, due: r.dueAt ?? r.due ?? "", late: !!r.late });
      }
      if (l.items.some((r) => r.views.includes("promises")) || !ctx.promises.length) ctx.promises = fromInbox;
    }
  }

  if (want.calls) {
    const m = await data<{ nudges: MeetingNudgeView[] }>(d.run("meeting.mine", {}));
    if (typeof m !== "string") for (const n of m.nudges ?? []) if (ok(n.clientKey)) ctx.calls.push({ clientKey: n.clientKey, meeting: n.meeting, date: n.date, kind: n.kind === "upload" ? "upload" : "review" });
  }

  // Bounds: the most pressing first, then cut.
  ctx.days = ctx.days.slice(0, CONTEXT_LIMITS.days);
  ctx.todos = ctx.todos.sort((x, y) => x.date.localeCompare(y.date) || x.half.localeCompare(y.half) || x.pickId - y.pickId).slice(0, CONTEXT_LIMITS.todos);
  ctx.promises = ctx.promises.sort((x, y) => Number(y.late) - Number(x.late) || x.due.localeCompare(y.due)).slice(0, CONTEXT_LIMITS.promises);
  ctx.waiting = ctx.waiting.sort((x, y) => Number(y.late) - Number(x.late) || (x.due ?? "9999").localeCompare(y.due ?? "9999")).slice(0, CONTEXT_LIMITS.waiting);
  ctx.gaps = ctx.gaps.sort((x, y) => (x.target ?? "9999").localeCompare(y.target ?? "9999")).slice(0, CONTEXT_LIMITS.gaps);
  if (ctx.statusMissing) ctx.statusMissing = ctx.statusMissing.slice(0, CONTEXT_LIMITS.statusMissing);
  ctx.calls = ctx.calls.slice(0, CONTEXT_LIMITS.calls);
  ctx.afterHours.parts = ctx.afterHours.parts.slice(0, CONTEXT_LIMITS.afterHours);

  const seen = new Map<string, string>();
  const see = (k: string | null) => void (k && !seen.has(k) && seen.set(k, d.clientName(k)));
  for (const b of ctx.days.flatMap((x) => x.blocks)) see(b.clientKey);
  for (const r of [...ctx.todos, ...ctx.promises, ...ctx.gaps, ...(ctx.statusMissing ?? []), ...ctx.calls]) see(r.clientKey);
  for (const r of ctx.waiting) see(r.clientKey);
  ctx.clients = [...seen].map(([key, name]) => ({ key, name }));
  return ctx;
}

/**
 * The context of one client as the model may read it (a general question about that client): titles and words from
 * DevOps, chats and notes under "quoted", ids, dates and minutes plain. Cut to CONTEXT_MAX_CHARS.
 */
export function forClient(ctx: AnswerContext, client: string): string {
  const q = (s: string) => ({ quoted: s });
  const out = {
    period: ctx.period.label,
    today: ctx.today,
    days: ctx.days.map((x) => ({ date: x.date, pto: x.pto, meetingMinutes: x.meetingMinutes, freeMinutes: x.freeMinutes, blocks: x.blocks.filter((b) => b.clientKey === client).map((b) => ({ half: b.half, freeMinutes: b.freeMinutes, plannedMinutes: b.plannedMinutes, risk: b.risk })) })),
    todos: ctx.todos.filter((t) => t.clientKey === client).map((t) => ({ pickId: t.pickId, title: q(t.title), date: t.date, half: t.half, done: t.done, minutes: t.minutes, itemId: t.itemId, feature: t.feature ? { id: t.feature.id, title: q(t.feature.title) } : null, deployment: t.deployment })),
    promises: ctx.promises.filter((p) => p.clientKey === client).map((p) => ({ id: p.id, what: q(p.what), to: p.to, due: p.due, late: p.late })),
    waiting: ctx.waiting.filter((w) => w.clientKey === client).map((w) => ({ title: q(w.title), who: w.who, due: w.due, late: w.late })),
    gaps: ctx.gaps.filter((g) => g.clientKey === client).map((g) => ({ id: g.id, title: q(g.title), gaps: g.gaps, target: g.target })),
    featuresWithoutUpdate: ctx.statusMissing === null ? "not known" : ctx.statusMissing.filter((f) => f.clientKey === client).map((f) => ({ id: f.id, title: q(f.title) })),
    callsToReview: ctx.calls.filter((c) => c.clientKey === client).map((c) => ({ date: c.date, kind: c.kind })),
    afterHoursMinutes: ctx.afterHours.parts.filter((p) => p.pickId !== null && ctx.todos.some((t) => t.pickId === p.pickId && t.clientKey === client)).reduce((n, p) => n + p.minutes, 0),
    notKnown: ctx.unknown.filter((u) => !ctx.clients.some((c) => c.key !== client && u.includes(c.name))),
  };
  let s = JSON.stringify(out);
  // Over the limit: drop the longest lists' tails until it fits.
  for (const key of ["todos", "gaps", "promises", "waiting", "days"] as const) {
    while (s.length > CONTEXT_MAX_CHARS && (out[key] as unknown[]).length > 3) {
      (out[key] as unknown[]).pop();
      s = JSON.stringify(out);
    }
  }
  return s.slice(0, CONTEXT_MAX_CHARS);
}
