// NM-2: the places a pointer in the app's words may name, "Settings › Display" or "Inbox › Promises", read from the
// lists the screens themselves draw. The pointer check (scripts/words-guard.ts, `pointerHits`) fails a "Settings ›",
// "Admin ›", "More ›", "Inbox ›" or "Backlog ›" that names anything else. Pure: no DOM, no React.
import { SECTIONS } from "./settings/registry.ts";
import { ADMIN_UI_SECTIONS } from "./settings/admin-sections.ts";
import { INBOX_LIST_NAMES, MODES, MODE_NAMES } from "./nav.ts";

/**
 * The ⋯ menu's rows (More on the phone), both menus together (ui/App.tsx; ui/places.test.ts checks every label here is
 * drawn there). Install app shows only where the browser can install; Focus screen and Start focus are the phone's.
 */
export const MORE_ITEMS = ["About", "Admin", "Code", "Commands", "Focus screen", "Guide", "Install app", "Keyboard shortcuts", "Notifications", "Send feedback", "Settings", "Start focus", "Status", "Technical docs"] as const;

/** Backlog's toolbar: Needs attention (a chip) and Filter, beside the Grid and Gantt views (ui/ahead/Toolbar.tsx). */
export const BACKLOG_TOOLBAR = ["Needs attention", "Filter", "Search"] as const;

export const PLACES: Readonly<Record<"Settings" | "Admin" | "More" | "Inbox" | "Backlog", readonly string[]>> = {
  // A client's own page (Settings › Clients › <client>) is under Clients.
  Settings: SECTIONS.filter((s) => !s.parent).map((s) => s.label),
  Admin: ADMIN_UI_SECTIONS.map(([, label]) => label),
  More: MORE_ITEMS,
  Inbox: Object.values(INBOX_LIST_NAMES),
  Backlog: [...MODES.ahead.map((m) => MODE_NAMES[m]), ...BACKLOG_TOOLBAR],
};
