// A fake dev.azure.com that serves the fixtures per org and fails on demand. Test-only.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pat } from "./pat.ts";
import type { DevOpsTarget } from "./types.ts";

export type OrgScenario =
  | "agile"
  | "scrum"
  | "custom"
  | "pat_expired" // 401
  | "signin_203" // 203 with an HTML sign-in page
  | "signin_redirect" // 302 to the sign-in host
  | "html_200" // 200 but not JSON
  | "no_access" // 404 on the project
  | "forbidden" // 403
  | "offline" // network down
  | "host_not_found" // ENOTFOUND
  | "server_error" // 500
  | "batch_fails" // metadata and WIQL work, the batch call fails
  | "portfolio"
  | "planweek" // agile; Plan the week (step 8): features I own, features that are parents of my stories, an epic with no open features
  | "no_story_level" // agile, but the process configuration lists no requirement, task or bug backlog (Q47)
  | "flaky"; // agile, but the first try of every request fails at the network level (a blip) // agile process; I own a feature with children, an epic with a feature and a story below it, and a feature with none

/** Work items for the "portfolio" scenario: id → [type, state, parent, title]. */
export const PORTFOLIO: Record<number, [string, string, number | null, string]> = {
  101: ["User Story", "Active", null, "Story assigned to me"],
  110: ["Feature", "Active", null, "Feature I own"],
  111: ["User Story", "New", 110, "Child story of 110"],
  112: ["Bug", "Active", 110, "Child bug of 110"],
  120: ["Epic", "New", null, "Epic I own"],
  121: ["Feature", "New", 120, "Feature under the epic"],
  122: ["User Story", "New", 121, "Story two levels down"],
  130: ["Feature", "New", null, "Feature with no children"],
};
const MINE = [110, 101, 120, 130];

/**
 * Plan the week (step 8): id → [type, state, parent, title, assignee display name or null, target date or null].
 * Mine (open, assigned to me): 201, 202, 203, 204, 240, 250.
 */
export const PLANWEEK: Record<number, [string, string, number | null, string, string | null, string | null]> = {
  201: ["User Story", "Active", 210, "My story under Dana's feature", "Avery S", null],
  202: ["User Story", "New", 220, "My story under an unassigned feature", "Avery S", null],
  203: ["Task", "Active", 201, "My task under my story", "Avery S", null],
  204: ["User Story", "Active", null, "My story with no parent", "Avery S", null],
  210: ["Feature", "Active", 230, "Dana's feature", "Dana Ruiz", "2026-11-20T05:00:00Z"],
  211: ["User Story", "Closed", 210, "Done story", "Dana Ruiz", null],
  212: ["User Story", "New", 210, "Unassigned story", null, null],
  220: ["Feature", "New", null, "Unassigned feature", null, null],
  230: ["Epic", "Active", null, "Dana's epic", "Dana Ruiz", null],
  240: ["Feature", "Active", null, "My feature with no stories", "Avery S", null],
  250: ["Epic", "New", null, "My epic", "Avery S", null],
  251: ["Feature", "Closed", 250, "Finished feature", "Dana Ruiz", null],
};
const PLANWEEK_MINE = [240, 201, 202, 250, 203, 204];
const PLANWEEK_FIELDS = [
  { referenceName: "System.Title", name: "Title", type: "string" },
  { referenceName: "Microsoft.VSTS.Scheduling.StartDate", name: "Start Date", type: "dateTime" },
  { referenceName: "Microsoft.VSTS.Scheduling.TargetDate", name: "Target Date", type: "dateTime" },
  { referenceName: "Microsoft.VSTS.Common.ClosedDate", name: "Closed Date", type: "dateTime" },
  { referenceName: "Microsoft.VSTS.Scheduling.StoryPoints", name: "Story Points", type: "double" },
];

const fx = (name: string) => readFileSync(join(import.meta.dirname, "fixtures", `${name}.json`), "utf8");

export type Call = { url: string; method: string; authorization: string | null; body: string | null; redirect: string | undefined };

