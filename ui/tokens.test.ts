// The token layers in ui/styles.css (style guide section 3): components use semantic and domain tokens only.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
// The token blocks: the first `:root { ... }` and the dark `@media` block that follows it.
const tokensEnd = css.indexOf("* { box-sizing");
const tokens = css.slice(0, tokensEnd);
const components = css.slice(tokensEnd);
const declared = (s: string) => new Set([...s.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]!));
const used = (s: string) => new Set([...s.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]!));
const lightRoot = tokens.slice(0, tokens.indexOf("@media"));
const darkRoot = tokens.slice(tokens.indexOf("@media"));

describe("design tokens", () => {
  it("components use no raw colors and no primitives", () => {
    expect(components.match(/#[0-9a-f]{3,8}\b/gi) ?? []).toEqual([]);
    expect([...used(components)].filter((v) => v.startsWith("--p-"))).toEqual([]);
    // Shadows and backdrops are semantic tokens too.
    expect(components.match(/rgba?\(/g) ?? []).toEqual([]);
  });

  it("every token a component uses is defined in the light root", () => {
    const local = declared(components); // element-level, e.g. --c (the block's client color)
    // Set from script: a block's client colors (--c, --c2, inline styles) and the fallbacks they name (ui/labels.ts).
    const fromScript = (v: string) => v === "--c" || v === "--c2" || /^--client-fallback-\d$/.test(v);
    const missing = [...used(components)].filter((v) => !declared(lightRoot).has(v) && !local.has(v) && !fromScript(v));
    expect(missing).toEqual([]);
  });

  it("the dark block only redefines tokens the light root defines", () => {
    expect([...declared(darkRoot)].filter((v) => !declared(lightRoot).has(v))).toEqual([]);
  });

  it("primitives are only used by semantic and domain tokens", () => {
    const prims = [...declared(lightRoot)].filter((v) => v.startsWith("--p-"));
    expect(prims.length).toBeGreaterThan(20);
    for (const m of tokens.matchAll(/(--p-[\w-]+)\s*:\s*([^;]+);/g)) expect(m[2], m[1]).not.toMatch(/var\(/);
  });
});
