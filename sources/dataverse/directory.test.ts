// ADM-1: people's levels and client leads from Dataverse rows (fakes): systemuser.positionid → position.name for the
// level; the account's owner as the primary lead, plus Lead Consultants among its Account Workers.
import { describe, expect, it } from "vitest";
import { buildDirectory } from "./directory.ts";

const g = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const POS = { consultant: g(901), senior: g(902), lead: g(903) };
const positions = [
  { positionid: POS.consultant, name: "Consultant" },
  { positionid: POS.senior, name: "Senior Consultant" },
  { positionid: POS.lead, name: "Lead Consultant" },
];
const user = (n: number, name: string, pos: string | null, aad = true) => ({ systemuserid: g(n), fullname: name, internalemailaddress: `${name.split(" ")[0]!.toLowerCase()}@cooptimize.example`, azureactivedirectoryobjectid: aad ? g(n + 100) : null, _positionid_value: pos });
const users = [user(1, "Ana Lead", POS.lead), user(2, "Ben Lead", POS.lead), user(3, "Cy Senior", POS.senior), user(4, "Di Consultant", POS.consultant), user(5, "Ed Nobody", null), user(6, "No Entra", POS.lead, false)];
const accounts = [
  { accountid: g(501), name: "Contoso Ltd", coop_reportingnickname: "Contoso", _ownerid_value: g(1) },
  { accountid: g(502), name: "Fabrikam Inc", coop_reportingnickname: "Fabrikam", _ownerid_value: g(3) },
];
const workers = [
  { _coop_user_value: g(1), _coop_account_value: g(501) },
  { _coop_user_value: g(2), _coop_account_value: g(501) },
  { _coop_user_value: g(3), _coop_account_value: g(501) },
  { _coop_user_value: g(4), _coop_account_value: g(502) },
];

describe("buildDirectory", () => {
  const d = buildDirectory({ positions, users, accounts, workers, focus: [{ _coop_systemuser_value: g(4), _coop_account_value: g(501) }] });
  it("each person's level from their position; no position, no level; nobody without an Entra id", () => {
    expect(d.people.map((p) => [p.name, p.level, p.positionName])).toEqual([
      ["Ana Lead", "lead", "Lead Consultant"],
      ["Ben Lead", "lead", "Lead Consultant"],
      ["Cy Senior", "senior", "Senior Consultant"],
      ["Di Consultant", "consultant", "Consultant"],
      ["Ed Nobody", null, null],
    ]);
    expect(d.people[0]!.personId).toBe(g(101));
  });
  it("several leads on one client: the owner, and Lead Consultants among the Account Workers", () => {
    const contoso = d.leads.filter((l) => l.clientKey === "Contoso").map((l) => [l.personId, l.source]);
    expect(contoso).toEqual([[g(101), "owner"], [g(101), "lead_worker"], [g(102), "lead_worker"]]);
    // A Senior who owns an account is its lead; a Senior worker isn't.
    expect(d.leads.filter((l) => l.clientKey === "Fabrikam")).toEqual([{ clientKey: "Fabrikam", personId: g(103), source: "owner" }]);
    expect(d.leads.some((l) => l.personId === g(103) && l.clientKey === "Contoso")).toBe(false);
  });
  it("the clients each person works on, from Account Workers and Focus Time", () => {
    expect(d.clients.filter((c) => c.personId === g(104)).map((c) => c.clientKey).sort()).toEqual(["Contoso", "Fabrikam"]);
  });
});
