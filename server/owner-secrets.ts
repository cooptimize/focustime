// A2: the store's owner, at their first sign-in, gets the secrets this machine's keyring already holds for them: the
// DevOps write PATs for their clients and their Google Calendar refresh token (issued to the same Google client).
// Copied into their encrypted secrets once, only where they have none yet; the keyring entries stay (never deleted).
// Values pass through here only; nothing is logged but counts.
import { cacheKey } from "../sources/devops/source.ts";
import type { Pat } from "../sources/devops/pat.ts";
import type { UserSecrets } from "../store/user-secrets.ts";

/** The marker kind that records the copy was made (in the person's own store, so it moves with an import). */
export const OWNER_SECRETS_MARK = "owner_secrets_copied";

/**
 * A3: whether this sign-in copies the keyring's secrets: the store's owner at their first sign-in (A2), or the only
 * person in a store their rows were imported into (their first sign-in there is a returning one), and only once: a
 * PAT they remove afterwards is not copied back.
 */
export const copiesOwnerSecrets = (o: { owner: boolean; people: number; copiedBefore: boolean }): boolean => !o.copiedBefore && (o.owner || o.people === 1);

export const writePatAccount = (clientKey: string) => `devops-write-pat:${cacheKey(clientKey)}` as const;

/** The value inside a Pat, for this one copy (Pat has no getter on purpose). */
const patValue = (p: Pat) => Buffer.from(p.basicAuth().slice("Basic ".length), "base64").toString("utf8").slice(1);

export async function copyOwnerSecrets(o: {
  clientKeys: readonly string[];
  mine: Pick<UserSecrets, "has" | "set">;
  keyring: { writePat: (clientKey: string) => Promise<Pat>; googleRefreshToken: () => Promise<string> };
}): Promise<{ pats: number; google: boolean }> {
  let pats = 0;
  for (const clientKey of o.clientKeys) {
    if ((await o.mine.has(writePatAccount(clientKey)))) continue;
    const pat = await o.keyring.writePat(clientKey).catch(() => null);
    if (!pat) continue;
    await o.mine.set(writePatAccount(clientKey), patValue(pat)).then(() => pats++, () => null);
  }
  let google = false;
  if (!(await o.mine.has("google-refresh-token"))) {
    const token = await o.keyring.googleRefreshToken().catch(() => null);
    if (token) google = await o.mine.set("google-refresh-token", token).then(() => true, () => false);
  }
  return { pats, google };
}
