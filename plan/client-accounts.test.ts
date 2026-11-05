// ADM-2 (D575): which accounts are clients. Active accounts of type Customer, Cooptimize Internal always, an admin's
// Treat as a client; never an account an admin hid. Before the first account read, every key counts.
import { describe, expect, it } from "vitest";
import { anAccount } from "../test/builders/index.ts";
import { clientAccounts } from "./client-accounts.ts";

const INTERNAL = "Cooptimize";
const accounts = [
  anAccount({ clientKey: "Adatum", type: "customer" }),
  anAccount({ clientKey: INTERNAL, type: "customer" }),
  anAccount({ clientKey: "Lead Co", type: null, workers: 0, focus: 0 }),
  anAccount({ clientKey: "Prospect Co", type: "prospect", workers: 0, focus: 0 }),
  anAccount({ clientKey: "Vendor Co", type: "vendor", workers: 0, focus: 0 }),
  anAccount({ clientKey: "Pat Person", type: "partner", workers: 0, focus: 0 }),
];

describe("clientAccounts", () => {
  it("a customer and Cooptimize Internal are clients; a lead, a prospect, a vendor-like and a person-named account aren't", () => {
    const ca = clientAccounts({ accounts, overrides: {}, internal: INTERNAL });
    expect(ca.keys).toEqual(["Adatum", INTERNAL]);
    for (const k of ["Lead Co", "Prospect Co", "Vendor Co", "Pat Person"]) expect(ca.isClient(k)).toBe(false);
    expect(ca.row("Prospect Co")?.why).toBe("not_customer");
  });
  it("Internal is a client even when Dataverse doesn't call it a customer, and can't be hidden", () => {
    const ca = clientAccounts({ accounts: accounts.filter((a) => a.clientKey !== INTERNAL), overrides: { [INTERNAL]: { hidden: true } }, internal: INTERNAL });
    expect(ca.isClient(INTERNAL)).toBe(true);
    expect(ca.row(INTERNAL)?.why).toBe("internal");
  });
  it("Treat as a client adds an account; Hide from FocusTime takes one away, even a customer", () => {
    const ca = clientAccounts({ accounts, overrides: { "Prospect Co": { treatAsClient: true }, Adatum: { hidden: true } }, internal: INTERNAL });
    expect(ca.isClient("Prospect Co")).toBe(true);
    expect(ca.row("Prospect Co")?.why).toBe("treated");
    expect(ca.isClient("Adatum")).toBe(false);
    expect(ca.row("Adatum")?.why).toBe("hidden");
  });
  it("All accounts: every account and every key with settings has a row, clients or not; nothing is dropped", () => {
    const ca = clientAccounts({ accounts, overrides: {}, internal: INTERNAL, extra: ["Old Client"] });
    expect(ca.rows.map((r) => r.clientKey)).toEqual(["Adatum", INTERNAL, "Lead Co", "Old Client", "Pat Person", "Prospect Co", "Vendor Co"]);
    expect(ca.row("Old Client")).toMatchObject({ isClient: false, why: "not_in_dataverse" });
  });
  it("before the first account read, everything counts as a client (nothing disappears)", () => {
    const ca = clientAccounts({ accounts: [], overrides: {}, internal: INTERNAL });
    expect(ca.read).toBe(false);
    expect(ca.isClient("Anything")).toBe(true);
  });
  it("keys match without case, as client keys do elsewhere", () => {
    const ca = clientAccounts({ accounts, overrides: {}, internal: INTERNAL });
    expect(ca.isClient("adatum")).toBe(true);
    expect(ca.isClient("prospect co")).toBe(false);
  });
});
