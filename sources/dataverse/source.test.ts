import { createSnapshotStore } from "../../host/local/snapshots.ts";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SecretError } from "../../host/types.ts";
import type { LogRecord } from "../../log/logger.ts";
import { createDataverseSource, type DataverseSourceDeps } from "./source.ts";
import { dvConfig, ENV, FAKE_SECRET, FAKE_TOKEN, fakeFetch, ME, type Scenario } from "./test-fakes.ts";

const WEEK = "2026-11-02";
const NOW = Temporal.Instant.from("2026-11-02T13:02:00Z"); // 08:02 New York

function setup(scenario: Scenario, over: Partial<DataverseSourceDeps> = {}) {
  const cacheDir = mkdtempSync(join(tmpdir(), "focustime-cache-"));
  const logs: LogRecord[] = [];
  const f = fakeFetch(scenario);
  const source = createDataverseSource({
    config: dvConfig,
    timeZone: "America/New_York",
    getSecret: async () => FAKE_SECRET,
    fetch: f.fetch,
    snapshots: createSnapshotStore(cacheDir),
    log: (r) => logs.push(r),
    now: () => NOW,
    ...over,
  });
  return { source, cacheDir, logs, calls: f.calls };
}

function seedCache(cacheDir: string) {
  mkdirSync(join(cacheDir, "dataverse"), { recursive: true });
  writeFileSync(
    join(cacheDir, "dataverse", `${WEEK}.json`),
    JSON.stringify({ fetchedAt: "2026-11-02T08:02:00-05:00", items: [{ id: "cached", clientKey: "Adatum", clientName: "Adatum", startDate: "2026-01-05", endDate: null, active: true, days: { Mon: "PM" } }] }),
  );
}

describe("Dataverse source: success", () => {
  it("returns my four patterns live, with fetchedAt and no cache flag", async () => {
    const { source } = setup("ok");
    const r = await source.load(WEEK);
    expect(r).toMatchObject({ source: "dataverse", status: "ok", fromCache: false, fetchedAt: "2026-11-02T08:02:00-05:00" });
    expect(r.items.map((p) => p.clientName)).toEqual(["Proseware", "Adatum", "Internal", "Example Engineering Partners"]);
  });

  it("asks for a client-credentials token for the environment scope", async () => {
    const { source, calls } = setup("ok");
    await source.load(WEEK);
    const tok = calls[0]!;
    expect(tok.url).toBe(`https://login.microsoftonline.com/${dvConfig.tenantId}/oauth2/v2.0/token`);
    expect(tok.method).toBe("POST");
    const body = new URLSearchParams(tok.body);
    expect(body.get("grant_type")).toBe("client_credentials");
    expect(body.get("client_id")).toBe(dvConfig.clientId);
    expect(body.get("scope")).toBe(`${ENV}/.default`);
    expect(tok.headers.authorization).toBeUndefined();
  });

  it("queries only my active rows overlapping the week, with explicit selects and never the PAT column", async () => {
    const { source, calls } = setup("ok");
    await source.load(WEEK);
    const focus = decodeURIComponent(calls.find((c) => c.url.includes("coop_focustimes"))!.url);
    expect(focus).toContain("statecode eq 0");
    expect(focus).toContain("coop_startdate le 2026-11-05");
    expect(focus).toContain("(coop_enddate eq null or coop_enddate ge 2026-11-02)");
    expect(focus).toContain(`_coop_systemuser_value eq ${ME}`);
    expect(focus).toContain(`coop_AccountWorker/_coop_user_value eq ${ME}`);
    expect(focus).toContain("$expand=coop_AccountWorker($select=_coop_user_value,_coop_account_value)");
    const acct = decodeURIComponent(calls.find((c) => c.url.includes("/accounts"))!.url);
    expect(acct).toContain("$select=accountid,name,coop_reportingnickname");
    for (const c of calls) expect(c.url.toLowerCase()).not.toContain("devopstoken");
    for (const c of calls.filter((c) => c.url.startsWith(ENV))) expect(c.headers.authorization).toBe(`Bearer ${FAKE_TOKEN}`);
  });

  it("follows nextLink pages", async () => {
    const { source } = setup("paged");
    expect((await source.load(WEEK)).items).toHaveLength(4);
  });

  it("caches the last good snapshot with normalized fields only", async () => {
    const { source, cacheDir } = setup("ok");
    await source.load(WEEK);
    const file = readFileSync(join(cacheDir, "dataverse", `${WEEK}.json`), "utf8");
    const snap = JSON.parse(file);
    expect(snap.fetchedAt).toBe("2026-11-02T08:02:00-05:00");
    expect(snap.items).toHaveLength(4);
    expect(file).not.toContain("@odata");
    expect(file).not.toContain("_coop_");
  });

  it("reuses a fresh in-memory result and the token, and refetches on refresh", async () => {
    const { source, calls } = setup("ok");
    await source.load(WEEK);
    const n = calls.length;
    await source.load(WEEK);
    expect(calls.length).toBe(n);
    await source.load(WEEK, { refresh: true });
    expect(calls.filter((c) => c.url.includes("login.microsoftonline.com"))).toHaveLength(1);
    expect(calls.length).toBeGreaterThan(n);
  });

  it("logs source, operation, HTTP status, duration and count", async () => {
    const { source, logs } = setup("ok");
    await source.load(WEEK);
    expect(logs.find((l) => l.op === "focustimes")).toMatchObject({ source: "dataverse", status: 200, count: 5 });
    expect(logs.every((l) => typeof l.durationMs === "number" || l.durationMs === undefined)).toBe(true);
  });
});

