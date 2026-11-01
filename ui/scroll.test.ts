import { describe, expect, it } from "vitest";
import { scrollKeyDelta, wheelEscapes } from "./scroll.ts";

describe("Plan panel scroll containment (step 13.6, D242)", () => {
  const list = { scrollTop: 0, scrollHeight: 2000, clientHeight: 600 };
  it("a wheel inside a list that can still scroll that way stays in the list", () => {
    expect(wheelEscapes({ ...list, scrollTop: 300 }, 100)).toBe(false);
    expect(wheelEscapes({ ...list, scrollTop: 300 }, -100)).toBe(false);
  });
  it("a wheel past the top or the bottom would scroll the page, so it is stopped", () => {
    expect(wheelEscapes(list, -40)).toBe(true);
    expect(wheelEscapes({ ...list, scrollTop: 1400 }, 40)).toBe(true);
    // Fractional scroll positions (zoom) count as the edge.
    expect(wheelEscapes({ ...list, scrollTop: 1399.5 }, 40)).toBe(true);
  });
  it("a list too short to scroll never lets a wheel through", () => {
    expect(wheelEscapes({ scrollTop: 0, scrollHeight: 400, clientHeight: 600 }, 40)).toBe(true);
    expect(wheelEscapes({ scrollTop: 0, scrollHeight: 400, clientHeight: 600 }, -40)).toBe(true);
  });
  it("no vertical movement is left alone", () => {
    expect(wheelEscapes(list, 0)).toBe(false);
  });
  it("scroll keys move the list, not the page; other keys and typing are left alone", () => {
    expect(scrollKeyDelta("PageDown", 600, false)).toBe(540);
    expect(scrollKeyDelta("PageUp", 600, false)).toBe(-540);
    expect(scrollKeyDelta("ArrowDown", 600, false)).toBe(40);
    expect(scrollKeyDelta("End", 600, false)).toBe(Infinity);
    expect(scrollKeyDelta("Home", 600, false)).toBe(-Infinity);
    expect(scrollKeyDelta("PageDown", 600, true)).toBeNull();
    expect(scrollKeyDelta("a", 600, false)).toBeNull();
  });
});
