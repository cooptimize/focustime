// Step 16.2, NV-1: where the window is. Four tabs (Today · Week · Ahead · Inbox), a mode switch on Week (Board ·
// Commit) and Ahead (Roadmap · Plan ahead), Today's two flows, and the full-window overlays (the focus screen, Settings, the Guide). Every place has an address (#/…) so browser back
// and reopening land in the same place. Pure: no DOM, no React; App applies it.
import type { Half, IsoDate } from "../week/types.ts";
import type { Route } from "../plan/notify.ts";

export const TABS = ["today", "week", "ahead", "inbox"] as const;
export type Tab = (typeof TABS)[number];
export const TAB_NAMES: Record<Tab, string> = { today: "Today", week: "Week", ahead: "Ahead", inbox: "Inbox" };

/** NV-1: Today has no modes. Its Midday check-in and Close out are flows its cards open over the same page. */
export const TODAY_FLOWS = ["checkin", "closeout"] as const;
export type TodayFlow = (typeof TODAY_FLOWS)[number];
export const FLOW_NAMES: Record<TodayFlow, string> = { checkin: "Midday check-in", closeout: "Close out" };
/** NV-1: Week's Board (stories onto blocks; a day focused is Plan the day) and Commit (Plan the week). */
export type WeekMode = "board" | "commit";
/** NV-1: Ahead (was Roadmap) keeps Roadmap's two views. */
export type AheadMode = "roadmap" | "ahead";

export const MODE_NAMES = { board: "Board", commit: "Commit", roadmap: "Roadmap", ahead: "Plan ahead" } as const;
export type ModeName = keyof typeof MODE_NAMES;
/** Each tab's modes, in switch order (Today and the Inbox have none, so no switch). */
export const MODES: Record<Tab, readonly ModeName[]> = { today: [], week: ["board", "commit"], ahead: ["roadmap", "ahead"], inbox: [] };

/** NV-1: the Board focused on one day (Plan the day): `date` null is the default day (today or the next workday); `half` is the block "+ Add work" asked for. */
export type DayFocus = { date: IsoDate | null; half: Half | null };

/**
 * One place. Today's `flow` is a card's flow open over the page (`date`: Close out's day, null for today). Week's
 * `week` is its Monday (null: this week for the Board, next week for Commit); `focus` is the day the Board is
 * focused on (Board only).
 */
export type Nav =
  | { tab: "today"; flow: TodayFlow | null; date: IsoDate | null }
  | { tab: "week"; mode: WeekMode; week: IsoDate | null; focus: DayFocus | null }
  | { tab: "ahead"; mode: AheadMode }
  | { tab: "inbox"; followUp: number | null; conversations?: boolean; myPromises?: boolean; select?: number };

/** G1: the Guide sits over a place like Settings; `chapter` is the one to scroll to (null: the top). */
export type Overlay = { kind: "focus" } | { kind: "settings"; section: string } | { kind: "guide"; chapter: string | null } | null;
export type Loc = { nav: Nav; overlay: Overlay };

export const navOf = {
  today: (flow: TodayFlow | null = null, date: IsoDate | null = null): Nav => ({ tab: "today", flow, date: flow === "closeout" ? date : null }),
  week: (mode: WeekMode = "board", week: IsoDate | null = null): Nav => ({ tab: "week", mode, week, focus: null }),
  /** NV-1: Plan the day is the Board focused on that day (null: today or the next workday). */
  planDay: (date: IsoDate | null = null, half: Half | null = null): Nav => ({ tab: "week", mode: "board", week: null, focus: { date, half: date ? half : null } }),
  ahead: (mode: AheadMode = "roadmap"): Nav => ({ tab: "ahead", mode }),
  inbox: (followUp: number | null = null): Nav => ({ tab: "inbox", followUp }),
  /** CV-1: Inbox › Conversations (was Requests, and Asks before that). */
  conversations: (): Nav => ({ tab: "inbox", followUp: null, conversations: true }),
  /** CV-1: Inbox › My promises (was Promises). */
  myPromises: (): Nav => ({ tab: "inbox", followUp: null, myPromises: true }),
  /** CV-2: one conversation, selected and scrolled to (#/inbox/conversation/<id>). */
  conversation: (id: number): Nav => ({ tab: "inbox", followUp: null, conversations: true, select: id }),
  /** CV-2: one of my promises, selected and scrolled to (#/inbox/promise/<id>). */
  promise: (id: number): Nav => ({ tab: "inbox", followUp: null, myPromises: true, select: id }),
};
export const HOME: Loc = { nav: navOf.today(), overlay: null };

