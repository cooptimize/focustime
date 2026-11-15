// RB-2: By kind (code.kinds) and Search names (code.search). Names only: the two reads make only the "repos" and
// "file names" requests; who may read is checked per client; one row per client is written before any name is
// returned; the words typed never reach the server; nothing of the names is kept; one failing repo or client doesn't
// stop the others. And STEP 0.5's numbers: what a search across 5 clients with 4 repos each costs.
import { describe, expect, it } from "vitest";
import { codeAction, CODE_TEXT, type CodeAction, type CodeContext, type CodeRepoThings } from "./code-actions.ts";
import { CodeFailure, createCodeGit, type CodeGit } from "./code-git.ts";
import { createLimiter } from "./devops-poll.ts";
import { createGitReader } from "../sources/devops/git.ts";
import { Pat } from "../sources/devops/pat.ts";
import type { TargetsResult } from "../sources/devops/types.ts";
import type { CodeViewInput } from "../store/code-views-store.ts";
import { CODE_MEMORY_MS, FIND_MAX, SEARCH_CLIENTS_AT_ONCE, type CodeAccess } from "../plan/code.ts";

const ME = { id: "aaaaaaaa-0000-4000-8000-000000000001", name: "Ana Example" };
const CLIENTS = ["Contoso", "Fabrikam", "Adatum", "Litware", "Proseware"];
const repoId = (c: number, r: number) => `0000000${c}-0000-4000-8000-00000000000${r}`;
const COMMIT = "c".repeat(40);
/** Invented names: a report, a model with a table, a factory pipeline and a SQL table per repo. */
const pathsOf = (c: number, r: number) => [`/ws/Orders ${c}${r}.Report/.platform`, `/ws/Orders ${c}${r}.SemanticModel/.platform`, `/ws/Orders ${c}${r}.SemanticModel/definition/tables/Calendar.tmdl`, `/adf/pipeline/pl_load_${c}${r}.json`, `/adf/dataset/ds_${c}${r}.json`, `/db/dbo/Tables/Stock${c}${r}.sql`];

/** A fake DevOps behind the real reader, memory and limiter. Every request is recorded by what it asks for. */
function devops(o: { latencyMs?: number; fail?: (client: string, repo: string | null) => number | null } = {}) {
  const ops: string[] = [];
  const logs: unknown[] = [];
  let targetReads = 0;
  let t = 0;
  const fetch = (async (u: string) => {
    const url = new URL(u);
    const client = CLIENTS.find((c) => url.pathname.startsWith(`/${c.toLowerCase()}/`))!;
    const repo = /repositories\/([^/]+)\/items/.exec(url.pathname)?.[1] ?? null;
    const level = url.searchParams.get("recursionLevel");
    const op = !repo ? "repos" : level === "Full" ? "files" : level === "OneLevel" ? "folder" : url.searchParams.has("includeContentMetadata") ? "file_meta" : "file_bytes";
    ops.push(`${op} ${client}`);
    if (o.latencyMs) await new Promise((r) => setTimeout(r, o.latencyMs));
    const status = o.fail?.(client, repo) ?? null;
    if (status) return new Response("no", { status });
    const c = CLIENTS.indexOf(client) + 1;
    const json = (v: unknown) => new Response(JSON.stringify(v), { headers: { "content-type": "application/json" } });
    if (op === "repos") return json({ value: [1, 2, 3, 4].map((r) => ({ id: repoId(c, r), name: `repo-${c}${r}`, defaultBranch: "refs/heads/main" })) });
    if (op === "files") return json({ value: pathsOf(c, Number(repo!.slice(-1))).map((path) => ({ path, gitObjectType: "blob", commitId: COMMIT })) });
    throw new Error(`a names read asked for ${op}`);
  }) as typeof globalThis.fetch;
  const targets = async (keys: string[]): Promise<TargetsResult> => (targetReads++, { ok: true, targets: keys.map((k) => ({ accountId: k, clientKey: k, clientName: k, org: k.toLowerCase(), project: "Data", projectName: "Data", email: null, pat: new Pat("not-a-real-token") })) });
  const git = createCodeGit({ reader: createGitReader({ fetch, log: (l) => void logs.push(l), limiter: createLimiter(() => Temporal.Now.instant()) }), targets, now: () => t });
  return { git, ops, logs, targetReads: () => targetReads, advance: (ms: number) => (t += ms) };
}

