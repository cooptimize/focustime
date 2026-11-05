// ADM-1: is the signed-in person in a group? POST /me/checkMemberGroups with the person's own delegated Graph token
// (User.Read is enough for /me, learn.microsoft.com/graph/api/directoryobject-checkmembergroups, checked Nov 4). It
// answers with the ids of the asked groups the person is in, transitively. Only the status, duration and kind are
// logged: never the person, the group or the token.
import type { Logger } from "../../log/logger.ts";

const GRAPH = "https://graph.microsoft.com/v1.0";
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type GroupDeps = { fetch: typeof fetch; token: () => Promise<string>; log: Logger; timeoutMs?: number };

/** Whether the signed-in person is a member of `groupId` (directly or through other groups); null when Graph couldn't say. */
export async function inGroup(d: GroupDeps, groupId: string): Promise<boolean | null> {
  // A malformed id fails the whole request, so it is never sent.
  if (!GUID.test(groupId)) return false;
  let token: string;
  try {
    token = await d.token();
  } catch {
    d.log({ source: "outlook", op: "groups", kind: "no_token" });
    return null;
  }
  const started = performance.now();
  let res: Response;
  try {
    res = await d.fetch(`${GRAPH}/me/checkMemberGroups`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ groupIds: [groupId] }),
      signal: AbortSignal.timeout(d.timeoutMs ?? 10_000),
    });
  } catch {
    d.log({ source: "outlook", op: "groups", kind: "network" });
    return null;
  }
  d.log({ source: "outlook", op: "groups", status: res.status, durationMs: performance.now() - started });
  if (!res.ok) {
    await res.body?.cancel();
    return null;
  }
  const body = (await res.json().catch(() => null)) as { value?: unknown } | null;
  if (!body || !Array.isArray(body.value)) return null;
  return body.value.some((v) => typeof v === "string" && v.toLowerCase() === groupId.toLowerCase());
}
