// RB-7: Code on a branch. Every read takes the branch on screen (a chosen one while the repo has it, else the client's
// opening branch where the repo has it, else the repo's default); who may read is checked the same for every read, the
// branch list too; By kind, Search names and Search inside files follow the branch for the repo on screen only; Where
// is it? and every other repo use the opening branch and take no branch from a person. On the demo's invented repos
// (Northwind's sales-analytics: main, dev, feature/returns-model and more; code search looks in main and dev).
import { describe, expect, it } from "vitest";
import { codeAction, codeOpenings, type CodeAction, type CodeContext, type CodeInsideAnswer, type CodeOpenings } from "./code-actions.ts";
import { CodeFailure, type CodeGit } from "./code-git.ts";
import { demoCodeGit } from "../sources/demo/code.ts";
import type { CodeViewInput } from "../store/code-views-store.ts";
import type { CodeAccess } from "../plan/code.ts";
import type { BranchPick } from "../plan/code-branch.ts";
import type { RepoThings } from "../plan/code-kinds.ts";

const ME = { id: "aaaaaaaa-0000-4000-8000-000000000001", name: "Ana Example" };
const SALES = "a1b2c3d4-0001-4000-8000-00000000a001";
const PORTAL = "a1b2c3d4-0002-4000-8000-00000000a002";
const ONLY_DEV = "/lake/Gold.Warehouse/rpt/Views/vReturnsByStore.sql";
const ONLY_FEATURE = "/lake/Gold.Warehouse/rpt/Views/vReturnRate.sql";

/** The demo's reader, with every read written down (the op, and the branch it was on). */
function demo(over: Partial<CodeGit> = {}) {
  const d = demoCodeGit();
  const ops: string[] = [];
  const git: CodeGit = {
    repos: (k) => (ops.push(`repos ${k}`), d.repos(k)),
    branches: (k, r, o) => (ops.push(`branches ${r.name}${o?.fresh ? " fresh" : ""}`), d.branches(k, r, o)),
    folder: (k, r, p, b) => (ops.push(`folder ${r.name}@${b} ${p}`), d.folder(k, r, p, b)),
    files: (k, r, b) => (ops.push(`files ${r.name}@${b}`), d.files(k, r, b)),
    file: (k, r, p, b) => (ops.push(`file ${r.name}@${b} ${p}`), d.file(k, r, p, b)),
    search: (k, t, top) => (ops.push(`search ${k}`), d.search(k, t, top)),
    ...over,
  };
  return { git, ops };
}

function ctx(git: CodeGit, o: { opening?: string | null; why?: "guest" | "domain" | "automation"; rules?: Record<string, CodeAccess>; onTeam?: string[]; me?: typeof ME | null } = {}) {
  const views: CodeViewInput[] = [];
  const c: CodeContext = {
    me: async () => (o.me === undefined ? ME : o.me),
    notCooptimizer: async () => o.why ?? null,
    clients: async () => [{ clientKey: "Northwind", name: "Northwind", color: null }],
    rule: async (k) => o.rules?.[k] ?? "company",
    opening: async () => o.opening ?? null,
    team: async () => ({ myClients: o.onTeam ?? [], onClient: (k) => (o.onTeam ?? []).includes(k) }),
    git,
    views: { add: async (v) => void views.push(v) },
  };
  return { c, views };
}
const run = (c: CodeContext, a: CodeAction, input: Record<string, unknown>) => codeAction(c, a, { clientKey: "Northwind", ...input }) as Promise<{ ok: true; data: never } | { ok: false; status: number; code?: string }>;
const ok = async <T,>(p: ReturnType<typeof run>): Promise<T> => {
  const r = await p;
  if (!r.ok) throw new Error(`refused: ${JSON.stringify(r)}`);
  return r.data as T;
};
type FileAnswer = { file: { text: string; devopsUrl: string }; branch: BranchPick };

