// RB-7: the rule for which branch Code reads a repo on (invented branch names only).
import { describe, expect, it } from "vitest";
import { branchOrder, BRANCH_TEXT, foldersUp, middleCut, needsBranchList, openingOf, openingRule, pickBranch } from "./code-branch.ts";

const NAMES = ["dev", "feature/returns", "main"];

describe("which branch a repo opens on", () => {
  it("no setting: the repo's own default, and no branch list is needed", () => {
    expect(pickBranch({ defaultBranch: "main", opening: null, chosen: null, names: null })).toEqual({ name: "main", why: "default", opening: "main", default: "main", gone: null });
    expect(needsBranchList({ defaultBranch: "main", opening: null, chosen: null })).toBe(false);
  });
  it("a setting the repo has: that branch", () => {
    expect(pickBranch({ defaultBranch: "main", opening: "dev", chosen: null, names: NAMES })).toEqual({ name: "dev", why: "opening", opening: "dev", default: "main", gone: null });
    expect(needsBranchList({ defaultBranch: "main", opening: "dev", chosen: null })).toBe(true);
  });
  it("a setting the repo doesn't have: the default", () => {
    expect(pickBranch({ defaultBranch: "main", opening: "dev", chosen: null, names: ["main", "release"] })).toEqual({ name: "main", why: "default", opening: "main", default: "main", gone: null });
  });
  it("a setting that is the default needs no list", () => {
    expect(needsBranchList({ defaultBranch: "dev", opening: "dev", chosen: null })).toBe(false);
    expect(openingOf("dev", "dev", null)).toBe("dev");
  });
  it("a chosen branch wins while it exists, over the setting and the default", () => {
    expect(pickBranch({ defaultBranch: "main", opening: "dev", chosen: "feature/returns", names: NAMES })).toEqual({ name: "feature/returns", why: "chosen", opening: "dev", default: "main", gone: null });
    expect(pickBranch({ defaultBranch: "main", opening: "dev", chosen: "main", names: NAMES })).toMatchObject({ name: "main", why: "chosen", gone: null });
    // Choosing the opening branch is the usual view, not a choice.
    expect(pickBranch({ defaultBranch: "main", opening: "dev", chosen: "dev", names: NAMES })).toMatchObject({ name: "dev", why: "opening", gone: null });
  });
  it("a chosen branch that is gone falls back to the opening branch and says which was asked for", () => {
    expect(pickBranch({ defaultBranch: "main", opening: "dev", chosen: "feature/old", names: NAMES })).toEqual({ name: "dev", why: "opening", opening: "dev", default: "main", gone: "feature/old" });
    expect(pickBranch({ defaultBranch: "main", opening: null, chosen: "feature/old", names: NAMES })).toEqual({ name: "main", why: "default", opening: "main", default: "main", gone: "feature/old" });
  });
  it("the Rule's value counts only when it's a branch's name", () => {
    expect(openingRule("dev")).toBe("dev");
    expect(openingRule("feature/x")).toBe("feature/x");
    for (const v of [null, "", " dev", "a b", "../x", "x/", 7, "refs:heads"]) expect(openingRule(v), String(v)).toBeNull();
  });
});

describe("the picker and its lines", () => {
  it("lists the opening branch first, then the default, then the rest by name", () => {
    expect(branchOrder(["zeta", "main", "Alpha", "dev", "beta"], "dev", "main")).toEqual(["dev", "main", "Alpha", "beta", "zeta"]);
    expect(branchOrder(["main", "dev"], "main", "main")).toEqual(["main", "dev"]);
  });
  it("cuts a long name in the middle", () => {
    const long = "feature/a-very-long-branch-name-for-the-returns-model";
    const cut = middleCut(long);
    expect(cut.length).toBe(36);
    expect(cut.startsWith("feature/")).toBe(true);
    expect(cut.endsWith("returns-model")).toBe(true);
    expect(cut).toContain("…");
    expect(middleCut("dev")).toBe("dev");
  });
  it("finds the nearest folders up from a path", () => {
    expect(foldersUp("/a/b/c.sql")).toEqual(["/a/b", "/a", "/"]);
    expect(foldersUp("/c.sql")).toEqual(["/"]);
  });
  it("says it plainly", () => {
    expect(BRANCH_TEXT.offUsual("feature/returns", "dev")).toBe("On feature/returns, not the usual dev");
    expect(BRANCH_TEXT.notSearched("main")).toBe("DevOps doesn't search this branch. These are from main.");
    expect(BRANCH_TEXT.moved("/a/x.sql", "main", "/a")).toBe("/a/x.sql isn't on main, so this is /a.");
    for (const w of Object.values(BRANCH_TEXT)) expect(typeof w === "function" ? (w as (...a: string[]) => string)("x", "y", "z") : w).not.toContain("—");
  });
});
