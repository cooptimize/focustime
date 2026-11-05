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
});
