import { mkdtempSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import type { LogRecord } from "../../log/logger.ts";
import { Pat } from "../devops/pat.ts";
import { createDataverseSource } from "./source.ts";
import { ACCT, devopsAccounts, dvConfig, FAKE_PAT_CSC, FAKE_PAT_WC, FAKE_SECRET, fakeFetch, ME, type Scenario } from "./test-fakes.ts";

const NOW = Temporal.Instant.from("2026-11-02T13:02:00Z");

function setup(scenario: Scenario = "ok", extra: Parameters<typeof fakeFetch>[1] = {}) {
  const cacheDir = mkdtempSync(join(tmpdir(), "coopilot-dvt-"));
  const logs: LogRecord[] = [];
  const f = fakeFetch(scenario, extra);
  const source = createDataverseSource({ config: dvConfig, timeZone: "America/New_York", getSecret: async () => FAKE_SECRET, fetch: f.fetch, cacheDir, log: (r) => logs.push(r), now: () => NOW });
  return { source, calls: f.calls, logs, cacheDir };
}

const leaks = (s: string) => s.includes(FAKE_PAT_CSC) || s.includes(FAKE_PAT_WC) || s.includes("FAKE-DV-PAT");

describe("Dataverse → DevOps settings", () => {
  it("reads my active Account Worker rows, then only this week's accounts, with the PAT wrapped", async () => {
    const s = setup();
    const r = await s.source.devopsTargets(["CSC", "W&C"]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const csc = r.targets.find((t) => t.clientKey === "CSC")!;
    // The project name is used even when an ID is stored: real stored IDs can be stale.
    expect(csc).toMatchObject({ accountId: ACCT.csc, org: "cscsteel", project: "Project Ada", projectName: "Project Ada", email: "t.spaulding@cscsteel.example" });
    expect(csc.pat).toBeInstanceOf(Pat);
    expect(csc.pat!.basicAuth()).toBe(`Basic ${Buffer.from(`:${FAKE_PAT_CSC}`).toString("base64")}`);
    // A blank DevOps email stays null (never guessed).
    expect(r.targets.find((t) => t.clientKey === "W&C")).toMatchObject({ project: "Woodard Curran", email: null });
    // HME has an Account Worker but no block this week: not returned.
    expect(r.targets.map((t) => t.clientKey).sort()).toEqual(["CSC", "W&C"]);

    const workers = decodeURIComponent(s.calls.find((c) => c.url.includes("coop_accountworkers"))!.url);
    expect(workers).toContain(`_coop_user_value eq ${ME} and statecode eq 0`);
    const accts = decodeURIComponent(s.calls.find((c) => c.url.includes("coop_devopstoken"))!.url);
    expect(accts).toContain(`accountid eq ${ACCT.csc}`);
    expect(accts).toContain("coop_reportingnickname eq 'CSC' or name eq 'CSC' or coop_reportingnickname eq 'W&C' or name eq 'W&C'");
  });

  it("the PAT cannot be serialized, printed or logged from the targets", async () => {
    const s = setup();
    const r = await s.source.devopsTargets(["CSC", "W&C"]);
    expect(leaks(JSON.stringify(r))).toBe(false);
    expect(leaks(inspect(r, { depth: 10 }))).toBe(false);
    expect(leaks(JSON.stringify(s.logs))).toBe(false);
    expect(existsSync(join(s.cacheDir, "dataverse"))).toBe(false);
  });

  it("the cached focus block path never selects the PAT column", async () => {
    const s = setup();
    await s.source.load("2026-11-02");
    expect(s.calls.some((c) => c.url.includes("coop_devopstoken"))).toBe(false);
    for (const f of readdirSync(join(s.cacheDir, "dataverse"))) expect(readFileSync(join(s.cacheDir, "dataverse", f), "utf8")).not.toContain("devops");
  });

  it("two accounts with the same client key are refused, not merged", async () => {
    const dup = { value: [...devopsAccounts.value, { ...devopsAccounts.value[0], accountid: ACCT.hme }] };
    const r = await setup("ok", { devopsAccounts: dup }).source.devopsTargets(["CSC"]);
    if (!r.ok) throw new Error("expected ok");
    expect(r.targets.filter((t) => t.clientKey === "CSC").every((t) => t.pat === null && t.problem === "More than one account is named CSC in Dataverse")).toBe(true);
  });

  it.each<[Scenario, string]>([
    ["network_down", "Dataverse unreachable"],
    ["dv_403", "Dataverse access denied"],
    ["dv_503", "Dataverse read failed"],
  ])("%s: a plain failure with no body, secret or token", async (scenario, message) => {
    const s = setup(scenario);
    const r = await s.source.devopsTargets(["CSC"]);
    expect(r).toEqual({ ok: false, message });
    expect(JSON.stringify(s.logs)).not.toMatch(/FAKE-/);
  });

  it("no clients this week: no Dataverse call", async () => {
    const s = setup();
    expect(await s.source.devopsTargets([])).toEqual({ ok: true, targets: [] });
    expect(s.calls).toHaveLength(0);
  });
});

describe("my clients for Open half-days (Q21)", () => {
  it("lists every account I'm an Account Worker on, with whether DevOps is set up, and never selects the PAT", async () => {
    const { fetch, calls } = fakeFetch("ok");
    const src = createDataverseSource({ config: dvConfig, timeZone: "America/New_York", getSecret: async () => FAKE_SECRET, fetch, cacheDir: mkdtempSync(join(tmpdir(), "c-")), log: () => {} });
    const mine = await src.myClients();
    expect(mine).toEqual([
      { clientKey: "CSC", clientName: "CSC", devops: true },
      { clientKey: "HM Electronics", clientName: "HM Electronics", devops: true },
      { clientKey: "W&C", clientName: "W&C", devops: true },
    ]);
    const urls = calls.map((c) => decodeURIComponent(c.url));
    expect(urls.some((u) => u.includes("coop_accountworkers") && u.includes(`_coop_user_value eq ${dvConfig.mySystemUserId}`))).toBe(true);
    expect(urls.some((u) => u.includes("coop_devopstoken"))).toBe(false);
    expect(JSON.stringify(mine)).not.toContain("FAKE-DV-PAT");
  });

  it("returns null (not a guess) when Dataverse fails", async () => {
    const { fetch } = fakeFetch("dv_503");
    const src = createDataverseSource({ config: dvConfig, timeZone: "America/New_York", getSecret: async () => FAKE_SECRET, fetch, cacheDir: mkdtempSync(join(tmpdir(), "c-")), log: () => {} });
    expect(await src.myClients()).toBeNull();
  });
});