function ctx(git: CodeGit | null, o: { why?: "guest" | "domain" | "automation"; rules?: Record<string, CodeAccess>; onTeam?: string[]; views?: "fail"; order?: string[] } = {}) {
  const views: CodeViewInput[] = [];
  const c: CodeContext = {
    me: async () => ME,
    notCooptimizer: async () => o.why ?? null,
    clients: async () => CLIENTS.map((k) => ({ clientKey: k, name: k, color: null })),
    rule: async (k) => o.rules?.[k] ?? "company",
    team: async () => ({ myClients: o.onTeam ?? [], onClient: (k) => (o.onTeam ?? []).includes(k) }),
    git,
    views: { add: async (v) => (o.views === "fail" ? Promise.reject(new Error("db down")) : (o.order?.push("row"), void views.push(v))) },
  };
  return { c, views };
}
type Names = { ok: true; data: { repos: CodeRepoThings[]; max: number } };
const NAMES: CodeAction[] = ["code.kinds", "code.search"];

/** The panel's search across clients: SEARCH_CLIENTS_AT_ONCE at a time, each client its own request. */
async function searchAll(c: CodeContext, keys: string[], onEach?: (k: string) => void) {
  const out = new Map<string, Awaited<ReturnType<typeof codeAction>>>();
  let next = 0;
  await Promise.all(
    Array.from({ length: SEARCH_CLIENTS_AT_ONCE }, async () => {
      for (let n = next++; n < keys.length; n = next++) {
        out.set(keys[n]!, await codeAction(c, "code.search", { clientKey: keys[n] }));
        onEach?.(keys[n]!);
      }
    }),
  );
  return out;
}

describe("names only", () => {
  it.each(NAMES)("%s makes only the repos and file names requests, and returns things sorted by name alone", async (action) => {
    const d = devops();
    const r = (await codeAction(ctx(d.git).c, action, { clientKey: "Contoso" })) as Names;
    expect(r.ok).toBe(true);
    expect([...d.ops].sort()).toEqual(["files Contoso", "files Contoso", "files Contoso", "files Contoso", "repos Contoso"]);
    expect(r.data.max).toBe(FIND_MAX);
    expect(r.data.repos.map((x) => x.repo.name)).toEqual(["repo-11", "repo-12", "repo-13", "repo-14"]);
    expect(r.data.repos[0]!.things.map((t) => [t.kind, t.name])).toEqual([["report", "Orders 11"], ["model", "Orders 11"], ["pipeline", "pl_load_11"], ["script", "Stock11"], ["other", "ds_11"]]);
    expect(r.data.repos[0]!.things[1]!.tables).toEqual([{ name: "Calendar", file: "/ws/Orders 11.SemanticModel/definition/tables/Calendar.tmdl" }]);
  });
  it("a read of a folder's level or a file's bytes during either would fail: the fake DevOps throws on them", async () => {
    const d = devops();
    for (const action of NAMES) for (const k of CLIENTS) expect((await codeAction(ctx(d.git).c, action, { clientKey: k })).ok).toBe(true);
    expect(d.ops.every((o) => o.startsWith("repos ") || o.startsWith("files "))).toBe(true);
  });
  it("takes a client key and nothing else: no words, no repo, no scope", async () => {
    const d = devops();
    for (const extra of [{ q: "orders" }, { words: "orders" }, { repoId: repoId(1, 1) }, { scope: "all" }, { clients: CLIENTS }, { path: "/" }])
      for (const action of NAMES) expect(await codeAction(ctx(d.git).c, action, { clientKey: "Contoso", ...extra })).toMatchObject({ ok: false, status: 400 });
    expect(d.ops).toEqual([]);
  });
});

