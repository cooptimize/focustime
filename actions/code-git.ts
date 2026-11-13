// RB-1: a client's code as the Code actions read it (CodeGit), for a real session: the Git reader over the company
// read PAT, read from Dataverse (the app's own access, accountTargets) at fetch time for each read that needs DevOps
// and dropped after it, never kept here. The demo has its own CodeGit (sources/demo/code.ts), wired only by
// server/demo.ts.
//
// Folder lists, file names (Find) and file text may sit in this process's memory for at most CODE_MEMORY_MS (5
// minutes), keyed by client, repo, commit and path, never on disk, in the store or in a log. Only the actions reach
// this, and only after their access check on every request (actions/code-actions.ts), so the memory is never looked at
// for someone who may not read the client.
import type { TargetsResult } from "../sources/devops/types.ts";
import { GitFailure, type GitFailureReason, type GitFileList, type GitFolder, type GitReader, type GitRepo, type GitTarget } from "../sources/devops/git.ts";
import { CODE_MEMORY_MS, decodeText, fileKind, nameOf, type FileKind } from "../plan/code.ts";

export type CodeFailureReason = GitFailureReason | "no_devops" | "no_token";
/** A read that failed, with a reason the actions turn into plain words. Never a path, a repo name or a token. */
export class CodeFailure extends Error {
  readonly reason: CodeFailureReason;
  constructor(reason: CodeFailureReason) {
    super(`code read failed: ${reason}`);
    this.reason = reason;
  }
}

export type CodeFile = { path: string; commit: string | null; size: number | null; kind: FileKind; /** Only for text and LFS pointers. */ text: string | null };

/** What the Code actions read for one client. Every method throws CodeFailure. */
export type CodeGit = {
  repos(clientKey: string): Promise<GitRepo[]>;
  folder(clientKey: string, repo: GitRepo, path: string): Promise<GitFolder>;
  files(clientKey: string, repo: GitRepo): Promise<GitFileList>;
  file(clientKey: string, repo: GitRepo, path: string): Promise<CodeFile>;
};

/** At most this many entries, and about this many characters, sit in memory at once (oldest out first). */
const MAX_ENTRIES = 500;
const MAX_CHARS = 40 * 1024 * 1024;

export type CodeMemory = ReturnType<typeof codeMemory>;
/** The 5-minute memory: a plain map with an age and a size cap. Exported for the tests. */
export function codeMemory(now: () => number, ttl = CODE_MEMORY_MS) {
  const m = new Map<string, { at: number; value: unknown; chars: number }>();
  let chars = 0;
  const drop = (k: string) => {
    const e = m.get(k);
    if (e) chars -= e.chars;
    m.delete(k);
  };
  return {
    get<T>(k: string): T | undefined {
      const e = m.get(k);
      if (!e) return undefined;
      if (now() - e.at >= ttl) {
        drop(k);
        return undefined;
      }
      return e.value as T;
    },
    set(k: string, value: unknown, size: number) {
      drop(k);
      m.set(k, { at: now(), value, chars: size });
      chars += size;
      for (const old of m.keys()) {
        if (m.size <= MAX_ENTRIES && chars <= MAX_CHARS) break;
        drop(old);
      }
    },
    size: () => m.size,
    clear: () => {
      m.clear();
      chars = 0;
    },
  };
}

export type CodeGitDeps = {
  reader: GitReader;
  /** Each client's DevOps settings with the company read PAT, from Dataverse at fetch time (accountTargets). */
  targets: (clientKeys: string[]) => Promise<TargetsResult>;
  now?: () => number;
};

export function createCodeGit(d: CodeGitDeps): CodeGit {
  const now = d.now ?? Date.now;
  const memory = codeMemory(now);
  /** The newest commit seen on a repo's default branch, so a folder or file can be found by commit. */
  const heads = codeMemory(now);
  const key = (...parts: string[]) => parts.join("\u0000");

  async function target(clientKey: string): Promise<GitTarget> {
    const r = await d.targets([clientKey]).catch((): TargetsResult => ({ ok: false, message: "Dataverse read failed" }));
    if (!r.ok) throw new CodeFailure("unreachable");
    const t = r.targets.find((x) => x.clientKey === clientKey);
    if (!t || !t.org || !t.project) throw new CodeFailure("no_devops");
    if (t.problem) throw new CodeFailure("error");
    if (!t.pat) throw new CodeFailure("no_token");
    return { clientKey, org: t.org, project: t.project, pat: t.pat };
  }
  async function read<T>(f: () => Promise<T>): Promise<T> {
    try {
      return await f();
    } catch (e) {
      if (e instanceof CodeFailure) throw e;
      if (e instanceof GitFailure) throw new CodeFailure(e.reason);
      throw new CodeFailure("error");
    }
  }
  const head = (clientKey: string, repo: GitRepo) => heads.get<string>(key(clientKey, repo.id));
  const seen = (clientKey: string, repo: GitRepo, commit: string | null) => commit && heads.set(key(clientKey, repo.id), commit, 1);

  return {
    repos: (clientKey) =>
      read(async () => {
        const k = key("repos", clientKey);
        const hit = memory.get<GitRepo[]>(k);
        if (hit) return hit;
        const list = await d.reader.repos(await target(clientKey));
        memory.set(k, list, list.length * 100);
        return list;
      }),
    folder: (clientKey, repo, path) =>
      read(async () => {
        const h = head(clientKey, repo);
        const hit = h ? memory.get<GitFolder>(key("folder", clientKey, repo.id, h, path)) : undefined;
        if (hit) return hit;
        const f = await d.reader.folder(await target(clientKey), repo, path);
        seen(clientKey, repo, f.commit);
        if (f.commit) memory.set(key("folder", clientKey, repo.id, f.commit, path), f, f.entries.reduce((n, e) => n + e.path.length, 0));
        return f;
      }),
    files: (clientKey, repo) =>
      read(async () => {
        const h = head(clientKey, repo);
        const hit = h ? memory.get<GitFileList>(key("files", clientKey, repo.id, h)) : undefined;
        if (hit) return hit;
        const f = await d.reader.files(await target(clientKey), repo);
        seen(clientKey, repo, f.commit);
        if (f.commit) memory.set(key("files", clientKey, repo.id, f.commit), f, f.paths.reduce((n, p) => n + p.length, 0));
        return f;
      }),
    file: (clientKey, repo, path) =>
      read(async () => {
        const h = head(clientKey, repo);
        const early = h ? memory.get<CodeFile>(key("file", clientKey, repo.id, h, path)) : undefined;
        if (early) return early;
        const t = await target(clientKey);
        const meta = await d.reader.fileMeta(t, repo, path);
        seen(clientKey, repo, meta.commit);
        const k = key("file", clientKey, repo.id, meta.commit, path);
        const hit = memory.get<CodeFile>(k);
        if (hit) return hit;
        const b = await d.reader.fileBytes(t, repo, path, meta.commit);
        const kind = fileKind({ name: nameOf(path), size: b.size, bytes: b.bytes, isBinary: meta.isBinary, isImage: meta.isImage });
        const text = (kind === "text" || kind === "lfs") && b.bytes ? decodeText(b.bytes) : null;
        const file: CodeFile = { path, commit: meta.commit, size: b.size, kind, text };
        memory.set(k, file, (text?.length ?? 0) + path.length);
        return file;
      }),
  };
}
