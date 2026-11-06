// Step 16.2, NV-1: where the window is. Four tabs (Today · Week · Ahead · Inbox), a mode switch on Week (Board ·
// Commit) and Ahead (Grid · Gantt · Fix next), Today's two flows, and the full-window overlays (the focus screen, Settings, the Guide). Every place has an address (#/…) so browser back
// and reopening land in the same place. Pure: no DOM, no React; App applies it.
import type { Half, IsoDate } from "../week/types.ts";
import type { Route } from "../plan/notify.ts";
import type { InboxView } from "../plan/inbox-items.ts";

export const TABS = ["today", "week", "ahead", "inbox"] as const;
export type Tab = (typeof TABS)[number];
export const TAB_NAMES: Record<Tab, string> = { today: "Today", week: "Week", ahead: "Ahead", inbox: "Inbox" };

/** NV-1: Today has no modes. Its Midday check-in and Close out are flows its cards open over the same page. */
export const TODAY_FLOWS = ["checkin", "closeout"] as const;
export type TodayFlow = (typeof TODAY_FLOWS)[number];
export const FLOW_NAMES: Record<TodayFlow, string> = { checkin: "Midday check-in", closeout: "Close out" };
/** NV-1: Week's Board (stories onto blocks; a day focused is Plan the day) and Commit (Plan the week). */
/** SR-1: Status, the preview of Monday's status report and the feature updates that feed it. */
export type WeekMode = "board" | "commit" | "team" | "status";
/** AH-1 (D653): Ahead is one model in three modes: Grid (was Roadmap), Gantt (was Plan ahead) and Fix next. */
export type AheadMode = "grid" | "gantt" | "fix" | "backlog";

export const MODE_NAMES = { board: "Board", commit: "Plan", team: "Team", status: "Status", grid: "Grid", gantt: "Gantt", fix: "Gaps", backlog: "Backlog" } as const;
export type ModeName = keyof typeof MODE_NAMES;
/** Each tab's modes, in switch order (Today has none, so no switch). IB-1: the Inbox has views in its rail, not modes. */
export const MODES: Record<Tab, readonly ModeName[]> = { today: [], week: ["board", "commit", "team", "status"], ahead: ["grid", "gantt", "fix", "backlog"], inbox: [] };

/** IB-1: the Inbox's views in its address (#/inbox/needs-you …). */
export const INBOX_VIEW_SLUGS: Record<InboxView, string> = { needs_you: "needs-you", promises: "promises", waiting: "waiting", in_progress: "in-progress", captures: "captures", teammates: "teammates", done: "done", chatter: "chatter" };
const viewOfSlug = (slug: string): InboxView | null => (Object.keys(INBOX_VIEW_SLUGS) as InboxView[]).find((v) => INBOX_VIEW_SLUGS[v] === slug) ?? null;
/** An Inbox item key (plan/inbox-items.ts): v conversation, c chat promise, f promise, s send, k capture, d draft. */
const ITEM_KEY = /^[vcfskd][1-9]\d{0,9}$/;

/** NV-1: the Board focused on one day (Plan the day): `date` null is the default day (today or the next workday); `half` is the block "+ Add work" asked for. */
export type DayFocus = { date: IsoDate | null; half: Half | null };

/**
 * One place. Today's `flow` is a card's flow open over the page (`date`: Close out's day, null for today); with no
 * flow, `date` is the day Today shows (QF-1, #/today/<date>; null: today). Week's
 * `week` is its Monday (null: this week for the Board, next week for Commit); `focus` is the day the Board is
 * focused on (Board only).
 */
export type Nav =
  | { tab: "today"; flow: TodayFlow | null; date: IsoDate | null }
  | { tab: "week"; mode: WeekMode; week: IsoDate | null; focus: DayFocus | null }
  | { tab: "ahead"; mode: AheadMode; item?: number }
  /**
   * IB-1: one list with views. `view` null is the bare #/inbox (the view I last used, Needs you the first time);
   * `item` is the item open in the detail pane (#/inbox/item/<key>), which picks a view it's in when `view` is null.
   */
  | { tab: "inbox"; view: InboxView | null; item: string | null };

