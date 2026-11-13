// RB-1: who may read a client's code, checked on every read; the view log row before a file's text; no content in
// the log; nothing taken from the browser but a client key, a repo id from the client's own list and a path.
import { describe, expect, it } from "vitest";
import { codeAction, codeStatus, CODE_TEXT, type CodeAction, type CodeContext } from "./code-actions.ts";
import { CodeFailure, type CodeGit } from "./code-git.ts";
import type { GitRepo } from "../sources/devops/git.ts";
import type { CodeViewInput } from "../store/code-views-store.ts";
import type { CodeAccess } from "../plan/code.ts";

const REPO: GitRepo = { id: "11111111-2222-4333-8444-555555555555", name: "warehouse", defaultBranch: "main", disabled: false, webUrl: "https://dev.azure.com/contoso/Data/_git/warehouse" };
const OTHER = "99999999-2222-4333-8444-555555555555";
const ME = { id: "aaaaaaaa-0000-4000-8000-000000000001", name: "Ana Example" };

function fakeGit() {
  const reads: string[] = [];
  const git: CodeGit = {
    repos: async (k) => (reads.push(`repos ${k}`), [REPO]),
    folder: async (k, _r, p) => (reads.push(`folder ${k} ${p}`), { commit: "c", entries: [{ name: "a.sql", path: "/a.sql", folder: false }], cut: false }),
    files: async (k) => (reads.push(`files ${k}`), { commit: "c", paths: ["/a.sql"], cut: false }),
    file: async (k, _r, p) => (reads.push(`file ${k} ${p}`), { path: p, commit: "c", size: 9, kind: "text", text: "SELECT 1;" }),
  };
  return { git, reads };
}

function ctx(o: { why?: Awaited<ReturnType<CodeContext["notCooptimizer"]>> | "throw"; rules?: Record<string, CodeAccess>; onTeam?: string[]; views?: CodeViewInput[] | "fail"; git?: CodeGit | null; me?: typeof ME | null } = {}) {
  const views: CodeViewInput[] = Array.isArray(o.views) ? o.views : [];
  const g = fakeGit();
  const c: CodeContext = {
    me: async () => (o.me === undefined ? ME : o.me),
    notCooptimizer: async () => {
      if (o.why === "throw") throw new Error("can't read");
      return o.why ?? null;
    },
    clients: async () => [
      { clientKey: "Contoso", name: "Contoso", color: null },
      { clientKey: "Fabrikam", name: "Fabrikam", color: "#123456" },
    ],
    rule: async (k) => o.rules?.[k] ?? "company",
    team: async () => ({ myClients: o.onTeam ?? [], onClient: (k) => (o.onTeam ?? []).includes(k) }),
    git: o.git === undefined ? g.git : o.git,
    views: { add: async (v) => (o.views === "fail" ? Promise.reject(new Error("db down")) : void views.push(v)) },
  };
  return { c, views, reads: g.reads };
}
const run = (c: CodeContext, a: CodeAction, input: unknown = {}) => codeAction(c, a, input);
const ALL: [CodeAction, unknown][] = [
  ["code.repos", { clientKey: "Fabrikam" }],
  ["code.folder", { clientKey: "Fabrikam", repoId: REPO.id, path: "/" }],
  ["code.find", { clientKey: "Fabrikam", repoId: REPO.id }],
  ["code.file", { clientKey: "Fabrikam", repoId: REPO.id, path: "/a.sql" }],
];

describe("who may read", () => {
  it("a Cooptimizer reads any client set to Whole company", async () => {
    const { c } = ctx();
    for (const [a, i] of ALL) expect((await run(c, a, i)).ok).toBe(true);
  });
  it("a client set to its team only: its team reads it, everyone else is refused on every read, before anything is read", async () => {
    const team = ctx({ rules: { Fabrikam: "team" }, onTeam: ["Fabrikam"] });
    for (const [a, i] of ALL) expect((await run(team.c, a, i)).ok).toBe(true);
    const other = ctx({ rules: { Fabrikam: "team" }, onTeam: ["Contoso"] });
    for (const [a, i] of ALL) expect(await run(other.c, a, i)).toMatchObject({ ok: false, status: 403, code: "team_only", error: "Only Fabrikam's team can open this." });
    expect(other.reads).toEqual([]);
    expect(other.views).toEqual([]);
  });
  it("lists a team-only client greyed for everyone else, with no repo names, my clients first", async () => {
    const { c, reads } = ctx({ rules: { Fabrikam: "team" }, onTeam: ["Contoso"] });
    const r = await run(c, "code.clients");
    expect(r).toMatchObject({ ok: true, data: { clients: [{ clientKey: "Contoso", mine: true, locked: false }, { clientKey: "Fabrikam", mine: false, locked: true }] } });
    expect(reads).toEqual([]);
  });
  it.each(["guest", "domain", "automation"] as const)("a %s is refused everything", async (why) => {
    const { c, reads } = ctx({ why });
    for (const [a, i] of [["code.clients", {}] as [CodeAction, unknown], ...ALL]) expect(await run(c, a, i)).toMatchObject({ ok: false, status: 403, code: why });
    expect(reads).toEqual([]);
  });
  it("a signed-out person, or one whose people entry can't be read, is refused", async () => {
    expect(await run(ctx({ me: null }).c, "code.clients")).toMatchObject({ ok: false, status: 403 });
    expect(await run(ctx({ why: "throw" }).c, "code.file", ALL[3]![1])).toMatchObject({ ok: false, code: "unknown" });
  });
  it("a hidden client isn't listed, and can't be read by its key", async () => {
    const { c } = ctx();
    const r = await run(c, "code.repos", { clientKey: "Hidden Co" });
    expect(r).toMatchObject({ ok: false, status: 404, code: "no_client" });
  });
});