/** Unique, recognizable fake PATs (84 chars, like real ones). */
export const fakePat = (label: string) => `FAKEPAT${label.toUpperCase().replace(/[^A-Z0-9]/g, "")}`.padEnd(76, "x") + "AZDO" + "yyyy";

export function fakeDevOps(orgs: Record<string, OrgScenario>, opts: { ids?: number } = {}) {
  const calls: Call[] = [];
  const flakySeen = new Set<string>();
  const json = (body: string, status = 200) => new Response(body, { status, headers: { "content-type": "application/json; charset=utf-8" } });
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    calls.push({ url: url.toString(), method: init?.method ?? "GET", authorization: headers.get("authorization"), body: typeof init?.body === "string" ? init.body : null, redirect: init?.redirect });
    if (url.hostname !== "dev.azure.com") throw new TypeError("unexpected host");
    const [org, , ...rest] = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    const path = rest.join("/");
    let scenario = orgs[org ?? ""];
    if (!scenario) return new Response("", { status: 404 });
    if (scenario === "flaky") {
      const key = `${init?.method ?? "GET"} ${url}`;
      if (!flakySeen.has(key)) {
        flakySeen.add(key);
        throw new TypeError("fetch failed");
      }
      scenario = "agile";
    }
    // Every reply below is HTML or JSON that must never be read into a message.
    switch (scenario) {
      case "offline":
        throw new TypeError("fetch failed");
      case "host_not_found":
        throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } });
      case "pat_expired":
        return new Response("<html>TF400813: The user is not authorized</html>", { status: 401 });
      case "signin_203":
        return new Response("<html>Sign in to your account</html>", { status: 203, headers: { "content-type": "text/html" } });
      case "signin_redirect":
        return new Response(null, { status: 302, headers: { location: "https://spsprodcus5.vssps.visualstudio.com/_signin" } });
      case "html_200":
        return new Response("<html>Sign in</html>", { status: 200, headers: { "content-type": "text/html" } });
      case "no_access":
        return json('{"message":"TF200016: The following project does not exist"}', 404);
      case "forbidden":
        return json('{"message":"denied"}', 403);
      case "server_error":
        return json('{"message":"boom"}', 500);
    }
    const proc = scenario === "batch_fails" || scenario === "portfolio" || scenario === "planweek" || scenario === "no_story_level" ? "agile" : scenario;
    if (scenario === "planweek") {
      if (path === "_apis/wit/wiql") {
        const q = (JSON.parse(String(init?.body)) as { query: string }).query;
        const parents = q.match(/\[System\.Parent\] IN \(([\d, ]+)\)/)?.[1]?.split(",").map(Number);
        const ids = parents ? Object.entries(PLANWEEK).filter(([, v]) => v[2] !== null && parents.includes(v[2])).map(([k]) => Number(k)) : PLANWEEK_MINE;
        return json(JSON.stringify({ workItems: ids.map((id) => ({ id })) }));
      }
      if (path === "_apis/wit/workitemsbatch") {
        const body = JSON.parse(String(init?.body)) as { ids: number[]; fields: string[] };
        const value = body.ids.filter((id) => PLANWEEK[id]).map((id) => {
          const [type, state, parent, title, who, target] = PLANWEEK[id]!;
          const all: Record<string, unknown> = {
            "System.Id": id, "System.Title": title, "System.WorkItemType": type, "System.State": state, "System.ChangedDate": "2026-10-30T15:00:00Z",
            "Microsoft.VSTS.Common.StackRank": id, "System.Description": id === 210 ? "<div>Export the <b>weekly</b> report &amp; email it.</div><ul><li>CSV</li></ul>" : "",
            ...(parent ? { "System.Parent": parent } : {}),
            ...(who ? { "System.AssignedTo": { displayName: who, uniqueName: who === "Avery S" ? `avery@${org}.example` : "dana@client.example" } } : {}),
            ...(target ? { "Microsoft.VSTS.Scheduling.TargetDate": target } : {}),
            ...(id === 201 ? { "Microsoft.VSTS.Scheduling.StoryPoints": 3 } : {}),
          };
          // Only the fields asked for, like DevOps.
          return { id, fields: Object.fromEntries(Object.entries(all).filter(([k]) => body.fields.includes(k))) };
        });
        return json(JSON.stringify({ count: value.length, value }));
      }
      if (path === "_apis/wit/fields") return json(JSON.stringify({ count: PLANWEEK_FIELDS.length, value: PLANWEEK_FIELDS }));
      const typeFields = path.match(/^_apis\/wit\/workitemtypes\/(.+)\/fields$/);
      if (typeFields) return json(JSON.stringify({ value: PLANWEEK_FIELDS.filter((f) => decodeURIComponent(typeFields[1]!) !== "Epic" || f.referenceName !== "Microsoft.VSTS.Scheduling.TargetDate").map(({ referenceName, name }) => ({ referenceName, name })) }));
    }
    if (scenario === "portfolio" && path === "_apis/wit/wiql") {
      const q = (JSON.parse(String(init?.body)) as { query: string }).query;
      const parents = q.match(/\[System\.Parent\] IN \(([\d, ]+)\)/)?.[1]?.split(",").map(Number);
      const ids = parents ? Object.entries(PORTFOLIO).filter(([, v]) => v[2] !== null && parents.includes(v[2])).map(([k]) => Number(k)) : MINE;
      return json(JSON.stringify({ workItems: ids.map((id) => ({ id })) }));
    }
    if (scenario === "portfolio" && path === "_apis/wit/workitemsbatch") {
      const ids = (JSON.parse(String(init?.body)) as { ids: number[] }).ids;
      return json(JSON.stringify({ count: ids.length, value: ids.map((id) => { const [type, state, parent, title] = PORTFOLIO[id]!; return { id, fields: { "System.Id": id, "System.Title": title, "System.WorkItemType": type, "System.State": state, ...(parent ? { "System.Parent": parent } : {}), "Microsoft.VSTS.Common.StackRank": MINE.indexOf(id) + 1 || 50 + id } }; }) }));
    }
    if (path === "_apis/work/processconfiguration") {
      if (scenario === "no_story_level") {
        const pc = JSON.parse(fx("agile-processconfiguration")) as Record<string, unknown>;
        delete pc.requirementBacklog;
        delete pc.taskBacklog;
        delete pc.bugWorkItems;
        return json(JSON.stringify(pc));
      }
      return json(fx(`${proc}-processconfiguration`));
    }
    if (path === "_apis/wit/workitemtypes") return json(fx(`${proc}-workitemtypes`));
    const states = path.match(/^_apis\/wit\/workitemtypes\/(.+)\/states$/);
    if (states) return json(fx(`${proc}-states-${states[1]}`));
    if (path === "_apis/wit/wiql") {
      if (opts.ids) return json(JSON.stringify({ workItems: Array.from({ length: opts.ids }, (_, i) => ({ id: 1000 + i })) }));
      return json(fx(`${proc}-wiql`));
    }
    if (path === "_apis/wit/workitemsbatch") {
      if (scenario === "batch_fails") return json('{"message":"boom"}', 500);
      if (opts.ids) {
        const ids = (JSON.parse(String(init?.body)) as { ids: number[] }).ids;
        return json(JSON.stringify({ count: ids.length, value: ids.map((id) => ({ id, fields: { "System.Id": id, "System.Title": `Item ${id}`, "System.WorkItemType": "Task", "System.State": "Active" } })) }));
      }
      return json(fx(`${proc}-batch`));
    }
    return new Response("", { status: 404 });
  }) as typeof fetch;
  return { fetch: fn, calls };
}

export function target(clientKey: string, org: string, over: Partial<DevOpsTarget> = {}): DevOpsTarget {
  return {
    accountId: `00000000-0000-4000-8000-${String(clientKey.length).padStart(12, "0")}`,
    clientKey,
    clientName: clientKey,
    org,
    project: `${clientKey} Project`,
    projectName: `${clientKey} Project`,
    email: `avery@${org}.example`,
    pat: new Pat(fakePat(clientKey)),
    ...over,
  };
}
