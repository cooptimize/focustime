import { describe, expect, it } from "vitest";
import { followState, followedKeys, INTERNAL_CLIENT } from "./follow.ts";
import type { FocusPattern } from "./types.ts";

const TODAY = "2026-11-02";
const p = (clientKey: string, startDate: string, endDate: string | null, active = true): FocusPattern => ({ id: `${clientKey}-${startDate}`, clientKey, clientName: clientKey, startDate, endDate, active, days: { Mon: "AM" } });
const opts = { today: TODAY, graceDays: 14, always: [] as string[], kept: [] as string[] };

describe("which clients Coopilot follows (step 6d)", () => {
  it("an ongoing pattern, even one starting later, makes a client active", () => {
    expect(followState("Adatum", [p("Adatum", "2026-01-05", null)], opts)).toMatchObject({ active: true, why: "ongoing" });
    expect(followState("Adatum", [p("Adatum", "2026-12-01", null)], opts)).toMatchObject({ active: true, why: "ongoing" });
  });

  it("a pattern ending today or later makes it active until that day", () => {
    expect(followState("T&S", [p("T&S", "2026-01-05", TODAY)], opts)).toEqual({ active: true, why: "until", date: TODAY });
    expect(followState("T&S", [p("T&S", "2026-01-05", "2026-12-31")], opts)).toEqual({ active: true, why: "until", date: "2026-12-31" });
  });

  it("an ended pattern keeps it active for the grace days, then not", () => {
    // Ended Oct 19: 14 days later is Nov 2 (today), still followed.
    expect(followState("HME", [p("HME", "2025-01-06", "2026-10-19")], opts)).toEqual({ active: true, why: "grace", date: "2026-10-19", until: "2026-11-02" });
    // Ended Oct 18: grace ran out yesterday.
    expect(followState("HME", [p("HME", "2025-01-06", "2026-10-18")], opts)).toEqual({ active: false, why: "ended", date: "2026-10-18" });
    expect(followState("HME", [p("HME", "2025-01-06", "2026-10-31")], { ...opts, graceDays: 0 })).toEqual({ active: false, why: "ended", date: "2026-10-31" });
  });

  it("the latest pattern wins; inactive rows and other clients' rows don't count", () => {
    const rows = [p("Adatum", "2025-01-06", "2025-06-30"), p("Adatum", "2026-01-05", "2026-12-31"), p("Adatum", "2027-01-04", null, false), p("Other", "2026-01-05", null)];
    expect(followState("Adatum", rows, opts)).toEqual({ active: true, why: "until", date: "2026-12-31" });
    expect(followState("Antigua", rows, opts)).toEqual({ active: false, why: "none" });
  });

  it("Keep following makes an inactive client active; Cooptimize and standing-block clients always are", () => {
    expect(followState("Antigua", [], { ...opts, kept: ["Antigua"] })).toEqual({ active: true, why: "kept" });
    expect(followState(INTERNAL_CLIENT, [], opts)).toEqual({ active: true, why: "internal" });
    expect(followState("Proseware", [], { ...opts, always: ["Proseware"] })).toEqual({ active: true, why: "standing" });
    // A pattern reason is shown before the override.
    expect(followState("Adatum", [p("Adatum", "2026-01-05", null)], { ...opts, kept: ["Adatum"] })).toMatchObject({ why: "ongoing" });
  });

  it("filters a client list to the followed ones, keeping order", () => {
    const rows = [p("Adatum", "2026-01-05", null), p("HME", "2025-01-06", "2026-06-30")];
    const list = ["Adatum", "HME", "Antigua", "Cooptimize", "T&S"].map((clientKey) => ({ clientKey }));
    expect(followedKeys(list, rows, { ...opts, kept: ["T&S"] }).map((c) => c.clientKey)).toEqual(["Adatum", "Cooptimize", "T&S"]);
  });
});
