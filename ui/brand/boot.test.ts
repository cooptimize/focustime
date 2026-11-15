// BR-1: the loader drawn from the first paint stays the week mark: index.html carries WeekLoader's own markup, boot.css's
// colors and sizes are the app's tokens for each theme and text size, its pass keeps the timing boot.ts counts on, and
// public/prefs.js reads exactly what the app keeps locally. Nothing inline (the CSP allows no inline style or script).
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEFAULT_UI, TEXT_SIZES, THEMES } from "../../config/schema.ts";
import { WeekLoader } from "./Brand.tsx";
import { ALL_LIT_MS, LOADER_DELAY_MS, PASS_MS, STEP_MS, WAIT_LINE_MS } from "./opening.ts";
import { TEXT_BASE_PX, textScale } from "../textsize.ts";

const root = new URL("../../", import.meta.url).pathname;
const read = (p: string) => readFileSync(root + p, "utf8");
const html = read("index.html");
const boot = read("ui/brand/boot.css");
const styles = read("ui/styles.css");
const prefs = read("public/prefs.js");

/** The custom properties a CSS block declares, for every block whose selector is exactly `sel` (inside `media` or not). */
function decls(text: string, sel: string, media: string | null = null): Record<string, string> {
  const css = text.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: Record<string, string> = {};
  const scope = media === null ? css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "") : [...css.matchAll(/@media([^{]*)\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g)].filter((m) => m[1]!.includes(media)).map((m) => m[2]).join("\n");
  for (const m of scope.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1]!.trim() !== sel) continue;
    for (const d of m[2]!.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[d[1]!] = d[2]!.trim();
  }
  return out;
}
/** A token's value after var() is resolved through the layers given (later wins). */
const resolve = (layers: Record<string, string>[], name: string): string => {
  const v = layers.reduce<string | undefined>((acc, l) => l[name] ?? acc, undefined);
  if (v === undefined) throw new Error(`no ${name}`);
  const m = /^var\((--[\w-]+)\)$/.exec(v);
  return m ? resolve(layers, m[1]!) : v.toLowerCase();
};

