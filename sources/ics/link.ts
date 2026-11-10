// CAL-1: a calendar subscription link (an ICS URL) and the rules it must pass before FocusTime fetches it. Pure.
// The URL is a secret (anyone holding it reads the calendar): it is sealed at rest, never logged, never sent to the
// browser or the AI. Only its host is ever shown ("calendar.google.com/…").

/** Fetch limits (recorded under CAL-1 in docs/decisions.md). */
export const ICS_TIMEOUT_MS = 15_000;
export const ICS_MAX_BYTES = 5 * 1024 * 1024;
export const ICS_MAX_REDIRECTS = 3;
/** Longest link accepted (Google's secret addresses are about 150 characters). */
export const ICS_MAX_URL = 2048;

export type LinkProblem =
  | "empty"
  | "not_a_link"
  | "not_https"
  | "credentials"
  | "port"
  | "blocked_host";

export const LINK_PROBLEM_TEXT: Record<LinkProblem, string> = {
  empty: "Paste the calendar's link",
  not_a_link: "That isn't a link. Paste the whole address, starting with https:// or webcal://",
  not_https: "Only https:// and webcal:// links work",
  credentials: "Links with a user name or password in them aren't accepted",
  port: "Only links on the standard https port work",
  blocked_host: "That address is on a private or internal network, so FocusTime won't fetch it",
};

export class LinkError extends Error {
  readonly problem: LinkProblem;
  constructor(problem: LinkProblem) {
    super(LINK_PROBLEM_TEXT[problem]);
    this.problem = problem;
  }
}

/**
 * The link as FocusTime will fetch it: webcal:// (and webcals://) become https://, then only https on port 443, with no
 * user name or password, to a host that isn't a private, loopback, link-local or metadata address by its name or its
 * literal IP. DNS answers are checked again at connect time (server/ics-fetch.ts), and every redirect hop goes through
 * this again (sources/ics/fetch.ts).
 */
export function normalizeLink(input: string): URL {
  const raw = input.trim();
  if (!raw) throw new LinkError("empty");
  if (raw.length > ICS_MAX_URL) throw new LinkError("not_a_link");
  const swapped = raw.replace(/^webcals?:\/\//i, "https://");
  let u: URL;
  try {
    u = new URL(swapped);
  } catch {
    throw new LinkError("not_a_link");
  }
  if (u.protocol !== "https:") throw new LinkError("not_https");
  if (u.username || u.password) throw new LinkError("credentials");
  if (u.port && u.port !== "443") throw new LinkError("port");
  if (blockedHostName(u.hostname)) throw new LinkError("blocked_host");
  u.hash = "";
  return u;
}

/** What may be shown of a link: its host and "…". Never the path or query (where the secret is). */
export function redactLink(u: URL | string): string {
  try {
    const host = (typeof u === "string" ? new URL(u.replace(/^webcals?:\/\//i, "https://")) : u).hostname;
    return `${host}/…`;
  } catch {
    return "a link";
  }
}

/** Host names never fetched: localhost and internal suffixes, and literal IPs in blocked ranges. */
export function blockedHostName(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!h) return true;
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".home.arpa")) return true;
  if (h === "metadata" || h === "metadata.google.internal") return true;
  if (isIpLiteral(h)) return blockedAddress(h);
  // A name with no dot (an intranet short name) never resolves on the public internet.
  if (!h.includes(".")) return true;
  return false;
}

const isIpLiteral = (h: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(":") || /^\d+$/.test(h) || /^0x/i.test(h);

/** IPv4 as four numbers, or null. Accepts only the dotted form (the URL parser has already normalized others). */
function v4(a: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(a);
  if (!m) return null;
  const p = m.slice(1).map(Number);
  return p.every((n) => n <= 255) ? p : null;
}

/** Expands an IPv6 address to eight 16-bit groups, or null. */
function v6(a: string): number[] | null {
  let s = a.toLowerCase().replace(/^\[|\]$/g, "");
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);
  // An embedded IPv4 tail (::ffff:10.0.0.1).
  const tail = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (tail) {
    const p = v4(tail[1]!);
    if (!p) return null;
    s = s.slice(0, -tail[1]!.length) + `${((p[0]! << 8) | p[1]!).toString(16)}:${((p[2]! << 8) | p[3]!).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 ? (halves[1] ? halves[1].split(":") : []) : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0) return null;
  const groups = [...head, ...Array(fill).fill("0"), ...rest];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}

/**
 * Whether an IP address is somewhere FocusTime must never fetch from: unspecified, loopback, private (10/8, 172.16/12,
 * 192.168/16), carrier-grade NAT (100.64/10), link-local (169.254/16, which holds the cloud metadata services, and
 * fe80::/10), unique local IPv6 (fc00::/7), multicast, reserved, and the IPv4 ones hidden in IPv6 (mapped, NAT64,
 * 6to4). Anything it can't read counts as blocked.
 */
export function blockedAddress(address: string): boolean {
  const p4 = v4(address);
  if (p4) return blockedV4(p4);
  const g = v6(address);
  if (!g) return true;
  if (g.every((x) => x === 0)) return true; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1
  // IPv4-mapped (::ffff:a.b.c.d), IPv4-compatible (::a.b.c.d), NAT64 (64:ff9b::/96): judge the IPv4 inside.
  const inner = [g[6]! >> 8, g[6]! & 255, g[7]! >> 8, g[7]! & 255];
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) return blockedV4(inner);
  if (g[0] === 0x64 && g[1] === 0xff9b) return blockedV4(inner);
  // 6to4 (2002::/16) carries an IPv4 in groups 1 and 2.
  if (g[0] === 0x2002) return blockedV4([g[1]! >> 8, g[1]! & 255, g[2]! >> 8, g[2]! & 255]);
  const first = g[0]!;
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((first & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
  if ((first & 0xff00) === 0xff00) return true; // multicast
  if (first === 0x2001 && g[1] === 0x0db8) return true; // documentation
  if (first === 0x0100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true; // discard 100::/64
  // Only global unicast (2000::/3) is fetched.
  return (first & 0xe000) !== 0x2000;
}

function blockedV4([a, b, c]: number[]): boolean {
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b! >= 64 && b! <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b! >= 16 && b! <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  if (a! >= 224) return true; // multicast, reserved, broadcast
  return false;
}
