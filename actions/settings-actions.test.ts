import { createSnapshotStore } from "../host/local/snapshots.ts";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeConfig } from "../host/local/config-file.ts";
import { parseConfig } from "../config/schema.ts";
import { STARTER_TOML } from "../fixtures/starter.ts";
import type { LogRecord } from "../log/logger.ts";
import { startTestApp } from "../server/test-app.ts";
import { dispatch, type ActionContext } from "./dispatch.ts";
import { createPlanStore } from "../store/plan-store.ts";
import { IDENTITY_KEY, type StoredIdentity } from "./account.ts";
import type { SettingsData } from "./types.ts";

const SECRET = "FAKE-SETTINGS-SECRET-5d1e";

function setup(text = STARTER_TOML.replace('my_email = ""', 'my_email = "me@example.com"')) {
  const dir = mkdtempSync(join(tmpdir(), "c-settings-"));
  const path = join(dir, "config.toml");
  writeFileSync(path, `# my own note at the top\n${text.replace('"T&W" = "#1f9e8f"', '# T&W keeps its old color form\n"T&W" = "#1f9e8f"')}`);
  const no = () => { throw new Error("n/a"); };
  const stored: { account: string; value: string }[] = [];
  const c: ActionContext = {
    loadConfig: async () => ({ path, parsed: parseConfig(readFileSync(path, "utf8")) }),
    makeDataverse: no, makeOutlook: no, makeGoogle: no, makeDevOps: no,
    saveSystemUserId: async () => {},
    now: () => "2026-11-02T14:00:00Z",
    writeConfig: (edit) => writeConfig(path, edit),
    secrets: { state: async (a) => (stored.some((s) => s.account === a) ? "set" : "missing"), set: async (account, value) => void stored.push({ account, value }) },
  };
  const run = (action: string, input: unknown) => dispatch(c, { action, input });
  return { c, path, run, stored, dir };
}

