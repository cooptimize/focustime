import { describe, expect, it } from "vitest";
import { stepTextSize, TEXT_BASE_PX, textScale, textSizeKey } from "./textsize.ts";

const k = (key: string, x: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; code: string }> = {}) => ({ key, ctrlKey: true, metaKey: false, altKey: false, ...x });

describe("text size (U5)", () => {
  it("steps up to Larger and stops there, down to Default and stops there", () => {
    expect(stepTextSize("default", 1)).toBe("large");
    expect(stepTextSize("large", 1)).toBe("larger");
    expect(stepTextSize("larger", 1)).toBe("larger");
    expect(stepTextSize("larger", -1)).toBe("large");
    expect(stepTextSize("default", -1)).toBe("default");
  });
  it("the presets are the four steps 11/12/13/15, 13/14/15/17 and 15/16/17/19", () => {
    for (const [s, steps] of [["default", [11, 12, 13, 15]], ["large", [13, 14, 15, 17]], ["larger", [15, 16, 17, 19]]] as const) {
      const b = TEXT_BASE_PX[s];
      expect([b - 2, b - 1, b, b + 2]).toEqual(steps);
    }
    expect(textScale("default")).toBe(1);
    expect(textScale("larger")).toBeCloseTo(17 / 13);
  });
  it("Ctrl+plus (or =), Ctrl+minus and Ctrl+0; nothing without Ctrl or with Alt", () => {
    expect(textSizeKey(k("+"))).toBe("up");
    expect(textSizeKey(k("="))).toBe("up");
    expect(textSizeKey(k("-"))).toBe("down");
    expect(textSizeKey(k("0"))).toBe("reset");
    expect(textSizeKey(k("=", { ctrlKey: false, metaKey: true }))).toBe("up");
    expect(textSizeKey(k("+", { ctrlKey: false }))).toBeNull();
    expect(textSizeKey(k("+", { altKey: true }))).toBeNull();
    expect(textSizeKey(k("k"))).toBeNull();
  });
});
