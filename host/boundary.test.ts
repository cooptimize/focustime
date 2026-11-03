// A1: the host boundary. Core modules (week/, plan/, actions/, sources/, store/) reach the machine only through the
// Host interface (host/types.ts), handed in at startup. This walks every import from every core module, following
// relative imports into config/, log/, links/ and the rest, and fails on an operating system module, either host
// implementation, the fakes, or a desktop program named in a core module's code.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..");
const CORE = ["week", "plan", "actions", "sources", "store"];
/** Operating system modules: files and folders, processes, the network listener, the machine. */
const OS_MODULE = /^(node:)?(child_process|fs|fs\/promises|os|path|http|https|http2|net|dgram|tls|worker_threads|cluster|readline|tty|v8|vm|process)$/;
/** Only server/ may construct a host. */
const IMPLEMENTATION = /^host\/(local|azure)\/|^host\/fakes\.ts$|^server\//;
/** Programs the local host runs; a core module naming one means an OS touch slipped past the interface. */
const PROGRAMS = /["'`](secret-tool|notify-send|gdbus|playerctl|pw-play|xdg-open|chromium|focustime-open|systemctl)\b/;

const isSource = (n: string) => /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) && !/(^|-)fakes?\.ts$|test-helpers\.ts$/.test(n);
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : isSource(n) ? [join(d, n)] : []));

export function importsOf(text: string): string[] {
  return [...text.matchAll(/^\s*(?:import|export)\s[^;]*?\sfrom\s+["']([^"']+)["']|^\s*import\s+["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)|\brequire\(\s*["']([^"']+)["']\s*\)/gm)].map((m) => (m[1] ?? m[2] ?? m[3] ?? m[4])!);
}

/** Every boundary break reachable from the core modules, as "importer -> what". */
export function violations(files: string[], read = (f: string) => readFileSync(f, "utf8"), exists: (f: string) => boolean = existsSync): string[] {
  const out = new Set<string>();
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const rel = relative(ROOT, file);
    const text = read(file);
    for (const spec of importsOf(text)) {
      if (spec.startsWith(".")) {
        const target = resolve(dirname(file), spec);
        const r = relative(ROOT, target);
        if (IMPLEMENTATION.test(r)) out.add(`${rel} -> ${r}`);
        else if (exists(target)) visit(target);
      } else if (OS_MODULE.test(spec)) out.add(`${rel} -> ${spec}`);
    }
    const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const program = CORE.some((d) => rel.startsWith(`${d}/`)) ? PROGRAMS.exec(code) : null;
    if (program) out.add(`${rel} -> runs ${program[1]}`);
  };
  for (const f of files) visit(f);
  return [...out].sort();
}

describe("host boundary (A1)", () => {
  it("no core module reaches the machine except through the Host interface", () => {
    const files = CORE.flatMap((d) => walk(join(ROOT, d)));
    expect(files.length).toBeGreaterThan(100);
    expect(violations(files)).toEqual([]);
  });

  it("only server/main.ts constructs a host", () => {
    const all = ["actions", "config", "host", "links", "log", "plan", "scripts", "server", "sources", "store", "ui", "week"].flatMap((d) => (existsSync(join(ROOT, d)) ? walk(join(ROOT, d)) : []));
    const makers = all.filter((f) => importsOf(readFileSync(f, "utf8")).some((s) => /host\/(local|azure)\/index\.ts$/.test(s))).map((f) => relative(ROOT, f));
    expect(makers).toEqual(["server/main.ts"]);
  });

  it("the check catches each kind of break", () => {
    const fake: Record<string, string> = {
      [join(ROOT, "sources/x.ts")]: 'import { spawn } from "node:child_process";\nimport { a } from "../config/y.ts";',
      [join(ROOT, "plan/z.ts")]: 'import fs from "fs";\nexport { k } from "../host/local/keyring.ts";\nconst run = () => ["notify-send", "x"];',
      [join(ROOT, "week/w.ts")]: '// runs "xdg-open" in a comment only\nimport type { Host } from "../host/types.ts";',
    };
    const read = (f: string) => fake[f] ?? 'import { join } from "node:path";';
    expect(violations(Object.keys(fake), read, (f) => f.endsWith("config/y.ts"))).toEqual([
      "config/y.ts -> node:path",
      "plan/z.ts -> fs",
      "plan/z.ts -> host/local/keyring.ts",
      "plan/z.ts -> runs notify-send",
      "sources/x.ts -> node:child_process",
    ]);
  });
});
