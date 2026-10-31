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
  | "batch_fails"; // metadata and WIQL work, the batch call fails

const fx = (name: string) => readFileSync(join(import.meta.dirname, "fixtures", `${name}.json`), "utf8");

export type Call = { url: string; method: string; authorization: string | null; body: string | null; redirect: string | undefined };

/** Unique, recognizable fake PATs (84 chars, like real ones). */
export const fakePat = (label: string) => `FAKEPAT${label.toUpperCase().replace(/[^A-Z0-9]/g, "")}`.padEnd(76, "x") + "AZDO" + "yyyy";

export function fakeDevOps(orgs: Record<string, OrgScenario>, opts: { ids?: number } = {}) {
  const calls: Call[] = [];
  const json = (body: string, status = 200) => new Response(body, { status, headers: { "content-type": "application/json; charset=utf-8" } });
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    calls.push({ url: url.toString(), method: init?.method ?? "GET", authorization: headers.get("authorization"), body: typeof init?.body === "string" ? init.body : null, redirect: init?.redirect });
    if (url.hostname !== "dev.azure.com") throw new TypeError("unexpected host");
    const [org, , ...rest] = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    const path = rest.join("/");
    const scenario = orgs[org ?? ""];
    if (!scenario) return new Response("", { status: 404 });
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
    const proc = scenario === "batch_fails" ? "agile" : scenario;
    if (path === "_apis/work/processconfiguration") return json(fx(`${proc}-processconfiguration`));
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
    email: `tanner@${org}.example`,
    pat: new Pat(fakePat(clientKey)),
    ...over,
  };
}