describe("who may read names", () => {
  it.each(["guest", "domain", "automation"] as const)("a %s gets nothing", async (why) => {
    const d = devops();
    const { c, views } = ctx(d.git, { why });
    for (const action of NAMES) expect(await codeAction(c, action, { clientKey: "Contoso" })).toMatchObject({ ok: false, status: 403, code: why });
    expect(d.ops).toEqual([]);
    expect(views).toEqual([]);
  });
  it("a person off the team of an Its team only client gets no names from it; its team does", async () => {
    const d = devops();
    const off = ctx(d.git, { rules: { Fabrikam: "team" }, onTeam: ["Contoso"] });
    for (const action of NAMES) expect(await codeAction(off.c, action, { clientKey: "Fabrikam" })).toMatchObject({ ok: false, status: 403, code: "team_only" });
    expect(d.ops).toEqual([]);
    expect(off.views).toEqual([]);
    // The client list is how the panel knows to leave it out and say why.
    expect(await codeAction(off.c, "code.clients", {})).toMatchObject({ ok: true, data: { clients: expect.arrayContaining([expect.objectContaining({ clientKey: "Fabrikam", locked: true })]) } });
    const on = ctx(d.git, { rules: { Fabrikam: "team" }, onTeam: ["Fabrikam"] });
    expect((await codeAction(on.c, "code.search", { clientKey: "Fabrikam" })).ok).toBe(true);
  });
  it("a client that isn't listed can't be asked for", async () => {
    const d = devops();
    for (const action of NAMES) expect(await codeAction(ctx(d.git).c, action, { clientKey: "Hidden Co" })).toMatchObject({ ok: false, code: "no_client" });
    expect(d.ops).toEqual([]);
  });
});

describe("the view log", () => {
  it("one row per client read, with no repo, no path and no words, written before the names are returned", async () => {
    const d = devops();
    const order: string[] = [];
    const { c, views } = ctx(d.git, { order });
    const r = await codeAction(c, "code.kinds", { clientKey: "Contoso" });
    order.push("returned");
    await codeAction(c, "code.search", { clientKey: "Adatum" });
    expect(r.ok).toBe(true);
    expect(order.slice(0, 2)).toEqual(["row", "returned"]);
    expect(views).toEqual([
      { actorId: ME.id, actorName: ME.name, clientKey: "Contoso", repoId: "", repoName: "", path: "", event: "kinds_listed" },
      { actorId: ME.id, actorName: ME.name, clientKey: "Adatum", repoId: "", repoName: "", path: "", event: "names_searched" },
    ]);
    expect(JSON.stringify(views)).not.toMatch(/Orders|pl_load|Stock|tmdl/);
  });
  it.each(NAMES)("%s: no row means no names", async (action) => {
    const d = devops();
    const r = await codeAction(ctx(d.git, { views: "fail" }).c, action, { clientKey: "Contoso" });
    expect(r).toMatchObject({ ok: false, code: "not_logged", error: CODE_TEXT.namesNotLogged });
    expect(JSON.stringify(r)).not.toMatch(/Orders|pl_load|Stock/);
  });
  it("a client whose names couldn't be read gets no row", async () => {
    const d = devops({ fail: (c) => (c === "Litware" ? 401 : null) });
    const { c, views } = ctx(d.git);
    expect(await codeAction(c, "code.search", { clientKey: "Litware" })).toMatchObject({ ok: false, code: "needs_code_read" });
    expect(views).toEqual([]);
  });
});

