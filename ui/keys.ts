// Keyboard rules (step 6.1): F6 regions, O to open the focused work item, and the one list of keys that the
// legend shows and the command menu mirrors. Pure apart from reading elements handed in; no React.
import { isDevOpsUrl } from "./work.ts";

/** Parts of the window F6 moves between, in order. */
export type Region = "top" | "grid" | "panel" | "status";

/**
 * Regions F6 can reach now. The details dialog is modal, so it is the only one while open. While Plan the day
 * is open the rest of the week is dimmed and inert, so the panel stands in for the grid.
 */
export function regionsAvailable(s: { planOpen: boolean; detailsOpen: boolean }): Region[] {
  if (s.detailsOpen) return ["panel"];
  return s.planOpen ? ["top", "panel", "status"] : ["top", "grid", "status"];
}

/** The next region from the current one (F6 forward, Shift+F6 back), wrapping. From outside every region, the first (or last). */
export function nextRegion(current: Region | null, available: readonly Region[], dir: 1 | -1): Region {
  const i = current ? available.indexOf(current) : -1;
  if (i < 0) return dir === 1 ? available[0]! : available.at(-1)!;
  return available[(i + dir + available.length) % available.length]!;
}

/** Selectors per region. The panel is checked before the grid: Plan the day sits inside the grid's element. */
export const REGION_SELECTORS: readonly [Region, string][] = [
  ["panel", ".planday, .detail-panel"],
  ["top", ".topbar"],
  ["grid", ".grid"],
  ["status", ".statusbar"],
];

type Closest = { closest: (sel: string) => unknown } | null | undefined;

export function regionOf(el: Closest): Region | null {
  if (!el) return null;
  for (const [r, sel] of REGION_SELECTORS) if (el.closest(sel)) return r;
  return null;
}

/** Rows that stand for a work item carry these, so O can open whatever has focus inside them. */
export const ITEM_ATTRS = (clientKey: string, url: string | null | undefined) =>
  url && isDevOpsUrl(url) ? { "data-item-client": clientKey, "data-item-url": url } : {};

type ItemEl = { getAttribute: (n: string) => string | null };

/** The work item O opens: the nearest row (or link) around the focused element that carries one. */
export function openTarget(el: { closest: (sel: string) => ItemEl | null } | null | undefined): { clientKey: string; url: string } | null {
  const row = el?.closest("[data-item-url]");
  const clientKey = row?.getAttribute("data-item-client");
  const url = row?.getAttribute("data-item-url");
  return clientKey && url && isDevOpsUrl(url) ? { clientKey, url } : null;
}

// ---------- Who gets a key (step 13.5) ----------
// Global shortcuts never fire while typing, and never reach the views behind an open dialog or menu. Every overlay
// carries data-overlay: "modal" (dialogs, menus, the command menu, the key legend) or "details" (the half-day details,
// which owns the panel region). The overlay handles its own keys, Esc included, and stops them there.

