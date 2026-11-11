// ENV-1: Admin › Status on a test site. One row, "This is a test site", listing what runs here only when someone
// presses a button; and, while FOCUSTIME_REQUESTS_POLL declares a watch period, one row saying chat reading is on.
// Registered only outside production (production's Admin › Status is unchanged). Plain words only: no ids or names.
import type { StatusRow, StatusSource } from "../actions/status-rows.ts";
import type { BackgroundPolicy } from "../config/background-policy.ts";

export const TEST_SITE_LINE =
  "Nothing here runs on its own that messages people, spends AI, writes to Teams or reads people's chats, calendars or transcripts on a schedule.";

export function backgroundStatusSource(p: BackgroundPolicy): StatusSource | null {
  if (p.production) return null;
  return {
    id: "background",
    title: "Test site",
    note: TEST_SITE_LINE,
    rows: async (): Promise<StatusRow[]> => [
      {
        id: "test_site",
        label: "This is a test site",
        state: "idle",
        detail: `Only when someone presses a button: ${p.onDemand().join("; ")}. Reminders and Teams messages go only to people who switch on "Send me reminders and Teams messages from this test site". Teams status is never changed from here.`,
        lastCheck: null,
      },
      ...(p.watchPeriod
        ? [{ id: "watch_period", label: "Chat reading is on for a watch period", state: "warn" as const, detail: "FOCUSTIME_REQUESTS_POLL is on, so this test site reads registered client chats every 5 minutes and sorts them with AI. Set it back to off when the watch period ends (docs/azure/runbook.md).", lastCheck: null }]
        : []),
    ],
  };
}
