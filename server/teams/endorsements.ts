// TB-1b: the Bot Connector's key endorsement check, which the Teams SDK doesn't do. Bot Framework publishes its
// signing keys with the channels each one may sign for ("endorsements"); a token for a Teams activity must be signed
// by a key that endorses "msteams", the activity's channel. This runs before the SDK's own check (signature, issuer,
// audience, expiry, serviceUrl), so a key that may sign for another channel can't speak for Teams.
//
// Only Bot Framework's issuer is accepted here: the SDK would also take Entra-issued tokens (for Agent 365 agent
// identities), which the Teams channel to this bot never sends. The keys come from the same address the SDK verifies
// against, are kept for a day, and are fetched again early (at most every 5 minutes) when a token names a key we
// don't have. If they can't be fetched and none are kept, the request is refused.

/** The address of Bot Framework's keys from its OpenID metadata address, the way the SDK derives it. */
export function keysUriOf(openIdMetadataUrl: string): string {
  return openIdMetadataUrl.replace(/\/openidconfiguration$/, "/keys");
}

const DAY_MS = 24 * 60 * 60 * 1000;
const RETRY_MS = 5 * 60 * 1000;

export type EndorsementCheck = (authorization: string | undefined, channelId: unknown) => Promise<boolean>;

function part(token: string, i: number): Record<string, unknown> | null {
  try {
    const v = JSON.parse(Buffer.from(token.split(".")[i] ?? "", "base64url").toString("utf8")) as unknown;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function createEndorsementCheck(o: { keysUri: string; issuer: string; fetch?: typeof fetch; now?: () => number }): EndorsementCheck {
  const get = o.fetch ?? fetch;
  const now = o.now ?? Date.now;
  let keys: Map<string, string[]> | null = null;
  let fetchedAt = -Infinity;
  let inflight: Promise<void> | null = null;

  const refresh = () =>
    (inflight ??= (async () => {
      try {
        const r = await get(o.keysUri, { headers: { accept: "application/json" } });
        if (!r.ok) return;
        const body = (await r.json()) as { keys?: { kid?: unknown; endorsements?: unknown }[] };
        const next = new Map<string, string[]>();
        for (const k of body.keys ?? []) {
          if (typeof k.kid !== "string") continue;
          next.set(k.kid, Array.isArray(k.endorsements) ? k.endorsements.filter((e): e is string => typeof e === "string") : []);
        }
        keys = next;
      } catch {
        // Keep what we had; with nothing kept, the check refuses.
      } finally {
        fetchedAt = now();
        inflight = null;
      }
    })());

  return async (authorization, channelId) => {
    if (channelId !== "msteams") return false;
    if (!authorization?.startsWith("Bearer ")) return false;
    const token = authorization.slice(7);
    const header = part(token, 0);
    const payload = part(token, 1);
    if (!header || !payload || header.alg !== "RS256" || typeof header.kid !== "string") return false;
    if (payload.iss !== o.issuer) return false;
    const kid = header.kid;
    if (!keys || now() - fetchedAt > DAY_MS || (!keys.has(kid) && now() - fetchedAt > RETRY_MS)) await refresh();
    return (keys?.get(kid) ?? []).includes(channelId);
  };
}
