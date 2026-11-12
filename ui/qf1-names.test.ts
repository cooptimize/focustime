// QF-1: labels only. Ahead's Fix next is Gaps (BL-1: now Backlog's Needs attention) (the mode and address keep "fix") and the capture box's Sort later is
// Decide later (the kind keeps "later"); the command menu finds both by old and new words; #/ahead/gaps lands too.
import { describe, expect, it } from "vitest";
import { ACTIONS, type ActionSpec } from "../actions/registry.ts";
import { BOX_NAME } from "./Capture.tsx";
import { filterCommands, type MenuItem } from "./menu.ts";
import { hashOf, MODE_NAMES, MODES, navOf, parseHash } from "./nav.ts";
import { TEAM } from "./guide/content.ts";

const commands = (ACTIONS as readonly ActionSpec[]).map<MenuItem>((a) => ({ id: a.name, action: a.name, group: a.group, label: a.title, ...(a.aka ? { aka: a.aka } : {}) }));

describe("QF-1 names", () => {
  it("BL-1: the Backlog tab's views read Grid · Gantt; Gaps (Readiness) lands on the Grid with Needs attention on", () => {
    expect(MODES.ahead.map((m) => MODE_NAMES[m])).toEqual(["Grid", "Gantt"]);
    expect(parseHash("#/ahead/gaps")?.nav).toEqual(navOf.ahead("grid", "attention"));
    expect(hashOf({ nav: navOf.ahead("grid", "attention"), overlay: null })).toBe("#/backlog");
  });
  it("the capture box's first chip reads Decide later", () => {
    expect(BOX_NAME.later).toBe("Decide later");
  });
  it("the command menu finds Quick capture by decide later and by sort later", () => {
    for (const q of ["decide later", "sort later"]) expect(filterCommands(commands, q).map((i) => i.label)).toContain("Quick capture");
  });
  it("the Guide's renamed answer names both", () => {
    const text = JSON.stringify(TEAM);
    expect(text).toContain("Fix next became Gaps, then Readiness, and is now Backlog's Needs attention");
    expect(text).toContain("Sort later is now Decide later");
  });
});
