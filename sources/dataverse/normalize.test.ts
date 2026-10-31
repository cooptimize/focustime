import { describe, expect, it } from "vitest";
import accounts from "./fixtures/accounts.json" with { type: "json" };
import focustimes from "./fixtures/focustimes.json" with { type: "json" };
import { normalizeFocusTimes, type AccountRow, type AccountWorkerRef, type FocusTimeRow } from "./normalize.ts";

// Sanitized recorded response: fake GUIDs and names, real shape.
const ME = "d0000000-0000-4000-8000-00000000000a";
const rows = focustimes.value as FocusTimeRow[];
const accts = accounts.value as AccountRow[];

function row(over: Partial<FocusTimeRow>): FocusTimeRow {
  return { ...rows[0]!, ...over };
}

describe("normalizeFocusTimes on the recorded response", () => {
  const { patterns, skipped } = normalizeFocusTimes(rows, accts, ME);

  it("keeps my four patterns and drops the row whose Account Worker is someone else", () => {
    expect(patterns.map((p) => [p.clientName, p.days])).toEqual([
      ["Quiddity", { Mon: "AM" }],
      ["CSC", { Mon: "PM", Tue: "PM" }],
      ["Internal", { Tue: "AM" }],
      ["Example Engineering Partners", { Wed: "AllDay", Thu: "AM" }],
    ]);
    expect(skipped).toEqual([]);
  });

  it("uses the reporting nickname as the client key and name, with the full name kept", () => {
    expect(patterns[1]).toMatchObject({ clientKey: "CSC", clientName: "CSC", clientFullName: "Example Services Corp" });
  });

  it("falls back to the account name when there is no nickname", () => {
    expect(patterns[3]).toMatchObject({ clientKey: "Example Engineering Partners", clientName: "Example Engineering Partners" });
  });

  it("maps dates and treats a null end date as ongoing", () => {
    expect(patterns[0]).toMatchObject({ id: "f0000000-0000-4000-8000-000000000001", startDate: "2026-03-02", endDate: null, active: true });
  });
});

describe("Account Worker fallback", () => {
  const aw = (user: string | null, account: string | null) =>
    ({ coop_accountworkerid: "a1", _coop_user_value: user, _coop_account_value: account }) as AccountWorkerRef;
  const C1 = "c0000000-0000-4000-8000-000000000001";
  const C2 = "c0000000-0000-4000-8000-000000000002";
  const OTHER = "d0000000-0000-4000-8000-00000000000b";

  it.each([
    ["Account Worker user and account win over Focus Time columns", row({ _coop_systemuser_value: OTHER, _coop_account_value: C2, coop_AccountWorker: aw(ME, C1) }), "Quiddity"],
    ["no Account Worker: Focus Time columns are used", row({ _coop_systemuser_value: ME, _coop_account_value: C2, coop_AccountWorker: null }), "CSC"],
    ["Account Worker without user: Focus Time person is used", row({ _coop_systemuser_value: ME, coop_AccountWorker: aw(null, C1) }), "Quiddity"],
    ["Account Worker without account: Focus Time account is used", row({ _coop_account_value: C2, coop_AccountWorker: aw(ME, null) }), "CSC"],
  ])("%s", (_label, r, client) => {
    expect(normalizeFocusTimes([r], accts, ME).patterns.map((p) => p.clientName)).toEqual([client]);
  });

  it("drops a row whose Account Worker names someone else even if Focus Time names me", () => {
    const r = row({ _coop_systemuser_value: ME, coop_AccountWorker: aw(OTHER, C1) });
    expect(normalizeFocusTimes([r], accts, ME).patterns).toEqual([]);
  });

  it("drops a row with no person at all", () => {
    const r = row({ _coop_systemuser_value: null, coop_AccountWorker: aw(null, C1) });
    expect(normalizeFocusTimes([r], accts, ME).patterns).toEqual([]);
  });

  it("skips my row with no client and says why", () => {
    const r = row({ _coop_account_value: null, coop_AccountWorker: aw(ME, null) });
    const out = normalizeFocusTimes([r], accts, ME);
    expect(out.patterns).toEqual([]);
    expect(out.skipped).toEqual([{ id: r.coop_focustimeid, reason: "no client" }]);
  });

  it("keeps a row whose account could not be read, labeled as an unknown client", () => {
    const r = row({ coop_AccountWorker: aw(ME, "c0000000-0000-4000-8000-0000000000ff") });
    expect(normalizeFocusTimes([r], accts, ME).patterns[0]).toMatchObject({ clientName: "Unknown client" });
  });

  it("compares GUIDs without regard to case", () => {
    const r = row({ coop_AccountWorker: aw(ME.toUpperCase(), C1) });
    expect(normalizeFocusTimes([r], accts, ME).patterns).toHaveLength(1);
  });
});

describe("patterns: ongoing, ended, inactive, day parts", () => {
  it("keeps an end date as an inclusive date", () => {
    const p = normalizeFocusTimes([row({ coop_enddate: "2026-11-04" })], accts, ME).patterns[0];
    expect(p?.endDate).toBe("2026-11-04");
  });

  it("marks an inactive row inactive", () => {
    expect(normalizeFocusTimes([row({ statecode: 1 })], accts, ME).patterns[0]?.active).toBe(false);
  });

  it("ignores unknown day part values and reports them", () => {
    const out = normalizeFocusTimes([row({ coop_mondaydaypart: 7, coop_tuesdaydaypart: 3 })], accts, ME);
    expect(out.patterns[0]?.days).toEqual({ Tue: "AllDay" });
    expect(out.skipped).toEqual([{ id: rows[0]!.coop_focustimeid, reason: "unknown day part 7 on Mon" }]);
  });

  it("skips a row with no start date", () => {
    const out = normalizeFocusTimes([row({ coop_startdate: null })], accts, ME);
    expect(out.patterns).toEqual([]);
    expect(out.skipped[0]?.reason).toBe("no start date");
  });

  it("accepts a Date Only value that arrives with a time part", () => {
    const p = normalizeFocusTimes([row({ coop_startdate: "2026-03-02T00:00:00Z" })], accts, ME).patterns[0];
    expect(p?.startDate).toBe("2026-03-02");
  });
});
