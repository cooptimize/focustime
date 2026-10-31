import { mkdtempSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import type { LogRecord } from "../../log/logger.ts";
import type { ClientWork } from "../../week/types.ts";
import { cacheKey, createDevOpsSource, type ClientRef } from "./source.ts";
import { Pat } from "./pat.ts";
import { fakeDevOps, fakePat, target, type OrgScenario } from "./test-fakes.ts";
import type { DevOpsTarget, TargetsResult } from "./types.ts";

const NY = "America/New_York";
const T0 = Temporal.Instant.from("2026-11-02T13:02:00Z");
const ref = (k: string): ClientRef => ({ clientKey: k, clientName: k });

function setup(orgs: Record<string, OrgScenario>, targets: DevOpsTarget[] | TargetsResult, opts: { ids?: number; cacheDir?: string; pickableTypes?: string[] } = {}) {
  const api = fakeDevOps(orgs, opts);
  const logs: LogRecord[] = [];
  const cacheDir = opts.cacheDir ?? mkdtempSync(join(tmpdir(), "coopilot-devops-"));
  let clock = T0;
  const targetCalls: string[][] = [];
  const src = createDevOpsSource({
    fetch: api.fetch,
    retryDelayMs: 0,
    log: (r) => logs.push(r),
    cacheDir,
    timeZone: NY,
    now: () => clock,
    ...(opts.pickableTypes ? { pickableTypes: () => opts.pickableTypes! } : {}),
    targets: async (keys) => {
      targetCalls.push(keys);
      return Array.isArray(targets) ? { ok: true, targets: targets.filter((t) => keys.includes(t.clientKey)) } : targets;
    },
  });
  return { src, calls: api.calls, logs, cacheDir, targetCalls, advance: (ms: number) => (clock = clock.add({ milliseconds: ms })) };
}

const byKey = (r: ClientWork[], k: string) => r.find((c) => c.clientKey === k)!;
const ids = (c: ClientWork) => c.items.map((i) => i.id);

describe("DevOps work items per client", () => {
  it("fetches each client from its own org with its own PAT and shows items in board order", async () => {
    const s = setup({ cscsteel: "agile", jcerp: "scrum" }, [target("CSC", "cscsteel"), target("Quiddity", "jcerp")]);
    const r = await s.src.load([ref("CSC"), ref("Quiddity")]);
    expect(byKey(r, "CSC")).toMatchObject({ status: "ok", fromCache: false, fetchedAt: "2026-11-02T08:02:00-05:00" });
    expect(ids(byKey(r, "CSC"))).toEqual([102, 101, 105, 103]);
    expect(ids(byKey(r, "Quiddity"))).toEqual([202, 201]);
    for (const c of s.calls) {
      const org = new URL(c.url).pathname.split("/")[1];
      const expected = org === "cscsteel" ? fakePat("CSC") : fakePat("Quiddity");
      expect(c.authorization).toBe(`Basic ${Buffer.from(`:${expected}`).toString("base64")}`);
      expect(c.url).toMatch(/api-version=7\.1/);
      expect(c.redirect).toBe("manual");
    }
  });

  it("asks WIQL for me (the client's DevOps email), and the batch for only the fields used", async () => {
    const s = setup({ cscsteel: "agile" }, [target("CSC", "cscsteel", { email: "t.spaulding@cscsteelusa.com", project: "11111111-2222-4333-8444-555555555555", projectName: "Project Ada" })]);
    const r = await s.src.load([ref("CSC")]);
    const wiql = s.calls.find((c) => c.url.includes("/_apis/wit/wiql"))!;
    expect(wiql.url).toContain("https://dev.azure.com/cscsteel/11111111-2222-4333-8444-555555555555/_apis/wit/wiql?$top=1000&api-version=7.1");
    expect(JSON.parse(wiql.body!).query).toContain("[System.AssignedTo] = 't.spaulding@cscsteelusa.com'");
    const batch = s.calls.find((c) => c.url.includes("workitemsbatch"))!;
    expect(JSON.parse(batch.body!)).toEqual({
      ids: [101, 102, 103, 104, 105],
      fields: ["System.Id", "System.Title", "System.WorkItemType", "System.State", "System.Parent", "System.ChangedDate", "Microsoft.VSTS.Common.StackRank"],
      errorPolicy: "omit",
    });
    expect(byKey(r, "CSC").items[0]!.url).toBe("https://dev.azure.com/cscsteel/Project%20Ada/_workitems/edit/102");
  });

  it("reads states per type when the types list has none (Scrum fixture)", async () => {
    const s = setup({ jcerp: "scrum" }, [target("Quiddity", "jcerp")]);
    await s.src.load([ref("Quiddity")]);
    expect(s.calls.filter((c) => c.url.includes("/states?")).map((c) => decodeURIComponent(new URL(c.url).pathname.split("/").at(-2)!))).toEqual(["Product Backlog Item", "Task"]);
  });

  it("batches more than 200 ids", async () => {
    const s = setup({ big: "agile" }, [target("Big", "big")], { ids: 450 });
    const r = await s.src.load([ref("Big")]);
    expect(s.calls.filter((c) => c.url.includes("workitemsbatch")).map((c) => JSON.parse(c.body!).ids.length)).toEqual([200, 200, 50]);
    expect(byKey(r, "Big").items).toHaveLength(450);
  });
});

describe("client isolation", () => {
  it("one client failing leaves the others live and intact", async () => {
    const s = setup({ cscsteel: "agile", jcerp: "pat_expired", coop: "scrum" }, [target("CSC", "cscsteel"), target("Quiddity", "jcerp"), target("Cooptimize", "coop")]);
    const r = await s.src.load([ref("CSC"), ref("Quiddity"), ref("Cooptimize")]);
    expect(byKey(r, "CSC").status).toBe("ok");
    expect(byKey(r, "Cooptimize").status).toBe("ok");
    expect(byKey(r, "Quiddity")).toMatchObject({ status: "auth_failed", items: [] });
    expect(ids(byKey(r, "CSC"))).toEqual([102, 101, 105, 103]);
    expect(ids(byKey(r, "Cooptimize"))).toEqual([202, 201]);
  });

  it("items never cross clients, even when two clients share an org", async () => {
    const s = setup({ cooptimize: "agile" }, [target("W&C", "cooptimize", { project: "Woodard Curran", projectName: "Woodard Curran" }), target("Cooptimize", "cooptimize", { project: "Cooptimize Internal", projectName: "Cooptimize Internal" })]);
    const r = await s.src.load([ref("W&C"), ref("Cooptimize")]);
    expect(byKey(r, "W&C").items.every((i) => i.url.includes("/Woodard%20Curran/"))).toBe(true);
    expect(byKey(r, "Cooptimize").items.every((i) => i.url.includes("/Cooptimize%20Internal/"))).toBe(true);
    expect(r.map((c) => c.clientKey)).toEqual(["W&C", "Cooptimize"]);
  });

  it("a slow or failing org does not stop the others from returning", async () => {
    const s = setup({ a: "offline", b: "agile" }, [target("A", "a"), target("B", "b")]);
    const r = await s.src.load([ref("A"), ref("B")]);
    expect(byKey(r, "A").status).toBe("unreachable");
    expect(byKey(r, "B").status).toBe("ok");
  });

  it("retries a request once after a network blip (live run, step 6c), but not a host that doesn't exist", async () => {
    const s = setup({ a: "flaky", b: "host_not_found" }, [target("A", "a"), target("B", "b")]);
    const r = await s.src.load([ref("A"), ref("B")]);
    expect(byKey(r, "A").status).toBe("ok");
    expect(byKey(r, "A").items.length).toBeGreaterThan(0);
    expect(byKey(r, "B").status).toBe("unreachable");
    // Host not found: each request is tried once (no repeats of the same URL).
    const b = s.calls.filter((c) => c.url.includes("/b/")).map((c) => c.url);
    expect(b.length).toBeGreaterThan(0);
    expect(new Set(b).size).toBe(b.length);
  });

  it("refuses two accounts that share a client key rather than mixing them", async () => {
    const s = setup({ a: "agile" }, [target("CSC", "a", { pat: null, problem: "More than one account is named CSC in Dataverse" })]);
    const r = await s.src.load([ref("CSC")]);
    expect(byKey(r, "CSC")).toMatchObject({ status: "error", message: "More than one account is named CSC in Dataverse. No cached items yet", items: [] });
    expect(s.calls).toHaveLength(0);
  });
});

describe("setup problems are stated, never guessed", () => {
  it("identity missing: says so, makes no DevOps call, shows no cached items", async () => {
    const s = setup({ cooptimize: "agile" }, [target("W&C", "cooptimize", { email: null })]);
    const r = await s.src.load([ref("W&C")]);
    expect(byKey(r, "W&C")).toEqual({ clientKey: "W&C", clientName: "W&C", status: "identity_missing", message: "DevOps identity missing for W&C", fetchedAt: null, fromCache: false, items: [], children: [] });
    expect(s.calls).toHaveLength(0);
  });

  it("no Account Worker for the client", async () => {
    const r = await setup({}, []).src.load([ref("HME")]);
    expect(byKey(r, "HME")).toMatchObject({ status: "not_set_up", message: "No Account Worker for HME in Dataverse" });
  });

  it("missing org, project or PAT is named", async () => {
    const r = await setup({}, [target("A", "a", { org: null, pat: null })]).src.load([ref("A")]);
    expect(byKey(r, "A").message).toBe("DevOps not set up for A (missing organization, PAT)");
  });

  it("an org value that is not a plain name is rejected before any request", async () => {
    const s = setup({}, [target("A", "evil.example/x")]);
    expect(byKey(await s.src.load([ref("A")]), "A").status).toBe("not_set_up");
    expect(s.calls).toHaveLength(0);
  });

  it("Dataverse unavailable: every client falls back to its own cache", async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "coopilot-devops-"));
    await setup({ a: "agile" }, [target("A", "a")], { cacheDir }).src.load([ref("A")]);
    const s = setup({ a: "agile" }, { ok: false, message: "Dataverse unreachable" }, { cacheDir });
    const r = await s.src.load([ref("A"), ref("B")]);
    expect(byKey(r, "A")).toMatchObject({ status: "unreachable", fromCache: true, message: "DevOps settings unavailable (Dataverse unreachable). Showing items from 8:02 AM" });
    expect(byKey(r, "B")).toMatchObject({ status: "unreachable", fromCache: false, message: "DevOps settings unavailable (Dataverse unreachable). No cached items yet", items: [] });
    expect(s.calls).toHaveLength(0);
  });

  it("Dataverse settings unavailable because the keyring is locked: says so, not unreachable", async () => {
    const s = setup({ a: "agile" }, { ok: false, message: "keyring locked", cause: "keyring" });
    const r = byKey(await s.src.load([ref("A")]), "A");
    expect(r).toMatchObject({ status: "error", cause: "keyring", message: "DevOps settings unavailable (keyring locked). No cached items yet" });
    expect(s.calls).toHaveLength(0);
  });
});

