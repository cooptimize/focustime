// RB-1: a small, read-only Git reader beside the DevOps source. Four reads of one client's registered project, with
// the company read PAT (from Dataverse at fetch time, wrapped in Pat, never kept here), the per-client limiter and the
// DevOps source's host rule (only https://dev.azure.com/<the client's org>/):
//   repos   GET {org}/{project}/_apis/git/repositories
//   folder  GET {org}/{project}/_apis/git/repositories/{repo}/items?scopePath=<path>&recursionLevel=OneLevel&<branch>
//   files   GET {org}/{project}/_apis/git/repositories/{repo}/items?scopePath=/&recursionLevel=Full&<branch>   (Find)
//   file    GET {org}/{project}/_apis/git/repositories/{repo}/items?path=<path>&includeContentMetadata=true&<branch>
//           then the same path pinned to the commit that answered, as bytes (Accept: application/octet-stream)
// RB-7 adds one more Git read, a repo's branches, so Code can open a branch someone chooses:
//   branches GET {org}/{project}/_apis/git/repositories/{repo}/refs?filter=heads/&$top=1000
//           branch heads only (never tags or any other kind of ref), one page of at most 1000; only each ref's name is
//           read from the answer (never who made it or anything else).
// RB-4 adds one more, for Search inside files, on DevOps's own search address:
//   search  POST https://almsearch.dev.azure.com/{org}/{project}/_apis/search/codesearchresults?api-version=7.1
//           with a body of exactly searchText, $skip 0, $top, includeFacets false and includeSnippet false
// It asks DevOps's code search (Microsoft's Code Search extension, where the client's organization has it) which files
// hold the words. FocusTime reads no file for it and asks for no snippet: the answer is file paths, repo ids, branch
// names and match counts. The words go in the body only, never in the address, a log line or an error.
// Only these can be built (ALLOWED and buildSearch, like sources/azure/client.ts): anything else throws before a
// request is sent.
// The organization, project and repo come from the caller's target and the client's own repo list, never from the
// browser; a path travels only as a query value. Git LFS pointers are never resolved (resolveLfs is never sent).
// Nothing read here is logged: the log line carries the read's name, a status and a duration, never a path, a repo
// name, a client or any content; failures carry plain reasons with no path either.
import { API_VERSION, type Limiter } from "./source.ts";
import type { Pat } from "./pat.ts";
import type { Logger } from "../../log/logger.ts";
import { branchName, cleanPath, isBranchName, FIND_MAX, FOLDER_MAX, INSIDE_MAX, INSIDE_WORDS_MAX, nameOf, REPO_ID, sortEntries, TEXT_MAX_BYTES, type CodeEntry } from "../../plan/code.ts";

/** One client's DevOps as the reader needs it: from Dataverse at fetch time; nothing from the browser. */
export type GitTarget = { clientKey: string; org: string; project: string; pat: Pat };

export type GitRepo = { id: string; name: string; /** "main", or null for an empty repo. */ defaultBranch: string | null; disabled: boolean; /** The repo's page in DevOps. */ webUrl: string | null };
export type GitFolder = { commit: string | null; entries: CodeEntry[]; cut: boolean };
export type GitFileList = { commit: string | null; paths: string[]; cut: boolean };
export type GitFileMeta = { commit: string; isBinary: boolean; isImage: boolean };
export type GitBytes = { size: number | null; /** At most TEXT_MAX_BYTES + 1 bytes; null when the size alone says it's too large. */ bytes: Uint8Array | null };

/** RB-4: one file DevOps's code search found: where it is, the branches it was found on and how many matches it has. */
export type GitSearchHit = { repoId: string; path: string; branches: string[]; /** Null when DevOps didn't say. */ matches: number | null };
/** RB-4: a code search's answer: the total DevOps counted, the files it returned and its info code (0 is fine). */
export type GitSearchAnswer = { count: number; hits: GitSearchHit[]; info: number };
/** RB-7: a repo's branch names ("main", "feature/x"), A to Z, and whether there were more than one page holds. */
export type GitBranchList = { names: string[]; cut: boolean };