describe("what the browser can name", () => {
  it("an organization, project or repo from the browser is refused", async () => {
    const { c, reads } = ctx();
    for (const extra of [{ org: "evil" }, { project: "Other" }, { repo: "x" }, { url: "https://evil.example" }]) expect(await run(c, "code.folder", { clientKey: "Contoso", repoId: REPO.id, path: "/", ...extra })).toMatchObject({ ok: false, status: 400 });
    expect(reads).toEqual([]);
  });
  it("a repo id outside the client's own list is refused", async () => {
    const { c, reads } = ctx();
    expect(await run(c, "code.file", { clientKey: "Contoso", repoId: OTHER, path: "/a.sql" })).toMatchObject({ ok: false, code: "no_repo" });
    expect(reads).toEqual(["repos Contoso"]);
  });
  it("a path that leaves the repo is refused", async () => {
    const { c, reads } = ctx();
    expect(await run(c, "code.file", { clientKey: "Contoso", repoId: REPO.id, path: "/../../etc" })).toMatchObject({ ok: false, code: "bad_path" });
    expect(reads.some((r) => r.startsWith("file"))).toBe(false);
  });
});

describe("the view log", () => {
  it("a file's row is written before its text is returned, and holds no content", async () => {
    const { c, views } = ctx();
    const r = await run(c, "code.file", { clientKey: "Contoso", repoId: REPO.id, path: "/a.sql" });
    expect(r).toMatchObject({ ok: true, data: { file: { text: "SELECT 1;", kind: "text", devopsUrl: "https://dev.azure.com/contoso/Data/_git/warehouse?path=%2Fa.sql&version=GBmain" } } });
    expect(views).toEqual([{ actorId: ME.id, actorName: ME.name, clientKey: "Contoso", repoId: REPO.id, repoName: "warehouse", path: "/a.sql", event: "file_opened" }]);
    expect(JSON.stringify(views)).not.toContain("SELECT");
  });
  it("no row, no text", async () => {
    const { c } = ctx({ views: "fail" });
    const r = await run(c, "code.file", { clientKey: "Contoso", repoId: REPO.id, path: "/a.sql" });
    expect(r).toMatchObject({ ok: false, code: "not_logged" });
    expect(JSON.stringify(r)).not.toContain("SELECT");
  });
  it("logs a repo's top folder and Find, not other folders", async () => {
    const { c, views } = ctx();
    await run(c, "code.folder", { clientKey: "Contoso", repoId: REPO.id, path: "/" });
    await run(c, "code.folder", { clientKey: "Contoso", repoId: REPO.id, path: "/sql" });
    await run(c, "code.find", { clientKey: "Contoso", repoId: REPO.id });
    expect(views.map((v) => v.event)).toEqual(["repo_opened", "find_used"]);
  });
});

describe("plain reasons", () => {
  it("a token without Code (read) says so in plain words", async () => {
    const git: CodeGit = { ...fakeGit().git, repos: async () => Promise.reject(new CodeFailure("needs_code_read")) };
    expect(await run(ctx({ git }).c, "code.repos", { clientKey: "Contoso" })).toMatchObject({ ok: false, code: "needs_code_read", error: "FocusTime can't read Contoso's code yet. The company DevOps token for Contoso needs Code (read)." });
    expect(await codeStatus(git, "Contoso", "Contoso")).toEqual({ state: "needs_code_read", text: "Can't read yet: the token needs Code (read)" });
    expect(await codeStatus(fakeGit().git, "Contoso", "Contoso")).toEqual({ state: "readable", repos: 1 });
  });
  it("binary, too large and image files carry no text", async () => {
    for (const kind of ["binary", "too_large", "image"] as const) {
      const git: CodeGit = { ...fakeGit().git, file: async (_k, _r, p) => ({ path: p, commit: "c", size: 2_000_000, kind, text: "should not leave" }) };
      const r = await run(ctx({ git }).c, "code.file", { clientKey: "Contoso", repoId: REPO.id, path: "/a.bin" });
      expect(r).toMatchObject({ ok: true, data: { file: { kind, text: null, sizeText: "1.9 MB" } } });
    }
  });
  it("no Code here says so", async () => {
    expect(await run(ctx({ git: null }).c, "code.repos", { clientKey: "Contoso" })).toMatchObject({ ok: false, error: CODE_TEXT.notHere });
  });
});
