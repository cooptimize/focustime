// NT-1: the background reads a person's settings one way. In server/ticks.ts every part gets the person's context as
// `bg` (in production with the sign-in's "me", as a request has it); the raw `liveCtx` is used only for what doesn't
// depend on who the person is. A part that read settings, Dataverse or a context built from them the raw way would
// make a hosted person's PTO day look like a working day again, so this fails on it.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** liveCtx fields that don't depend on the person's settings or identity (ports, the env, the sign-in itself). */
const PLAIN = new Set(["notifications", "autoStartEnv", "requests", "takes", "signedInAs", "org", "devopsNotes", "team", "meetings", "makeOutlook", "makeGoogle", "linkCalendars"]);
/** Calls that may take liveCtx whole: dispatch adds the sign-in itself (as every request), and the one wrapping. */
const WHOLE = /\b(dispatch|withSignedIn)\(\s*liveCtx\b/;

const BG = /const bg = d\.policy\.production \? withSignedIn\(liveCtx\) : liveCtx;/;

/** Each raw use of liveCtx in a source, as "line: text". */
export function rawUses(src: string): string[] {
  const out: string[] = [];
  src.split("\n").forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, "");
    // The one place that chooses: signed in production, raw elsewhere (nothing new is read outside production).
    if (BG.test(code)) return;
    for (const m of code.matchAll(/\bliveCtx\b(\s*\.\s*(\w+)|\s*\?\.\s*(\w+))?/g)) {
      const field = m[2] ?? m[3];
      const at = m.index ?? 0;
      if (field && PLAIN.has(field)) continue;
      // The parameter itself and the whole-context calls above.
      if (/liveCtx:\s*ActionContext/.test(code.slice(at))) continue;
      if (WHOLE.test(code.slice(Math.max(0, at - 20), at + 10))) continue;
      out.push(`${i + 1}: ${line.trim()}`);
    }
  });
  return out;
}

describe("NT-1: the background reads a person's settings one way", () => {
  it("server/ticks.ts uses the raw context only for what doesn't depend on who the person is", () => {
    const src = readFileSync(resolve(import.meta.dirname, "ticks.ts"), "utf8");
    expect(rawUses(src)).toEqual([]);
    // And the one context everything else uses is the signed one in production.
    expect(src).toMatch(BG);
  });

  it("fails on a part that reads settings, Dataverse or a context the raw way", () => {
    const bad = [
      "  const configOrNull = async () => (await liveCtx.loadConfig()).parsed;",
      "  const off = await liveCtx.makeDataverse(c.dataverse, zone).pto(d, d);",
      "  const rc = await requestContext(liveCtx);",
      "  const vc = () => vmContext(liveCtx);",
      "  await presenceContext(liveCtx).then(syncTeamsStatus);",
    ].join("\n");
    expect(rawUses(bad)).toHaveLength(5);
    expect(rawUses("  const r = await dispatch(liveCtx, { action: 'status.load', input: {} });\n  const t = liveCtx.takes;")).toEqual([]);
  });
});
