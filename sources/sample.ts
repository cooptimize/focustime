// The sample source: serves the bundled fixture as if it came from each real source.
// No network, no accounts, no keyring.
import { sampleGoogle, sampleOutlook, samplePatterns } from "../fixtures/sample-week.ts";
import type { CalEvent, FocusPattern, SourceResult } from "../week/types.ts";

const base = { status: "ok", fetchedAt: null, fromCache: false, sample: true, message: "Sample data" } as const;

export function loadSampleSources(): {
  dataverse: SourceResult<FocusPattern>;
  outlook: SourceResult<CalEvent>;
  google: SourceResult<CalEvent>;
} {
  return {
    dataverse: { ...base, source: "dataverse", items: samplePatterns },
    outlook: { ...base, source: "outlook", items: sampleOutlook },
    google: { ...base, source: "google", items: sampleGoogle },
  };
}
