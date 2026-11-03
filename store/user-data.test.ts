import { describe, expect, it } from "vitest";
import { forEachDriver } from "../test/db.ts";
import { STARTER_TOML } from "../fixtures/starter.ts";
import { createAccountStore } from "./accounts.ts";
import { planStoreOn } from "./plan-store.ts";
import { USER_TABLES } from "./scope.ts";
import { exportUser, hardDeleteDue, NOT_EXPORTED, recordSoftDelete } from "./user-data.ts";
import { createUserSettings } from "./user-settings.ts";

const NY = "America/New_York";
let at = Temporal.Instant.from("2026-11-02T14:30:00Z");
const now = () => at;

await forEachDriver("my data", ({ driver, open }) => {
async function setup() {
  at = Temporal.Instant.from("2026-11-02T14:30:00Z");
  const db = (await open()).conn;
  const accounts = createAccountStore(db, now);
  const person = async (id: string) => {
    await accounts.users.signedIn({ id, tenantId: "t", upn: `${id}@cooptimize.example`, displayName: id, email: `${id}@cooptimize.example` });
    const plan = planStoreOn(db, { userId: id, now: () => now().toZonedDateTimeISO(NY) });
    (await plan.addCapture({ text: `${id}'s capture`, clientKey: null }));
    (await plan.addFollowUp({ who: "Sam", what: `${id}'s follow-up`, due: null }));
    (await plan.setAccountState("ms_identity", { oid: id }));
    await createUserSettings({ db, userId: id, app: { dataverse: null, entra: null, google: null }, person: () => ({ email: null, upn: `${id}@cooptimize.example`, timeZone: NY }), setZone: () => {}, defaultZone: NY, now }).seed(STARTER_TOML);
    return await accounts.sessions.create(id);
  };
  return { db, accounts, person };
}

describe("export my data (A2)", () => {
  it("has every table, only this person's rows, and no user id column, session or CSRF token", async () => {
    const t = await setup();
    const ana = (await t.person("ana"));
    await t.person("ben");
    const out = await exportUser(t.db, (await t.accounts.users.get("ana"))!, now());
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
  it("soft first (rows kept, a hashed record), then every row removed after 30 days, nobody else's touched", async () => {
    const t = await setup();
    await t.person("ana");
    await t.person("ben");
    const count = async (id: string) => {
      let n = 0;
      for (const tb of USER_TABLES) n += Number((await t.db.get(`SELECT COUNT(*) AS n FROM ${tb} WHERE user_id = ?`, [id]))!.n);
      return n;
    };
    const anaRows = await count("ana");
    const benRows = await count("ben");
    await t.accounts.users.setDeleted("ana", now().toString());
    await recordSoftDelete(t.db, "ana", now());
    const del = (await t.db.all("SELECT * FROM deletions")) as { user_hash: string; hard_deleted_at: string | null }[];
    expect(del).toHaveLength(1);
    expect(del[0]!.user_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(del)).not.toContain("ana");
    // 29 days on: still kept.
    at = at.add({ hours: 24 * 29 });
    expect((await hardDeleteDue(t.db, now()))).toBe(0);
    expect(await count("ana")).toBe(anaRows);
    // 30 days on: gone, with the users row; ben untouched.
    at = at.add({ hours: 24 });
    expect((await hardDeleteDue(t.db, now()))).toBe(1);
    expect(await count("ana")).toBe(0);
    expect((await t.accounts.users.get("ana"))).toBeNull();
    expect(await count("ben")).toBe(benRows);
    expect((await t.db.get("SELECT hard_deleted_at FROM deletions"))!.hard_deleted_at).toBe(now().toString());
    if (driver === "sqlite") expect(await t.db.all("PRAGMA foreign_key_check")).toEqual([]);
  });
});
});
