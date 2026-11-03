import { createSnapshotStore } from "../../host/local/snapshots.ts";
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
  const cacheDir = opts.cacheDir ?? mkdtempSync(join(tmpdir(), "focustime-devops-"));
  let clock = T0;
  const targetCalls: string[][] = [];
  const src = createDevOpsSource({
    fetch: api.fetch,
    retryDelayMs: 0,
    log: (r) => logs.push(r),
    snapshots: createSnapshotStore(cacheDir),
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

describe("items read by id for open follow-ups (step 7)", () => {
  it("reads only watched ids that aren't among my open items, completed ones kept, with the same fields", async () => {
    const s = setup({ contoso: "agile" }, [target("Adatum", "contoso")]);
    const r = await s.src.load([ref("Adatum")], { watch: { Adatum: [104, 101] } });
    const batches = s.calls.filter((c) => c.url.includes("workitemsbatch")).map((c) => JSON.parse(c.body!) as { ids: number[]; fields: string[] });
    expect(batches.at(-1)).toEqual({ ids: [104], fields: ["System.Id", "System.Title", "System.WorkItemType", "System.State", "System.Parent", "System.ChangedDate", "System.Tags", "System.ChangedBy", "Microsoft.VSTS.Common.StackRank"], errorPolicy: "omit" });
    expect(byKey(r, "Adatum").watched?.map((i) => [i.id, i.state, i.stateCategory])).toEqual([[104, "Closed", "Completed"]]);
    expect(ids(byKey(r, "Adatum"))).not.toContain(104);
  });
  it("makes no extra call when nothing is watched", async () => {
    const s = setup({ contoso: "agile" }, [target("Adatum", "contoso")]);
    const r = await s.src.load([ref("Adatum")]);
    expect(s.calls.filter((c) => c.url.includes("workitemsbatch"))).toHaveLength(1);
    expect(byKey(r, "Adatum").watched).toEqual([]);
  });
});

describe("DevOps work items per client", () => {
  it("fetches each client from its own org with its own PAT and shows items in board order", async () => {
    const s = setup({ contoso: "agile", fabrikam: "scrum" }, [target("Adatum", "contoso"), target("Proseware", "fabrikam")]);
    const r = await s.src.load([ref("Adatum"), ref("Proseware")]);
    expect(byKey(r, "Adatum")).toMatchObject({ status: "ok", fromCache: false, fetchedAt: "2026-11-02T08:02:00-05:00" });
    expect(ids(byKey(r, "Adatum"))).toEqual([102, 101, 105, 103]);
    expect(ids(byKey(r, "Proseware"))).toEqual([202, 201]);
    for (const c of s.calls) {
      const org = new URL(c.url).pathname.split("/")[1];
      const expected = org === "contoso" ? fakePat("Adatum") : fakePat("Proseware");
      expect(c.authorization).toBe(`Basic ${Buffer.from(`:${expected}`).toString("base64")}`);
      expect(c.url).toMatch(/api-version=7\.1/);
      expect(c.redirect).toBe("manual");
    }
  });

  it("asks WIQL for me (the client's DevOps email), and the batch for only the fields used", async () => {
    const s = setup({ contoso: "agile" }, [target("Adatum", "contoso", { email: "me@contoso.example", project: "11111111-2222-4333-8444-555555555555", projectName: "Project Ada" })]);
    const r = await s.src.load([ref("Adatum")]);
    const wiql = s.calls.find((c) => c.url.includes("/_apis/wit/wiql"))!;
    expect(wiql.url).toContain("https://dev.azure.com/contoso/11111111-2222-4333-8444-555555555555/_apis/wit/wiql?$top=1000&api-version=7.1");
    expect(JSON.parse(wiql.body!).query).toContain("[System.AssignedTo] = 'me@contoso.example'");
    const batch = s.calls.find((c) => c.url.includes("workitemsbatch"))!;
    expect(JSON.parse(batch.body!)).toEqual({
      ids: [101, 102, 103, 104, 105],
      fields: ["System.Id", "System.Title", "System.WorkItemType", "System.State", "System.Parent", "System.ChangedDate", "System.Tags", "System.ChangedBy", "Microsoft.VSTS.Common.StackRank"],
      errorPolicy: "omit",
    });
    expect(byKey(r, "Adatum").items[0]!.url).toBe("https://dev.azure.com/contoso/Project%20Ada/_workitems/edit/102");
  });

  it("reads states per type when the types list has none (Scrum fixture)", async () => {
    const s = setup({ fabrikam: "scrum" }, [target("Proseware", "fabrikam")]);
    await s.src.load([ref("Proseware")]);
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
    const s = setup({ contoso: "agile", fabrikam: "pat_expired", coop: "scrum" }, [target("Adatum", "contoso"), target("Proseware", "fabrikam"), target("Cooptimize", "coop")]);
    const r = await s.src.load([ref("Adatum"), ref("Proseware"), ref("Cooptimize")]);
    expect(byKey(r, "Adatum").status).toBe("ok");
    expect(byKey(r, "Cooptimize").status).toBe("ok");
    expect(byKey(r, "Proseware")).toMatchObject({ status: "auth_failed", items: [] });
    expect(ids(byKey(r, "Adatum"))).toEqual([102, 101, 105, 103]);
    expect(ids(byKey(r, "Cooptimize"))).toEqual([202, 201]);
  });

  it("items never cross clients, even when two clients share an org", async () => {
    const s = setup({ cooptimize: "agile" }, [target("T&W", "cooptimize", { project: "TW Project", projectName: "TW Project" }), target("Cooptimize", "cooptimize", { project: "Cooptimize Internal", projectName: "Cooptimize Internal" })]);
    const r = await s.src.load([ref("T&W"), ref("Cooptimize")]);
    expect(byKey(r, "T&W").items.every((i) => i.url.includes("/TW%20Project/"))).toBe(true);
    expect(byKey(r, "Cooptimize").items.every((i) => i.url.includes("/Cooptimize%20Internal/"))).toBe(true);
    expect(r.map((c) => c.clientKey)).toEqual(["T&W", "Cooptimize"]);
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
    const s = setup({ a: "agile" }, [target("Adatum", "a", { pat: null, problem: "More than one account is named Adatum in Dataverse" })]);
    const r = await s.src.load([ref("Adatum")]);
    expect(byKey(r, "Adatum")).toMatchObject({ status: "error", message: "More than one account is named Adatum in Dataverse. No cached items yet", items: [] });
    expect(s.calls).toHaveLength(0);
  });
});

describe("setup problems are stated, never guessed", () => {
  it("identity missing: says so, makes no DevOps call, shows no cached items", async () => {
    const s = setup({ cooptimize: "agile" }, [target("T&W", "cooptimize", { email: null })]);
    const r = await s.src.load([ref("T&W")]);
    expect(byKey(r, "T&W")).toEqual({ clientKey: "T&W", clientName: "T&W", status: "identity_missing", message: "DevOps identity missing for T&W", fetchedAt: null, fromCache: false, items: [], children: [] });
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
    const cacheDir = mkdtempSync(join(tmpdir(), "focustime-devops-"));
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
    const cacheDir = mkdtempSync(join(tmpdir(), "focustime-devops-"));
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
    const cacheDir = mkdtempSync(join(tmpdir(), "focustime-devops-"));
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
    expect(readFileSync(join(s.cacheDir, "devops", `${cacheKey("A")}.json`), "utf8")).not.toContain("avery@");
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
    expect(cacheKey("T&W")).toMatch(/^t-w-[0-9a-f]{8}$/);
    expect(cacheKey("T&W")).not.toBe(cacheKey("T W"));
    expect(cacheKey("../../etc")).toMatch(/^etc-[0-9a-f]{8}$/);
  });
});

describe("story level: children of epics and features (step 5)", () => {
  it("levels come from the process backlog categories, and portfolio items bring their open children two levels down", async () => {
    const s = setup({ contoso: "portfolio" }, [target("Adatum", "contoso")]);
    const [adatum] = await s.src.load([ref("Adatum")]);
    expect(adatum!.status).toBe("ok");
    const level = Object.fromEntries([...adatum!.items, ...adatum!.children].map((i) => [i.id, i.level]));
    expect(level).toMatchObject({ 101: "story", 110: "portfolio", 120: "portfolio", 130: "portfolio", 111: "story", 112: "story", 121: "portfolio", 122: "story" });
    expect(adatum!.children.map((c) => c.id).sort()).toEqual([111, 112, 121, 122]);
    expect(adatum!.children.find((c) => c.id === 122)!.parentId).toBe(121);
  });

  it("children are read with WIQL and the batch call only (no write endpoints), and the parent filter replaces the assignee", async () => {
    const s = setup({ contoso: "portfolio" }, [target("Adatum", "contoso")]);
    await s.src.load([ref("Adatum")]);
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
    const s = setup({ contoso: "portfolio", cooptimize: "agile" }, [target("Adatum", "contoso"), target("Cooptimize", "cooptimize")]);
    await s.src.load([ref("Adatum"), ref("Cooptimize")]);
    expect(s.src.lookup("Adatum", 122)?.title).toBe("Story two levels down");
    expect(s.src.lookup("Cooptimize", 122)).toBeNull();
    expect(s.src.lookup("Adatum", 999)).toBeNull();
  });

  it("children are cached with the items and come back on failure", async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "focustime-devops-"));
    await setup({ contoso: "portfolio" }, [target("Adatum", "contoso")], { cacheDir }).src.load([ref("Adatum")]);
    const [adatum] = await setup({ contoso: "offline" }, [target("Adatum", "contoso")], { cacheDir }).src.load([ref("Adatum")]);
    expect(adatum!.fromCache).toBe(true);
    expect(adatum!.children.map((c) => c.id).sort()).toEqual([111, 112, 121, 122]);
  });
});

