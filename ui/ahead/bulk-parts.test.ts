// BL-1 review: a selection over the server's 200 goes to ahead.stage_bulk in parts.
import { describe, expect, it } from "vitest";
import { BULK_MAX, inParts } from "./Bulk.tsx";

describe("inParts", () => {
  it("splits 450 into 200, 200 and 50, in order; 0 into none", () => {
    const xs = Array.from({ length: 450 }, (_, i) => i);
    const parts = inParts(xs, BULK_MAX);
    expect(parts.map((p) => p.length)).toEqual([200, 200, 50]);
    expect(parts.flat()).toEqual(xs);
    expect(inParts([], BULK_MAX)).toEqual([]);
  });
});
