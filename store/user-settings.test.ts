import { describe, expect, it } from "vitest";
import { joinSettings, personalRows, splitSettings } from "../config/sections.ts";
import { setValue } from "../config/edit.ts";
import { parseConfig } from "../config/schema.ts";
import { settingsEdit } from "../config/settings.ts";
import { starterToml } from "../config/starter.ts";
import { STARTER_TOML } from "../fixtures/starter.ts";
import { addUsers, forEachDriver } from "../test/db.ts";
import type { Conn } from "./sql/conn.ts";
import { createUserSettings, SETTINGS_PLACE, type AppKeys } from "./user-settings.ts";

const NY = "America/New_York";
const now = () => Temporal.Instant.from("2026-11-02T14:30:00Z");
const APP: AppKeys = {
  dataverse: { environmentUrl: "https://contoso.crm.dynamics.com", tenantId: "11111111-1111-4111-8111-111111111111", clientId: "22222222-2222-4222-8222-222222222222" },
  entra: { tenantId: "11111111-1111-4111-8111-111111111111", clientId: "33333333-3333-4333-8333-333333333333" },
  google: { clientId: "123-abc.apps.googleusercontent.com" },
};

async function setup(open: () => Promise<{ conn: Conn }>, app: AppKeys = APP) {
  const db = (await open()).conn;
  await addUsers(db, "ana", "ben");
  const people = new Map<string, { email: string | null; upn: string; timeZone: string | null }>();
  const make = (userId: string) => {
    people.set(userId, { email: `${userId}@cooptimize.example`, upn: `${userId}@cooptimize.example`, timeZone: null });
    return createUserSettings({ db, userId, app, person: () => people.get(userId)!, setZone: (z) => void (people.get(userId)!.timeZone = z), defaultZone: "America/Chicago", now });
  };
  return { db, people, make };
}

describe("settings sections (A2)", () => {
  it("splits text by top-level section and puts it back together", () => {
    const rows = splitSettings(STARTER_TOML);
    expect(rows.map((r) => r.section)).toContain("hours");
    const again = joinSettings(rows);
    expect(parseConfig(again.replace('my_email = ""', 'my_email = "a@b.example"'))).toMatchObject({ ok: true });
    // [[hours.override]] and [hours] are one section; a quoted table name keeps its root.
    const t = '[hours]\nlunch = "12:00-13:00"\n\n[[hours.override]]\ndate = "2026-11-03"\n\n# Clients\n[clients."T&W"]\ncolor = "teal"\n';
    expect(splitSettings(t).map((r) => r.section)).toEqual(["hours", "clients"]);
    expect(splitSettings(t)[1]!.body.startsWith("# Clients")).toBe(true);
  });

  it("keeps no app-level key in a person's rows", () => {
    const body = personalRows(STARTER_TOML).map((r) => r.body).join("\n");
    expect(body).not.toMatch(/^\s*(environment_url|tenant_id|client_id)\s*=/m);
    expect(personalRows(STARTER_TOML).map((r) => r.section)).not.toContain("outlook");
    expect(body).toContain("my_email");
  });
});

await forEachDriver("a person's settings in the store (A2)", ({ open }) => {
  it("is seeded once and completed with the app's keys and the person's sign-in", async () => {
    const t = await setup(open);
    const s = t.make("ana");
    expect((await s.has())).toBe(false);
    await s.seed(STARTER_TOML);
    expect((await s.has())).toBe(true);
    const loaded = await s.load();
    expect(loaded.path).toBe(SETTINGS_PLACE);
    expect(loaded.parsed.ok).toBe(true);
    if (!loaded.parsed.ok) return;
    const c = loaded.parsed.config;
    expect(c.dataverse).toMatchObject({ environmentUrl: APP.dataverse!.environmentUrl, tenantId: APP.dataverse!.tenantId, clientId: APP.dataverse!.clientId, myEmail: "ana@cooptimize.example" });
    expect(c.outlook).toEqual({ tenantId: APP.entra!.tenantId, clientId: APP.entra!.clientId });
    expect(c.google?.clientId).toBe(APP.google!.clientId);
    // Nothing app-level was stored.
    const stored = (await t.db.all("SELECT body FROM user_settings")).map((r) => r.body as string).join("\n");
    expect(stored).not.toContain(APP.dataverse!.environmentUrl);
    expect(stored).not.toContain(APP.entra!.clientId);
    expect(stored).not.toContain(APP.google!.clientId);
  });

  it("saves a Settings edit as rows, refuses an invalid one, and keeps people apart", async () => {
    const t = await setup(open);
    const ana = t.make("ana");
    const ben = t.make("ben");
    await ana.seed(STARTER_TOML);
    await ben.seed(STARTER_TOML);
    const r = await ana.write(settingsEdit("display", { theme: "neutral", viewRange: "business", showTimelines: false }));
    expect(r.ok).toBe(true);
    const a = await ana.load();
    const b = await ben.load();
    expect(a.parsed.ok && a.parsed.config.ui).toMatchObject({ theme: "neutral", showTimelines: false });
    expect(b.parsed.ok && b.parsed.config.ui).toMatchObject({ theme: "cooptimize-dark", showTimelines: true });
    const bad = await ana.write((x) => setValue(x, "ui", "theme", "plaid"));
    expect(bad.ok).toBe(false);
    expect((await ana.load()).parsed.ok && ((await ana.load()).parsed as { config: { ui: { theme: string } } }).config.ui.theme).toBe("neutral");
  });

  it("keeps the time zone on the person: a Settings change is mirrored, and their zone wins on load", async () => {
    const t = await setup(open);
    const s = t.make("ana");
    await s.seed(starterToml(NY));
    await s.write((x) => setValue(x, "hours", "time_zone", "America/Denver"));
    expect(t.people.get("ana")!.timeZone).toBe("America/Denver");
    t.people.get("ana")!.timeZone = "America/Los_Angeles";
    const l = await s.load();
    expect(l.parsed.ok && l.parsed.config.week.hours.timeZone).toBe("America/Los_Angeles");
  });

  it("saves the Dataverse user found for the person in their own settings", async () => {
    const t = await setup(open);
    const s = t.make("ana");
    await s.seed(STARTER_TOML);
    await s.saveSystemUserId("44444444-4444-4444-8444-444444444444");
    const l = await s.load();
    expect(l.parsed.ok && l.parsed.config.dataverse.mySystemUserId).toBe("44444444-4444-4444-8444-444444444444");
  });

  it("without app keys, uses the starter's Dataverse environment and offers no Microsoft or Google sign-in", async () => {
    const t = await setup(open, { dataverse: null, entra: null, google: null });
    const s = t.make("ana");
    await s.seed(STARTER_TOML);
    const l = await s.load();
    expect(l.parsed.ok).toBe(true);
    expect(l.parsed.ok && l.parsed.config.outlook).toBeNull();
    expect(l.parsed.ok && l.parsed.config.google).toBeNull();
  });

  it("A5: invite domains set by the admin replace a person's own, and say so", async () => {
    const t = await setup(open, { ...APP, inviteDomains: ["Cooptimize.example"] });
    const s = t.make("ana");
    await s.seed(setValue(STARTER_TOML, "collab", "domains", ["fabrikam.example"]));
    const l = await s.load();
    expect(l.parsed.ok && l.parsed.config.collab).toMatchObject({ domains: ["cooptimize.example"], domainsByAdmin: true });
    const plain = await setup(open);
    const b = plain.make("ben");
    await b.seed(STARTER_TOML);
    const lb = await b.load();
    expect(lb.parsed.ok && lb.parsed.config.collab.domainsByAdmin).toBeFalsy();
  });
});
