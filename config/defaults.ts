// Default, non-secret settings. Later these are loaded and validated from
// ~/.config/focustime/config.toml; for step 1 they are compiled in.
import type { WeekConfig } from "../week/types.ts";
import { legacyHours } from "./schema.ts";

export type ClientStyle = { key: string; name: string; shortName: string; color: string };

/** Default client colors for the sample week (fictional clients); real colors come from config. */
export const clients: Record<string, ClientStyle> = {
  tw: { key: "tw", name: "Tailspin & Wingtip", shortName: "TW", color: "#1f9e8f" },
  proseware: { key: "proseware", name: "Proseware", shortName: "Proseware", color: "#7b68ee" },
  adatum: { key: "adatum", name: "Adatum", shortName: "Adatum", color: "#d2892a" },
  internal: { key: "internal", name: "Internal", shortName: "Internal", color: "#4a7fd4" },
};

export const fallbackClientColor = "#8a8f98";

export const weekConfig: WeekConfig = {
  hours: legacyHours({ start: "09:00", split: "12:00", end: "17:00", timeZone: "America/New_York" }),
  thresholds: { meetingWatchMinutes: 90, meetingAtRiskMinutes: 150, minFocusWindowMinutes: 90 },
  // A1: standing blocks are per person, none by default.
  standingBlocks: [],
};
