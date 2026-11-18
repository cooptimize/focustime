// NM-2: the places a pointer in the app's words may name, "Settings › Display" or "Inbox › Promises", read from the
// lists the screens themselves draw. The pointer check (scripts/words-guard.ts, `pointerHits`) fails a "Settings ›",
// "Admin ›", "More ›", "Inbox ›" or "Backlog ›" that names anything else. Pure: no DOM, no React.
import { SECTIONS } from "./settings/registry.ts";
import { ADMIN_POINTER_NAMES } from "./settings/admin/places.ts";
import { INBOX_LIST_NAMES, MODES, MODE_NAMES } from "./nav.ts";
import { PHONE_TEXT } from "../plan/phone-now.ts";

/**
 * MC-3: Calls left the computer's ⋯ for a tab of its own (the phone's More keeps it, first).
 * The computer's ⋯ menu's rows (ui/App.tsx; ui/places.test.ts checks every label here is drawn there). Install app
 * shows only where the browser can install.
 */
export const MORE_ITEMS = ["About", "Admin", "Commands", "Guide", "Install app", "Keyboard shortcuts", "Notifications", "Send feedback", "Technical docs"] as const;

/** PH-1: the phone's More screen's rows and Everything else's, by their words (plan/phone-now.ts). */
const R = PHONE_TEXT.rows;
const E = PHONE_TEXT.else;
export const PHONE_MORE_ITEMS: readonly string[] = [R.calls, R.backlog, R.status, R.code, R.vm, R.settings, R.guide, R.everything, R.desktop, E.notifications, E.sources, E.focus, E.checkin, E.closeout, E.install, E.docs, E.about, E.admin];

/** Backlog's toolbar: Needs attention (a chip) and Filter, beside the Grid and Gantt views (ui/ahead/Toolbar.tsx). */
export const BACKLOG_TOOLBAR = ["Needs attention", "Filter", "Search"] as const;

export const PLACES: Readonly<Record<"Settings" | "Admin" | "More" | "Inbox" | "Backlog", readonly string[]>> = {
  // A client's own page (Settings › Clients › <client>) is under Clients.
  Settings: SECTIONS.filter((s) => !s.parent).map((s) => s.label),
  // SA-4: Admin's five parts (a part's tabs after it are checked by the pointer check too).
  Admin: ADMIN_POINTER_NAMES,
  More: [...new Set([...MORE_ITEMS, ...PHONE_MORE_ITEMS])],
  Inbox: Object.values(INBOX_LIST_NAMES),
  Backlog: [...MODES.ahead.map((m) => MODE_NAMES[m]), ...BACKLOG_TOOLBAR],
};
