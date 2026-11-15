// RB-1: Code, every client's repos, read only, for every Cooptimizer. Five reads, each from a person's click (no
// background work): the clients, one client's repos, one folder, Find's file names and one file. The server checks on
// every one of them, before anything is read or looked up in memory:
//   1. I am a Cooptimizer by the people rule (plan/person-match.ts: not a guest, not outside the Cooptimize domains,
//      not an automation account); a signed-out person never gets here (server/app.ts).
//   2. the client is listed: a client account (plan/client-accounts.ts) an admin hasn't hidden.
//   3. the client's Rule "Who can read this client's code" (config/org.ts code_access): Whole company, or Client's team
//      only, which is the client report's check (actions/team-actions.ts reportTeam: an Account Worker or a lead).
//   4. a repo id is one of that client's own repos (its list, read with the client's token); a path is one cleanPath()
//      allows. The organization and project come only from Dataverse.
// RB-2 adds two reads that only sort and search names: code.kinds (By kind) and code.search (Search names) read each
// of one client's repos' file names (the same read Find uses, nothing else) and return its things by kind
// (plan/code-kinds.ts). No file is opened for either. Each request names one client, and the browser matches the words
// itself, so the words typed never reach the server. One row per client ("Listed by kind", "Searched names") is
// written before any name is returned; no row, no names.
// RB-4: both also carry the paths of the files inside items that are no thing of their own (plan/code-kinds.ts), so a
// search for a file's own name finds any file the tree shows.
// RB-4 adds code.inside (Search inside files): it asks DevOps's own code search which files of one client's project
// hold the words (sources/devops/git.ts search). FocusTime reads no file for it: the answer is file paths and match
// counts, and each file's kind comes from the same file names By kind reads. The words pass through here to DevOps
// and are never stored, logged, put in an error or the view log, or returned. One row ("Searched inside files", no
// repo, no path, no words) is written before DevOps is asked; no row, no search. No text of a file is returned: a
// file is shown only when a person opens it (code.file), logged as a file open.
// Repo opened (its top folder), File opened and Find used are written to the view log (code_views) with who, when, the
// client, the repo and the path, never content; a file's row is written before its text is returned, and if it can't
// be written the text isn't returned. This is the one deliberate exception to "one client's data never shows outside
// that client" (the product owner, Nov 12): it covers code read here and nothing else. Code never goes to an AI, the
// assistant or the Teams bot (none of these actions is in assistant/allowlist.ts), and nothing here is logged but the
// action's name and outcome (server/app.ts).
import type { ActionResponse } from "./types.ts";
import { CodeFailure, type CodeFailureReason, type CodeGit } from "./code-git.ts";
import type { GitRepo } from "../sources/devops/git.ts";
import type { CodeViewInput } from "../store/code-views-store.ts";
import { cleanPath, FIND_MAX, INSIDE_MAX, INSIDE_WORDS_MAX, NAMES_REPOS_AT_ONCE, REPO_ID, sizeWords, TEXT_MAX_BYTES, type CodeAccess, type CodeFileView, type CodeRepoView } from "../plan/code.ts";
import { fileLabels, KIND_EXT, KINDS, sortRepo, type InsideAnswer, type InsideFile, type Kind, type RepoThings } from "../plan/code-kinds.ts";
export type { CodeFileView, CodeRepoView } from "../plan/code.ts";

export const CODE_ACTIONS = ["code.clients", "code.repos", "code.folder", "code.find", "code.file", "code.kinds", "code.search", "code.inside"] as const;
export type CodeAction = (typeof CODE_ACTIONS)[number];

/** Why someone isn't let in at all (step 1). */
export type CodeRefusal = "guest" | "domain" | "automation" | "signed_out" | "unknown";

/** RB-2: one repo of a client as By kind and Search names get it: its things, or one line saying why there are none. */
export type CodeRepoThings = RepoThings;

