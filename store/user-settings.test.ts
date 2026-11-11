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
    const r = await ana.write(settingsEdit("display", { theme: "neutral", viewRange: "business", showTimelines: true }));
    expect(r.ok).toBe(true);
    const a = await ana.load();
    const b = await ben.load();
    expect(a.parsed.ok && a.parsed.config.ui).toMatchObject({ theme: "neutral", showTimelines: true });
    expect(b.parsed.ok && b.parsed.config.ui).toMatchObject({ theme: "cooptimize-dark", showTimelines: false });
    const bad = await ana.write((x) => setValue(x, "ui", "theme", "plaid"));
    expect(bad.ok).toBe(false);
    expect((await ana.load()).parsed.ok && ((await ana.load()).parsed as { config: { ui: { theme: string } } }).config.ui.theme).toBe("neutral");
  });

  // BH-1 (Q-BH1-1): settings a newer FocusTime saved (after a rollback, this build is the older one).
  const NEWER = `\n# Saved by a newer FocusTime\n[future_feature]\nmode = "bright"\nlimits = [1, 2]\n\n[[future_feature.rule]]\nname = "a"\n`;
  const withNewer = (text: string) => `${text.replace("[ui]", '[ui]\nfuture_density = "airy"')}${NEWER}`;

  it("loads settings with an unknown section and key: ignored when reading, listed, nothing refused", async () => {
    const t = await setup(open);
    const ana = t.make("ana");
    await ana.seed(withNewer(STARTER_TOML));
    const { parsed } = await ana.load();
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.ignored).toEqual(["future_feature", "ui.future_density"]);
    expect(parsed.config.ui.theme).toBe("cooptimize-dark");
  });

  it("a Settings save keeps unknown sections and keys untouched, in its own section and in others", async () => {
    const t = await setup(open);
    const ana = t.make("ana");
    await ana.seed(withNewer(STARTER_TOML));
    const before = await ana.text();
    const section = (text: string, name: string) => splitSettings(text).find((r) => r.section === name)?.body;
    // An edit of the section that holds the unknown key, then of another section.
    expect((await ana.write(settingsEdit("display", { theme: "neutral", viewRange: "business", showTimelines: true }))).ok).toBe(true);
    expect((await ana.write(settingsEdit("ahead", { staleWeeks: 9 }))).ok).toBe(true);
    const after = await ana.text();
    expect(section(after, "future_feature")).toBe(section(before, "future_feature"));
    expect(section(after, "future_feature")).toContain('[[future_feature.rule]]\nname = "a"');
    expect(section(after, "ui")).toContain('future_density = "airy"');
    const { parsed } = await ana.load();
    expect(parsed.ok && [parsed.config.ui.theme, parsed.config.ahead?.staleWeeks, parsed.ignored]).toEqual(["neutral", 9, ["future_feature", "ui.future_density"]]);
    // The stored rows themselves keep it (what an older or newer build reads next).
    const rows = (await t.db.all("SELECT section, body FROM user_settings WHERE user_id = ?", ["ana"])) as { section: string; body: string }[];
    expect(rows.find((r) => r.section === "future_feature")?.body).toContain('mode = "bright"');
  });

  it("invite domains are the app's: set by the admin, never kept in a person's rows (fix/settings-autosave)", async () => {
    const t = await setup(open, { ...APP, inviteDomains: ["contoso.example", "fabrikam.example"] });
    const ana = t.make("ana");
    // Even a person's own [collab] domains (an old import) give way to the app's.
    await ana.seed(STARTER_TOML.replace(/\[collab\][^[]*/, "") + '\n[collab]\ndomains = ["mine.example"]\n');
    const loaded = await ana.load();
    expect(loaded.parsed.ok && loaded.parsed.config.collab.domains).toEqual(["contoso.example", "fabrikam.example"]);
    expect((await ana.write(settingsEdit("collab", { meetingMinutes: 45, teams: true, daysAhead: 3, exclude: [] }))).ok).toBe(true);
    const rows = (await t.db.all("SELECT body FROM user_settings WHERE user_id = ?", ["ana"])) as { body: string }[];
    expect(rows.map((r) => r.body).join("\n")).not.toMatch(/^\s*domains\s*=/m);
    expect(personalRows('[collab]\nteams = true\ndomains = ["x.example"]\n').map((r) => r.body).join("")).not.toContain("domains");
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
});
