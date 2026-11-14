// DevOps writes over HTTP (step 14). Every request goes to https://dev.azure.com/<org>/ of one client, with that
// client's personal write PAT (from the keyring, wrapped in Pat), never the company read PAT. Redirects are not
// followed. Logs carry op, status and duration only; bodies, headers and PATs are never logged or returned. From an
// error body only DevOps's own `message` is read (cut to 300 characters), so a rule error can be shown in plain words.
import type { Logger } from "../../log/logger.ts";
import { COMMENTS_API, FORMAT_API, identityFrom, orgBase, PARENT_REL, WIT_API, type DevOpsIdentity, type ItemSnapshot, type PatchOp, type StateInfo } from "../../plan/devopswrite.ts";
import type { FieldInfo } from "./normalize.ts";
import type { Pat } from "./pat.ts";

export type WriteFailureKind = "auth" | "forbidden" | "not_found" | "changed" | "rejected" | "network" | "error";
export class WriteFailure extends Error {
  readonly kind: WriteFailureKind;
  readonly status: number | null;
  constructor(kind: WriteFailureKind, message: string, status: number | null = null) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}

export type Comment = { id: number; text: string; isDeleted: boolean; createdBy: string | null; createdDate: string | null; /** SR-1: when it was last edited (DevOps's modifiedDate), or null. */ modifiedDate?: string | null };