export type GitFailureReason = "needs_code_read" | "not_found" | "busy" | "unreachable" | "error" | /** RB-4 */ "no_code_search" | "bad_query";
/** A failed read. The message is a fixed phrase: never a path, a repo name, an organization or a body. */
export class GitFailure extends Error {
  readonly reason: GitFailureReason;
  constructor(reason: GitFailureReason) {
    super(`git read failed: ${reason}`);
    this.reason = reason;
  }
}

// ---------- the allow list ----------

export type GitOp = "repos" | "folder" | "files" | "file_meta" | "file_bytes" | "branches";
type Spec = { /** Under {org}/{project}/_apis/git/. */ path: "repositories" | "repositories/{repo}/items" | "repositories/{repo}/refs"; query: readonly string[]; accept: string; /** RB-7: keys that must be sent, each with its one fixed value. */ required?: readonly string[] };
/** The only requests the reader can build. Every one is a GET; any other key, op or value throws before fetch. */
export const ALLOWED: Readonly<Record<GitOp, Spec>> = {
  repos: { path: "repositories", query: [], accept: "application/json" },
  folder: { path: "repositories/{repo}/items", query: ["scopePath", "recursionLevel", "versionDescriptor.version", "versionDescriptor.versionType"], accept: "application/json" },
  files: { path: "repositories/{repo}/items", query: ["scopePath", "recursionLevel", "versionDescriptor.version", "versionDescriptor.versionType"], accept: "application/json" },
  file_meta: { path: "repositories/{repo}/items", query: ["path", "includeContentMetadata", "versionDescriptor.version", "versionDescriptor.versionType"], accept: "application/json" },
  file_bytes: { path: "repositories/{repo}/items", query: ["path", "download", "versionDescriptor.version", "versionDescriptor.versionType"], accept: "application/octet-stream" },
  // RB-7: a repo's branch heads, and nothing else: the filter is required and is only "heads/".
  branches: { path: "repositories/{repo}/refs", query: ["filter", "$top"], accept: "application/json", required: ["filter", "$top"] },
};
/** RB-7: at most this many branches of a repo are listed (one page; Microsoft's own limit for $top). */
export const BRANCHES_MAX = 1000;
const FIXED: Readonly<Record<string, readonly string[]>> = { recursionLevel: ["OneLevel", "Full"], "versionDescriptor.versionType": ["branch", "commit"], includeContentMetadata: ["true"], download: ["false"], filter: ["heads/"], $top: [String(BRANCHES_MAX)] };
const ORG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const BRANCH = /^[^\u0000-\u001f\u007f\s~^:?*[\\]{1,250}$/;
const COMMIT = /^[0-9a-f]{40}$/i;

/** Builds one allowed request's URL, or throws (nothing is sent). Exported for the tests. */
export function buildUrl(t: Pick<GitTarget, "org" | "project">, op: GitOp, repo: string | null, query: Readonly<Record<string, string>>): string {
  const spec = ALLOWED[op];
  if (!spec) throw new Error("not an allowed Git read");
  // A name of only dots would be read as "this folder" or "the folder above" and widen the request (review 2).
  if (!ORG.test(t.org) || /^\.+$/.test(t.org)) throw new Error("not an organization name");
  if (!t.project || t.project.length > 200 || /[\u0000-\u001f\u007f/\\]/.test(t.project) || /^\.+$/.test(t.project.trim())) throw new Error("not a project name");
  let path: string = spec.path;
  if (path.includes("{repo}")) {
    if (!repo || !REPO_ID.test(repo)) throw new Error("not a repo id");
    path = path.replace("{repo}", repo.toLowerCase());
  } else if (repo !== null) throw new Error("this read takes no repo");
  for (const k of spec.required ?? []) if (!(k in query)) throw new Error("a required query key is missing");
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (!spec.query.includes(k)) throw new Error("not an allowed query key");
    const fixed = FIXED[k];
    if (fixed && !fixed.includes(v)) throw new Error("not an allowed value");
    if ((k === "path" || k === "scopePath") && cleanPath(v) !== v) throw new Error("not a path in the repo");
    if (k === "versionDescriptor.version" && !(query["versionDescriptor.versionType"] === "commit" ? COMMIT.test(v) : BRANCH.test(v))) throw new Error("not a branch or commit");
    q.set(k, v);
  }
  q.set("api-version", API_VERSION);
  // The host is fixed: only dev.azure.com, only the client's own organization and project.
  const url = new URL(`https://dev.azure.com/${encodeURIComponent(t.org)}/${encodeURIComponent(t.project)}/_apis/git/${path}`);
  url.search = q.toString();
  if (url.origin !== "https://dev.azure.com" || !url.pathname.startsWith(`/${encodeURIComponent(t.org)}/${encodeURIComponent(t.project)}/_apis/git/`)) throw new Error("not the client's organization and project");
  return url.toString();
}

