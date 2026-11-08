import { describe, expect, it } from "vitest";
import { nearestStep, parseTypedTime, quarterHours, time12 } from "./timeinput.ts";

describe("typed times", () => {
  it.each([["7pm", "19:00"], ["7:30 pm", "19:30"], ["19:00", "19:00"], ["1930", "19:30"], ["730pm", "19:30"], ["9", "09:00"], ["12am", "00:00"], ["12pm", "12:00"], ["noon", "12:00"], ["7 p.m.", "19:00"]])("%s is %s", (t, v) => expect(parseTypedTime(t)).toBe(v));
  it.each(["", "25:00", "13pm", "soon", "7:75"])("%s can't be read", (t) => expect(parseTypedTime(t)).toBeNull());
});

describe("the steps", () => {
  it("are every 15 minutes", () => {
    const q = quarterHours();
    expect(q).toHaveLength(96);
    expect(q.slice(0, 2)).toEqual(["00:00", "00:15"]);
    expect(q.at(-1)).toBe("23:45");
  });
  it("shows 12-hour words and the nearest step", () => {
    expect(time12("19:00")).toBe("7:00 PM");
    expect(time12("00:15")).toBe("12:15 AM");
    expect(nearestStep("19:07")).toBe("19:00");
    expect(nearestStep("19:08")).toBe("19:15");
    expect(nearestStep("23:59")).toBe("23:45");
  });
});
