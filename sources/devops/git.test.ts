// RB-1: the Git reader can build only its four reads (GETs under the client's own organization and project), reads the
// default branch, keeps a path in a query value, reads at most 1 MB + 1 byte, maps a token without Code (read) to a
// plain reason, goes through the limiter, and never puts a path, a repo name or content in a log line or an error.
import { describe, expect, it } from "vitest";
import { ALLOWED, buildUrl, createGitReader, GitFailure, type GitRepo, type GitTarget } from "./git.ts";
import { Pat } from "./pat.ts";
import type { LogRecord } from "../../log/logger.ts";
import { TEXT_MAX_BYTES } from "../../plan/code.ts";

const T: GitTarget = { clientKey: "Contoso", org: "contoso", project: "Data Platform", pat: new Pat("secret-token-value") };
const REPO: GitRepo = { id: "11111111-2222-4333-8444-555555555555", name: "warehouse", defaultBranch: "main", disabled: false, webUrl: "https://dev.azure.com/contoso/Data%20Platform/_git/warehouse" };
const COMMIT = "a".repeat(40);
const SECRET_PATH = "/secret-folder/payroll.sql";

type Call = { url: string; init: RequestInit };
function fake(answer: (url: URL) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const logs: LogRecord[] = [];
  const f = (async (u: string | URL, init?: RequestInit) => {
    calls.push({ url: String(u), init: init ?? {} });
    return answer(new URL(String(u)));
  }) as typeof fetch;
  const limiter = { before: [] as string[], after: [] as number[] };
  const reader = createGitReader({ fetch: f, log: (r) => void logs.push(r), limiter: { before: (k) => void limiter.before.push(k), after: (_k, s) => void limiter.after.push(s) } });
  return { reader, calls, logs, limiter };
}
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json; charset=utf-8" } });

describe("the allow list", () => {
  it("builds only GETs under dev.azure.com/<org>/<project>/_apis/git", () => {
    expect(Object.keys(ALLOWED).sort()).toEqual(["file_bytes", "file_meta", "files", "folder", "repos"]);
    const u = new URL(buildUrl(T, "folder", REPO.id, { scopePath: "/a b", recursionLevel: "OneLevel", "versionDescriptor.version": "main", "versionDescriptor.versionType": "branch" }));
    expect(u.origin).toBe("https://dev.azure.com");
    expect(u.pathname).toBe(`/contoso/Data%20Platform/_apis/git/repositories/${REPO.id}/items`);
    expect(u.searchParams.get("scopePath")).toBe("/a b");
    expect(u.searchParams.get("api-version")).toBe("7.1");
  });
  it("throws before a request for anything else", () => {
    expect(() => buildUrl(T, "delete" as never, null, {})).toThrow();
    expect(() => buildUrl(T, "repos", null, { includeHidden: "true" })).toThrow();
    expect(() => buildUrl(T, "folder", REPO.id, { recursionLevel: "None" })).toThrow();
    expect(() => buildUrl(T, "folder", "../../other", {})).toThrow();
    expect(() => buildUrl(T, "repos", REPO.id, {})).toThrow();
    expect(() => buildUrl({ ...T, org: "evil.example.com/x" }, "repos", null, {})).toThrow();
    expect(() => buildUrl({ ...T, project: "a/../../other" }, "repos", null, {})).toThrow();
    expect(() => buildUrl(T, "file_meta", REPO.id, { path: "/../x" })).toThrow();
    expect(() => buildUrl(T, "file_meta", REPO.id, { path: "/a?b=1&c" , includeContentMetadata: "true" })).not.toThrow();
    expect(() => buildUrl(T, "file_bytes", REPO.id, { "versionDescriptor.version": "main", "versionDescriptor.versionType": "commit" })).toThrow();
  });
  it("keeps a path a query value: it can't change the request", () => {
    const u = new URL(buildUrl(T, "file_meta", REPO.id, { path: "/a?api-version=1&x=#frag", includeContentMetadata: "true" }));
    expect(u.pathname.endsWith("/items")).toBe(true);
    expect(u.searchParams.get("path")).toBe("/a?api-version=1&x=#frag");
    expect(u.searchParams.getAll("api-version")).toEqual(["7.1"]);
    expect(u.hash).toBe("");
  });
});

