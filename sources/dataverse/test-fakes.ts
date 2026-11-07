// Fake Entra token endpoint and Dataverse Web API for tests. Error bodies deliberately echo the
// secret and token so tests prove FocusTime never forwards raw bodies.
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

export const FAKE_PAT_Adatum = "FAKE-DV-PAT-Adatum-0d9e";
export const FAKE_PAT_WC = "FAKE-DV-PAT-WC-41aa";
export const ACCT = { adatum: "a0000000-0000-4000-8000-00000000c5c0", tw: "a0000000-0000-4000-8000-0000000000dc", litware: "a0000000-0000-4000-8000-000000000e1e" };
export const accountWorkers = {
  value: [
    { _coop_account_value: ACCT.adatum, coop_devopsemail: "me@contoso.example" },
    { _coop_account_value: ACCT.tw, coop_devopsemail: null },
    { _coop_account_value: ACCT.litware, coop_devopsemail: "c.someone@litware.example" },
  ],
};
/**
 * T&W focus time for me that starts the week after the test week (Nov 9), so the fixture weeks are unchanged.
 * Returned only when the query's dates include it, as Dataverse would: the following read (step 6d) sees it, a
 * week read for Nov 2 doesn't.
 */
export const WC_FOCUS = {
  "@odata.etag": 'W/"1000009"', coop_focustimeid: "f0000000-0000-4000-8000-000000000009", _coop_account_value: null, _coop_systemuser_value: null,
  _coop_accountworker_value: "a0000000-0000-4000-8000-000000000009", coop_startdate: "2026-11-09", coop_enddate: null,
  coop_mondaydaypart: null, coop_tuesdaydaypart: 2, coop_wednesdaydaypart: null, coop_thursdaydaypart: null, statecode: 0,
  coop_AccountWorker: { _coop_user_value: ME, _coop_account_value: ACCT.tw, coop_accountworkerid: "a0000000-0000-4000-8000-000000000009" },
};
const TW_ACCOUNT = { accountid: ACCT.tw, name: "Tailspin & Wingtip", coop_reportingnickname: "T&W" };
export const devopsAccounts = {
  value: [
    { accountid: ACCT.adatum, name: "Adatum Example Corp", coop_reportingnickname: "Adatum", coop_devopsorg: "contoso", coop_devopsprojectid: "11111111-2222-4333-8444-555555555555", coop_devopsprojectname: "Project Ada", coop_devopstoken: FAKE_PAT_Adatum },
    { accountid: ACCT.tw, name: "Tailspin & Wingtip", coop_reportingnickname: "T&W", coop_devopsorg: "cooptimize", coop_devopsprojectid: null, coop_devopsprojectname: "TW Project", coop_devopstoken: FAKE_PAT_WC },
    { accountid: ACCT.litware, name: "Litware Electronics", coop_reportingnickname: null, coop_devopsorg: "litware", coop_devopsprojectid: null, coop_devopsprojectname: "Ledger", coop_devopstoken: "FAKE-DV-PAT-Litware-UNNEEDED" },
  ],
};

/** PTO (step 6): Thu Nov 5 with a detail row; Mon Nov 16 to Tue Nov 17 with no detail rows (both days off, D109). */
export const PTO_TRACKERS = {
  value: [
    { coop_timeofftrackerid: "aaaaaaaa-0000-4000-8000-000000000005", coop_timeoffstartdate: "2026-11-05", coop_enddate: "2026-11-05", coop_title: "Watch Kids" },
    { coop_timeofftrackerid: "aaaaaaaa-0000-4000-8000-000000000016", coop_timeoffstartdate: "2026-11-16", coop_enddate: "2026-11-17", coop_title: "Trip" },
  ],
};
export const PTO_DETAILS = { value: [{ _coop_timeofftracker_value: "aaaaaaaa-0000-4000-8000-000000000005", coop_date: "2026-11-05" }] };

export function fakeFetch(scenario: Scenario, extra: { users?: unknown[]; devopsAccounts?: unknown; pto?: "ok" | "none" | "forbidden"; missing?: string } = {}) {
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
    // A renamed column: any query naming it in $select or $filter gets 400 (as the real environment does).
    const missing = scenario === "column_missing" ? "coop_mondaydaypart" : extra.missing;
    if (missing && new RegExp(`[=,( ]${missing}[,&) ]`).test(`${decodeURIComponent(url)} `)) return leakyError(400, "0x80060888");
    if (scenario === "dv_503") return leakyError(503, "0x80040216");

    const path = url.slice(`${ENV}/api/data/v9.2/`.length);
    if (path.startsWith("systemusers")) return json(200, { value: extra.users ?? [{ systemuserid: ME }] });
    if (path.startsWith("coop_accountworkers")) return json(200, accountWorkers);
    if (path.startsWith("accounts") && path.includes("coop_devopstoken")) return json(200, extra.devopsAccounts ?? devopsAccounts);
    // My clients (Q21): same accounts, never with the token.
    if (path.startsWith("accounts") && path.includes("coop_devopsorg")) return json(200, { value: devopsAccounts.value.map(({ coop_devopstoken: _t, ...rest }) => rest) });
    if (path.startsWith("accounts")) return json(200, decodeURIComponent(path).includes(ACCT.tw) ? { value: [...accounts.value, TW_ACCOUNT] } : accounts);
    if (path.startsWith("coop_timeofftracker")) {
      if (extra.pto === "forbidden") return leakyError(403, "0x80040220");
      if (extra.pto === "none") return json(200, { value: [] });
      // Only my rows: the filter must name my systemuserid.
      if (path.startsWith("coop_timeofftrackers?")) return json(200, decodeURIComponent(path).includes(`_coop_employee_value eq ${ME}`) ? PTO_TRACKERS : { value: [] });
      return json(200, PTO_DETAILS);
    }
    if (path.startsWith("coop_focustimes")) {
      const paged = scenario === "paged" || scenario === "paged_foreign_next" || scenario === "page_fails";
      const before = /coop_startdate le (\d{4}-\d{2}-\d{2})/.exec(decodeURIComponent(path))?.[1];
      if (!paged) return json(200, !before || before >= WC_FOCUS.coop_startdate ? { value: [...focustimes.value, WC_FOCUS] } : focustimes);
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
