// no-demo-leak: a calendar that isn't set up reads as exactly that, with where to fix it. Never stand-in meetings (the
// bundled sample week once filled this in, and its fictional meetings counted against real budgets).
import type { CalEvent, SourceResult } from "../week/types.ts";

const NAMES = { outlook: "Outlook", google: "Google Calendar" } as const;

export function calendarNotSetUp(source: "outlook" | "google"): SourceResult<CalEvent> {
  return { source, status: "misconfigured", fetchedAt: null, fromCache: false, items: [], message: `${NAMES[source]} isn't set up yet. Set it up in Settings > Connections`, fixAction: "open_settings" };
}
