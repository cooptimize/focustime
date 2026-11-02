import { describe, expect, it } from "vitest";
import { readBack } from "./readback.ts";

class Net extends Error {}
const isNet = (e: unknown) => e instanceof Net;

describe("readBack (D255)", () => {
  it("returns the first read when it works, without waiting", async () => {
    let waits = 0;
    const r = await readBack(async () => 7, isNet, async () => void waits++);
    expect(r).toBe(7);
    expect(waits).toBe(0);
  });
  it("waits once and reads again after a network error", async () => {
    let n = 0;
    const waited: number[] = [];
    const r = await readBack(async () => (n++ === 0 ? Promise.reject(new Net()) : "back"), isNet, async (ms) => void waited.push(ms));
    expect(r).toBe("back");
    expect(n).toBe(2);
    expect(waited).toEqual([1500]);
  });
  it("gives up after the second network error", async () => {
    let n = 0;
    await expect(readBack(async () => { n++; throw new Net(); }, isNet, async () => undefined)).rejects.toBeInstanceOf(Net);
    expect(n).toBe(2);
  });
  it("doesn't retry other errors", async () => {
    let n = 0;
    await expect(readBack(async () => { n++; throw new Error("403"); }, isNet, async () => undefined)).rejects.toThrow("403");
    expect(n).toBe(1);
  });
});
