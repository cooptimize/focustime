// QF-1: labels only. Ahead's Fix next is Gaps (the mode and address keep "fix") and the capture box's Sort later is
// Decide later (the kind keeps "later"); the command menu finds both by old and new words; #/ahead/gaps lands too.
import { describe, expect, it } from "vitest";
import { ACTIONS, type ActionSpec } from "../actions/registry.ts";
import { BOX_NAME } from "./Capture.tsx";
import { filterCommands, type MenuItem } from "./menu.ts";
import { hashOf, MODE_NAMES, MODES, navOf, parseHash } from "./nav.ts";
import { TEAM } from "./guide/content.ts";

const commands = (ACTIONS as readonly ActionSpec[]).map<MenuItem>((a) => ({ id: a.name, action: a.name, group: a.group, label: a.title, ...(a.aka ? { aka: a.aka } : {}) }));

describe("QF-1 names", () => {
  it("Ahead's modes read Grid · Gantt · Gaps; the code name and address stay fix", () => {
    expect(MODES.ahead.map((m) => MODE_NAMES[m])).toEqual(["Grid", "Gantt", "Gaps"]);
    expect(hashOf({ nav: navOf.ahead("fix"), overlay: null })).toBe("#/ahead/fix");
    expect(parseHash("#/ahead/gaps")?.nav).toEqual(navOf.ahead("fix"));
  });
  it("the capture box's first chip reads Decide later", () => {
    expect(BOX_NAME.later).toBe("Decide later");
  });
  it("the command menu finds Quick capture by decide later and by sort later", () => {
    for (const q of ["decide later", "sort later"]) expect(filterCommands(commands, q).map((i) => i.label)).toContain("Quick capture");
  });
  it("the Guide's renamed answer names both", () => {
    const text = JSON.stringify(TEAM);
    expect(text).toContain("Fix next is now Gaps");
    expect(text).toContain("Sort later is now Decide later");
  });
});
