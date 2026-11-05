// Step 16.2: where the window is. Four tabs (Today · Week · Roadmap · Inbox), one mode switch per tab, planning as a
// mode, and two full-window overlays (the focus screen and Settings). Every place has an address (#/…) so browser back
// and reopening land in the same place. Pure: no DOM, no React; App applies it.
import type { Half, IsoDate } from "../week/types.ts";
import type { Route } from "../plan/notify.ts";

export const TABS = ["today", "week", "roadmap", "inbox"] as const;
export type Tab = (typeof TABS)[number];
export const TAB_NAMES: Record<Tab, string> = { today: "Today", week: "Week", roadmap: "Roadmap", inbox: "Inbox" };

export const TODAY_MODES = ["now", "plan", "checkin", "closeout"] as const;
export type TodayMode = (typeof TODAY_MODES)[number];
export type WeekMode = "week" | "planweek";
export type RoadmapMode = "roadmap" | "ahead";

export const MODE_NAMES = { now: "Now", plan: "Plan", checkin: "Check-in", closeout: "Close out", week: "Week", planweek: "Plan the week", roadmap: "Roadmap", ahead: "Plan ahead" } as const;
export type ModeName = keyof typeof MODE_NAMES;
/** Each tab's modes, in switch order (the Inbox has one, so no switch). */
export const MODES: Record<Tab, readonly ModeName[]> = { today: TODAY_MODES, week: ["week", "planweek"], roadmap: ["roadmap", "ahead"], inbox: [] };

/**
 * One place. `date` is the day Today's Plan or Close out is on (null: the default day, today or the next workday for
 * Plan, today for Close out); `half` is the block "+ Add work" asked for. `week` is the Week's Monday (null: this week
 * for Week, next week for Plan the week).
 */
export type Nav =
  | { tab: "today"; mode: TodayMode; date: IsoDate | null; half: Half | null }
  | { tab: "week"; mode: WeekMode; week: IsoDate | null }
  | { tab: "roadmap"; mode: RoadmapMode }
  | { tab: "inbox"; followUp: number | null; conversations?: boolean; myPromises?: boolean };

/** G1: the Guide sits over a place like Settings; `chapter` is the one to scroll to (null: the top). */
export type Overlay = { kind: "focus" } | { kind: "settings"; section: string } | { kind: "guide"; chapter: string | null } | null;
export type Loc = { nav: Nav; overlay: Overlay };

export const navOf = {
  today: (mode: TodayMode = "now", date: IsoDate | null = null, half: Half | null = null): Nav => ({ tab: "today", mode, date, half }),
  week: (mode: WeekMode = "week", week: IsoDate | null = null): Nav => ({ tab: "week", mode, week }),
  roadmap: (mode: RoadmapMode = "roadmap"): Nav => ({ tab: "roadmap", mode }),
  inbox: (followUp: number | null = null): Nav => ({ tab: "inbox", followUp }),
  /** CV-1: Inbox › Conversations (was Requests, and Asks before that). */
  conversations: (): Nav => ({ tab: "inbox", followUp: null, conversations: true }),
  /** CV-1: Inbox › My promises (was Promises). */
  myPromises: (): Nav => ({ tab: "inbox", followUp: null, myPromises: true }),
};
export const HOME: Loc = { nav: navOf.today(), overlay: null };

/** The mode a tab opens in. */
export const defaultNav = (tab: Tab): Nav => (tab === "today" ? navOf.today() : tab === "week" ? navOf.week() : tab === "roadmap" ? navOf.roadmap() : navOf.inbox());
export const modeOf = (n: Nav): ModeName | null => (n.tab === "inbox" ? null : n.mode);

/** Planning modes get a Done; the view modes don't. */
export const isPlanning = (n: Nav): boolean => (n.tab === "today" ? n.mode !== "now" : n.tab === "week" ? n.mode === "planweek" : n.tab === "roadmap" ? n.mode === "ahead" : false);

/** P: the current tab's planning mode, or back to its view mode from any planning mode. The Inbox has none. */
export function toggleP(n: Nav): Nav {
  if (n.tab === "today") return n.mode === "now" ? navOf.today("plan") : navOf.today("now");
  if (n.tab === "week") return n.mode === "week" ? navOf.week("planweek") : navOf.week("week", n.week);
  if (n.tab === "roadmap") return navOf.roadmap(n.mode === "roadmap" ? "ahead" : "roadmap");
  return n;
}

/** Done in a planning mode returns to the tab's view mode (the week stays the one that was planned for Week). */
export const afterDone = (n: Nav): Nav => (n.tab === "today" ? navOf.today("now") : n.tab === "week" ? navOf.week("week") : n.tab === "roadmap" ? navOf.roadmap() : n);

/** 1–4 switch tabs (T stays Today). */
export function tabForKey(key: string): Tab | null {
  const i = ["1", "2", "3", "4"].indexOf(key);
  return i >= 0 ? TABS[i]! : key === "t" || key === "T" ? "today" : null;
}

