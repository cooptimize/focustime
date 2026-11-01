// Who suggestions for a follow-up (step 13.5): attendees of my own Outlook meetings whose email domain is a client's,
// on my read token (Calendars.ReadBasic includes attendees). Only names and addresses in that domain are returned;
// subjects and everything else are never selected. Nothing is stored or cached on disk; logs carry counts only.
import type { Logger } from "../../log/logger.ts";
import { HttpError, NetworkError } from "../calendar/http.ts";

export type Person = { name: string; email: string };
export type PeopleDeps = { fetch: typeof fetch; token: () => Promise<string>; invalidate: () => void; log: Logger; timeoutMs?: number };

/** Pages to follow at most (500 events each). */
const MAX_PAGES = 4;

/** Is this address in the domain (or a subdomain of it)? */
export const inDomain = (email: string, domain: string) => {
  const d = email.toLowerCase().split("@")[1] ?? "";
  const want = domain.toLowerCase();
  return !!want && (d === want || d.endsWith(`.${want}`));
};

/** Unique people from Graph event rows, only those in the domain, by how often they appear. */
export function attendeesIn(rows: unknown, domain: string): Person[] {
  const count = new Map<string, { p: Person; n: number }>();
  for (const ev of Array.isArray(rows) ? rows : []) {
    for (const a of (ev as { attendees?: unknown }).attendees instanceof Array ? ((ev as { attendees: unknown[] }).attendees) : []) {
      const e = (a as { emailAddress?: { address?: unknown; name?: unknown } }).emailAddress;
      const email = typeof e?.address === "string" ? e.address.trim().toLowerCase() : "";
      if (!email || !inDomain(email, domain)) continue;
      const name = typeof e?.name === "string" && e.name.trim() ? e.name.trim() : email;
      const c = count.get(email);
      if (c) c.n++;
      else count.set(email, { p: { name, email }, n: 1 });
    }
  }
  return [...count.values()].sort((a, b) => b.n - a.n || a.p.name.localeCompare(b.p.name)).map((c) => c.p);
}

export function createPeopleReader(d: PeopleDeps) {
  async function page(url: string, retried = false): Promise<{ value: unknown[]; next: string | null }> {
    const token = await d.token();
    let res: Response;
    try {
      res = await d.fetch(url, { headers: { accept: "application/json", authorization: `Bearer ${token}`, prefer: 'outlook.timezone="UTC"' }, signal: AbortSignal.timeout(d.timeoutMs ?? 20_000) });
    } catch {
      d.log({ source: "outlook", op: "attendees", kind: "network" });
      throw new NetworkError("network");
    }
    if (res.status === 401 && !retried) {
      await res.body?.cancel();
      d.invalidate();
      return page(url, true);
    }
    if (!res.ok) {
      await res.body?.cancel();
      d.log({ source: "outlook", op: "attendees", status: res.status });
      throw new HttpError(res.status);
    }
    const body = (await res.json().catch(() => null)) as { value?: unknown[]; "@odata.nextLink"?: unknown } | null;
    const next = typeof body?.["@odata.nextLink"] === "string" && body["@odata.nextLink"].startsWith("https://graph.microsoft.com/") ? body["@odata.nextLink"] : null;
    return { value: Array.isArray(body?.value) ? body.value : [], next };
  }
  /** People in `domain` on my meetings between start and end (ISO instants). */
  async function attendees(domain: string, startIso: string, endIso: string): Promise<Person[]> {
    const u = new URL("https://graph.microsoft.com/v1.0/me/calendarView");
    u.searchParams.set("startDateTime", startIso);
    u.searchParams.set("endDateTime", endIso);
    u.searchParams.set("$select", "attendees");
    u.searchParams.set("$top", "500");
    const rows: unknown[] = [];
    let url: string | null = u.toString();
    for (let n = 0; url && n < MAX_PAGES; n++) {
      const p = await page(url);
      rows.push(...p.value);
      url = p.next;
    }
    const out = attendeesIn(rows, domain);
    d.log({ source: "outlook", op: "attendees", count: out.length });
    return out;
  }
  return { attendees };
}
export type PeopleReader = ReturnType<typeof createPeopleReader>;
