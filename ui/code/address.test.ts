// RB-2: Code's addresses hold the view (By kind, Search names) and never the words searched. RB-6: they open the Code tab.
import { describe, expect, it } from "vitest";
import { codeHash, parseHash, placeToKeep } from "../nav.ts";

const REPO = "a1b2c3d4-0001-4000-8000-00000000a001";
const code = (hash: string) => {
  const l = parseHash(hash);
  return l && l.nav.tab === "code" && !l.overlay ? l.nav : null;
};

describe("Code's addresses", () => {
  it.each([
    [{ clientKey: null, repoId: null, path: null }, "#/code"],
    [{ clientKey: "Northwind", repoId: null, path: null }, "#/code/Northwind"],
    [{ clientKey: "Northwind", repoId: REPO, path: "/sql/a b.sql" }, `#/code/Northwind/${REPO}/%2Fsql%2Fa%20b.sql`],
    [{ clientKey: "Northwind", repoId: null, path: null, view: "kinds" as const }, "#/code/Northwind/kinds"],
    [{ clientKey: "Northwind", repoId: REPO, path: "/m/x.tmdl", view: "kinds" as const }, `#/code/Northwind/kinds/${REPO}/%2Fm%2Fx.tmdl`],
    [{ clientKey: "Northwind", repoId: null, path: null, view: "search" as const }, "#/code/Northwind/search"],
    [{ clientKey: null, repoId: null, path: null, view: "search" as const }, "#/code/~search"],
    // RB-4: the search set to Inside files.
    [{ clientKey: "Northwind", repoId: null, path: null, view: "inside" as const }, "#/code/Northwind/inside"],
    [{ clientKey: null, repoId: null, path: null, view: "inside" as const }, "#/code/~inside"],
  ])("%j is %s, there and back", (at, hash) => {
    expect(codeHash(at)).toBe(hash);
    expect(code(hash)).toEqual({ tab: "code", ...at });
  });
  it("a search address carries nothing after it, and no query", () => {
    expect(code("#/code/~search/orders")).toBeNull();
    expect(code("#/code/Northwind/search/orders")).toBeNull();
    expect(code("#/code/~search?q=orders")).toBeNull();
    expect(code("#/code/~inside/orders")).toBeNull();
    expect(code("#/code/Northwind/inside/orders")).toBeNull();
    expect(code("#/code/~inside?q=orders")).toBeNull();
  });
  it("a path that leaves the repo is refused in By kind too", () => {
    expect(code(`#/code/Northwind/kinds/${REPO}/${encodeURIComponent("/../x")}`)).toBeNull();
    expect(code("#/code/Northwind/kinds/not-a-repo")).toBeNull();
  });
});

describe("RB-6: the last place kept for Code", () => {
  it.each([
    "#/code",
    "#/code/Northwind",
    `#/code/Northwind/${REPO}/%2Fsql%2Fa%20b.sql`,
    "#/code/Northwind/kinds",
    `#/code/Northwind/kinds/${REPO}/%2Fm%2Fx.tmdl`,
    "#/code/Northwind/search",
    "#/code/~search",
    "#/code/Northwind/inside",
    "#/code/~inside",
  ])("%s keeps only that Code was the tab: no client, repo, path or search", (hash) => {
    const kept = placeToKeep(parseHash(hash)!);
    expect(kept).toBe("#/code");
    for (const bit of ["Northwind", REPO, "sql", "tmdl", "kinds", "search", "inside", "~"]) expect(kept).not.toContain(bit);
  });
  it("another tab's place is kept as it was", () => {
    expect(placeToKeep(parseHash("#/week")!)).toBe("#/week");
    expect(placeToKeep(parseHash("#/inbox")!)).toBe("#/inbox");
  });
});
