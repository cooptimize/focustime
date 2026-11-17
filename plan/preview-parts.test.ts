// OP-1: parts for the one preview: one client each, 10 at most, the screen's own order; and the words said first.
import { describe, expect, it } from "vitest";
import { partsLine, partsOf } from "./preview-parts.ts";

const x = (client: string, n: number) => ({ client, n });

describe("OP-1: parts for the one preview", () => {
  it("one client per part, 10 at most, in the order given", () => {
    const items = [x("a", 1), x("b", 1), x("a", 2), ...Array.from({ length: 10 }, (_, i) => x("a", i + 3)), x("b", 2)];
    const parts = partsOf(items, (i) => i.client);
    expect(parts.map((p) => [p.clientKey, p.items.map((i) => i.n)])).toEqual([
      ["a", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]],
      ["a", [11, 12]],
      ["b", [1, 2]],
    ]);
    expect(parts.every((p) => p.items.every((i) => i.client === p.clientKey))).toBe(true);
  });
  it("nothing in, nothing out", () => {
    expect(partsOf([], () => "a")).toEqual([]);
  });
  it("says it first only when there is more than one preview", () => {
    expect(partsLine(3, 1, 1, "line")).toBeNull();
    expect(partsLine(2, 2, 2, "line")).toBe("2 lines go in 2 previews, one client at a time.");
    expect(partsLine(12, 2, 1, "item")).toBe("12 items go in 2 previews, 10 at most in each.");
    expect(partsLine(21, 4, 2, "line")).toBe("21 lines go in 4 previews, one client at a time and 10 at most in each.");
  });
});