describe("Settings (step 6b)", () => {
  it("loads every section without any secret", async () => {
    const t = setup();
    const r = await t.run("settings.load", {});
    expect(r.ok).toBe(true);
    const d = (r as { data: SettingsData }).data;
    expect(d.hours?.weekdays.mon).toEqual([{ start: "09:00", end: "17:00" }]);
    // no-demo-leak: without Dataverse, only the internal client (always followed); a color in settings makes no client.
    expect(d.clients.map((c) => c.key)).toEqual(["Cooptimize"]);
    expect(d.dataverseReached).toBe(false);
    // makeDataverse fails here: Dataverse can't be reached.
    expect(d.dataverseProblem).toBe("Couldn't reach Dataverse. Try again, or tell the FocusTime team.");
    expect(d.secrets.map((s) => [s.account, s.state])).toEqual([["dataverse-client-secret", "missing"], ["google-client-secret", "missing"]]);
  });

  it("saves a client as a table and keeps comments and the other clients", async () => {
    const t = setup();
    const r = await t.run("settings.save", { section: "client", values: { key: "Adatum", name: "Adatum Steel", color: "ochre", openStates: ["Resolved"] } });
    expect(r.ok).toBe(true);
    const text = readFileSync(t.path, "utf8");
    expect(text).toContain("# my own note at the top");
    expect(text).toContain("# T&W keeps its old color form");
    expect(text).toContain('"T&W" = "#1f9e8f"');
    expect(text).toContain('Adatum = { color = "ochre", name = "Adatum Steel", open_states = ["Resolved"] }');
    expect(text).not.toContain("[chromium]");
    const cfg = parseConfig(text);
    expect(cfg.ok && cfg.config.clientSettings.Adatum).toEqual({ color: "ochre", name: "Adatum Steel", openStates: ["Resolved"], follow: false });
    expect(cfg.ok && cfg.config.clients.Adatum).toBe("var(--client-ochre)");
    // Round trip: saving the same values again changes nothing but the backup.
    await t.run("settings.save", { section: "client", values: { key: "Adatum", name: "Adatum Steel", color: "ochre", openStates: ["Resolved"] } });
    expect(readFileSync(t.path, "utf8")).toBe(text);
  });

  it("refuses bad values per field and writes nothing", async () => {
    const t = setup();
    const before = readFileSync(t.path, "utf8");
    const risk = await t.run("settings.save", { section: "risk", values: { meetingWatchMinutes: 120, meetingAtRiskMinutes: 60, minFocusWindowMinutes: 90 } });
    expect(risk).toMatchObject({ ok: false, status: 422, fields: [{ field: "risk.meeting_at_risk_minutes", message: expect.stringMatching(/at least/) }] });
    const hours = await t.run("settings.save", { section: "hours", values: { timeZone: "Mars/Olympus", lunch: "", weekdays: { mon: ["9-5"], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] } } });
    expect(hours.ok).toBe(false);
    const fields = (hours as { fields: { field: string }[] }).fields.map((f) => f.field);
    expect(fields).toEqual(expect.arrayContaining(["hours.time_zone", "hours.mon[0]"]));
    const color = await t.run("settings.save", { section: "client", values: { key: "Adatum", color: "purple" } });
    expect(color).toMatchObject({ ok: false, fields: [{ field: "clients.Adatum.color" }] });
    expect(await t.run("settings.save", { section: "nope", values: {} })).toMatchObject({ ok: false, status: 400 });
    expect(readFileSync(t.path, "utf8")).toBe(before);
  });

  it("saves working hours, standing blocks, planning and display with a backup each time", async () => {
    const t = setup();
    expect((await t.run("settings.save", { section: "hours", values: { timeZone: "America/Chicago", lunch: "12:00-12:30", weekdays: { mon: ["08:00-16:00"], tue: ["08:00-16:00"], wed: ["08:00-16:00"], thu: ["08:00-16:00", "20:00-21:00"], fri: ["09:00-12:00"], sat: [], sun: [] } } })).ok).toBe(true);
    expect((await t.run("settings.save", { section: "standing", values: { blocks: [{ day: "Tue", half: "PM", client: "Internal" }] } })).ok).toBe(true);
    expect((await t.run("settings.save", { section: "planning", values: { pickablePortfolioTypes: ["Recurring", "Chore"] } })).ok).toBe(true);
    expect((await t.run("settings.save", { section: "planning", values: { pickablePortfolioTypes: ["Recurring", "Chore"], minSizes: { S: 30, M: 60, L: 120 }, carryDays: 3, reminderOffsetMinutes: 30, focusMinutes: 25, breakMinutes: 5, endSound: true, followGraceDays: 21, closeoutReminderMinutes: 30, checkinReminderMinutes: 10, weekNudgeThu: "15:30", weekNudgeFri: "" } })).ok).toBe(true);
    // E2: S, M and L are fixed (1h, 2h, 4h); there is nothing to save for them.
    expect((await t.run("settings.save", { section: "planning", values: { sizes: { S: 60, M: 50, L: 180 } } })).ok).toBe(false);
    expect((await t.run("settings.save", { section: "display", values: { theme: "neutral", viewRange: "12h", showTimelines: false } })).ok).toBe(true);
    const cfg = parseConfig(readFileSync(t.path, "utf8"));
    if (!cfg.ok) throw new Error(JSON.stringify(cfg.errors));
    expect(cfg.config.week.hours.timeZone).toBe("America/Chicago");
    expect(cfg.config.week.hours.weekdays.thu).toHaveLength(2);
    expect(cfg.config.week.standingBlocks).toEqual([{ day: "Tue", half: "PM", clientKey: "Internal", clientName: "Internal" }]);
    expect(cfg.config.plan).toEqual({ pickablePortfolioTypes: ["Recurring", "Chore"], backgroundTypes: [], sizes: { S: 60, M: 120, L: 240 }, minSizes: { S: 30, M: 60, L: 120 }, carryDays: 3, reminderOffsetMinutes: 30, focusMinutes: 25, breakMinutes: 5, endSound: true, followGraceDays: 21, closeoutReminderMinutes: 30, checkinReminderMinutes: 10, weekNudgeThu: "15:30", weekNudgeFri: "", weekNudgeMon: "08:30" });
    expect(cfg.config.ui).toEqual({ theme: "neutral", viewRange: "12h", showTimelines: false, reduceMotion: false, textSize: "default", showPersonal: true });
    expect(readFileSync(t.path, "utf8")).toContain("# my own note at the top");
  });
});

