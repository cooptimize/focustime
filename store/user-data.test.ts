import { describe, expect, it } from "vitest";
import { STARTER_TOML } from "../fixtures/starter.ts";
import { createAccountStore } from "./accounts.ts";
import { openPlanDb, planStoreOn } from "./plan-store.ts";
import { USER_TABLES } from "./scope.ts";
import { exportUser, hardDeleteDue, NOT_EXPORTED, recordSoftDelete } from "./user-data.ts";
import { createUserSettings } from "./user-settings.ts";

const NY = "America/New_York";
let at = Temporal.Instant.from("2026-11-02T14:30:00Z");
const now = () => at;

function setup() {
  at = Temporal.Instant.from("2026-11-02T14:30:00Z");
  const db = openPlanDb({ path: ":memory:", now: () => now().toZonedDateTimeISO(NY) });
  const accounts = createAccountStore(db, now);
  const person = (id: string) => {
    accounts.users.signedIn({ id, tenantId: "t", upn: `${id}@cooptimize.example`, displayName: id, email: `${id}@cooptimize.example` });
    const plan = planStoreOn(db, { userId: id, now: () => now().toZonedDateTimeISO(NY) });
    plan.addCapture({ text: `${id}'s capture`, clientKey: null });
    plan.addFollowUp({ who: "Sam", what: `${id}'s follow-up`, due: null });
    plan.setAccountState("ms_identity", { oid: id });
    createUserSettings({ db, userId: id, app: { dataverse: null, entra: null, google: null }, person: () => ({ email: null, upn: `${id}@cooptimize.example`, timeZone: NY }), setZone: () => {}, defaultZone: NY, now }).seed(STARTER_TOML);
    return accounts.sessions.create(id);
  };
  return { db, accounts, person };
}

describe("export my data (A2)", () => {
  it("has every table, only this person's rows, and no user id column, session or CSRF token", () => {
    const t = setup();
    const ana = t.person("ana");
    t.person("ben");
    const out = exportUser(t.db, t.accounts.users.get("ana")!, now());
    const text = JSON.stringify(out);
    expect(Object.keys(out.tables as object).sort()).toEqual(USER_TABLES.filter((x) => !NOT_EXPORTED.includes(x)).sort());
    expect(text).toContain("ana's capture");
    expect(text).toContain("ana's follow-up");
    expect(text).not.toContain("ben");
    expect(text).not.toContain('"user_id"');
    expect(text).not.toContain(ana.cookie);
    expect(text).not.toContain(ana.csrf);
    expect((out.tables as Record<string, unknown[]>).user_settings!.length).toBeGreaterThan(0);
    expect(out.you).toMatchObject({ id: "ana", upn: "ana@cooptimize.example" });
  });
});

describe("delete my data (A2)", () => {
  it("soft first (rows kept, a hashed record), then every row removed after 30 days, nobody else's touched", () => {
    const t = setup();
    t.person("ana");
    t.person("ben");
    const count = (id: string) => USER_TABLES.reduce((n, tb) => n + (t.db.prepare(`SELECT count(*) AS n FROM ${tb} WHERE user_id = ?`).get(id) as { n: number }).n, 0);
    const anaRows = count("ana");
    const benRows = count("ben");
    t.accounts.users.setDeleted("ana", now().toString());
    recordSoftDelete(t.db, "ana", now());
    const del = t.db.prepare("SELECT * FROM deletions").all() as { user_hash: string; hard_deleted_at: string | null }[];
    expect(del).toHaveLength(1);
    expect(del[0]!.user_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(del)).not.toContain("ana");
    // 29 days on: still kept.
    at = at.add({ hours: 24 * 29 });
    expect(hardDeleteDue(t.db, now())).toBe(0);
    expect(count("ana")).toBe(anaRows);
    // 30 days on: gone, with the users row; ben untouched.
    at = at.add({ hours: 24 });
    expect(hardDeleteDue(t.db, now())).toBe(1);
    expect(count("ana")).toBe(0);
    expect(t.accounts.users.get("ana")).toBeNull();
    expect(count("ben")).toBe(benRows);
    expect((t.db.prepare("SELECT hard_deleted_at FROM deletions").get() as { hard_deleted_at: string | null }).hard_deleted_at).toBe(now().toString());
    expect(t.db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});
