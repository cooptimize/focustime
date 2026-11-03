// A4: the hosted app's data key (A2's KeyProvider). 32 random bytes made once, wrapped by the Key Vault key
// ft-data-key (RSA-OAEP-256) and kept wrapped in the database (app_keys, an app table); each process unwraps it once
// with its managed identity and holds it in memory. The vault never sees a person's secret, only this key, and the
// database never sees the key unwrapped. Two replicas starting at once: both may wrap a key, the database keeps the
// first, and both use what it kept. Rotating ft-data-key's version keeps old wrappings readable (the wrapping names
// the key version it used).
import { randomBytes } from "node:crypto";
import type { KeyProvider } from "../types.ts";

/** Where the wrapped key is kept: `keep` stores it unless one is there, and returns the one that is. */
export type WrappedKeyStore = { load(): Promise<string | null>; keep(wrapped: string): Promise<string> };

export type KeyVaultKeyOptions = {
  /** https://<vault>.vault.azure.net */
  vaultUrl: string;
  keyName: string;
  /** An access token for https://vault.azure.net (the managed identity's). */
  token: () => Promise<string>;
  store: () => Promise<WrappedKeyStore>;
  fetch?: typeof fetch;
};

const API = "api-version=7.4";
const ALG = "RSA-OAEP-256";
const b64url = (b: Uint8Array) => Buffer.from(b).toString("base64url");

export class DataKeyError extends Error {}

export function keyVaultDataKey(o: KeyVaultKeyOptions): KeyProvider {
  const f = o.fetch ?? fetch;
  const call = async (url: string, value: string): Promise<{ kid: string; value: string }> => {
    const r = await f(`${url}?${API}`, {
      method: "POST",
      headers: { authorization: `Bearer ${await o.token()}`, "content-type": "application/json" },
      body: JSON.stringify({ alg: ALG, value }),
    });
    // Status only: the body may hold key material.
    if (!r.ok) throw new DataKeyError(`Key Vault refused the data key operation (${r.status})`);
    return (await r.json()) as { kid: string; value: string };
  };
  let held: Promise<Uint8Array> | null = null;
  const make = async (): Promise<Uint8Array> => {
    const store = await o.store();
    let wrapped = await store.load();
    if (!wrapped) {
      const w = await call(`${o.vaultUrl.replace(/\/$/, "")}/keys/${o.keyName}/wrapkey`, b64url(randomBytes(32)));
      wrapped = await store.keep(JSON.stringify({ kid: w.kid, value: w.value }));
    }
    const { kid, value } = JSON.parse(wrapped) as { kid: string; value: string };
    if (!kid.startsWith(`${o.vaultUrl.replace(/\/$/, "")}/keys/`)) throw new DataKeyError("The wrapped data key names another vault");
    const key = Buffer.from((await call(`${kid}/unwrapkey`, value)).value, "base64url");
    if (key.length !== 32) throw new DataKeyError("The data key isn't 32 bytes");
    return key;
  };
  return {
    dataKey: () => {
      if (!held) {
        held = make();
        held.catch(() => (held = null));
      }
      return held;
    },
  };
}