describe("nothing kept", () => {
  it("no name or path reaches the log lines or an error, and the memory copy is gone after 5 minutes", async () => {
    const d = devops({ fail: (_c, repo) => (repo === repoId(1, 3) ? 404 : null) });
    const { c, views } = ctx(d.git);
    const first = (await codeAction(c, "code.kinds", { clientKey: "Contoso" })) as Names;
    expect(first.data.repos[2]).toMatchObject({ things: [], problem: CODE_TEXT.notFound });
    const text = JSON.stringify([d.logs, views, first.data.repos.map((r) => r.problem)]);
    expect(text).not.toMatch(/Orders|pl_load|Stock|\.tmdl|\.sql|repo-1/);
    // Inside 5 minutes the names come from memory (one more repo's read: the one that failed is asked again).
    const before = d.ops.length;
    d.advance(CODE_MEMORY_MS - 1);
    await codeAction(c, "code.search", { clientKey: "Contoso" });
    expect(d.ops.length - before).toBe(1);
    // After 5 minutes nothing is left: every read is made again.
    d.advance(1);
    const again = d.ops.length;
    await codeAction(c, "code.search", { clientKey: "Contoso" });
    expect(d.ops.length - again).toBe(5);
  });
});

describe("one failing doesn't stop the others", () => {
  it("a repo that can't be read says so in one line and the rest still list", async () => {
    const d = devops({ fail: (_c, repo) => (repo === repoId(1, 2) ? 503 : null) });
    const r = (await codeAction(ctx(d.git).c, "code.kinds", { clientKey: "Contoso" })) as Names;
    expect(r.data.repos.map((x) => [x.repo.name, x.things.length, x.problem])).toEqual([["repo-11", 5, null], ["repo-12", 0, CODE_TEXT.busy], ["repo-13", 5, null], ["repo-14", 5, null]]);
  });
  it("a client that fails says why and the other clients' results arrive; a slow client doesn't hold the ones already in", async () => {
    const d = devops({ latencyMs: 5, fail: (c) => (c === "Fabrikam" ? 401 : null) });
    const slow: CodeGit = { ...d.git, repos: async (k) => (k === "Contoso" && (await new Promise((r) => setTimeout(r, 150))), d.git.repos(k)) };
    const arrived: string[] = [];
    const out = await searchAll(ctx(slow).c, CLIENTS, (k) => arrived.push(k));
    expect(out.get("Fabrikam")).toMatchObject({ ok: false, code: "needs_code_read", error: CODE_TEXT.needsCodeRead("Fabrikam") });
    for (const k of CLIENTS.filter((k) => k !== "Fabrikam")) expect(out.get(k)!.ok).toBe(true);
    expect(arrived.at(-1)).toBe("Contoso");
  });
  it("a repo list that throws something unexpected is a plain error, never a name", async () => {
    const d = devops();
    const git: CodeGit = { ...d.git, files: async () => Promise.reject(new CodeFailure("unreachable")) };
    const r = (await codeAction(ctx(git).c, "code.kinds", { clientKey: "Contoso" })) as Names;
    expect(r.data.repos.every((x) => x.problem === CODE_TEXT.unreachable("Contoso"))).toBe(true);
  });
});

describe("what a search across clients costs (STEP 0.5)", () => {
  it("5 clients with 4 repos each: 25 requests to DevOps (5 repo lists, 20 file name lists), none through a wait", async () => {
    const d = devops({ latencyMs: 150 });
    const started = performance.now();
    const out = await searchAll(ctx(d.git).c, CLIENTS);
    const ms = performance.now() - started;
    expect([...out.values()].every((r) => r.ok)).toBe(true);
    expect(d.ops.filter((o) => o.startsWith("repos "))).toHaveLength(5);
    expect(d.ops.filter((o) => o.startsWith("files "))).toHaveLength(20);
    expect(d.ops).toHaveLength(25);
    // The company token is read from Dataverse for each of them.
    expect(d.targetReads()).toBe(25);
    // The shared limiter adds no wait of its own (it only holds a client DevOps told to wait): with 150 ms an answer,
    // three clients at a time and four repos at a time, the search takes two rounds of (repo list + file names).
    expect(ms).toBeGreaterThanOrEqual(600 - 20);
    expect(ms).toBeLessThan(2000);
    console.log(`RB-2 STEP 0.5: 25 DevOps requests, 25 Dataverse token reads, ${Math.round(ms)} ms at 150 ms an answer`);
    // A second search inside 5 minutes asks DevOps for nothing.
    const before = d.ops.length;
    await searchAll(ctx(d.git).c, CLIENTS);
    expect(d.ops.length).toBe(before);
  });
});
