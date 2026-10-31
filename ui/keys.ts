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
  { keys: ["←", "→", "↑", "↓"], does: "Move between half-days" },
  { keys: ["Enter", "Space"], does: "Details of the selected half-day", command: "ui.details" },
  { keys: ["Tab", "Shift Tab"], does: "Items and menus of the selected half-day, then on to the next part of the window" },
  { keys: ["F6"], does: "Next region: top bar, week, panel, status bar", command: "ui.region_next" },
  { keys: ["Shift F6"], does: "Previous region", command: "ui.region_prev" },
  { keys: ["O"], does: "Open the focused work item in its client's Edge profile", command: "ui.open_focused" },
  { keys: ["Shift F10", "Menu"], does: "Actions (⋯) for what has focus" },
  { keys: ["P"], does: "Plan the day (I also works)", command: "view.planday" },
  { keys: ["C"], does: "Commit, in Plan the day", command: "planday.commit" },
  { keys: ["← →"], does: "Previous or next day, in Plan the day" },
  { keys: ["T"], does: "Go to today", command: "week.today" },
  { keys: ["["], does: "Previous week", command: "week.prev" },
  { keys: ["]"], does: "Next week", command: "week.next" },
  { keys: ["R"], does: "Refresh all sources", command: "week.load" },
  { keys: ["Ctrl K"], does: "Command menu" },
  { keys: ["?"], does: "This list of keys", command: "ui.keys" },
  { keys: ["Esc"], does: "Close the menu, dialog or panel on top" },
];