describe("pickable portfolio types from config (Q20)", () => {
  it("a listed portfolio type is pickable and is not opened into children", async () => {
    const s = setup({ contoso: "portfolio" }, [target("Adatum", "contoso")], { pickableTypes: ["feature"] });
    const [adatum] = await s.src.load([ref("Adatum")]);
    const level = Object.fromEntries(adatum!.items.map((i) => [i.id, i.level]));
    expect(level).toMatchObject({ 110: "story", 130: "story", 120: "portfolio" });
    const queries = s.calls.filter((c) => c.url.includes("/_apis/wit/wiql")).map((c) => (JSON.parse(c.body!) as { query: string }).query);
    expect(queries[1]).toContain("[System.Parent] IN (120)");
  });
});

describe("Plan the week: features and epics (step 8)", () => {
  it("finds portfolio items assigned to me and the parents of my stories, with their children in every state", async () => {
    const s = setup({ planweek: "planweek" }, [target("Adatum", "planweek")]);
    const [adatum] = await s.src.portfolio([ref("Adatum")]);
    expect(adatum!.status).toBe("ok");
    // Board order (StackRank = id here). Q49: 230 is the epic above Dana's feature, read by following parent links up.
    expect(adatum!.items.map((i) => [i.id, i.tier, i.why])).toEqual([
      [210, "feature", ["parent"]],
      [220, "feature", ["parent"]],
      [230, "epic", ["above"]],
      [240, "feature", ["assigned"]],
      [250, "epic", ["assigned"]],
    ]);
    expect(adatum!.items.find((i) => i.id === 230)!.children.map((c) => [c.id, c.open, c.level])).toEqual([[210, true, "portfolio"]]);
    const dana = adatum!.items.find((i) => i.id === 210)!;
    expect(dana).toMatchObject({ title: "Dana's feature", state: "Active", targetDate: "2026-11-20", assignedTo: "Dana Ruiz", mine: false, url: "https://dev.azure.com/planweek/Adatum%20Project/_workitems/edit/210" });
    expect(dana.children.map((c) => [c.id, c.open, c.assignedTo, c.mine])).toEqual([[201, true, "Avery S", true], [211, false, "Dana Ruiz", false], [212, true, null, false]]);
    expect(adatum!.items.find((i) => i.id === 240)!.children).toEqual([]);
    // The epic's only feature is closed.
    expect(adatum!.items.find((i) => i.id === 250)!.children.map((c) => [c.id, c.open, c.level])).toEqual([[251, false, "portfolio"]]);
    // D461: story-level types too, so a story's target date can show in Plan the week (this fake gives every type the field).
    expect(adatum!.targetFields).toEqual({ Feature: "Microsoft.VSTS.Scheduling.TargetDate", "User Story": "Microsoft.VSTS.Scheduling.TargetDate", Bug: "Microsoft.VSTS.Scheduling.TargetDate", Task: "Microsoft.VSTS.Scheduling.TargetDate" });
    // Step 16.4: an assignee's email only in assignedToEmail (for matching to Cooptimizers), nowhere else.
    const strip = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (k, x) => (k === "assignedToEmail" ? undefined : x)));
    expect(JSON.stringify(strip(adatum))).not.toMatch(/@/);
  });
  it("reads each story's size and last change for Roadmap (step 16), from the project's size field", async () => {
    const s = setup({ planweek: "planweek" }, [target("Adatum", "planweek")]);
    const [adatum] = await s.src.portfolio([ref("Adatum")]);
    expect(adatum!.sizeField).toBe("Microsoft.VSTS.Scheduling.StoryPoints");
    const kids = adatum!.items.find((i) => i.id === 210)!.children;
    expect(kids.map((c) => [c.id, c.size, c.changedAt])).toEqual([[201, 3, "2026-10-30T15:00:00Z"], [211, null, "2026-10-30T15:00:00Z"], [212, null, "2026-10-30T15:00:00Z"]]);
  });
  it("step 17: Start Date where the process has it (per type), and which stories are blocked", async () => {
    const s = setup({ planweek: "planweek" }, [target("Adatum", "planweek")]);
    const [adatum] = await s.src.portfolio([ref("Adatum")]);
    expect(adatum!.startFields).toEqual({ Feature: "Microsoft.VSTS.Scheduling.StartDate", Epic: "Microsoft.VSTS.Scheduling.StartDate" });
    expect(adatum!.items.find((i) => i.id === 240)!.startDate).toBe("2026-11-09");
    expect(adatum!.items.find((i) => i.id === 210)!.startDate).toBeNull();
    expect(adatum!.items.find((i) => i.id === 210)!.children.map((c) => [c.id, c.blocked])).toEqual([[201, false], [211, false], [212, true]]);
  });
  it("reads only: metadata and field lists with GET, items with WIQL and the batch call; no description unless asked", async () => {
    const s = setup({ planweek: "planweek" }, [target("Adatum", "planweek")]);
    await s.src.portfolio([ref("Adatum")]);
    for (const c of s.calls) {
      if (c.method === "POST") expect(c.url).toMatch(/\/_apis\/wit\/(wiql|workitemsbatch)\?/);
      else expect(c.method).toBe("GET");
    }
    expect(s.calls.some((c) => c.body?.includes("System.Description"))).toBe(false);
    expect(s.calls.some((c) => c.url.includes("/_apis/wit/fields?"))).toBe(true);
  });
  it("caches for five minutes, and falls back to the last snapshot when DevOps fails", async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "focustime-devops-"));
    const s = setup({ planweek: "planweek" }, [target("Adatum", "planweek")], { cacheDir });
    await s.src.portfolio([ref("Adatum")]);
    const n = s.calls.length;
    await s.src.portfolio([ref("Adatum")]);
    expect(s.calls.length).toBe(n);
    const [off] = await setup({ planweek: "offline" }, [target("Adatum", "planweek")], { cacheDir }).src.portfolio([ref("Adatum")]);
    expect(off!.fromCache).toBe(true);
    expect(off!.items.map((i) => i.id)).toEqual([210, 220, 230, 240, 250]);
  });
  it("Q47: a project whose backlog levels give no story level is a clear per-client error, never a guess", async () => {
    const s = setup({ planweek: "planweek", nostory: "no_story_level" }, [target("Adatum", "planweek"), target("T&W", "nostory")]);
    const [adatum, tw] = await s.src.load([ref("Adatum"), ref("T&W")]);
    expect(adatum!.status).toBe("ok");
    expect(tw).toMatchObject({ status: "error", items: [] });
    expect(tw!.message).toMatch(/no story level/i);
    expect(tw!.message).toMatch(/T&W Project/);
    const [, pw] = await s.src.portfolio([ref("Adatum"), ref("T&W")]);
    expect(pw).toMatchObject({ status: "error", items: [] });
  });
  it("reads one feature's description on demand as plain text, never cached", async () => {
    const s = setup({ planweek: "planweek" }, [target("Adatum", "planweek")]);
    const d = await s.src.description("Adatum", 210);
    expect(d).toBe("Export the weekly report & email it.\n- CSV");
    expect(await s.src.description("Other", 210)).toBeNull();
  });
});

