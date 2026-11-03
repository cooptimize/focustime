// Step 9: focustime-open --capture leaves a one-shot request next to the launch file; the window takes it on load or
// focus and opens that view. The file holds only a view name: never a token or anything else.
import { lstat, readFile, rm } from "node:fs/promises";
import { join } from "node:path";

export const OPEN_REQUEST_FILE = "open-request";
/** Views the launcher may ask for. */
const VIEWS = new Set(["capture"]);
/** An older request is stale (the window was never opened or focused after it). */
const MAX_AGE_MS = 120_000;

/** Reads and removes the request. Null unless it is a fresh, private, regular file of ours naming a known view. */
export async function takeOpenRequest(runtimeDir: string, nowMs = Date.now()): Promise<string | null> {
  const path = join(runtimeDir, OPEN_REQUEST_FILE);
  let st;
  try {
    st = await lstat(path);
  } catch {
    return null;
  }
  try {
    if (!st.isFile() || (process.getuid && st.uid !== process.getuid()) || (st.mode & 0o077) !== 0) return null;
    if (nowMs - st.mtimeMs > MAX_AGE_MS) return null;
    const view = (await readFile(path, "utf8")).trim();
    return VIEWS.has(view) ? view : null;
  } finally {
    await rm(path, { force: true }).catch(() => {});
  }
}
