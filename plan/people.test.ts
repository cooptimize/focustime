import { describe, expect, it } from "vitest";
import { matchCooptimizer } from "./people.ts";

const team = [
  { name: "Jordan Lee", email: "jordan.lee@example.com" },
  { name: "Sam Ortiz", email: "sam.ortiz@example.com" },
  { name: "Sam Ortiz", email: "sam.ortiz2@example.com" },
];

describe("matching DevOps people to Cooptimizers (step 16.4)", () => {
  it("by email first, whatever the display name says", () => {
    expect(matchCooptimizer(team, { email: "JORDAN.LEE@example.com", name: "J. Lee (Contractor)" })?.email).toBe("jordan.lee@example.com");
  });
  it("an email that isn't a Cooptimizer's never falls back to a matching name", () => {
    expect(matchCooptimizer(team, { email: "jordan.lee@contoso.com", name: "Jordan Lee" })).toBeNull();
  });
  it("no email: the display name, only when exactly one Cooptimizer has it", () => {
    expect(matchCooptimizer(team, { name: "jordan lee" })?.email).toBe("jordan.lee@example.com");
    expect(matchCooptimizer(team, { name: "Sam Ortiz" })).toBeNull();
    expect(matchCooptimizer(team, { email: "sam.ortiz2@example.com", name: "Sam Ortiz" })?.email).toBe("sam.ortiz2@example.com");
    expect(matchCooptimizer(team, {})).toBeNull();
  });
});