describe("the loader's mark (BR-1)", () => {
  it("index.html draws WeekLoader's own markup, the week mark's drawing", () => {
    expect(html).toContain(renderToStaticMarkup(createElement(WeekLoader)));
  });

  it("index.html has no inline script or style, only files (the CSP allows no other)", () => {
    expect(html).not.toMatch(/<style/);
    expect(html).not.toMatch(/\sstyle="/);
    for (const m of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
      expect(m[1]).toMatch(/\ssrc="/);
      expect(m[2]!.trim()).toBe("");
    }
  });

  it("before 8 seconds the loader has no words a person sees: only the line, hidden until then, and the screen reader's", () => {
    const body = html.slice(html.indexOf('<div id="boot">'), html.indexOf('<div id="root">'));
    const words = [...body.matchAll(/<p class="([\w-]+)"[^>]*>([^<]*)<\/p>/g)].map((m) => [m[1], m[2]]);
    expect(words).toEqual([["boot-say", "Loading FocusTime"], ["boot-wait", "Still waiting on FocusTime"]]);
    expect(boot).toMatch(/#boot \.boot-say \{[^}]*clip: rect\(0 0 0 0\)/);
    expect(boot).toMatch(/#boot \.boot-wait \{[^}]*visibility: hidden; animation: boot-line 0s 8000ms both;/);
    expect(WAIT_LINE_MS).toBe(8000);
  });

  it("its colors are the brand tokens of every theme, and its size follows the text size", () => {
    const base = decls(styles, ":root");
    const pairs = { "--boot-bg": "--bg", "--boot-am": "--brand-am", "--boot-pm": "--brand-pm", "--boot-accent": "--brand-accent", "--boot-muted": "--text-muted" };
    const themes: [string, Record<string, string>[], Record<string, string>[]][] = [
      ["cooptimize-dark", [base], [decls(boot, ":root")]],
      ["cooptimize-light", [base, decls(styles, ':root[data-theme="cooptimize-light"]')], [decls(boot, ":root"), decls(boot, ':root[data-theme="cooptimize-light"]')]],
      ["neutral light", [base, decls(styles, ':root[data-theme="neutral"]')], [decls(boot, ":root"), decls(boot, ':root[data-theme="neutral"]')]],
      ["neutral dark", [base, decls(styles, ':root[data-theme="neutral"]'), decls(styles, ':root[data-theme="neutral"]', "prefers-color-scheme: dark")], [decls(boot, ":root"), decls(boot, ':root[data-theme="neutral"]'), decls(boot, ':root[data-theme="neutral"]', "prefers-color-scheme: dark")]],
    ];
    for (const [name, app, loader] of themes) for (const [b, t] of Object.entries(pairs)) expect(resolve(loader, b), `${name} ${b}`).toBe(resolve(app, t));
    for (const s of TEXT_SIZES) {
      const layers = [decls(boot, ":root"), decls(boot, `:root[data-text-size="${s}"]`)];
      expect(Number(resolve(layers, "--boot-scale")), s).toBeCloseTo(textScale(s), 3);
      expect(resolve(layers, "--boot-fs"), s).toBe(`${TEXT_BASE_PX[s]}px`);
    }
    expect(boot).toMatch(/width: calc\(96px \* var\(--boot-scale\)\); height: calc\(43\.2px \* var\(--boot-scale\)\)/);
  });

  it("its pass keeps the timing boot.ts counts on: appears at 400 ms, a block every 120 ms, all lit at 960 ms, 1.6 s a pass", () => {
    expect(boot).toMatch(/animation: boot-show 0s 400ms both/);
    expect(boot).toMatch(/\.week-loader \.wl \{ animation-duration: 1\.6s; animation-timing-function: ease-in-out; animation-delay: 400ms; animation-iteration-count: infinite; animation-fill-mode: both; \}/);
    expect([LOADER_DELAY_MS, STEP_MS, ALL_LIT_MS, PASS_MS]).toEqual([400, 120, 960, 1600]);
    for (let i = 0; i < 8; i++) {
      const lit = ((i * STEP_MS + STEP_MS) / PASS_MS) * 100;
      expect(boot, `wl-${i}`).toMatch(new RegExp(`@keyframes wl-${i} \\{[^\\n]* ${lit}%, 81\\.25% \\{ opacity: 1; \\}`));
    }
    expect(((7 * STEP_MS + STEP_MS) / PASS_MS) * PASS_MS).toBe(ALL_LIT_MS);
    // Reduced motion, the system's and the setting's: no pass at all.
    expect(boot).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.week-loader \.wl \{ animation: none; \}/);
    expect(boot).toMatch(/:root\[data-reduce-motion\] \.week-loader \.wl \{ animation: none; \}/);
  });

  it("public/prefs.js reads the keys and values the app keeps (theme, text size, reduce motion)", () => {
    expect(prefs).toContain('localStorage.getItem("focustime.theme")');
    expect(prefs).toContain('localStorage.getItem("focustime.textSize")');
    expect(prefs).toContain('localStorage.getItem("focustime.reduceMotion") === "1"');
    for (const t of THEMES) expect(prefs).toContain(`"${t}"`);
    expect(prefs).toContain(`var theme = "${DEFAULT_UI.theme}"`);
    for (const s of TEXT_SIZES.filter((x) => x !== "default")) expect(prefs).toContain(`s === "${s}"`);
    for (const f of ["ui/theme.ts", "ui/textsize.ts", "ui/brand/motion.ts"]) expect(read(f)).toMatch(/"focustime\.(theme|textSize|reduceMotion)"/);
    expect(html.indexOf('src="/prefs.js"')).toBeLessThan(html.indexOf('href="/ui/brand/boot.css"'));
  });
});
