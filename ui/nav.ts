// Step 16.2, NV-1, WD-1, RF-1, WD-2, BL-1: where the window is. Five tabs (Day · Week · Backlog · Status · Inbox), a view switch
// on Backlog (Grid · Gantt; the code name stays "ahead"), Day's two flows, the block panel on Week and on Day, and the full-window overlays (the focus
// screen, Settings, the Guide). Every place has an address (#/…) so browser back and reopening land in the same place.
// Pure: no DOM, no React; App applies it. WD-1: the code keeps "today" as Day's tab id; people read "Day".
import type { Half, IsoDate } from "../week/types.ts";
import type { Route } from "../plan/notify.ts";
import type { InboxPlace } from "../plan/inbox-items.ts";
import { tourById } from "./guide/tours.ts";
import { DOC_ANCHOR, DOC_CONTENTS, DOC_PAGES, docPageLabel } from "./docs/pages.ts";

export const TABS = ["today", "week", "ahead", "status", "inbox"] as const;
export type Tab = (typeof TABS)[number];
/** WD-1: Today is called Day (the date word "today" stays), and Status is a tab of its own. */
/** BL-1: the Ahead tab is called Backlog (its code name stays "ahead"). */
export const TAB_NAMES: Record<Tab, string> = { today: "Day", week: "Week", ahead: "Backlog", inbox: "Inbox", status: "Status" };

/** NV-1: Today has no modes. Its Midday check-in and Close out are flows its cards open over the same page. */
export const TODAY_FLOWS = ["checkin", "closeout"] as const;
export type TodayFlow = (typeof TODAY_FLOWS)[number];
export const FLOW_NAMES: Record<TodayFlow, string> = { checkin: "Midday check-in", closeout: "Close out" };
/**
 * WD-1: Week is one screen with no mode switch; Team (SW-1) is hidden but keeps its address (#/week/team). Plan mode
 * and Plan the day are gone: adding work is the block panel beside the week.
 */
export type WeekMode = "board" | "team";
/**
 * AH-1 (D653): Ahead is one model in views. BL-1: two, Grid and Gantt; Readiness is the Grid's Needs attention filter
 * and the old Backlog mode is the Grid showing one level as a list.
 */
export type AheadMode = "grid" | "gantt";
/** BL-1: what an old address (#/ahead/fix, #/ahead/backlog) turns on in the Grid when it lands. */
export type AheadPreset = "attention" | "stories";

export const MODE_NAMES = { board: "Week", team: "Team", grid: "Grid", gantt: "Gantt" } as const;
export type ModeName = keyof typeof MODE_NAMES;
/** Each tab's modes, in switch order (Today has none, so no switch). IB-1: the Inbox has views in its rail, not modes. */
export const MODES: Record<Tab, readonly ModeName[]> = { today: [], week: [], ahead: ["grid", "gantt"], inbox: [], status: [] };

/** IB-4: the Inbox's three lists, in its address (#/inbox/chats, #/inbox/promises, #/inbox/captures). */
export const INBOX_LISTS = ["chats", "promises", "captures"] as const;
export type InboxList = (typeof INBOX_LISTS)[number];
export const INBOX_LIST_NAMES: Record<InboxList, string> = { chats: "From chats", promises: "Promises", captures: "Captures" };
/**
 * IB-4: an IB-1 view's nearest list, for the addresses before IB-4 (#/inbox/needs-you …) and stored routes: what was
 * about conversations lands on From chats, In progress on Promises, Everything on the list I used last (null).
 */
export function listOfPlace(v: InboxPlace | InboxList): InboxList | null {
  switch (v) {
    case "everything": return null;
    case "promises": case "in_progress": return "promises";
    case "captures": return "captures";
    default: return "chats";
  }
}
const OLD_SLUGS: Record<string, InboxPlace> = { everything: "everything", "needs-you": "needs_you", waiting: "waiting", "in-progress": "in_progress", teammates: "teammates", done: "done", chatter: "chatter" };
const listOfSlug = (slug: string): InboxList | null | undefined => ((INBOX_LISTS as readonly string[]).includes(slug) ? (slug as InboxList) : slug in OLD_SLUGS ? listOfPlace(OLD_SLUGS[slug]!) : undefined);
/** IB-4: where an item's key lives: a conversation in From chats, a promise in Promises, a capture or draft in Captures. */
export const listOfKey = (key: string): InboxList | null => (key.startsWith("v") ? "chats" : /^[cf]/.test(key) ? "promises" : /^[kd]/.test(key) ? "captures" : null);
/** An Inbox item key (plan/inbox-items.ts): v conversation, c chat promise, f promise, s send, k capture, d draft. */
const ITEM_KEY = /^[vcfskd][1-9]\d{0,9}$/;

