// week.load (docs/spec.md section 5). Step 1 reads only the sample source.
import { weekConfig } from "../config/defaults";
import { loadSampleSources } from "../sources/sample";
import { buildWeek } from "../week/build";
import type { SourceResult, Week } from "../week/types";

export type WeekLoadResult = { week: Week; sources: SourceResult<unknown>[] };

export function weekLoad(weekStart: string): WeekLoadResult {
  const s = loadSampleSources();
  const week = buildWeek({ weekStart, patterns: s.dataverse.items, events: [...s.outlook.items, ...s.google.items], config: weekConfig });
  return { week, sources: [s.dataverse, s.outlook, s.google] };
}
