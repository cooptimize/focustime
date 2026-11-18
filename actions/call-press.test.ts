// MC-2: a press lets one person's reads of one call through, for one try, and nothing else.
import { describe, expect, it } from "vitest";
import { createPressGrants, PRESS_MS } from "./call-press.ts";

const LINK = "https://teams.microsoft.com/l/meetup-join/19%3acall-a%40thread.v2/0";
const OTHER = "https://teams.microsoft.com/l/meetup-join/19%3acall-b%40thread.v2/0";

describe("a press (MC-2)", () => {
  it("lets through only its own person, its own call, and the meeting it resolved to", () => {
    const g = createPressGrants();
    const p = g.open("U1", LINK);
    expect(g.allowed("u1", { joinUrl: LINK })).toBe(true);
    // The same link however it was copied.
    expect(g.allowed("u1", { joinUrl: `${LINK}?context=x` })).toBe(true);
    expect(g.allowed("u2", { joinUrl: LINK })).toBe(false);
    expect(g.allowed("u1", { joinUrl: OTHER })).toBe(false);
    expect(g.allowed("u1", { onlineMeetingId: "om-a" })).toBe(false);
    p.meeting("om-a");
    expect(g.allowed("u1", { onlineMeetingId: "om-a" })).toBe(true);
    expect(g.allowed("u2", { onlineMeetingId: "om-a" })).toBe(false);
    expect(g.allowed("u1", { onlineMeetingId: "om-b" })).toBe(false);
    expect(g.allowed("u1", {})).toBe(false);
  });

  it("is one try: nothing passes once the press is done, even a second time", () => {
    const g = createPressGrants();
    const p = g.open("u1", LINK);
    p.meeting("om-a");
    p.done();
    expect(g.allowed("u1", { joinUrl: LINK })).toBe(false);
    expect(g.allowed("u1", { onlineMeetingId: "om-a" })).toBe(false);
    // A meeting named after the press ended doesn't open it again.
    p.meeting("om-a");
    expect(g.allowed("u1", { onlineMeetingId: "om-a" })).toBe(false);
  });

  it("ends by itself after PRESS_MS if the press never finishes", () => {
    let t = 1_000;
    const g = createPressGrants(() => t);
    g.open("u1", LINK);
    t += PRESS_MS - 1;
    expect(g.allowed("u1", { joinUrl: LINK })).toBe(true);
    t += 1;
    expect(g.allowed("u1", { joinUrl: LINK })).toBe(false);
  });
});
