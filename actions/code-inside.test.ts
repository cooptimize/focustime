// RB-4: Search inside files (code.inside). It asks DevOps's own code search and reads no file; only the client's own
// organization and project are asked; who may read is checked per client; one row per client asked is written before
// DevOps is asked; the words reach no log line, error, row or answer; each of DevOps's answers has its plain words;
// one client failing or slow doesn't hold the others. Every name here is invented.
import { describe, expect, it } from "vitest";
import { codeAction, CODE_TEXT, type CodeContext, type CodeInsideAnswer } from "./code-actions.ts";
import { createCodeGit, type CodeGit } from "./code-git.ts";
import { createLimiter } from "./devops-poll.ts";
import { createGitReader } from "../sources/devops/git.ts";
import { Pat } from "../sources/devops/pat.ts";
import type { TargetsResult } from "../sources/devops/types.ts";
import type { CodeViewInput } from "../store/code-views-store.ts";
import { INSIDE_MAX, type CodeAccess } from "../plan/code.ts";

const ME = { id: "aaaaaaaa-0000-4000-8000-000000000001", name: "Ana Example" };
const CLIENTS = ["Contoso", "Fabrikam", "Adatum"];
const repoId = (c: number, r: number) => `0000000${c}-0000-4000-8000-00000000000${r}`;
const COMMIT = "c".repeat(40);
/** Words that are in no path, so anywhere they turn up they were leaked. */
const WORDS = "zzqx_planted NOT other";
const TOKEN = "not-a-real-token-value";
const PATHS = ["/ws/Depot.Warehouse/.platform", "/ws/Depot.Warehouse/dim/Tables/Pallet.sql", "/ws/Depot.Warehouse/dim/StoredProcedures/usp_FillPallet.sql", "/adf/publish_config.json", "/adf/pipeline/pl_move.json", "/docs/guide.md"];

type Search = { status?: number; body?: unknown; latencyMs?: number };
/** A fake DevOps behind the real reader, memory and limiter: Git on dev.azure.com, code search on its own address. */
function devops(search: (client: string, body: { searchText: string; $top: number }) => Search = () => ({})) {
  const ops: string[] = [];
  const bodies: string[] = [];
  const logs: unknown[] = [];
  const fetch = (async (u: string, init?: RequestInit) => {
    const url = new URL(u);
    const client = CLIENTS.find((c) => url.pathname.startsWith(`/${c.toLowerCase()}/`))!;
    const c = CLIENTS.indexOf(client) + 1;
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
    if (url.origin === "https://almsearch.dev.azure.com") {
      if (init?.method !== "POST" || url.pathname !== `/${client.toLowerCase()}/Data/_apis/search/codesearchresults`) throw new Error("not the documented search request");
      ops.push(`search ${client}`);
      bodies.push(String(init.body));
      const s = search(client, JSON.parse(String(init.body)) as { searchText: string; $top: number });
      if (s.latencyMs) await new Promise((r) => setTimeout(r, s.latencyMs));
      if (s.status && s.status !== 200) return json({ message: `no: ${String(init.body)}` }, s.status);
      return json(s.body ?? { count: 2, infoCode: 0, results: [hit(c, 1, PATHS[2]!, 3), hit(c, 1, PATHS[4]!, 1)] });
    }
    if (url.origin !== "https://dev.azure.com" || init?.method !== "GET") throw new Error("not an allowed request");
    const repo = /repositories\/([^/]+)\/items/.exec(url.pathname)?.[1] ?? null;
    const op = !repo ? "repos" : url.searchParams.get("recursionLevel") === "Full" ? "files" : "a file read";
    ops.push(`${op} ${client}`);
    if (op === "repos") return json({ value: [1, 2].map((r) => ({ id: repoId(c, r), name: `repo-${c}${r}`, defaultBranch: "refs/heads/main" })) });
    if (op === "files") return json({ value: PATHS.map((path) => ({ path, gitObjectType: "blob", commitId: COMMIT })) });
    throw new Error(`a search inside files asked for ${op}`);
  }) as typeof globalThis.fetch;
  const targets = async (keys: string[]): Promise<TargetsResult> => ({ ok: true, targets: keys.map((k) => ({ accountId: k, clientKey: k, clientName: k, org: k.toLowerCase(), project: "Data", projectName: "Data", email: null, pat: new Pat(TOKEN) })) });
  const git = createCodeGit({ reader: createGitReader({ fetch, log: (l) => void logs.push(l), limiter: createLimiter(() => Temporal.Now.instant()) }), targets });
  return { git, ops, bodies, logs };
}
const hit = (c: number, r: number, path: string, matches: number, o: Record<string, unknown> = {}) => ({ fileName: path.slice(path.lastIndexOf("/") + 1), path, repository: { id: repoId(c, r), name: `repo-${c}${r}`, type: "git" }, versions: [{ branchName: "main" }], matches: { content: Array.from({ length: matches }, (_, n) => ({ charOffset: n, length: 4 })) }, ...o });