describe("which branch a read is on", () => {
  it("no opening branch and no choice: the default, and the branch list isn't read", async () => {
    const d = demo();
    const r = await ok<FileAnswer>(run(ctx(d.git).c, "code.file", { repoId: SALES, path: "/README.md" }));
    expect(r.branch).toEqual({ name: "main", why: "default", opening: "main", default: "main", gone: null });
    expect(d.ops.filter((o) => o.startsWith("branches"))).toEqual([]);
    expect(d.ops).toContain("file sales-analytics@main /README.md");
  });
  it("the client's opening branch where the repo has it, the default where it doesn't", async () => {
    const d = demo();
    const { c } = ctx(d.git, { opening: "dev" });
    expect((await ok<FileAnswer>(run(c, "code.file", { repoId: SALES, path: ONLY_DEV }))).branch).toMatchObject({ name: "dev", why: "opening", opening: "dev" });
    expect((await ok<FileAnswer>(run(c, "code.file", { repoId: PORTAL, path: "/README.md" }))).branch).toMatchObject({ name: "main", why: "default", opening: "main" });
  });
  it("a chosen branch wins while the repo has it; Copy DevOps link names it", async () => {
    const d = demo();
    const r = await ok<FileAnswer>(run(ctx(d.git, { opening: "dev" }).c, "code.file", { repoId: SALES, path: ONLY_FEATURE, branch: "feature/returns-model" }));
    expect(r.branch).toMatchObject({ name: "feature/returns-model", why: "chosen", opening: "dev", default: "main" });
    const u = new URL(r.file.devopsUrl);
    expect(u.searchParams.get("version")).toBe("GBfeature/returns-model");
    expect(u.searchParams.get("path")).toBe(ONLY_FEATURE);
  });
  it("a branch that is gone falls back to the opening branch and says which was asked for", async () => {
    const r = await ok<FileAnswer>(run(ctx(demo().git, { opening: "dev" }).c, "code.file", { repoId: SALES, path: "/README.md", branch: "feature/gone" }));
    expect(r.branch).toMatchObject({ name: "dev", why: "opening", gone: "feature/gone" });
  });
  it("a branch deleted mid-read: the list is read again, and the read is made on the opening branch", async () => {
    let listed = ["dev", "feature/returns-model", "main"];
    const d = demo();
    const g = demo({
      branches: async (_k, _r, o) => (d.ops.push(`branches${o?.fresh ? " fresh" : ""}`), { names: listed, cut: false }),
      file: async (k, r, p, b) => {
        if (b === "feature/returns-model") {
          listed = ["dev", "main"];
          throw new CodeFailure("not_found");
        }
        return demoCodeGit().file(k, r, p, b);
      },
    });
    const r = await ok<FileAnswer>(run(ctx(g.git).c, "code.file", { repoId: SALES, path: "/README.md", branch: "feature/returns-model" }));
    expect(r.branch).toMatchObject({ name: "main", gone: "feature/returns-model" });
    expect(d.ops).toEqual(["branches", "branches fresh"]);
  });
  it("a file that isn't on a branch that is there is not found, not a fall-back", async () => {
    expect(await run(ctx(demo().git).c, "code.file", { repoId: SALES, path: ONLY_DEV, branch: "release/2026-11" })).toMatchObject({ ok: false, code: "not_found" });
  });
  it("refuses a branch that isn't a branch's name, before anything is read", async () => {
    for (const branch of ["a b", "../x", "x:y", "", 7, "refs/tags/v1:"]) {
      const d = demo();
      expect(await run(ctx(d.git).c, "code.folder", { repoId: SALES, path: "/", branch }), String(branch)).toMatchObject({ ok: false, status: 400 });
      expect(d.ops).toEqual([]);
    }
  });
});

describe("the branch list", () => {
  it("the opening branch first, then the default, then the rest by name", async () => {
    const r = await ok<{ names: string[]; opening: string; default: string; cut: boolean }>(run(ctx(demo().git, { opening: "dev" }).c, "code.branches", { repoId: SALES }));
    expect(r).toMatchObject({ opening: "dev", default: "main", cut: false });
    expect(r.names).toEqual(["dev", "main", "feature/returns-model", "feature/store-region-dimension-cleanup-before-the-quarterly-refresh", "release/2026-11"]);
  });
  it("writes no row in the log", async () => {
    const { c, views } = ctx(demo().git);
    await ok(run(c, "code.branches", { repoId: SALES }));
    expect(views).toEqual([]);
  });
  it("takes a client and a repo, nothing else", async () => {
    const d = demo();
    for (const extra of [{ branch: "dev" }, { path: "/" }, { filter: "tags/" }, { org: "x" }]) expect(await run(ctx(d.git).c, "code.branches", { repoId: SALES, ...extra })).toMatchObject({ ok: false, status: 400 });
    expect(d.ops).toEqual([]);
  });
});

