// Edits to config.toml that keep the file Tanner can read (step 6b, D121): comments, order and every other line
// stay as they are. Pure text functions here; writeConfig does the safe write (validate, back up, atomic rename).
import { chmod, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseConfig, type ParseResult } from "./schema.ts";

/** A TOML value written by Coopilot: strings are quoted and escaped, lists and inline tables nest. */
export type TomlValue = string | number | boolean | TomlValue[] | { [k: string]: TomlValue };

const BARE_KEY = /^[A-Za-z0-9_-]+$/;
export const tomlKey = (k: string) => (BARE_KEY.test(k) ? k : JSON.stringify(k));

export function tomlValue(v: TomlValue): string {
  if (typeof v === "string") return JSON.stringify(v); // a JSON string is a valid TOML basic string
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error("numbers must be finite");
    return String(v);
  }
  if (typeof v === "boolean") return v ? "true" : "false";
  if (Array.isArray(v)) return `[${v.map(tomlValue).join(", ")}]`;
  return `{ ${Object.entries(v).map(([k, x]) => `${tomlKey(k)} = ${tomlValue(x)}`).join(", ")} }`;
}

const HEADER = /^\s*\[([^[\]]+)\]\s*(#.*)?$/;
const ARRAY_HEADER = /^\s*\[\[([^[\]]+)\]\]\s*(#.*)?$/;
const headerName = (line: string) => {
  const m = HEADER.exec(line) ?? ARRAY_HEADER.exec(line);
  return m ? m[1]!.trim() : null;
};

/** Line range [from, to) of a [section]'s body (after its header), or null when the section is missing. */
function sectionBody(lines: string[], section: string): { header: number; from: number; to: number } | null {
  const header = lines.findIndex((l) => HEADER.test(l) && headerName(l) === section);
  if (header < 0) return null;
  let to = header + 1;
  while (to < lines.length && headerName(lines[to]!) === null) to++;
  // Comments right above the next header belong to it.
  while (to > header + 1 && /^\s*#/.test(lines[to - 1]!) && to < lines.length) to--;
  while (to > header + 1 && lines[to - 1]!.trim() === "") to--;
  return { header, from: header + 1, to };
}

/**
 * Sets `key = value` in [section], replacing the line if the key is there, adding it at the end of the section if
 * not, and adding the section at the end of the file if it is missing. Comments and other lines are untouched.
 */
export function setValue(text: string, section: string, key: string, value: TomlValue, comment?: string): string {
  const lines = text.split("\n");
  const line = `${tomlKey(key)} = ${tomlValue(value)}`;
  const body = sectionBody(lines, section);
  if (!body) {
    const tail = text.endsWith("\n") ? "" : "\n";
    return `${text}${tail}\n${comment ? `# ${comment}\n` : ""}[${section}]\n${line}\n`;
  }
  const keyRe = new RegExp(`^\\s*${(BARE_KEY.test(key) ? key : JSON.stringify(key)).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=`);
  const at = lines.slice(body.from, body.to).findIndex((l) => keyRe.test(l));
  if (at >= 0) lines[body.from + at] = line;
  else lines.splice(body.to, 0, line);
  return lines.join("\n");
}

/** Removes `key` from [section] if present. */
export function removeValue(text: string, section: string, key: string): string {
  const lines = text.split("\n");
  const body = sectionBody(lines, section);
  if (!body) return text;
  const keyRe = new RegExp(`^\\s*${(BARE_KEY.test(key) ? key : JSON.stringify(key)).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=`);
  const at = lines.slice(body.from, body.to).findIndex((l) => keyRe.test(l));
  if (at >= 0) lines.splice(body.from + at, 1);
  return lines.join("\n");
}

/**
 * Replaces the whole body of [section] (keeping its header and the comments above it), or of every [[section]]
 * table when `array` is set (replaced by `bodies`, one table each). Adds the section at the end when missing.
 */
export function replaceSection(text: string, section: string, bodyLines: string[], comment?: string): string {
  const lines = text.split("\n");
  const body = sectionBody(lines, section);
  if (!body) {
    const tail = text.endsWith("\n") ? "" : "\n";
    return `${text}${tail}\n${comment ? `# ${comment}\n` : ""}[${section}]\n${bodyLines.join("\n")}${bodyLines.length ? "\n" : ""}`;
  }
  lines.splice(body.from, body.to - body.from, ...bodyLines);
  return lines.join("\n");
}

/** Replaces every [[section]] table with `tables` (each a list of body lines), where the first one was. */
export function replaceArrayTables(text: string, section: string, tables: string[][], comment?: string): string {
  const lines = text.split("\n");
  const starts: number[] = [];
  lines.forEach((l, i) => ARRAY_HEADER.test(l) && headerName(l) === section && starts.push(i));
  const rendered = tables.flatMap((t, i) => [...(i ? [""] : []), `[[${section}]]`, ...t]);
  if (!starts.length) {
    if (!tables.length) return text;
    const tail = text.endsWith("\n") ? "" : "\n";
    return `${text}${tail}\n${comment ? `# ${comment}\n` : ""}${rendered.join("\n")}\n`;
  }
  // Remove each table (header and body), back to front, then insert the new ones where the first was.
  for (const s of [...starts].reverse()) {
    let e = s + 1;
    while (e < lines.length && headerName(lines[e]!) === null) e++;
    while (e > s + 1 && (/^\s*#/.test(lines[e - 1]!) || lines[e - 1]!.trim() === "") && e < lines.length) e--;
    lines.splice(s, e - s);
  }
  lines.splice(starts[0]!, 0, ...rendered);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}

/** How many backups are kept (oldest removed first). */
export const KEEP_BACKUPS = 30;

export const backupDir = (configPath: string) => join(dirname(configPath), "backups");

export type WriteResult = { ok: true; parsed: ParseResult & { ok: true }; backup: string } | { ok: false; parsed: ParseResult };

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