function ctx(git: CodeGit | null, o: { why?: "guest" | "domain" | "automation"; rules?: Record<string, CodeAccess>; onTeam?: string[]; views?: "fail"; order?: string[] } = {}) {
  const views: CodeViewInput[] = [];
  const c: CodeContext = {
    me: async () => ME,
    notCooptimizer: async () => o.why ?? null,
    clients: async () => CLIENTS.map((k) => ({ clientKey: k, name: k, color: null })),
    rule: async (k) => o.rules?.[k] ?? "company",
    opening: async () => null,
    team: async () => ({ myClients: o.onTeam ?? [], onClient: (k) => (o.onTeam ?? []).includes(k) }),
    git,
    views: { add: async (v) => (o.views === "fail" ? Promise.reject(new Error("db down")) : (o.order?.push("row"), void views.push(v))) },
  };
  return { c, views };
}
type Ok = { ok: true; data: CodeInsideAnswer };
type No = { ok: false; status: number; error: string; code?: string };
const inside = (c: CodeContext, clientKey: string, extra: Record<string, unknown> = {}) => codeAction(c, "code.inside", { clientKey, words: WORDS, ...extra });

describe("what it asks and what comes back", () => {
  it("asks DevOps's code search once, reads no file, and returns files with their kind by name and their match count", async () => {
    const d = devops();
    const r = (await inside(ctx(d.git).c, "Contoso")) as Ok;
    expect(r.ok).toBe(true);
    // The repo list (whose repos are this client's), the search, and one repo's file names to say what each file is.
    expect([...d.ops].sort()).toEqual(["files Contoso", "repos Contoso", "search Contoso"]);
    expect(JSON.parse(d.bodies[0]!)).toEqual({ searchText: WORDS, $skip: 0, $top: INSIDE_MAX, includeFacets: false, includeSnippet: false });
    expect(r.data.files).toEqual([
      { repoId: repoId(1, 1), repoName: "repo-11", path: PATHS[2], kind: "database", detail: "Stored procedure in dim · Depot warehouse", matches: 3, itemKind: "database" },
      { repoId: repoId(1, 1), repoName: "repo-11", path: PATHS[4], kind: "pipeline", detail: "Data factory pipeline", matches: 1 },
    ]);
    expect(r.data).toMatchObject({ total: 2, more: false, indexing: false, narrowed: false });
  });
  it("returns no text of any file: the answer holds paths, names, kinds and counts only", async () => {
    const d = devops(() => ({ body: { count: 1, infoCode: 0, results: [{ ...hit(1, 1, PATHS[2]!, 1), content: "SELECT secret_column FROM x", snippet: "secret_column", hits: [{ line: "secret_column" }] }] } }));
    const r = await inside(ctx(d.git).c, "Contoso");
    expect(JSON.stringify(r)).not.toContain("secret_column");
    expect(Object.keys((r as Ok).data.files[0]!).sort()).toEqual(["detail", "itemKind", "kind", "matches", "path", "repoId", "repoName"]);
  });
  it("drops a file from a repo that isn't this client's, and one found only on another branch", async () => {
    const d = devops(() => ({ body: { count: 3, infoCode: 0, results: [hit(1, 1, PATHS[2]!, 1), hit(2, 1, PATHS[2]!, 1), hit(1, 2, PATHS[1]!, 1, { versions: [{ branchName: "feature/x" }] })] } }));
    const r = (await inside(ctx(d.git).c, "Contoso")) as Ok;
    expect(r.data.files.map((f) => [f.repoId, f.path])).toEqual([[repoId(1, 1), PATHS[2]]]);
    // They are counted, never named, so the screen can say some files aren't listed.
    expect(r.data.notListed).toBe(2);
  });
  it("review 2: a file DevOps names no branch for isn't listed (the default branch must be said), and is counted", async () => {
    const d = devops(() => ({ body: { count: 2, infoCode: 0, results: [hit(1, 1, PATHS[2]!, 1), hit(1, 1, PATHS[1]!, 1, { versions: [] })] } }));
    const r = (await inside(ctx(d.git).c, "Contoso")) as Ok;
    expect(r.data.files.map((f) => f.path)).toEqual([PATHS[2]]);
    expect(r.data.notListed).toBe(1);
  });
  it("review 2: when the narrowing request fails or isn't taken, the first answer stands", async () => {
    for (const second of [{ status: 429 }, { status: 400 }, { body: { count: 0, infoCode: 3, results: [] } }] as Search[]) {
      const d = devops((_c, b) => (b.searchText.endsWith(" ext:sql") ? second : { body: { count: 340, infoCode: 0, results: [hit(1, 1, PATHS[4]!, 1)] } }));
      const r = (await inside(ctx(d.git).c, "Contoso", { kind: "script" })) as Ok;
      expect(r.ok).toBe(true);
      expect(r.data).toMatchObject({ narrowed: false, more: true, files: [{ path: PATHS[4] }] });
    }
  });
  it("says there are more when DevOps counted more than it returned, or trimmed the number asked for", async () => {
    const more = devops(() => ({ body: { count: 340, infoCode: 0, results: [hit(1, 1, PATHS[2]!, 1)] } }));
    expect(((await inside(ctx(more.git).c, "Contoso")) as Ok).data).toMatchObject({ more: true, total: 340 });
    const trimmed = devops(() => ({ body: { count: 1, infoCode: 8, results: [hit(1, 1, PATHS[2]!, 1)] } }));
    expect(((await inside(ctx(trimmed.git).c, "Contoso")) as Ok).data.more).toBe(true);
  });
  it("with the SQL scripts kind (RB-6) and more files than fit, asks DevOps to narrow by file type, in its documented form", async () => {
    const d = devops((_c, b) => (b.searchText.endsWith(" ext:sql") ? { body: { count: 1, infoCode: 0, results: [hit(1, 1, PATHS[1]!, 2)] } } : { body: { count: 340, infoCode: 0, results: [hit(1, 1, PATHS[4]!, 1)] } }));
    const r = (await inside(ctx(d.git).c, "Contoso", { kind: "script" })) as Ok;
    expect(d.bodies.map((b) => (JSON.parse(b) as { searchText: string }).searchText)).toEqual([WORDS, `(${WORDS}) ext:sql`]);
    expect(r.data).toMatchObject({ narrowed: true, more: false });
    expect(r.data.files.map((f) => f.path)).toEqual([PATHS[1]]);
    // Not when everything fit, not for a kind a file type can't say, and not when the words can't sit in brackets.
    const fits = devops();
    await inside(ctx(fits.git).c, "Contoso", { kind: "script" });
    expect(fits.bodies).toHaveLength(1);
    const other = devops(() => ({ body: { count: 340, infoCode: 0, results: [hit(1, 1, PATHS[4]!, 1)] } }));
    await inside(ctx(other.git).c, "Contoso", { kind: "report" });
    expect(other.bodies).toHaveLength(1);
    const open = devops(() => ({ body: { count: 340, infoCode: 0, results: [hit(1, 1, PATHS[4]!, 1)] } }));
    await codeAction(ctx(open.git).c, "code.inside", { clientKey: "Contoso", words: 'a ("b', kind: "script" });
    expect(open.bodies).toHaveLength(1);
  });
  it("a repo whose file names can't be read still lists its files, sorted by their own paths", async () => {
    const d = devops();
    const git: CodeGit = { ...d.git, files: async () => Promise.reject(new Error("no names")) };
    const r = (await inside(ctx(git).c, "Contoso")) as Ok;
    expect(r.data.files.map((f) => [f.kind, f.detail])).toEqual([["script", "Stored procedure"], ["other", "JSON"]]);
  });
});

