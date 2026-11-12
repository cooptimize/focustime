// A fake dev.azure.com for DevOps writes (step 14), test-only. It keeps items with revisions, applies JSON Patch
// (honoring the "test" op on /rev with 412, like a precondition failure), creates items with parent links, keeps
// comments (soft delete), answers connectionData per PAT, and can lose an answer after doing the work.
import { Pat } from "./pat.ts";
import { fakePat } from "./test-fakes.ts";

export type FakeItem = { id: number; rev: number; fields: Record<string, unknown>; relations: { rel: string; url: string; attributes?: unknown }[] };
export type FakeComment = { id: number; text: string; isDeleted: boolean; createdBy: string; createdDate: string; /** SR-1 */ createdByName?: string; modifiedDate?: string };
export type Seen = { method: string; url: string; authorization: string | null; contentType: string | null; body: unknown };

/** The PAT each fake identity uses (Basic base64(":" + PAT)). */
export const WRITE_PAT = fakePat("averywrite");
export const OTHER_PAT = fakePat("someoneelse");
export const COMPANY_PAT = fakePat("companyread");
export const basic = (pat: string) => new Pat(pat).basicAuth();

const STATES: Record<string, { name: string; category: string }[]> = {
  "User Story": [{ name: "New", category: "Proposed" }, { name: "Active", category: "InProgress" }, { name: "Resolved", category: "Resolved" }, { name: "Closed", category: "Completed" }, { name: "Removed", category: "Removed" }],
  Feature: [{ name: "New", category: "Proposed" }, { name: "Active", category: "InProgress" }, { name: "Closed", category: "Completed" }, { name: "Removed", category: "Removed" }],
  Epic: [{ name: "New", category: "Proposed" }, { name: "Active", category: "InProgress" }, { name: "Closed", category: "Completed" }, { name: "Removed", category: "Removed" }],
  Bug: [{ name: "New", category: "Proposed" }, { name: "Active", category: "InProgress" }, { name: "Resolved", category: "Resolved" }, { name: "Closed", category: "Completed" }, { name: "Removed", category: "Removed" }],
  Issue: [{ name: "To Do", category: "Proposed" }, { name: "Done", category: "Completed" }],
  Recurring: [{ name: "New", category: "Proposed" }, { name: "Recurring", category: "InProgress" }, { name: "Closed", category: "Completed" }],
  Domain: [{ name: "New", category: "Proposed" }, { name: "Active", category: "InProgress" }, { name: "Closed", category: "Completed" }],
};
const PC = {
  requirementBacklog: { name: "Stories", defaultWorkItemType: { name: "User Story" }, workItemTypes: [{ name: "User Story" }] },
  taskBacklog: { name: "Tasks", workItemTypes: [{ name: "Task" }] },
  bugWorkItems: { name: "Bugs", defaultWorkItemType: { name: "Bug" }, workItemTypes: [{ name: "Bug" }] },
  portfolioBacklogs: [
    { name: "Epics", defaultWorkItemType: { name: "Epic" }, workItemTypes: [{ name: "Epic" }] },
    { name: "Features", defaultWorkItemType: { name: "Feature" }, workItemTypes: [{ name: "Feature" }] },
  ],
};
const FIELDS = [
  { referenceName: "System.Title", name: "Title", type: "string" },
  { referenceName: "Microsoft.VSTS.Scheduling.TargetDate", name: "Target Date", type: "dateTime" },
  { referenceName: "Microsoft.VSTS.Common.AcceptanceCriteria", name: "Acceptance Criteria", type: "html" },
  { referenceName: "Microsoft.VSTS.Scheduling.StartDate", name: "Start Date", type: "dateTime" },
  { referenceName: "Microsoft.VSTS.Scheduling.StoryPoints", name: "Story Points", type: "double" },
  { referenceName: "Microsoft.VSTS.Scheduling.Effort", name: "Effort", type: "double" },
];

