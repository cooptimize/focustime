// WK-3 (DP-0): a Deployment is a kind of to-do: a client, a date and a window, optionally the DevOps items it covers
// and a note of what's going. The runbook and the execution stay in Coop; FocusTime only places the time, counts the
// after-hours part and offers to tell the client once it's done. Pure: no store, no network.
import { firstName } from "./loop.ts";
import type { Pick, TodoLink, TodoWindow } from "./types.ts";
import type { DeployItem } from "./deploy-items.ts";
import { hoursOn, nominalHours, toHm, toMin, type DayHours, type Span, type TimeModel } from "../week/hours.ts";
import type { Half, IsoDate } from "../week/types.ts";
import { dayLabel } from "./days.ts";

export const DEPLOYMENT = "Deployment";

/**
 * UC-1: the title a Deployment gets when none is typed: "Deployment - <client's name> - <date>", the date as the app
 * writes dates ("Sat, Nov 21"). Capture shows it as the box's hint and sends it as the title.
 */
export const madeTitle = (clientName: string, date: IsoDate): string => `${DEPLOYMENT} - ${clientName.replace(/\s+/g, " ").trim().slice(0, 150)} - ${dayLabel(date)}`;

/** The longest title a deployment keeps (the capture box, the day menu and the assistant cut at the same length). */
export const DEPLOY_TITLE_MAX = 200;

/**
 * UC-2: the one way a new deployment gets its title, whoever makes it (the capture box, Plan a deployment… from the
 * day menu or the command menu, the assistant and so the Teams bot): the words typed, or with none the made title.
 */
export function deploymentTitle(typed: string | null | undefined, clientName: string, date: IsoDate): string {
  const words = (typed ?? "").trim();
  return (words || madeTitle(clientName, date)).slice(0, DEPLOY_TITLE_MAX);
}

/**
 * UC-2: whether a deployment's title is one FocusTime made rather than words a person typed: the made form naming the
 * day the deployment is on, or the bare "Deployment" an untitled one was given before UC-2.
 */
export function isMadeTitle(title: string, date: IsoDate): boolean {
  const t = title.trim();
  if (t === DEPLOYMENT) return true;
  const head = `${DEPLOYMENT} - `;
  const tail = ` - ${dayLabel(date)}`;
  return t.startsWith(head) && t.endsWith(tail) && t.length > head.length + tail.length;
}

/**
 * UC-2: how a sentence names a deployment. A made title is never quoted into a sentence: the sentence names the day
 * instead ("the Sat, Nov 21 deployment"). A typed title is used as it is.
 */
export function deployName(title: string, date: IsoDate): { made: boolean; name: string } {
  return isMadeTitle(title, date) ? { made: true, name: `the ${dayLabel(date)} deployment` } : { made: false, name: title.trim().replace(/[.!]+$/, "") };
}

