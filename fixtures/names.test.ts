// A1: no real people, clients, projects, addresses or the developer's desktop in the repo. The guard itself is
// scripts/guards.ts (HK-1: one file list, tracked plus untracked, the same for CI and `npm run guards`); this file
// checks its patterns and runs it on the repo. The words are base64 so this file never matches its own search.
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { desktopRe, realRe, runGuards } from "../scripts/guards.ts";

const ROOT = resolve(import.meta.dirname, "..");
const word = (b64: string) => Buffer.from(b64, "base64").toString("utf8");

describe("names in the repo (A1)", () => {
  it("the patterns find what they are for, in any case", () => {
    for (const s of [word("VyZD"), word("VyZD").toLowerCase(), `a ${word("V29vZGFyZA==")} b`, `x@${word("Y29vcHRpbWl6ZS5vcmc=")}`, `/home/${word("dGFubmVy")}/x`]) expect(realRe.test(s), s).toBe(true);
    for (const s of ["T&W", "Tailspin & Wingtip", "ana@cooptimize.example", "OSCAR", "csc2"]) expect(realRe.test(s), s).toBe(false);
    expect(desktopRe.test(`${word("b21hcmNoeQ==")}-launch-webapp`)).toBe(true);
    expect(desktopRe.test("hyprctl clients")).toBe(false);
  });

  it("no real client, project, person, company address or desktop name outside the history", () => {
    expect(runGuards(ROOT).hits.filter((h) => h.guard !== "process")).toEqual([]);
  });
});