/**
 * WD-1: the block panel open on Week, on one block. `date` null: the current block, or the next one that isn't over
 * (App picks it once the week is loaded); `half` null: that day's first block.
 */
export type AddAt = { date: IsoDate | null; half: Half | null };

/**
 * One place. Day's `flow` is a card's flow open over the page (`date`: Close out's day, null for today); with no
 * flow, `date` is the day Day shows (QF-1, #/day/<date>; null: today). Week's `week` is its Monday (null: this
 * week); `add` is the block panel open on a block (WD-1). Status is its own tab (WD-1, was Week › Status).
 */
export type Nav =
  | { tab: "today"; flow: TodayFlow | null; date: IsoDate | null; /** WD-2: the block panel open on this half of `date` (#/day/<date>/<half>). */ half?: Half | null }
  | { tab: "week"; mode: WeekMode; week: IsoDate | null; add: AddAt | null }
  /** SR-3: Status opened on Needs your update (#/status/needs). */
  | { tab: "status"; group?: "needs" }
  | { tab: "ahead"; mode: AheadMode; item?: number; /** BL-1: an old address's filter, applied once on arrival. */ preset?: AheadPreset }
  /**
   * IB-4: three lists. `view` null is the bare #/inbox (the list I used last); `item` is the row open in place
   * (#/inbox/item/<key>), in the list its key belongs to.
   */
  | { tab: "inbox"; view: InboxList | null; item: string | null; late?: LateFilter; /** LP-1: open the item's Close the loop draft (#/inbox/item/<key>/loop: the assistant's link). */ loop?: true };

/** UI-9: Promises narrowed to late ones (from a Week card's "N late" chip), for one client (null: any), not saved. */
export type LateFilter = { client: string | null };

/** G1: the Guide sits over a place like Settings; `chapter` is the one to scroll to (null: the top). */
/** MC-1: a call's review over the place (`occurrence` null: my calls, the ones I review or attend). */
/** UI-5: a Show me tour running over the real screen in `nav` (only highlights and explains; #/guide/tour/<id>). */
export type Overlay = { kind: "focus" } | { kind: "settings"; section: string; setting?: string | null } | { kind: "guide"; chapter: string | null } | { kind: "docs"; page: string | null; heading: string | null } | { kind: "tour"; id: string } | { kind: "meeting"; occurrence: number | null } | { kind: "item"; clientKey: string; itemId: number } | { kind: "patterns" } | null;
export type Loc = { nav: Nav; overlay: Overlay };

