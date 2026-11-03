// R1 (host adapter): the one-time move from Coopilot's folders and keyring entries, run on the first start of the
// renamed build before anything else. Folders: when the focustime folder doesn't exist and the coopilot one does,
// copy it (never move, never overwrite) and leave a MIGRATED.txt note in the old folder. The data folder's browser
// profile (the app window's own Chromium data) is not copied; the window starts a fresh one. Keyring: see
// secrets/keyring-rename.ts. Idempotent: a second run finds the new folders and no old keyring entries.
import { cp, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { renameAccounts, renameKeyring, type KeyringRename } from "../secrets/keyring-rename.ts";
import type { Runner } from "../secrets/keyring.ts";
import type { Logger } from "../log/logger.ts";

/** The app's name before Nov 2: only for finding the old folders. */
const OLD = "coopilot";
const NEW = "focustime";

export type FolderPair = { name: "config" | "data" | "cache"; from: string; to: string };
export type FolderResult = { name: FolderPair["name"]; result: "copied" | "exists" | "none" };
export type RenameResult = { folders: FolderResult[]; keyring: KeyringRename | null; note: string | null };

export function renameFolders(env = process.env, home = homedir()): FolderPair[] {
  const config = env.XDG_CONFIG_HOME || join(home, ".config");
  const data = env.XDG_DATA_HOME || join(home, ".local", "share");
  const cache = env.XDG_CACHE_HOME || join(home, ".cache");
  return [
    { name: "config", from: join(config, OLD), to: join(config, NEW) },
    { name: "data", from: join(data, OLD), to: join(data, NEW) },
    { name: "cache", from: join(cache, OLD), to: join(cache, NEW) },
  ];
}

const exists = (p: string) => stat(p).then(() => true, () => false);

async function copyFolder(f: FolderPair, today: string): Promise<FolderResult["result"]> {
  if (await exists(f.to)) return "exists";
  if (!(await exists(f.from))) return "none";
  // Copied into a temporary name first and then renamed, so a half copy never looks like a finished one.
  const tmp = `${f.to}.partial`;
  await rm(tmp, { recursive: true, force: true });
  await cp(f.from, tmp, { recursive: true, force: false, errorOnExist: false, preserveTimestamps: true, filter: (src) => !(f.name === "data" && src === join(f.from, "browser")) && !src.endsWith("MIGRATED.txt") });
  await rename(tmp, f.to);
  await writeFile(join(f.from, "MIGRATED.txt"), `Copied to ${f.to} on ${today} when Coopilot was renamed FocusTime.\nFocusTime no longer reads this folder. It is kept so you can go back; delete it when you no longer need it.\n`, { mode: 0o600 });
  return "copied";
}

/** Clients with a saved DevOps write identity, from the plan store (they are the ones that may have a write PAT). */
export function writePatClients(dbPath: string): string[] {
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      return (db.prepare("SELECT client_key FROM devops_identities ORDER BY client_key").all() as { client_key: string }[]).map((r) => r.client_key);
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
}

export const RENAME_NOTE =
  "Some saved sign-ins and keys couldn't be moved from Coopilot to FocusTime, so they were left where they were. Unlock your keyring and restart FocusTime (systemctl --user restart focustime), or sign in again and re-enter any DevOps write PATs in Settings.";

export type RenameDeps = { env?: NodeJS.ProcessEnv; home?: string; today: string; run?: Runner; log: Logger };

/** The whole move. The keyring step runs only while the old config folder exists (never in tests or demo folders). */
export async function moveFromOldName(d: RenameDeps): Promise<RenameResult> {
  const pairs = renameFolders(d.env, d.home);
  const folders: FolderResult[] = [];
  for (const p of pairs) {
    try {
      const result = await copyFolder(p, d.today);
      folders.push({ name: p.name, result });
      if (result === "copied") d.log({ source: "server", op: "rename_folder", kind: p.name });
    } catch {
      folders.push({ name: p.name, result: "none" });
      d.log({ source: "server", op: "rename_folder", kind: `${p.name}_failed` });
    }
  }
  const oldConfig = pairs[0]!.from;
  if (!(await exists(oldConfig))) return { folders, keyring: null, note: null };
  const dataTo = pairs[1]!.to;
  const keyring = await renameKeyring(renameAccounts(writePatClients(join(dataTo, "plan.db"))), d.run);
  for (const a of keyring.moved) d.log({ source: "server", op: "rename_keyring", kind: a });
  for (const a of keyring.failed) d.log({ source: "server", op: "rename_keyring_failed", kind: a });
  return { folders, keyring, note: keyring.failed.length ? RENAME_NOTE : null };
}
