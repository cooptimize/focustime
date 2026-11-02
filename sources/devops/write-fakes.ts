// A fake dev.azure.com for DevOps writes (step 14), test-only. It keeps items with revisions, applies JSON Patch
// (honoring the "test" op on /rev with 412, like a precondition failure), creates items with parent links, keeps
// comments (soft delete), answers connectionData per PAT, and can lose an answer after doing the work.
import { Pat } from "./pat.ts";
import { fakePat } from "./test-fakes.ts";

export type FakeItem = { id: number; rev: number; fields: Record<string, unknown>; relations: { rel: string; url: string; attributes?: unknown }[] };
export type FakeComment = { id: number; text: string; isDeleted: boolean; createdBy: string; createdDate: string };
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
  Issue: [{ name: "To Do", category: "Proposed" }, { name: "Done", category: "Completed" }],
};
const PC = {
  requirementBacklog: { name: "Stories", defaultWorkItemType: { name: "User Story" }, workItemTypes: [{ name: "User Story" }] },
  taskBacklog: { name: "Tasks", workItemTypes: [{ name: "Task" }] },
  portfolioBacklogs: [
    { name: "Epics", defaultWorkItemType: { name: "Epic" }, workItemTypes: [{ name: "Epic" }] },
    { name: "Features", defaultWorkItemType: { name: "Feature" }, workItemTypes: [{ name: "Feature" }] },
  ],
};
const FIELDS = [
  { referenceName: "System.Title", name: "Title", type: "string" },
  { referenceName: "Microsoft.VSTS.Scheduling.TargetDate", name: "Target Date", type: "dateTime" },
  { referenceName: "Microsoft.VSTS.Common.AcceptanceCriteria", name: "Acceptance Criteria", type: "html" },
];

export function fakeDevOpsWrite(opts: { org?: string; identities?: Record<string, { id: string; name: string; email: string }>; acceptance?: boolean; startDate?: boolean; now?: () => string } = {}) {
  const clock = opts.now ?? (() => new Date().toISOString());
  const org = opts.org ?? "cooptimize";
  const identities = opts.identities ?? { [basic(WRITE_PAT)]: { id: "11111111-1111-4111-8111-111111111111", name: "Sam Tester", email: "avery@cooptimize.example" }, [basic(OTHER_PAT)]: { id: "22222222-2222-4222-8222-222222222222", name: "Dana Ruiz", email: "dana@cooptimize.example" } };
  const items = new Map<number, FakeItem>();
  const comments = new Map<number, FakeComment[]>();
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
    seen.push({ method, url: url.toString(), authorization: auth, contentType: headers.get("content-type"), body });
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
    if (rest === "_apis/work/processconfiguration") return json(PC);
    if (rest === "_apis/wit/fields") return json({ value: FIELDS });
    let m = rest.match(/^_apis\/wit\/workitemtypes\/(.+)\/states$/);
    if (m) return json({ value: STATES[m[1]!] ?? [] });
    m = rest.match(/^_apis\/wit\/workitemtypes\/(.+)\/fields$/);
    if (m) return json({ value: [{ referenceName: "System.Title" }, ...(m[1] === "Feature" || m[1] === "Epic" ? [{ referenceName: "Microsoft.VSTS.Scheduling.TargetDate" }, ...(opts.startDate !== false ? [{ referenceName: "Microsoft.VSTS.Scheduling.StartDate" }] : [])] : []), ...(m[1] === "User Story" && opts.acceptance !== false ? [{ referenceName: "Microsoft.VSTS.Common.AcceptanceCriteria" }] : [])] });
    if (rest === "_apis/wit/wiql") {
      const q = String(body.query);
      const parent = Number(q.match(/\[System\.Parent\] = (\d+)/)?.[1]);
      const title = q.match(/\[System\.Title\] = '((?:[^']|'')*)'/)?.[1]?.replace(/''/g, "'");
      return json({ workItems: [...items.values()].filter((i) => i.fields["System.Parent"] === parent && i.fields["System.Title"] === title && i.fields["System.CreatedBy"] === who.email).map((i) => ({ id: i.id })) });
    }
    m = rest.match(/^_apis\/wit\/workitems\/\$(.+)$/);
    if (m && method === "POST") {
      const it: FakeItem = { id: nextId++, rev: 1, fields: { "System.WorkItemType": m[1], "System.State": "New", "System.CreatedBy": who.email }, relations: [] };
      for (const op of body as { op: string; path: string; value: unknown }[]) {
        if (op.path.startsWith("/fields/")) {
          const k = op.path.slice(8);
          it.fields[k] = k === "System.AssignedTo" ? { displayName: who.name, uniqueName: op.value } : op.value;
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
          const k = op.path.replace(/^\/fields\//, "");
          if (k === "System.History") {
            commentId = nextComment++;
            (comments.get(it.id) ?? comments.set(it.id, []).get(it.id)!).push({ id: commentId, text: String(op.value), isDeleted: false, createdBy: who.email, createdDate: clock() });
          } else if (op.op === "remove") delete it.fields[k];
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
      const cv = (c: FakeComment) => ({ workItemId: id, id: c.id, version: 1, text: c.text, isDeleted: c.isDeleted, createdBy: { uniqueName: c.createdBy }, createdDate: c.createdDate });
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
      if (c.isDeleted && url.searchParams.get("includeDeleted") !== "true") return json({ message: "not found" }, 404);
      return json(cv(c));
    }
    return json({ message: "unknown" }, 404);
  }) as typeof fetch;

  return {
    fetch: fn, seen, items, comments, add,
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