/** G1: the Guide sits over a place like Settings; `chapter` is the one to scroll to (null: the top). */
export type Overlay = { kind: "focus" } | { kind: "settings"; section: string } | { kind: "guide"; chapter: string | null } | null;
export type Loc = { nav: Nav; overlay: Overlay };

export const navOf = {
  today: (flow: TodayFlow | null = null, date: IsoDate | null = null): Nav => ({ tab: "today", flow, date: flow === "closeout" || flow === null ? date : null }),
  /** QF-1: Today showing one day (null: today). */
  todayOn: (date: IsoDate | null): Nav => ({ tab: "today", flow: null, date }),
  week: (mode: WeekMode = "board", week: IsoDate | null = null): Nav => ({ tab: "week", mode, week, focus: null }),
  /** NV-1: Plan the day is the Board focused on that day (null: today or the next workday). */
  planDay: (date: IsoDate | null = null, half: Half | null = null): Nav => ({ tab: "week", mode: "board", week: null, focus: { date, half: date ? half : null } }),
  ahead: (mode: AheadMode = "grid"): Nav => ({ tab: "ahead", mode }),
  /** AH-1: one item, selected in the Grid (#/ahead/item/<id>), from a notice. */
  aheadItem: (id: number): Nav => ({ tab: "ahead", mode: "grid", item: id }),
  /** The bare Inbox (the view I last used), or a promise I added or a rule opened, open in the detail pane (was #/inbox/<id>). */
  inbox: (followUp: number | null = null): Nav => ({ tab: "inbox", view: null, item: followUp ? `f${followUp}` : null }),
  /** IB-1: one view of the Inbox (#/inbox/<view>). */
  inboxView: (view: InboxView): Nav => ({ tab: "inbox", view, item: null }),
  /** IB-1: one item open in the detail pane (#/inbox/item/<key>). */
  inboxItem: (key: string, view: InboxView | null = null): Nav => ({ tab: "inbox", view, item: key }),
  /** Captures and drafts (was Inbox › Captures). */
  captures: (): Nav => ({ tab: "inbox", view: "captures", item: null }),
  /** Needs you (was Inbox › Conversations). */
  conversations: (): Nav => ({ tab: "inbox", view: "needs_you", item: null }),
  /** Promises (was Inbox › My promises). */
  myPromises: (): Nav => ({ tab: "inbox", view: "promises", item: null }),
  /** One conversation, open in the detail pane (the old #/inbox/conversation/<id> lands here). */
  conversation: (id: number): Nav => ({ tab: "inbox", view: null, item: `v${id}` }),
  /** One promise found in a chat, open in the detail pane (the old #/inbox/promise/<id> lands here). */
  promise: (id: number): Nav => ({ tab: "inbox", view: null, item: `c${id}` }),
};
export const HOME: Loc = { nav: navOf.today(), overlay: null };

/** The mode a tab opens in. */
export const defaultNav = (tab: Tab): Nav => (tab === "today" ? navOf.today() : tab === "week" ? navOf.week() : tab === "ahead" ? navOf.ahead() : navOf.inbox());
export const modeOf = (n: Nav): ModeName | null => (n.tab === "week" || n.tab === "ahead" ? n.mode : null);
/** NV-1: the Board focused on a day (Plan the day). */
export const focusOf = (n: Nav): DayFocus | null => (n.tab === "week" && n.mode === "board" ? n.focus : null);

/** Planning places get a Done (or Commit today); the views don't. Today's flows are planning places too (Esc goes back). */
export const isPlanning = (n: Nav): boolean => (n.tab === "today" ? n.flow !== null : n.tab === "week" ? n.mode === "commit" || n.focus !== null : false);

/**
 * P: on Week, Board and Commit (a focused day counts as the Board); on Ahead, Grid and Gantt; on Today, Plan
 * today (the Board focused on today), or back to Today from a flow. IB-1: the Inbox has no planning mode, so P does nothing there.
 */
export function toggleP(n: Nav): Nav {
  if (n.tab === "today") return n.flow ? navOf.today() : navOf.planDay();
  if (n.tab === "week") return n.mode === "board" ? navOf.week("commit") : navOf.week("board", n.week);
  if (n.tab === "ahead") return navOf.ahead(n.mode === "gantt" ? "grid" : "gantt");
  return n;
}

