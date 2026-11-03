// R1: the one-time move of the keyring entries from service "coopilot" (the app's name until Nov 2) to "focustime".
// Accounts come from the code (the fixed accounts plus one DevOps write PAT per client with a saved identity), never
// from listing the keyring. Each one: read the old entry, write it under the new service with the same account name,
// read it back and compare, and only then clear the old entry. Values stay in memory, go in through stdin only and
// are never logged or returned; the result names accounts only. Any failure keeps the old entry.
import { KEYRING_SERVICE, runSecretTool, writePatAccount, type Runner, type SecretAccount } from "./keyring.ts";

/** The keyring service before the rename. Kept only for this move. */
export const OLD_KEYRING_SERVICE = "coopilot";
export const FIXED_ACCOUNTS: readonly SecretAccount[] = ["dataverse-client-secret", "google-client-secret", "outlook-refresh-token", "google-refresh-token"];

export type KeyringRename = { moved: string[]; failed: string[] };

/** Every account the app uses, for these clients' write PATs. */
export const renameAccounts = (writePatClients: readonly string[]) => [...FIXED_ACCOUNTS, ...writePatClients.map(writePatAccount)];

const label = (account: string) => (account.startsWith("devops-write-pat:") ? `FocusTime DevOps write PAT (${account})` : `FocusTime ${account}`);

type Read = { state: "found"; value: string } | { state: "missing" } | { state: "error" };
async function read(run: Runner, service: string, account: string): Promise<Read> {
  try {
    const r = await run(["lookup", "service", service, "account", account]);
    if (r.code === 0 && r.stdout.length > 0) return { state: "found", value: r.stdout.replace(/\r?\n$/, "") };
    return r.stderr.trim() === "" ? { state: "missing" } : { state: "error" };
  } catch {
    return { state: "error" };
  }
}

const ok = async (p: Promise<{ code: number }>) => {
  try {
    return (await p).code === 0;
  } catch {
    return false;
  }
};

/** Moves each account that still has an old entry. A second run finds no old entries and changes nothing. */
export async function renameKeyring(accounts: readonly string[], run: Runner = runSecretTool): Promise<KeyringRename> {
  const out: KeyringRename = { moved: [], failed: [] };
  for (const account of accounts) {
    const old = await read(run, OLD_KEYRING_SERVICE, account);
    if (old.state === "missing") continue;
    if (old.state === "error") {
      out.failed.push(account);
      continue;
    }
    const cur = await read(run, KEYRING_SERVICE, account);
    if (cur.state === "error" || (cur.state === "found" && cur.value !== old.value)) {
      // A different value already under the new service (set after the rename) wins; the old entry stays untouched.
      out.failed.push(account);
      continue;
    }
    if (cur.state === "missing" && !(await ok(run(["store", `--label=${label(account)}`, "service", KEYRING_SERVICE, "account", account], old.value)))) {
      out.failed.push(account);
      continue;
    }
    const back = await read(run, KEYRING_SERVICE, account);
    if (back.state !== "found" || back.value !== old.value) {
      out.failed.push(account);
      continue;
    }
    const cleared = await ok(run(["clear", "service", OLD_KEYRING_SERVICE, "account", account]));
    if (!cleared || (await read(run, OLD_KEYRING_SERVICE, account)).state !== "missing") {
      out.failed.push(account);
      continue;
    }
    out.moved.push(account);
  }
  return out;
}