describe("failure states, each with a plain message and the client's own cache", () => {
  const cases: [OrgScenario, string, string][] = [
    ["pat_expired", "auth_failed", "DevOps PAT expired or invalid for A"],
    ["signin_203", "auth_failed", "DevOps PAT expired or invalid for A"],
    ["signin_redirect", "auth_failed", "DevOps PAT expired or invalid for A"],
    ["html_200", "auth_failed", "DevOps PAT expired or invalid for A"],
    ["no_access", "no_access", "No access to DevOps project A Project for A"],
    ["forbidden", "no_access", "No access to DevOps project A Project for A"],
    ["offline", "unreachable", "DevOps organization a unreachable"],
    ["host_not_found", "unreachable", "DevOps organization a unreachable"],
    ["server_error", "error", "DevOps error (HTTP 500) for A"],
    ["batch_fails", "error", "DevOps error (HTTP 500) for A"],
  ];

  it.each(cases)("%s → %s, falls back to the last good items", async (scenario, status, message) => {
    const cacheDir = mkdtempSync(join(tmpdir(), "coopilot-devops-"));
    const good = await setup({ a: "agile" }, [target("A", "a")], { cacheDir }).src.load([ref("A")]);
    const r = await setup({ a: scenario }, [target("A", "a")], { cacheDir }).src.load([ref("A")]);
    expect(byKey(r, "A")).toMatchObject({ status, fromCache: true, message: `${message}. Showing items from 8:02 AM` });
    expect(byKey(r, "A").items).toEqual(byKey(good, "A").items);
  });

  it.each(cases)("%s with no cache says so", async (scenario, status, message) => {
    const r = await setup({ a: scenario }, [target("A", "a")]).src.load([ref("A")]);
    expect(byKey(r, "A")).toMatchObject({ status, fromCache: false, message: `${message}. No cached items yet`, items: [] });
  });

  it("a failed batch never overwrites the snapshot with partial results", async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "coopilot-devops-"));
    await setup({ a: "agile" }, [target("A", "a")], { cacheDir }).src.load([ref("A")]);
    const before = readFileSync(join(cacheDir, "devops", `${cacheKey("A")}.json`), "utf8");
    await setup({ a: "batch_fails" }, [target("A", "a")], { cacheDir }).src.load([ref("A")]);
    expect(readFileSync(join(cacheDir, "devops", `${cacheKey("A")}.json`), "utf8")).toBe(before);
  });
});

