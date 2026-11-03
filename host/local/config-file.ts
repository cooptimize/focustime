// The local host's config file (A1): reads config.toml (a commented starter when missing) and writes changes safely
// with backups. The hosted app keeps settings in the database (A2).
import { chmod, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseConfig, setSystemUserIdInText } from "../../config/schema.ts";
import { migrateDayShapeText, type WriteResult } from "../../config/edit.ts";
import { STARTER_TOML } from "../../config/starter.ts";
import type { HostConfig, LoadedConfig } from "../types.ts";

export type { LoadedConfig, WriteResult };

export async function loadConfigFile(path: string): Promise<LoadedConfig> {
  let text: string;
  let created = false;
  try {
    text = await readFile(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, STARTER_TOML, { mode: 0o600, flag: "wx" });
    text = STARTER_TOML;
    created = true;
  }
  let parsed = parseConfig(text);
  // The old [day_shape] becomes [hours] once, with a backup (D124). A failed write leaves the file as it was.
  if (parsed.ok && parsed.legacyDayShape) {
    const model = parsed.config.week.hours;
    const r = await writeConfig(path, (t) => migrateDayShapeText(t, model) ?? t).catch(() => null);
    if (r?.ok) parsed = r.parsed;
  }
  return { path, parsed, created };
}

export async function saveSystemUserId(path: string, id: string): Promise<void> {
  const text = await readFile(path, "utf8");
  const next = setSystemUserIdInText(text, id);
  const tmp = `${path}.tmp`;
  await writeFile(tmp, next, { mode: 0o600 });
  await chmod(tmp, 0o600);
  await rename(tmp, path);
}

/** How many backups are kept (oldest removed first). */
export const KEEP_BACKUPS = 30;

export const backupDir = (configPath: string) => join(dirname(configPath), "backups");

/**
 * Writes a change to config.toml safely: the new text must validate (otherwise nothing is written and the
 * per-field errors come back), the current file is copied to backups/config-<stamp>.toml first (0600), and the
 * new file replaces it atomically. Keeps the last KEEP_BACKUPS backups.
 */
export async function writeConfig(path: string, edit: (text: string) => string, stamp: string = new Date().toISOString()): Promise<WriteResult> {
  const before = await readFile(path, "utf8");
  const next = edit(before);
  const parsed = parseConfig(next);
  if (!parsed.ok) return { ok: false, parsed };
  const dir = backupDir(path);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const name = `config-${stamp.replace(/[^0-9TZ]/g, "")}.toml`;
  const backup = join(dir, name);
  await writeFile(backup, before, { mode: 0o600 });
  await chmod(backup, 0o600);
  const tmp = `${path}.tmp`;
  await writeFile(tmp, next, { mode: 0o600 });
  await chmod(tmp, 0o600);
  await rename(tmp, path);
  const all = (await readdir(dir)).filter((f) => /^config-[0-9TZ]+\.toml$/.test(f)).sort();
  for (const old of all.slice(0, Math.max(0, all.length - KEEP_BACKUPS))) await rm(join(dir, old), { force: true });
  return { ok: true, parsed, backup };
}

/** The HostConfig for one config file. */
export const fileConfig = (path: string): HostConfig => ({
  load: () => loadConfigFile(path),
  write: (edit) => writeConfig(path, edit),
  saveSystemUserId: (id) => saveSystemUserId(path, id),
});
