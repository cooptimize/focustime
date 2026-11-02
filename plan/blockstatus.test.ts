import { describe, expect, it } from "vitest";
import { blockStatus, roundHours } from "./blockstatus.ts";
import type { Risk } from "../week/types.ts";

const risk = (severity: Risk["severity"], reason = "Out of office") => ({ severity, reason, rule: "ooo" }) as unknown as Risk;

describe("one status per block", () => {
  it("at risk wins, then the fit in calm words (step 15)", () => {
    expect(blockStatus({ kind: "over", by: 80 }, [risk("at_risk")])).toMatchObject({ kind: "at_risk", label: "At risk", detail: "Out of office" });
    expect(blockStatus({ kind: "over", by: 80 }, [risk("watch")])).toMatchObject({ kind: "too_much", label: "About 1h 15m over" });
    expect(blockStatus({ kind: "tight", spare: 20 }, [])).toMatchObject({ kind: "tight", label: "Fits" });
    expect(blockStatus({ kind: "fits", spare: 90 }, [risk("watch")])).toMatchObject({ kind: "fits", label: "Room for about 1h 30m more", detail: null });
    expect(blockStatus({ kind: "over", by: 5 }, [])).toMatchObject({ label: "Fits" });
    expect(blockStatus(null, [])).toMatchObject({ kind: "none", label: "" });
  });
  it("plain amounts", () => {
    expect(roundHours(30)).toBe("30 min");
    expect(roundHours(114)).toBe("2 h");
    expect(roundHours(75)).toBe("1.5 h");
  });
});