/** RB-4: the one address a code search goes to. */
export const SEARCH_ORIGIN = "https://almsearch.dev.azure.com";
/** RB-4: the only fields a code search's body can hold. */
export const SEARCH_FIELDS = ["searchText", "$skip", "$top", "includeFacets", "includeSnippet"] as const;

/**
 * RB-4: builds the one allowed code search request, or throws (nothing is sent): a POST to DevOps's search address for
 * the client's own organization and project, with the words and how many files to return. No snippet is ever asked
 * for. Exported for the tests.
 */
export function buildSearch(t: Pick<GitTarget, "org" | "project">, text: string, top: number): { url: string; body: string } {
  if (!ORG.test(t.org) || /^\.+$/.test(t.org)) throw new Error("not an organization name");
  if (!t.project || t.project.length > 200 || /[\u0000-\u001f\u007f/\\]/.test(t.project) || /^\.+$/.test(t.project.trim())) throw new Error("not a project name");
  // eslint-disable-next-line no-control-regex
  if (typeof text !== "string" || !text.trim() || text.length > INSIDE_WORDS_MAX + 40 || /[\u0000-\u001f\u007f]/.test(text)) throw new Error("not a search text");
  if (!Number.isInteger(top) || top < 1 || top > INSIDE_MAX) throw new Error("not an allowed number of results");
  const path = `/${encodeURIComponent(t.org)}/${encodeURIComponent(t.project)}/_apis/search/codesearchresults`;
  const url = new URL(`${SEARCH_ORIGIN}${path}`);
  url.search = new URLSearchParams({ "api-version": API_VERSION }).toString();
  if (url.origin !== SEARCH_ORIGIN || url.pathname !== path) throw new Error("not the client's organization and project");
  return { url: url.toString(), body: JSON.stringify({ searchText: text, $skip: 0, $top: top, includeFacets: false, includeSnippet: false }) };
}

// ---------- the reader ----------

export type GitReaderDeps = { fetch: typeof fetch; log: Logger; limiter?: Limiter; timeoutMs?: number };

type RawItem = { path?: unknown; isFolder?: unknown; gitObjectType?: unknown; commitId?: unknown; contentMetadata?: { isBinary?: unknown; isImage?: unknown } | null };