describe("who may read is unchanged, for every read and the new one", () => {
  const READS: [CodeAction, Record<string, unknown>][] = [
    ["code.branches", { repoId: SALES }],
    ["code.folder", { repoId: SALES, path: "/", branch: "dev" }],
    ["code.file", { repoId: SALES, path: ONLY_DEV, branch: "dev" }],
    ["code.find", { repoId: SALES, branch: "dev" }],
    ["code.kinds", { repoId: SALES, branch: "dev" }],
    ["code.search", { repoId: SALES, branch: "dev" }],
    ["code.inside", { repoId: SALES, branch: "dev", words: "Returns" }],
  ];
  it.each(READS)("%s: a client set to its team only is refused for everyone else, before anything is read", async (a, i) => {
    const d = demo();
    expect(await run(ctx(d.git, { rules: { Northwind: "team" } }).c, a, i)).toMatchObject({ ok: false, status: 403, code: "team_only" });
    expect(d.ops).toEqual([]);
    expect((await run(ctx(demo().git, { rules: { Northwind: "team" }, onTeam: ["Northwind"] }).c, a, i)).ok).toBe(true);
  });
  it.each(READS)("%s: a guest and a signed-out person get nothing", async (a, i) => {
    const d = demo();
    expect(await run(ctx(d.git, { why: "guest" }).c, a, i)).toMatchObject({ ok: false, status: 403 });
    expect((await run(ctx(d.git, { me: null }).c, a, i)).ok).toBe(false);
    expect(d.ops).toEqual([]);
  });
});

describe("each view follows the branch", () => {
  it("the tree and find a file", async () => {
    const d = demo();
    const { c } = ctx(d.git);
    const top = await ok<{ entries: { name: string }[] }>(run(c, "code.folder", { repoId: SALES, path: "/lake/Gold.Warehouse/rpt/Views", branch: "dev" }));
    expect(top.entries.map((e) => e.name)).toContain("vReturnsByStore.sql");
    const main = await ok<{ entries: { name: string }[] }>(run(c, "code.folder", { repoId: SALES, path: "/lake/Gold.Warehouse/rpt/Views" }));
    expect(main.entries.map((e) => e.name)).not.toContain("vReturnsByStore.sql");
    const found = await ok<{ paths: string[]; branch: BranchPick }>(run(c, "code.find", { repoId: SALES, branch: "feature/returns-model" }));
    expect(found.paths).toContain(ONLY_FEATURE);
    expect(found.branch.name).toBe("feature/returns-model");
  });
  it("By kind and Search names: the repo on screen on its branch, every other repo on its usual one", async () => {
    for (const a of ["code.kinds", "code.search"] as const) {
      const d = demo();
      const r = await ok<{ repos: RepoThings[] }>(run(ctx(d.git).c, a, { repoId: SALES, branch: "dev" }));
      const sales = r.repos.find((x) => x.repo.id === SALES)!;
      expect(sales.branch).toBe("dev");
      expect(JSON.stringify(sales)).toContain("vReturnsByStore");
      expect(r.repos.find((x) => x.repo.id === PORTAL)!.branch).toBeUndefined();
      expect(d.ops.filter((o) => o.startsWith("files")).sort()).toEqual(["files sales-analytics@dev", "files store-portal@main"]);
    }
  });
  it("a branch goes with a repo, and only a repo of this client", async () => {
    const d = demo();
    expect(await run(ctx(d.git).c, "code.kinds", { branch: "dev" })).toMatchObject({ ok: false, status: 400 });
    expect(await run(ctx(d.git).c, "code.search", { repoId: SALES })).toMatchObject({ ok: false, status: 400 });
    expect(await run(ctx(d.git).c, "code.kinds", { repoId: "not-a-repo", branch: "dev" })).toMatchObject({ ok: false });
    expect(d.ops.filter((o) => !o.startsWith("repos"))).toEqual([]);
  });
});

describe("Where is it? and search across clients use the opening branch", () => {
  it("Where is it? takes no branch and no repo from a person", async () => {
    const d = demo();
    for (const extra of [{ branch: "dev" }, { repoId: SALES, branch: "dev" }]) expect(await run(ctx(d.git).c, "code.kinds", { from: "new_form", ...extra })).toMatchObject({ ok: false, status: 400 });
    expect(await run(ctx(d.git).c, "code.inner", { repoId: SALES, path: "/x", list: "pages", branch: "dev" })).toMatchObject({ ok: false, status: 400 });
    expect(d.ops).toEqual([]);
  });
  it("Where is it? lists each repo's opening branch, and is as before with none set", async () => {
    const none = await ok<{ repos: RepoThings[] }>(run(ctx(demo().git).c, "code.kinds", { from: "new_form" }));
    const before = await ok<{ repos: RepoThings[] }>(run(ctx(demo().git, { opening: null }).c, "code.kinds", { from: "new_form" }));
    expect(none).toEqual(before);
    expect(JSON.stringify(none)).not.toContain("vReturnsByStore");
    const d = demo();
    const dev = await ok<{ repos: RepoThings[] }>(run(ctx(d.git, { opening: "dev" }).c, "code.kinds", { from: "new_form" }));
    expect(JSON.stringify(dev)).toContain("vReturnsByStore");
    expect(dev.repos.every((r) => r.branch === undefined)).toBe(true);
    expect(d.ops.filter((o) => o.startsWith("files")).sort()).toEqual(["files sales-analytics@dev", "files store-portal@main"]);
  });
  it("a search across clients (no repo on screen) reads every repo on its opening branch", async () => {
    const d = demo();
    await ok(run(ctx(d.git, { opening: "dev" }).c, "code.search", {}));
    expect(d.ops.filter((o) => o.startsWith("files")).sort()).toEqual(["files sales-analytics@dev", "files store-portal@main"]);
  });
});

