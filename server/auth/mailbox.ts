// A2: a new person's time zone, from their Outlook mailbox settings (Graph mailboxSettings/timeZone, a Windows or
// IANA name, mapped with plan/timezones.ts) at their first sign-in. Null when Graph can't say; the caller falls back
// to the host clock's zone. Reads one field; logs only the outcome.
import type { Logger } from "../../log/logger.ts";
import { zoneOf } from "../../plan/timezones.ts";

export const MAILBOX_ZONE_URL = "https://graph.microsoft.com/v1.0/me/mailboxSettings/timeZone";

export async function mailboxZone(o: { fetch: typeof fetch; accessToken: string; log: Logger }): Promise<string | null> {
  const started = performance.now();
  try {
    const r = await o.fetch(MAILBOX_ZONE_URL, { headers: { authorization: `Bearer ${o.accessToken}`, accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
    o.log({ source: "auth", op: "mailbox_zone", status: r.status, durationMs: performance.now() - started });
    if (!r.ok) return null;
    const body = (await r.json()) as { value?: unknown };
    return typeof body.value === "string" ? zoneOf({ name: body.value }) : null;
  } catch {
    o.log({ source: "auth", op: "mailbox_zone", kind: "unavailable" });
    return null;
  }
}
