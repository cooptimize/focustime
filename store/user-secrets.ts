// A2: each person's secrets (their Microsoft and Google refresh tokens, their DevOps write PATs), encrypted in the plan
// store with the app's data key (AES-256-GCM, a fresh IV per value, the person and account bound in as associated
// data, so a value moved to another row or person doesn't decrypt). The key comes from a KeyProvider: the local host
// keeps it in its secret store (account data-key); the hosted app (A4) has it wrapped by a Key Vault key; tests use a
// fake. Values never leave the server: nothing here returns them except to the code that uses them, and the export,
// the logs and the UI never see them.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { SecretError, type KeyProvider } from "../host/types.ts";
import { scopedDb } from "./scope.ts";

export type { KeyProvider };

/** Tests: a fixed random key, held in memory. */
export const fakeKeyProvider = (key: Uint8Array = randomBytes(32)): KeyProvider => ({ dataKey: async () => key });

/** What a person's secret can be. */
export type UserSecretAccount = "outlook-refresh-token" | "google-refresh-token" | `devops-write-pat:${string}`;

const VERSION = "v1";

function aad(userId: string, account: string): Buffer {
  return Buffer.from(`focustime\n${userId}\n${account}`, "utf8");
}

export function seal(key: Uint8Array, userId: string, account: string, value: string): string {
  if (key.length !== 32) throw new Error("The data key must be 32 bytes");
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(aad(userId, account));
  const body = Buffer.concat([c.update(value, "utf8"), c.final()]);
  return `${VERSION}.${Buffer.concat([iv, c.getAuthTag(), body]).toString("base64url")}`;
}

export function open(key: Uint8Array, userId: string, account: string, sealed: string): string {
  const [v, b64] = sealed.split(".");
  if (v !== VERSION || !b64) throw new SecretError("unavailable");
  const raw = Buffer.from(b64, "base64url");
  const d = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
  d.setAAD(aad(userId, account));
  d.setAuthTag(raw.subarray(12, 28));
  try {
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
  } catch {
    // Another key, another row or another person: never a value.
    throw new SecretError("unavailable");
  }
}

export function createUserSecrets(o: { db: DatabaseSync; userId: string; keys: KeyProvider; now: () => Temporal.Instant }) {
  const db = scopedDb(o.db, o.userId);
  let key: Promise<Uint8Array> | null = null;
  const dataKey = () => {
    if (!key) {
      key = o.keys.dataKey();
      key.catch(() => (key = null));
    }
    return key;
  };
  const check = (account: string) => {
    if (!/^(outlook-refresh-token|google-refresh-token|devops-write-pat:[\w.-]{1,100})$/.test(account)) throw new Error("Not a personal secret account");
  };
  return {
    async get(account: UserSecretAccount): Promise<string> {
      check(account);
      const r = db.prepare("SELECT sealed FROM user_secrets WHERE account = ?").get(account) as { sealed: string } | undefined;
      if (!r) throw new SecretError("not_found");
      return open(await dataKey(), o.userId, account, r.sealed);
    },
    async set(account: UserSecretAccount, value: string): Promise<void> {
      check(account);
      if (!value || value.length > 16_384) throw new Error("A secret is 1 to 16384 characters");
      const sealed = seal(await dataKey(), o.userId, account, value);
      db.prepare("INSERT INTO user_secrets (account, sealed, updated_at) VALUES (?, ?, ?) ON CONFLICT (account) DO UPDATE SET sealed = excluded.sealed, updated_at = excluded.updated_at").run(account, sealed, o.now().toString());
    },
    async delete(account: UserSecretAccount): Promise<void> {
      check(account);
      db.prepare("DELETE FROM user_secrets WHERE account = ?").run(account);
    },
    has(account: UserSecretAccount): boolean {
      check(account);
      return !!db.prepare("SELECT 1 FROM user_secrets WHERE account = ?").get(account);
    },
    /** Every secret of the person, gone (sign-out of everything, or Delete my data). */
    clear(): void {
      db.prepare("DELETE FROM user_secrets").run();
    },
  };
}

export type UserSecrets = ReturnType<typeof createUserSecrets>;
