// ADM-1: levelOf, clientLeads and isClientLead over the directory and admins' overrides.
import { describe, expect, it } from "vitest";
import { levels } from "./levels.ts";

const A = "00000000-0000-4000-8000-0000000000a1";
const B = "00000000-0000-4000-8000-0000000000b2";
const C = "00000000-0000-4000-8000-0000000000c3";

describe("levels", () => {
  const lv = levels({
    directory: [{ personId: A, level: "lead" }, { personId: B, level: "consultant" }, { personId: C, level: null }],
    leads: [{ clientKey: "contoso", personId: A, source: "owner" }, { clientKey: "contoso", personId: A, source: "lead_worker" }, { clientKey: "contoso", personId: B, source: "lead_worker" }, { clientKey: "fabrikam", personId: B, source: "owner" }],
    overrides: [
      { personId: C, kind: "level", clientKey: "", value: "senior" },
      { personId: C, kind: "lead_add", clientKey: "contoso", value: null },
      { personId: B, kind: "lead_remove", clientKey: "contoso", value: null },
    ],
  });
  it("level: an override over Dataverse, with its source", () => {
    expect(lv.levelOf(A)).toEqual({ level: "lead", source: "dataverse", dataverse: "lead" });
    expect(lv.levelOf(C.toUpperCase())).toEqual({ level: "senior", source: "override", dataverse: null });
    expect(lv.levelOf(null)).toEqual({ level: null, source: null, dataverse: null });
  });
  it("a client's leads: the owner first (primary), each with why; removed ones gone, added ones in", () => {
    expect(lv.clientLeads("contoso")).toEqual([{ personId: A, why: ["owner", "lead_worker"], primary: true }, { personId: C, why: ["override"], primary: false }]);
    expect(lv.isClientLead(B, "contoso")).toBe(false);
    expect(lv.isClientLead(B, "fabrikam")).toBe(true);
    expect(lv.removed(B, "contoso")).toBe(true);
    expect(lv.leadsOf(B)).toEqual([{ clientKey: "fabrikam", why: ["owner"], primary: true }]);
  });
  it("ADM-2: owning a prospect never makes a lead; only clients have leads", () => {
    const l = levels({ directory: [{ personId: A, level: "lead" }], leads: [{ clientKey: "contoso", personId: A, source: "owner" }, { clientKey: "prospect", personId: A, source: "owner" }], overrides: [{ personId: A, kind: "lead_add", clientKey: "vendor", value: null }], isClient: (k) => k === "contoso" });
    expect(l.leadsOf(A).map((x) => x.clientKey)).toEqual(["contoso"]);
    expect(l.isClientLead(A, "prospect")).toBe(false);
  });
  it("ADM-2: a guest or automation account has no level and leads nothing; a signed-in person matched by email has their Dataverse level", () => {
    const l = levels({
      directory: [
        { personId: A, level: "lead", email: "a@contoso.example" },
        { personId: B, level: "lead", email: "b@partner.example", guest: true },
        { personId: C, level: "lead", email: "c@contoso.example" },
      ],
      leads: [{ clientKey: "contoso", personId: B, source: "owner" }, { clientKey: "contoso", personId: C, source: "owner" }],
      overrides: [],
      automation: [C],
      domains: ["contoso.example"],
      signedIn: [{ id: "00000000-0000-4000-8000-0000000000f6", email: "a@contoso.example", upn: null }],
    });
    expect(l.levelOf("00000000-0000-4000-8000-0000000000f6").level).toBe("lead");
    expect(l.levelOf(B).level).toBeNull();
    expect(l.clientLeads("contoso")).toEqual([]);
  });
  it("ADM-2: Lead Consultants among the Account Workers lead (by the mapped level); Focus Time alone doesn't", () => {
    const l = levels({ directory: [{ personId: A, positionName: "Lead Consultant" }, { personId: B, positionName: "Lead Consultant" }], leads: [], overrides: [], clients: [{ personId: A, clientKey: "contoso", worker: true }, { personId: B, clientKey: "contoso", worker: false }], positionLevel: (n) => (n === "Lead Consultant" ? "lead" : null) });
    expect(l.clientLeads("contoso")).toEqual([{ personId: A, why: ["lead_worker"], primary: false }]);
  });
});