describe("the browser can name a client and nothing else", () => {
  it.each(["org", "organization", "project", "branch", "repoId", "path", "top", "filters", "includeSnippet"])("refuses the field %s before anything is read", async (field) => {
    const d = devops();
    const r = (await inside(ctx(d.git).c, "Contoso", { [field]: "x" })) as No;
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect(d.ops).toEqual([]);
  });
  it("refuses words that are empty, too long or hold a control character, and a kind that isn't one", async () => {
    const d = devops();
    for (const words of ["", "   ", "x".repeat(201), "a\nb", 7, null]) expect(await codeAction(ctx(d.git).c, "code.inside", { clientKey: "Contoso", words })).toMatchObject({ ok: false, status: 400, code: "bad_words" });
    expect(await inside(ctx(d.git).c, "Contoso", { kind: "everything" })).toMatchObject({ ok: false, code: "bad_kind" });
    expect(d.ops.filter((o) => o.startsWith("search"))).toEqual([]);
  });
});

describe("access", () => {
  it.each(["guest", "domain", "automation"] as const)("a %s account gets nothing and nothing is asked", async (why) => {
    const d = devops();
    const c = ctx(d.git, { why });
    expect(await inside(c.c, "Contoso")).toMatchObject({ ok: false, status: 403, code: why });
    expect(d.ops).toEqual([]);
    expect(c.views).toEqual([]);
  });
  it("a person off the team of an Its team only client gets nothing from it; its team does", async () => {
    const d = devops();
    const off = ctx(d.git, { rules: { Fabrikam: "team" } });
    expect(await inside(off.c, "Fabrikam")).toMatchObject({ ok: false, status: 403, code: "team_only", error: CODE_TEXT.teamOnly("Fabrikam") });
    expect(d.ops).toEqual([]);
    expect(off.views).toEqual([]);
    const on = ctx(d.git, { rules: { Fabrikam: "team" }, onTeam: ["Fabrikam"] });
    expect((await inside(on.c, "Fabrikam")).ok).toBe(true);
  });
  it("a client that isn't listed is refused, and where code can't be read at all nothing is asked", async () => {
    const d = devops();
    expect(await inside(ctx(d.git).c, "Nobody")).toMatchObject({ ok: false, status: 404, code: "no_client" });
    expect(await inside(ctx(null).c, "Contoso")).toMatchObject({ ok: false, code: "not_here" });
    expect(d.ops).toEqual([]);
  });
});