describe("Dataverse source: failure states (spec section 9)", () => {
  it.each<[Scenario, string, string, string | undefined]>([
    ["dv_401", "auth_required", "Dataverse access denied: check app user role", "open_settings"],
    ["dv_403", "auth_required", "Dataverse access denied: check app user role", "open_settings"],
    ["table_missing", "misconfigured", "Focus block table coop_focustimes not found in Dataverse (renamed or removed?): check config", "open_settings"],
    ["column_missing", "misconfigured", "Focus block column coop_mondaydaypart not found in coop_focustimes (renamed or removed?): check config", "open_settings"],
    ["token_invalid_client", "auth_required", "Dataverse sign-in failed: the client secret was rejected. Update keyring entry focustime / dataverse-client-secret", "open_settings"],
    ["token_bad_tenant", "misconfigured", "Dataverse sign-in failed: check tenant_id and client_id in config", "open_settings"],
    ["token_bad_scope", "misconfigured", "Dataverse sign-in failed: check environment_url in config", "open_settings"],
    ["env_not_found", "misconfigured", "Dataverse environment not found: check environment_url in config", "open_settings"],
    ["dv_503", "error", "Dataverse error (HTTP 503)", undefined],
    ["page_fails", "error", "Dataverse returned only part of the results, so none were used", undefined],
    ["paged_foreign_next", "error", "Dataverse returned a next-page link to another host, so it was not followed", undefined],
    ["network_down", "unreachable", "Dataverse unreachable", undefined],
    ["timeout", "unreachable", "Dataverse unreachable", undefined],
    ["token_network_down", "unreachable", "Dataverse unreachable", undefined],
  ])("%s → %s", async (scenario, status, message, fixAction) => {
    const { source } = setup(scenario);
    const r = await source.load(WEEK);
    expect(r.status).toBe(status);
    expect(r.message).toBe(`${message}. No cached data yet`);
    expect(r.fixAction).toBe(fixAction);
    expect(r.items).toEqual([]);
    expect(r.fromCache).toBe(false);
  });

  it("serves the last good snapshot when offline, with its time", async () => {
    const { source, cacheDir } = setup("network_down");
    seedCache(cacheDir);
    const r = await source.load(WEEK);
    expect(r).toMatchObject({ status: "unreachable", fromCache: true, fetchedAt: "2026-11-02T08:02:00-05:00", message: "Offline, showing data from 8:02 AM" });
    expect(r.items.map((p) => p.id)).toEqual(["cached"]);
  });

  it("serves the snapshot on other errors too and says so", async () => {
    const { source, cacheDir } = setup("dv_403");
    seedCache(cacheDir);
    const r = await source.load(WEEK);
    expect(r).toMatchObject({ status: "auth_required", fromCache: true });
    expect(r.message).toBe("Dataverse access denied: check app user role. Showing data from 8:02 AM");
  });

  it("does not follow a foreign nextLink with the token", async () => {
    const { source, calls } = setup("paged_foreign_next");
    await source.load(WEEK);
    expect(calls.some((c) => c.url.includes("attacker.example.com"))).toBe(false);
  });

  it("does not overwrite the snapshot after a failed fetch", async () => {
    const { source, cacheDir } = setup("page_fails");
    seedCache(cacheDir);
    await source.load(WEEK);
    expect(readFileSync(join(cacheDir, "dataverse", `${WEEK}.json`), "utf8")).toContain('"cached"');
  });

  it("reports a missing keyring entry as misconfigured", async () => {
    const { source } = setup("ok", { getSecret: async () => { throw new SecretError("not_found"); } });
    const r = await source.load(WEEK);
    expect(r.status).toBe("misconfigured");
    expect(r.message).toBe("No Dataverse client secret in the keyring (service focustime, account dataverse-client-secret). No cached data yet");
  });

  it.each(["unavailable", "locked"] as const)("reports a %s keyring as secret storage unavailable", async (kind) => {
    const { source } = setup("ok", { getSecret: async () => { throw new SecretError(kind); } });
    const r = await source.load(WEEK);
    expect(r.status).toBe("error");
    expect(r.message).toMatch(/^Secret storage unavailable \(Secret Service/);
    // The shared root cause, so the status bar names it once for every source it stops (step 6.1).
    expect(r.cause).toBe("keyring");
  });

  it("does not retry the network inside the memory TTL after an error, unless refreshed", async () => {
    const { source, calls } = setup("dv_503");
    await source.load(WEEK);
    const n = calls.length;
    await source.load(WEEK, { refresh: true });
    expect(calls.length).toBeGreaterThan(n);
  });
});

describe("resolveUserId", () => {
  const make = (users: unknown[]) => {
    const f = fakeFetch("ok", { users });
    const src = createDataverseSource({
      config: { ...dvConfig, mySystemUserId: null },
      timeZone: "America/New_York",
      getSecret: async () => FAKE_SECRET,
      fetch: f.fetch,
      snapshots: createSnapshotStore(mkdtempSync(join(tmpdir(), "focustime-cache-"))),
      log: () => {},
    });
    return { src, calls: f.calls };
  };

  it("finds exactly one user by internal email", async () => {
    const { src, calls } = make([{ systemuserid: ME }]);
    expect(await src.resolveUserId("o'neil@example.com")).toEqual({ ok: true, id: ME });
    const url = decodeURIComponent(calls.find((c) => c.url.includes("systemusers"))!.url);
    expect(url).toContain("$select=systemuserid");
    expect(url).toContain("internalemailaddress eq 'o''neil@example.com'");
  });

  it("refuses zero or several matches", async () => {
    expect((await make([]).src.resolveUserId("me@example.com")).ok).toBe(false);
    expect((await make([{ systemuserid: ME }, { systemuserid: "x" }]).src.resolveUserId("me@example.com")).ok).toBe(false);
  });
});

describe("secret and token never leak", () => {
  const scenarios: Scenario[] = [
    "ok", "paged", "paged_foreign_next", "page_fails", "dv_401", "dv_403", "table_missing", "column_missing",
    "dv_503", "network_down", "timeout", "token_invalid_client", "token_bad_tenant", "token_bad_scope", "env_not_found", "token_network_down",
  ];

  it.each(scenarios)("%s: not in logs, cache, results or errors", async (scenario) => {
    const { source, cacheDir, logs } = setup(scenario);
    seedCache(cacheDir);
    const results: string[] = [];
    try {
      results.push(JSON.stringify(await source.load(WEEK)));
      results.push(JSON.stringify(await source.load(WEEK, { refresh: true })));
      results.push(JSON.stringify(await source.resolveUserId("me@example.com")));
    } catch (e) {
      results.push(String(e), (e as Error).stack ?? "");
    }
    const cache = readdirSync(join(cacheDir, "dataverse")).map((f) => readFileSync(join(cacheDir, "dataverse", f), "utf8"));
    const everything = [JSON.stringify(logs), ...cache, ...results].join("\n");
    expect(everything).not.toContain(FAKE_SECRET);
    expect(everything).not.toContain(FAKE_TOKEN);
    expect(everything).not.toMatch(/authorization/i);
    expect(everything).not.toContain("Echo:");
  });
});
