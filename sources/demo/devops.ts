// DM-1: the demo's DevOps, one per demo session, in memory. The demo's DevOps reads (Week, Plan, Ahead, Break down,
// Link) come from it, and its writes go to it: the app's own DevOps writer (sources/devops/write.ts) is handed this
// module's `fetch`, which answers the few REST calls the write framework makes (items, patches with the /rev test,
// creates under a parent, comments, states, fields, attachments) without any network. So a demo write has its real
// preview, confirm, read back, audit log and undo, and nothing leaves FocusTime. A URL for anything else throws, so a
// request that isn't one of these can never reach a real host. All of it is fictional.
import { DEMO_CLIENTS, ME, type DemoClientKey } from "./data.ts";

export const ME_EMAIL = "you@example.com";
export const ME_NAME = "Alex Rivera";

export type DemoItem = {
  /** TP-1: DevOps tags (System.Tags), once written. */
  tags?: string[];
  /** TX-1: DevOps Remaining Work, once written. */
  remainingWork?: number | null;
  clientKey: DemoClientKey;
  id: number;
  rev: number;
  type: string;
  state: string;
  parent: number | null;
  title: string;
  /** ME, a display name, or null (unassigned). */
  who: string | null;
  /** The assignee's DevOps email (null when unassigned or unknown). */
  whoEmail: string | null;
  target: string | null;
  start: string | null;
  size: number | null;
  changedAt: string;
  order: number;
  blocked: boolean;
  description: string;
  acceptance: string;
  /** AH-2: in the client's project but outside my scope (their own staff's work). */
  projectOnly: boolean;
  createdBy: string | null;
  /** Area and iteration paths (a new item copies its parent's). */
  area: string;
  iteration: string;
  relations: { rel: string; url: string; attributes?: unknown }[];
};
/** DV-2: what a teammate can change in the demo's DevOps (see `teammate`). */
export type TeammateChange =
  | { id: number; title?: string; state?: string; assignee?: string | null; target?: string | null }
  | { create: { type: string; title: string; parent?: number | null; assignee?: string | null; target?: string | null; /** In the project, outside the scope (another team's area). */ outsideScope?: boolean } };
/** DV-2: a teammate's change from a request's input, or null when it isn't one. */
export function parseTeammate(v: unknown): TeammateChange | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const str = (x: unknown) => typeof x === "string";
  const opt = (x: unknown, ok: (y: unknown) => boolean) => x === undefined || ok(x);
  const day = (x: unknown) => x === null || (str(x) && /^\d{4}-\d{2}-\d{2}$/.test(x as string));
  if (o.create && typeof o.create === "object") {
    const c = o.create as Record<string, unknown>;
    if (!str(c.type) || !str(c.title) || !opt(c.parent, (x) => x === null || Number.isInteger(x)) || !opt(c.assignee, (x) => x === null || str(x)) || !opt(c.target, day) || !opt(c.outsideScope, (x) => typeof x === "boolean")) return null;
    return { create: { type: c.type as string, title: c.title as string, ...(c.parent !== undefined ? { parent: c.parent as number | null } : {}), ...(c.assignee !== undefined ? { assignee: c.assignee as string | null } : {}), ...(c.target !== undefined ? { target: c.target as string | null } : {}), ...(c.outsideScope ? { outsideScope: true } : {}) } };
  }
  if (!Number.isInteger(o.id) || !opt(o.title, str) || !opt(o.state, str) || !opt(o.assignee, (x) => x === null || str(x)) || !opt(o.target, day)) return null;
  return { id: o.id as number, ...(o.title !== undefined ? { title: o.title as string } : {}), ...(o.state !== undefined ? { state: o.state as string } : {}), ...(o.assignee !== undefined ? { assignee: o.assignee as string | null } : {}), ...(o.target !== undefined ? { target: o.target as string | null } : {}) };
}
type DemoComment = { id: number; text: string; isDeleted: boolean; createdBy: string; createdDate: string; /** SR-1 */ createdByName?: string; modifiedDate?: string };

