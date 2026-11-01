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
  ["panel", ".planday, dialog.details"],
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

export type KeyRow = {
  keys: string[];
  does: string;
  /** The command menu entry that does the same (its action id), when there is one. */
  command?: string;
};

/** Every key, in one list: the legend shows it, and a test checks the command menu matches. */
export const KEYS: readonly KeyRow[] = [
  { keys: ["←", "→", "↑", "↓"], does: "Move between half-days (↓ from PM reaches the evening slot)" },
  { keys: ["Enter", "Space"], does: "Details of the selected half-day", command: "ui.details" },
  { keys: ["Tab", "Shift Tab"], does: "Items and menus of the selected half-day, then on to the next part of the window" },
  { keys: ["F6"], does: "Next region: top bar, week, panel, status bar", command: "ui.region_next" },
  { keys: ["Shift F6"], does: "Previous region", command: "ui.region_prev" },
  { keys: ["O"], does: "Open the focused work item in its client's Edge profile", command: "ui.open_focused" },
  { keys: ["Shift F10", "Menu"], does: "Actions (⋯) for what has focus" },
  { keys: ["1", "T"], does: "Today: now, next and Start focus", command: "view.today" },
  { keys: ["2"], does: "Week: every half-day of the week", command: "view.week" },
  { keys: ["3"], does: "Plan: the ritual for now (Plan the day, Check-in, Close out or Plan the week)", command: "view.plan" },
  { keys: ["4", "L"], does: "Inbox: loops you owe and captures to sort", command: "view.inbox" },
  { keys: ["N"], does: "Quick capture: one line, saved at once; then sort it into a loop, a draft story or a note", command: "capture.add" },
  { keys: ["W"], does: "Plan the week: commit features per client (next week by default)", command: "view.planweek" },
  { keys: ["P"], does: "Plan the day, from anywhere (I also works)", command: "view.planday" },
  { keys: ["C"], does: "Commit, in Plan the day", command: "planday.commit" },
  { keys: ["← →"], does: "Previous or next day, in Plan the day" },
  { keys: ["["], does: "Previous week", command: "week.prev" },
  { keys: ["]"], does: "Next week", command: "week.next" },
  { keys: ["R"], does: "Refresh all sources", command: "week.load" },
  { keys: ["H"], does: "Change the view range: business hours, 12 hours, 24 hours", command: "ui.set_view_range" },
  { keys: ["Ctrl K"], does: "Command menu" },
  { keys: ["F"], does: "Focus timer: start one, or pause, +15, done, next pick or stop", command: "timer.start" },
  { keys: ["M"], does: "Check-in: what still fits today (midday)", command: "view.checkin" },
  { keys: ["E"], does: "Close out: the end of the day (picks, resume notes, loops)", command: "closeout.load" },
  { keys: [","], does: "Settings (Esc goes back to the week)", command: "settings.load" },
  { keys: ["?"], does: "This list of keys", command: "ui.keys" },
  { keys: ["Esc"], does: "Close the menu, dialog or panel on top" },
];
