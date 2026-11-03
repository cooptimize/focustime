// The test run's own temp folder: every test's mkdtemp (stores, caches, profiles) lands under it through TMPDIR, and it
// is removed when the run ends, so runs leave nothing in /tmp (they used to leave about 100 MB each). Vitest's
// globalSetup runs in the main process before the workers start, so they inherit TMPDIR.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default function setup(): () => void {
  const dir = mkdtempSync(join(tmpdir(), "focustime-test-run-"));
  const before = process.env.TMPDIR;
  process.env.TMPDIR = dir;
  return () => {
    if (before === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = before;
    rmSync(dir, { recursive: true, force: true });
  };
}
