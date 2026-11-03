// A2: the local host's data key (32 random bytes, base64) in the secret store, service focustime, account data-key,
// made on first use and never shown. It seals each person's secrets in the plan store (store/user-secrets.ts); losing
// it means signing in to Microsoft and Google again and re-entering DevOps write PATs, nothing else.
import { randomBytes } from "node:crypto";
import { SecretError } from "../types.ts";
import { KEYRING_SERVICE, runSecretTool, type Runner } from "./keyring.ts";

export const DATA_KEY_ACCOUNT = "data-key";

let held: Promise<Uint8Array> | null = null;

async function lookup(run: Runner): Promise<string | null> {
  let r;
  try {
    r = await run(["lookup", "service", KEYRING_SERVICE, "account", DATA_KEY_ACCOUNT]);
  } catch {
    throw new SecretError("unavailable");
  }
  if (r.code === 0 && r.stdout.trim()) return r.stdout.trim();
  if (r.stderr.toLowerCase().includes("locked")) throw new SecretError("locked");
  if (r.stderr.trim()) throw new SecretError("unavailable");
  return null;
}

export async function readOrMakeDataKey(run: Runner = runSecretTool): Promise<Uint8Array> {
  const found = await lookup(run);
  if (found) {
    const key = Buffer.from(found, "base64");
    if (key.length !== 32) throw new SecretError("unavailable");
    return key;
  }
  const key = randomBytes(32);
  let r;
  try {
    r = await run(["store", "--label=FocusTime data key", "service", KEYRING_SERVICE, "account", DATA_KEY_ACCOUNT], key.toString("base64"));
  } catch {
    throw new SecretError("unavailable");
  }
  if (r.code !== 0) throw new SecretError(r.stderr.toLowerCase().includes("locked") ? "locked" : "unavailable");
  // Read back what the store kept (another process may have made one first).
  const back = await lookup(run);
  if (!back) throw new SecretError("unavailable");
  return Buffer.from(back, "base64");
}

/** The key, read once per process. */
export function localDataKey(): Promise<Uint8Array> {
  if (!held) {
    held = readOrMakeDataKey();
    held.catch(() => (held = null));
  }
  return held;
}
