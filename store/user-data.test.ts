import { describe, expect, it } from "vitest";
import { forEachDriver } from "../test/db.ts";
import { STARTER_TOML } from "../fixtures/starter.ts";
import { createAccountStore } from "./accounts.ts";
import { BOT_TABLES, createTeamsBotStore } from "./teams-bot-store.ts";
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

describe("export my data (AS-2)", () => {
  it("includes the question the assistant is waiting on (pending_json), only this person's", async () => {
    const t = await setup();
    await t.person("ana");
    await t.person("ben");
    for (const id of ["ana", "ben"]) await planStoreOn(t.db, { userId: id, now: () => now().toZonedDateTimeISO(NY) }).addAssistantTurn({ channel: "panel", role: "assistant", text: "Which client?", cards: [], pending: { kind: "client", owner: `${id}-choice` } });
    const out = (await exportUser(t.db, (await t.accounts.users.get("ana"))!, now())) as { tables: Record<string, { pending_json?: string | null }[]> };
    const turns = out.tables.assistant_turns!;
    expect(turns.map((r) => r.pending_json)).toEqual([JSON.stringify({ kind: "client", owner: "ana-choice" })]);
  });
});

describe("delete my data (A2)", () => {
  it("removes the Teams bot's rows at once (TB-1b), only this person's, and the hard delete takes the rest", async () => {
    const t = await setup();
    await t.person("ana");
    await t.person("ben");
    for (const id of ["ana", "ben"]) {
      const bot = createTeamsBotStore({ db: t.db, userId: id, now });
      await bot.saveChat({ conversationId: `a:${id}`, serviceUrl: "https://smba.trafficmanager.net/amer/", tenantId: "t", botId: "28:bot" });
      await bot.cardSent(`p-${id}`, "msg-1", now().add({ minutes: 15 }).toString(), "Move a date");
      await bot.firstSeen(`act-${id}`);
    }
    const bot = async (id: string) => {
      let n = 0;
      for (const tb of BOT_TABLES) n += Number((await t.db.get(`SELECT COUNT(*) AS n FROM ${tb} WHERE user_id = ?`, [id]))!.n);
      return n;
    };
    expect([await bot("ana"), await bot("ben")]).toEqual([3, 3]);
    await t.accounts.users.setDeleted("ana", now().toString());
    await recordSoftDelete(t.db, "ana", now());
    expect([await bot("ana"), await bot("ben")]).toEqual([0, 3]);
    expect(Number((await t.db.get("SELECT COUNT(*) AS n FROM captures WHERE user_id = ?", ["ana"]))!.n)).toBe(1);
    at = at.add({ hours: 24 * 30 });
    expect(await hardDeleteDue(t.db, now())).toBe(1);
    expect(await bot("ben")).toBe(3);
  });

  it("Clear (Settings › Data › Assistant history) removes the Teams bot's rows too, only this person's (TB-1b)", async () => {
    const t = await setup();
    await t.person("ana");
    await t.person("ben");
    for (const id of ["ana", "ben"]) {
      const bot = createTeamsBotStore({ db: t.db, userId: id, now });
      await bot.saveChat({ conversationId: `a:${id}`, serviceUrl: "https://smba.trafficmanager.net/amer/", tenantId: "t", botId: "28:bot" });
      await bot.cardSent(`p-${id}`, "msg-1", now().add({ minutes: 15 }).toString(), "Move a date");
      await bot.firstSeen(`act-${id}`);
    }
    const bot = async (id: string) => {
      let n = 0;
      for (const tb of BOT_TABLES) n += Number((await t.db.get(`SELECT COUNT(*) AS n FROM ${tb} WHERE user_id = ?`, [id]))!.n);
      return n;
    };
    await planStoreOn(t.db, { userId: "ana", now: () => now().toZonedDateTimeISO(NY) }).clearAssistant();
    expect([await bot("ana"), await bot("ben")]).toEqual([0, 3]);
  });

  it("AS-2: Clear removes a waiting question with the history; another person's stays", async () => {
    const t = await setup();
    await t.person("ana");
    await t.person("ben");
    const store = (id: string) => planStoreOn(t.db, { userId: id, now: () => now().toZonedDateTimeISO(NY) });
    for (const id of ["ana", "ben"]) await store(id).addAssistantTurn({ channel: "panel", role: "assistant", text: "Which client?", cards: [], pending: { kind: "client" } });
    await store("ana").clearAssistant();
    expect(await store("ana").assistantQuestion()).toBeNull();
    expect(await store("ben").assistantQuestion()).toMatchObject({ pending: { kind: "client" } });
  });

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
