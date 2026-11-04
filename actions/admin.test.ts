// D522: the one admin check. Only ids in the app's admins list, compared without case; nobody when the list is empty.
import { describe, expect, it } from "vitest";
import { isAdmin } from "./admin.ts";

const A = "00000000-0000-4000-8000-0000000000a1";
describe("isAdmin", () => {
  it("an id in the list, in any case", () => {
    expect(isAdmin(A.toUpperCase(), [A])).toBe(true);
  });
  it("anyone else, nobody signed in, or no list: no", () => {
    expect(isAdmin("00000000-0000-4000-8000-0000000000b2", [A])).toBe(false);
    expect(isAdmin(null, [A])).toBe(false);
    expect(isAdmin(A, [])).toBe(false);
    expect(isAdmin(A, undefined)).toBe(false);
  });
});
