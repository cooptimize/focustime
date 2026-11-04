// The browser tests' UI, built once per run. Each e2e file starts its own demo server; with Vite in every server
// (--dev) each one compiled the whole UI again on its first page, about 30 times a run, which on CI's four cores
// pushed pages past their timeouts (Close out, the first-run setup). A production build takes under a second, so
// the run builds it here, into the run's temp folder, and e2e/harness.ts serves it (FOCUSTIME_DIST) instead.
// FOCUSTIME_E2E_DIST set beforehand uses that build; FOCUSTIME_E2E_DIST=dev keeps Vite in each server.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "vite";

export default async function setup(): Promise<void> {
  if (process.env.FOCUSTIME_E2E_DIST) return;
  // After test/tmp-dir.ts, so TMPDIR is the run's own folder and the build goes with it.
  const outDir = mkdtempSync(join(tmpdir(), "focustime-e2e-dist-"));
  const root = resolve(import.meta.dirname, "..");
  await build({ root, configFile: join(root, "vite.config.ts"), logLevel: "error", build: { outDir, emptyOutDir: true } });
  process.env.FOCUSTIME_E2E_DIST = outDir;
}
