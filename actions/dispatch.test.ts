import { createSnapshotStore } from "../host/local/snapshots.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseConfig } from "../config/schema.ts";
import { FOUR_DAY_TOML as STARTER_TOML } from "../fixtures/four-day-week.ts";
import { createDataverseSource } from "../sources/dataverse/source.ts";
import { dvConfig, FAKE_SECRET, FAKE_TOKEN, fakeFetch, type Scenario } from "../sources/dataverse/test-fakes.ts";
import { dispatch, type ActionContext } from "./dispatch.ts";

const configText = STARTER_TOML.replace('my_email = ""', 'my_email = "me@example.com"').replace(
  'my_systemuserid = ""',
  `my_systemuserid = "${dvConfig.mySystemUserId}"`,
);

function ctx(scenario: Scenario, text = configText): ActionContext {
  const parsed = parseConfig(text.replace("https://cooptimize.crm.dynamics.com", dvConfig.environmentUrl));
  const f = fakeFetch(scenario);
  return {
    loadConfig: async () => ({ path: "/home/me/.config/focustime/config.toml", parsed }),
    makeDataverse: (cfg, tz) =>
      createDataverseSource({ config: cfg, timeZone: tz, getSecret: async () => FAKE_SECRET, fetch: f.fetch, snapshots: createSnapshotStore(mkdtempSync(join(tmpdir(), "c-"))), log: () => {} }),
    makeOutlook: () => { throw new Error("Outlook is not configured in these tests"); },
    makeGoogle: () => { throw new Error("Google is not configured in these tests"); },
    makeDevOps: () => ({ load: async () => [], lookup: () => null, orgOf: () => null, last: () => null, portfolio: async () => [], description: async () => null, forget: () => undefined, featureSignals: async () => ({ ok: false as const, message: "n/a" }), exemplarPool: async () => ({ ok: true as const, value: [] }), processModels: async () => [] }),
    saveSystemUserId: async () => {},
    now: () => "2026-11-03T15:00:00Z",
  };
}

describe("action dispatcher", () => {
  it("rejects unknown actions and bad input", async () => {
    expect(await dispatch(ctx("ok"), { action: "week.delete", input: {} })).toMatchObject({ ok: false, status: 400 });
    expect(await dispatch(ctx("ok"), { action: "week.load", input: { weekStart: "2026-11-03" } })).toMatchObject({ ok: false, status: 400 });
    expect(await dispatch(ctx("ok"), { action: "week.load", input: { weekStart: "nope" } })).toMatchObject({ ok: false, status: 400 });
    expect(await dispatch(ctx("ok"), { action: "week.load", input: { extra: 1 } })).toMatchObject({ ok: false, status: 400 });
  });

  it("week.load shows real focus blocks; calendars that aren't set up say so, with no sample meetings (no-demo-leak)", async () => {
    const r = await dispatch(ctx("ok"), { action: "week.load", input: { weekStart: "2026-11-02" } });
    if (!r.ok) throw new Error(r.error);
    const data = r.data as { week: { days: { am: { focus: { clientName: string }[] } }[] }; sources: { source: string; status: string; sample?: boolean; itemCount: number }[] };
    expect(data.week.days[0]!.am.focus.map((f) => f.clientName)).toEqual(["Proseware", "Cooptimize"]);
    expect(data.sources.map((s) => [s.source, s.status, Boolean(s.sample)])).toEqual([
      ["dataverse", "ok", false],
      ["pto", "ok", false],
      ["outlook", "misconfigured", false],
      ["google", "misconfigured", false],
    ]);
    expect(data.sources.filter((s) => s.source === "outlook" || s.source === "google").map((s) => s.itemCount)).toEqual([0, 0]);
    expect(JSON.stringify(data.sources)).not.toContain('"items"');
  });

  it("defaults to the week containing now and reports today's half-day", async () => {
    const r = await dispatch(ctx("ok"), { action: "week.load", input: {} });
    if (!r.ok) throw new Error(r.error);
    expect(r.data).toMatchObject({ weekStart: "2026-11-02", today: { weekStart: "2026-11-02", dayIndex: 1, half: "AM" } });
  });

  it("with an invalid config, shows no focus blocks and names the bad fields", async () => {
    const r = await dispatch(ctx("ok", configText.replace(/tenant_id = ".*"/, 'tenant_id = "x"')), { action: "week.load", input: { weekStart: "2026-11-02" } });
    if (!r.ok) throw new Error(r.error);
    const data = r.data as { config: { ok: boolean; errors: { field: string }[] }; sources: { source: string; status: string; fixAction?: string }[]; week: { days: { am: { focus: unknown[] } }[] } };
    expect(data.config.ok).toBe(false);
    expect(data.config.errors.map((e) => e.field)).toEqual(["dataverse.tenant_id"]);
    expect(data.sources[0]).toMatchObject({ source: "dataverse", status: "misconfigured", fixAction: "open_settings" });
    expect(data.week.days.every((d) => d.am.focus.length === 0)).toBe(true);
  });

  it("resolves and saves my systemuserid when the config has only my email", async () => {
    const saved: string[] = [];
    const c = ctx("ok", configText.replace(/my_systemuserid = ".*"/, 'my_systemuserid = ""'));
    c.saveSystemUserId = async (id) => { saved.push(id); };
    const r = await dispatch(c, { action: "week.load", input: { weekStart: "2026-11-02" } });
    expect(r.ok).toBe(true);
    expect(saved).toEqual([dvConfig.mySystemUserId]);
  });

  it.each<Scenario>(["ok", "dv_401", "token_invalid_client", "network_down", "page_fails"])("%s: the UI response holds no secret or token", async (scenario) => {
    const r = await dispatch(ctx(scenario), { action: "week.load", input: { weekStart: "2026-11-02" } });
    const body = JSON.stringify(r);
    expect(body).not.toContain(FAKE_SECRET);
    expect(body).not.toContain(FAKE_TOKEN);
  });
});
