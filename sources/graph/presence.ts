// Teams presence through Microsoft Graph (step 16.3), delegated, on its own token (Presence.ReadWrite and
// Presence.Read.All, asked for incrementally with "Allow Teams status").
// - My status: setUserPreferredPresence (Busy or DoNotDisturb, always with an expiration) and
//   clearUserPreferredPresence, on my own user only; GET /me/presence to notice a status I set by hand in Teams.
// - Teammates: communications/getPresencesByUserId (up to 650 object IDs per request).
// Only id, availability and activity are read from answers; status messages, out of office and work location are
// dropped at once. Nothing is cached, stored or logged except status codes, counts and durations.
import type { Logger } from "../../log/logger.ts";
import { setBody, type FocusStatus } from "../../plan/presence.ts";
import { HttpError, NetworkError } from "../calendar/http.ts";

const GRAPH = "https://graph.microsoft.com/v1.0";
/** Graph's limit per getPresencesByUserId request. */
export const PRESENCE_BATCH = 650;

export type PresenceDeps = { fetch: typeof fetch; token: () => Promise<string>; invalidate: () => void; log: Logger; timeoutMs?: number };
export type RawPresence = { availability: string | null; activity: string | null };

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown) => (typeof v === "string" && v.length <= 60 ? v : null);

export function createPresenceClient(d: PresenceDeps) {
  async function request(op: string, method: "GET" | "POST", url: string, body: unknown, count?: number, retried = false): Promise<unknown> {
    const token = await d.token();
    const started = performance.now();
    let res: Response;
    try {
      res = await d.fetch(url, {
        method,
        headers: { accept: "application/json", authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(d.timeoutMs ?? 15_000),
      });
    } catch {
      d.log({ source: "outlook", op, kind: "network" });
      throw new NetworkError("network");
    }
    d.log({ source: "outlook", op, status: res.status, durationMs: performance.now() - started, ...(count !== undefined ? { count } : {}) });
    if (res.status === 401 && !retried) {
      await res.body?.cancel();
      d.invalidate();
      return request(op, method, url, body, count, true);
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new HttpError(res.status);
    }
    if (method === "POST" && op !== "presence_people") {
      await res.body?.cancel();
      return null;
    }
    return res.json().catch(() => null);
  }

  const userUrl = (oid: string) => {
    if (!GUID.test(oid)) throw new HttpError(400);
    return `${GRAPH}/users/${oid}/presence`;
  };

  return {
    /** Sets my preferred presence (Busy or DoNotDisturb) for `minutes`; my own user only. */
    async setMine(oid: string, status: FocusStatus, minutes: number): Promise<void> {
      await request("presence_set", "POST", `${userUrl(oid)}/setUserPreferredPresence`, setBody(status, minutes));
    },
    /** Back to automatic. */
    async clearMine(oid: string): Promise<void> {
      await request("presence_clear", "POST", `${userUrl(oid)}/clearUserPreferredPresence`, {});
    },
    /** My presence now (availability and activity only). */
    async mine(): Promise<RawPresence> {
      const j = (await request("presence_me", "GET", `${GRAPH}/me/presence`, undefined)) as { availability?: unknown; activity?: unknown } | null;
      return { availability: str(j?.availability), activity: str(j?.activity) };
    },
    /** Teammates' presence by Entra object ID; ids Graph doesn't answer for are left out. */
    async people(ids: readonly string[]): Promise<Map<string, RawPresence>> {
      const out = new Map<string, RawPresence>();
      const clean = [...new Set(ids.filter((x) => GUID.test(x)).map((x) => x.toLowerCase()))];
      for (let i = 0; i < clean.length; i += PRESENCE_BATCH) {
        const batch = clean.slice(i, i + PRESENCE_BATCH);
        const j = (await request("presence_people", "POST", `${GRAPH}/communications/getPresencesByUserId`, { ids: batch }, batch.length)) as { value?: unknown } | null;
        for (const p of Array.isArray(j?.value) ? j.value : []) {
          const o = p as { id?: unknown; availability?: unknown; activity?: unknown };
          if (typeof o.id === "string" && GUID.test(o.id)) out.set(o.id.toLowerCase(), { availability: str(o.availability), activity: str(o.activity) });
        }
      }
      return out;
    },
  };
}
export type PresenceClient = ReturnType<typeof createPresenceClient>;
