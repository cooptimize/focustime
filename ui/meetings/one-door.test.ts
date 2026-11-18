// MC-1e: a call's proposals reach DevOps through the app's one door. The call page never calls the write actions
// itself (only useDevOpsWrite, whose preview is ui/DevOpsWrite.tsx), has no confirm dialog of its own, and the meeting
// actions never write to DevOps: their writes are the framework's meeting_create and meeting_comment.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hashOf, parseHash } from "../nav.ts";

const here = new URL(".", import.meta.url).pathname;
const read = (p: string) => readFileSync(p, "utf8");

describe("one door into DevOps (MC-1e)", () => {
  it("the call page writes only through the shared preview", () => {
    for (const f of readdirSync(here).filter((x) => x.endsWith(".tsx"))) {
      const src = read(join(here, f));
      expect(src, f).not.toMatch(/["']devops\.(confirm|preview)["']/);
      expect(src, f).not.toMatch(/ConfirmDialog|meeting\.(prepare|confirm)\b/);
    }
    expect(read(join(here, "Meetings.tsx"))).toContain("useDevOpsWrite");
  });
  it("the meeting actions never call DevOps", () => {
    const src = read(join(here, "../../actions/meeting-actions.ts"));
    expect(src).not.toMatch(/devops\.(confirm|preview)|writer\.(create|comment|update)|_apis\/wit/);
  });
});

describe("the call's address (MC-1e, MC-3)", () => {
  it("carries the filter and a proposal to bring into view; the #/meetings address before MC-3 lands on the same", () => {
    for (const [hash, nav] of [
      ["#/calls/7/new", { tab: "calls", occurrence: 7, filter: "gap" }],
      ["#/calls/7/promises", { tab: "calls", occurrence: 7, filter: "commitment" }],
      ["#/calls/7/comments", { tab: "calls", occurrence: 7, filter: "comment" }],
      ["#/calls/7/proposal/31", { tab: "calls", occurrence: 7, proposal: 31 }],
    ] as const) {
      const loc = parseHash(hash);
      expect(loc?.nav, hash).toEqual(nav);
      expect(hashOf(loc!), hash).toBe(hash);
      expect(hashOf(parseHash(hash.replace("#/calls", "#/meetings"))!), hash).toBe(hash);
    }
    expect(parseHash("#/meetings/7/proposal/x")).toBeNull();
    expect(parseHash("#/meetings/7/new/2")).toBeNull();
  });
});
