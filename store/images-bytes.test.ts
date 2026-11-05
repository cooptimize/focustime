// CV-4: FocusTime never keeps chat images. Until a later release drops teams_message_images.bytes (D468: a drop ships
// after the code that stops using it), no code may write it: this fails on any INSERT or UPDATE that names it, outside
// the migrations (the one that clears it) and tests.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const SKIP = new Set(["node_modules", "dist", ".git", "e2e", "fixtures", "test"]);
function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/** Statements that write the image bytes column: an INSERT listing it, or an UPDATE setting it. */
export function writesBytes(source: string): string[] {
  const hits: string[] = [];
  const insert = /INSERT\s+INTO\s+teams_message_images\s*\(([^)]*)\)/gi;
  const update = /UPDATE\s+teams_message_images\s+SET\s+([^"`]*?)(?:\s+WHERE\b|["`])/gi;
  for (const m of source.matchAll(insert)) if (/\bbytes\b/i.test(m[1]!)) hits.push(m[0].slice(0, 80));
  for (const m of source.matchAll(update)) if (/\bbytes\s*=/i.test(m[1]!)) hits.push(m[0].slice(0, 80));
  return hits;
}

describe("chat image bytes are never written (CV-4)", () => {
  it("spots a write of the column", () => {
    expect(writesBytes(`db.run("UPDATE teams_message_images SET state = 'ok', bytes = ? WHERE id = ?")`)).toHaveLength(1);
    expect(writesBytes(`"INSERT INTO teams_message_images (chat_id, bytes) VALUES (?, ?)"`)).toHaveLength(1);
    expect(writesBytes(`"UPDATE teams_message_images SET state = 'ok', byte_size = ? WHERE id = ?"`)).toEqual([]);
    expect(writesBytes(`"INSERT INTO teams_message_images (chat_id, byte_size) VALUES (?, ?)"`)).toEqual([]);
  });

  it("no code outside the migrations writes teams_message_images.bytes", () => {
    const files = sources(ROOT).filter((f) => !relative(ROOT, f).startsWith(join("store", "migrations")));
    expect(files.length).toBeGreaterThan(100);
    expect(files.flatMap((f) => writesBytes(readFileSync(f, "utf8")).map((h) => `${relative(ROOT, f)}: ${h}`))).toEqual([]);
  });
});
