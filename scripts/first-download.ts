// PF-1: what the app's first screen downloads, measured from a real build. The first download is the page
// (index.html), the files it names (prefs.js, the loader's styles, the entry script) and every script and stylesheet
// the entry and ui/main.tsx import statically; a file loaded with import() when a screen opens is not in it (the
// fonts are counted apart: they arrive when text is first drawn). Sizes are raw and gzipped (level 9, what the report
// of `vite build` shows; the hosted app's own compression may differ a little, the comparison doesn't).
//
//   node scripts/first-download.ts            the report: every file, the first download, what is in it by area
//   node scripts/first-download.ts --json     the same as JSON
//   node scripts/first-download.ts --write    the report, and the limit's record rewritten (test/first-download.json)
//
// scripts/first-download.test.ts (the unit job) fails when the first download is over the recorded limit, or holds a
// screen that loads on demand, and names the modules that grew or arrived since the record was written.
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { gzipSync } from "node:zlib";
import { build, type Plugin } from "vite";

export const ROOT = resolve(import.meta.dirname, "..");
export const RECORD = join(ROOT, "test", "first-download.json");
/** The app's start: index.html's script, and the module it loads once Temporal is there (ui/boot.ts). */
const STARTS = ["ui/boot.ts", "ui/main.tsx"];

export type FileSize = { file: string; raw: number; gzip: number };
export type Report = {
  /** Every file the build wrote (no maps), largest first. */
  files: FileSize[];
  /** The files the first screen needs, in the order it asks for them. */
  first: FileSize[];
  /** Fonts the first screen's styles name (fetched when text is drawn). */
  fonts: FileSize[];
  script: { raw: number; gzip: number };
  styles: { raw: number; gzip: number };
  /** Source module → its bytes in the first download's scripts (before minifying). */
  modules: Record<string, number>;
  /** Source module → the chunk file that holds it, for every chunk. */
  chunkOf: Record<string, string>;
  /** For a module in the first download: the chain of static imports from the app's start that pulls it in. */
  why: (module: string) => string[];
};

const rel = (id: string) => {
  const clean = id.replace(/\?.*$/, "").replace(/^\0/, "");
  const r = relative(ROOT, clean).split(sep).join("/");
  if (r.startsWith("..") || /^[a-z-]+:/.test(clean)) return clean;
  const nm = r.lastIndexOf("node_modules/");
  return nm >= 0 ? r.slice(nm) : r;
};

type Chunk = { fileName: string; imports: string[]; css: string[]; modules: Record<string, number>; facade: string | null };

/** Builds the UI into a temp folder (or reads `dist` as already built with `collect`) and measures it. */
export async function measure(): Promise<Report> {
  const outDir = mkdtempSync(join(tmpdir(), "focustime-first-download-"));
  const chunks = new Map<string, Chunk>();
  const imported = new Map<string, string[]>();
  const collect: Plugin = {
    name: "focustime-first-download",
    generateBundle(_o, bundle) {
      for (const f of Object.values(bundle)) {
        if (f.type !== "chunk") continue;
        const css = [...((f as unknown as { viteMetadata?: { importedCss?: Set<string> } }).viteMetadata?.importedCss ?? [])];
        chunks.set(f.fileName, { fileName: f.fileName, imports: [...f.imports], css, modules: Object.fromEntries(Object.entries(f.modules).map(([id, m]) => [rel(id), m.renderedLength])), facade: f.facadeModuleId ? rel(f.facadeModuleId) : null });
        for (const id of Object.keys(f.modules)) imported.set(rel(id), [...(this.getModuleInfo(id)?.importedIds ?? [])].map(rel));
      }
    },
  };
  try {
    await build({ root: ROOT, configFile: join(ROOT, "vite.config.ts"), logLevel: "error", plugins: [collect], build: { outDir, emptyOutDir: true } });
    const size = (file: string): FileSize => {
      const b = readFileSync(join(outDir, file));
      return { file, raw: b.length, gzip: gzipSync(b, { level: 9 }).length };
    };
    const all: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) e.isDirectory() ? walk(join(dir, e.name)) : all.push(relative(outDir, join(dir, e.name)).split(sep).join("/"));
    };
    walk(outDir);
    const files = all.filter((f) => !f.endsWith(".map")).map(size).sort((a, b) => b.raw - a.raw);

    // The first download: the page's own files, then the static closure of the start modules' chunks.
    const html = readFileSync(join(outDir, "index.html"), "utf8");
    const named = [...html.matchAll(/(?:src|href)="\/([^"]+\.(?:js|css))"/g)].map((m) => m[1]!);
    const firstFiles = new Set<string>(["index.html", ...named]);
    const startChunks = [...chunks.values()].filter((c) => STARTS.some((s) => s in c.modules));
    const seen = new Set<string>();
    const visit = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const c = chunks.get(file);
      if (!c) return;
      firstFiles.add(file);
      c.css.forEach((f) => firstFiles.add(f));
      c.imports.forEach(visit);
    };
    startChunks.forEach((c) => visit(c.fileName));
    const first = [...firstFiles].filter((f) => all.includes(f)).map(size);
    const sum = (list: FileSize[]) => ({ raw: list.reduce((n, f) => n + f.raw, 0), gzip: list.reduce((n, f) => n + f.gzip, 0) });
    const cssText = first.filter((f) => f.file.endsWith(".css")).map((f) => readFileSync(join(outDir, f.file), "utf8")).join("\n");
    const fonts = files.filter((f) => /\.woff2?$/.test(f.file) && cssText.includes(f.file.split("/").pop()!));

    const modules: Record<string, number> = {};
    const chunkOf: Record<string, string> = {};
    for (const c of chunks.values()) for (const [id, n] of Object.entries(c.modules)) (chunkOf[id] = c.fileName), seen.has(c.fileName) && (modules[id] = n);
    const why = (target: string): string[] => {
      // Breadth first over static imports from the start modules: the shortest chain.
      const from = new Map<string, string | null>(STARTS.map((s) => [s, null]));
      const queue = [...STARTS];
      while (queue.length) {
        const at = queue.shift()!;
        if (at === target) {
          const chain: string[] = [];
          for (let m: string | null = at; m; m = from.get(m) ?? null) chain.unshift(m);
          return chain;
        }
        for (const next of imported.get(at) ?? []) if (!from.has(next)) (from.set(next, at), queue.push(next));
      }
      return [];
    };
    return { files, first, fonts, script: sum(first.filter((f) => f.file.endsWith(".js"))), styles: sum(first.filter((f) => f.file.endsWith(".css"))), modules, chunkOf, why };
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