describe("refresh and throttling", () => {
  it("a normal load within 5 minutes reuses results (changing weeks makes no DevOps calls)", async () => {
    const s = setup({ a: "agile" }, [target("A", "a")]);
    await s.src.load([ref("A")]);
    const n = s.calls.length;
    s.advance(4 * 60_000);
    await s.src.load([ref("A")]);
    expect(s.calls.length).toBe(n);
    s.advance(61_000);
    await s.src.load([ref("A")]);
    expect(s.calls.length).toBeGreaterThan(n);
  });

  it("a forced refresh refetches a client at most once a minute", async () => {
    const s = setup({ a: "agile" }, [target("A", "a")]);
    await s.src.load([ref("A")], { refresh: true });
    const wiqls = () => s.calls.filter((c) => c.url.includes("/wiql")).length;
    s.advance(30_000);
    await s.src.load([ref("A")], { refresh: true });
    expect(wiqls()).toBe(1);
    s.advance(31_000);
    await s.src.load([ref("A")], { refresh: true });
    expect(wiqls()).toBe(2);
  });

  it("reads PATs from Dataverse only for clients being fetched, at fetch time", async () => {
    const s = setup({ a: "agile", b: "agile" }, [target("A", "a"), target("B", "b")]);
    await s.src.load([ref("A")]);
    await s.src.load([ref("A"), ref("B")]);
    expect(s.targetCalls).toEqual([["A"], ["B"]]);
  });

  it("caches type and state metadata for an hour; items are refetched", async () => {
    const s = setup({ a: "agile" }, [target("A", "a")]);
    await s.src.load([ref("A")], { refresh: true });
    s.advance(2 * 60_000);
    await s.src.load([ref("A")], { refresh: true });
    expect(s.calls.filter((c) => c.url.includes("processconfiguration"))).toHaveLength(1);
    expect(s.calls.filter((c) => c.url.includes("/wiql"))).toHaveLength(2);
  });
});

