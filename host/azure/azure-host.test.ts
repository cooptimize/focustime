// A4: the hosted host's secrets (Key Vault references in the environment, read once and removed) and its data key
// (wrapped by a Key Vault key, kept wrapped by the store, unwrapped once).
import { describe, expect, it } from "vitest";
import { SecretError } from "../types.ts";
import { DataKeyError, keyVaultDataKey, type WrappedKeyStore } from "./datakey.ts";
import { envSecrets, SECRET_ENV } from "./secrets.ts";

describe("app secrets from Key Vault references (A4)", () => {
  it("reads each once from the environment and removes it from there", async () => {
    const env: Record<string, string | undefined> = { [SECRET_ENV["entra-client-secret"]]: "entra-value", OTHER: "x" };
    const s = envSecrets(env);
    expect(env[SECRET_ENV["entra-client-secret"]]).toBeUndefined();
    expect(env.OTHER).toBe("x");
    await expect(s.get("entra-client-secret")).resolves.toBe("entra-value");
    expect(await s.state("entra-client-secret")).toBe("set");
    expect(await s.state("google-client-secret")).toBe("missing");
    await expect(s.get("google-client-secret")).rejects.toBeInstanceOf(SecretError);
  });

  it("holds no person's secrets: refresh tokens and write PATs live sealed in the database", async () => {
    const s = envSecrets({});
    await expect(s.get("outlook-refresh-token")).rejects.toBeInstanceOf(SecretError);
    await expect(s.set("outlook-refresh-token", "t")).rejects.toThrow(/sealed in the database/);
    await expect(s.writePat.get("cooptimize")).rejects.toBeInstanceOf(SecretError);
    await expect(s.setApp("google-client-secret", "v")).rejects.toThrow(/Key Vault/);
  });
});

/** A fake Key Vault key: wrap XORs with a pad (enough to tell wrapped from not), and it counts calls. */
function fakeVault(vault = "https://ft-dev-kv.vault.azure.net") {
  const calls: string[] = [];
  const pad = Buffer.alloc(32, 7);
  const xor = (b: Buffer) => Buffer.from(b.map((x, i) => x ^ pad[i % 32]!));
  const fetch: typeof globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push(String(url).replace(/\?.*/, ""));
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer vault-token");
    const body = JSON.parse(String(init.body)) as { alg: string; value: string };
    expect(body.alg).toBe("RSA-OAEP-256");
    const out = xor(Buffer.from(body.value, "base64url")).toString("base64url");
    return new Response(JSON.stringify({ kid: `${vault}/keys/ft-data-key/v1`, value: out }), { status: 200 });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls, vault };
}

const memoryStore = (): WrappedKeyStore & { kept: string | null } => {
  const s = {
    kept: null as string | null,
    load: async () => s.kept,
    keep: async (w: string) => (s.kept ??= w),
  };
  return s;
};

describe("the data key wrapped by Key Vault (A4)", () => {
  it("made once, kept wrapped, unwrapped once per process; another process gets the same key", async () => {
    const v = fakeVault();
    const store = memoryStore();
    const a = keyVaultDataKey({ vaultUrl: v.vault, keyName: "ft-data-key", token: async () => "vault-token", store: async () => store, fetch: v.fetch });
    const k1 = await a.dataKey();
    expect(k1).toHaveLength(32);
    expect(await a.dataKey()).toBe(k1);
    expect(v.calls).toEqual([`${v.vault}/keys/ft-data-key/wrapkey`, `${v.vault}/keys/ft-data-key/v1/unwrapkey`]);
    // What is kept is the wrapping, not the key.
    expect(store.kept).not.toContain(Buffer.from(k1).toString("base64url"));
    const b = keyVaultDataKey({ vaultUrl: v.vault, keyName: "ft-data-key", token: async () => "vault-token", store: async () => store, fetch: v.fetch });
    expect(Buffer.from(await b.dataKey()).equals(Buffer.from(k1))).toBe(true);
  });

  it("refuses a wrapping from another vault, and says only the status when the vault refuses", async () => {
    const v = fakeVault();
    const store = memoryStore();
    store.kept = JSON.stringify({ kid: "https://elsewhere.vault.azure.net/keys/k/v1", value: "AAAA" });
    await expect(keyVaultDataKey({ vaultUrl: v.vault, keyName: "ft-data-key", token: async () => "vault-token", store: async () => store, fetch: v.fetch }).dataKey()).rejects.toBeInstanceOf(DataKeyError);
    const refusing = (async () => new Response('{"error":{"message":"secret detail"}}', { status: 403 })) as unknown as typeof fetch;
    const e = await keyVaultDataKey({ vaultUrl: v.vault, keyName: "ft-data-key", token: async () => "t", store: async () => memoryStore(), fetch: refusing }).dataKey().catch((x: unknown) => x);
    expect(String(e)).toContain("403");
    expect(String(e)).not.toContain("secret detail");
  });
});
