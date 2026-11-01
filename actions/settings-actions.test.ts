import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeConfig } from "../config/edit.ts";
import { parseConfig } from "../config/schema.ts";
import { STARTER_TOML } from "../config/starter.ts";
import type { LogRecord } from "../log/logger.ts";
import { createApp } from "../server/app.ts";
import { dispatch, type ActionContext } from "./dispatch.ts";
import type { SettingsData } from "./types.ts";

const SECRET = "FAKE-SETTINGS-SECRET-5d1e";
const HOME = "/home/test";
const LOCAL_STATE = JSON.stringify({ profile: { info_cache: { Default: { name: "Personal", other: "ignored" }, "Profile 2": { name: "CSC work" } } } });
const files: Record<string, string> = {
  [`${HOME}/.local/share/applications/chromium.desktop`]: "[Desktop Entry]\nExec=/usr/bin/chromium %U\n",
  [`${HOME}/.config/chromium/Local State`]: LOCAL_STATE,
};

function setup(text = STARTER_TOML.replace('my_email = ""', 'my_email = "me@example.com"')) {
  const dir = mkdtempSync(join(tmpdir(), "c-settings-"));
  const path = join(dir, "config.toml");
  writeFileSync(path, `# my own note at the top\n${text.replace('"W&C" = "#1f9e8f"', '# W&C keeps its old color form\n"W&C" = "#1f9e8f"')}`);
  const no = () => { throw new Error("n/a"); };
  const stored: { account: string; value: string }[] = [];
  const c: ActionContext = {
    loadConfig: async () => ({ path, parsed: parseConfig(readFileSync(path, "utf8")) }),
    makeDataverse: no, makeOutlook: no, makeGoogle: no, makeDevOps: no,
    saveSystemUserId: async () => {},
    now: () => "2026-11-02T14:00:00Z",
    writeConfig: (edit) => writeConfig(path, edit),
    secrets: { state: async (a) => (stored.some((s) => s.account === a) ? "set" : "missing"), set: async (account, value) => void stored.push({ account, value }) },
    readText: (p) => files[p] ?? null,
    home: HOME,
  };
  const run = (action: string, input: unknown) => dispatch(c, { action, input });
  return { c, path, run, stored, dir };
}

