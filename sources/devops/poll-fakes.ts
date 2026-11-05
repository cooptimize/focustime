// DV-1: a fake dev.azure.com for the central poller's tests: per org, one Agile project of work items that a test can
// change (each change bumps the revision and System.ChangedDate), the changed-since and scope WIQL queries, the batch
// read (only the fields asked for; a deleted item is omitted), and the rate-limit headers or a refusal on demand.
// Test-only.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const fx = (name: string) => readFileSync(join(import.meta.dirname, "fixtures", `${name}.json`), "utf8");
const FIELDS = [
  { referenceName: "System.Title", name: "Title", type: "string" },
  { referenceName: "Microsoft.VSTS.Scheduling.StartDate", name: "Start Date", type: "dateTime" },
  { referenceName: "Microsoft.VSTS.Scheduling.TargetDate", name: "Target Date", type: "dateTime" },
  { referenceName: "Microsoft.VSTS.Scheduling.StoryPoints", name: "Story Points", type: "double" },
];

export type FakeItem = { id: number; type: string; state: string; title: string; parent?: number | null; assignee?: { name: string; email: string } | null; target?: string | null; comments?: number; rev: number; changedAt: string; createdAt: string; changedBy?: { name: string; email: string }; project?: string; /** AH-2: its area path (the project root by default). */ area?: string };

export type OrgSetup = {
  project: string;
  items: FakeItem[];
  /** Headers added to every answer (rate limits). */
  headers?: Record<string, string>;
  /** Answer every request with this status (401: a bad token; 429: a refusal with `headers`). */
  status?: number;
  /** AH-2: area paths below the root ("Contoso Project\\BI"); the tree is the root alone without them. */
  areas?: string[];
  /** AH-2: teams and their team field values (System.AreaPath unless `field`); none: the teams call answers 401 (a token without Project read). */
  teams?: { name: string; areas: { path: string; sub: boolean }[]; field?: string }[];
};

export type LiveCall = { org: string; op: "wiql" | "batch" | "meta"; query?: string; ids?: number[]; at: string };