/** Done in a planning place: Today's flows back to Today, a focused day back to the whole week it is in, Commit back to the Board, Ahead back to the Grid. */
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

/** IB-1: the Inbox's views by name (the rail, headers, the Guide). */
export const INBOX_VIEW_NAMES: Record<InboxView, string> = { needs_you: "Needs you", promises: "Promises", waiting: "Waiting on", in_progress: "In progress", captures: "Captures and drafts", teammates: "Handled by teammates", done: "Done", chatter: "Chatter" };

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
  if (n.tab === "today") return ["#/today", n.flow, n.flow === "closeout" || n.flow === null ? n.date : null].filter(Boolean).join("/");
  if (n.tab === "week") {
    if (n.mode === "commit") return ["#/week/commit", n.week].filter(Boolean).join("/");
    // SW-1: the client team view.
    if (n.mode === "team") return ["#/week/team", n.week].filter(Boolean).join("/");
    // SR-1: always this week's report (the one Kat sends next Monday).
    if (n.mode === "status") return "#/week/status";
    if (n.focus) return ["#/week/day", n.focus.date, n.focus.date ? n.focus.half : null].filter(Boolean).join("/");
    return ["#/week", n.week].filter(Boolean).join("/");
  }
  if (n.tab === "ahead") return n.mode === "gantt" ? "#/ahead/gantt" : n.mode === "fix" ? "#/ahead/fix" : n.mode === "backlog" ? "#/ahead/backlog" : n.item ? `#/ahead/item/${n.item}` : "#/ahead";
  if (n.item) return `#/inbox/item/${n.item}`;
  return n.view ? `#/inbox/${INBOX_VIEW_SLUGS[n.view]}` : "#/inbox";
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
      // QF-1: Today on one day.
      if (validDate(a) && b === undefined) return plain(navOf.todayOn(a));
      return null;
    }
    case "week": {
      if (a === undefined) return plain(navOf.week());
      if (a === "day") return day(b, c);
      if (a === "commit" || a === "plan") return week("commit", b, c);
      if (a === "team") return week("team", b, c);
      if (a === "status") return b === undefined ? plain(navOf.week("status")) : null;
      return b === undefined && validDate(a) ? plain(navOf.week("board", a)) : null;
    }
    case "ahead":
      if (a === "item") return c === undefined && b !== undefined && ID.test(b) ? plain(navOf.aheadItem(Number(b))) : null;
      // AH-1: #/ahead/plan (Plan ahead before AH-1) lands on the Gantt.
      return b !== undefined ? null : a === undefined ? plain(navOf.ahead()) : a === "gantt" || a === "plan" ? plain(navOf.ahead("gantt")) : a === "fix" || a === "gaps" ? plain(navOf.ahead("fix")) : a === "backlog" ? plain(navOf.ahead("backlog")) : null;
    // Before NV-1: Roadmap and Roadmap › Plan ahead.
    case "roadmap":
      return b !== undefined ? null : a === undefined ? plain(navOf.ahead()) : a === "ahead" ? plain(navOf.ahead("gantt")) : null;
    case "conversations":
    case "requests":
    case "asks":
      return a === undefined ? plain(navOf.conversations()) : null;
    case "my-promises":
    case "promises":
      return a === undefined ? plain(navOf.myPromises()) : null;
    case "inbox": {
      // IB-1: #/inbox/item/<key>. The addresses before it land on the same item or view: #/inbox/conversation/<id>,
      // #/inbox/promise/<id>, #/inbox/<id> (a follow-up, now a promise), and UI-7's modes.
      if (a === "item") return c === undefined && b !== undefined && ITEM_KEY.test(b) ? plain(navOf.inboxItem(b)) : null;
      if (a === "conversation" || a === "promise") return c === undefined && b !== undefined && ID.test(b) ? plain(a === "conversation" ? navOf.conversation(Number(b)) : navOf.promise(Number(b))) : null;
      if (b !== undefined) return null;
      if (a === undefined) return plain(navOf.inbox());
      if (a === "conversations" || a === "requests" || a === "asks") return plain(navOf.conversations());
      if (a === "my-promises") return plain(navOf.myPromises());
      const v = viewOfSlug(a);
      if (v) return plain(navOf.inboxView(v));
      return ID.test(a) ? plain(navOf.inbox(Number(a))) : null;
    }
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
    // Follow-ups due (several): Promises, where they are now.
    case "inbox": return plain(navOf.myPromises());
    case "asks":
    case "requests":
    case "conversations": return plain(navOf.conversations());
    case "my_promises": return plain(navOf.myPromises());
    case "week": return plain(navOf.week());
    case "ahead": return plain(navOf.ahead("gantt"));
    case "aheaditem": return plain(navOf.aheadItem(r.id));
    case "team": return plain(navOf.week("team"));
    case "status": return plain(navOf.week("status"));
    case "planweek": return plain(navOf.week("commit", r.weekStart));
    case "followup": return plain(navOf.inbox(r.id));
    case "settings": return { loc: { nav: navOf.today(), overlay: { kind: "settings", section: r.section } }, vmMenu: false };
  }
}