describe("PAT never leaks", () => {
  const all: OrgScenario[] = ["agile", "scrum", "custom", "pat_expired", "signin_203", "signin_redirect", "html_200", "no_access", "forbidden", "offline", "host_not_found", "server_error", "batch_fails"];
  const pat = fakePat("A");
  const b64 = Buffer.from(`:${pat}`).toString("base64");
  const leaks = (text: string) => text.includes(pat) || text.includes(b64) || text.includes("FAKEPAT") || text.includes("AZDO");

  it.each(all)("%s: not in results, messages, logs, cache files or thrown errors", async (scenario) => {
    const s = setup({ a: scenario }, [target("A", "a")]);
    const r = await s.src.load([ref("A")], { refresh: true });
    expect(leaks(JSON.stringify(r))).toBe(false);
    expect(leaks(inspect(r, { depth: 10 }))).toBe(false);
    expect(leaks(JSON.stringify(s.logs))).toBe(false);
    const dir = join(s.cacheDir, "devops");
    if (existsSync(dir)) for (const f of readdirSync(dir)) expect(leaks(readFileSync(join(dir, f), "utf8"))).toBe(false);
  });

  it("the Authorization header only ever goes to dev.azure.com, to the client's own org", async () => {
    const s = setup({ a: "signin_redirect", b: "agile" }, [target("A", "a"), target("B", "b")]);
    await s.src.load([ref("A"), ref("B")]);
    for (const c of s.calls) {
      expect(new URL(c.url).origin).toBe("https://dev.azure.com");
      const org = new URL(c.url).pathname.split("/")[1];
      expect(c.authorization).toBe(new Pat(fakePat(org === "a" ? "A" : "B")).basicAuth());
    }
  });

  it("no identity email in the cache either", async () => {
    const s = setup({ a: "agile" }, [target("A", "a")]);
    await s.src.load([ref("A")]);
    expect(readFileSync(join(s.cacheDir, "devops", `${cacheKey("A")}.json`), "utf8")).not.toContain("tanner@");
  });
});