/** The mode a tab opens in. */
export const defaultNav = (tab: Tab): Nav => (tab === "today" ? navOf.today() : tab === "week" ? navOf.week() : tab === "ahead" ? navOf.ahead() : navOf.inbox());
export const modeOf = (n: Nav): ModeName | null => (n.tab === "week" || n.tab === "ahead" ? n.mode : null);
/** NV-1: the Board focused on a day (Plan the day). */
export const focusOf = (n: Nav): DayFocus | null => (n.tab === "week" && n.mode === "board" ? n.focus : null);

/** Planning places get a Done (or Commit today); the views don't. Today's flows are planning places too (Esc goes back). */
export const isPlanning = (n: Nav): boolean => (n.tab === "today" ? n.flow !== null : n.tab === "week" ? n.mode === "commit" || n.focus !== null : n.tab === "ahead" ? n.mode === "ahead" : false);

/**
 * P: on Week, Board and Commit (a focused day counts as the Board); on Ahead, Roadmap and Plan ahead; on Today, Plan
 * today (the Board focused on today), or back to Today from a flow. The Inbox has none.
 */
export function toggleP(n: Nav): Nav {
  if (n.tab === "today") return n.flow ? navOf.today() : navOf.planDay();
  if (n.tab === "week") return n.mode === "board" ? navOf.week("commit") : navOf.week("board", n.week);
  if (n.tab === "ahead") return navOf.ahead(n.mode === "roadmap" ? "ahead" : "roadmap");
  return n;
}

/** Done in a planning place: Today's flows back to Today, a focused day back to the whole week it is in, Commit back to the Board, Plan ahead back to Roadmap. */
export function afterDone(n: Nav): Nav {
  if (n.tab === "today") return navOf.today();
  if (n.tab === "week") return n.mode === "board" && n.focus?.date ? navOf.week("board", mondayOf(n.focus.date)) : n.mode === "board" ? navOf.week("board", n.week) : navOf.week();
  if (n.tab === "ahead") return navOf.ahead();
  return n;
}

const mondayOf = (d: IsoDate): IsoDate => {
  const p = Temporal.PlainDate.from(d);
  return p.subtract({ days: p.dayOfWeek - 1 }).toString();
};

/** 1–4 switch tabs (T stays Today). */
export function tabForKey(key: string): Tab | null {
  const i = ["1", "2", "3", "4"].indexOf(key);
  return i >= 0 ? TABS[i]! : key === "t" || key === "T" ? "today" : null;
}

/** A mode on the switch: the place it opens. */
export function modeNav(tab: Tab, mode: ModeName): Nav {
  if (tab === "week") return navOf.week(mode as WeekMode);
  if (tab === "ahead") return navOf.ahead(mode as AheadMode);
  return defaultNav(tab);
}

// ---- Addresses ----

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HALF = /^(AM|PM|EVE)$/;
/** A Settings or Admin section: letters, with one hyphen between words (CV-2: "admin-audit", Q-ADM2-4). */
const SECTION = /^[a-z]{2,20}(-[a-z]{2,20})?$/;
const ID = /^[1-9]\d{0,9}$/;
const validDate = (s: string) => {
  if (!DATE.test(s)) return false;
  try {
    Temporal.PlainDate.from(s, { overflow: "reject" });
    return true;
  } catch {
    return false;
  }
};

/**
 * "#/today", "#/today/checkin", "#/today/closeout/2026-10-30", "#/week/2026-11-09", "#/week/day/2026-11-03/PM",
 * "#/week/commit/2026-11-09", "#/ahead/plan", "#/inbox", "#/settings/you", "#/guide/keys".
 */