/** UC-2: the line after a deployment is ticked done: "The Sat, Nov 21 deployment is done", or "<typed title> is done". */
export function doneLine(title: string, date: IsoDate): string {
  const n = deployName(title, date);
  return `${n.made ? cap(n.name) : n.name} is done`;
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * UC-1: a title FocusTime made follows its deployment to another day. A title is a made one when it still reads
 * "Deployment - <something> - <the day it was on>"; anything else is the person's own words and is kept as it is.
 */
export function movedTitle(title: string, from: IsoDate, to: IsoDate): string {
  const head = `${DEPLOYMENT} - `;
  const tail = ` - ${dayLabel(from)}`;
  if (from === to || !title.startsWith(head) || !title.endsWith(tail) || title.length <= head.length + tail.length) return title;
  return `${title.slice(0, -tail.length)} - ${dayLabel(to)}`;
}
const HM = /^([01]\d|2[0-3]):([0-5]\d)$|^24:00$/;
/** The longest window one deployment takes on a day (a whole night's cutover is still one day). */
export const MAX_WINDOW_MINUTES = 16 * 60;

/** A window's problem in plain words, or null when it is fine: both times, start before end, on one day. */
export function windowProblem(w: { start?: unknown; end?: unknown } | null | undefined): string | null {
  if (!w || w.start === undefined || w.end === undefined || w.start === "" || w.end === "") return "A deployment needs a start and an end time";
  if (typeof w.start !== "string" || !HM.test(w.start) || w.start === "24:00") return "The start must be a time like 19:00";
  if (typeof w.end !== "string" || !HM.test(w.end)) return "The end must be a time like 21:00";
  const len = toMin(w.end) - toMin(w.start);
  if (len <= 0) return "The end must be after the start (a window ends on the day it starts)";
  if (len < 15) return "A window is at least 15 minutes";
  if (len > MAX_WINDOW_MINUTES) return "A window is at most 16 hours";
  return null;
}

export const windowMinutes = (w: TodoWindow) => toMin(w.end) - toMin(w.start);

/** "9:00–11:00", "19:00–21:30": the window as the rows show it. */
export function windowText(w: TodoWindow): string {
  const t = (hm: string) => hm.replace(/^0(\d)/, "$1");
  return `${t(w.start)}–${t(w.end)}`;
}

/** The day shape a window is measured against: the day's normal span, or the nominal one on a weekday without hours. */
export function dayShape(model: TimeModel, date: IsoDate): { shape: Span | null; hours: DayHours } {
  const h = hoursOn(model, date);
  const weekend = Temporal.PlainDate.from(date).dayOfWeek >= 6;
  if (weekend) return { shape: null, hours: h };
  if (h.main) return { shape: h.main, hours: h };
  const n = nominalHours(model);
  return { shape: { start: n.am.start, end: n.pm.end }, hours: h };
}

/**
 * Where a window sits on its date: AM or PM when it starts inside the morning or afternoon of a day with hours, else
 * the evening (EVE). A weekend or a day without hours is EVE too: the weekend column lists every half alike.
 */
export function windowHalf(hours: DayHours, w: TodoWindow): Half {
  if (!hours.main || !hours.pm) return "EVE";
  const s = toMin(w.start);
  if (s >= toMin(hours.main.end)) return "EVE";
  return s < toMin(hours.pm.start) ? "AM" : "PM";
}

/** Minutes of a span outside the day shape (all of it with no shape: a weekend or a PTO day). */
export function outsideMinutes(span: { start: number; end: number }, shape: Span | null): number {
  const len = Math.max(0, span.end - span.start);
  if (!shape) return len;
  const inside = Math.max(0, Math.min(span.end, toMin(shape.end)) - Math.max(span.start, toMin(shape.start)));
  return len - inside;
}

/** A timebox's local span on a date, in minutes from midnight (clipped to the day). */
export type LocalSpan = { start: number; end: number };

export type AfterHoursPart = { pickId: number | null; date: IsoDate; title: string; minutes: number; why: "deployment" | "evening" | "weekend" };

/**
 * WK-3's after-hours rule, per week (the record in docs/decisions.md):
 *  - a Deployment counts the minutes of its window outside the day shape (the day's working span; on a weekday without
 *    hours the nominal one; a weekend or a PTO day has none, so all of it);
 *  - any other planned or done to-do I placed in the evening (half EVE) or on a weekend counts its timebox's minutes
 *    outside the day shape when it has one, else its own minutes (its size, or the person's assumption when unsized);
 *  - FocusTime's own timeboxes without a to-do (an item timeboxed directly) count their minutes outside the shape on
 *    a weekend or after the day's end;
 *  - calendar events never count: a meeting someone else set isn't extra time I planned. Moved and dropped to-dos
 *    never count; a done one does (the time was spent).
 */
export function afterHours(o: {
  model: TimeModel;
  dates: readonly IsoDate[];
  picks: readonly Pick[];
  /** Local spans of to-dos' timeboxes, by pick id. */
  pickSpans?: ReadonlyMap<number, LocalSpan>;
  /** Timeboxes without a to-do, by date. */
  looseSpans?: readonly { date: IsoDate; title: string; span: LocalSpan }[];
  pto?: ReadonlySet<IsoDate>;
  minutesOf: (p: Pick) => number;
}): { minutes: number; parts: AfterHoursPart[] } {
  const parts: AfterHoursPart[] = [];
  const inWeek = new Set(o.dates);
  for (const p of o.picks) {
    if (!inWeek.has(p.date) || (p.status !== "planned" && p.status !== "done")) continue;
    const { shape } = dayShape(o.model, p.date);
    const sh = o.pto?.has(p.date) ? null : shape;
    const weekend = Temporal.PlainDate.from(p.date).dayOfWeek >= 6;
    if (p.todoKind === "deployment" && p.window) {
      const m = outsideMinutes({ start: toMin(p.window.start), end: toMin(p.window.end) }, sh);
      if (m > 0) parts.push({ pickId: p.id, date: p.date, title: p.title, minutes: m, why: "deployment" });
      continue;
    }
    if (!weekend && p.half !== "EVE") continue;
    const span = o.pickSpans?.get(p.id);
    const m = span ? outsideMinutes(span, sh) : o.minutesOf(p);
    if (m > 0) parts.push({ pickId: p.id, date: p.date, title: p.title, minutes: m, why: weekend ? "weekend" : "evening" });
  }
  for (const t of o.looseSpans ?? []) {
    if (!inWeek.has(t.date)) continue;
    const { shape } = dayShape(o.model, t.date);
    const weekend = Temporal.PlainDate.from(t.date).dayOfWeek >= 6;
    const after = shape && t.span.start >= toMin(shape.end);
    if (!weekend && !after) continue;
    const m = outsideMinutes(t.span, o.pto?.has(t.date) ? null : shape);
    if (m > 0) parts.push({ pickId: null, date: t.date, title: t.title, minutes: m, why: weekend ? "weekend" : "evening" });
  }
  return { minutes: parts.reduce((n, p) => n + p.minutes, 0), parts };
}

/** "3h after hours this week", "1h 30m after hours this week"; null at zero (nothing shows). */
export function afterHoursText(minutes: number): string | null {
  if (minutes <= 0) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h ? `${h}h` : ""}${h && m ? " " : ""}${m ? `${m}m` : ""} after hours this week`;
}

/** True when a to-do sits after the day shape on a weekday (the Evening band) by its window or its half. */
export function inEvening(p: Pick, shape: Span | null): boolean {
  if (p.window) return !!shape && toMin(p.window.start) >= toMin(shape.end);
  return p.half === "EVE";
}

/**
 * The draft for "Tell <client> it's deployed" (LP-1's Close the loop): who, what went (the note) and the items, then a
 * sign-off. Plain text, always editable in the draft step.
 */
export function deployedText(o: { who: string | null; clientName: string; title: string; /** UC-2: the deployment's day, so a made title reads as "The Sat, Nov 21 deployment is done." */ date?: IsoDate; note: string | null; links: readonly TodoLink[]; items?: readonly DeployItem[]; when?: string; myName: string | null }): string {
  const hi = o.who ? `Hi ${firstName(o.who)},` : "Hi,";
  const note = o.note?.trim();
  // UC-2: a made title isn't quoted; the sentence names the day. A typed title reads as it always did.
  const named = o.date ? deployName(o.title, o.date) : { made: false, name: o.title.trim().replace(/[.!]+$/, "") };
  const done = named.made ? `${cap(named.name)} is done.` : `${named.name} is deployed.`;
  // DP-2: the ticked items, then the Note. A deployment with none (every one from before DP-2) reads as it always did.
  const went = o.items?.length ? [`Deployed ${o.when ?? "today"}: ${o.items.map((i) => i.name).join(", ")}.${note ? ` Also: ${note}` : ""}`] : [done, ...(note ? ["", `What went: ${note}`] : [])];
  const lines = [hi, "", ...went];
  if (o.links.length) lines.push("", "Items:", ...o.links.map((l) => `- #${l.id} ${l.title.trim()}`));
  lines.push("", "Let me know if you see anything off.");
  if (o.myName) lines.push("", firstName(o.myName));
  return lines.join("\n");
}

/** "tonight" for an evening window ticked that day, "today", or the day it ran ("on Saturday") when ticked later. */
export function deployedWhen(p: Pick, today: IsoDate): string {
  if (p.date !== today) return `on ${Temporal.PlainDate.from(p.date).toLocaleString("en-US", { weekday: "long" })}`;
  return p.window && toMin(p.window.start) >= 17 * 60 ? "tonight" : "today";
}

/** The promise "Tell <client> it's deployed" opens (a follow-up of mine, kept until the loop is closed or deleted). */
export function tellWhat(clientName: string, title: string, date?: IsoDate): string {
  // UC-2: "Tell Northwind the Sat, Nov 21 deployment is done" for a made title; a typed one reads as before.
  const named = date ? deployName(title, date) : null;
  return (named?.made ? `Tell ${clientName} ${named.name} is done` : `Tell ${clientName} it's deployed: ${title}`).slice(0, 200);
}

/** The "HH:MM" of a local minute count, for windows built from a time picker. */
export const hm = (n: number) => toHm(Math.max(0, Math.min(1440, n)));
