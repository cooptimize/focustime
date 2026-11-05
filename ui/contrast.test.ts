// WT-1 follow-up: a type color shown at 3:1 on the theme, the stored color untouched.
import { describe, expect, it } from "vitest";
import { contrast, THEME_BACKGROUNDS } from "../config/org.ts";
import { cssHex, MIN_ICON_CONTRAST, readableOn } from "./contrast.ts";

const [DARK, LIGHT] = THEME_BACKGROUNDS;

describe("readableOn", () => {
  it("keeps a color that already reads", () => {
    expect(readableOn("#CC293D", [LIGHT])).toBe("#CC293D");
    expect(readableOn("#009ccc", [DARK, "#141c22"])).toBe("#009ccc");
  });

  it("lifts a too-dark color on a dark theme and deepens a too-light one on a light theme, just to 3:1", () => {
    const up = readableOn("#1b1b40", [DARK]);
    expect(contrast(up, DARK)).toBeGreaterThanOrEqual(MIN_ICON_CONTRAST);
    expect(contrast(up, DARK)).toBeLessThan(MIN_ICON_CONTRAST + 0.1);
    const down = readableOn("#f2e94e", [LIGHT, "#ffffff"]);
    expect(contrast(down, LIGHT)).toBeGreaterThanOrEqual(MIN_ICON_CONTRAST);
    expect(contrast(down, "#ffffff")).toBeGreaterThanOrEqual(MIN_ICON_CONTRAST);
    // The hue is kept: still yellowish (red and green over blue).
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(down.slice(i, i + 2), 16)) as [number, number, number];
    expect(r).toBeGreaterThan(b);
    expect(g).toBeGreaterThan(b);
  });

  it("with no backgrounds known yet, shows the color as it is", () => {
    expect(readableOn("#000000", [])).toBe("#000000");
  });

  it("reads computed CSS colors", () => {
    expect(cssHex(" rgb(13, 19, 24)")).toBe("#0d1318");
    expect(cssHex("#FFF")).toBe("#ffffff");
    expect(cssHex("#f4f5f7")).toBe("#f4f5f7");
    expect(cssHex("var(--x)")).toBeNull();
  });
});
