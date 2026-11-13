// RS-1: the new tokens keep text readable. Muted and faint text on each wash over each surface, and a state's own
// color on its wash, pass AA (4.5:1) in every theme; the wash is what gets fixed, never the text color.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contrast, SLOT_VALUES } from "../config/org.ts";
import { DEMO_CLIENTS } from "../sources/demo/data.ts";

const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const tokens = css.slice(0, css.indexOf("* { box-sizing"));
const block = (head: string) => {
  const open = tokens.indexOf("{", tokens.indexOf(head));
  let depth = 0;
  for (let j = open; j < tokens.length; j++) {
    if (tokens[j] === "{") depth++;
    else if (tokens[j] === "}" && --depth === 0) return tokens.slice(open + 1, j);
  }
  throw new Error(`unclosed ${head}`);
};
const decls = (b: string) => Object.fromEntries([...b.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
const root = decls(block(":root {"));
const THEMES: Record<string, Record<string, string>> = {
  "Cooptimize Dark": root,
  "Cooptimize Light": { ...root, ...decls(block(':root[data-theme="cooptimize-light"]')) },
  "Neutral light": { ...root, ...decls(block(':root[data-theme="neutral"] {')) },
  "Neutral dark": { ...root, ...decls(block(':root[data-theme="neutral"] {')), ...decls(block("@media (prefers-color-scheme: dark)").replace(/^[^{]*\{/, "")) },
};

type Rgba = [number, number, number, number];
const hex = (h: string): Rgba => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).concat(1) as Rgba;
const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gam = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
const toLab = ([r, g, b]: number[]) => {
  const [lr, lg, lb] = [lin(r!), lin(g!), lin(b!)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
};
const fromLab = ([L, a, b]: number[]) => {
  const l = (L! + 0.3963377774 * a! + 0.2158037573 * b!) ** 3;
  const m = (L! - 0.1055613458 * a! - 0.0638541728 * b!) ** 3;
  const s = (L! - 0.0894841775 * a! - 1.291485548 * b!) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s].map((c) => Math.min(1, Math.max(0, gam(c))));
};
/** A token's color in a theme: hex, var(), and color-mix(in oklab, A p%, B | transparent). */
function color(t: Record<string, string>, v: string): Rgba {
  v = v.trim();
  if (v.startsWith("#")) return hex(v);
  const ref = /^var\((--[\w-]+)\)$/.exec(v);
  if (ref) return color(t, t[ref[1]!]!);
  const mix = /^color-mix\(in oklab, (.+) (\d+(?:\.\d+)?)%, (.+)\)$/.exec(v);
  if (!mix) throw new Error(`can't read ${v}`);
  const a = color(t, mix[1]!);
  const p = Number(mix[2]) / 100;
  if (mix[3]!.trim() === "transparent") return [a[0], a[1], a[2], a[3] * p];
  const b = color(t, mix[3]!);
  const [la, lb] = [toLab(a), toLab(b)];
  return [...fromLab(la.map((x, i) => x * p + lb[i]! * (1 - p))), 1] as Rgba;
}
const over = (top: Rgba, under: Rgba): Rgba => [0, 1, 2].map((i) => top[i]! * top[3] + under[i]! * (1 - top[3])).concat(1) as Rgba;
const toHex = (c: Rgba) => `#${c.slice(0, 3).map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join("")}`;

const SURFACES = ["--bg", "--surface", "--raised", "--sunken"];
const NEUTRAL_WASHES = ["--wash-1", "--wash-2", "--wash-accent"];
const STATES = [["--wash-risk", "--risk"], ["--wash-watch", "--watch"], ["--wash-ok", "--ok"], ["--wash-accent", "--accent"]] as const;

describe("RS-1 tokens: contrast", () => {
  for (const [name, t] of Object.entries(THEMES)) {
    it(`${name}: muted and faint text pass AA on every wash over every surface`, () => {
      const low: string[] = [];
      for (const s of SURFACES)
        for (const w of NEUTRAL_WASHES) {
          const bg = toHex(over(color(t, t[w]!), color(t, t[s]!)));
          // A well (--sunken) holds a switch's track, whose words are muted or full strength, never faint.
          for (const text of s === "--sunken" ? ["--text", "--text-muted"] : ["--text", "--text-muted", "--text-faint"]) {
            const c = contrast(toHex(color(t, t[text]!)), bg);
            if (c < 4.5) low.push(`${text} on ${w} over ${s}: ${c.toFixed(2)}`);
          }
        }
      expect(low).toEqual([]);
    });

    it(`${name}: a state's color passes AA on its own wash, and muted text does too`, () => {
      const low: string[] = [];
      // A past day's card is sunken, and a pill sits on it too.
      for (const s of ["--bg", "--surface", "--raised", "--sunken"])
        for (const [w, fg] of STATES) {
          const bg = toHex(over(color(t, t[w]!), color(t, t[s]!)));
          for (const text of [fg, "--text", "--text-muted"]) {
            const c = contrast(toHex(color(t, t[text]!)), bg);
            if (c < 4.5) low.push(`${text} on ${w} over ${s}: ${c.toFixed(2)}`);
          }
        }
      expect(low).toEqual([]);
    });

    it(`${name}: a switch reads: muted and full text on its track, full text on the lifted side, and the two differ`, () => {
      const low: string[] = [];
      for (const s of ["--bg", "--surface", "--raised"]) {
        const track = toHex(over(color(t, t["--track"]!), color(t, t[s]!)));
        const lift = toHex(color(t, t["--lift"]!));
        for (const text of ["--text", "--text-muted"]) {
          const c = contrast(toHex(color(t, t[text]!)), track);
          if (c < 4.5) low.push(`${text} on the track over ${s}: ${c.toFixed(2)}`);
        }
        if (contrast(toHex(color(t, t["--text"]!)), lift) < 4.5) low.push(`--text on --lift`);
        if (contrast(track, lift) < 1.08) low.push(`the lifted side on the track over ${s}: ${contrast(track, lift).toFixed(2)}`);
      }
      expect(low).toEqual([]);
    });

    it(`${name}: a late chip under the pointer (the watch color at 18%) still reads`, () => {
      const watch = color(t, t["--watch"]!);
      for (const s of ["--bg", "--surface", "--raised"]) {
        const bg = toHex(over([watch[0], watch[1], watch[2], 0.18], color(t, t[s]!)));
        expect(contrast(toHex(watch), bg), `--watch on its hover over ${s}`).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`${name}: the quiet line sits between the surface and the control outline`, () => {
      const [line, surface, strong] = ["--line", "--surface", "--border-strong"].map((k) => toLab(color(t, t[k]!))[0]!);
      expect(Math.abs(line! - surface!)).toBeGreaterThan(0.01);
      expect(Math.abs(line! - surface!)).toBeLessThan(Math.abs(strong! - surface!));
    });
  }

  // RS-2: a client's block card is filled in its color at the timeline bands' strength (--client-tint over the
  // surface); a past one at 60% of it. Every client color a theme names, the team palette's slots (both values) and
  // the demo's own: the card's text, muted text and faint text (its time) pass AA on both fills.
  for (const [name, t] of Object.entries(THEMES))
    it(`${name}: text on every client's card fill, today and past (RS-2)`, () => {
      const tint = parseFloat(t["--client-tint"]!);
      const clients = [...Object.keys(t).filter((k) => /^--client-(none|teal|violet|ochre|blue|rose|earth|green|slate)$/.test(k)).map((k) => `var(${k})`), ...Object.values(SLOT_VALUES).flat(), ...DEMO_CLIENTS.map((c) => c.color)];
      const low: string[] = [];
      for (const c of clients)
        for (const [when, p] of [["today", tint], ["past", tint * 0.6]] as const) {
          const fill = toHex(color(t, `color-mix(in oklab, ${c} ${p}%, var(--surface))`));
          for (const text of ["--text", "--text-muted", "--text-faint"]) {
            const r = contrast(toHex(color(t, t[text]!)), fill);
            if (r < 4.5) low.push(`${text} on ${c} (${when}, ${p}%): ${r.toFixed(2)}`);
          }
        }
      expect(low).toEqual([]);
    });
});
