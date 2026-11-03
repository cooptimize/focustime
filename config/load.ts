// Config file I/O. Creates a commented starter file when missing.
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseConfig, setSystemUserIdInText, type ParseResult } from "./schema.ts";
import { migrateDayShapeText, writeConfig } from "./edit.ts";
import { STARTER_TOML } from "./starter.ts";

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