export const STATES: Record<string, { name: string; category: string }[]> = Object.fromEntries(
  ["Domain", "Epic", "Feature", "User Story", "Task", "Bug"].map((t) => [t, [{ name: "New", category: "Proposed" }, { name: "Active", category: "InProgress" }, { name: "Resolved", category: "Resolved" }, { name: "Closed", category: "Completed" }, { name: "Removed", category: "Removed" }]]),
);
const T = "Microsoft.VSTS.Scheduling.TargetDate";
const S = "Microsoft.VSTS.Scheduling.StartDate";
const AC = "Microsoft.VSTS.Common.AcceptanceCriteria";
export const sizeRefOf = (k: DemoClientKey) => (k === "Harbor" ? "Microsoft.VSTS.Scheduling.Effort" : "Microsoft.VSTS.Scheduling.StoryPoints");
const PORTFOLIO = new Set(["Domain", "Epic", "Feature"]);
const typeFields = (k: DemoClientKey, type: string) => ["System.Title", "System.Description", "System.AssignedTo", "System.State", T, ...(PORTFOLIO.has(type) ? [S] : [AC, sizeRefOf(k)]), /* TX-1: one client whose stories have Remaining Work, and others that take a comment instead. */ ...(k === "Cooptimize" && !PORTFOLIO.has(type) ? ["Microsoft.VSTS.Scheduling.RemainingWork"] : []), ...(type === "Bug" ? ["Microsoft.VSTS.TCM.ReproSteps"] : [])];
const FIELDS = [
  { referenceName: "System.Title", name: "Title", type: "string" },
  { referenceName: T, name: "Target Date", type: "dateTime" },
  { referenceName: S, name: "Start Date", type: "dateTime" },
  { referenceName: AC, name: "Acceptance Criteria", type: "html" },
  { referenceName: "Microsoft.VSTS.Scheduling.StoryPoints", name: "Story Points", type: "double" },
  { referenceName: "Microsoft.VSTS.Scheduling.Effort", name: "Effort", type: "double" },
];
const PC = {
  requirementBacklog: { name: "Stories", defaultWorkItemType: { name: "User Story" }, workItemTypes: [{ name: "User Story" }] },
  taskBacklog: { name: "Tasks", workItemTypes: [{ name: "Task" }] },
  bugWorkItems: { name: "Bugs", defaultWorkItemType: { name: "Bug" }, workItemTypes: [{ name: "Bug" }] },
  portfolioBacklogs: [
    { name: "Epics", defaultWorkItemType: { name: "Epic" }, workItemTypes: [{ name: "Epic" }] },
    { name: "Features", defaultWorkItemType: { name: "Feature" }, workItemTypes: [{ name: "Feature" }] },
  ],
};

/** QC-1: Cooptimize's demo process has Domain above Epic (the read side's demoProcess says the same). */
const pcOf = (k: DemoClientKey) => (k === "Cooptimize" ? { ...PC, portfolioBacklogs: [{ name: "Domains", defaultWorkItemType: { name: "Domain" }, workItemTypes: [{ name: "Domain" }] }, ...PC.portfolioBacklogs] } : PC);

/** Where an item lives, as a URL (the demo's fictional orgs; nothing is ever fetched from it). */
export const itemUrlOf = (k: DemoClientKey, id: number) => {
  const c = DEMO_CLIENTS.find((x) => x.key === k)!;
  return `https://dev.azure.com/${c.org}/${encodeURIComponent(c.project)}/_workitems/edit/${id}`;
};
const apiUrl = (org: string, id: number) => `https://dev.azure.com/${org}/_apis/wit/workItems/${id}`;
const day = (v: unknown): string | null => (typeof v === "string" && v ? v.slice(0, 10) : null);
const dateField = (d: string | null) => (d ? `${d}T00:00:00Z` : undefined);
const plain = (html: string) => html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(div|p|li)>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\n{3,}/g, "\n\n").trim();

export type DemoDevOps = ReturnType<typeof createDemoDevOps>;

/**
 * `people`: the names the demo knows for DevOps emails (an assignee written by email reads back as a person).
 * `now`: the demo's clock, for changed dates and comments.
 */