/** A module's area, for the report: the screen folder or file it belongs to, or its package. */
export function areaOf(module: string): string {
  if (module.startsWith("node_modules/")) return module.split("/").slice(0, module.split("/")[1]!.startsWith("@") ? 3 : 2).join("/");
  const parts = module.split("/");
  if (parts[0] === "ui" && parts.length > 2) return `ui/${parts[1]}/`;
  if (parts[0] === "ui") return module;
  return `${parts[0]}/`;
}

export type Record_ = { limit: { script: number; styles: number }; measured: { script: number; styles: number }; modules: Record<string, number> };
export const readRecord = (): Record_ | null => {
  try {
    statSync(RECORD);
    return JSON.parse(readFileSync(RECORD, "utf8")) as Record_;
  } catch {
    return null;
  }
};

/** What grew since the record: modules new to the first download and modules larger than recorded, largest change first. */
export function grew(now: Record<string, number>, then: Record<string, number>, floor = 200): { module: string; by: number; isNew: boolean }[] {
  return Object.entries(now)
    .map(([module, n]) => ({ module, by: n - (then[module] ?? 0), isNew: !(module in then) }))
    .filter((g) => g.by >= floor)
    .sort((a, b) => b.by - a.by);
}

const kb = (n: number) => `${(n / 1000).toFixed(1)} kB`;

export function text(r: Report): string {
  const out: string[] = [];
  const row = (f: FileSize) => `  ${f.file.padEnd(58)} ${kb(f.raw).padStart(11)} ${kb(f.gzip).padStart(10)}`;
  out.push("Every file (raw, gzip):", ...r.files.map(row), "");
  out.push("The first download:", ...r.first.map(row));
  out.push(`  script ${kb(r.script.raw)} raw, ${kb(r.script.gzip)} gzip; styles ${kb(r.styles.raw)} raw, ${kb(r.styles.gzip)} gzip`);
  out.push(`  fonts its styles name (fetched as text is drawn): ${kb(r.fonts.reduce((n, f) => n + f.raw, 0))} in ${r.fonts.length} files`, "");
  const areas = new Map<string, number>();
  for (const [m, n] of Object.entries(r.modules)) areas.set(areaOf(m), (areas.get(areaOf(m)) ?? 0) + n);
  const total = [...areas.values()].reduce((a, b) => a + b, 0);
  out.push("What the first download's script is made of (bytes before minifying):");
  for (const [a, n] of [...areas].sort((x, y) => y[1] - x[1]).slice(0, 60)) out.push(`  ${a.padEnd(58)} ${kb(n).padStart(11)} ${((100 * n) / total).toFixed(1).padStart(5)}%`);
  return out.join("\n");
}

if (import.meta.main) {
  const r = await measure();
  if (process.argv.includes("--json")) process.stdout.write(JSON.stringify({ ...r, why: undefined }, null, 1) + "\n");
  else process.stdout.write(text(r) + "\n");
  const whyAt = process.argv.indexOf("--why");
  if (whyAt > 0) for (const m of process.argv.slice(whyAt + 1)) process.stdout.write(`\n${m}:\n  ${r.why(m).join("\n  → ") || "not in the first download"}\n`);
  if (process.argv.includes("--write")) {
    // The limit: a little above what was measured (3%, rounded up to the next kB), so ordinary work fits and a screen
    // pulled back in doesn't.
    const over = (n: number) => Math.ceil((n * 1.03) / 1000) * 1000;
    const record: Record_ = { limit: { script: over(r.script.gzip), styles: over(r.styles.gzip) }, measured: { script: r.script.gzip, styles: r.styles.gzip }, modules: Object.fromEntries(Object.entries(r.modules).sort()) };
    writeFileSync(RECORD, JSON.stringify(record, null, 1) + "\n");
    process.stdout.write(`\nRecorded: script ${kb(r.script.gzip)} (limit ${kb(record.limit.script)}), styles ${kb(r.styles.gzip)} (limit ${kb(record.limit.styles)}) in test/first-download.json\n`);
  }
}
