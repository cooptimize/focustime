// Follow-ups (one overdue, one due today, two later) and a resume note.
import type { DemoSeed } from "./types.ts";

export const followupsSeed: DemoSeed = {
  name: "followups",
  owner: "DM-1 (step 15)",
  seed: async ({ run, day }) => {
    await run("followup.add", { clientKey: "Cooptimize", who: "Jordan Lee", what: "Reply about the proposal timeline", channel: "teams", due: day(-1) });
    await run("followup.add", { clientKey: "Northwind", who: "Dana Morales", what: "Send the export spec for review", channel: "email", due: day(0) });
    await run("followup.add", { clientKey: "Harbor", who: "Chris Park", what: "Confirm the intake form go-live date", channel: "teams", due: day(1) });
    await run("followup.add", { clientKey: "Atlas", who: "Morgan Diaz", what: "Share the delay alert mockups", channel: "email", due: day(3) });
    await run("note.set", { clientKey: "Northwind", date: day(0), note: "CSV export works for orders. Next: the date filter." });
  },
};