describe("the view log", () => {
  it("one row per client asked, written before DevOps is asked, with no repo id, no path and none of the words (RB-7: the branches where the repo goes)", async () => {
    const order: string[] = [];
    const d = devops(() => (order.push("search"), {}));
    const c = ctx(d.git, { order });
    await inside(c.c, "Contoso");
    await inside(c.c, "Adatum");
    expect(order).toEqual(["row", "search", "row", "search"]);
    // The row is before the repo list too: the first thing asked of DevOps comes after it.
    const first: string[] = [];
    const d2 = devops();
    const git2: CodeGit = { ...d2.git, repos: async (k) => (first.push("repos"), d2.git.repos(k)) };
    await inside(ctx(git2, { order: first }).c, "Contoso");
    expect(first.slice(0, 2)).toEqual(["row", "repos"]);
    expect(c.views).toEqual([
      { actorId: ME.id, actorName: ME.name, clientKey: "Contoso", repoId: "", repoName: "All its repos on their default branches", path: "", event: "inside_searched" },
      { actorId: ME.id, actorName: ME.name, clientKey: "Adatum", repoId: "", repoName: "All its repos on their default branches", path: "", event: "inside_searched" },
    ]);
  });
  it("no row, no search: when the row can't be written DevOps isn't asked", async () => {
    const d = devops();
    expect(await inside(ctx(d.git, { views: "fail" }).c, "Contoso")).toMatchObject({ ok: false, status: 503, code: "not_logged", error: CODE_TEXT.insideNotLogged });
    // Review 2: nothing at all is asked of that client's DevOps, not even its repo list.
    expect(d.ops).toEqual([]);
  });
});