export function createGitReader(d: GitReaderDeps) {
  const timeoutMs = d.timeoutMs ?? 20_000;

  async function send(t: GitTarget, op: GitOp, repo: string | null, query: Record<string, string>): Promise<Response> {
    const url = buildUrl(t, op, repo, query);
    // A client DevOps asked to wait gets no request until then (the limiter throws; reported as busy).
    try {
      d.limiter?.before(t.clientKey);
    } catch {
      throw new GitFailure("busy");
    }
    const started = performance.now();
    let res: Response;
    try {
      res = await d.fetch(url, { method: "GET", headers: { accept: ALLOWED[op].accept, authorization: t.pat.basicAuth() }, redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      d.log({ source: "devops", op: `git_${op}`, kind: "network" });
      throw new GitFailure("unreachable");
    }
    d.log({ source: "devops", op: `git_${op}`, status: res.status, durationMs: performance.now() - started });
    d.limiter?.after(t.clientKey, res.status, res.headers);
    if (res.ok && res.status !== 203) return res;
    await res.body?.cancel().catch(() => undefined);
    if (res.status === 429 || res.status === 503) throw new GitFailure("busy");
    // A token without Code (read) is refused like a bad token: 401, a 203 or a redirect to a sign-in page, or 403.
    if (res.status === 401 || res.status === 203 || res.status === 403 || (res.status >= 300 && res.status < 400) || res.type === "opaqueredirect") throw new GitFailure("needs_code_read");
    if (res.status === 404) throw new GitFailure("not_found");
    throw new GitFailure("error");
  }

  async function json<T>(t: GitTarget, op: GitOp, repo: string | null, query: Record<string, string>): Promise<T> {
    const res = await send(t, op, repo, query);
    if (!(res.headers.get("content-type") ?? "").includes("application/json")) {
      await res.body?.cancel().catch(() => undefined);
      // A sign-in page answered with 200: the token can't read code.
      throw new GitFailure("needs_code_read");
    }
    try {
      return (await res.json()) as T;
    } catch {
      throw new GitFailure("error");
    }
  }

  /** RB-4: the code search request. The words are in the body only; the log line carries a status and a duration. */
  async function search(t: GitTarget, text: string, top: number): Promise<GitSearchAnswer> {
    const { url, body } = buildSearch(t, text, top);
    try {
      d.limiter?.before(t.clientKey);
    } catch {
      throw new GitFailure("busy");
    }
    const started = performance.now();
    let res: Response;
    try {
      res = await d.fetch(url, { method: "POST", headers: { accept: "application/json", "content-type": "application/json", authorization: t.pat.basicAuth() }, body, redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      d.log({ source: "devops", op: "code_search", kind: "network" });
      throw new GitFailure("unreachable");
    }
    d.log({ source: "devops", op: "code_search", status: res.status, durationMs: performance.now() - started });
    d.limiter?.after(t.clientKey, res.status, res.headers);
    const json = (res.headers.get("content-type") ?? "").includes("application/json");
    if (!res.ok || res.status === 203 || !json) {
      // The body is never read: it could repeat the words.
      await res.body?.cancel().catch(() => undefined);
      if (res.status === 429 || res.status === 503) throw new GitFailure("busy");
      if (res.status === 401 || res.status === 203 || res.status === 403 || (res.status >= 300 && res.status < 400) || res.type === "opaqueredirect" || res.ok) throw new GitFailure("needs_code_read");
      // The documentation doesn't say what an organization without the Code Search extension answers. Not found is
      // read as "no code search here"; a refused request as a search DevOps couldn't run as written.
      if (res.status === 404) throw new GitFailure("no_code_search");
      if (res.status === 400) throw new GitFailure("bad_query");
      throw new GitFailure("error");
    }
    let r: { count?: unknown; infoCode?: unknown; results?: unknown };
    try {
      r = (await res.json()) as typeof r;
    } catch {
      throw new GitFailure("error");
    }
    const hits: GitSearchHit[] = [];
    let listed = 0;
    for (const x of Array.isArray(r.results) ? (r.results as { path?: unknown; repository?: { id?: unknown } | null; versions?: unknown; matches?: { content?: unknown } | null }[]) : []) {
      listed++;
      const repoId = typeof x?.repository?.id === "string" && REPO_ID.test(x.repository.id) ? x.repository.id.toLowerCase() : null;
      const p = cleanPath(x?.path);
      if (!repoId || !p || p === "/") continue;
      const branches = (Array.isArray(x.versions) ? (x.versions as { branchName?: unknown }[]) : []).flatMap((v) => (typeof v?.branchName === "string" && v.branchName ? [branchName(v.branchName)!] : []));
      hits.push({ repoId, path: p, branches, matches: Array.isArray(x.matches?.content) ? x.matches.content.length : null });
    }
    const count = typeof r.count === "number" && Number.isFinite(r.count) && r.count >= 0 ? Math.floor(r.count) : listed;
    return { count: Math.max(count, listed), hits, info: typeof r.infoCode === "number" && Number.isInteger(r.infoCode) ? r.infoCode : 0 };
  }

  const branchQuery = (branch: string) => ({ "versionDescriptor.version": branch, "versionDescriptor.versionType": "branch" });
  const items = (v: { value?: RawItem[] } | null) => (Array.isArray(v?.value) ? v!.value : []);

  return {
    search,
    /** RB-7: a repo's branch heads, A to Z: names only. */
    async branches(t: GitTarget, repo: GitRepo): Promise<GitBranchList> {
      const r = await json<{ value?: { name?: unknown }[] }>(t, "branches", repo.id, { filter: "heads/", $top: String(BRANCHES_MAX) });
      const names = new Set<string>();
      let listed = 0;
      for (const x of Array.isArray(r.value) ? r.value : []) {
        listed++;
        // Only a branch head counts, whatever else an answer might hold; its name is the one thing kept.
        if (typeof x?.name !== "string" || !x.name.startsWith("refs/heads/")) continue;
        const n = x.name.slice("refs/heads/".length);
        if (n && isBranchName(n)) names.add(n);
      }
      return { names: [...names].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }) || (a < b ? -1 : 1)), cut: listed >= BRANCHES_MAX };
    },
    /** The repos in the client's registered project, A to Z. */
    async repos(t: GitTarget): Promise<GitRepo[]> {
      const r = await json<{ value?: { id?: unknown; name?: unknown; defaultBranch?: unknown; isDisabled?: unknown; webUrl?: unknown }[] }>(t, "repos", null, {});
      const list: GitRepo[] = [];
      for (const x of Array.isArray(r.value) ? r.value : []) {
        if (typeof x.id !== "string" || !REPO_ID.test(x.id) || typeof x.name !== "string" || !x.name) continue;
        const web = typeof x.webUrl === "string" && x.webUrl.startsWith("https://dev.azure.com/") ? x.webUrl : null;
        list.push({ id: x.id.toLowerCase(), name: x.name.slice(0, 200), defaultBranch: branchName(typeof x.defaultBranch === "string" ? x.defaultBranch : null), disabled: x.isDisabled === true, webUrl: web });
      }
      return list.sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
    },
    /** One folder's entries on a branch (RB-7; the default branch before), folders first then files, A to Z. */
    async folder(t: GitTarget, repo: GitRepo, path: string, branch: string): Promise<GitFolder> {
      if (!repo.defaultBranch) return { commit: null, entries: [], cut: false };
      const r = await json<{ value?: RawItem[] }>(t, "folder", repo.id, { scopePath: path, recursionLevel: "OneLevel", ...branchQuery(branch) });
      let commit: string | null = null;
      const entries: CodeEntry[] = [];
      for (const it of items(r)) {
        if (typeof it.path !== "string" || it.path === path) {
          if (typeof it.commitId === "string" && COMMIT.test(it.commitId)) commit ??= it.commitId.toLowerCase();
          continue;
        }
        const p = cleanPath(it.path);
        if (!p) continue;
        if (typeof it.commitId === "string" && COMMIT.test(it.commitId)) commit ??= it.commitId.toLowerCase();
        // Submodules ("commit" objects) and anything else that isn't a tree or a blob aren't shown.
        const folder = it.isFolder === true || it.gitObjectType === "tree";
        if (!folder && it.gitObjectType !== undefined && it.gitObjectType !== "blob") continue;
        entries.push({ name: nameOf(p), path: p, folder });
      }
      const sorted = sortEntries(entries);
      return { commit, entries: sorted.slice(0, FOLDER_MAX), cut: sorted.length > FOLDER_MAX };
    },
    /** Every file name in the repo (Find), at most FIND_MAX, kept only in memory. */
    async files(t: GitTarget, repo: GitRepo, branch: string): Promise<GitFileList> {
      if (!repo.defaultBranch) return { commit: null, paths: [], cut: false };
      const r = await json<{ value?: RawItem[] }>(t, "files", repo.id, { scopePath: "/", recursionLevel: "Full", ...branchQuery(branch) });
      let commit: string | null = null;
      const paths: string[] = [];
      let total = 0;
      for (const it of items(r)) {
        if (typeof it.commitId === "string" && COMMIT.test(it.commitId)) commit ??= it.commitId.toLowerCase();
        if (it.isFolder === true || it.gitObjectType === "tree" || (it.gitObjectType !== undefined && it.gitObjectType !== "blob")) continue;
        const p = cleanPath(it.path);
        if (!p || p === "/") continue;
        total++;
        if (paths.length < FIND_MAX) paths.push(p);
      }
      paths.sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
      return { commit, paths, cut: total > FIND_MAX };
    },
    /** A file's commit on a branch (RB-7; the default branch before) and DevOps's content flags; not found for a folder. */
    async fileMeta(t: GitTarget, repo: GitRepo, path: string, branch: string): Promise<GitFileMeta> {
      if (!repo.defaultBranch) throw new GitFailure("not_found");
      const it = await json<RawItem>(t, "file_meta", repo.id, { path, includeContentMetadata: "true", ...branchQuery(branch) });
      if (it.isFolder === true || it.gitObjectType === "tree" || typeof it.commitId !== "string" || !COMMIT.test(it.commitId)) throw new GitFailure("not_found");
      return { commit: it.commitId.toLowerCase(), isBinary: it.contentMetadata?.isBinary === true, isImage: it.contentMetadata?.isImage === true };
    },
    /**
     * A file's bytes at one commit, at most TEXT_MAX_BYTES + 1 (reading stops there), so a larger file is never held
     * whole. A Content-Length over the limit isn't read at all.
     */
    async fileBytes(t: GitTarget, repo: GitRepo, path: string, commit: string): Promise<GitBytes> {
      const res = await send(t, "file_bytes", repo.id, { path, download: "false", "versionDescriptor.version": commit, "versionDescriptor.versionType": "commit" });
      const len = Number(res.headers.get("content-length"));
      const size = Number.isFinite(len) && len >= 0 && res.headers.has("content-length") ? len : null;
      if (size !== null && size > TEXT_MAX_BYTES) {
        await res.body?.cancel().catch(() => undefined);
        return { size, bytes: null };
      }
      const reader = res.body?.getReader();
      if (!reader) return { size: size ?? 0, bytes: new Uint8Array() };
      const chunks: Uint8Array[] = [];
      let n = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          n += value.length;
          if (n > TEXT_MAX_BYTES) {
            await reader.cancel().catch(() => undefined);
            break;
          }
        }
      } catch {
        throw new GitFailure("unreachable");
      }
      const bytes = new Uint8Array(Math.min(n, TEXT_MAX_BYTES + 1));
      let at = 0;
      for (const c of chunks) {
        const take = Math.min(c.length, bytes.length - at);
        bytes.set(c.subarray(0, take), at);
        at += take;
        if (at >= bytes.length) break;
      }
      return { size: size ?? (n > TEXT_MAX_BYTES ? null : n), bytes };
    },
  };
}

export type GitReader = ReturnType<typeof createGitReader>;