describe("search inside files on a branch", () => {
  const inside = (c: CodeContext, extra: Record<string, unknown> = {}) => ok<CodeInsideAnswer>(run(c, "code.inside", { words: "Returns", ...extra }));
  it("keeps a hit only when DevOps says it's on the branch on screen; a result opens on that branch", async () => {
    const r = await inside(ctx(demo().git).c, { repoId: SALES, branch: "dev" });
    const sales = r.files.filter((f) => f.repoId === SALES);
    expect(sales.map((f) => f.path)).toContain(ONLY_DEV);
    expect(sales.every((f) => f.branch === "dev")).toBe(true);
    expect(r.notSearched).toBeUndefined();
    expect(r.files.filter((f) => f.repoId === PORTAL).every((f) => f.branch === undefined)).toBe(true);
  });
  it("on its usual branch, a file only dev has isn't listed, and counts as not listed", async () => {
    const r = await inside(ctx(demo().git).c);
    expect(r.files.map((f) => f.path)).not.toContain(ONLY_DEV);
    expect(r.notListed).toBeGreaterThan(0);
  });
  it("a branch DevOps doesn't search: says so, and shows the default's results", async () => {
    const r = await inside(ctx(demo().git).c, { repoId: SALES, branch: "feature/returns-model" });
    expect(r.notSearched).toEqual([{ repoId: SALES, repoName: "sales-analytics", branch: "feature/returns-model", shown: "main" }]);
    const sales = r.files.filter((f) => f.repoId === SALES);
    expect(sales.length).toBeGreaterThan(0);
    expect(sales.map((f) => f.path)).not.toContain(ONLY_FEATURE);
    // The default is the usual branch here, so a result opens on it with nothing in the address.
    expect(sales.every((f) => f.branch === undefined)).toBe(true);
  });
  it("with an opening branch DevOps searches, the hits are on it and open on it as usual", async () => {
    const r = await inside(ctx(demo().git, { opening: "dev" }).c);
    expect(r.files.map((f) => f.path)).toContain(ONLY_DEV);
    expect(r.files.every((f) => f.branch === undefined)).toBe(true);
  });
  it("the default's results, when the usual branch is another, open on the default as a choice", async () => {
    const r = await inside(ctx(demo().git, { opening: "dev" }).c, { repoId: SALES, branch: "feature/returns-model" });
    expect(r.notSearched?.[0]).toMatchObject({ branch: "feature/returns-model", shown: "main" });
    expect(r.files.filter((f) => f.repoId === SALES).every((f) => f.branch === "main")).toBe(true);
  });
});

describe("Admin's Code tab: each repo's opening branch (codeOpenings)", () => {
  it("each repo with the branch it opens on, and every branch name its repos have to offer", async () => {
    const r = await codeOpenings(ctx(demo().git, { opening: "dev" }).c, "Northwind");
    if (!r.ok) throw new Error("refused");
    const o = r.data as CodeOpenings;
    expect(o.opening).toBe("dev");
    expect(o.repos.map((x) => [x.repo.name, x.opens])).toEqual([["archive", null], ["sales-analytics", "dev"], ["store-portal", "main"]]);
    expect(o.offer).toEqual(["dev", "feature/returns-model", "feature/store-region-dimension-cleanup-before-the-quarterly-refresh", "main", "release/2026-11"]);
  });
  it("with none set, each repo's default", async () => {
    const r = await codeOpenings(ctx(demo().git).c, "Northwind");
    expect(r.ok && (r.data as CodeOpenings).repos.map((x) => x.opens)).toEqual([null, "main", "main"]);
  });
  it("a client set to its team only: refused for an admin not on it, before anything is read; no row in the log", async () => {
    const d = demo();
    const { c, views } = ctx(d.git, { rules: { Northwind: "team" } });
    expect(await codeOpenings(c, "Northwind")).toMatchObject({ ok: false, status: 403, code: "team_only" });
    expect(d.ops).toEqual([]);
    const team = ctx(demo().git, { rules: { Northwind: "team" }, onTeam: ["Northwind"] });
    expect((await codeOpenings(team.c, "Northwind")).ok).toBe(true);
    expect([...views, ...team.views]).toEqual([]);
  });
});
