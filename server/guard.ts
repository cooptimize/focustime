// Every request must pass: loopback Host, same-origin Origin / fetch metadata, and the per-launch token.
// The token arrives once as ?token= on the launch URL and is swapped for a strict HttpOnly cookie.
import { timingSafeEqual } from "node:crypto";

export type RequestFacts = {
  method: string;
  path: string;
  search: string;
  host: string | undefined;
  origin?: string | undefined;
  secFetchSite?: string | undefined;
  cookie?: string | undefined;
};

export type GuardResult =
  | { action: "allow" }
  | { action: "deny"; status: 401 | 403; reason: string }
  | { action: "redirect"; location: string; setCookie: string };

export const REOPEN_PATH = "/api/reopen";
export const cookieName = (port: number) => `focustime_${port}`;

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function checkRequest(req: RequestFacts, opts: { port: number; token: string }): GuardResult {
  const hosts = [`127.0.0.1:${opts.port}`, `localhost:${opts.port}`];
  const origins = hosts.map((h) => `http://${h}`);

  if (!req.host || !hosts.includes(req.host.toLowerCase())) return { action: "deny", status: 403, reason: "Host not allowed" };
  if (req.origin !== undefined && !origins.includes(req.origin)) return { action: "deny", status: 403, reason: "Origin not allowed" };
  if (req.secFetchSite !== undefined && req.secFetchSite !== "same-origin" && req.secFetchSite !== "none")
    return { action: "deny", status: 403, reason: "Cross-site request" };
  if (req.path.startsWith("/api/") && req.origin === undefined) return { action: "deny", status: 403, reason: "API calls need a same-origin Origin" };

  // Step 15.4 fix: a window with an old launch token may ask the host to open a fresh window (Reopen FocusTime). It
  // passes every check above (loopback Host, same-origin Origin), takes no input and returns nothing.
  if (req.path === REOPEN_PATH && req.method === "POST") return { action: "allow" };

  const params = new URLSearchParams(req.search);
  const offered = params.get("token");
  if (offered !== null) {
    if (!same(offered, opts.token)) return { action: "deny", status: 401, reason: "Bad launch token" };
    params.delete("token");
    const rest = params.toString();
    return {
      action: "redirect",
      location: `${req.path}${rest ? `?${rest}` : ""}`,
      setCookie: `${cookieName(opts.port)}=${opts.token}; HttpOnly; SameSite=Strict; Path=/`,
    };
  }

  const cookie = (req.cookie ?? "")
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${cookieName(opts.port)}=`));
  const value = cookie?.slice(cookieName(opts.port).length + 1);
  if (!value || !same(value, opts.token)) return { action: "deny", status: 401, reason: "Missing or old launch token" };
  return { action: "allow" };
}