describe("Settings (step 6b)", () => {
  it("loads every section without any secret, with browser profiles by name only", async () => {
    const t = setup();
    const r = await t.run("settings.load", {});
    expect(r.ok).toBe(true);
    const d = (r as { data: SettingsData }).data;
    expect(d.hours?.weekdays.mon).toEqual([{ start: "09:00", end: "17:00" }]);
    expect(d.clients.map((c) => c.key)).toContain("W&C");
    expect(d.browsers.chromium).toEqual({ found: true, profiles: [{ directory: "Default", name: "Personal" }, { directory: "Profile 2", name: "CSC work" }] });
    expect(JSON.stringify(d)).not.toContain("ignored");
    expect(d.dataverseReached).toBe(false);
    expect(d.secrets.map((s) => [s.account, s.state])).toEqual([["dataverse-client-secret", "missing"], ["google-client-secret", "missing"]]);
  });

  it("saves a client as a table, keeps comments and the other clients, and sets Chromium up when chosen", async () => {
    const t = setup();
    const r = await t.run("settings.save", { section: "client", values: { key: "CSC", name: "CSC Steel", color: "ochre", browser: "chromium", profile: "Profile 2", openStates: ["Resolved"] } });
    expect(r.ok).toBe(true);
    const text = readFileSync(t.path, "utf8");
    expect(text).toContain("# my own note at the top");
    expect(text).toContain("# W&C keeps its old color form");
    expect(text).toContain('"W&C" = "#1f9e8f"');
    expect(text).toContain('CSC = { color = "ochre", name = "CSC Steel", browser = "chromium", profile = "Profile 2", open_states = ["Resolved"] }');
    expect(text).toContain('[chromium]\ncommand = ["/usr/bin/chromium"]');
    const cfg = parseConfig(text);
    expect(cfg.ok && cfg.config.clientSettings.CSC).toEqual({ color: "ochre", name: "CSC Steel", browser: "chromium", profile: "Profile 2", openStates: ["Resolved"], follow: false });
    expect(cfg.ok && cfg.config.clients.CSC).toBe("var(--client-ochre)");
    // Round trip: saving the same values again changes nothing but the backup.
    await t.run("settings.save", { section: "client", values: { key: "CSC", name: "CSC Steel", color: "ochre", browser: "chromium", profile: "Profile 2", openStates: ["Resolved"] } });
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
    const color = await t.run("settings.save", { section: "client", values: { key: "CSC", color: "purple", browser: "edge" } });
    expect(color).toMatchObject({ ok: false, fields: [{ field: "clients.CSC.color" }] });
    expect(await t.run("settings.save", { section: "nope", values: {} })).toMatchObject({ ok: false, status: 400 });
    expect(readFileSync(t.path, "utf8")).toBe(before);
  });

  it("saves working hours, standing blocks, planning and display with a backup each time", async () => {
    const t = setup();
    expect((await t.run("settings.save", { section: "hours", values: { timeZone: "America/Chicago", lunch: "12:00-12:30", weekdays: { mon: ["08:00-16:00"], tue: ["08:00-16:00"], wed: ["08:00-16:00"], thu: ["08:00-16:00", "20:00-21:00"], fri: ["09:00-12:00"], sat: [], sun: [] } } })).ok).toBe(true);
    expect((await t.run("settings.save", { section: "standing", values: { blocks: [{ day: "Tue", half: "PM", client: "Internal" }] } })).ok).toBe(true);
    expect((await t.run("settings.save", { section: "planning", values: { pickablePortfolioTypes: ["Recurring", "Chore"] } })).ok).toBe(true);
    expect((await t.run("settings.save", { section: "planning", values: { pickablePortfolioTypes: ["Recurring", "Chore"], sizes: { S: 45, M: 90, L: 180 }, carryDays: 3, reminderOffsetMinutes: 30, focusMinutes: 25, breakMinutes: 5, endSound: true, followGraceDays: 21 } })).ok).toBe(true);
    const bad = await t.run("settings.save", { section: "planning", values: { sizes: { S: 60, M: 50, L: 180 } } });
    expect(bad).toMatchObject({ ok: false, status: 422, fields: [{ field: "plan.size_m" }] });
    expect((await t.run("settings.save", { section: "display", values: { theme: "neutral", viewRange: "12h" } })).ok).toBe(true);
    const cfg = parseConfig(readFileSync(t.path, "utf8"));
    if (!cfg.ok) throw new Error(JSON.stringify(cfg.errors));
    expect(cfg.config.week.hours.timeZone).toBe("America/Chicago");
    expect(cfg.config.week.hours.weekdays.thu).toHaveLength(2);
    expect(cfg.config.week.standingBlocks).toEqual([{ day: "Tue", half: "PM", clientKey: "Internal", clientName: "Internal" }]);
    expect(cfg.config.plan).toEqual({ pickablePortfolioTypes: ["Recurring", "Chore"], sizes: { S: 45, M: 90, L: 180 }, carryDays: 3, reminderOffsetMinutes: 30, focusMinutes: 25, breakMinutes: 5, endSound: true, followGraceDays: 21 });
    expect(cfg.config.ui).toEqual({ theme: "neutral", viewRange: "12h" });
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
    const TOKEN = "t0ken-for-settings";
    const probe = createApp({ port: 1, token: TOKEN, log: () => {}, ctx: t.c });
    await new Promise<void>((ok) => probe.listen(0, "127.0.0.1", ok));
    const port = (probe.address() as AddressInfo).port;
    await new Promise<void>((ok) => probe.close(() => ok()));
    const app = createApp({ port, token: TOKEN, log: (r) => logs.push(r), ctx: t.c });
    await new Promise<void>((ok) => app.listen(port, "127.0.0.1", ok));
    const body = JSON.stringify({ action: "secret.set", input: { account: "google-client-secret", value: SECRET } });
    const res = await new Promise<string>((ok, fail) => {
      const req = request({ host: "127.0.0.1", port, path: "/api/action", method: "POST", headers: { host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}`, cookie: `coopilot_${port}=${TOKEN}`, "content-type": "application/json", "content-length": Buffer.byteLength(body) } }, (r) => {
        let s = "";
        r.on("data", (c) => (s += c));
        r.on("end", () => ok(`${r.statusCode} ${s}`));
      });
      req.on("error", fail);
      req.end(body);
    });
    app.close();
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
    t.c.makeDataverse = (cfg, tz) => createDataverseSource({ config: cfg, timeZone: tz, getSecret: async () => FAKE_SECRET, fetch: dv, cacheDir, log: () => {} });
    const load = async () => ((await t.run("settings.load", {})) as { data: SettingsData }).data.clients;
    const by = (cs: SettingsData["clients"], k: string) => cs.find((c) => c.key === k)?.follow;
    let cs = await load();
    expect(by(cs, "Cooptimize")).toEqual({ active: true, why: "internal" });
    expect(by(cs, "W&C")).toEqual({ active: true, why: "ongoing" });
    expect(by(cs, "HM Electronics")).toEqual({ active: false, why: "none" });
    expect((await t.run("settings.save", { section: "client", values: { key: "HM Electronics", follow: true } })).ok).toBe(true);
    expect(readFileSync(t.path, "utf8")).toMatch(/"HM Electronics" = \{[^}]*follow = true/);
    cs = await load();
    expect(by(cs, "HM Electronics")).toEqual({ active: true, why: "kept" });
  });
});