/** RB-4: one client's answer to a search inside files (plan/code-kinds.ts InsideAnswer), with the client. */
export type CodeInsideFile = InsideFile;
export type CodeInsideAnswer = InsideAnswer & { client: CodeClientRef };

export type CodeClientRef = { clientKey: string; name: string; color: string | null };

export type CodeContext = {
  /** The signed-in person (Entra object id and name), or null. */
  me: () => Promise<{ id: string; name: string } | null>;
  /** Null for a Cooptimizer; otherwise why not. Throws when who I am can't be read (then nobody is let in). */
  notCooptimizer: () => Promise<Exclude<CodeRefusal, "signed_out" | "unknown"> | null>;
  /** The listed clients: client accounts an admin hasn't hidden, with their names and team colors. */
  clients: () => Promise<CodeClientRef[]>;
  /** A client's Rule (Whole company by default). */
  rule: (clientKey: string) => Promise<CodeAccess>;
  /** The clients I'm on, and the client report's team check. */
  team: () => Promise<{ myClients: readonly string[]; onClient: (clientKey: string) => boolean }>;
  /** Null: code can't be read here (no Dataverse, so no DevOps). */
  git: CodeGit | null;
  /** The view log. Null: nothing can be opened (a file is never shown without its row). */
  views: { add: (v: CodeViewInput) => Promise<void> } | null;
};

export const CODE_TEXT = {
  notCooptimizer: "Code is for Cooptimizers. This account isn't one, so it can't open any client's code.",
  unknown: "FocusTime can't tell whether this account is a Cooptimizer right now, so Code stays closed. Try again in a moment.",
  noClient: "That client isn't in FocusTime.",
  teamOnly: (name: string) => `Only ${name}'s team can open this.`,
  needsCodeRead: (name: string) => `FocusTime can't read ${name}'s code yet. The company DevOps token for ${name} needs Code (read).`,
  noToken: (name: string) => `FocusTime can't read ${name}'s code yet. There's no company DevOps token for ${name} in Dataverse.`,
  noDevops: (name: string) => `${name} has no DevOps set up in Dataverse, so there's no code to show.`,
  busy: "DevOps is busy. Try again in a moment.",
  unreachable: (name: string) => `${name}'s DevOps can't be reached right now. Try again in a moment.`,
  notFound: "That isn't there any more. It may have been moved or deleted.",
  noRepo: "That repo isn't one of this client's.",
  badPath: "That isn't a path in the repo.",
  error: (name: string) => `${name}'s code couldn't be read. Try again in a moment.`,
  notLogged: "The file wasn't opened because FocusTime couldn't record that you opened it. Try again in a moment.",
  namesNotLogged: "The names weren't read because FocusTime couldn't record that you read them. Try again in a moment.",
  notHere: "Code isn't available here.",
  // RB-6: one line, at the foot of every Code screen where a file can be opened or a search run.
  logLine: "FocusTime admins can see who opened, listed or searched which client's code, and when. Never the words.",
  noCodeSearch: (name: string) => `${name}'s DevOps doesn't have code search turned on, so FocusTime can't search inside its files. An administrator of that DevOps organization can add Microsoft's Code Search extension to it.`,
  indexing: (name: string) => `DevOps is still indexing ${name}'s code, so there is nothing to search yet. Try again later.`,
  badQuery: "DevOps couldn't run that search as written. Check the quotes and brackets, and put a * only at the end of a word.",
  badWords: "Type what to look for, up to 200 characters.",
  insideNotLogged: "The search wasn't run because FocusTime couldn't record that you searched. Try again in a moment.",
} as const;

const bad = (error: string, status = 400, code?: string): ActionResponse => ({ ok: false, status, error, ...(code ? { code } : {}) });
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const extraKey = (i: Record<string, unknown>, keys: readonly string[]) => Object.keys(i).find((k) => !keys.includes(k)) ?? null;

