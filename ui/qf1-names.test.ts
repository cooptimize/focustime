// QF-1: labels only. Ahead's Fix next is Gaps (BL-1: now Backlog's Needs attention) (the mode and address keep "fix") and the capture box's Sort later is
// Decide later (the kind keeps "later"); the command menu finds both by old and new words; #/ahead/gaps lands too.
import { describe, expect, it } from "vitest";
import { ACTIONS, type ActionSpec } from "../actions/registry.ts";
import { BOX_NAME } from "./Capture.tsx";
import { filterCommands, type MenuItem } from "./menu.ts";
import { hashOf, MODE_NAMES, MODES, navOf, parseHash } from "./nav.ts";
import { RENAMED_ROWS } from "./guide/retired.ts";

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
  // GU-1: the answer that told the history as a chain is gone; Renamed has one row per old name.
  it("the Guide's Renamed list has a row for each, with where it lives now", () => {
    const now = Object.fromEntries(RENAMED_ROWS);
    expect(now["Fix next"]).toBe("Backlog › Needs attention");
    expect(now["Sort later"]).toBe("Decide later");
  });
});
