// P1: the installable app. The service worker (server/sw.js) is served at /sw.js with this build's version and the
// app shell's paths filled in: every file the UI build wrote (dist), which is the page, its hashed scripts, styles and
// fonts, the icons and the manifest; nothing else, so no API response or person's data can ever be in its cache.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { createHash } from "node:crypto";

export const SW_PATH = "/sw.js";
const TEMPLATE = readFileSync(join(import.meta.dirname, "sw.js"), "utf8");

/** Every file under the UI build as a URL path ("/" for index.html), sorted. */
export function shellPaths(distDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) out.push(`/${relative(distDir, p).split(sep).join("/")}`);
    }
  };
  walk(distDir);
  return out
    .filter((p) => !p.endsWith(".map") && p !== SW_PATH)
    .map((p) => (p === "/index.html" ? "/" : p))
    .sort();
}

/**
 * The worker's source for one build. The cache is named by the build's short sha; a build without one (a local run)
 * is named by a hash of its shell list, which changes whenever a hashed file does.
 */
export function serviceWorkerSource(sha: string, shell: readonly string[]): string {
  const version = /^[0-9a-f]{7,40}$/.test(sha) ? sha.slice(0, 7) : `local-${createHash("sha256").update(shell.join("\n")).digest("hex").slice(0, 10)}`;
  return TEMPLATE.replace("__FOCUSTIME_VERSION__", version).replace("__FOCUSTIME_SHELL__", JSON.stringify(shell));
}