export function fakeDevOpsWrite(opts: { org?: string; identities?: Record<string, { id: string; name: string; email: string }>; acceptance?: boolean; startDate?: boolean; now?: () => string; /** TX-1: the work item types that have Remaining Work. */ remainingWork?: readonly string[]; /** BD-1: Recurring sits beside Feature at parent level (Cooptimize's internal process). */ recurring?: boolean; /** AH-1: the size field stories have (Story Points by default; Effort like a Scrum process; none). */ sizeField?: "Microsoft.VSTS.Scheduling.StoryPoints" | "Microsoft.VSTS.Scheduling.Effort" | null; /** QC-1: a portfolio level above Epics (Domain). */ domain?: boolean; /** QC-1: fields a type always requires, with no default (the create is refused without them). */ required?: Record<string, readonly string[]>; /** TP-1: the person may not create tags here (a create naming a tag no item has is refused whole). */ noNewTags?: boolean } = {}) {
  const clock = opts.now ?? (() => new Date().toISOString());
  const org = opts.org ?? "cooptimize";
  const identities = opts.identities ?? { [basic(WRITE_PAT)]: { id: "11111111-1111-4111-8111-111111111111", name: "Sam Tester", email: "avery@cooptimize.example" }, [basic(OTHER_PAT)]: { id: "22222222-2222-4222-8222-222222222222", name: "Dana Ruiz", email: "dana@cooptimize.example" } };
  const items = new Map<number, FakeItem>();
  const comments = new Map<number, FakeComment[]>();
  /** CV-4: uploaded attachment files (DevOps has no delete for them). */
  const attachments = new Map<string, { fileName: string; size: number; contentType: string | null }>();
  let nextAttachment = 1;
  const seen: Seen[] = [];
  let nextId = 900;
  let nextComment = 5000;
  const failures: { method: string; path: RegExp; mode: "network" | "lost" }[] = [];
  const me = (auth: string | null) => (auth ? identities[auth] : undefined);
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json; charset=utf-8" } });
  const itemUrl = (id: number) => `https://dev.azure.com/${org}/_apis/wit/workItems/${id}`;
  const view = (i: FakeItem) => ({ id: i.id, rev: i.rev, fields: { ...i.fields, "System.Id": i.id }, relations: i.relations, url: itemUrl(i.id) });
  const bump = (i: FakeItem) => {
    i.rev++;
    i.fields["System.ChangedDate"] = clock();
  };

  const add = (id: number, fields: Record<string, unknown>, parent?: number) => {
    const it: FakeItem = { id, rev: 3, fields: { "System.AreaPath": "Cooptimize\\Ops", "System.IterationPath": "Cooptimize\\Sprint 9", ...fields }, relations: parent ? [{ rel: "System.LinkTypes.Hierarchy-Reverse", url: itemUrl(parent) }] : [] };
    if (parent) it.fields["System.Parent"] = parent;
    items.set(id, it);
    return it;
  };

  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const auth = headers.get("authorization");
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    const raw = init?.body instanceof Uint8Array ? init.body : null;
    seen.push({ method, url: url.toString(), authorization: auth, contentType: headers.get("content-type"), body: raw ? { bytes: raw.length } : body });
    const path = url.pathname;
    const f = failures.findIndex((x) => x.method === method && x.path.test(path));
    const failure = f >= 0 ? failures.splice(f, 1)[0] : undefined;
    if (failure?.mode === "network") throw new TypeError("fetch failed");
    if (url.hostname !== "dev.azure.com" || !path.startsWith(`/${org}/`)) throw new TypeError("unexpected host or org");
    const who = me(auth);
    if (!who) return new Response("<html>sign in</html>", { status: 401 });
    const answer = (r: Response) => {
      if (failure?.mode === "lost") throw new TypeError("fetch failed");
      return r;
    };
    if (path === `/${org}/_apis/connectionData`) return json({ authenticatedUser: { id: who.id, providerDisplayName: who.name, properties: { Account: { $type: "System.String", $value: who.email } } } });
    const rest = path.split("/").slice(3).map(decodeURIComponent).join("/");
    if (rest === "_apis/work/processconfiguration") {
      const pc = opts.recurring ? { ...PC, portfolioBacklogs: [PC.portfolioBacklogs[0], { ...PC.portfolioBacklogs[1]!, workItemTypes: [{ name: "Feature" }, { name: "Recurring" }] }] } : PC;
      return json(opts.domain ? { ...pc, portfolioBacklogs: [{ name: "Domains", defaultWorkItemType: { name: "Domain" }, workItemTypes: [{ name: "Domain" }] }, ...pc.portfolioBacklogs] } : pc);
    }
    if (rest === "_apis/wit/fields") return json({ value: FIELDS });
    // CV-4: an attachment upload (raw bytes, application/octet-stream), at the org level as the docs' samples are.
    if (path === `/${org}/_apis/wit/attachments` && method === "POST") {
      if (!raw || headers.get("content-type") !== "application/octet-stream") return json({ message: "bad upload" }, 400);
      const id = `aaaaaaaa-0000-4000-8000-${String(nextAttachment++).padStart(12, "0")}`;
      const fileName = url.searchParams.get("fileName") ?? "file";
      attachments.set(id, { fileName, size: raw.length, contentType: headers.get("content-type") });
      return answer(json({ id, url: `https://dev.azure.com/${org}/_apis/wit/attachments/${id}?fileName=${encodeURIComponent(fileName)}` }, 201));
    }
    let m = rest.match(/^_apis\/wit\/workitemtypes\/(.+)\/states$/);
    if (m) return json({ value: STATES[m[1]!] ?? [] });
    m = rest.match(/^_apis\/wit\/workitemtypes\/(.+)\/fields$/);
    if (m) return json({ value: [{ referenceName: "System.Title", alwaysRequired: true }, ...(opts.required?.[decodeURIComponent(m[1]!)] ?? []).map((r) => ({ referenceName: r, name: r.split(".").pop(), alwaysRequired: true })), ...(opts.remainingWork?.includes(decodeURIComponent(m[1]!)) ? [{ referenceName: "Microsoft.VSTS.Scheduling.RemainingWork" }] : []), ...(m[1] === "Feature" || m[1] === "Epic" ? [{ referenceName: "Microsoft.VSTS.Scheduling.TargetDate" }, ...(opts.startDate !== false ? [{ referenceName: "Microsoft.VSTS.Scheduling.StartDate" }] : [])] : []), ...(m[1] === "User Story" && opts.acceptance !== false ? [{ referenceName: "Microsoft.VSTS.Common.AcceptanceCriteria" }] : []), ...(m[1] === "User Story" && opts.sizeField !== null ? [{ referenceName: opts.sizeField ?? "Microsoft.VSTS.Scheduling.StoryPoints" }] : []), ...(m[1] === "Bug" ? [{ referenceName: "Microsoft.VSTS.TCM.ReproSteps" }] : [])] });
    if (rest === "_apis/wit/wiql") {
      const q = String(body.query);
      const pm = q.match(/\[System\.Parent\] = (\d+)/);
      const parent = pm ? Number(pm[1]) : undefined;
      const type = q.match(/\[System\.WorkItemType\] = '((?:[^']|'')*)'/)?.[1]?.replace(/''/g, "'");
      const title = q.match(/\[System\.Title\] = '((?:[^']|'')*)'/)?.[1]?.replace(/''/g, "'");
      return json({ workItems: [...items.values()].filter((i) => i.fields["System.Parent"] === parent && (!type || i.fields["System.WorkItemType"] === type) && i.fields["System.Title"] === title && i.fields["System.CreatedBy"] === who.email).map((i) => ({ id: i.id })) });
    }
    m = rest.match(/^_apis\/wit\/workitems\/\$(.+)$/);
    if (m && method === "POST") {
      const sent = new Set((body as { path: string }[]).map((o) => o.path.replace(/^\/fields\//, "")));
      const missing = (opts.required?.[m[1]!] ?? []).find((r) => !sent.has(r));
      if (missing) return json({ message: `TF401320: Rule Error for field ${missing.split(".").pop()}. Error code: Required, HasValues, LimitedToValues, AllowsOldValue, InvalidEmpty.` }, 400);
      if (!STATES[m[1]!] && m[1] !== "Task") return json({ message: `TF401326: Invalid work item type ${m[1]}` }, 400);
      const tagsSent = (body as { path: string; value: unknown }[]).find((o) => o.path === "/fields/System.Tags")?.value;
      const knownTags = new Set([...items.values()].flatMap((i) => String(i.fields["System.Tags"] ?? "").split(";").map((t) => t.trim().toLowerCase()).filter(Boolean)));
      if (opts.noNewTags && typeof tagsSent === "string" && tagsSent.split(";").some((t) => t.trim() && !knownTags.has(t.trim().toLowerCase()))) return json({ message: "TF401289: You don't have permission to create new tags." }, 400);
      const it: FakeItem = { id: nextId++, rev: 1, fields: { "System.WorkItemType": m[1], "System.State": "New", "System.CreatedBy": who.email }, relations: [] };
      for (const op of body as { op: string; path: string; value: unknown }[]) {
        if (op.path.startsWith("/fields/")) {
          const k = op.path.slice(8);
          it.fields[k] = k === "System.AssignedTo" ? { displayName: who.name, uniqueName: op.value } : op.value;
        } else if (op.path === "/relations/-" && (op.value as { rel: string }).rel === "AttachedFile") {
          const r = op.value as { rel: string; url: string; attributes?: unknown };
          const aid = r.url.match(/attachments\/([0-9a-f-]+)/)?.[1];
          if (!aid || !attachments.has(aid)) return json({ message: "TF401349: attachment not found" }, 400);
          it.relations.push(r);
        } else if (op.path === "/relations/-") {
          const r = op.value as { rel: string; url: string };
          it.relations.push(r);
          const pid = Number(r.url.match(/workItems\/(\d+)$/)?.[1]);
          it.fields["System.Parent"] = pid;
          const parent = items.get(pid);
          if (parent) {
            parent.relations.push({ rel: "System.LinkTypes.Hierarchy-Forward", url: itemUrl(it.id) });
            bump(parent);
          }
        }
      }
      items.set(it.id, it);
      return answer(json(view(it)));
    }
    m = rest.match(/^_apis\/wit\/workitems\/(\d+)$/i);
    if (m) {
      const it = items.get(Number(m[1]));
      if (!it) return json({ message: "TF401232: Work item does not exist" }, 404);
      if (method === "GET") return json(view(it));
      if (method === "PATCH") {
        let commentId: number | null = null;
        for (const op of body as { op: string; path: string; value: unknown }[]) if (op.op === "test" && op.path === "/rev" && op.value !== it.rev) return json({ message: "TF26071: This work item has been changed by someone else since you opened it." }, 412);
        for (const op of body as { op: string; path: string; value: unknown }[]) {
          if (op.op === "test") continue;
          // CV-4: a relation removed by its index (the documented "remove" on /relations/<index>).
          const ri = op.op === "remove" ? op.path.match(/^\/relations\/(\d+)$/) : null;
          if (ri) {
            if (Number(ri[1]) >= it.relations.length) return json({ message: "TF401349: relation index out of range" }, 400);
            it.relations.splice(Number(ri[1]), 1);
            continue;
          }
          const k = op.path.replace(/^\/fields\//, "");
          if (k === "System.History") {
            commentId = nextComment++;
            (comments.get(it.id) ?? comments.set(it.id, []).get(it.id)!).push({ id: commentId, text: String(op.value), isDeleted: false, createdBy: who.email, createdDate: clock() });
          } else if (op.op === "remove") delete it.fields[k];
          // AH-1: an empty assignee unassigns (the documented shape: add with "").
          else if (k === "System.AssignedTo" && op.value === "") delete it.fields[k];
          else it.fields[k] = op.value;
        }
        bump(it);
        return answer(json({ ...view(it), ...(commentId ? { commentVersionRef: { commentId, version: 1 } } : {}) }));
      }
    }
    m = rest.match(/^_apis\/wit\/workItems\/(\d+)\/comments(?:\/(\d+))?$/);
    if (m) {
      const id = Number(m[1]);
      const list = comments.get(id) ?? comments.set(id, []).get(id)!;
      const cv = (c: FakeComment) => ({ workItemId: id, id: c.id, version: 1, text: c.text, isDeleted: c.isDeleted, createdBy: { uniqueName: c.createdBy, displayName: c.createdByName ?? c.createdBy }, createdDate: c.createdDate, modifiedDate: c.modifiedDate ?? c.createdDate });
      if (!m[2] && method === "POST") {
        const c = { id: nextComment++, text: String(body.text), isDeleted: false, createdBy: who.email, createdDate: clock() };
        list.push(c);
        return answer(json(cv(c)));
      }
      if (!m[2]) return json({ totalCount: list.length, comments: list.filter((c) => !c.isDeleted).map(cv).reverse() });
      const c = list.find((x) => x.id === Number(m![2]));
      if (!c) return json({ message: "not found" }, 404);
      if (method === "DELETE") {
        c.isDeleted = true;
        return answer(json(cv(c)));
      }
      // SR-1: an edit (DevOps itself lets only the author edit in its UI; the fake refuses anyone else too).
      if (method === "PATCH") {
        if (c.isDeleted) return json({ message: "not found" }, 404);
        if (c.createdBy.toLowerCase() !== who.email.toLowerCase()) return json({ message: "TF401409: Only the author can edit this comment" }, 403);
        c.text = String(body.text);
        c.modifiedDate = clock();
        return answer(json(cv(c)));
      }
      if (c.isDeleted && url.searchParams.get("includeDeleted") !== "true") return json({ message: "not found" }, 404);
      return json(cv(c));
    }
    return json({ message: "unknown" }, 404);
  }) as typeof fetch;

  return {
    fetch: fn, seen, items, comments, add, attachments,
    /** The next matching request fails at the network (nothing done), or is done and its answer lost. */
    fail: (method: string, path: RegExp, mode: "network" | "lost") => void failures.push({ method, path, mode }),
    /** Someone else edits an item (its rev moves on). */
    touch: (id: number, fields: Record<string, unknown>) => {
      const it = items.get(id)!;
      Object.assign(it.fields, fields);
      bump(it);
    },
    writes: () => seen.filter((s) => s.method !== "GET" && !s.url.includes("/_apis/wit/wiql")),
  };
}