export function createDemoDevOps(o: { items: DemoItem[]; people: Record<string, string>; now: () => string }) {
  const items = new Map<number, DemoItem>(o.items.map((i) => [i.id, { ...i, relations: [...i.relations] }]));
  const comments = new Map<number, DemoComment[]>();
  /** SR-1: the demo's change log of story states and comments (seeded), mine or a teammate's; never who beyond that. */
  const activityRows: { clientKey: DemoClientKey; itemId: number; kind: "state" | "comments"; oldValue: string | null; newValue: string | null; changedAt: string; mine: boolean }[] = [];
  const attachments = new Set<string>();
  let nextId = 5100;
  let nextComment = 7000;
  let nextAttachment = 1;
  /** Every request this DevOps answered (method and path only), for the tests. */
  const seen: { method: string; path: string }[] = [];
  const orgOf = (k: DemoClientKey) => DEMO_CLIENTS.find((c) => c.key === k)!.org;
  const clientOfOrg = (org: string) => DEMO_CLIENTS.find((c) => c.org === org)?.key ?? null;
  const nameOf = (email: string | null) => (!email ? null : email.toLowerCase() === ME_EMAIL ? ME : (o.people[email.toLowerCase()] ?? email.split("@")[0]!));
  const identity = (i: DemoItem) => (i.who ? { displayName: i.who === ME ? ME_NAME : i.who, uniqueName: i.whoEmail ?? "" } : undefined);

  function fields(i: DemoItem): Record<string, unknown> {
    const f: Record<string, unknown> = {
      "System.Id": i.id, "System.Rev": i.rev, "System.WorkItemType": i.type, "System.State": i.state, "System.Title": i.title,
      "System.Description": i.description, "System.AreaPath": i.area, "System.IterationPath": i.iteration, "System.ChangedDate": i.changedAt,
      "System.TeamProject": DEMO_CLIENTS.find((c) => c.key === i.clientKey)!.project, "Microsoft.VSTS.Common.StackRank": i.order,
    };
    const who = identity(i);
    if (who) f["System.AssignedTo"] = who;
    if (i.parent !== null) f["System.Parent"] = i.parent;
    if (i.target) f[T] = dateField(i.target);
    if (i.start) f[S] = dateField(i.start);
    if (i.size !== null) f[sizeRefOf(i.clientKey)] = i.size;
    if (i.acceptance) f[AC] = i.acceptance;
    if (i.remainingWork != null) f["Microsoft.VSTS.Scheduling.RemainingWork"] = i.remainingWork;
    if (i.createdBy) f["System.CreatedBy"] = i.createdBy;
    if (i.tags?.length) f["System.Tags"] = i.tags.join("; ");
    return f;
  }
  const relationsOf = (i: DemoItem) => [...(i.parent !== null ? [{ rel: "System.LinkTypes.Hierarchy-Reverse", url: apiUrl(orgOf(i.clientKey), i.parent) }] : []), ...[...items.values()].filter((c) => c.parent === i.id).map((c) => ({ rel: "System.LinkTypes.Hierarchy-Forward", url: apiUrl(orgOf(i.clientKey), c.id) })), ...i.relations];
  const view = (i: DemoItem) => ({ id: i.id, rev: i.rev, fields: fields(i), relations: relationsOf(i), url: apiUrl(orgOf(i.clientKey), i.id) });
  /** DV-2: each client's version moves on every change to one of its items (a write, a create, a teammate's change). */
  const versions = new Map<DemoClientKey, number>();
  /** DV-2: the items changed since the client's last Refresh, for "DevOps checked just now · 3 changes". */
  const changedSince = new Map<DemoClientKey, Set<number>>();
  const mark = (k: DemoClientKey, id: number) => {
    versions.set(k, (versions.get(k) ?? 0) + 1);
    (changedSince.get(k) ?? changedSince.set(k, new Set()).get(k)!).add(id);
  };
  const bump = (i: DemoItem) => {
    i.rev++;
    i.changedAt = o.now();
    mark(i.clientKey, i.id);
  };
  /** One field set the way DevOps would store it. */
  function setField(i: DemoItem, k: string, v: unknown, remove = false): void {
    if (k === "System.Title") i.title = String(v ?? "");
    else if (k === "System.State") i.state = String(v ?? i.state);
    else if (k === "System.Description") i.description = remove ? "" : String(v ?? "");
    else if (k === AC) i.acceptance = remove ? "" : String(v ?? "");
    else if (k === T) i.target = remove ? null : day(v);
    else if (k === S) i.start = remove ? null : day(v);
    else if (k === "Microsoft.VSTS.Scheduling.RemainingWork") i.remainingWork = remove || v === null ? null : Number(v);
    else if (k === sizeRefOf(i.clientKey)) i.size = remove || v === null || v === "" ? null : Number(v);
    else if (k === "System.Tags") i.tags = remove ? [] : String(v ?? "").split(";").map((t) => t.trim()).filter(Boolean);
    else if (k === "System.AreaPath") i.area = String(v ?? i.area);
    else if (k === "System.IterationPath") i.iteration = String(v ?? i.iteration);
    else if (k === "System.AssignedTo") {
      const email = remove || v === "" || v === null ? null : typeof v === "string" ? v : ((v as { uniqueName?: string }).uniqueName ?? null);
      i.whoEmail = email ? email.toLowerCase() : null;
      i.who = nameOf(i.whoEmail);
    }
  }

  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json; charset=utf-8" } });

  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const method = (init?.method ?? "GET").toUpperCase();
    // Only the demo's own fictional orgs on dev.azure.com, ever. Anything else throws before anything happens.
    const org = url.pathname.split("/")[1] ?? "";
    const clientKey = url.hostname === "dev.azure.com" ? clientOfOrg(org) : null;
    if (!clientKey) throw new TypeError("The demo's DevOps answers only the demo's own organizations");
    seen.push({ method, path: url.pathname });
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : null;
    const raw = init?.body instanceof Uint8Array ? init.body : null;
    if (url.pathname === `/${org}/_apis/connectionData`) return json({ authenticatedUser: { id: `00000000-0000-4000-8000-${String(DEMO_CLIENTS.findIndex((c) => c.key === clientKey) + 1).padStart(12, "0")}`, providerDisplayName: ME_NAME, properties: { Account: { $type: "System.String", $value: ME_EMAIL } } } });
    if (url.pathname === `/${org}/_apis/wit/attachments` && method === "POST") {
      if (!raw) return json({ message: "The upload has no file" }, 400);
      const id = `dddddddd-0000-4000-8000-${String(nextAttachment++).padStart(12, "0")}`;
      attachments.add(id);
      return json({ id, url: `https://dev.azure.com/${org}/_apis/wit/attachments/${id}?fileName=${encodeURIComponent(url.searchParams.get("fileName") ?? "file")}` }, 201);
    }
    const rest = url.pathname.split("/").slice(3).map(decodeURIComponent).join("/");
    if (rest === "_apis/work/processconfiguration") return json(pcOf(clientKey));
    if (rest === "_apis/wit/fields") return json({ value: FIELDS });
    let m = /^_apis\/wit\/workitemtypes\/(.+)\/states$/.exec(rest);
    if (m) return json({ value: STATES[m[1]!] ?? [] });
    m = /^_apis\/wit\/workitemtypes\/(.+)\/fields$/.exec(rest);
    if (m) return json({ value: typeFields(clientKey, m[1]!).map((referenceName) => ({ referenceName })) });
    if (rest === "_apis/wit/wiql") {
      // The create's "did it land already?" check: by parent, type and title, among the items I created.
      const q = String((body as { query?: unknown } | null)?.query ?? "");
      const parent = Number(/\[System\.Parent\] = (\d+)/.exec(q)?.[1] ?? NaN);
      const type = /\[System\.WorkItemType\] = '((?:[^']|'')*)'/.exec(q)?.[1]?.replace(/''/g, "'");
      const title = /\[System\.Title\] = '((?:[^']|'')*)'/.exec(q)?.[1]?.replace(/''/g, "'");
      return json({ workItems: [...items.values()].filter((i) => i.clientKey === clientKey && (Number.isNaN(parent) ? i.parent === null : i.parent === parent) && (!type || i.type === type) && i.title === title && i.createdBy === ME_EMAIL).map((i) => ({ id: i.id })) });
    }
    m = /^_apis\/wit\/workitems\/\$(.+)$/.exec(rest);
    if (m && method === "POST") {
      const it: DemoItem = { clientKey, id: nextId++, rev: 1, type: m[1]!, state: "New", parent: null, title: "", who: null, whoEmail: null, target: null, start: null, size: null, changedAt: o.now(), order: Math.max(0, ...[...items.values()].filter((i) => i.clientKey === clientKey).map((i) => i.order)) + 1, blocked: false, description: "", acceptance: "", projectOnly: false, createdBy: ME_EMAIL, area: DEMO_CLIENTS.find((c) => c.key === clientKey)!.project, iteration: DEMO_CLIENTS.find((c) => c.key === clientKey)!.project, relations: [] };
      for (const op of body as { op: string; path: string; value: unknown }[]) {
        if (op.path.startsWith("/fields/")) setField(it, op.path.slice(8), op.value);
        else if (op.path === "/relations/-") {
          const r = op.value as { rel: string; url: string; attributes?: unknown };
          if (r.rel === "System.LinkTypes.Hierarchy-Reverse") {
            const pid = Number(/workItems\/(\d+)$/i.exec(r.url)?.[1]);
            const parent = items.get(pid);
            if (!parent || parent.clientKey !== clientKey) return json({ message: "TF401232: the parent work item does not exist" }, 400);
            it.parent = pid;
            bump(parent);
          } else if (r.rel === "AttachedFile") {
            const aid = /attachments\/([0-9a-f-]+)/.exec(r.url)?.[1];
            if (!aid || !attachments.has(aid)) return json({ message: "TF401349: attachment not found" }, 400);
            it.relations.push(r);
          } else it.relations.push(r);
        }
      }
      if (!it.title.trim()) return json({ message: "TF401320: Rule Error for field Title. Error code: Required" }, 400);
      // TP-1: Harbor's demo project doesn't let the demo person add tags it hasn't seen (DevOps' Create tag definition
      // permission), so the New form's "create it without the tag" can be tried. The whole create is refused, as DevOps does.
      const known = new Set([...items.values()].filter((x) => x.clientKey === clientKey).flatMap((x) => x.tags ?? []).map((t) => t.toLowerCase()));
      if (clientKey === "Harbor" && (it.tags ?? []).some((t) => !known.has(t.toLowerCase()))) return json({ message: "You don't have permission to create a new tag in this project. Ask a project administrator for Create tag definition." }, 400);
      items.set(it.id, it);
      mark(clientKey, it.id);
      return json(view(it));
    }
    m = /^_apis\/wit\/workitems\/(\d+)$/i.exec(rest);
    if (m) {
      const it = items.get(Number(m[1]));
      if (!it || it.clientKey !== clientKey) return json({ message: "TF401232: Work item does not exist" }, 404);
      if (method === "GET") return json(view(it));
      if (method === "PATCH") {
        const ops = body as { op: string; path: string; value: unknown }[];
        if (ops.some((op) => op.op === "test" && op.path === "/rev" && op.value !== it.rev)) return json({ message: "TF26071: This work item has been changed by someone else since you opened it." }, 412);
        let commentId: number | null = null;
        for (const op of ops) {
          if (op.op === "test") continue;
          const ri = op.op === "remove" ? /^\/relations\/(\d+)$/.exec(op.path) : null;
          if (ri) {
            // Only the item's own relations (attachments, links) can be removed; the index counts the parent links first.
            const all = relationsOf(it);
            const target = all[Number(ri[1])];
            if (!target) return json({ message: "TF401349: relation index out of range" }, 400);
            it.relations = it.relations.filter((r) => r !== target);
            continue;
          }
          const k = op.path.replace(/^\/fields\//, "");
          if (k === "System.History") {
            commentId = nextComment++;
            (comments.get(it.id) ?? comments.set(it.id, []).get(it.id)!).push({ id: commentId, text: String(op.value), isDeleted: false, createdBy: ME_EMAIL, createdDate: o.now() });
          } else setField(it, k, op.value, op.op === "remove");
        }
        bump(it);
        return json({ ...view(it), ...(commentId ? { commentVersionRef: { commentId, version: 1 } } : {}) });
      }
    }
    m = /^_apis\/wit\/workItems\/(\d+)\/comments(?:\/(\d+))?$/i.exec(rest);
    if (m) {
      const id = Number(m[1]);
      if (!items.has(id)) return json({ message: "TF401232: Work item does not exist" }, 404);
      const list = comments.get(id) ?? comments.set(id, []).get(id)!;
      const cv = (c: DemoComment) => ({ workItemId: id, id: c.id, version: 1, text: c.text, isDeleted: c.isDeleted, createdBy: { uniqueName: c.createdBy, displayName: c.createdByName ?? c.createdBy }, createdDate: c.createdDate, modifiedDate: c.modifiedDate ?? c.createdDate });
      if (!m[2] && method === "POST") {
        const c = { id: nextComment++, text: String((body as { text?: unknown }).text ?? ""), isDeleted: false, createdBy: ME_EMAIL, createdDate: o.now() };
        list.push(c);
        return json(cv(c));
      }
      if (!m[2]) return json({ totalCount: list.length, comments: list.filter((c) => !c.isDeleted).map(cv).reverse() });
      const c = list.find((x) => x.id === Number(m![2]));
      if (!c) return json({ message: "not found" }, 404);
      if (method === "DELETE") {
        c.isDeleted = true;
        return json(cv(c));
      }
      // SR-1: an edit of my own comment (the demo's DevOps refuses anyone else's, as DevOps's UI does).
      if (method === "PATCH") {
        if (c.isDeleted) return json({ message: "not found" }, 404);
        if (c.createdBy.toLowerCase() !== ME_EMAIL.toLowerCase()) return json({ message: "Only the author can edit this comment" }, 403);
        c.text = String((body as { text?: unknown }).text ?? "");
        c.modifiedDate = o.now();
        return json(cv(c));
      }
      if (c.isDeleted && url.searchParams.get("includeDeleted") !== "true") return json({ message: "not found" }, 404);
      return json(cv(c));
    }
    return json({ message: "The demo's DevOps doesn't have that" }, 404);
  }) as typeof fetch;

  /**
   * DV-2: a teammate's change in the demo's DevOps (not through FocusTime): a title, state, assignee (an email, or null
   * for nobody) or target date on an item, or a new item of a type the client's process has, with or without a parent
   * or an assignee. Answers the item's id, or why not in plain words. Fictional, like everything here.
   */
  function teammate(k: DemoClientKey, c: TeammateChange | null): { ok: true; id: number } | { ok: false; error: string } {
    if (!c) return { ok: false, error: "That isn't a change the demo's DevOps takes" };
    const by = Object.keys(o.people).find((e) => e !== ME_EMAIL) ?? "teammate@example.com";
    if ("create" in c) {
      const x = c.create;
      if (!STATES[x.type]) return { ok: false, error: `The demo's process has no ${x.type}` };
      if (!x.title.trim()) return { ok: false, error: "A new item needs a title" };
      const parent = x.parent != null ? items.get(x.parent) : null;
      if (x.parent != null && (!parent || parent.clientKey !== k)) return { ok: false, error: `#${x.parent} isn't one of ${k}'s items` };
      const c0 = DEMO_CLIENTS.find((d) => d.key === k)!;
      const it: DemoItem = { clientKey: k, id: nextId++, rev: 1, type: x.type, state: "New", parent: parent?.id ?? null, title: x.title.trim(), who: null, whoEmail: null, target: x.target ?? null, start: null, size: null, changedAt: o.now(), order: Math.max(0, ...[...items.values()].filter((i) => i.clientKey === k).map((i) => i.order)) + 1, blocked: false, description: "", acceptance: "", projectOnly: !!x.outsideScope, createdBy: by, area: parent?.area ?? c0.project, iteration: parent?.iteration ?? c0.project, relations: [] };
      if (x.assignee !== undefined) setField(it, "System.AssignedTo", x.assignee ?? "", x.assignee === null);
      items.set(it.id, it);
      if (parent) bump(parent);
      mark(k, it.id);
      return { ok: true, id: it.id };
    }
    const it = items.get(c.id);
    if (!it || it.clientKey !== k) return { ok: false, error: `#${c.id} isn't one of ${k}'s items` };
    if (c.state !== undefined && !(STATES[it.type] ?? []).some((s) => s.name === c.state)) return { ok: false, error: `${it.type} has no state ${c.state}` };
    if (c.title !== undefined) setField(it, "System.Title", c.title);
    if (c.state !== undefined) setField(it, "System.State", c.state);
    if (c.assignee !== undefined) setField(it, "System.AssignedTo", c.assignee ?? "", c.assignee === null);
    if (c.target !== undefined) setField(it, T, c.target ?? null, c.target === null);
    bump(it);
    return { ok: true, id: it.id };
  }

  return {
    fetch: fetchFn,
    teammate,
    /** DV-2: the client's version (opaque; moves on every change to its items). */
    versionOf: (k: DemoClientKey): string => `v${versions.get(k) ?? 0}`,
    /** DV-2: how many of the client's items changed since the last take, then a fresh start (Refresh's count). */
    takeChanges: (k: DemoClientKey): number => {
      const n = changedSince.get(k)?.size ?? 0;
      changedSince.delete(k);
      return n;
    },
    /** One client's items, in backlog order (every state). */
    items: (k: DemoClientKey): DemoItem[] => [...items.values()].filter((i) => i.clientKey === k).sort((a, b) => a.order - b.order || a.id - b.id),
    item: (id: number): DemoItem | null => items.get(id) ?? null,
    description: (id: number): string | null => {
      const i = items.get(id);
      return i ? plain(i.description) : null;
    },
    acceptance: (id: number): string | null => {
      const i = items.get(id);
      return i ? plain(i.acceptance) : null;
    },
    /** SR-1: its comments as Status reads them (author, created and modified), newest first. */
    reportComments: (id: number) => (comments.get(id) ?? []).filter((c) => !c.isDeleted).map((c) => ({ id: c.id, text: c.text, authorName: c.createdByName ?? (c.createdBy.toLowerCase() === ME_EMAIL ? ME_NAME : nameOf(c.createdBy) ?? "Someone"), authorUnique: c.createdBy, createdAt: c.createdDate, modifiedAt: c.modifiedDate ?? c.createdDate })).reverse(),
    /** SR-1 (seeds/status.ts): a comment someone wrote earlier, as DevOps would hold it. */
    seedComment: (id: number, c: { text: string; by: string; byName: string; at: string; /** SR-2: edited later (Kat counts it by this). */ modifiedAt?: string }) => {
      const list = comments.get(id) ?? comments.set(id, []).get(id)!;
      list.push({ id: nextComment++, text: c.text, isDeleted: false, createdBy: c.by, createdByName: c.byName, createdDate: c.at, modifiedDate: c.modifiedAt ?? c.at });
    },
    activity: (k: DemoClientKey) => activityRows.filter((r) => r.clientKey === k).map(({ clientKey: _k, ...r }) => r),
    seedActivity: (r: (typeof activityRows)[number]) => void activityRows.push(r),
    /** FN-1: the story card's comments, newest first, with the author's name and the HTML as DevOps holds it. */
    cardComments: (id: number) => (comments.get(id) ?? []).filter((c) => !c.isDeleted).map((c) => ({ id: c.id, author: c.createdByName ?? (c.createdBy.toLowerCase() === ME_EMAIL ? ME_NAME : nameOf(c.createdBy) ?? "Someone"), at: c.createdDate, text: c.text })).reverse(),
    /** Its comments, newest first, as plain text. */
    comments: (id: number) => (comments.get(id) ?? []).filter((c) => !c.isDeleted).map((c) => ({ at: c.createdDate, text: plain(c.text) })).reverse(),
    seen,
  };
}
