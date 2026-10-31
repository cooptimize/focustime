import { describe, expect, it } from "vitest";
import { buildWeek } from "../week/build.ts";
import { config } from "../week/test-helpers.ts";
import { KEYS, nextRegion, openTarget, regionOf, regionsAvailable } from "./keys.ts";
import { commandList, type MenuEnv } from "./menu.ts";

/** A stand-in element: `closest` answers for the selectors it is inside. */
const inside = (...selectors: string[]) => ({ closest: (sel: string) => (sel.split(",").some((s) => selectors.includes(s.trim())) ? {} : null) });
const row = (attrs: Record<string, string> | null) => ({ closest: () => (attrs ? { getAttribute: (n: string) => attrs[n] ?? null } : null) });
const URL = "https://dev.azure.com/org/P/_workitems/edit/1";

describe("F6 regions", () => {
  it("cycles top bar, week, status bar, and wraps both ways", () => {
    const a = regionsAvailable({ planOpen: false, detailsOpen: false });
    expect(a).toEqual(["top", "grid", "status"]);
    expect(nextRegion("top", a, 1)).toBe("grid");
    expect(nextRegion("status", a, 1)).toBe("top");
    expect(nextRegion("top", a, -1)).toBe("status");
  });

  it("Plan the day takes the week's place; the details dialog is the only region while open", () => {
    expect(regionsAvailable({ planOpen: true, detailsOpen: false })).toEqual(["top", "panel", "status"]);
    expect(regionsAvailable({ planOpen: false, detailsOpen: true })).toEqual(["panel"]);
    expect(nextRegion("panel", ["panel"], 1)).toBe("panel");
  });

  it("from outside any region (or a region not available now), forward goes to the first and back to the last", () => {
    const a = regionsAvailable({ planOpen: true, detailsOpen: false });
    expect(nextRegion(null, a, 1)).toBe("top");
    expect(nextRegion(null, a, -1)).toBe("status");
    expect(nextRegion("grid", a, 1)).toBe("top");
  });

  it("finds the region of the focused element; Plan the day counts as the panel although it sits in the grid", () => {
    expect(regionOf(inside(".planday", ".grid"))).toBe("panel");
    expect(regionOf(inside("dialog.details"))).toBe("panel");
    expect(regionOf(inside(".grid"))).toBe("grid");
    expect(regionOf(inside(".topbar"))).toBe("top");
    expect(regionOf(inside(".statusbar"))).toBe("status");
    expect(regionOf(inside())).toBeNull();
    expect(regionOf(null)).toBeNull();
  });
});

describe("O opens the focused work item", () => {
  it("from any element inside a row that carries a work item", () => {
    expect(openTarget(row({ "data-item-client": "CSC", "data-item-url": URL }))).toEqual({ clientKey: "CSC", url: URL });
  });

  it("nothing for a row without one, or a link that isn't Azure DevOps", () => {
    expect(openTarget(row(null))).toBeNull();
    expect(openTarget(row({ "data-item-client": "CSC", "data-item-url": "https://example.com/x" }))).toBeNull();
    expect(openTarget(row({ "data-item-url": URL }))).toBeNull();
    expect(openTarget(null)).toBeNull();
  });
});

describe("the keyboard legend and the command menu agree", () => {
  const week = buildWeek({ weekStart: "2026-11-02", patterns: [], events: [], config });
  const noop = () => {};
  const env: MenuEnv = {
    week, selection: { date: "2026-11-02", half: "AM" }, planWeek: null, planState: null, planTarget: { date: "2026-11-02", isToday: true }, today: "2026-11-02", work: new Map(), calendars: { outlook: false, google: false },
    runPlan: async () => true, openPlanDay: noop, commitPlan: noop, openDetails: noop, openLink: noop, changeWeek: noop, goToday: noop, refresh: noop, showSourceStatus: noop, connect: noop, disconnect: noop, setView: noop,
    moveRegion: noop, focusedItem: null, showKeys: noop, theme: "cooptimize-dark", setTheme: noop,
  };
  const commands = commandList(env);

  it("every key with a command appears in the command menu with that key", () => {
    for (const k of KEYS.filter((k) => k.command)) {
      const c = commands.find((x) => x.action === k.command);
      expect(c, k.does).toBeDefined();
      expect(c!.hint, k.does).toBe(k.keys[0]);
    }
  });

  it("every key the command menu shows is in the legend", () => {
    const legend = new Set(KEYS.flatMap((k) => k.keys));
    for (const c of commands.filter((x) => x.hint)) expect(legend.has(c.hint!), `${c.label}: ${c.hint}`).toBe(true);
  });

  it("O in the command menu opens the item focused when it opened, or says to focus one", () => {
    const calls: unknown[] = [];
    const withItem = commandList({ ...env, focusedItem: { clientKey: "CSC", url: URL }, openLink: (k, u) => calls.push([k, u]) }).find((c) => c.action === "ui.open_focused")!;
    void withItem.run?.();
    expect(calls).toEqual([["CSC", URL]]);
    expect(commands.find((c) => c.action === "ui.open_focused")!.disabled).toBe("Focus a work item first (Tab to it)");
  });
});
