// ID-1: one way to know who is asking. A route or a job under server/ that reaches a person's actions without
// `dispatch` (which signs the context itself) must take the context from `signedContext` (actions/dispatch.ts), the
// same function the dispatcher uses: a hosted person's Dataverse user is kept with their sign-in, not in their
// settings, so a context built any other way reads as nobody (an upload's pass ended "no_context" at once). This fails
// on any call that hands one of the actions' context functions a context that didn't come through it.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..");

/**
 * Files that build no person's context of their own, with why: NT-1's background (its own guard,
 * server/ticks-identity.test.ts, keeps every part on its signed `bg`), and the demo (a fictional person whose identity
 * is in its own settings; never a real session's runtime, D442).
 */
const EXEMPT = new Map([
  ["server/ticks.ts", "NT-1: server/ticks-identity.test.ts"],
  ["server/demo.ts", "the demo's fictional person"],
]);
/** Context functions that may take the context as it is: the dispatcher signs it itself, and the one function. */
const SIGNS_ITSELF = new Set(["dispatch", "signedContext", "withSignedIn"]);

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.ts$/.test(n) && !/\.test\.ts$/.test(n) ? [p] : [];
  });

/** Every exported function in actions/ whose first parameter is a person's ActionContext. */
export function contextFunctions(): string[] {
  const names = new Set<string>();
  for (const f of walk(join(ROOT, "actions"))) {
    for (const m of readFileSync(f, "utf8").matchAll(/export (?:async )?function (\w+)(?:<[^>]*>)?\(\s*\w+: ActionContext\s*[,)]/g)) names.add(m[1]!);
  }
  return [...names].filter((n) => !SIGNS_ITSELF.has(n)).sort();
}

/** The first argument of the call whose "(" is at `open`, as written. */
function firstArg(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i]!;
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth === 0) return src.slice(open + 1, i).trim();
    } else if (c === "," && depth === 1) return src.slice(open + 1, i).trim();
  }
  return "";
}

/** Each call in a source that hands a context function a context that didn't come through signedContext. */
export function unsignedCalls(src: string, fns: readonly string[]): string[] {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/\/\/.*$/gm, "");
  // Names bound to signedContext's answer: `const ctx = signedContext(...)`, `const personCtx = async (s) => signedContext(...)`.
  const signed = new Set([...code.matchAll(/\b(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?(?:\([^)]*\)\s*(?::\s*[^=]+)?=>\s*)?signedContext\(/g)].map((m) => m[1]!));
  const out: string[] = [];
  for (const fn of fns) {
    for (const m of code.matchAll(new RegExp(`(?<![\\w.])${fn}\\b(\\s*\\))?\\s*\\(`, "g"))) {
      const before = code.slice(Math.max(0, m.index - 12), m.index);
      if (/function\s+$/.test(before) || /import[^;]*$/.test(code.slice(Math.max(0, code.lastIndexOf("\n", m.index)), m.index))) continue;
      const arg = firstArg(code, m.index + m[0].length - 1).replace(/^await\s+/, "");
      const ok = /^signedContext\(/.test(arg) || [...signed].some((n) => new RegExp(`^(?:await\\s+)?${n}\\b`).test(arg));
      if (!ok) out.push(`${fn}(${arg})`);
    }
  }
  return out;
}

describe("ID-1: routes and jobs know who is asking one way", () => {
  const fns = contextFunctions();

  it("finds the actions' context functions", () => {
    for (const f of ["assistantTranscribe", "chatImage", "meetingContext", "meetingPerson", "requestContext", "aiFor", "assistantFor"]) expect(fns).toContain(f);
    expect(fns).not.toContain("dispatch");
  });

  it("every route and job under server/ hands them a context from signedContext", () => {
    const found: Record<string, string[]> = {};
    for (const f of walk(join(ROOT, "server"))) {
      const rel = relative(ROOT, f);
      if (EXEMPT.has(rel)) continue;
      const bad = unsignedCalls(readFileSync(f, "utf8"), fns);
      if (bad.length) found[rel] = bad;
    }
    expect(found).toEqual({});
  });

  it("fails on a route or a job that builds its own context", () => {
    const bad = [
      "  const out = await uploadTranscript(await meetingContext(await opts.ctx(s)), { seriesId });",
      "  const r = await (opts.transcribe ?? assistantTranscribe)(await opts.ctx(s), { audio });",
      "  const img = await chatImage(await opts.ctx(s), 7);",
      "  person: async (uid) => meetingPerson(await runtimeFor(uid)),",
      "  const ctx = await runtimeFor(uid);\n  const rc = await requestContext(ctx);",
      "  const a = await assistantFor(await o.ctxFor(p.userId), channel);",
    ].join("\n");
    expect(unsignedCalls(bad, fns)).toHaveLength(6);
  });

  it("passes the one function, a name bound to it, and dispatch as it is", () => {
    const good = [
      "  const personCtx = async (s: Session) => signedContext(await opts.ctx(s));",
      "  const out = await uploadTranscript(await meetingContext(await personCtx(s)), { seriesId });",
      "  const ctx = signedContext(raw);\n  const rc = await requestContext(ctx);",
      "  return meetingPerson(signedContext(raw));",
      "  const r = await dispatch(await runtimeFor(uid), { action, input });",
      "export async function chatImage(ctx: ActionContext, id: number) {}",
    ].join("\n");
    expect(unsignedCalls(good, fns)).toEqual([]);
  });
});
