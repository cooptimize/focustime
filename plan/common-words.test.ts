// HK-7 (Q-GD2-4): clients named after ordinary words match only as written. Fictional clients: "Summit", "Atlas" and
// "Beacon" are common words; "Fabrikam" and "Adatum" aren't. The default rule, the matcher (sorting holds), replace and
// the exit check (the outgoing side), and the AI guard all follow the client's setting.
import { describe, expect, it } from "vitest";
import { aClientEntry } from "../test/builders/index.ts";
import { exactCaseDefault, isOrdinaryWord } from "./common-words.ts";
import { exitCheck, mentionedClients, replaceMentions } from "./boundary.ts";
import { otherClientMatch } from "../ai/guard.ts";
import { resolveRules, type OrgRow } from "../config/org.ts";

const dir = [
  aClientEntry({ key: "Summit", names: ["Summit"], aliases: ["Summit Co"], projects: ["Peak Ops"], itemIds: [7101], exactCase: true }),
  aClientEntry({ key: "Atlas", names: ["Atlas Freight"], aliases: ["ATF"], projects: [], itemIds: [], exactCase: true }),
  aClientEntry({ key: "Beacon", names: ["Beacon"], projects: [], itemIds: [], exactCase: false }),
  aClientEntry({ key: "Fabrikam", names: ["Fabrikam"], projects: [], itemIds: [] }),
  aClientEntry({ key: "Adatum", names: ["Adatum"], projects: [], itemIds: [] }),
];
const named = (t: string) => mentionedClients(t, "Adatum", dir).map((m) => m.key);

describe("the default rule", () => {
  it("is on for a one-word name that is an ordinary word, off otherwise", () => {
    expect(isOrdinaryWord("Atlas")).toBe(true);
    expect(isOrdinaryWord("summit")).toBe(true);
    expect(isOrdinaryWord("Fabrikam")).toBe(false);
    expect(isOrdinaryWord("Atlas Freight")).toBe(false);
    expect(isOrdinaryWord("Atlas2")).toBe(false);
    expect(exactCaseDefault(["Atlas", "Atlas Freight"])).toBe(true);
    expect(exactCaseDefault(["Fabrikam", "Fabrikam Inc"])).toBe(false);
  });

  it("an admin's choice wins; nothing stored is null (the default rule)", () => {
    const rows = [
      { scope: "client:Atlas", key: "exact_case", value: "false", updatedBy: "a", updatedAt: "2026-11-07T00:00:00Z" } as OrgRow,
      { scope: "client:Fabrikam", key: "exact_case", value: "true", updatedBy: "a", updatedAt: "2026-11-07T00:00:00Z" } as OrgRow,
      { scope: "client:Beacon", key: "aliases", value: "[]", updatedBy: "a", updatedAt: "2026-11-07T00:00:00Z" } as OrgRow,
    ];
    const r = resolveRules(rows, { model: "m", appCapUsd: 1, inviteDomains: [], feedback: null });
    expect([r.clients.Atlas?.exactCase, r.clients.Fabrikam?.exactCase, r.clients.Beacon?.exactCase]).toEqual([false, true, null]);
  });
});

describe("matching only as written (sorting holds)", () => {
  it("the name with its casing matches; the ordinary word doesn't", () => {
    expect(named("Can Summit send the export?")).toEqual(["Summit"]);
    expect(named("The summit is on Tuesday")).toEqual([]);
    expect(named("SUMMIT is loud")).toEqual([]);
    expect(named("We moved the atlas of screens")).toEqual([]);
    expect(named("Atlas wants it Friday")).toEqual(["Atlas"]);
  });

  it("aliases follow the same casing rule", () => {
    expect(named("Summit Co asked")).toEqual(["Summit"]);
    expect(named("summit co asked")).toEqual([]);
    expect(named("ATF called")).toEqual(["Atlas"]);
    expect(named("atf called")).toEqual([]);
  });

  it("a client set off still matches in any case", () => {
    expect(named("the beacon light")).toEqual(["Beacon"]);
    expect(named("fabrikam's rollout")).toEqual(["Fabrikam"]);
  });

  it("DevOps projects and item ids at the exit are unchanged by the setting", () => {
    expect(mentionedClients("peak ops broke, see 7101", "Adatum", dir, { records: true }).map((m) => m.key)).toEqual(["Summit"]);
  });
});

describe("the outgoing checks", () => {
  it("replace takes only the name as written", () => {
    expect(replaceMentions("Summit said the summit moved", "Adatum", dir).text).toBe("another client said the summit moved");
    expect(replaceMentions("summit and beacon", "Adatum", dir)).toEqual({ text: "summit and another client", count: 1 });
  });

  it("the exit check flags Summit, not summit, and links follow the same rule", () => {
    expect(exitCheck(["Plan for the summit"], "Adatum", dir)).toBeNull();
    expect(exitCheck(["Plan for Summit"], "Adatum", dir)?.names).toEqual(["Summit"]);
    expect(exitCheck(["https://example.com/summit/notes"], "Adatum", dir)).toBeNull();
    expect(exitCheck(["https://example.com/Summit/notes"], "Adatum", dir)?.names).toEqual(["Summit"]);
  });

  it("the AI guard's other-client match follows it too", () => {
    expect(otherClientMatch("the summit is Tuesday", "Adatum", dir)).toBeNull();
    expect(otherClientMatch("Summit is Tuesday", "Adatum", dir)?.key).toBe("Summit");
    expect(otherClientMatch("the beacon is lit", "Adatum", dir)?.key).toBe("Beacon");
  });

  it("the client's own words never count, whatever the casing", () => {
    expect(mentionedClients("summit and Summit", "Summit", dir)).toEqual([]);
  });
});
