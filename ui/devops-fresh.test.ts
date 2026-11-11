// DV-2: the status bar's freshness words and which clients moved.
import { describe, expect, it } from "vitest";
import { agoShort, clientLine, freshWords, movedClients, type FreshEntry } from "./devops-fresh.ts";

const NOW = Date.parse("2026-11-11T15:00:00Z");
const at = (s: number) => new Date(NOW - s * 1000).toISOString();
const e = (o: Partial<FreshEntry> & { clientKey: string }): FreshEntry => ({ clientName: o.clientKey, version: "v1", checkedAt: at(40), okAt: at(40), nextAt: null, problem: null, ...o });

describe("DevOps freshness words", () => {
  it("says the stalest client's check, each client on hover", () => {
    const w = freshWords([e({ clientKey: "Contoso" }), e({ clientKey: "Fabrikam", checkedAt: at(240) })], NOW)!;
    expect(w.text).toBe("DevOps checked 4 min ago");
    expect(w.title).toBe("Contoso: checked 40s ago\nFabrikam: checked 4 min ago");
    expect(w.trouble).toBe(false);
  });
  it("names trouble on hover", () => {
    expect(clientLine(e({ clientKey: "Contoso", problem: { kind: "slowed", words: "slowed by DevOps" }, nextAt: new Date(NOW + 4 * 60_000).toISOString() }), NOW)).toBe("Contoso: slowed by DevOps, next check in 4 min");
    expect(clientLine(e({ clientKey: "Contoso", problem: { kind: "refused", words: "x" } }), NOW)).toBe("Contoso: DevOps sign-in was refused");
    expect(freshWords([e({ clientKey: "Contoso", problem: { kind: "refused", words: "x" } })], NOW)!.trouble).toBe(true);
    expect(freshWords([], NOW)).toBeNull();
  });
  it("short times", () => {
    expect(agoShort(at(3), NOW)).toBe("just now");
    expect(agoShort(at(40), NOW)).toBe("40s ago");
    expect(agoShort(at(7200), NOW)).toBe("2 h ago");
  });
  it("a client moved only when its version changed; a client seen for the first time didn't", () => {
    const before = new Map([["Contoso", "v1"], ["Fabrikam", null]]);
    expect(movedClients(before, [{ clientKey: "Contoso", version: "v1" }, { clientKey: "Fabrikam", version: "v2" }, { clientKey: "Tailspin", version: "v9" }])).toEqual(["Fabrikam"]);
  });
});
