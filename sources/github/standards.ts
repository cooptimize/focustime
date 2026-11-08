// KB-1: reading Cooptimize's standards repo from GitHub. Read only and anonymous: every request is a GET with no
// credentials, to api.github.com (the commit and the file list) or raw.githubusercontent.com (a Markdown file at that
// commit). URLs are built only from the validated owner, repo and branch. Only paths that can be articles are fetched, so
// scripts, hooks and the retired files are never even downloaded; what comes back is kept as text and never run.
import { articleVerdict, duplicateIds, isArticlePath, MAX_ARTICLE_BYTES, MAX_REPO_FILES, type StandardsArticle, type StandardsRepo } from "../../plan/standards.ts";

export class StandardsReadError extends Error {}

export type StandardsRead =
  | { changed: false; commit: string }
  | { changed: true; commit: string; branch: string; articles: StandardsArticle[]; incomplete: { path: string; missing: string[] }[]; duplicates: { id: string; paths: string[] }[] };

export type StandardsReader = { read(repo: StandardsRepo, branch: string, knownCommit: string | null): Promise<StandardsRead> };

const API = "https://api.github.com";
const RAW = "https://raw.githubusercontent.com";
const encodePath = (p: string) => p.split("/").map(encodeURIComponent).join("/");

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function createStandardsReader(d: { fetch: typeof fetch; timeoutMs?: number }): StandardsReader {
  const timeoutMs = d.timeoutMs ?? 20_000;
  async function get(url: string, accept: string): Promise<Response> {
    let res: Response;
    try {
      // GET, no Authorization header, no cookies: the repo is public and FocusTime only reads it.
      res = await d.fetch(url, { method: "GET", headers: { Accept: accept, "User-Agent": "FocusTime-standards-sync" }, credentials: "omit", redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      throw new StandardsReadError("GitHub couldn't be reached");
    }
    if (res.status === 404) throw new StandardsReadError("GitHub says the repo or branch isn't there");
    if (res.status === 403 || res.status === 429) throw new StandardsReadError("GitHub's limit for anonymous reads was reached. It'll try again next hour");
    if (!res.ok) throw new StandardsReadError(`GitHub answered ${res.status}`);
    return res;
  }
  const json = async <T>(url: string): Promise<T> => {
    try {
      return (await (await get(url, "application/vnd.github+json")).json()) as T;
    } catch (e) {
      throw e instanceof StandardsReadError ? e : new StandardsReadError("GitHub's answer couldn't be read");
    }
  };
  return {
    async read(repo, wanted, knownCommit) {
      const base = `${API}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}`;
      const branch = wanted || (await json<{ default_branch: string }>(base)).default_branch;
      if (!branch) throw new StandardsReadError("GitHub didn't say which branch is the default");
      const head = await json<{ sha: string; commit: { tree: { sha: string } } }>(`${base}/commits/${encodePath(branch)}`);
      if (!/^[0-9a-f]{40}$/.test(head.sha ?? "")) throw new StandardsReadError("GitHub's answer couldn't be read");
      if (head.sha === knownCommit) return { changed: false, commit: head.sha };
      const tree = await json<{ tree: { path: string; type: string }[]; truncated?: boolean }>(`${base}/git/trees/${head.commit.tree.sha}?recursive=1`);
      if (tree.truncated) throw new StandardsReadError("The repo is too big to read");
      const paths = tree.tree.filter((t) => t.type === "blob" && isArticlePath(t.path)).map((t) => t.path);
      if (paths.length > MAX_REPO_FILES) throw new StandardsReadError(`The repo has more than ${MAX_REPO_FILES} Markdown files`);
      const articles: StandardsArticle[] = [];
      const incomplete: { path: string; missing: string[] }[] = [];
      for (const path of paths) {
        const res = await get(`${RAW}/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/${head.sha}/${encodePath(path)}`, "text/plain");
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (bytes.length > MAX_ARTICLE_BYTES) throw new StandardsReadError(`${path} is bigger than ${MAX_ARTICLE_BYTES / 1000} KB`);
        const v = articleVerdict(new TextDecoder().decode(bytes));
        if (v.kind === "incomplete") incomplete.push({ path, missing: v.missing });
        if (v.kind === "active") articles.push({ ...v.fields, path, sha256: await sha256(bytes), commit: head.sha, body: v.body });
      }
      if (!articles.length) throw new StandardsReadError("No active articles were found, so the last good copy is kept");
      return { changed: true, commit: head.sha, branch, articles, incomplete, duplicates: duplicateIds(articles) };
    },
  };
}