export function hashOf(l: Loc): string {
  if (l.overlay?.kind === "focus") return "#/focus";
  if (l.overlay?.kind === "settings") return `#/settings/${l.overlay.section}`;
  if (l.overlay?.kind === "guide") return l.overlay.chapter ? `#/guide/${l.overlay.chapter}` : "#/guide";
  const n = l.nav;
  if (n.tab === "today") return ["#/today", n.flow, n.flow === "closeout" ? n.date : null].filter(Boolean).join("/");
  if (n.tab === "week") {
    if (n.mode === "commit") return ["#/week/commit", n.week].filter(Boolean).join("/");
    if (n.focus) return ["#/week/day", n.focus.date, n.focus.date ? n.focus.half : null].filter(Boolean).join("/");
    return ["#/week", n.week].filter(Boolean).join("/");
  }
  if (n.tab === "ahead") return n.mode === "ahead" ? "#/ahead/plan" : "#/ahead";
  if (n.conversations) return n.select ? `#/inbox/conversation/${n.select}` : "#/inbox/conversations";
  if (n.myPromises) return n.select ? `#/inbox/promise/${n.select}` : "#/inbox/my-promises";
  return n.followUp ? `#/inbox/${n.followUp}` : "#/inbox";
}

/**
 * The place in an address, or null for anything unknown (the window then opens Today). NV-1: the addresses before it
 * still land, with their date or id: #/today/plan/<date>/<half> on Week's Board focused on that day, #/week/plan/<week>
 * on Commit, #/roadmap on Ahead, #/roadmap/ahead on Plan ahead, #/conversations and #/my-promises (and the older
 * requests, asks and promises) in the Inbox. App writes the new address in place of the old one.
 */
export function parseHash(hash: string): Loc | null {
  if (typeof hash !== "string" || hash.length > 80) return null;
  const parts = hash.replace(/^#\/?/, "").split("/").filter((p) => p !== "");
  const [tab, a, b, c, ...rest] = parts;
  if (rest.length) return null;
  const plain = (nav: Nav): Loc => ({ nav, overlay: null });
  /** A day, optionally with its block: [date] or [date, half]. */
  const day = (d: string | undefined, h: string | undefined): Loc | null => {
    if (d === undefined) return h === undefined ? plain(navOf.planDay()) : null;
    if (!validDate(d)) return null;
    if (h === undefined) return plain(navOf.planDay(d));
    return HALF.test(h) ? plain(navOf.planDay(d, h as Half)) : null;
  };
  /** A week: [] or [monday]. */
  const week = (mode: WeekMode, w: string | undefined, extra: string | undefined): Loc | null => (extra !== undefined ? null : w === undefined ? plain(navOf.week(mode)) : validDate(w) ? plain(navOf.week(mode, w)) : null);
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
      if (a === "closeout") return c !== undefined ? null : b === undefined ? plain(navOf.today("closeout")) : validDate(b) ? plain(navOf.today("closeout", b)) : null;
      // Before NV-1: Today › Plan.
      if (a === "plan") return day(b, c);
      return null;
    }
    case "week": {
      if (a === undefined) return plain(navOf.week());
      if (a === "day") return day(b, c);
      if (a === "commit" || a === "plan") return week("commit", b, c);
      return b === undefined && validDate(a) ? plain(navOf.week("board", a)) : null;
    }
    case "ahead":
      return b !== undefined ? null : a === undefined ? plain(navOf.ahead()) : a === "plan" ? plain(navOf.ahead("ahead")) : null;
    // Before NV-1: Roadmap and Roadmap › Plan ahead.
    case "roadmap":
      return b !== undefined ? null : a === undefined ? plain(navOf.ahead()) : a === "ahead" ? plain(navOf.ahead("ahead")) : null;
    case "conversations":
    case "requests":
    case "asks":
      return a === undefined ? plain(navOf.conversations()) : null;
    case "my-promises":
    case "promises":
      return a === undefined ? plain(navOf.myPromises()) : null;
    case "inbox":
      if (a === "conversation" || a === "promise") return c === undefined && b !== undefined && ID.test(b) ? plain(a === "conversation" ? navOf.conversation(Number(b)) : navOf.promise(Number(b))) : null;
      return b !== undefined ? null : a === undefined ? plain(navOf.inbox()) : a === "conversations" || a === "requests" || a === "asks" ? plain(navOf.conversations()) : a === "my-promises" || a === "promises" ? plain(navOf.myPromises()) : /^[1-9]\d{0,9}$/.test(a) ? plain(navOf.inbox(Number(a))) : null;
    default:
      return null;
  }
}