describe("Pat wrapper", () => {
  const p = new Pat("secret-pat-value");
  it("hides the value from String, templates, JSON and inspect", () => {
    expect(String(p)).toBe("[PAT]");
    expect(`${p}`).toBe("[PAT]");
    expect(JSON.stringify({ p })).toBe('{"p":"[PAT]"}');
    expect(inspect({ p })).not.toContain("secret-pat-value");
    expect(Object.keys(p)).toEqual([]);
  });
  it("builds Basic auth from an empty user name and the PAT", () => {
    expect(p.basicAuth()).toBe(`Basic ${Buffer.from(":secret-pat-value").toString("base64")}`);
  });
});

describe("cache keys", () => {
  it("are safe file names and differ per client", () => {
    expect(cacheKey("W&C")).toMatch(/^w-c-[0-9a-f]{8}$/);
    expect(cacheKey("W&C")).not.toBe(cacheKey("W C"));
    expect(cacheKey("../../etc")).toMatch(/^etc-[0-9a-f]{8}$/);
  });
});

describe("story level: children of epics and features (step 5)", () => {
  it("levels come from the process backlog categories, and portfolio items bring their open children two levels down", async () => {
    const s = setup({ cscsteel: "portfolio" }, [target("CSC", "cscsteel")]);
    const [csc] = await s.src.load([ref("CSC")]);
    expect(csc!.status).toBe("ok");
    const level = Object.fromEntries([...csc!.items, ...csc!.children].map((i) => [i.id, i.level]));
    expect(level).toMatchObject({ 101: "story", 110: "portfolio", 120: "portfolio", 130: "portfolio", 111: "story", 112: "story", 121: "portfolio", 122: "story" });
    expect(csc!.children.map((c) => c.id).sort()).toEqual([111, 112, 121, 122]);
    expect(csc!.children.find((c) => c.id === 122)!.parentId).toBe(121);
  });

  it("children are read with WIQL and the batch call only (no write endpoints), and the parent filter replaces the assignee", async () => {
    const s = setup({ cscsteel: "portfolio" }, [target("CSC", "cscsteel")]);
    await s.src.load([ref("CSC")]);
    for (const c of s.calls) {
      if (c.method === "POST") expect(c.url).toMatch(/\/_apis\/wit\/(wiql|workitemsbatch)\?/);
      else expect(c.method).toBe("GET");
    }
    const queries = s.calls.filter((c) => c.url.includes("/_apis/wit/wiql")).map((c) => (JSON.parse(c.body!) as { query: string }).query);
    expect(queries).toHaveLength(3); // mine, children, grandchildren
    expect(queries[1]).toContain("[System.Parent] IN (110, 120, 130)");
    expect(queries[1]).not.toContain("[System.AssignedTo]");
    expect(queries[2]).toContain("[System.Parent] IN (121)");
  });

  it("lookup finds my items and children for the right client only", async () => {
    const s = setup({ cscsteel: "portfolio", cooptimize: "agile" }, [target("CSC", "cscsteel"), target("Cooptimize", "cooptimize")]);
    await s.src.load([ref("CSC"), ref("Cooptimize")]);
    expect(s.src.lookup("CSC", 122)?.title).toBe("Story two levels down");
    expect(s.src.lookup("Cooptimize", 122)).toBeNull();
    expect(s.src.lookup("CSC", 999)).toBeNull();
  });

  it("children are cached with the items and come back on failure", async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "coopilot-devops-"));
    await setup({ cscsteel: "portfolio" }, [target("CSC", "cscsteel")], { cacheDir }).src.load([ref("CSC")]);
    const [csc] = await setup({ cscsteel: "offline" }, [target("CSC", "cscsteel")], { cacheDir }).src.load([ref("CSC")]);
    expect(csc!.fromCache).toBe(true);
    expect(csc!.children.map((c) => c.id).sort()).toEqual([111, 112, 121, 122]);
  });
});

describe("pickable portfolio types from config (Q20)", () => {
  it("a listed portfolio type is pickable and is not opened into children", async () => {
    const s = setup({ cscsteel: "portfolio" }, [target("CSC", "cscsteel")], { pickableTypes: ["feature"] });
    const [csc] = await s.src.load([ref("CSC")]);
    const level = Object.fromEntries(csc!.items.map((i) => [i.id, i.level]));
    expect(level).toMatchObject({ 110: "story", 130: "story", 120: "portfolio" });
    const queries = s.calls.filter((c) => c.url.includes("/_apis/wit/wiql")).map((c) => (JSON.parse(c.body!) as { query: string }).query);
    expect(queries[1]).toContain("[System.Parent] IN (120)");
  });
});