/** A mode on the switch: the place it opens. */
export function modeNav(tab: Tab, mode: ModeName): Nav {
  if (tab === "today") return navOf.today(mode as TodayMode);
  if (tab === "week") return navOf.week(mode as WeekMode);
  if (tab === "roadmap") return navOf.roadmap(mode as RoadmapMode);
  return navOf.inbox();
}

// ---- Addresses ----

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HALF = /^(AM|PM|EVE)$/;
const SECTION = /^[a-z]{2,20}$/;
const validDate = (s: string) => {
  if (!DATE.test(s)) return false;
  try {
    Temporal.PlainDate.from(s, { overflow: "reject" });
    return true;
  } catch {
    return false;
  }
};

/** "#/today/plan/2026-11-03/PM", "#/week/plan/2026-11-09", "#/roadmap/ahead", "#/inbox", "#/settings/you", "#/guide/keys". */
export function hashOf(l: Loc): string {
  if (l.overlay?.kind === "focus") return "#/focus";
  if (l.overlay?.kind === "settings") return `#/settings/${l.overlay.section}`;
  if (l.overlay?.kind === "guide") return l.overlay.chapter ? `#/guide/${l.overlay.chapter}` : "#/guide";
  const n = l.nav;
  if (n.tab === "today") return ["#/today", n.mode === "now" ? null : n.mode, n.mode === "plan" || n.mode === "closeout" ? n.date : null, n.mode === "plan" && n.date ? n.half : null].filter(Boolean).join("/");
  if (n.tab === "week") return ["#/week", n.mode === "planweek" ? "plan" : null, n.week].filter(Boolean).join("/");
  if (n.tab === "roadmap") return n.mode === "ahead" ? "#/roadmap/ahead" : "#/roadmap";
  if (n.conversations) return "#/inbox/conversations";
  if (n.myPromises) return "#/inbox/my-promises";
  return n.followUp ? `#/inbox/${n.followUp}` : "#/inbox";
}

