// Config file I/O. Creates a commented starter file when missing.
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { parseConfig, setSystemUserIdInText, type ParseResult } from "./schema.ts";
import { STARTER_TOML } from "./starter.ts";

export function configPath(env = process.env): string {
  return join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "coopilot", "config.toml");
}

export function cacheRoot(env = process.env): string {
  return join(env.XDG_CACHE_HOME || join(homedir(), ".cache"), "coopilot");
}

/** The local plan store lives here (XDG data, not cache: it is Tanner's own data). */
export function planDbPath(env = process.env): string {
  return join(env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "coopilot", "plan.db");
}

export type LoadedConfig = { path: string; parsed: ParseResult; created?: boolean };

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
  return { path, parsed: parseConfig(text), created };
}

export async function saveSystemUserId(path: string, id: string): Promise<void> {
  const text = await readFile(path, "utf8");
  const next = setSystemUserIdInText(text, id);
  const tmp = `${path}.tmp`;
  await writeFile(tmp, next, { mode: 0o600 });
  await chmod(tmp, 0o600);
  await rename(tmp, path);
}
