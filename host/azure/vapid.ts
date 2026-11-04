// P1: the hosted app's VAPID key for Web Push, the Key Vault secret ft-vapid-key (a P-256 JWK made by
// infra/scripts/vapid-key.sh, piped straight into the vault). Read at run time with the app's managed identity (it
// already reads secrets there), not as a Container Apps secret reference, so an environment without the key still
// deploys and runs: push then says it isn't set up. The value is held in memory only and never logged.

export type KeyVaultSecretOptions = {
  /** https://<vault>.vault.azure.net */
  vaultUrl: string;
  secretName: string;
  /** An access token for https://vault.azure.net (the managed identity's). */
  token: () => Promise<string>;
  fetch?: typeof fetch;
};

/** The secret's value, or null when the vault has no such secret (or it is disabled). Throws on anything else. */
export function keyVaultSecret(o: KeyVaultSecretOptions): () => Promise<string | null> {
  const f = o.fetch ?? fetch;
  return async () => {
    const r = await f(`${o.vaultUrl.replace(/\/$/, "")}/secrets/${encodeURIComponent(o.secretName)}?api-version=7.4`, { headers: { authorization: `Bearer ${await o.token()}` } });
    // Status only: the body holds the value.
    if (!r.ok) {
      await r.body?.cancel().catch(() => undefined);
      if (r.status === 404) return null;
      throw new Error(`Key Vault couldn't read ${o.secretName} (${r.status})`);
    }
    const v = ((await r.json()) as { value?: unknown }).value;
    return typeof v === "string" && v ? v : null;
  };
}
