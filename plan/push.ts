// P1: what a push message says. A push message passes through the browser maker's push service and shows on a lock
// screen, so by default it says only what kind of thing happened ("Follow-ups due"), never a client name, a work item
// title, a meeting subject or a person: the notice's own title and body (which can hold those) go out only when the
// person turned on "Show details in notifications". The route is a view (with a date, an id or a Settings section) and
// the tag the notice kind, so neither names anything.
import { parseRoute, type Notice } from "./notify.ts";

/** The words per kind with details off: what kind of thing, never which. */
export const PUSH_GENERIC: Record<string, { title: string; body: string }> = {
  plan_day: { title: "Add work to today", body: "Today isn't planned yet." },
  checkin: { title: "Check-in", body: "What's done and what's left." },
  closeout: { title: "Close out", body: "Time to close out the day." },
  plan_week: { title: "Add work to the week", body: "This week isn't planned yet." },
  look_ahead: { title: "Add work to next week", body: "Next week isn't planned yet." },
  plan_ahead: { title: "Look ahead 4 weeks", body: "Time to look a few weeks ahead." },
  direction: { title: "Direction review", body: "Time to look 8 to 12 weeks ahead." },
  timer: { title: "Focus", body: "Your session ended." },
  meeting: { title: "Meeting soon", body: "A meeting starts in 5 minutes." },
  vm: { title: "Your VM", body: "Your VM needs a look." },
  followups: { title: "Promises due", body: "You have promises due." },
  expiry: { title: "Expiring soon", body: "Something in Settings expires soon." },
  held: { title: "While you were focused", body: "A few things came up." },
  test: { title: "FocusTime", body: "Notifications reach this device." },
};
const FALLBACK = { title: "FocusTime", body: "Something needs a look." };

export type PushPayload = { title: string; body: string; route: string; tag: string };

/** A route is a view name with at most a date, an id or a Settings section ("planweek:2026-11-09"); anything else opens Today. */
const safeRoute = (route: string) => (parseRoute(route) ? route : "today");

export function pushPayload(n: Pick<Notice, "kind" | "title" | "body" | "route">, details: boolean): PushPayload {
  const kind = String(n.kind);
  const tag = kind.replace(/[^a-z_]/g, "").slice(0, 32) || "focustime";
  if (details) return { title: n.title.slice(0, 120), body: n.body.slice(0, 400), route: safeRoute(n.route), tag };
  const g = PUSH_GENERIC[kind] ?? FALLBACK;
  return { title: g.title, body: g.body, route: safeRoute(n.route), tag };
}

/** A coarse name for a device from its user agent: the kind of device and the browser, nothing more. */
export function deviceLabel(ua: string): string {
  const device = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Macintosh/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "Device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\/|FxiOS/.test(ua) ? "Firefox" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return `${device} · ${browser}`;
}
/** Labels as deviceLabel makes them; anything else is stored as "Device". */
export const DEVICE_LABEL = /^[A-Za-z]{2,12} · [A-Za-z]{2,12}$/;

/** P1: how many notices the in-app list keeps (the oldest go first). */
export const NOTICES_KEPT = 50;
/** P1: one entry in ⋯ › Notifications. */
export type InAppNotice = { id: number; key: string; kind: string; title: string; body: string; route: string | null; at: string; read: boolean; closed: boolean };
export type NoticeList = { items: InAppNotice[]; unread: number };
