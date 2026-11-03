// F1: Send feedback's DevOps calls, as the app's managed identity (a bearer token from the host's credential; never
// logged, kept or returned). One org and project, set in the app settings. Calls (Azure DevOps REST 7.1, checked on
// Microsoft Learn Nov 3, 2026): read the parent feature with its relations, the process configuration (the requirement
// backlog's story type), the project (its default team) and that team's settings (the default iteration), create a
// work item with its parent link in the same JSON Patch (validateOnly for the setup check), and read it back. Nothing
// is ever updated or deleted. Logs carry op, status and duration only.
import type { Logger } from "../../log/logger.ts";
import { PARENT_REL, textToHtml, validOrg, WIT_API } from "../../plan/devopswrite.ts";
import type { FeedbackPayload } from "../../plan/feedback.ts";

export type FeedbackFailureKind = "auth" | "forbidden" | "not_found" | "rejected" | "network" | "error";
export class FeedbackFailure extends Error {
  readonly kind: FeedbackFailureKind;
  readonly status: number | null;
  constructor(kind: FeedbackFailureKind, message: string, status: number | null = null) {
    super(message);
    this.name = "FeedbackFailure";
    this.kind = kind;
    this.status = status;
  }
}

/** Where feedback goes (app settings). */
export type FeedbackTarget = { org: string; project: string; parentId: number };
export type ParentItem = { id: number; type: string; title: string; areaPath: string; project: string };
export type CreatedItem = { id: number; rev: number; title: string; type: string; parentId: number | null; url: string };

