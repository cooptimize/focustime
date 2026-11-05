import { describe, expect, it } from "vitest";
import { ganttLabelW, gridLayout } from "./layout.ts";

describe("Ahead's layout by window width (AH-3)", () => {
  it("follows the window at Default text", () => {
    expect(gridLayout(1920)).toBe("wide");
    expect(gridLayout(1600)).toBe("wide");
    expect(gridLayout(1400)).toBe("wide");
    expect(gridLayout(1366)).toBe("dates");
    expect(gridLayout(1200)).toBe("dates");
    expect(gridLayout(1199)).toBe("dots");
    expect(gridLayout(970)).toBe("dots");
    expect(gridLayout(899)).toBe("cards");
    expect(gridLayout(390)).toBe("cards");
  });
  it("treats a larger Text size as a narrower window", () => {
    expect(gridLayout(1920, 1.3077)).toBe("wide");
    expect(gridLayout(1600, 1.3077)).toBe("dates");
    expect(gridLayout(1366, 1.3077)).toBe("dots");
    expect(gridLayout(970, 1.3077)).toBe("cards");
  });
  it("keeps the Gantt's labels readable and bounded", () => {
    expect(ganttLabelW(900)).toBe(240);
    expect(ganttLabelW(1500)).toBe(390);
    expect(ganttLabelW(3000)).toBe(440);
    expect(ganttLabelW(900, 1.3077)).toBe(314);
  });
});
