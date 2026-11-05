// Every request passes this first (A2): the Host must be FocusTime's public host, an Origin must be its public origin,
// and API calls must come from FocusTime's own pages (a same-origin Origin, fetch metadata same-origin). A request
// for the old loopback address is sent to the public URL, so cookies live on one origin. Who is signed in (the
// session) and the CSRF token are checked after this, in server/app.ts.

export type RequestFacts = {
  method: string;
  path: string;
  search: string;
  host: string | undefined;
  origin?: string | undefined;
  secFetchSite?: string | undefined;
  secFetchMode?: string | undefined;
};

export type GuardResult = { action: "allow" } | { action: "deny"; status: 403; reason: string } | { action: "redirect"; location: string };

export const REOPEN_PATH = "/api/reopen";

/** The developer loop's other loopback name for the same port (redirected to the public URL). */
function loopbackAlias(publicUrl: URL): string | null {
  return publicUrl.hostname === "localhost" ? `127.0.0.1:${publicUrl.port}` : null;
}

export function checkRequest(req: RequestFacts, opts: { publicUrl: string }): GuardResult {
  const pub = new URL(opts.publicUrl);
  const host = (req.host ?? "").toLowerCase();
  const isGet = req.method === "GET" || req.method === "HEAD";
  if (host !== pub.host) {
    // http://127.0.0.1:5317/... -> http://localhost:5317/... (a page load only; never an API call).
    if (isGet && host === loopbackAlias(pub) && !req.path.startsWith("/api/")) return { action: "redirect", location: `${pub.origin}${req.path}${req.search}` };
    return { action: "deny", status: 403, reason: "Host not allowed" };
  }
  if (req.origin !== undefined && req.origin !== pub.origin) return { action: "deny", status: 403, reason: "Origin not allowed" };
  const site = req.secFetchSite;
  if (req.path.startsWith("/api/") || (req.path.startsWith("/auth/") && !isGet)) {
    // Calls and state changes: only from FocusTime's own pages.
    if (req.origin === undefined) return { action: "deny", status: 403, reason: "Calls need a same-origin Origin" };
    if (site !== undefined && site !== "same-origin") return { action: "deny", status: 403, reason: "Cross-site request" };
    return { action: "allow" };
  }
  // CV-2: chat images load only into FocusTime's own pages (never embedded or opened from another site).
  if (req.path.startsWith("/media/")) {
    if (!isGet) return { action: "deny", status: 403, reason: "Method not allowed here" };
    if (site !== undefined && site !== "same-origin") return { action: "deny", status: 403, reason: "Cross-site request" };
    return { action: "allow" };
  }
  // Page loads: a person may arrive from anywhere (a bookmark, a link in Teams, Microsoft's sign-in redirect), but
  // only as a top-level navigation; a cross-site subresource or fetch is refused.
  if (site !== undefined && site !== "same-origin" && site !== "none") {
    if (!isGet || (req.secFetchMode !== undefined && req.secFetchMode !== "navigate")) return { action: "deny", status: 403, reason: "Cross-site request" };
  }
  if (!isGet) return { action: "deny", status: 403, reason: "Method not allowed here" };
  return { action: "allow" };
}
