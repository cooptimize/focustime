// RB-1: the company read PAT is read from Dataverse for each read and never kept; memory entries end after 5 minutes;
// a client with no DevOps or no token says so.
import { describe, expect, it } from "vitest";
import { codeMemory, createCodeGit } from "./code-git.ts";
import { createGitReader, type GitRepo } from "../sources/devops/git.ts";
import { Pat } from "../sources/devops/pat.ts";
import type { TargetsResult } from "../sources/devops/types.ts";

const REPO: GitRepo = { id: "11111111-2222-4333-8444-555555555555", name: "warehouse", defaultBranch: "main", disabled: false, webUrl: null };
const COMMIT = "b".repeat(40);
const target = (over: Partial<{ org: string | null; project: string | null; pat: Pat | null; problem: string }> = {}): TargetsResult => ({ ok: true, targets: [{ accountId: "x", clientKey: "Contoso", clientName: "Contoso", org: "contoso", project: "Data", projectName: "Data", email: null, pat: new Pat("t"), ...over }] });

function setup(targets: () => TargetsResult = () => target()) {
  let t = 0;
  const calls: string[] = [];
  let reads = 0;
  const fetch = (async (u: string) => {
    calls.push(u);
    const url = new URL(u);
    if (url.pathname.endsWith("/repositories")) return new Response(JSON.stringify({ value: [{ id: REPO.id, name: "warehouse", defaultBranch: "refs/heads/main" }] }), { headers: { "content-type": "application/json" } });
    if (url.searchParams.get("scopePath")) return new Response(JSON.stringify({ value: [{ path: "/a.sql", gitObjectType: "blob", commitId: COMMIT }] }), { headers: { "content-type": "application/json" } });
    if (url.searchParams.get("includeContentMetadata")) return new Response(JSON.stringify({ path: "/a.sql", commitId: COMMIT, contentMetadata: { isBinary: false } }), { headers: { "content-type": "application/json" } });
    return new Response("SELECT 1;");
  }) as typeof globalThis.fetch;
  const git = createCodeGit({ reader: createGitReader({ fetch, log: () => {} }), targets: async () => (reads++, targets()), now: () => t });
  return { git, calls, advance: (ms: number) => (t += ms), reads: () => reads };
}

describe("code memory", () => {
  it("an entry ends after 5 minutes", () => {
    let t = 0;
    const m = codeMemory(() => t);
    m.set("k", 1, 1);
    t = 5 * 60_000 - 1;
    expect(m.get("k")).toBe(1);
    t = 5 * 60_000;
    expect(m.get("k")).toBeUndefined();
  });
});

describe("createCodeGit", () => {
  it("reads the token from Dataverse for a read and serves repeats from memory for 5 minutes", async () => {
    const s = setup();
    await s.git.folder("Contoso", REPO, "/");
    await s.git.folder("Contoso", REPO, "/");
    expect(s.calls).toHaveLength(1);
    expect(s.reads()).toBe(1);
    const f = await s.git.file("Contoso", REPO, "/a.sql");
    expect(f).toMatchObject({ kind: "text", text: "SELECT 1;", commit: COMMIT });
    await s.git.file("Contoso", REPO, "/a.sql");
    expect(s.calls).toHaveLength(3);
    s.advance(5 * 60_000);
    await s.git.folder("Contoso", REPO, "/");
    expect(s.calls).toHaveLength(4);
  });
  it("one client's memory never answers another", async () => {
    const s = setup(() => ({ ok: true, targets: [...(target() as unknown as { targets: never[] }).targets, { accountId: "y", clientKey: "Fabrikam", clientName: "Fabrikam", org: "fabrikam", project: "P", projectName: "P", email: null, pat: new Pat("u") }] }));
    await s.git.folder("Contoso", REPO, "/");
    await s.git.folder("Fabrikam", REPO, "/");
    expect(s.calls.map((u) => new URL(u).pathname.split("/")[1])).toEqual(["contoso", "fabrikam"]);
  });
  it.each([
    ["no_devops", target({ org: null })],
    ["no_devops", { ok: true, targets: [] } as TargetsResult],
    ["no_token", target({ pat: null })],
    ["error", target({ problem: "two accounts" })],
    ["unreachable", { ok: false, message: "Dataverse read failed" } as TargetsResult],
  ])("%s", async (reason, t) => {
    const s = setup(() => t);
    await expect(s.git.repos("Contoso")).rejects.toMatchObject({ reason });
    expect(s.calls).toHaveLength(0);
  });
});
