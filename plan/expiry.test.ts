import { describe, expect, it } from "vitest";
import { expiringSoon } from "./expiry.ts";

const W = (expires: string, label = "W&C DevOps write access") => ({ key: `pat:${label}`, label, expires, section: "clients" });

describe("expiringSoon (D256)", () => {
  it("names what expires and when, within 14 days, soonest first", () => {
    const r = expiringSoon([W("2026-11-10"), W("2026-11-03", "Dataverse app secret"), W("2026-12-31", "Cooptimize DevOps write access")], "2026-11-01");
    expect(r.map((x) => x.text)).toEqual(["Dataverse app secret expires in 2 days. Update in Settings", "W&C DevOps write access expires in 9 days. Update in Settings"]);
  });
  it("the 14th day counts; the 15th doesn't", () => {
    expect(expiringSoon([W("2026-11-15")], "2026-11-01")).toHaveLength(1);
    expect(expiringSoon([W("2026-11-16")], "2026-11-01")).toHaveLength(0);
  });
  it("tomorrow, today and already expired", () => {
    expect(expiringSoon([W("2026-11-02")], "2026-11-01")[0]!.text).toMatch(/expires tomorrow\./);
    expect(expiringSoon([W("2026-11-01")], "2026-11-01")[0]!.text).toMatch(/expires today\./);
    expect(expiringSoon([W("2026-10-31")], "2026-11-01")[0]!.text).toMatch(/expired 1 day ago\./);
    expect(expiringSoon([W("2026-10-29")], "2026-11-01")[0]!).toMatchObject({ days: -3, section: "clients" });
  });
});