describe("the words", () => {
  const leaked = (...things: unknown[]) => things.map((t) => JSON.stringify(t)).filter((t) => t.includes("zzqx") || t.includes(TOKEN));
  it("are in no log line, no row and no answer after a search that worked", async () => {
    const d = devops();
    const c = ctx(d.git);
    const r = await inside(c.c, "Contoso");
    expect(leaked(d.logs, c.views, r)).toEqual([]);
    // They went to DevOps, in the body, and nowhere else.
    expect(d.bodies.join("")).toContain("zzqx_planted");
  });
  it.each([400, 401, 404, 429, 500])("are in no log line, row or error after DevOps answered %i, even when its answer repeats them", async (status) => {
    const d = devops(() => ({ status }));
    const c = ctx(d.git);
    const r = (await inside(c.c, "Contoso")) as No;
    expect(r.ok).toBe(false);
    expect(leaked(d.logs, c.views, r)).toEqual([]);
  });
  it("are not in an error when something inside FocusTime throws with them in its message", async () => {
    const git: CodeGit = { ...devops().git, search: async (_k, text) => Promise.reject(new Error(`boom: ${text}`)) };
    const r = await inside(ctx(git).c, "Contoso");
    expect(r).toMatchObject({ ok: false, code: "error" });
    expect(leaked(r)).toEqual([]);
  });
  it("nothing of a search is held: the same search again asks DevOps again", async () => {
    const d = devops();
    const c = ctx(d.git).c;
    await inside(c, "Contoso");
    await inside(c, "Contoso");
    expect(d.ops.filter((o) => o === "search Contoso")).toHaveLength(2);
  });
});

describe("what each client can say instead of results", () => {
  it.each([
    [{ status: 404 }, "no_code_search", CODE_TEXT.noCodeSearch("Contoso")],
    [{ status: 401 }, "needs_code_read", CODE_TEXT.needsCodeRead("Contoso")],
    [{ status: 403 }, "needs_code_read", CODE_TEXT.needsCodeRead("Contoso")],
    [{ status: 400 }, "bad_query", CODE_TEXT.badQuery],
    [{ status: 503 }, "busy", CODE_TEXT.busy],
    [{ status: 500 }, "error", CODE_TEXT.error("Contoso")],
    [{ body: { count: 0, infoCode: 2, results: [] } }, "indexing", CODE_TEXT.indexing("Contoso")],
    [{ body: { count: 0, infoCode: 6, results: [] } }, "indexing", CODE_TEXT.indexing("Contoso")],
    [{ body: { count: 0, infoCode: 3, results: [] } }, "bad_query", CODE_TEXT.badQuery],
    [{ body: { count: 0, infoCode: 4, results: [] } }, "bad_query", CODE_TEXT.badQuery],
  ] as [Search, string, string][])("%j is %s in plain words", async (answer, code, error) => {
    const r = await inside(ctx(devops(() => answer).git).c, "Contoso");
    expect(r).toMatchObject({ ok: false, code, error });
  });
  it("while DevOps is indexing, what it found still shows, marked as possibly incomplete", async () => {
    const d = devops(() => ({ body: { count: 1, infoCode: 7, results: [hit(1, 1, PATHS[2]!, 1)] } }));
    expect(((await inside(ctx(d.git).c, "Contoso")) as Ok).data).toMatchObject({ indexing: true, files: [{ path: PATHS[2] }] });
  });
  it("DevOps can't be reached: unreachable", async () => {
    const d = devops(() => {
      throw new Error("offline");
    });
    expect(await inside(ctx(d.git).c, "Contoso")).toMatchObject({ ok: false, code: "unreachable", error: CODE_TEXT.unreachable("Contoso") });
  });
  it("one client failing or slow doesn't hold the others", async () => {
    const done: string[] = [];
    const d = devops((client) => (client === "Contoso" ? { latencyMs: 150 } : client === "Fabrikam" ? { status: 404 } : {}));
    const c = ctx(d.git).c;
    const all = await Promise.all(CLIENTS.map((k) => inside(c, k).then((r) => (done.push(k), r))));
    expect(done).toEqual(["Fabrikam", "Adatum", "Contoso"].sort((a, b) => (a === "Contoso" ? 1 : b === "Contoso" ? -1 : 0)));
    expect(all.map((r) => r.ok)).toEqual([true, false, true]);
  });
});
