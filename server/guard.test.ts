import { describe, expect, it } from "vitest";
import { checkRequest, type RequestFacts } from "./guard.ts";

const TOKEN = "launch-token-abc123";
const opts = { port: 5317, token: TOKEN };
const base: RequestFacts = { method: "GET", path: "/", search: "", host: "127.0.0.1:5317", cookie: `coopilot_5317=${TOKEN}` };
const check = (over: Partial<RequestFacts>) => checkRequest({ ...base, ...over }, opts);

describe("request guard", () => {
  it("allows a request with the right Host and token cookie", () => {
    expect(check({})).toEqual({ action: "allow" });
    expect(check({ host: "localhost:5317" })).toEqual({ action: "allow" });
  });

  it.each(["evil.example:5317", "127.0.0.1:9999", "127.0.0.1", "192.168.1.5:5317", ""])("rejects Host %j", (host) => {
    expect(check({ host })).toMatchObject({ action: "deny", status: 403 });
  });

  it("rejects a foreign Origin, including another localhost port", () => {
    expect(check({ origin: "https://evil.example" })).toMatchObject({ action: "deny", status: 403 });
    expect(check({ origin: "http://127.0.0.1:8080" })).toMatchObject({ action: "deny", status: 403 });
    expect(check({ origin: "http://127.0.0.1:5317" })).toEqual({ action: "allow" });
  });

  it("rejects cross-site fetch metadata", () => {
    expect(check({ secFetchSite: "cross-site" })).toMatchObject({ action: "deny", status: 403 });
    expect(check({ secFetchSite: "same-site" })).toMatchObject({ action: "deny", status: 403 });
    expect(check({ secFetchSite: "same-origin" })).toEqual({ action: "allow" });
    expect(check({ secFetchSite: "none" })).toEqual({ action: "allow" });
  });

  it("requires the token on every request", () => {
    expect(check({ cookie: undefined })).toMatchObject({ action: "deny", status: 401 });
    expect(check({ cookie: "coopilot_5317=wrong" })).toMatchObject({ action: "deny", status: 401 });
    expect(check({ path: "/assets/app.js", cookie: undefined })).toMatchObject({ action: "deny", status: 401 });
  });

  it("exchanges a ?token= launch URL for a strict HttpOnly cookie and strips it from the URL", () => {
    const r = check({ cookie: undefined, search: `?token=${TOKEN}&now=x` });
    expect(r).toEqual({
      action: "redirect",
      location: "/?now=x",
      setCookie: `coopilot_5317=${TOKEN}; HttpOnly; SameSite=Strict; Path=/`,
    });
    expect(check({ cookie: undefined, search: "?token=wrong" })).toMatchObject({ action: "deny", status: 401 });
  });

  it("requires a same-origin Origin header on API calls", () => {
    expect(check({ method: "POST", path: "/api/action" })).toMatchObject({ action: "deny", status: 403 });
    expect(check({ method: "POST", path: "/api/action", origin: "http://127.0.0.1:5317" })).toEqual({ action: "allow" });
  });
});