/** A read's failure in plain words, with the reason as the code the UI shows its state by. */
function failure(reason: CodeFailureReason, name: string): ActionResponse {
  switch (reason) {
    case "needs_code_read":
      return bad(CODE_TEXT.needsCodeRead(name), 409, "needs_code_read");
    case "no_token":
      return bad(CODE_TEXT.noToken(name), 409, "no_token");
    case "no_devops":
      return bad(CODE_TEXT.noDevops(name), 409, "no_devops");
    case "busy":
      return bad(CODE_TEXT.busy, 503, "busy");
    case "unreachable":
      return bad(CODE_TEXT.unreachable(name), 503, "unreachable");
    case "not_found":
      return bad(CODE_TEXT.notFound, 404, "not_found");
    case "no_code_search":
      return bad(CODE_TEXT.noCodeSearch(name), 409, "no_code_search");
    case "bad_query":
      return bad(CODE_TEXT.badQuery, 400, "bad_query");
    case "error":
      return bad(CODE_TEXT.error(name), 502, "error");
  }
}

/** RB-4: the words can sit inside brackets without changing what they mean: quotes and brackets close. */
function balanced(q: string): boolean {
  let depth = 0;
  let quoted = false;
  for (let n = 0; n < q.length; n++) {
    const c = q[n];
    if (c === "\\" && quoted) n++;
    else if (c === '"') quoted = !quoted;
    else if (!quoted && c === "(") depth++;
    else if (!quoted && c === ")" && --depth < 0) return false;
  }
  return depth === 0 && !quoted;
}

const repoView = (r: GitRepo): CodeRepoView => ({ id: r.id, name: r.name, defaultBranch: r.defaultBranch, state: r.disabled ? "disabled" : r.defaultBranch ? "ok" : "empty" });


/** The file's page in DevOps on the default branch (Copy DevOps link). */
export function devopsLink(repo: GitRepo, path: string): string | null {
  if (!repo.webUrl || !repo.defaultBranch) return null;
  const u = new URL(repo.webUrl);
  u.search = new URLSearchParams({ path, version: `GB${repo.defaultBranch}` }).toString();
  return u.toString();
}