describe("the reads", () => {
  it("lists repos with their default branch, never trusting a link off dev.azure.com", async () => {
    const { reader, calls, limiter } = fake(() => json({ value: [{ id: REPO.id.toUpperCase(), name: "warehouse", defaultBranch: "refs/heads/main", webUrl: REPO.webUrl }, { id: "22222222-2222-4333-8444-555555555555", name: "empty", webUrl: "https://evil.example/x" }, { id: "nope", name: "bad" }] }));
    const repos = await reader.repos(T);
    expect(repos).toEqual([{ id: "22222222-2222-4333-8444-555555555555", name: "empty", defaultBranch: null, disabled: false, webUrl: null }, { ...REPO }]);
    expect(calls[0]!.init.method).toBe("GET");
    expect(new Headers(calls[0]!.init.headers).get("authorization")).toMatch(/^Basic /);
    expect(limiter.before).toEqual(["Contoso"]);
    expect(limiter.after).toEqual([200]);
  });
  it("reads one folder level on the default branch, folders first, without submodules", async () => {
    const { reader, calls } = fake(() => json({ value: [{ path: "/sql", isFolder: true, commitId: COMMIT }, { path: "/sql/b.sql", gitObjectType: "blob", commitId: COMMIT }, { path: "/sql/Views", gitObjectType: "tree", isFolder: true, commitId: COMMIT }, { path: "/sql/A.sql", gitObjectType: "blob", commitId: COMMIT }, { path: "/sql/sub", gitObjectType: "commit" }] }));
    const f = await reader.folder(T, REPO, "/sql");
    expect(f.entries.map((e) => e.name)).toEqual(["Views", "A.sql", "b.sql"]);
    expect(f.commit).toBe(COMMIT);
    const u = new URL(calls[0]!.url);
    expect(u.searchParams.get("versionDescriptor.version")).toBe("main");
    expect(u.searchParams.get("versionDescriptor.versionType")).toBe("branch");
    expect(u.searchParams.get("recursionLevel")).toBe("OneLevel");
  });
  it("an empty repo is read as empty, without a request", async () => {
    const { reader, calls } = fake(() => json({}));
    expect(await reader.folder(T, { ...REPO, defaultBranch: null }, "/")).toEqual({ commit: null, entries: [], cut: false });
    expect(calls).toHaveLength(0);
  });
  it("lists every file name for Find, and a file's bytes pinned to the commit", async () => {
    const { reader, calls } = fake((u) => (u.searchParams.get("recursionLevel") === "Full" ? json({ value: [{ path: "/", isFolder: true, commitId: COMMIT }, { path: "/a/x.json", gitObjectType: "blob" }, { path: "/a", isFolder: true }] }) : new Response("SELECT 1;", { headers: { "content-length": "9" } })));
    expect((await reader.files(T, REPO)).paths).toEqual(["/a/x.json"]);
    const b = await reader.fileBytes(T, REPO, "/a/x.sql", COMMIT);
    expect(new TextDecoder().decode(b.bytes!)).toBe("SELECT 1;");
    const u = new URL(calls[1]!.url);
    expect(u.searchParams.get("versionDescriptor.version")).toBe(COMMIT);
    expect(u.searchParams.get("versionDescriptor.versionType")).toBe("commit");
    expect(u.searchParams.has("resolveLfs")).toBe(false);
    expect(new Headers(calls[1]!.init.headers).get("accept")).toBe("application/octet-stream");
  });
  it("never reads a file past 1 MB: a large Content-Length isn't read, a stream stops at 1 MB + 1", async () => {
    const big = fake(() => new Response("x", { headers: { "content-length": String(TEXT_MAX_BYTES + 10) } }));
    expect(await big.reader.fileBytes(T, REPO, "/a.csv", COMMIT)).toEqual({ size: TEXT_MAX_BYTES + 10, bytes: null });
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled++;
        c.enqueue(new Uint8Array(64 * 1024).fill(65));
        if (pulled > 100) c.close();
      },
    });
    const open = fake(() => new Response(stream));
    const r = await open.reader.fileBytes(T, REPO, "/b.csv", COMMIT);
    expect(r.bytes!.length).toBe(TEXT_MAX_BYTES + 1);
    expect(r.size).toBeNull();
    expect(pulled).toBeLessThan(30);
  });
});

describe("refusals", () => {
  it.each([401, 203, 403, 302])("a token without Code (read) (HTTP %i) is the plain reason", async (status) => {
    const { reader } = fake(() => new Response("<html>sign in</html>", { status, headers: { "content-type": "text/html" } }));
    await expect(reader.repos(T)).rejects.toMatchObject({ reason: "needs_code_read" });
  });
  it("a sign-in page with 200 is also Code (read)", async () => {
    const { reader } = fake(() => new Response("<html>sign in</html>", { headers: { "content-type": "text/html" } }));
    await expect(reader.repos(T)).rejects.toMatchObject({ reason: "needs_code_read" });
  });
  it("429 is busy, 404 is not found, a network error is unreachable", async () => {
    await expect(fake(() => new Response("", { status: 429 })).reader.repos(T)).rejects.toMatchObject({ reason: "busy" });
    await expect(fake(() => new Response("", { status: 404 })).reader.fileMeta(T, REPO, "/x")).rejects.toMatchObject({ reason: "not_found" });
    await expect(fake(() => Promise.reject(new TypeError(`fetch failed for ${SECRET_PATH}`))).reader.repos(T)).rejects.toMatchObject({ reason: "unreachable" });
  });
  it("a client DevOps asked to wait gets no request", async () => {
    const calls: string[] = [];
    const reader = createGitReader({ fetch: (async (u: string) => (calls.push(u), json({}))) as typeof fetch, log: () => {}, limiter: { before: () => { throw new Error("wait"); }, after: () => {} } });
    await expect(reader.repos(T)).rejects.toMatchObject({ reason: "busy" });
    expect(calls).toHaveLength(0);
  });
  it("no path, repo name, client, token or content reaches a log line or an error", async () => {
    const { reader, logs } = fake((u) => (u.searchParams.get("path") ? new Response("", { status: 500 }) : json({ value: [{ path: `${SECRET_PATH}`, gitObjectType: "blob", commitId: COMMIT }] })));
    await reader.folder(T, REPO, "/secret-folder");
    const e = await reader.fileMeta(T, REPO, SECRET_PATH).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(GitFailure);
    const all = JSON.stringify(logs) + String((e as Error).message) + String((e as Error).stack);
    for (const s of ["secret-folder", "payroll", "warehouse", "Contoso", "contoso", "secret-token-value", "Data Platform"]) expect(all).not.toContain(s);
  });
});
