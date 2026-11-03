import { mkdtempSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import type { LogRecord } from "../../log/logger.ts";
import { Pat } from "../devops/pat.ts";
import { createDataverseSource } from "./source.ts";
import { ACCT, devopsAccounts, dvConfig, FAKE_PAT_Adatum, FAKE_PAT_WC, FAKE_SECRET, fakeFetch, ME, type Scenario } from "./test-fakes.ts";

const NOW = Temporal.Instant.from("2026-11-02T13:02:00Z");

function setup(scenario: Scenario = "ok", extra: Parameters<typeof fakeFetch>[1] = {}) {
  const cacheDir = mkdtempSync(join(tmpdir(), "focustime-dvt-"));
  const logs: LogRecord[] = [];
  const f = fakeFetch(scenario, extra);
  const source = createDataverseSource({ config: dvConfig, timeZone: "America/New_York", getSecret: async () => FAKE_SECRET, fetch: f.fetch, cacheDir, log: (r) => logs.push(r), now: () => NOW });
  return { source, calls: f.calls, logs, cacheDir };
}

const leaks = (s: string) => s.includes(FAKE_PAT_Adatum) || s.includes(FAKE_PAT_WC) || s.includes("FAKE-DV-PAT");

describe("Dataverse → DevOps settings", () => {
  it("reads my active Account Worker rows, then only this week's accounts, with the PAT wrapped", async () => {
    const s = setup();
    const r = await s.source.devopsTargets(["Adatum", "T&S"]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const adatum = r.targets.find((t) => t.clientKey === "Adatum")!;
    // The project name is used even when an ID is stored: real stored IDs can be stale.
    expect(adatum).toMatchObject({ accountId: ACCT.adatum, org: "contoso", project: "Project Ada", projectName: "Project Ada", email: "me@contoso.example" });
    expect(adatum.pat).toBeInstanceOf(Pat);
    expect(adatum.pat!.basicAuth()).toBe(`Basic ${Buffer.from(`:${FAKE_PAT_Adatum}`).toString("base64")}`);
    // A blank DevOps email stays null (never guessed).
    expect(r.targets.find((t) => t.clientKey === "T&S")).toMatchObject({ project: "WC Project", email: null });
    // HME has an Account Worker but no block this week: not returned.
    expect(r.targets.map((t) => t.clientKey).sort()).toEqual(["Adatum", "T&S"]);

    const workers = decodeURIComponent(s.calls.find((c) => c.url.includes("coop_accountworkers"))!.url);
    expect(workers).toContain(`_coop_user_value eq ${ME} and statecode eq 0`);
    const accts = decodeURIComponent(s.calls.find((c) => c.url.includes("coop_devopstoken"))!.url);
    expect(accts).toContain(`accountid eq ${ACCT.adatum}`);
    expect(accts).toContain("coop_reportingnickname eq 'Adatum' or name eq 'Adatum' or coop_reportingnickname eq 'T&S' or name eq 'T&S'");
  });

  it("the PAT cannot be serialized, printed or logged from the targets", async () => {
    const s = setup();
    const r = await s.source.devopsTargets(["Adatum", "T&S"]);
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
    const r = await setup("ok", { devopsAccounts: dup }).source.devopsTargets(["Adatum"]);
    if (!r.ok) throw new Error("expected ok");
    expect(r.targets.filter((t) => t.clientKey === "Adatum").every((t) => t.pat === null && t.problem === "More than one account is named Adatum in Dataverse")).toBe(true);
  });

  it.each<[Scenario, string, "network" | undefined]>([
    ["network_down", "Dataverse unreachable", "network"],
    ["dv_403", "Dataverse access denied", undefined],
    ["dv_503", "Dataverse read failed", undefined],
  ])("%s: a plain failure with no body, secret or token", async (scenario, message, cause) => {
    const s = setup(scenario);
    const r = await s.source.devopsTargets(["Adatum"]);
    expect(r).toEqual({ ok: false, message, ...(cause ? { cause } : {}) });
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
      { clientKey: "Adatum", clientName: "Adatum", devops: true, devopsEmail: "me@contoso.example" },
      { clientKey: "HM Electronics", clientName: "HM Electronics", devops: true, devopsEmail: "c.someone@hme.example" },
      { clientKey: "T&S", clientName: "T&S", devops: true, devopsEmail: null },
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
