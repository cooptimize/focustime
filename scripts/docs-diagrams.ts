// DOC-1: draws the Mermaid blocks in docs/technical/*.md as SVG files (docs/technical/diagrams/<key>.svg), so the
// app shows them without loading Mermaid at all and CI needs no browser for them. Run it after changing a diagram:
//
//   npm run docs:diagrams            draws the missing ones and removes ones no page uses
//   npm run docs:diagrams -- --check exits 1 when one is missing or unused (scripts/tech-docs.test.ts checks the same)
//
// Mermaid isn't a dependency: the system Chromium (playwright-core, already a dev dependency) loads one pinned file
// from jsDelivr, refused unless it matches its SHA-384 (the file in the npm tarball of the same version, checked when
// pinned). Strict security level, no HTML labels, so the SVG holds only shapes and text (scripts/tech-docs.ts
// checkSvg checks each one before the build uses it).
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";
import { checkSvg, diagramKey, DOCS_DIR, mermaidBlocks, TECH_PAGES } from "./tech-docs.ts";

export const MERMAID = {
  version: "12.2.0",
  url: "https://cdn.jsdelivr.net/npm/mermaid@12.2.0/dist/mermaid.min.js",
  integrity: "sha384-8xUhuLNMjW/cI2Dacg3DR4WliYznvIg0LVG1stctThKD/YVrJFI9TNCFxft5NYgp",
};
const CHROMIUM = ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"].find((p) => existsSync(p));

/** Every diagram the pages use: key → source. */
export function wantedDiagrams(root: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of TECH_PAGES) for (const src of mermaidBlocks(readFileSync(join(root, DOCS_DIR, p.file), "utf8"))) out.set(diagramKey(src), src);
  return out;
}

async function draw(sources: Map<string, string>): Promise<Map<string, string>> {
  if (!CHROMIUM) throw new Error("No Chromium found (/usr/bin/chromium): it draws the diagrams");
  const browser = await chromium.launch({ executablePath: CHROMIUM, args: ["--disable-gpu"] });
  try {
    const page = await browser.newPage();
    await page.setContent(`<!doctype html><html><body><script src="${MERMAID.url}" integrity="${MERMAID.integrity}" crossorigin="anonymous"></script></body></html>`, { waitUntil: "load" });
    const ok = await page.evaluate(() => typeof (globalThis as { mermaid?: unknown }).mermaid === "object");
    if (!ok) throw new Error("Mermaid didn't load (offline, or the file didn't match its integrity hash)");
    const out = new Map<string, string>();
    for (const [key, src] of sources) {
      const svg = await page.evaluate(
        async ({ key, src }) => {
          const m = (globalThis as unknown as { mermaid: { initialize: (o: unknown) => void; render: (id: string, s: string) => Promise<{ svg: string }> } }).mermaid;
          m.initialize({ startOnLoad: false, securityLevel: "strict", theme: "neutral", htmlLabels: false, flowchart: { htmlLabels: false, useMaxWidth: true }, sequence: { useMaxWidth: true }, fontFamily: "IBM Plex Sans, system-ui, sans-serif" });
          return (await m.render(`d${key}`, src)).svg;
        },
        { key, src },
      );
      checkSvg(svg, `diagram ${key}`);
      out.set(key, svg);
    }
    return out;
  } finally {
    await browser.close();
  }
}

async function main(argv: string[]): Promise<number> {
  const root = resolve(import.meta.dirname, "..");
  const dir = join(root, DOCS_DIR, "diagrams");
  mkdirSync(dir, { recursive: true });
  const wanted = wantedDiagrams(root);
  const have = new Set(readdirSync(dir).filter((f) => f.endsWith(".svg")).map((f) => f.slice(0, -4)));
  const missing = new Map([...wanted].filter(([k]) => !have.has(k)));
  const unused = [...have].filter((k) => !wanted.has(k));
  if (argv.includes("--check")) {
    for (const k of missing.keys()) console.error(`missing: ${k}.svg`);
    for (const k of unused) console.error(`unused: ${k}.svg`);
    return missing.size || unused.length ? 1 : 0;
  }
  for (const k of unused) rmSync(join(dir, `${k}.svg`));
  const drawn = missing.size ? await draw(missing) : new Map<string, string>();
  for (const [k, svg] of drawn) writeFileSync(join(dir, `${k}.svg`), `${svg}\n`);
  console.log(`diagrams: ${wanted.size} used, ${drawn.size} drawn, ${unused.length} removed`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = await main(process.argv.slice(2));
