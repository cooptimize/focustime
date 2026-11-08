// KB-1: the synced standards (app tables, no person in them). A new copy replaces the old in one transaction, so a failed
// sync can't leave half a library; a failure only records the error beside the last good copy.
import type { StandardsArticle, StandardsLibrary, StandardsRepo } from "../plan/standards.ts";
import type { Conn, Row } from "./sql/conn.ts";

export type StandardsSyncResult = { ok: boolean; changed: boolean; error: string | null };
export type StandardsWarning = { kind: "duplicate_id"; id: string; paths: string[] } | { kind: "incomplete"; path: string; missing: string[] };
export type StandardsSyncState = { repoUrl: string; branch: string; commit: string | null; syncedAt: string | null; checkedAt: string | null; error: string | null; errorAt: string | null; warnings: StandardsWarning[] };
export type StandardsCopy = { repoUrl: string; branch: string; commit: string; at: string; articles: readonly StandardsArticle[]; warnings: readonly StandardsWarning[] };

export type StandardsStore = {
  state(): Promise<StandardsSyncState | null>;
  articles(): Promise<StandardsArticle[]>;
  /** The active articles with the repo and commit they came from, or null before the first good sync. */
  library(repo: (url: string) => StandardsRepo | null): Promise<StandardsLibrary | null>;
  replace(copy: StandardsCopy): Promise<void>;
  /** A check that found nothing new. */
  checked(repoUrl: string, branch: string, at: string): Promise<void>;
  /** A sync that failed: the last good copy and its time stay. */
  failed(repoUrl: string, branch: string, at: string, error: string): Promise<void>;
};

const iso = (v: unknown) => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v));
const stateOf = (r: Row): StandardsSyncState => ({ repoUrl: String(r.repo_url), branch: String(r.branch), commit: (r.commit_sha as string | null) ?? null, syncedAt: iso(r.synced_at), checkedAt: iso(r.checked_at), error: (r.error as string | null) ?? null, errorAt: iso(r.error_at), warnings: JSON.parse(String(r.warnings)) as StandardsWarning[] });
const articleOf = (r: Row): StandardsArticle => ({ path: String(r.path), id: String(r.article_id), title: String(r.title), domain: String(r.domain), layer: String(r.layer), artifact: String(r.artifact), technology: String(r.technology), status: String(r.status), sha256: String(r.sha256), commit: String(r.commit_sha), body: String(r.body) });

const UPSERT = "INSERT INTO standards_sync (id, repo_url, branch, commit_sha, synced_at, checked_at, error, error_at, warnings) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET repo_url = excluded.repo_url, branch = excluded.branch, commit_sha = excluded.commit_sha, synced_at = excluded.synced_at, checked_at = excluded.checked_at, error = excluded.error, error_at = excluded.error_at, warnings = excluded.warnings";

export function standardsStoreOn(db: Conn): StandardsStore {
  const state = async () => {
    const r = await db.get("SELECT * FROM standards_sync WHERE id = 1");
    return r ? stateOf(r) : null;
  };
  const articles = async () => (await db.all("SELECT * FROM standards_articles ORDER BY path")).map(articleOf);
  /** Keeps the last good copy's commit, time and warnings; only the check fields change. */
  const note = async (repoUrl: string, branch: string, at: string, error: string | null) => {
    const s = await state();
    await db.tx(() => db.run(UPSERT, [repoUrl, branch, s?.commit ?? null, s?.syncedAt ?? null, at, error, error ? at : null, JSON.stringify(s?.warnings ?? [])]));
  };
  return {
    state,
    articles,
    async library(repo) {
      const s = await state();
      const r = s?.commit ? repo(s.repoUrl) : null;
      if (!s?.commit || !r) return null;
      return { repo: r, commit: s.commit, articles: await articles() };
    },
    async replace(c) {
      await db.tx(async () => {
        await db.run("DELETE FROM standards_articles");
        for (const a of c.articles) await db.run("INSERT INTO standards_articles (path, article_id, title, domain, layer, artifact, technology, status, sha256, commit_sha, body) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [a.path, a.id, a.title, a.domain, a.layer, a.artifact, a.technology, a.status, a.sha256, a.commit, a.body]);
        await db.run(UPSERT, [c.repoUrl, c.branch, c.commit, c.at, c.at, null, null, JSON.stringify(c.warnings)]);
      });
    },
    checked: (repoUrl, branch, at) => note(repoUrl, branch, at, null),
    failed: (repoUrl, branch, at, error) => note(repoUrl, branch, at, error.slice(0, 500)),
  };
}