export const navOf = {
  today: (flow: TodayFlow | null = null, date: IsoDate | null = null): Nav => ({ tab: "today", flow, date: flow === "closeout" || flow === null ? date : null }),
  /** QF-1: Today showing one day (null: today). */
  todayOn: (date: IsoDate | null): Nav => ({ tab: "today", flow: null, date }),
  /** WD-2: Day on a date with the block panel open on one of its blocks (#/day/<date>/<half>). */
  dayBlock: (date: IsoDate, half: Half): Nav => ({ tab: "today", flow: null, date, half }),
  week: (mode: WeekMode = "board", week: IsoDate | null = null): Nav => ({ tab: "week", mode, week, add: null }),
  /** WD-1: Week with the block panel on a block (null date: the current block, or the next one not over). */
  addWork: (date: IsoDate | null = null, half: Half | null = null): Nav => ({ tab: "week", mode: "board", week: null, add: { date, half: date ? half : null } }),
  /** WD-1: a week with the block panel open (the old Plan the week addresses land here). */
  weekAdd: (week: IsoDate | null = null): Nav => ({ tab: "week", mode: "board", week: week === null ? null : mondayOf(week), add: { date: null, half: null } }),
  /** WD-1: the Status tab (was Week › Status). */
  status: (): Nav => ({ tab: "status" }),
  ahead: (mode: AheadMode = "grid", preset?: AheadPreset): Nav => (preset ? { tab: "ahead", mode, preset } : { tab: "ahead", mode }),
  /** AH-1: one item, selected in the Grid (#/ahead/item/<id>), from a notice. */
  aheadItem: (id: number): Nav => ({ tab: "ahead", mode: "grid", item: id }),
  /** SR-3: Week › Status on its Needs your update group (the nudge's click). */
  statusNeeds: (): Nav => ({ tab: "status", group: "needs" }),
  /** The bare Inbox (the list I used last), or a promise I added or a rule opened, open in Promises (was #/inbox/<id>). */
  inbox: (followUp: number | null = null): Nav => ({ tab: "inbox", view: followUp ? "promises" : null, item: followUp ? `f${followUp}` : null }),
  /** IB-4: one list of the Inbox (#/inbox/<list>); an IB-1 view lands on its nearest list. */
  inboxView: (view: InboxPlace | InboxList): Nav => ({ tab: "inbox", view: listOfPlace(view), item: null }),
  /** UI-9: the Promises view, late ones only, for one client (#/inbox/promises/late/<client>; null: any client). */
  inboxLate: (client: string | null): Nav => ({ tab: "inbox", view: "promises", item: null, late: { client } }),
  /** IB-4: one row open in place (#/inbox/item/<key>), in its own list. A send opens Week › Team, where it is answered. */
  inboxItem: (key: string, _view: InboxPlace | InboxList | null = null): Nav => (key.startsWith("s") ? navOf.week("team") : { tab: "inbox", view: listOfKey(key), item: key }),
  /** Captures (was Captures and drafts). */
  captures: (): Nav => ({ tab: "inbox", view: "captures", item: null }),
  /** From chats (was Needs you, and Conversations before it). */
  conversations: (): Nav => ({ tab: "inbox", view: "chats", item: null }),
  /** Promises (was Inbox › My promises). */
  myPromises: (): Nav => ({ tab: "inbox", view: "promises", item: null }),
  /** One conversation, open in From chats (the old #/inbox/conversation/<id> lands here). */
  conversation: (id: number): Nav => ({ tab: "inbox", view: "chats", item: `v${id}` }),
  /** One promise found in a chat, open in Promises (the old #/inbox/promise/<id> lands here). */
  promise: (id: number): Nav => ({ tab: "inbox", view: "promises", item: `c${id}` }),
};
export const HOME: Loc = { nav: navOf.today(), overlay: null };

/** The mode a tab opens in. */
export const defaultNav = (tab: Tab): Nav => (tab === "today" ? navOf.today() : tab === "week" ? navOf.week() : tab === "ahead" ? navOf.ahead() : tab === "status" ? navOf.status() : navOf.inbox());
/** WD-1: the block panel's block on Week (null: closed). */
export const addOf = (n: Nav): AddAt | null => (n.tab === "week" && n.mode === "board" ? n.add : null);

/** Day's flows are planning places (Esc goes back, Done returns). WD-1: Week has none; its panel closes on Esc. */
export const isPlanning = (n: Nav): boolean => (n.tab === "today" ? n.flow !== null : false);

/**
 * P: on Ahead, Grid and Gantt (Ahead's own planning mode); on Day, back to Day from a flow. WD-1: everywhere else P
 * opens Week with the block panel, and on Week it opens or closes the panel.
 */
export function toggleP(n: Nav): Nav {
  if (n.tab === "today" && n.flow) return navOf.today();
  if (n.tab === "ahead") return navOf.ahead(n.mode === "gantt" ? "grid" : "gantt");
  if (n.tab === "week" && n.mode === "board") return n.add ? navOf.week("board", weekOfAdd(n)) : navOf.weekAdd(n.week);
  return navOf.weekAdd();
}