/** The Azure DevOps resource, as the managed identity page on Learn names it. */
export const DEVOPS_SCOPE = "https://app.vssps.visualstudio.com/.default";
const PROJECT = /^[^\\/:*?"<>|;#$%{}+=[\]]{1,64}$/;
export const validTarget = (t: FeedbackTarget) => validOrg(t.org) && PROJECT.test(t.project) && Number.isSafeInteger(t.parentId) && t.parentId > 0;
export const itemWebUrl = (t: FeedbackTarget, id: number) => `https://dev.azure.com/${t.org}/${encodeURIComponent(t.project)}/_workitems/edit/${id}`;

type RawItem = { id?: unknown; rev?: unknown; fields?: Record<string, unknown>; relations?: { rel?: unknown; url?: unknown }[] };

export function createFeedbackDevOps(d: { fetch: typeof fetch; log: Logger; token: () => Promise<string>; target: FeedbackTarget; timeoutMs?: number }) {
  const t = d.target;
  if (!validTarget(t)) throw new Error("Not a valid feedback target");
  const base = `https://dev.azure.com/${t.org}`;
  const proj = encodeURIComponent(t.project);
  const timeoutMs = d.timeoutMs ?? 20_000;

  async function req<T>(op: string, method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    let token: string;
    try {
      token = await d.token();
    } catch {
      d.log({ source: "devops", op: `feedback_${op}`, kind: "no_token" });
      throw new FeedbackFailure("auth", "FocusTime couldn't get its sign-in for DevOps");
    }
    const url = `${base}/${path}${path.includes("?") ? "&" : "?"}api-version=${WIT_API}`;
    const started = performance.now();
    let res: Response;
    try {
      res = await d.fetch(url, {
        method,
        headers: { accept: "application/json", authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json-patch+json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      d.log({ source: "devops", op: `feedback_${op}`, kind: "network" });
      throw new FeedbackFailure("network", "DevOps didn't answer");
    }
    d.log({ source: "devops", op: `feedback_${op}`, status: res.status, durationMs: performance.now() - started });
    if (res.status === 401 || res.status === 203 || (res.status >= 300 && res.status < 400) || res.type === "opaqueredirect")
      throw new FeedbackFailure("auth", "DevOps didn't accept FocusTime's sign-in. Its identity may not be added to the organization yet", res.status);
    if (res.status === 403) throw new FeedbackFailure("forbidden", "DevOps refused: FocusTime's identity can't create stories in this project", 403);
    if (res.status === 404) throw new FeedbackFailure("not_found", "Not found in DevOps", 404);
    if (!res.ok) throw new FeedbackFailure(res.status === 400 ? "rejected" : "error", `DevOps refused it (HTTP ${res.status})`, res.status);
    if (!(res.headers.get("content-type") ?? "").includes("application/json")) throw new FeedbackFailure("auth", "DevOps didn't accept FocusTime's sign-in", res.status);
    return (await res.json()) as T;
  }

  const parentOf = (r: RawItem): number | null => {
    for (const rel of r.relations ?? []) {
      if (rel.rel !== PARENT_REL || typeof rel.url !== "string") continue;
      const m = /\/workItems\/(\d+)$/i.exec(rel.url);
      if (m) return Number(m[1]);
    }
    return null;
  };
  const str = (r: RawItem, f: string) => (typeof r.fields?.[f] === "string" ? (r.fields[f] as string) : "");

  /** The parent feature, or null when it doesn't exist (or isn't visible). */
  async function parent(): Promise<ParentItem | null> {
    try {
      const r = await req<RawItem>("parent", "GET", `${proj}/_apis/wit/workitems/${t.parentId}`);
      return { id: Number(r.id), type: str(r, "System.WorkItemType"), title: str(r, "System.Title"), areaPath: str(r, "System.AreaPath"), project: str(r, "System.TeamProject") };
    } catch (e) {
      if (e instanceof FeedbackFailure && e.kind === "not_found") return null;
      throw e;
    }
  }

  /** The process's story type: the requirement backlog's first work item type (User Story in Agile). */
  async function storyType(): Promise<string | null> {
    const r = await req<{ requirementBacklog?: { workItemTypes?: { name?: unknown }[] } }>("process", "GET", `${proj}/_apis/work/processconfiguration`);
    const n = r.requirementBacklog?.workItemTypes?.[0]?.name;
    return typeof n === "string" && n ? n : null;
  }

  /** The default team's default iteration as a full path ("Project\\Iteration 1"), or the project root. */
  async function defaultIteration(): Promise<string> {
    const p = await req<{ defaultTeam?: { name?: unknown } }>("project", "GET", `_apis/projects/${proj}`);
    const team = typeof p.defaultTeam?.name === "string" ? p.defaultTeam.name : null;
    if (!team) return t.project;
    const s = await req<{ defaultIteration?: { path?: unknown } | null }>("teamsettings", "GET", `${proj}/${encodeURIComponent(team)}/_apis/work/teamsettings`);
    const path = typeof s.defaultIteration?.path === "string" ? s.defaultIteration.path : "";
    return path ? `${t.project}${path.startsWith("\\") ? path : `\\${path}`}` : t.project;
  }

  /** The create, as JSON Patch: title, description, tags, area, iteration, and the parent link. */
  const ops = (p: FeedbackPayload, areaPath: string, iterationPath: string) => [
    { op: "add", path: "/fields/System.Title", value: p.title },
    { op: "add", path: "/fields/System.Description", value: textToHtml(p.description) },
    { op: "add", path: "/fields/System.Tags", value: p.tags.join("; ") },
    { op: "add", path: "/fields/System.AreaPath", value: areaPath },
    { op: "add", path: "/fields/System.IterationPath", value: iterationPath },
    { op: "add", path: "/relations/-", value: { rel: PARENT_REL, url: `${base}/_apis/wit/workItems/${t.parentId}` } },
  ];

  async function create(type: string, p: FeedbackPayload, areaPath: string, iterationPath: string, validateOnly = false): Promise<{ id: number | null; rev: number | null }> {
    const q = validateOnly ? "?validateOnly=true" : "";
    const r = await req<RawItem>(validateOnly ? "validate" : "create", "POST", `${proj}/_apis/wit/workitems/$${encodeURIComponent(type)}${q}`, ops(p, areaPath, iterationPath));
    return { id: typeof r.id === "number" ? r.id : null, rev: typeof r.rev === "number" ? r.rev : null };
  }

  /** Read back: the item as DevOps has it, with its parent. */
  async function read(id: number): Promise<CreatedItem> {
    const r = await req<RawItem>("readback", "GET", `${proj}/_apis/wit/workitems/${id}?$expand=relations`);
    return { id: Number(r.id), rev: Number(r.rev), title: str(r, "System.Title"), type: str(r, "System.WorkItemType"), parentId: parentOf(r), url: itemWebUrl(t, id) };
  }

  return { target: t, parent, storyType, defaultIteration, create, read };
}
export type FeedbackDevOps = ReturnType<typeof createFeedbackDevOps>;
