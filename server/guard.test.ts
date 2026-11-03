import { describe, expect, it } from "vitest";
import { checkRequest, type RequestFacts } from "./guard.ts";

const opts = { publicUrl: "http://localhost:5317" };
const base: RequestFacts = { method: "GET", path: "/", search: "", host: "localhost:5317" };
const check = (over: Partial<RequestFacts>) => checkRequest({ ...base, ...over }, opts);
const api = { method: "POST", path: "/api/action", origin: "http://localhost:5317", secFetchSite: "same-origin" };

describe("request guard", () => {
  it("allows a page load on the public host", () => {
    expect(check({})).toEqual({ action: "allow" });
    expect(check({ path: "/assets/app.js" })).toEqual({ action: "allow" });
  });

  it.each(["evil.example:5317", "localhost:9999", "localhost", "192.168.1.5:5317", ""])("rejects Host %j", (host) => {
    expect(check({ host })).toMatchObject({ action: "deny", status: 403 });
  });

  it("sends a page load on the loopback address to the public URL, so cookies live on one origin", () => {
    expect(check({ host: "127.0.0.1:5317", path: "/week", search: "?x=1" })).toEqual({ action: "redirect", location: "http://localhost:5317/week?x=1" });
    expect(check({ ...api, host: "127.0.0.1:5317" })).toMatchObject({ action: "deny", status: 403 });
    expect(check({ host: "127.0.0.1:5317", method: "POST" })).toMatchObject({ action: "deny", status: 403 });
  });

  it("rejects a foreign Origin, including another localhost port and the loopback alias", () => {
    expect(check({ origin: "https://evil.example" })).toMatchObject({ action: "deny", status: 403 });
    expect(check({ origin: "http://localhost:8080" })).toMatchObject({ action: "deny", status: 403 });
    expect(check({ origin: "http://127.0.0.1:5317" })).toMatchObject({ action: "deny", status: 403 });
    expect(check({ origin: "http://localhost:5317" })).toEqual({ action: "allow" });
  });

  it("lets people arrive at a page from anywhere, only as a top-level navigation", () => {
    expect(check({ secFetchSite: "cross-site", secFetchMode: "navigate" })).toEqual({ action: "allow" });
    expect(check({ secFetchSite: "none" })).toEqual({ action: "allow" });
    expect(check({ secFetchSite: "cross-site", secFetchMode: "no-cors" })).toMatchObject({ action: "deny", status: 403 });
    expect(check({ secFetchSite: "same-site", secFetchMode: "cors" })).toMatchObject({ action: "deny", status: 403 });
    expect(check({ method: "POST" })).toMatchObject({ action: "deny", status: 403 });
  });

  it("requires a same-origin Origin and fetch metadata on API calls and sign-in changes", () => {
    expect(check(api)).toEqual({ action: "allow" });
    expect(check({ ...api, origin: undefined })).toMatchObject({ action: "deny", status: 403 });
    expect(check({ ...api, secFetchSite: "cross-site" })).toMatchObject({ action: "deny", status: 403 });
    expect(check({ ...api, secFetchSite: "same-site" })).toMatchObject({ action: "deny", status: 403 });
    expect(check({ ...api, path: "/auth/logout" })).toEqual({ action: "allow" });
    expect(check({ ...api, path: "/auth/demo", origin: undefined })).toMatchObject({ action: "deny", status: 403 });
    // Microsoft's redirect back is a cross-site top-level GET.
    expect(check({ path: "/auth/microsoft/callback", secFetchSite: "cross-site", secFetchMode: "navigate" })).toEqual({ action: "allow" });
  });

  it("guards the reopen call like any API call", () => {
    expect(check({ ...api, path: "/api/reopen" })).toEqual({ action: "allow" });
    expect(check({ ...api, path: "/api/reopen", origin: "http://evil.example" })).toMatchObject({ action: "deny", status: 403 });
    expect(check({ ...api, path: "/api/reopen", origin: undefined })).toMatchObject({ action: "deny", status: 403 });
  });

  it("works the same for an https public URL", () => {
    const o = { publicUrl: "https://focustime.example" };
    expect(checkRequest({ ...base, host: "focustime.example" }, o)).toEqual({ action: "allow" });
    expect(checkRequest({ ...base, ...api, host: "focustime.example", origin: "https://focustime.example" }, o)).toEqual({ action: "allow" });
    expect(checkRequest({ ...base, ...api, host: "focustime.example", origin: "http://focustime.example" }, o)).toMatchObject({ action: "deny" });
  });
});