/** The Monday a Week place shows: its week, else the week of the block its panel is on (null: this week). */
export const weekOfAdd = (n: Extract<Nav, { tab: "week" }>): IsoDate | null => n.week ?? (n.add?.date ? mondayOf(n.add.date) : null);

/** Done in a planning place: Day's flows back to Day, Week's panel closed on its own week, Ahead back to the Grid. */
export function afterDone(n: Nav): Nav {
  if (n.tab === "today") return navOf.today();
  if (n.tab === "week") return navOf.week("board", weekOfAdd(n));
  if (n.tab === "ahead") return navOf.ahead();
  return n;
}

const mondayOf = (d: IsoDate): IsoDate => {
  const p = Temporal.PlainDate.from(d);
  return p.subtract({ days: p.dayOfWeek - 1 }).toString();
};

/** 1–5 switch tabs in their order (RF-1: 4 is Status, 5 the Inbox; T stays Day, L the Inbox). */
export function tabForKey(key: string): Tab | null {
  const i = ["1", "2", "3", "4", "5"].indexOf(key);
  return i >= 0 ? TABS[i]! : key === "t" || key === "T" ? "today" : key === "l" || key === "L" ? "inbox" : null;
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
/** FN-1: a client key in a story card's address. */
const CLIENT_KEY = /^[\p{L}\p{N} ._&'()@-]{1,100}$/u;
/** A setting id, or a client key (Dataverse nicknames: letters, digits, spaces and a little punctuation). */
const SETTING = /^[\p{L}\p{N} ._&'()-]{1,60}$/u;
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
 * "#/day", "#/day/checkin", "#/day/closeout/2026-10-30", "#/week/2026-11-09", "#/week/day/2026-11-03/PM" (the panel on
 * a block), "#/week/2026-11-09/add" (the panel on that week), "#/status", "#/ahead/gantt", "#/inbox", "#/settings/you".
 */
export function hashOf(l: Loc): string {
  if (l.overlay?.kind === "focus") return "#/focus";
  if (l.overlay?.kind === "settings") return l.overlay.section ? `#/settings/${l.overlay.section}${l.overlay.setting ? `/${encodeURIComponent(l.overlay.setting)}` : ""}` : "#/settings";
  if (l.overlay?.kind === "guide") return l.overlay.chapter ? `#/guide/${l.overlay.chapter}` : "#/guide";
  if (l.overlay?.kind === "tour") return `#/guide/tour/${l.overlay.id}`;
  // DOC-1: the Technical docs, at a page and a heading.
  if (l.overlay?.kind === "docs") return ["#/docs", l.overlay.page, l.overlay.page ? l.overlay.heading : null].filter(Boolean).join("/");
  if (l.overlay?.kind === "patterns") return "#/patterns";
  if (l.overlay?.kind === "meeting") return l.overlay.occurrence ? `#/meetings/${l.overlay.occurrence}` : "#/meetings";
  // FN-1: a story card, over the place it opened from.
  if (l.overlay?.kind === "item") return `#/item/${encodeURIComponent(l.overlay.clientKey)}/${l.overlay.itemId}`;
  const n = l.nav;
  if (n.tab === "today") return ["#/day", n.flow, n.flow === "closeout" || n.flow === null ? n.date : null, n.flow === null && n.date ? n.half : null].filter(Boolean).join("/");
  // SR-1, WD-1: always this week's report (the one Kat sends next Monday).
  if (n.tab === "status") return n.group === "needs" ? "#/status/needs" : "#/status";
  if (n.tab === "week") {
    // SW-1: the client team view (hidden in WD-1; its address still opens it).
    if (n.mode === "team") return ["#/week/team", n.week].filter(Boolean).join("/");
    if (n.add?.date) return ["#/week/day", n.add.date, n.add.half].filter(Boolean).join("/");
    if (n.add) return n.week ? `#/week/${n.week}/add` : "#/week/add";
    return ["#/week", n.week].filter(Boolean).join("/");
  }
  // BL-1: the Backlog tab's addresses are #/backlog and #/backlog/gantt (#/ahead… still lands).
  if (n.tab === "ahead") return (n.mode === "gantt" ? "#/backlog/gantt" : n.item ? `#/backlog/item/${n.item}` : "#/backlog") + (aheadQuery ? `?${aheadQuery}` : "");
  if (n.item) return `#/inbox/item/${n.item}${n.loop ? "/loop" : ""}`;
  if (n.late) return n.late.client ? `#/inbox/promises/late/${encodeURIComponent(n.late.client)}` : "#/inbox/promises/late";
  return n.view ? `#/inbox/${n.view}` : "#/inbox";
}

/**
 * The place in an address, or null for anything unknown (the window then opens Today). NV-1: the addresses before it
 * still land, with their date or id: #/today/plan/<date>/<half> on Week's Board focused on that day, #/week/plan/<week>
 * on Commit, #/roadmap on Ahead, #/roadmap/ahead on Plan ahead, #/conversations and #/my-promises (and the older
 * requests, asks and promises) in the Inbox. App writes the new address in place of the old one.
 */
/**
 * AH-6: Ahead's filters and view as its address's query, set by Ahead whenever they change, so every Ahead address
 * (a mode switch, Back, a copied link) carries them. Other tabs' addresses never do.
 */
let aheadQuery = "";
/** The Backlog tab's addresses (#/backlog…, and #/ahead… before BL-1): the only ones that carry a query. */
export const AHEAD_ADDRESS = /^#\/?(ahead|backlog)(\/|$)/;
export const setAheadQuery = (q: string) => void (aheadQuery = q);
/** The query part of an address ("" when there is none). */
export const queryOf = (hash: string) => (hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "");

export function parseHash(full: string): Loc | null {
  if (typeof full !== "string") return null;
  // AH-6: only Ahead's addresses carry a query (its filters and view, #/ahead/gantt?c=northwind&l=epic).
  const qi = full.indexOf("?");
  const hash = qi < 0 ? full : full.slice(0, qi);
  if (qi >= 0 && (!AHEAD_ADDRESS.test(hash) || full.length - qi > 1200)) return null;
  if (hash.length > 160) return null;
  const parts = hash.replace(/^#\/?/, "").split("/").filter((p) => p !== "");
  const [tab, a, b, c, ...rest] = parts;
  if (rest.length) return null;
  const plain = (nav: Nav): Loc => ({ nav, overlay: null });
  /** WD-1: a day's block with the block panel open on it: [date] or [date, half] (was Plan the day). */
  const day = (d: string | undefined, h: string | undefined): Loc | null => {
    if (d === undefined) return h === undefined ? plain(navOf.addWork()) : null;
    if (!validDate(d)) return null;
    if (h === undefined) return plain(navOf.addWork(d));
    return HALF.test(h) ? plain(navOf.addWork(d, h as Half)) : null;
  };
  /** A week: [] or [monday]. */
  const week = (mode: WeekMode, w: string | undefined, extra: string | undefined): Loc | null => (extra !== undefined ? null : w === undefined ? plain(navOf.week(mode)) : validDate(w) ? plain(navOf.week(mode, w)) : null);
  /** WD-1: a week with the block panel open (the old Plan the week addresses). */
  const weekAdd = (w: string | undefined, extra: string | undefined): Loc | null => (extra !== undefined ? null : w === undefined ? plain(navOf.weekAdd()) : validDate(w) ? plain(navOf.weekAdd(w)) : null);
  /** Day and its flows: [] , [checkin], [closeout, date?], [plan, …] (before NV-1) or [date] (QF-1). */
  const dayTab = (): Loc | null => {
    if (a === undefined) return plain(navOf.today());
    if (a === "checkin") return b === undefined ? plain(navOf.today("checkin")) : null;
    if (a === "closeout") return c !== undefined ? null : b === undefined ? plain(navOf.today("closeout")) : validDate(b) ? plain(navOf.today("closeout", b)) : null;
    // Before NV-1: Today › Plan; WD-1: Week with the block panel on that day.
    if (a === "plan") return day(b, c);
    // QF-1: one day.
    if (validDate(a) && b === undefined) return plain(navOf.todayOn(a));
    // WD-2: one day with the block panel on a block.
    if (validDate(a) && b !== undefined && HALF.test(b) && c === undefined) return plain(navOf.dayBlock(a, b as Half));
    return null;
  };
  switch (tab) {
    case undefined:
      return HOME;
    case "focus":
      return a === undefined ? { nav: navOf.today(), overlay: { kind: "focus" } } : null;
    case "settings":
      // ST-1: #/settings (the rail; on a big screen, Profile), #/settings/<section> and #/settings/<section>/<setting>
      // (a setting in it, or a client's own page: #/settings/client/<key>).
      if (a === undefined) return { nav: navOf.today(), overlay: { kind: "settings", section: "" } };
      if (!SECTION.test(a) || c !== undefined) return null;
      if (b === undefined) return { nav: navOf.today(), overlay: { kind: "settings", section: a } };
      try {
        const setting = decodeURIComponent(b);
        return SETTING.test(setting) ? { nav: navOf.today(), overlay: { kind: "settings", section: a, setting } } : null;
      } catch {
        return null;
      }
    case "guide":
      // UI-5: #/guide/tour/<id> opens the tour's screen with the tour over it.
      if (a === "tour") {
        const t = b !== undefined && c === undefined ? tourById(b) : undefined;
        return t ? { nav: t.start, overlay: { kind: "tour", id: t.id } } : null;
      }
      return b !== undefined ? null : a === undefined ? { nav: navOf.today(), overlay: { kind: "guide", chapter: null } } : SECTION.test(a) ? { nav: navOf.today(), overlay: { kind: "guide", chapter: a } } : null;
    // DOC-1: #/docs, #/docs/<page> (#/docs/contents is the phone's list) and #/docs/<page>/<heading>, over Today.
    case "docs": {
      if (c !== undefined) return null;
      const docs = (page: string | null, heading: string | null): Loc => ({ nav: navOf.today(), overlay: { kind: "docs", page, heading } });
      if (a === undefined) return docs(null, null);
      if (a !== DOC_CONTENTS && !DOC_PAGES.some((p) => p.id === a)) return null;
      if (b === undefined) return docs(a, null);
      return a !== DOC_CONTENTS && DOC_ANCHOR.test(b) ? docs(a, b) : null;
    }
    // MC-1: #/meetings (my calls) and #/meetings/<occurrence> (Update <client>'s plan from one call), over Week.
    case "meetings":
      return b !== undefined ? null : a === undefined ? { nav: navOf.week(), overlay: { kind: "meeting", occurrence: null } } : ID.test(a) ? { nav: navOf.week(), overlay: { kind: "meeting", occurrence: Number(a) } } : null;
    // WP-1: #/patterns, the DevOps patterns page, over Today. App opens Today instead when the person's switch is off.
    case "patterns":
      return a === undefined ? { nav: navOf.today(), overlay: { kind: "patterns" } } : null;
    // FN-1: #/item/<client>/<id>, a story card (over Today when opened from a link; App keeps the tab under it).
    case "item": {
      if (a === undefined || b === undefined || c !== undefined || !ID.test(b)) return null;
      try {
        const clientKey = decodeURIComponent(a);
        return CLIENT_KEY.test(clientKey) ? { nav: navOf.today(), overlay: { kind: "item", clientKey, itemId: Number(b) } } : null;
      } catch {
        return null;
      }
    }
    // WD-1: Day (#/day…); every #/today… address before it lands on the same place.
    case "day":
    case "today":
      return dayTab();
    // WD-1: Status is a tab (#/status, #/status/needs).
    case "status":
      return a === undefined ? plain(navOf.status()) : a === "needs" && b === undefined ? plain(navOf.statusNeeds()) : null;
    case "week": {
      if (a === undefined) return plain(navOf.week());
      if (a === "day") return day(b, c);
      // WD-1: #/week/add and #/week/<monday>/add; Plan (#/week/commit, #/week/plan) lands on the week with the panel.
      if (a === "add") return weekAdd(b, c);
      if (a === "commit" || a === "plan") return weekAdd(b, c);
      if (a === "team") return week("team", b, c);
      // SR-1: Week › Status before WD-1.
      if (a === "status") return b === undefined ? plain(navOf.status()) : b === "needs" && c === undefined ? plain(navOf.statusNeeds()) : null;
      if (validDate(a) && b === "add") return c === undefined ? plain(navOf.weekAdd(a)) : null;
      return b === undefined && validDate(a) ? plain(navOf.week("board", a)) : null;
    }
    // BL-1: #/backlog and #/backlog/gantt; every #/ahead address before it lands: #/ahead on the Grid, #/ahead/plan
    // (Plan ahead before AH-1) on the Gantt, #/ahead/fix (Readiness) on the Grid with Needs attention on, and
    // #/ahead/backlog (the Backlog mode) on the Grid showing stories only.
    case "backlog":
    case "ahead":
      if (a === "item") return c === undefined && b !== undefined && ID.test(b) ? plain(navOf.aheadItem(Number(b))) : null;
      if (b !== undefined) return null;
      if (a === undefined || a === "grid") return plain(navOf.ahead());
      if (a === "gantt" || a === "plan") return plain(navOf.ahead("gantt"));
      if (a === "fix" || a === "gaps" || a === "readiness" || a === "attention") return plain(navOf.ahead("grid", "attention"));
      if (a === "backlog" || a === "stories") return plain(navOf.ahead("grid", "stories"));
      return null;
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
      // LP-1: #/inbox/item/<key>/loop opens a promise with its Close the loop draft (only a promise: c or f).
      if (a === "item" && c === "loop") return b !== undefined && /^[cf][1-9]\d{0,9}$/.test(b) ? plain({ tab: "inbox", view: "promises", item: b, loop: true }) : null;
      if (a === "item") return c === undefined && b !== undefined && ITEM_KEY.test(b) ? plain(navOf.inboxItem(b)) : null;
      if (a === "conversation" || a === "promise") return c === undefined && b !== undefined && ID.test(b) ? plain(a === "conversation" ? navOf.conversation(Number(b)) : navOf.promise(Number(b))) : null;
      // UI-9: #/inbox/promises/late and #/inbox/promises/late/<client>.
      if (a === "promises" && b === "late") {
        if (c === undefined) return plain(navOf.inboxLate(null));
        try {
          const client = decodeURIComponent(c);
          return client.length <= 100 && !/[\u0000-\u001f]/.test(client) ? plain(navOf.inboxLate(client)) : null;
        } catch {
          return null;
        }
      }
      if (b !== undefined) return null;
      if (a === undefined) return plain(navOf.inbox());
      if (a === "conversations" || a === "requests" || a === "asks") return plain(navOf.conversations());
      if (a === "my-promises") return plain(navOf.myPromises());
      const v = listOfSlug(a);
      if (v !== undefined) return plain({ tab: "inbox", view: v, item: null });
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
 * A notification's route (step 15.5) as a place. WD-1: Plan the day and Plan the week (and Look ahead) open Week with
 * the block panel (on that week), Check-in and Close out open their flow on Day, Plan ahead and the Direction
 * review open Ahead's Gantt, follow-ups the Inbox, the timer and meetings the focus screen, the VM Day with the VM menu
 * open, expiring secrets Settings, Status the Status tab. Team is hidden: its route opens Week. Stored routes keep
 * their names.
 */
export function routeLoc(r: Route): { loc: Loc; vmMenu: boolean } {
  const plain = (nav: Nav) => ({ loc: { nav, overlay: null }, vmMenu: false });
  switch (r.view) {
    case "today": return plain(navOf.today());
    case "planday": return plain(navOf.addWork());
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
    // WD-1: Team is hidden; a stored Team route opens the week.
    case "team": return plain(navOf.week());
    case "status": return plain(navOf.status());
    case "status_needs": return plain(navOf.statusNeeds());
    case "planweek": return plain(navOf.weekAdd(r.weekStart));
    case "followup": return plain(navOf.inbox(r.id));
    case "settings": return { loc: { nav: navOf.today(), overlay: { kind: "settings", section: r.section } }, vmMenu: false };
    case "meeting": return { loc: { nav: navOf.week(), overlay: { kind: "meeting", occurrence: r.id } }, vmMenu: false };
  }
}

/** The command menu's views (and older names kept for commands and tests) as places. */
export type ViewName = "today" | "week" | "inbox" | "conversations" | "my_promises" | "requests" | "asks" | "promises" | "roadmap" | "ahead" | "gaps" | "backlog" | "focus" | "capture" | "planday" | "planweek" | "commit" | "team" | "status" | "settings" | "follow_ups" | "checkin" | "closeout" | "meetings";
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
    // BL-1: Readiness (Fix next, Gaps) is the Grid's Needs attention; the Backlog mode is the Grid's stories in rank order.
    case "gaps": return { nav: navOf.ahead("grid", "attention"), overlay: null };
    case "backlog": return { nav: navOf.ahead("grid", "stories"), overlay: null };
    // WD-1: the old planning places are Week with the block panel.
    case "planday": return { nav: navOf.addWork(), overlay: null };
    case "planweek":
    case "commit": return { nav: navOf.weekAdd(), overlay: null };
    case "team": return { nav: navOf.week("team"), overlay: null };
    case "status": return { nav: navOf.status(), overlay: null };
    case "checkin": return { nav: navOf.today("checkin"), overlay: null };
    case "closeout": return { nav: navOf.today("closeout"), overlay: null };
    case "focus": return { nav: null, overlay: { kind: "focus" } };
    case "settings": return { nav: null, overlay: { kind: "settings", section: "you" } };
    case "meetings": return { nav: null, overlay: { kind: "meeting", occurrence: null } };
  }
}

/** QF-1: Day's ‹ › and [ ]: the weekday before or after (Saturday and Sunday are stepped over). */
export function stepWeekday(date: IsoDate, dir: 1 | -1, weekend: (d: IsoDate) => boolean = () => false): IsoDate {
  let d = Temporal.PlainDate.from(date).add({ days: dir });
  while (d.dayOfWeek > 5 && !weekend(d.toString())) d = d.add({ days: dir });
  return d.toString();
}

/**
 * WK-3: which weekend days Today's ‹ › and [ ] step onto: every one with Show weekend on, else the ones the loaded week
 * shows (they have something on them). A weekend of another week that isn't loaded is stepped over unless Show
 * weekend is on: the loaded week is what Today knows.
 */
export const weekendStops = (o: { showWeekend: boolean; days: readonly { date: IsoDate; kind: string }[] }) => (d: IsoDate) =>
  o.showWeekend || o.days.some((x) => x.date === d && x.kind === "weekend");

/** WD-1: "+ Add" on a block, and a day's header: Week with the block panel on that day (and block). */
export const addWorkNav = (date: IsoDate, half: Half | null = null): Nav => navOf.addWork(date, half);

/** F1: the place's plain name for "Include where I am" ("Week › Add work", "Day › Midday check-in", "Settings: connections", "Guide"). */
export function viewName(loc: Loc): string {
  const n = loc.nav;
  const place =
    n.tab === "today" ? (n.flow ? `${TAB_NAMES.today} › ${FLOW_NAMES[n.flow]}` : TAB_NAMES.today)
    : n.tab === "status" ? TAB_NAMES.status
    : n.tab === "week" ? (n.mode === "team" ? `${TAB_NAMES.week} › Team` : n.add ? `${TAB_NAMES.week} › Block` : TAB_NAMES.week)
    : n.tab === "ahead" ? `${TAB_NAMES.ahead} › ${MODE_NAMES[n.mode]}`
    : n.view ? `${TAB_NAMES.inbox} › ${INBOX_LIST_NAMES[n.view]}` : TAB_NAMES.inbox;
  const o = loc.overlay;
  return !o ? place : o.kind === "focus" ? `${place} (focus screen)` : o.kind === "settings" ? `Settings: ${o.section}` : o.kind === "meeting" ? "Client calls" : o.kind === "patterns" ? "DevOps patterns" : o.kind === "item" ? `${place} (story card #${o.itemId})` : o.kind === "tour" ? `${place} (Guide tour: ${o.id})` : o.kind === "docs" ? `Technical docs${o.page ? `: ${docPageLabel(o.page)}` : ""}` : `Guide${o.chapter ? `: ${o.chapter}` : ""}`;
}