describe("committed features in the usual read (step 8, Plan the day)", () => {
  it("reads committed features by id with their open children, so their stories can be offered", async () => {
    const s = setup({ planweek: "planweek" }, [target("Adatum", "planweek")]);
    const [adatum] = await s.src.load([ref("Adatum")], { features: { Adatum: [210, 240] } });
    // 240 is mine already; 210 isn't, so it comes back as committed.
    expect(adatum!.committed?.map((i) => i.id)).toEqual([210]);
    // Open children of 210 (any assignee); 201 is mine and already among my items; the closed one is left out.
    expect(adatum!.children.map((c) => c.id)).toContain(212);
    expect(adatum!.children.map((c) => c.id)).not.toContain(211);
  });
  it("a cached result is reused only when it was read with the same committed features", async () => {
    const s = setup({ planweek: "planweek" }, [target("Adatum", "planweek")]);
    await s.src.load([ref("Adatum")]);
    const n = s.calls.length;
    await s.src.load([ref("Adatum")]);
    expect(s.calls.length).toBe(n);
    const [adatum] = await s.src.load([ref("Adatum")], { features: { Adatum: [210] } });
    expect(s.calls.length).toBeGreaterThan(n);
    expect(adatum!.committed?.map((i) => i.id)).toEqual([210]);
  });
});