type TypingEl = { tagName?: string; type?: string; isContentEditable?: boolean } | null | undefined;
const NOT_TEXT = new Set(["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "image"]);

/** Is focus in something that takes typed text: a text-like input, a textarea, a select, or contenteditable? */
export function isTypingTarget(el: TypingEl): boolean {
  const tag = el?.tagName?.toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") return !NOT_TEXT.has((el!.type || "text").toLowerCase());
  return !!el?.isContentEditable;
}

export type Overlay = "none" | "details" | "modal";
/** The top overlay, from the markers in the document. */
export function topOverlay(doc: { querySelector: (sel: string) => unknown }): Overlay {
  if (doc.querySelector('[data-overlay="modal"]')) return "modal";
  if (doc.querySelector('[data-overlay="details"]')) return "details";
  return "none";
}

export type KeyIn = { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean };
/**
 * May a window-level shortcut handler act on this key? Never with Ctrl, Alt or Meta (chords have their own
 * handlers), never behind a dialog or menu, only F6 behind the half-day details, and while typing only Esc and F6.
 */
export function globalKeyAllowed(e: KeyIn, target: TypingEl, overlay: Overlay): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  if (overlay === "modal") return false;
  if (overlay === "details") return e.key === "F6";
  if (isTypingTarget(target)) return e.key === "Escape" || e.key === "F6";
  return true;
}

/** Ctrl+K: opens the command menu unless another dialog is on top; toggles the command menu itself closed. */
export const commandKeyAllowed = (overlay: Overlay, commandOpen: boolean) => overlay !== "modal" || commandOpen;

export type KeyRow = {
  keys: string[];
  does: string;
  /** The command menu entry that does the same (its action id), when there is one. */
  command?: string;
};

/** Every key, in one list: the legend shows it, and a test checks the command menu matches. */
export const KEYS: readonly KeyRow[] = [
  { keys: ["←", "→", "↑", "↓"], does: "Move between half-days (↓ from the afternoon reaches the evening)" },
  { keys: ["Enter", "Space"], does: "Details of the selected half-day", command: "ui.details" },
  { keys: ["A"], does: "Add a to-do to the selected block: its DevOps items, an intention or a promise", command: "ui.add_work" },
  { keys: ["Tab", "Shift Tab"], does: "Items and menus of the selected half-day, then on to the next part of the window" },
  { keys: ["F6"], does: "Next region: top bar, week, panel, status bar", command: "ui.region_next" },
  { keys: ["Shift F6"], does: "Previous region", command: "ui.region_prev" },
  { keys: ["O"], does: "Open the focused work item in your browser", command: "ui.open_focused" },
  { keys: ["Shift F10", "Menu"], does: "Actions (⋯) for what has focus" },
  { keys: ["1", "T"], does: "Today: what's next, what's urgent and the day's blocks", command: "view.today" },
  { keys: ["2"], does: "Week: the Board (Plan today) and Plan", command: "view.week" },
  { keys: ["3"], does: "Ahead: features and epics you own (Roadmap), and Plan ahead", command: "roadmap.load" },
  { keys: ["4", "L"], does: "Inbox: what needs you, in one list with views (Needs you, Promises, Waiting on, Captures and drafts and more)", command: "view.inbox" },
  { keys: ["P"], does: "Week: Board and Plan; Ahead: Roadmap and Plan ahead; Today: Plan today (I also works)", command: "view.plan" },
  { keys: ["N", "C"], does: "Quick capture from anywhere: one line, saved at once; then sort it into a promise, a draft story or a draft feature (on a focused day, C is Confirm today)", command: "capture.add" },
  { keys: ["W"], does: "Week › Plan: each client's features for the week (next week by default); again for the Board", command: "view.planweek" },
  { keys: ["C"], does: "Confirm today, on the Board focused on a day", command: "planday.commit" },
  { keys: ["← →"], does: "Previous or next day, on the Board focused on a day" },
  { keys: ["Drag"], does: "A to-do onto a free gap in Today's timeline (widest screens): timebox it there" },
  { keys: ["Enter", "Shift Enter"], does: "In the focused day's type box: a draft story under the chosen feature, or a plain note not in DevOps" },
  { keys: ["J", "K"], does: "Next or previous client in Plan the week, block on a focused day, or item in the Inbox", command: "inbox.key.next" },
  { keys: ["Enter"], does: "In the Inbox: open the item", command: "inbox.key.open" },
  { keys: ["C"], does: "In the Inbox: create a DevOps item for the open item", command: "inbox.key.create" },
  { keys: ["L"], does: "In the Inbox: close the loop on the open promise", command: "inbox.key.close" },
  { keys: ["F"], does: "In the Inbox: change the open promise's due day", command: "inbox.key.due" },
  { keys: ["W"], does: "In the Inbox: put the open promise on my week (Today for a chat promise)", command: "inbox.key.week" },
  { keys: ["H"], does: "In the Inbox: hide the open item for me (nobody else's view changes)", command: "inbox.key.hide" },
  { keys: ["N"], does: "In the Inbox: not needed", command: "inbox.key.not_needed" },
  { keys: ["E"], does: "In the Inbox: done", command: "inbox.key.done" },
  { keys: ["Drag"], does: "In Week › Plan: a row by its handle to reorder, or onto a block chip to pin it there" },
  { keys: ["["], does: "Previous week", command: "week.prev" },
  { keys: ["]"], does: "Next week", command: "week.next" },
  { keys: ["R"], does: "Refresh all sources", command: "week.load" },
  { keys: ["V"], does: "Week: Timelines, the hours the rails show (business hours, 12 hours, 24 hours); H also works; also in Week's ⋯", command: "ui.set_view_range" },
  { keys: ["B"], does: "Week's Board: show or hide the timeline (the hour rail beside each card's to-dos); also beside the modes and in ⋯", command: "ui.set_show_timelines" },
  { keys: ["G"], does: "Week and Today: show or hide personal events (they still count in risk and free time); also in ⋯", command: "ui.set_show_personal" },
  { keys: ["Ctrl K"], does: "Command menu" },
  { keys: ["Ctrl J", "/"], does: "The assistant: ask what's next or about an item, or ask for a change you then confirm (/ when no text field has focus)", command: "assistant.ask" },
  { keys: ["Ctrl +", "Ctrl −", "Ctrl 0"], does: "Text size: larger, smaller, or back to Default (not while typing)", command: "ui.set_text_size" },
  { keys: ["F"], does: "Focus timer: start one, or pause, +15, done, next to-do or stop", command: "timer.start" },
  { keys: ["M"], does: "Today › Midday check-in: today's cards show what still fits, with one suggested move each; again to go back", command: "view.checkin" },
  { keys: ["E"], does: "Today › Close out: its side panel (where you left off, DevOps updates, promises due); again to go back", command: "closeout.load" },
  { keys: [","], does: "Settings (Esc goes back)", command: "settings.load" },
  { keys: ["?"], does: "The Guide: start here, your first day, every area, tours and every key (not while typing)", command: "ui.guide" },
  { keys: ["Esc"], does: "Close the menu or dialog on top; in Plan, a focused day or a flow, back without saving" },
];
