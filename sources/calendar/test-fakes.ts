// Fake Graph and Google Calendar APIs (plus their token endpoints) for source tests.
import gPage1 from "../google/fixtures/events-page1.json" with { type: "json" };
import gPage2 from "../google/fixtures/events-page2.json" with { type: "json" };
import mPage1 from "../graph/fixtures/calendarview-page1.json" with { type: "json" };
import mPage2 from "../graph/fixtures/calendarview-page2.json" with { type: "json" };
import { FAKE_ACCESS, FAKE_CLIENT_SECRET, FAKE_REFRESH } from "../oauth/test-fakes.ts";

export const TENANT = "11111111-1111-4111-8111-111111111111";
export const MS_TOKEN = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`;
export const G_TOKEN = "https://oauth2.googleapis.com/token";

export type ApiScenario =
  | "ok"
  | "refresh_expired"
  | "token_offline"
  | "api_offline"
  | "page2_fails"
  | "foreign_next"
  | "unauthorized_once"
  | "unauthorized_always"
  | "forbidden"
  | "calendar_not_found"
  | "server_error";

export type ApiCall = { url: string; headers: Record<string, string> };

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const leaky = (status: number) => json(status, { error: { code: "Fake", message: `Echo Bearer ${FAKE_ACCESS} refresh ${FAKE_REFRESH} secret ${FAKE_CLIENT_SECRET}` } });

export function fakeApis(scenario: ApiScenario) {
  const calls: ApiCall[] = [];
  let unauthorizedServed = 0;
  const fn = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = String(input);
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    calls.push({ url, headers });

    if (url === MS_TOKEN || url === G_TOKEN) {
      if (scenario === "token_offline") throw new TypeError("fetch failed");
      if (scenario === "refresh_expired") return json(400, { error: "invalid_grant", error_description: `expired ${FAKE_REFRESH}` });
      return json(200, { access_token: FAKE_ACCESS, expires_in: 3599, token_type: "Bearer" });
    }

    if (scenario === "api_offline") throw new TypeError("fetch failed");
    if (scenario === "unauthorized_always") return leaky(401);
    if (scenario === "unauthorized_once" && unauthorizedServed++ === 0) return leaky(401);
    if (scenario === "forbidden") return leaky(403);
    if (scenario === "server_error") return leaky(503);

    if (url.startsWith("https://graph.microsoft.com/v1.0/me/calendarView")) {
      if (url.includes("%24skip=5") || url.includes("$skip=5")) return scenario === "page2_fails" ? leaky(500) : json(200, mPage2);
      const body = structuredClone(mPage1) as Record<string, unknown>;
      if (scenario === "foreign_next") body["@odata.nextLink"] = "https://attacker.example.com/steal?$skip=5";
      return json(200, body);
    }
    if (url.startsWith("https://www.googleapis.com/calendar/v3/calendars/")) {
      if (scenario === "calendar_not_found") return leaky(404);
      if (url.includes("pageToken=FAKEPAGETOKEN2")) return scenario === "page2_fails" ? leaky(500) : json(200, gPage2);
      return json(200, gPage1);
    }
    return json(404, {});
  };
  return { fetch: fn as typeof fetch, calls };
}