export function fakeLiveDevOps(orgs: Record<string, OrgSetup>, clock: () => Temporal.Instant) {
  const calls: LiveCall[] = [];
  const deleted = new Set<string>();
  /** Runs once, after the next WIQL answer is computed and before it is returned (a change landing during a read). */
  let afterWiql: (() => void) | null = null;
  const json = (org: OrgSetup, body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", ...(org.headers ?? {}) } });

  const fieldsOf = (i: FakeItem, project: string): Record<string, unknown> => ({
    "System.Id": i.id,
    "System.Title": i.title,
    "System.WorkItemType": i.type,
    "System.State": i.state,
    "System.ChangedDate": i.changedAt,
    "System.CreatedDate": i.createdAt,
    "System.Rev": i.rev,
    "System.CommentCount": i.comments ?? 0,
    "System.TeamProject": i.project ?? project,
    "Microsoft.VSTS.Common.StackRank": i.id,
    ...(i.parent ? { "System.Parent": i.parent } : {}),
    "System.AreaPath": i.area ?? project,
    ...(i.assignee ? { "System.AssignedTo": { displayName: i.assignee.name, uniqueName: i.assignee.email } } : {}),
    ...(i.target ? { "Microsoft.VSTS.Scheduling.TargetDate": i.target } : {}),
    ...(i.changedBy ? { "System.ChangedBy": { displayName: i.changedBy.name, uniqueName: i.changedBy.email } } : {}),
  });

  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname !== "dev.azure.com") throw new TypeError("unexpected host");
    const [org, , ...rest] = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    const path = rest.join("/");
    const o = orgs[org ?? ""];
    if (!o) return new Response("", { status: 404 });
    const at = clock().toString();
    if (o.status && o.status !== 200) {
      calls.push({ org: org!, op: path.includes("wiql") ? "wiql" : path.includes("batch") ? "batch" : "meta", at });
      return new Response(o.status === 401 ? "<html>no</html>" : "", { status: o.status, headers: o.headers ?? {} });
    }
    if (path === "_apis/work/processconfiguration") return calls.push({ org: org!, op: "meta", at }), json(o, JSON.parse(fx("agile-processconfiguration")));
    if (path === "_apis/wit/workitemtypes") return calls.push({ org: org!, op: "meta", at }), json(o, JSON.parse(fx("agile-workitemtypes")));
    if (path === "_apis/wit/fields") return calls.push({ org: org!, op: "meta", at }), json(o, { value: FIELDS });
    if (/^_apis\/wit\/workitemtypes\/.+\/fields$/.test(path)) return calls.push({ org: org!, op: "meta", at }), json(o, { value: FIELDS.map(({ referenceName, name }) => ({ referenceName, name })) });
    if (path === "_apis/wit/wiql") {
      const query = (JSON.parse(String(init?.body)) as { query: string }).query;
      calls.push({ org: org!, op: "wiql", query, at });
      const live = o.items.filter((i) => !deleted.has(`${org}#${i.id}`) && (i.project ?? o.project) === o.project);
      const since = query.match(/\[System\.ChangedDate\] >= '([^']+)'/)?.[1];
      let ids: number[];
      if (since) ids = live.filter((i) => Date.parse(i.changedAt) >= Date.parse(since)).sort((a, b) => Date.parse(a.changedAt) - Date.parse(b.changedAt)).map((i) => i.id);
      else {
        // The scope: open (not Closed or Removed) or changed in the last 90 days.
        const keep = clock().subtract({ hours: 24 * 90 }).epochMilliseconds;
        ids = live.filter((i) => !["Closed", "Removed"].includes(i.state) || Date.parse(i.changedAt) >= keep).map((i) => i.id);
      }
      const body = { asOf: at, workItems: ids.map((id) => ({ id })) };
      const hook = afterWiql;
      afterWiql = null;
      hook?.();
      return json(o, body);
    }
    if (path === "_apis/wit/workitemsbatch") {
      const b = JSON.parse(String(init?.body)) as { ids: number[]; fields: string[] };
      calls.push({ org: org!, op: "batch", ids: b.ids, at });
      const value = b.ids
        .map((id) => o.items.find((i) => i.id === id))
        .filter((i): i is FakeItem => !!i && !deleted.has(`${org}#${i.id}`))
        .map((i) => ({ id: i.id, rev: i.rev, fields: Object.fromEntries(Object.entries(fieldsOf(i, o.project)).filter(([k]) => b.fields.includes(k))) }));
      return json(o, { count: value.length, value });
    }
    // AH-2: the area tree, the teams and each team's field values.
    if (path === "_apis/wit/classificationnodes/Areas") {
      calls.push({ org: org!, op: "meta", at });
      type Node = { name: string; children?: Node[] };
      const root: Node = { name: o.project };
      for (const full of o.areas ?? []) {
        let at2 = root;
        for (const part of full.split("\\").slice(1)) {
          at2.children ??= [];
          at2 = at2.children.find((c) => c.name === part) ?? (at2.children.push({ name: part }), at2.children[at2.children.length - 1]!);
        }
      }
      return json(o, root);
    }
    if (path === `projects/${o.project}/teams`) {
      calls.push({ org: org!, op: "meta", at });
      return o.teams ? json(o, { count: o.teams.length, value: o.teams.map((t) => ({ name: t.name })) }) : new Response("<html>sign in</html>", { status: 401 });
    }
    const tf = path.match(/^(.+)\/_apis\/work\/teamsettings\/teamfieldvalues$/);
    if (tf) {
      calls.push({ org: org!, op: "meta", at });
      const t = o.teams?.find((x) => x.name === tf[1]);
      if (!t) return new Response("", { status: 404 });
      return json(o, { field: { referenceName: t.field ?? "System.AreaPath" }, defaultValue: t.areas[0]?.path ?? o.project, values: t.areas.map((a) => ({ value: a.path, includeChildren: a.sub })) });
    }
    // The project and the default team: not there (the process configuration decides), as some orgs answer.
    return new Response("", { status: 404, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  return {
    fetch: fn,
    calls,
    /** Changes an item in DevOps now: the revision goes up and the changed date is now (or `at`). */
    change(org: string, id: number, patch: Partial<FakeItem>, at?: string) {
      const i = orgs[org]!.items.find((x) => x.id === id)!;
      Object.assign(i, patch, { rev: i.rev + 1, changedAt: at ?? clock().toString() });
    },
    add(org: string, item: Omit<FakeItem, "rev" | "changedAt" | "createdAt">) {
      const at = clock().toString();
      orgs[org]!.items.push({ ...item, rev: 1, changedAt: at, createdAt: at });
    },
    remove(org: string, id: number) {
      deleted.add(`${org}#${id}`);
    },
    duringNextWiql(fn: () => void) {
      afterWiql = fn;
    },
    reset() {
      calls.length = 0;
    },
  };
}

/** A work item in the fake, changed some time ago. */
export function aFakeItem(o: Partial<FakeItem> & { id: number }): FakeItem {
  return { type: "User Story", state: "Active", title: `Item ${o.id}`, rev: 1, changedAt: "2026-11-01T12:00:00Z", createdAt: "2026-10-01T12:00:00Z", ...o };
}