/** The place in an address, or null for anything unknown (the window then opens Today). */
export function parseHash(hash: string): Loc | null {
  if (typeof hash !== "string" || hash.length > 80) return null;
  const parts = hash.replace(/^#\/?/, "").split("/").filter((p) => p !== "");
  const [tab, a, b, c, ...rest] = parts;
  if (rest.length) return null;
  const plain = (nav: Nav): Loc => ({ nav, overlay: null });
  switch (tab) {
    case undefined:
      return HOME;
    case "focus":
      return a === undefined ? { nav: navOf.today(), overlay: { kind: "focus" } } : null;
    case "settings":
      return a !== undefined && SECTION.test(a) && b === undefined ? { nav: navOf.today(), overlay: { kind: "settings", section: a } } : a === undefined ? { nav: navOf.today(), overlay: { kind: "settings", section: "you" } } : null;
    case "guide":
      return b !== undefined ? null : a === undefined ? { nav: navOf.today(), overlay: { kind: "guide", chapter: null } } : SECTION.test(a) ? { nav: navOf.today(), overlay: { kind: "guide", chapter: a } } : null;
    case "today": {
      if (a === undefined) return plain(navOf.today());
      if (a === "checkin") return b === undefined ? plain(navOf.today("checkin")) : null;
      if (a !== "plan" && a !== "closeout") return null;
      if (b === undefined) return plain(navOf.today(a));
      if (!validDate(b)) return null;
      if (c === undefined) return plain(navOf.today(a, b));
      return a === "plan" && HALF.test(c) ? plain(navOf.today("plan", b, c as Half)) : null;
    }
    case "week": {
      if (c !== undefined) return null;
      if (a === undefined) return plain(navOf.week());
      if (a === "plan") return b === undefined ? plain(navOf.week("planweek")) : validDate(b) ? plain(navOf.week("planweek", b)) : null;
      return b === undefined && validDate(a) ? plain(navOf.week("week", a)) : null;
    }
    case "roadmap":
      return b !== undefined ? null : a === undefined ? plain(navOf.roadmap()) : a === "ahead" ? plain(navOf.roadmap("ahead")) : null;
    case "inbox":
      return b !== undefined ? null : a === undefined ? plain(navOf.inbox()) : a === "conversations" || a === "requests" || a === "asks" ? plain(navOf.conversations()) : a === "my-promises" || a === "promises" ? plain(navOf.myPromises()) : /^[1-9]\d{0,9}$/.test(a) ? plain(navOf.inbox(Number(a))) : null;
    default:
      return null;
  }
}

/** Two places are the same address (history gets one entry per change of place). */
export const sameLoc = (a: Loc, b: Loc) => hashOf(a) === hashOf(b);

// ---- Where notifications and commands go ----

/**
 * A notification's route (step 15.5) as a place: the ritual reminders open Today in that mode, Plan the week and
 * Look ahead open Week › Plan the week on their week, follow-ups the Inbox, the timer and meetings the focus screen,
 * the VM Today with the VM menu open, expiring secrets Settings.
 */
export function routeLoc(r: Route): { loc: Loc; vmMenu: boolean } {
  const plain = (nav: Nav) => ({ loc: { nav, overlay: null }, vmMenu: false });
  switch (r.view) {
    case "today": return plain(navOf.today());
    case "planday": return plain(navOf.today("plan"));
    case "checkin": return plain(navOf.today("checkin"));
    case "closeout": return plain(navOf.today("closeout"));
    case "focus": return { loc: { nav: navOf.today(), overlay: { kind: "focus" } }, vmMenu: false };
    case "vm": return { loc: { nav: navOf.today(), overlay: null }, vmMenu: true };
    case "inbox": return plain(navOf.inbox());
    case "asks":
    case "requests":
    case "conversations": return plain(navOf.conversations());
    case "my_promises": return plain(navOf.myPromises());
    case "week": return plain(navOf.week());
    case "ahead": return plain(navOf.roadmap("ahead"));
    case "planweek": return plain(navOf.week("planweek", r.weekStart));
    case "followup": return plain(navOf.inbox(r.id));
    case "settings": return { loc: { nav: navOf.today(), overlay: { kind: "settings", section: r.section } }, vmMenu: false };
  }
}

/** The command menu's views (and older names kept for commands and tests) as places. */
export type ViewName = "today" | "week" | "inbox" | "conversations" | "my_promises" | "requests" | "asks" | "promises" | "roadmap" | "ahead" | "focus" | "capture" | "planday" | "planweek" | "settings" | "follow_ups" | "checkin" | "closeout";
export function viewNav(v: ViewName): { nav: Nav | null; overlay: Overlay } {
  switch (v) {
    case "today": return { nav: navOf.today(), overlay: null };
    case "week": return { nav: navOf.week(), overlay: null };
    case "inbox":
    case "follow_ups":
    case "capture": return { nav: navOf.inbox(), overlay: null };
    case "asks":
    case "requests":
    case "conversations": return { nav: navOf.conversations(), overlay: null };
    case "promises":
    case "my_promises": return { nav: navOf.myPromises(), overlay: null };
    case "roadmap": return { nav: navOf.roadmap(), overlay: null };
    case "ahead": return { nav: navOf.roadmap("ahead"), overlay: null };
    case "planday": return { nav: navOf.today("plan"), overlay: null };
    case "planweek": return { nav: navOf.week("planweek"), overlay: null };
    case "checkin": return { nav: navOf.today("checkin"), overlay: null };
    case "closeout": return { nav: navOf.today("closeout"), overlay: null };
    case "focus": return { nav: null, overlay: { kind: "focus" } };
    case "settings": return { nav: null, overlay: { kind: "settings", section: "you" } };
  }
}

/** The day header's Plan / Planned ✓ chip in Week, and "+ Add work" on a block: Today › Plan on that day (and block). */
export const planDayNav = (date: IsoDate, half: Half | null = null): Nav => navOf.today("plan", date, half);

/** Plan the week's week: the one asked for, else next week. */
export const planWeekOf = (asked: IsoDate | null, thisWeek: IsoDate): IsoDate => asked ?? Temporal.PlainDate.from(thisWeek).add({ days: 7 }).toString();

/** Plan the week's header: "Plan the week of Nov 9 · next week". */
export function planWeekTitle(weekStart: IsoDate, thisWeek: IsoDate): string {
  const { title, when } = planWeekParts(weekStart, thisWeek);
  return `${title} · ${when}`;
}
/** U4: the header's two parts: "Plan the week of Nov 9" and the muted "next week". */
export function planWeekParts(weekStart: IsoDate, thisWeek: IsoDate): { title: string; when: string } {
  const d = Temporal.PlainDate.from(weekStart);
  const rel = Temporal.PlainDate.compare(d, Temporal.PlainDate.from(thisWeek));
  const diff = d.since(Temporal.PlainDate.from(thisWeek)).days / 7;
  const when = rel === 0 ? "this week" : diff === 1 ? "next week" : rel < 0 ? "review" : `in ${diff} weeks`;
  return { title: `Plan the week of ${d.toLocaleString("en-US", { month: "short", day: "numeric" })}`, when };
}

/** Today's Plan header: "Plan today" or "Plan Tuesday, Nov 3" (a past day: "Review Friday, Oct 30"). */
export function planDayTitle(date: IsoDate, today: IsoDate): string {
  if (date === today) return "Plan today";
  const d = Temporal.PlainDate.from(date).toLocaleString("en-US", { weekday: "long", month: "short", day: "numeric" });
  return `${date < today ? "Review" : "Plan"} ${d}`;
}

/** F1: the place's plain name for "Include where I am" ("Today › Plan", "Settings: connections", "Guide"). */
export function viewName(loc: Loc): string {
  const n = loc.nav;
  const place = n.tab === "inbox" ? TAB_NAMES.inbox : n.tab === "roadmap" && n.mode === "roadmap" ? TAB_NAMES.roadmap : n.tab === "week" && n.mode === "week" ? TAB_NAMES.week : `${TAB_NAMES[n.tab]} › ${MODE_NAMES[n.mode]}`;
  const o = loc.overlay;
  return !o ? place : o.kind === "focus" ? `${place} (focus screen)` : o.kind === "settings" ? `Settings: ${o.section}` : `Guide${o.chapter ? `: ${o.chapter}` : ""}`;
}
