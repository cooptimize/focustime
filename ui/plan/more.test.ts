// fix/planday-pane: the "More from <client>'s DevOps" section's words, default and per-client memory.
import { describe, expect, it } from "vitest";
import { moreLabel, moreOpenByDefault, NOTHING_PLANNED, possessive, rememberFold, sessionFold } from "./more.ts";

describe("More from <client>'s DevOps", () => {
  it("names the client", () => {
    expect(moreLabel("Proseware")).toBe("More from Proseware's DevOps");
    expect(moreLabel("Adatum")).toBe("More from Adatum's DevOps");
    // Always 's, so initialisms ending in S read right too.
    expect(possessive("Atlas")).toBe("Atlas's");
    expect(possessive("ABS")).toBe("ABS's");
  });
  it("opens on its own only with no musts and no follow-ups above it", () => {
    expect(moreOpenByDefault(0, 0)).toBe(true);
    expect(moreOpenByDefault(1, 0)).toBe(false);
    expect(moreOpenByDefault(0, 2)).toBe(false);
    expect(moreOpenByDefault(3, 1)).toBe(false);
  });
  it("says nothing is planned, with plan the week as the link", () => {
    expect(NOTHING_PLANNED[0]("Proseware") + NOTHING_PLANNED[1] + NOTHING_PLANNED[2]).toBe("Nothing planned for Proseware this week. Pick from DevOps, or plan the week first.");
  });
  it("remembers a fold or unfold per client; nothing remembered reads as none; storage failing is fine", () => {
    const m = new Map<string, string>();
    const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    expect(sessionFold("proseware", store)).toBeNull();
    rememberFold("proseware", false, store);
    rememberFold("cooptimize", true, store);
    expect(sessionFold("proseware", store)).toBe(false);
    expect(sessionFold("cooptimize", store)).toBe(true);
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(sessionFold("x", broken)).toBeNull();
    expect(() => rememberFold("x", true, broken)).not.toThrow();
  });
});
