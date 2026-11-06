// SR-1: Status in the demo. Kat sent each client's report last Monday a few minutes after 7:00 AM ET. This week so far
// (between that send and now): Northwind's Order history export has my update and Priya's, Harbor's Patient intake
// form has Sam's and a Coop update, and the other planned features (Internal reporting refresh, Supplier onboarding,
// Atlas's Shipment tracking dashboard) have nothing yet: "5 features · 2 with an update · 3 without". Last week's
// comments sit folded under some, and the story changes behind the drafts are in the demo's activity log. All
// fictional; the demo's writes go to its in-memory DevOps (sources/demo/devops.ts), so Push all reads back and undoes.
import { lastKatRun } from "../../../plan/status-report.ts";
import { ME_EMAIL, ME_NAME } from "../devops.ts";
import type { DemoClientKey } from "../data.ts";
import type { DemoSeed } from "./types.ts";

/** Minutes after 7:00 AM ET each client's report went out (Kat sends them one after another). */
const SENT_AFTER: Record<DemoClientKey, number> = { Cooptimize: 2, Northwind: 4, Harbor: 6, Atlas: 8 };

/** When Kat last sent this demo client's report: the most recent Monday 7:00 AM ET, plus a few minutes. */
export function demoKatSent(now: string, clientKey: DemoClientKey): string {
  const run = lastKatRun(Temporal.Instant.from(now));
  const sent = run.add({ minutes: SENT_AFTER[clientKey] });
  // Just after 7:00 on a Monday, the send for a later client hasn't gone yet: last week's is the latest.
  return (Temporal.Instant.compare(sent, Temporal.Instant.from(now)) <= 0 ? sent : sent.subtract({ hours: 24 * 7 })).toString();
}

const PRIYA = { by: "priya.shah@example.com", byName: "Priya Shah" };
const SAM = { by: "sam.ortiz@example.com", byName: "Sam Ortiz" };
const ME = { by: ME_EMAIL, byName: ME_NAME };

export const statusSeed: DemoSeed = {
  name: "status",
  owner: "SR-1",
  seed: async ({ ctx, devops }) => {
    if (!devops) return;
    const now = Temporal.Instant.from(ctx.now());
    // A point between the client's last send and now (0 just after the send, 1 now); last week's are a week earlier.
    const thisWeek = (k: DemoClientKey, f: number) => {
      const from = Temporal.Instant.from(demoKatSent(now.toString(), k));
      const span = now.epochMilliseconds - from.epochMilliseconds;
      return Temporal.Instant.fromEpochMilliseconds(from.epochMilliseconds + Math.max(60_000, Math.floor(span * f))).toString();
    };
    const lastWeek = (k: DemoClientKey, days: number) => Temporal.Instant.from(demoKatSent(now.toString(), k)).subtract({ hours: 24 * days }).toString();

    // Northwind · Order history export: mine and Priya's this week, mine last week.
    devops.seedComment(1110, { ...ME, text: "CSV export is merged; filtering by date range is next and should be in review Thursday.", at: thisWeek("Northwind", 0.35) });
    devops.seedComment(1110, { ...PRIYA, text: "The Export button is on the order page in the test site, ready for a look.", at: thisWeek("Northwind", 0.6) });
    devops.seedComment(1110, { ...ME, text: "Export API endpoint is done and deployed to test.", at: lastWeek("Northwind", 3) });
    // Harbor · Patient intake form: Sam's and a Coop update this week.
    devops.seedComment(2210, { ...SAM, text: "Accessibility review booked with the front desk team for next Tuesday.", at: thisWeek("Harbor", 0.4) });
    devops.seedComment(2210, { ...ME, text: "[Coop update v1]\nInsurance card upload: the image upload works on phones; the size check is still open.", at: thisWeek("Harbor", 0.5) });
    // Cooptimize · Internal reporting refresh: last week only.
    devops.seedComment(4410, { ...ME, text: "Timesheet summary query runs in under a second on last month's data.", at: lastWeek("Cooptimize", 2) });

    // The story activity the drafts and hints are built from.
    devops.seedActivity({ clientKey: "Northwind", itemId: 1111, kind: "state", oldValue: "Active", newValue: "Resolved", changedAt: thisWeek("Northwind", 0.3), mine: true });
    devops.seedActivity({ clientKey: "Cooptimize", itemId: 4411, kind: "state", oldValue: "New", newValue: "Active", changedAt: thisWeek("Cooptimize", 0.5), mine: true });
    devops.seedActivity({ clientKey: "Cooptimize", itemId: 4411, kind: "comments", oldValue: "0", newValue: "1", changedAt: thisWeek("Cooptimize", 0.55), mine: true });
    devops.seedActivity({ clientKey: "Atlas", itemId: 3311, kind: "state", oldValue: "New", newValue: "Active", changedAt: thisWeek("Atlas", 0.4), mine: true });
    devops.seedActivity({ clientKey: "Harbor", itemId: 2211, kind: "state", oldValue: "New", newValue: "Active", changedAt: thisWeek("Harbor", 0.2), mine: false });
  },
};