/** The command menu's views (and older names kept for commands and tests) as places. */
export type ViewName = "today" | "week" | "inbox" | "conversations" | "my_promises" | "requests" | "asks" | "promises" | "roadmap" | "ahead" | "gaps" | "backlog" | "focus" | "capture" | "planday" | "planweek" | "commit" | "team" | "status" | "settings" | "follow_ups" | "checkin" | "closeout";
export function viewNav(v: ViewName): { nav: Nav | null; overlay: Overlay } {
  switch (v) {
    case "today": return { nav: navOf.today(), overlay: null };
    case "week": return { nav: navOf.week(), overlay: null };
    case "inbox": return { nav: navOf.inbox(), overlay: null };
    case "follow_ups": return { nav: navOf.myPromises(), overlay: null };
    case "capture": return { nav: navOf.captures(), overlay: null };
    case "asks":
    case "requests":
    case "conversations": return { nav: navOf.conversations(), overlay: null };
    case "promises":
    case "my_promises": return { nav: navOf.myPromises(), overlay: null };
    case "roadmap": return { nav: navOf.ahead(), overlay: null };
    case "ahead": return { nav: navOf.ahead("gantt"), overlay: null };
    // QF-1: Fix next is called Gaps (the mode's code name stays "fix").
    case "gaps": return { nav: navOf.ahead("fix"), overlay: null };
    // BH-1: the stack-ranked backlog across clients.
    case "backlog": return { nav: navOf.ahead("backlog"), overlay: null };
    case "planday": return { nav: navOf.planDay(), overlay: null };
    case "planweek":
    case "commit": return { nav: navOf.week("commit"), overlay: null };
    case "team": return { nav: navOf.week("team"), overlay: null };
    case "status": return { nav: navOf.week("status"), overlay: null };
    case "checkin": return { nav: navOf.today("checkin"), overlay: null };
    case "closeout": return { nav: navOf.today("closeout"), overlay: null };
    case "focus": return { nav: null, overlay: { kind: "focus" } };
    case "settings": return { nav: null, overlay: { kind: "settings", section: "you" } };
  }
}

/** QF-1: Today's ‹ › and [ ]: the weekday before or after (Saturday and Sunday are stepped over). */
export function stepWeekday(date: IsoDate, dir: 1 | -1): IsoDate {
  let d = Temporal.PlainDate.from(date).add({ days: dir });
  while (d.dayOfWeek > 5) d = d.add({ days: dir });
  return d.toString();
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
    : n.tab === "week" ? (n.mode === "commit" ? `${TAB_NAMES.week} › ${MODE_NAMES.commit}` : n.mode === "team" ? `${TAB_NAMES.week} › Team` : n.mode === "status" ? `${TAB_NAMES.week} › Status` : n.focus ? `${TAB_NAMES.week} › Plan ${n.focus.date ?? "today"}` : TAB_NAMES.week)
    : n.tab === "ahead" ? `${TAB_NAMES.ahead} › ${MODE_NAMES[n.mode]}`
    : n.view ? `${TAB_NAMES.inbox} › ${INBOX_VIEW_NAMES[n.view]}` : TAB_NAMES.inbox;
  const o = loc.overlay;
  return !o ? place : o.kind === "focus" ? `${place} (focus screen)` : o.kind === "settings" ? `Settings: ${o.section}` : `Guide${o.chapter ? `: ${o.chapter}` : ""}`;
}
