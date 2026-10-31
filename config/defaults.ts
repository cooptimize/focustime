// Default, non-secret settings. Later these are loaded and validated from
// ~/.config/coopilot/config.toml; for step 1 they are compiled in.
import type { WeekConfig } from "../week/types.ts";

export type ClientStyle = { key: string; name: string; shortName: string; color: string };

/** Default client colors until Tanner picks his own (open question). */
export const clients: Record<string, ClientStyle> = {
  wc: { key: "wc", name: "Woodard & Curran", shortName: "WC", color: "#1f9e8f" },
  quiddity: { key: "quiddity", name: "Quiddity", shortName: "Quiddity", color: "#7b68ee" },
  csc: { key: "csc", name: "CSC", shortName: "CSC", color: "#d2892a" },
  internal: { key: "internal", name: "Internal", shortName: "Internal", color: "#4a7fd4" },
};

export const fallbackClientColor = "#8a8f98";

export const weekConfig: WeekConfig = {
  dayShape: { start: "09:00", split: "12:30", end: "17:00", timeZone: "America/New_York" },
  thresholds: { meetingWatchMinutes: 90, meetingAtRiskMinutes: 150, minFocusWindowMinutes: 90 },
  standingBlocks: [{ day: "Mon", half: "AM", clientKey: "internal", clientName: "Internal" }],
};
