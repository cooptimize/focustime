// UI-10: the growing text box's sizing and keys, the keyboard inset, and source checks that keep every multi-line
// input on the shared TextBox with no resize handle and no native scrollbar arrows.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { boxSize, lineHeightPx, submitsOnEnter } from "./textbox.ts";
import { keyboardInset } from "./keyboard.ts";

const LH = 20;
const PAD = 16;
const BORDER = 2;
/** scrollHeight for `lines` lines of text: it includes the padding, not the borders. */
const sh = (lines: number) => lines * LH + PAD;
const size = (lines: number, min = 1, max = 6) => boxSize({ scrollHeight: sh(lines), lineHeight: LH, paddingY: PAD, borderY: BORDER }, min, max);

describe("boxSize", () => {
  it("an empty box is one line and does not scroll (the borders are counted, so it is never 2px short)", () => {
    expect(size(1)).toEqual({ height: LH + PAD + BORDER, scrolls: false });
  });
  it("grows a line at a time up to its maximum, then scrolls at the maximum height", () => {
    const heights = [1, 2, 3, 4, 5, 6].map((n) => size(n));
    for (let i = 1; i < heights.length; i++) expect(heights[i]!.height - heights[i - 1]!.height).toBe(LH);
    expect(heights.every((h) => !h.scrolls)).toBe(true);
    expect(size(7)).toEqual({ height: 6 * LH + PAD + BORDER, scrolls: true });
    expect(size(40).height).toBe(6 * LH + PAD + BORDER);
  });
  it("a taller field starts at its minimum", () => {
    expect(size(1, 5, 12)).toEqual({ height: 5 * LH + PAD + BORDER, scrolls: false });
    expect(size(12, 5, 12).scrolls).toBe(false);
    expect(size(13, 5, 12).scrolls).toBe(true);
  });
  it("half a pixel of rounding is not overflow", () => {
    expect(boxSize({ scrollHeight: 6 * LH + PAD + 0.4, lineHeight: LH, paddingY: PAD, borderY: BORDER }, 1, 6).scrolls).toBe(false);
  });
  it("a maximum below the minimum is the minimum", () => {
    expect(size(9, 4, 2)).toEqual({ height: 4 * LH + PAD + BORDER, scrolls: true });
  });
});

describe("lineHeightPx", () => {
  it("reads px, a unitless multiplier and normal", () => {
    expect(lineHeightPx("18.2px", "13px")).toBe(18.2);
    expect(lineHeightPx("1.4", "10px")).toBe(14);
    expect(lineHeightPx("normal", "10px")).toBe(12);
  });
});

describe("submitsOnEnter", () => {
  it("Enter submits, Shift+Enter is a new line, other keys do nothing", () => {
    expect(submitsOnEnter({ key: "Enter", shiftKey: false })).toBe(true);
    expect(submitsOnEnter({ key: "Enter", shiftKey: true })).toBe(false);
    expect(submitsOnEnter({ key: "a", shiftKey: false })).toBe(false);
  });
  it("never while an IME is composing", () => {
    expect(submitsOnEnter({ key: "Enter", shiftKey: false, isComposing: true })).toBe(false);
    expect(submitsOnEnter({ key: "Enter", shiftKey: false, keyCode: 229 })).toBe(false);
  });
});

describe("keyboardInset", () => {
  it("is what the keyboard covers, and 0 for the browser's own bars or no visual viewport", () => {
    expect(keyboardInset(800, { height: 460, offsetTop: 0 })).toBe(340);
    expect(keyboardInset(800, { height: 460, offsetTop: 40 })).toBe(300);
    expect(keyboardInset(800, { height: 760, offsetTop: 0 })).toBe(0);
    expect(keyboardInset(800, null)).toBe(0);
  });
});

const UI = join(import.meta.dirname, ".");
function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return tsxFiles(p);
    return p.endsWith(".tsx") && !p.endsWith(".test.tsx") ? [p] : [];
  });
}

describe("every multi-line input is the shared TextBox", () => {
  /** Read-only copy boxes, not inputs: the Coop brief and Diagnostics' copy text. */
  const READ_ONLY = ["BreakDownPanel.tsx", "settings/Diagnostics.tsx"];
  it("no editable <textarea> outside TextBox.tsx", () => {
    const bad: string[] = [];
    for (const f of tsxFiles(UI)) {
      const rel = f.slice(UI.length + 1);
      if (rel === "TextBox.tsx" || rel.startsWith("StyleGuide")) continue;
      for (const m of readFileSync(f, "utf8").matchAll(/<textarea\b[^>]*>/g)) {
        if (READ_ONLY.includes(rel) && /\breadOnly\b/.test(m[0])) continue;
        bad.push(`${rel}: ${m[0].slice(0, 60)}`);
      }
    }
    expect(bad).toEqual([]);
  });
  it("styles.css never gives a textarea a resize handle, and sets no scrollbar-width or -color outside the Firefox fallback", () => {
    const css = readFileSync(join(UI, "styles.css"), "utf8");
    expect(css.match(/resize:\s*(vertical|horizontal|both|block|inline)/g)).toBeNull();
    expect(css).toMatch(/textarea \{ resize: none; \}/);
    // Chromium ignores ::-webkit-scrollbar (and draws its native bar with arrows) on any element with these set.
    const outside = css.replace(/@supports not selector\(::-webkit-scrollbar\) \{[^}]*\}\s*\}/g, "");
    expect(outside.match(/scrollbar-(width|color)\s*:/g)).toBeNull();
    expect(css).toMatch(/textarea::-webkit-scrollbar-button \{ display: none;/);
  });
});