describe("secrets from Settings never come back", () => {
  it("stores the value in the keyring only: not in the response, the config, or settings.load", async () => {
    const t = setup();
    const r = await t.run("secret.set", { account: "dataverse-client-secret", value: SECRET, expires: "2027-03-01" });
    expect(r.ok).toBe(true);
    expect(JSON.stringify(r)).not.toContain(SECRET);
    expect(t.stored).toEqual([{ account: "dataverse-client-secret", value: SECRET }]);
    const text = readFileSync(t.path, "utf8");
    expect(text).not.toContain(SECRET);
    expect(text).toContain('dataverse_client_secret_expires = "2027-03-01"');
    const load = await t.run("settings.load", {});
    expect(JSON.stringify(load)).not.toContain(SECRET);
    expect((load as { data: SettingsData }).data.secrets[0]).toEqual({ account: "dataverse-client-secret", label: "Dataverse client secret", state: "set", expires: "2027-03-01" });
  });

  it("a signed-in person's context can't list or set the app's client secrets (A2)", async () => {
    const t = setup();
    delete (t.c as { secrets?: unknown }).secrets;
    const load = await t.run("settings.load", {});
    expect((load as { data: SettingsData }).data.secrets).toEqual([]);
    const r = await t.run("secret.set", { account: "dataverse-client-secret", value: SECRET });
    expect(r).toMatchObject({ ok: false, status: 503 });
    expect(t.stored).toEqual([]);
  });

  it("refuses refresh-token accounts, multi-line values and unknown fields without echoing the value", async () => {
    const t = setup();
    for (const input of [{ account: "outlook-refresh-token", value: SECRET }, { account: "google-client-secret", value: `${SECRET}\nmore` }, { account: "google-client-secret", value: SECRET, extra: 1 }]) {
      const r = await t.run("secret.set", input);
      expect(r.ok).toBe(false);
      expect(JSON.stringify(r)).not.toContain(SECRET);
    }
    expect(t.stored).toEqual([]);
  });

  it("never puts the value in the server's logs or HTTP response", async () => {
    const t = setup();
    const logs: LogRecord[] = [];
    const app = await startTestApp({ ctx: t.c, log: (r) => logs.push(r) });
    const b = app.browser();
    await b.signIn("user-a");
    const r = await b.action("secret.set", { account: "google-client-secret", value: SECRET });
    const res = `${r.status} ${r.body}`;
    await app.close();
    expect(res).toMatch(/^200 /);
    expect(res).not.toContain(SECRET);
    expect(JSON.stringify(logs)).not.toContain(SECRET);
    expect(logs.length).toBeGreaterThan(0);
  });
});

describe("Settings > Clients follow state (step 6d)", () => {
  it("says which clients are followed and why; Keep following saves and turns one on", async () => {
    const { createDataverseSource } = await import("../sources/dataverse/source.ts");
    const { dvConfig, FAKE_SECRET, fakeFetch } = await import("../sources/dataverse/test-fakes.ts");
    const text = STARTER_TOML.replace('my_email = ""', 'my_email = "me@example.com"')
      .replace('my_systemuserid = ""', `my_systemuserid = "${dvConfig.mySystemUserId}"`)
      .replace("https://cooptimize.crm.dynamics.com", dvConfig.environmentUrl);
    const t = setup(text);
    const dv = fakeFetch("ok").fetch;
    const cacheDir = mkdtempSync(join(tmpdir(), "c-follow-"));
    t.c.makeDataverse = (cfg, tz) => createDataverseSource({ config: cfg, timeZone: tz, getSecret: async () => FAKE_SECRET, fetch: dv, snapshots: createSnapshotStore(cacheDir), log: () => {} });
    const load = async () => ((await t.run("settings.load", {})) as { data: SettingsData }).data.clients;
    const by = (cs: SettingsData["clients"], k: string) => cs.find((c) => c.key === k)?.follow;
    let cs = await load();
    expect(by(cs, "Cooptimize")).toEqual({ active: true, why: "internal" });
    expect(by(cs, "T&W")).toEqual({ active: true, why: "ongoing" });
    expect(by(cs, "HM Electronics")).toEqual({ active: false, why: "none" });
    expect((await t.run("settings.save", { section: "client", values: { key: "HM Electronics", follow: true } })).ok).toBe(true);
    expect(readFileSync(t.path, "utf8")).toMatch(/"HM Electronics" = \{[^}]*follow = true/);
    cs = await load();
    expect(by(cs, "HM Electronics")).toEqual({ active: true, why: "kept" });
  });
});

describe("where settings live (fix/settings-autosave)", () => {
  it("only a path on disk is a config file; an account's settings and the demo are not", async () => {
    const { isFilePath } = await import("./settings-actions.ts");
    expect(["/home/me/.config/focustime/config.toml", "C:\\Users\\me\\config.toml", "~/.config/focustime/config.toml"].every(isFilePath)).toBe(true);
    expect(["your FocusTime account", "Demo data (in memory, not your config file)"].some(isFilePath)).toBe(false);
  });
});

