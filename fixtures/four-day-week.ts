// A test fixture (A1): the week shape many tests were written against, now that the starter config and the no-config
// defaults are neutral (Mon–Fri 9:00–5:00, no standing block). Mon–Thu 9:00–5:00 split at 12:30, Fridays off, and a
// standing Monday AM block for the internal account. Fictional, and only for tests.
import { STARTER_TOML } from "./starter.ts";
import { weekConfig } from "../config/defaults.ts";
import { legacyHours } from "../config/schema.ts";
import type { WeekConfig } from "../week/types.ts";

const swap = (text: string, from: string, to: string) => {
  if (!text.includes(from)) throw new Error(`four-day-week: the starter no longer has ${JSON.stringify(from)}`);
  return text.replace(from, to);
};

export const FOUR_DAY_TOML = swap(
  swap(swap(STARTER_TOML, 'lunch = "12:00-12:00"', 'lunch = "12:30-12:30"'), 'fri = ["09:00-17:00"]', "fri = []"),
  '# [[standing_blocks]]\n# day = "Mon"\n# half = "AM"\n# client = "Cooptimize"',
  '[[standing_blocks]]\nday = "Mon"\nhalf = "AM"\nclient = "Cooptimize"',
);

export const fourDayWeekConfig: WeekConfig = {
  ...weekConfig,
  hours: legacyHours({ start: "09:00", split: "12:30", end: "17:00", timeZone: "America/New_York" }),
  standingBlocks: [{ day: "Mon", half: "AM", clientKey: "internal", clientName: "Internal" }],
};