export function createDevOpsWriter(d: { fetch: typeof fetch; log: Logger; timeoutMs?: number }) {
  const timeoutMs = d.timeoutMs ?? 20_000;
  async function req<T>(org: string, pat: Pat, op: string, method: string, path: string, apiVersion: string, body?: unknown, contentType = "application/json"): Promise<T> {
    // connectionData isn't versioned on Learn, so it is called without an api-version.
    const url = apiVersion ? `${orgBase(org)}/${path}${path.includes("?") ? "&" : "?"}api-version=${apiVersion}` : `${orgBase(org)}/${path}`;
    const started = performance.now();
    let res: Response;
    try {
      res = await d.fetch(url, {
        method,
        headers: { accept: "application/json", authorization: pat.basicAuth(), ...(body === undefined ? {} : { "content-type": contentType }) },
        // CV-4: an attachment's bytes go as they are (application/octet-stream); everything else is JSON.
        ...(body === undefined ? {} : { body: body instanceof Uint8Array ? new Uint8Array(body) : JSON.stringify(body) }),
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      d.log({ source: "devops", op: `write_${op}`, kind: "network" });
      throw new WriteFailure("network", `DevOps organization ${org} didn't answer`);
    }
    d.log({ source: "devops", op: `write_${op}`, status: res.status, durationMs: performance.now() - started });
    if (res.status === 401 || res.status === 203 || (res.status >= 300 && res.status < 400) || res.type === "opaqueredirect")
      throw new WriteFailure("auth", "The DevOps write PAT is expired or invalid. Enter a new one in Settings › DevOps", res.status);
    if (res.status === 403) throw new WriteFailure("forbidden", "DevOps refused: the write PAT needs Work Items (Read & write), or you lack permission on this item", 403);
    if (res.status === 404) throw new WriteFailure("not_found", "Not found in DevOps (deleted, moved, or no access)", 404);
    if (res.status === 409 || res.status === 412) throw new WriteFailure("changed", "Changed in DevOps since you loaded it", res.status);
    if (!res.ok) {
      const msg = await safeMessage(res);
      throw new WriteFailure(res.status === 400 ? "rejected" : "error", msg ? `DevOps refused the change: ${msg}` : `DevOps error (HTTP ${res.status})`, res.status);
    }
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("application/json")) throw new WriteFailure("auth", "The DevOps write PAT is expired or invalid. Enter a new one in Settings › DevOps", res.status);
    return (await res.json()) as T;
  }
  const p = (project: string) => encodeURIComponent(project);

  return {
    /** Read-only: who this PAT is, on this org. */
    async identity(org: string, pat: Pat): Promise<DevOpsIdentity | null> {
      return identityFrom(await req<unknown>(org, pat, "identity", "GET", "_apis/connectionData", ""));
    },
    async item(org: string, pat: Pat, project: string, id: number): Promise<ItemSnapshot> {
      return snapshot(await req<RawItem>(org, pat, "item", "GET", `${p(project)}/_apis/wit/workitems/${id}?$expand=relations`, WIT_API));
    },
    /**
     * ED-1: the item with the format each large text field is stored in (multilineFieldsFormat, only in
     * 7.2-preview.3; checked on Learn Nov 12). An organization that doesn't answer that version has no Markdown
     * fields, so the 7.1 read is used and every field counts as HTML.
     */
    async itemWithFormats(org: string, pat: Pat, project: string, id: number): Promise<ItemSnapshot> {
      try {
        return snapshot(await req<RawItem>(org, pat, "item_formats", "GET", `${p(project)}/_apis/wit/workitems/${id}?$expand=relations`, FORMAT_API));
      } catch (e) {
        if (e instanceof WriteFailure && e.kind === "rejected") return snapshot(await req<RawItem>(org, pat, "item", "GET", `${p(project)}/_apis/wit/workitems/${id}?$expand=relations`, WIT_API));
        throw e;
      }
    },
    async states(org: string, pat: Pat, project: string, type: string): Promise<StateInfo[]> {
      const r = await req<{ value?: { name?: unknown; category?: unknown }[] }>(org, pat, "states", "GET", `${p(project)}/_apis/wit/workitemtypes/${encodeURIComponent(type)}/states`, WIT_API);
      return (r.value ?? []).filter((s): s is StateInfo => typeof s.name === "string" && typeof s.category === "string").map((s) => ({ name: s.name, category: s.category }));
    },
    async typeFields(org: string, pat: Pat, project: string, type: string): Promise<Set<string>> {
      const r = await req<{ value?: { referenceName?: unknown }[] }>(org, pat, "typefields", "GET", `${p(project)}/_apis/wit/workitemtypes/${encodeURIComponent(type)}/fields`, WIT_API);
      return new Set((r.value ?? []).map((f) => f.referenceName).filter((x): x is string => typeof x === "string"));
    },
    /** QC-1: the type's fields with alwaysRequired and whether DevOps has a default (work item types field list, 7.1). */
    async typeFieldInfo(org: string, pat: Pat, project: string, type: string): Promise<{ ref: string; name: string | null; required: boolean; hasDefault: boolean }[]> {
      const r = await req<{ value?: { referenceName?: unknown; name?: unknown; alwaysRequired?: unknown; defaultValue?: unknown }[] }>(org, pat, "typefields", "GET", `${p(project)}/_apis/wit/workitemtypes/${encodeURIComponent(type)}/fields`, WIT_API);
      return (r.value ?? []).flatMap((f) => (typeof f.referenceName === "string" ? [{ ref: f.referenceName, name: typeof f.name === "string" ? f.name : null, required: f.alwaysRequired === true, hasDefault: f.defaultValue !== undefined && f.defaultValue !== null && f.defaultValue !== "" }] : []));
    },
    async fields(org: string, pat: Pat, project: string): Promise<FieldInfo[]> {
      return (await req<{ value?: FieldInfo[] }>(org, pat, "fields", "GET", `${p(project)}/_apis/wit/fields`, WIT_API)).value ?? [];
    },
    async processConfig(org: string, pat: Pat, project: string): Promise<unknown> {
      return req<unknown>(org, pat, "processconfiguration", "GET", `${p(project)}/_apis/work/processconfiguration`, WIT_API);
    },
    async update(org: string, pat: Pat, project: string, id: number, ops: PatchOp[]): Promise<ItemSnapshot & { commentId: number | null }> {
      // ED-1: a patch that keeps a Markdown field Markdown (/multilineFieldsFormat/...) needs the version that has it.
      const version = ops.some((o) => o.path.startsWith("/multilineFieldsFormat/")) ? FORMAT_API : WIT_API;
      const r = await req<RawItem>(org, pat, "update", "PATCH", `${p(project)}/_apis/wit/workitems/${id}?$expand=relations`, version, ops, "application/json-patch+json");
      return { ...snapshot(r), commentId: typeof r.commentVersionRef?.commentId === "number" ? r.commentVersionRef.commentId : null };
    },
    async create(org: string, pat: Pat, project: string, type: string, ops: PatchOp[]): Promise<ItemSnapshot> {
      return snapshot(await req<RawItem>(org, pat, "create", "POST", `${p(project)}/_apis/wit/workitems/$${encodeURIComponent(type)}?$expand=relations`, WIT_API, ops, "application/json-patch+json"));
    },
    /**
     * CV-4: one file uploaded as a work item attachment (POST _apis/wit/attachments?fileName=, the bytes as
     * application/octet-stream; 7.1). It is linked only by an AttachedFile relation on the item; DevOps has no delete.
     */
    async uploadAttachment(org: string, pat: Pat, fileName: string, bytes: Uint8Array): Promise<{ id: string; url: string }> {
      const r = await req<{ id?: unknown; url?: unknown }>(org, pat, "attachment", "POST", `_apis/wit/attachments?fileName=${encodeURIComponent(fileName)}&uploadType=simple`, WIT_API, bytes, "application/octet-stream");
      if (typeof r.id !== "string" || typeof r.url !== "string" || !r.url.startsWith(`${orgBase(org)}/`)) throw new WriteFailure("error", "DevOps answered without the attachment");
      return { id: r.id, url: r.url };
    },
    async addComment(org: string, pat: Pat, project: string, id: number, text: string): Promise<Comment> {
      return comment(await req<RawComment>(org, pat, "comment_add", "POST", `${p(project)}/_apis/wit/workItems/${id}/comments`, COMMENTS_API, { text }));
    },
    async getComment(org: string, pat: Pat, project: string, id: number, commentId: number): Promise<Comment> {
      return comment(await req<RawComment>(org, pat, "comment_get", "GET", `${p(project)}/_apis/wit/workItems/${id}/comments/${commentId}?includeDeleted=true`, COMMENTS_API));
    },
    /** SR-1: my own comment's new text (PATCH comments/{id}, 7.1-preview.4; checked on Learn Nov 5). Never someone else's: the caller checks the author first. */
    async updateComment(org: string, pat: Pat, project: string, id: number, commentId: number, text: string): Promise<Comment> {
      return comment(await req<RawComment>(org, pat, "comment_update", "PATCH", `${p(project)}/_apis/wit/workItems/${id}/comments/${commentId}`, COMMENTS_API, { text }));
    },
    async comments(org: string, pat: Pat, project: string, id: number): Promise<Comment[]> {
      const r = await req<{ comments?: RawComment[] }>(org, pat, "comment_list", "GET", `${p(project)}/_apis/wit/workItems/${id}/comments?$top=200&order=desc`, COMMENTS_API);
      return (r.comments ?? []).map(comment);
    },
    async deleteComment(org: string, pat: Pat, project: string, id: number, commentId: number): Promise<void> {
      await req<unknown>(org, pat, "comment_delete", "DELETE", `${p(project)}/_apis/wit/workItems/${id}/comments/${commentId}`, COMMENTS_API).catch((e: unknown) => {
        // DELETE may answer with no JSON body; that is still done.
        if (e instanceof WriteFailure && e.kind === "auth" && e.status !== null && e.status >= 200 && e.status < 300) return;
        throw e;
      });
    },
    async wiql(org: string, pat: Pat, project: string, query: string): Promise<number[]> {
      const r = await req<{ workItems?: { id?: unknown }[] }>(org, pat, "wiql", "POST", `${p(project)}/_apis/wit/wiql?$top=50`, WIT_API, { query });
      return (r.workItems ?? []).map((w) => w.id).filter((x): x is number => typeof x === "number");
    },
  };
}
export type DevOpsWriter = ReturnType<typeof createDevOpsWriter>;

async function safeMessage(res: Response): Promise<string | null> {
  try {
    const t = await res.text();
    const m = (JSON.parse(t) as { message?: unknown }).message;
    return typeof m === "string" ? m.replace(/\s+/g, " ").slice(0, 300) : null;
  } catch {
    return null;
  }
}

type RawItem = { id?: unknown; rev?: unknown; multilineFieldsFormat?: Record<string, unknown>; fields?: Record<string, unknown>; relations?: { rel?: unknown; url?: unknown; attributes?: unknown }[]; commentVersionRef?: { commentId?: unknown } };
type RawComment = { id?: unknown; commentId?: unknown; text?: unknown; isDeleted?: unknown; createdBy?: { uniqueName?: unknown }; createdDate?: unknown; modifiedDate?: unknown };

function snapshot(r: RawItem): ItemSnapshot {
  if (typeof r.id !== "number" || typeof r.rev !== "number") throw new WriteFailure("error", "DevOps answered without the item");
  const f = r.fields ?? {};
  const relations = (r.relations ?? []).filter((x): x is { rel: string; url: string } => typeof x.rel === "string" && typeof x.url === "string");
  const parentUrl = relations.find((x) => x.rel === PARENT_REL)?.url;
  const fromField = typeof f["System.Parent"] === "number" ? (f["System.Parent"] as number) : null;
  const fromRel = parentUrl ? Number(parentUrl.match(/workItems\/(\d+)$/i)?.[1]) || null : null;
  const formats = Object.fromEntries(Object.entries(r.multilineFieldsFormat ?? {}).filter((e): e is [string, string] => typeof e[1] === "string").map(([k, v]) => [k, v.toLowerCase()]));
  return { id: r.id, rev: r.rev, type: String(f["System.WorkItemType"] ?? ""), title: String(f["System.Title"] ?? ""), state: String(f["System.State"] ?? ""), fields: f, parentId: fromField ?? fromRel, relations, formats };
}
function comment(r: RawComment): Comment {
  const id = typeof r.id === "number" ? r.id : typeof r.commentId === "number" ? r.commentId : null;
  if (id === null) throw new WriteFailure("error", "DevOps answered without the comment");
  return { id, text: typeof r.text === "string" ? r.text : "", isDeleted: r.isDeleted === true, createdBy: typeof r.createdBy?.uniqueName === "string" ? r.createdBy.uniqueName : null, createdDate: typeof r.createdDate === "string" ? r.createdDate : null, modifiedDate: typeof r.modifiedDate === "string" ? r.modifiedDate : null };
}