// A5 fix: in the hosted app the Dataverse user found for a person is kept with their sign-in (ms_identity), not in
// their settings. Settings once read only the settings, so on prod (a clean database) Clients said "isn't found yet"
// while Week, which reads the sign-in, had the clients.
describe("Settings › Clients finds me like the week does (A5 fix)", () => {
  const ID = "dddddddd-0000-4000-8000-0000000000c1";
  const ME = { oid: "00000000-0000-4000-8000-0000000000e1", tid: "00000000-0000-4000-8000-0000000000e2", name: "Pat Example", username: "pat@example.com", email: "pat@example.com" };
  type Lookup = { ok: true; id: string } | { ok: false; message: string; reason: "none" | "many" | "failed" };
  async function signedIn(o: { kept?: string | null; lookup?: (email: string) => Lookup; clients?: boolean } = {}) {
    const dir = mkdtempSync(join(tmpdir(), "c-settings-me-"));
    const path = join(dir, "config.toml");
    writeFileSync(path, STARTER_TOML.replace('my_email = ""', 'my_email = "pat@example.com"')); // no my_systemuserid, like a new prod user
    const plan = createPlanStore({ path: ":memory:", now: () => Temporal.Now.zonedDateTimeISO("UTC") });
    await plan.setAccountState(IDENTITY_KEY, { ...ME, signedInAt: "2026-11-03T12:00:00Z", systemUserId: o.kept ?? null, systemUserEmail: o.kept ? "pat@example.com" : null } satisfies StoredIdentity);
    const asked: string[] = [];
    const no = () => { throw new Error("n/a"); };
    const c: ActionContext = {
      plan,
      loadConfig: async () => ({ path, parsed: parseConfig(readFileSync(path, "utf8")) }),
      makeDataverse: ((dv: { mySystemUserId: string | null }) => ({
        resolveUserId: async (email: string) => (asked.push(email), o.lookup?.(email) ?? { ok: false, message: "none", reason: "none" }),
        myClients: async () => (o.clients === false || dv.mySystemUserId !== ID ? null : [{ clientKey: "Fabrikam", clientName: "Fabrikam", devops: true, devopsEmail: "pat@fabrikam.example" }]),
      })) as never,
      makeOutlook: no, makeGoogle: no, makeDevOps: no,
      saveSystemUserId: async () => { throw new Error("a signed-in match is kept with the sign-in, not in the file"); },
      signedInAs: async () => ({ email: ME.email, upn: ME.username }),
      now: () => "2026-11-03T14:00:00Z",
    };
    const r = await dispatch(c, { action: "settings.load", input: {} });
    expect(r.ok).toBe(true);
    return { d: (r as { data: SettingsData }).data, asked, plan };
  }

  it("uses the Dataverse user kept with the sign-in", async () => {
    const { d, asked } = await signedIn({ kept: ID });
    expect(d.dataverseProblem).toBeNull();
    expect(d.clients.map((c) => [c.key, c.devopsEmail])).toContainEqual(["Fabrikam", "pat@fabrikam.example"]);
    expect(d.you).toMatchObject({ email: "pat@example.com", systemUserId: ID });
    expect(asked).toEqual([]);
  });

  it("finds and keeps it when none is known yet", async () => {
    const { d, plan } = await signedIn({ lookup: (e) => (e === "pat@example.com" ? { ok: true, id: ID } : { ok: false, message: "none", reason: "none" }) });
    expect(d.dataverseProblem).toBeNull();
    expect(d.clients.map((c) => c.key)).toContain("Fabrikam");
    expect(await plan.accountState<StoredIdentity>(IDENTITY_KEY)).toMatchObject({ systemUserId: ID, systemUserEmail: "pat@example.com" });
  });

  it("says no staff record matches, by email, when Dataverse answered", async () => {
    const { d } = await signedIn();
    expect(d.dataverseProblem).toBe("No Cooptimize staff record matches pat@example.com. Ask the FocusTime team.");
  });

  it("says it couldn't reach Dataverse when the lookup or the clients read fails", async () => {
    const down = await signedIn({ lookup: () => ({ ok: false, message: "401", reason: "failed" }) });
    expect(down.d.dataverseProblem).toBe("Couldn't reach Dataverse. Try again, or tell the FocusTime team.");
    const clients = await signedIn({ kept: ID, clients: false });
    expect(clients.d.dataverseProblem).toBe("Couldn't reach Dataverse. Try again, or tell the FocusTime team.");
  });

  it("never asks a signed-in person to sign in", async () => {
    for (const o of [{}, { lookup: () => ({ ok: false, message: "x", reason: "failed" }) as Lookup }, { kept: ID, clients: false }])
      expect((await signedIn(o)).d.dataverseProblem).not.toMatch(/sign in/i);
  });
});
