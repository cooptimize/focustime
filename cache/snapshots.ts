// Last good snapshot per source per week. Normalized fields only; no secrets, tokens or raw bodies.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type Snapshot<T> = { fetchedAt: string; items: T[] };

// A week (calendars, Dataverse) or a short slug (DevOps, one file per client).
const KEY = /^(\d{4}-\d{2}-\d{2}|[a-z0-9][a-z0-9-]{0,79})$/;

function file(root: string, source: string, weekStart: string): string {
  if (!KEY.test(weekStart) || !/^[a-z]+$/.test(source)) throw new Error("Bad snapshot key");
  return join(root, source, `${weekStart}.json`);
}

export async function readSnapshot<T>(root: string, source: string, weekStart: string): Promise<Snapshot<T> | null> {
  try {
    const parsed = JSON.parse(await readFile(file(root, source, weekStart), "utf8")) as Snapshot<T>;
    if (typeof parsed.fetchedAt !== "string" || !Array.isArray(parsed.items)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function writeSnapshot<T>(root: string, source: string, weekStart: string, snap: Snapshot<T>): Promise<void> {
  const path = file(root, source, weekStart);
  await mkdir(join(root, source), { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(snap, null, 1), { mode: 0o600 });
  await rename(tmp, path);
}