export async function codeAction(ctx: CodeContext, action: CodeAction, input: unknown): Promise<ActionResponse> {
  const i = obj(input ?? {});
  if (!i) return bad("input must be an object");
  const allowedKeys: Record<CodeAction, readonly string[]> = { "code.clients": [], "code.repos": ["clientKey"], "code.folder": ["clientKey", "repoId", "path"], "code.find": ["clientKey", "repoId"], "code.file": ["clientKey", "repoId", "path"], "code.kinds": ["clientKey"], "code.search": ["clientKey"], "code.inside": ["clientKey", "words", "kind"] };
  const extra = extraKey(i, allowedKeys[action]);
  if (extra) return bad(`unknown input field ${extra}`);

  // Where code can't be read at all (no code source wired in), the list is empty before anything else is asked.
  if (action === "code.clients" && !ctx.git) return { ok: true, data: { clients: [], available: false, logLine: CODE_TEXT.logLine } };

  // 1. A Cooptimizer, on every request.
  const me = await ctx.me().catch(() => null);
  if (!me) return bad(CODE_TEXT.notCooptimizer, 403, "signed_out");
  let why: Awaited<ReturnType<CodeContext["notCooptimizer"]>>;
  try {
    why = await ctx.notCooptimizer();
  } catch {
    return bad(CODE_TEXT.unknown, 503, "unknown");
  }
  if (why) return bad(CODE_TEXT.notCooptimizer, 403, why);

  let listed: CodeClientRef[];
  let team: Awaited<ReturnType<CodeContext["team"]>>;
  try {
    [listed, team] = await Promise.all([ctx.clients(), ctx.team()]);
  } catch {
    return bad(CODE_TEXT.unknown, 503, "unknown");
  }
  const mine = new Set(team.myClients.map((k) => k.toLowerCase()));
  const open = async (k: string) => (await ctx.rule(k)) === "company" || team.onClient(k);

  if (action === "code.clients") {
    const rows = await Promise.all(listed.map(async (c) => ({ ...c, mine: mine.has(c.clientKey.toLowerCase()), locked: !(await open(c.clientKey)) })));
    // D3: the clients I'm on first, then the rest, A to Z.
    rows.sort((a, b) => (a.mine !== b.mine ? (a.mine ? -1 : 1) : a.name.localeCompare(b.name, "en", { sensitivity: "base" })));
    return { ok: true, data: { clients: rows, available: !!ctx.git, logLine: CODE_TEXT.logLine } };
  }

  // 2. The client is listed (never hidden), by its key; 3. its Rule.
  if (typeof i.clientKey !== "string" || !i.clientKey || i.clientKey.length > 100) return bad("clientKey names the client");
  const client = listed.find((c) => c.clientKey === i.clientKey);
  if (!client) return bad(CODE_TEXT.noClient, 404, "no_client");
  if (!(await open(client.clientKey))) return bad(CODE_TEXT.teamOnly(client.name), 403, "team_only");
  if (!ctx.git) return bad(CODE_TEXT.notHere, 404, "not_here");

  // RB-4: Search inside files. What was typed is checked, then the row is written, before anything is asked of this
  // client's DevOps (its repo list included). Never the words.
  if (action === "code.inside") {
    // eslint-disable-next-line no-control-regex
    if (typeof i.words !== "string" || !i.words.trim() || i.words.length > INSIDE_WORDS_MAX || /[\u0000-\u001f\u007f]/.test(i.words)) return bad(CODE_TEXT.badWords, 400, "bad_words");
    if (i.kind !== undefined && i.kind !== null && !(KINDS as readonly unknown[]).includes(i.kind)) return bad("kind is one of the kinds", 400, "bad_kind");
    try {
      if (!ctx.views) throw new Error("no view log");
      await ctx.views.add({ actorId: me.id, actorName: me.name, clientKey: client.clientKey, repoId: "", repoName: "", path: "", event: "inside_searched" });
    } catch {
      return bad(CODE_TEXT.insideNotLogged, 503, "not_logged");
    }
  }

  // 4. The client's own repos (the list is read with its token; the memory holds it 5 minutes).
  let repos: GitRepo[];
  try {
    repos = await ctx.git.repos(client.clientKey);
  } catch (e) {
    return failure(e instanceof CodeFailure ? e.reason : "error", client.name);
  }
  if (action === "code.repos") return { ok: true, data: { client, repos: repos.map(repoView) } };

  // RB-2: By kind and Search names. Each repo's file names (the read Find uses), a few repos at a time, sorted into
  // things by name alone. A repo that can't be read says so in its own line and the rest still list.
  if (action === "code.kinds" || action === "code.search") {
    const git = ctx.git;
    const out: CodeRepoThings[] = new Array(repos.length);
    let read = false;
    let next = 0;
    const worker = async () => {
      for (let n = next++; n < repos.length; n = next++) {
        const r = repos[n]!;
        const v = repoView(r);
        if (v.state !== "ok") {
          out[n] = { repo: v, things: [], files: [], cut: false, problem: null };
          continue;
        }
        try {
          const f = await git.files(client.clientKey, r);
          read = true;
          out[n] = { repo: v, ...sortRepo(f.paths), cut: f.cut, problem: null };
        } catch (e) {
          const f = failure(e instanceof CodeFailure ? e.reason : "error", client.name);
          out[n] = { repo: v, things: [], files: [], cut: false, problem: f.ok ? null : f.error };
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(NAMES_REPOS_AT_ONCE, repos.length) }, worker));
    // The row first: one per client whose names were read, with no repo, no path and none of the words typed.
    if (read) {
      try {
        if (!ctx.views) throw new Error("no view log");
        await ctx.views.add({ actorId: me.id, actorName: me.name, clientKey: client.clientKey, repoId: "", repoName: "", path: "", event: action === "code.kinds" ? "kinds_listed" : "names_searched" });
      } catch {
        return bad(CODE_TEXT.namesNotLogged, 503, "not_logged");
      }
    }
    return { ok: true, data: { client, repos: out, max: FIND_MAX } };
  }

  // RB-4: Search inside files. DevOps's own code search is asked which files hold the words; no file is read.
  if (action === "code.inside") {
    const git = ctx.git;
    const words = (i.words as string).trim();
    const kind = (i.kind ?? null) as Kind | null;
    try {
      let answer = await git.search(client.clientKey, words, INSIDE_MAX);
      // Codes from the documentation: 3 invalid request, 4 a wildcard at the start of a word, 5, 19 and 20 a mix
      // code search doesn't take; 2 and 6 indexing hasn't started; 1, 7 and 9 indexing is under way.
      if ([3, 4, 5, 19, 20].includes(answer.info)) return failure("bad_query", client.name);
      const indexing = [1, 2, 6, 7, 9].includes(answer.info);
      if (indexing && !answer.hits.length) return bad(CODE_TEXT.indexing(client.name), 409, "indexing");
      // More files than one answer holds, and a kind DevOps can narrow by file type: ask it to, so the limit isn't
      // spent on files the kind would hide. Only its documented form, and only when the words can sit in brackets.
      const ext = kind ? KIND_EXT[kind] : undefined;
      let narrowed = false;
      if (ext && answer.count > answer.hits.length && balanced(words)) {
        // If DevOps is busy or doesn't take this form, the first answer stands.
        const again = await git.search(client.clientKey, `(${words}) ext:${ext}`, INSIDE_MAX).catch(() => null);
        if (again && (again.info === 0 || again.info === 8)) (answer = again), (narrowed = true);
      }
      const byId = new Map(repos.filter((r) => !r.disabled && r.defaultBranch).map((r) => [r.id, r]));
      // Only this client's own repos, and only a file DevOps says is on its repo's default branch. The rest are
      // counted, so the screen can say some files aren't listed, never named.
      const kept = answer.hits.filter((h) => {
        const r = byId.get(h.repoId);
        return !!r && h.branches.includes(r.defaultBranch!);
      });
      // What each file is, from its repo's file names (the read By kind uses, from memory when it is there). A repo
      // whose names can't be read still lists its files, each sorted by its own path alone.
      const labels = new Map<string, ReturnType<typeof fileLabels>>();
      const wanted = [...new Set(kept.map((h) => h.repoId))];
      let next = 0;
      const worker = async () => {
        for (let n = next++; n < wanted.length; n = next++) {
          const id = wanted[n]!;
          const own = kept.filter((h) => h.repoId === id).map((h) => h.path);
          try {
            labels.set(id, fileLabels([...new Set([...(await git.files(client.clientKey, byId.get(id)!)).paths, ...own])]));
          } catch {
            labels.set(id, fileLabels(own));
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(NAMES_REPOS_AT_ONCE, wanted.length) }, worker));
      const files: CodeInsideFile[] = kept.map((h) => {
        const l: { kind: Kind; detail: string; itemKind?: Kind } = labels.get(h.repoId)?.get(h.path) ?? { kind: "other", detail: "File" };
        return { repoId: h.repoId, repoName: byId.get(h.repoId)!.name, path: h.path, kind: l.kind, detail: l.detail, matches: h.matches, ...(l.itemKind ? { itemKind: l.itemKind } : {}) };
      });
      const data: CodeInsideAnswer = { client, files, total: answer.count, more: answer.count > answer.hits.length || answer.info === 8, indexing, narrowed, notListed: answer.hits.length - kept.length };
      return { ok: true, data };
    } catch (e) {
      // A fixed phrase by reason: an error's own message is never passed on (it could hold the words).
      return failure(e instanceof CodeFailure ? e.reason : "error", client.name);
    }
  }

  if (typeof i.repoId !== "string" || !REPO_ID.test(i.repoId)) return bad(CODE_TEXT.noRepo, 404, "no_repo");
  const repo = repos.find((r) => r.id === (i.repoId as string).toLowerCase());
  if (!repo) return bad(CODE_TEXT.noRepo, 404, "no_repo");
  const view = repoView(repo);
  const log = async (event: CodeViewInput["event"], path: string) => {
    if (!ctx.views) throw new Error("no view log");
    await ctx.views.add({ actorId: me.id, actorName: me.name, clientKey: client.clientKey, repoId: repo.id, repoName: repo.name, path, event });
  };

  try {
    if (action === "code.find") {
      if (view.state !== "ok") return { ok: true, data: { repo: view, paths: [], cut: false, max: FIND_MAX } };
      const f = await ctx.git.files(client.clientKey, repo);
      try {
        await log("find_used", "/");
      } catch {
        return bad(CODE_TEXT.notLogged, 503, "not_logged");
      }
      return { ok: true, data: { repo: view, paths: f.paths, cut: f.cut, max: FIND_MAX } };
    }
    const path = cleanPath(i.path);
    if (!path) return bad(CODE_TEXT.badPath, 400, "bad_path");
    if (action === "code.folder") {
      if (view.state !== "ok") return { ok: true, data: { repo: view, path, entries: [], cut: false } };
      const f = await ctx.git.folder(client.clientKey, repo, path);
      // The repo's top folder is "Repo opened"; other folders aren't logged.
      if (path === "/") {
        try {
          await log("repo_opened", "/");
        } catch {
          return bad(CODE_TEXT.notLogged, 503, "not_logged");
        }
      }
      return { ok: true, data: { repo: view, path, entries: f.entries, cut: f.cut } };
    }
    // code.file
    if (view.state !== "ok" || path === "/") return failure("not_found", client.name);
    const f = await ctx.git.file(client.clientKey, repo, path);
    // C2: the row first; without it, no text.
    try {
      await log("file_opened", path);
    } catch {
      return bad(CODE_TEXT.notLogged, 503, "not_logged");
    }
    const out: CodeFileView = { path, size: f.size, sizeText: f.kind === "too_large" && f.size === null ? `over ${sizeWords(TEXT_MAX_BYTES)}` : sizeWords(f.size), kind: f.kind, text: f.kind === "text" || f.kind === "lfs" ? f.text : null, devopsUrl: devopsLink(repo, path) };
    return { ok: true, data: { repo: view, file: out } };
  } catch (e) {
    return failure(e instanceof CodeFailure ? e.reason : "error", client.name);
  }
}

/** E1: Admin › Clients' status line for one client's code, from its repo list (checked on open or Check, never on a schedule). */
export type CodeStatus = { state: "readable"; repos: number } | { state: "needs_code_read" | "no_token" | "no_devops" | "error"; text: string };
export async function codeStatus(git: CodeGit | null, clientKey: string, name: string): Promise<CodeStatus> {
  if (!git) return { state: "error", text: CODE_TEXT.notHere };
  try {
    const repos = await git.repos(clientKey);
    return { state: "readable", repos: repos.length };
  } catch (e) {
    const reason = e instanceof CodeFailure ? e.reason : "error";
    if (reason === "needs_code_read") return { state: "needs_code_read", text: "Can't read yet: the token needs Code (read)" };
    if (reason === "no_token") return { state: "no_token", text: "Can't read yet: there's no company DevOps token in Dataverse" };
    if (reason === "no_devops") return { state: "no_devops", text: "No DevOps set up" };
    const f = failure(reason, name);
    return { state: "error", text: f.ok ? "" : f.error };
  }
}