/** Two places are the same address (history gets one entry per change of place). */
export const sameLoc = (a: Loc, b: Loc) => hashOf(a) === hashOf(b);

// ---- Where notifications and commands go ----

/**
 * A notification's route (step 15.5) as a place. NV-1: Plan the day opens Week's Board focused on the day, Check-in
 * and Close out open their flow on Today, Plan the week and Look ahead open Commit on their week, Plan ahead and the
 * Direction review open Ahead's Plan ahead, follow-ups the Inbox, the timer and meetings the focus screen, the VM Today
 * with the VM menu open, expiring secrets Settings. Stored routes keep their names.
 */
export function routeLoc(r: Route): { loc: Loc; vmMenu: boolean } {
  const plain = (nav: Nav) => ({ loc: { nav, overlay: null }, vmMenu: false });
  switch (r.view) {
    case "today": return plain(navOf.today());
    case "planday": return plain(navOf.planDay());
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
    case "ahead": return plain(navOf.ahead("ahead"));
    case "planweek": return plain(navOf.week("commit", r.weekStart));
    case "followup": return plain(navOf.inbox(r.id));
    case "settings": return { loc: { nav: navOf.today(), overlay: { kind: "settings", section: r.section } }, vmMenu: false };
  }
}

/** The command menu's views (and older names kept for commands and tests) as places. */
export type ViewName = "today" | "week" | "inbox" | "conversations" | "my_promises" | "requests" | "asks" | "promises" | "roadmap" | "ahead" | "focus" | "capture" | "planday" | "planweek" | "commit" | "settings" | "follow_ups" | "checkin" | "closeout";
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
    case "roadmap": return { nav: navOf.ahead(), overlay: null };
    case "ahead": return { nav: navOf.ahead("ahead"), overlay: null };
    case "planday": return { nav: navOf.planDay(), overlay: null };
    case "planweek":
    case "commit": return { nav: navOf.week("commit"), overlay: null };
    case "checkin": return { nav: navOf.today("checkin"), overlay: null };
    case "closeout": return { nav: navOf.today("closeout"), overlay: null };
    case "focus": return { nav: null, overlay: { kind: "focus" } };
    case "settings": return { nav: null, overlay: { kind: "settings", section: "you" } };
  }
}

/** The day header's Plan / Planned ✓ chip in Week, and "+ Add work" on a block: the Board focused on that day (and block). */
export const planDayNav = (date: IsoDate, half: Half | null = null): Nav => navOf.planDay(date, half);

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

/** F1: the place's plain name for "Include where I am" ("Week › Plan today", "Today › Midday check-in", "Settings: connections", "Guide"). */
export function viewName(loc: Loc): string {
  const n = loc.nav;
  const place =
    n.tab === "today" ? (n.flow ? `${TAB_NAMES.today} › ${FLOW_NAMES[n.flow]}` : TAB_NAMES.today)
    : n.tab === "week" ? (n.mode === "commit" ? `${TAB_NAMES.week} › Commit` : n.focus ? `${TAB_NAMES.week} › Plan ${n.focus.date ?? "today"}` : TAB_NAMES.week)
    : n.tab === "ahead" ? (n.mode === "ahead" ? `${TAB_NAMES.ahead} › Plan ahead` : TAB_NAMES.ahead)
    : n.conversations ? `${TAB_NAMES.inbox} › Conversations` : n.myPromises ? `${TAB_NAMES.inbox} › My promises` : TAB_NAMES.inbox;
  const o = loc.overlay;
  return !o ? place : o.kind === "focus" ? `${place} (focus screen)` : o.kind === "settings" ? `Settings: ${o.section}` : `Guide${o.chapter ? `: ${o.chapter}` : ""}`;
}
