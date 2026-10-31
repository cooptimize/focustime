// Fake Entra token endpoint and Dataverse Web API for tests. Error bodies deliberately echo the
// secret and token so tests prove Coopilot never forwards raw bodies.
import accounts from "./fixtures/accounts.json" with { type: "json" };
import focustimes from "./fixtures/focustimes.json" with { type: "json" };
import type { DataverseConfig } from "../../config/schema.ts";

export const FAKE_SECRET = "FAKE-SECRET-7f3a9c1e";
export const FAKE_TOKEN = "FAKE-TOKEN-91bc44d0";
export const ME = "d0000000-0000-4000-8000-00000000000a";
export const ENV = "https://example.crm.dynamics.com";

export const dvConfig: DataverseConfig = {
  environmentUrl: ENV,
  tenantId: "11111111-1111-4111-8111-111111111111",
  clientId: "22222222-2222-4222-8222-222222222222",
  myEmail: "me@example.com",
  mySystemUserId: ME,
};

export type Scenario =
  | "ok"
  | "paged"
  | "paged_foreign_next"
  | "page_fails"
  | "dv_401"
  | "dv_403"
  | "table_missing"
  | "column_missing"
  | "dv_503"
  | "network_down"
  | "timeout"
  | "token_invalid_client"
  | "token_bad_tenant"
  | "token_bad_scope"
  | "env_not_found"
  | "token_network_down";

export type Call = { url: string; method: string; headers: Record<string, string>; body: string };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const leakyError = (status: number, code: string) =>
  json(status, { error: { code, message: `Echo: Authorization: Bearer ${FAKE_TOKEN} secret=${FAKE_SECRET}` } });

export const FAKE_PAT_CSC = "FAKE-DV-PAT-CSC-0d9e";
export const FAKE_PAT_WC = "FAKE-DV-PAT-WC-41aa";
export const ACCT = { csc: "a0000000-0000-4000-8000-00000000c5c0", wc: "a0000000-0000-4000-8000-0000000000dc", hme: "a0000000-0000-4000-8000-000000000e1e" };
export const accountWorkers = {
  value: [
    { _coop_account_value: ACCT.csc, coop_devopsemail: "t.spaulding@cscsteel.example" },
    { _coop_account_value: ACCT.wc, coop_devopsemail: null },
    { _coop_account_value: ACCT.hme, coop_devopsemail: "c.someone@hme.example" },
  ],
};
export const devopsAccounts = {
  value: [
    { accountid: ACCT.csc, name: "CSC Steel Corporation", coop_reportingnickname: "CSC", coop_devopsorg: "cscsteel", coop_devopsprojectid: "11111111-2222-4333-8444-555555555555", coop_devopsprojectname: "Project Ada", coop_devopstoken: FAKE_PAT_CSC },
    { accountid: ACCT.wc, name: "Woodard and Curran", coop_reportingnickname: "W&C", coop_devopsorg: "cooptimize", coop_devopsprojectid: null, coop_devopsprojectname: "Woodard Curran", coop_devopstoken: FAKE_PAT_WC },
    { accountid: ACCT.hme, name: "HM Electronics", coop_reportingnickname: null, coop_devopsorg: "hme", coop_devopsprojectid: null, coop_devopsprojectname: "DW", coop_devopstoken: "FAKE-DV-PAT-HME-UNNEEDED" },
  ],
};

export function fakeFetch(scenario: Scenario, extra: { users?: unknown[]; devopsAccounts?: unknown } = {}) {
  const calls: Call[] = [];
  const fn = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = String(input);
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    calls.push({ url, method: init.method ?? "GET", headers, body: String(init.body ?? "") });

    if (url.startsWith("https://login.microsoftonline.com/")) {
      if (scenario === "token_network_down") throw new TypeError("fetch failed");
      if (scenario === "token_invalid_client")
        return json(401, { error: "invalid_client", error_description: `AADSTS7000215: Invalid client secret provided: ${FAKE_SECRET}` });
      if (scenario === "token_bad_scope")
        return json(400, { error: "invalid_scope", error_description: "AADSTS500011: The resource principal was not found." });
      if (scenario === "token_bad_tenant")
        return json(400, { error: "invalid_request", error_description: "AADSTS90002: Tenant not found." });
      return json(200, { token_type: "Bearer", expires_in: 3599, access_token: FAKE_TOKEN });
    }

    if (!url.startsWith(`${ENV}/api/data/v9.2/`)) return json(404, {});
    if (scenario === "network_down") throw new TypeError("fetch failed");
    if (scenario === "env_not_found") throw new TypeError("fetch failed", { cause: Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" }) });
    if (scenario === "timeout") throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    if (scenario === "dv_401") return leakyError(401, "0x80072560");
    if (scenario === "dv_403") return leakyError(403, "0x80040220");
    if (scenario === "table_missing") return leakyError(404, "0x8006088a");
    if (scenario === "column_missing") return leakyError(400, "0x80060888");
    if (scenario === "dv_503") return leakyError(503, "0x80040216");

    const path = url.slice(`${ENV}/api/data/v9.2/`.length);
    if (path.startsWith("systemusers")) return json(200, { value: extra.users ?? [{ systemuserid: ME }] });
    if (path.startsWith("coop_accountworkers")) return json(200, accountWorkers);
    if (path.startsWith("accounts") && path.includes("coop_devopstoken")) return json(200, extra.devopsAccounts ?? devopsAccounts);
    if (path.startsWith("accounts")) return json(200, accounts);
    if (path.startsWith("coop_focustimes")) {
      const paged = scenario === "paged" || scenario === "paged_foreign_next" || scenario === "page_fails";
      if (!paged) return json(200, focustimes);
      if (url.includes("$skiptoken=page2")) {
        if (scenario === "page_fails") return leakyError(500, "0x80040216");
        return json(200, { value: focustimes.value.slice(2) });
      }
      const next = scenario === "paged_foreign_next" ? "https://attacker.example.com/steal?$skiptoken=page2" : `${ENV}/api/data/v9.2/coop_focustimes?$skiptoken=page2`;
      return json(200, { value: focustimes.value.slice(0, 2), "@odata.nextLink": next });
    }
    return json(404, {});
  };
  return { fetch: fn as typeof fetch, calls };
}
