// The token layers in ui/styles.css (style guide section 3): components use semantic and domain tokens only.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
// The token blocks: the default :root (primitives plus Cooptimize Dark), then one block per other theme.
const tokensEnd = css.indexOf("* { box-sizing");
const tokens = css.slice(0, tokensEnd);
const components = css.slice(tokensEnd);
const declared = (s: string) => new Set([...s.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]!));
const used = (s: string) => new Set([...s.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]!));
/** The body of the block that starts at `head`. */
const block = (head: string) => {
  const i = tokens.indexOf(head);
  if (i < 0) throw new Error(`no block ${head}`);
  const open = tokens.indexOf("{", i);
  let depth = 0;
  for (let j = open; j < tokens.length; j++) {
    if (tokens[j] === "{") depth++;
    else if (tokens[j] === "}" && --depth === 0) return tokens.slice(open + 1, j);
  }
  throw new Error(`unclosed ${head}`);
};
const root = block(":root {");
const light = block(':root[data-theme="cooptimize-light"]');
const neutral = block(':root[data-theme="neutral"] {');
const neutralDark = block("@media (prefers-color-scheme: dark)");
/** Tokens every theme assigns: semantic and domain, not primitives, the font or the fallback mapping. */
const themeTokens = [...declared(root)].filter((v) => !v.startsWith("--p-") && !v.startsWith("--font") && !v.startsWith("--client-fallback-"));

describe("design tokens", () => {
  it("components use no raw colors and no primitives", () => {
    expect(components.match(/#[0-9a-f]{3,8}\b/gi) ?? []).toEqual([]);
    expect([...used(components)].filter((v) => v.startsWith("--p-"))).toEqual([]);
    // Shadows and backdrops are semantic tokens too.
    expect(components.match(/rgba?\(/g) ?? []).toEqual([]);
  });

  it("every token a component uses is defined in the default root", () => {
    const local = declared(components); // element-level, e.g. --c (the block's client color)
    // Set from script: a block's client colors (--c, --c2, inline styles; Plan ahead's label and timeline widths) and the fallbacks they name (ui/labels.ts).
    const fromScript = (v: string) => v === "--c" || v === "--c2" || v === "--label-w" || v === "--tl-w" || /^--client-fallback-\d$/.test(v) || /^--client-[a-z]+$/.test(v);
    const missing = [...used(components)].filter((v) => !declared(root).has(v) && !local.has(v) && !fromScript(v));
    expect(missing).toEqual([]);
  });

  it("Cooptimize Light and Neutral assign every semantic and domain token (D120)", () => {
    expect(themeTokens.length).toBeGreaterThan(40);
    for (const [name, b] of [["cooptimize-light", light], ["neutral", neutral]] as const) expect(themeTokens.filter((v) => !declared(b).has(v)), name).toEqual([]);
  });

  it("theme blocks only assign theme tokens, never primitives", () => {
    for (const b of [light, neutral, neutralDark]) expect([...declared(b)].filter((v) => !themeTokens.includes(v))).toEqual([]);
  });

  it("primitives are only used by semantic and domain tokens", () => {
    const prims = [...declared(root)].filter((v) => v.startsWith("--p-"));
    expect(prims.length).toBeGreaterThan(60);
    for (const m of tokens.matchAll(/(--p-[\w-]+)\s*:\s*([^;]+);/g)) expect(m[2], m[1]).not.toMatch(/var\(/);
  });

  it("the font is self-hosted: no remote URL anywhere in the stylesheet", () => {
    expect(css).not.toMatch(/url\(\s*["']?(https?:)?\/\//);
    expect(css).toMatch(/url\("\.\/fonts\/red-hat-display-latin-wght-normal\.woff2"\)/);
  });
});
