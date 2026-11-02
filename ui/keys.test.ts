import { legacyHours } from "../config/schema.ts";
import { describe, expect, it } from "vitest";
import { buildWeek } from "../week/build.ts";
import { config } from "../week/test-helpers.ts";
import { commandKeyAllowed, globalKeyAllowed, isTypingTarget, KEYS, nextRegion, openTarget, regionOf, regionsAvailable, topOverlay } from "./keys.ts";
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
    expect(regionOf(inside(".detail-panel"))).toBe("panel");
    expect(regionOf(inside(".grid"))).toBe("grid");
    expect(regionOf(inside(".topbar"))).toBe("top");
    expect(regionOf(inside(".statusbar"))).toBe("status");
    expect(regionOf(inside())).toBeNull();
    expect(regionOf(null)).toBeNull();
  });
});

describe("O opens the focused work item", () => {
  it("from any element inside a row that carries a work item", () => {
    expect(openTarget(row({ "data-item-client": "Adatum", "data-item-url": URL }))).toEqual({ clientKey: "Adatum", url: URL });
  });

  it("nothing for a row without one, or a link that isn't Azure DevOps", () => {
    expect(openTarget(row(null))).toBeNull();
    expect(openTarget(row({ "data-item-client": "Adatum", "data-item-url": "https://example.com/x" }))).toBeNull();
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
    moveRegion: noop, focusedItem: null, showKeys: noop, theme: "cooptimize-dark", setTheme: noop, viewRange: "business", setViewRange: noop, hours: legacyHours({ start: "09:00", split: "12:30", end: "17:00", timeZone: "America/New_York" }), runTime: async () => true, openSettings: noop, exportPlan: noop,
    openCloseOut: noop, openCheckIn: noop, closeOutDate: null, commitCloseOut: noop, makeUp: async () => true, runFollowUps: async () => true, borrowed: [],
  } as MenuEnv;
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
    const withItem = commandList({ ...env, focusedItem: { clientKey: "Adatum", url: URL }, openLink: (k, u) => calls.push([k, u]) }).find((c) => c.action === "ui.open_focused")!;
    void withItem.run?.();
    expect(calls).toEqual([["Adatum", URL]]);
    expect(commands.find((c) => c.action === "ui.open_focused")!.disabled).toBe("Focus a work item first (Tab to it)");
  });
});

describe("keys while typing or with a dialog open (step 13.5)", () => {
  const el = (tagName: string, extra: { type?: string; isContentEditable?: boolean } = {}) => ({ tagName, ...extra });
  const key = (k: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });
  // Every global shortcut the legend lists, plus the ones the week grid handles.
  const SHORTCUTS = [" ", "Enter", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "[", "]", "?", ",", "1", "2", "3", "4", "t", "T", "n", "N", "w", "W", "p", "i", "l", "e", "m", "f", "c", "C", "o", "O", "h", "r", "R"];
  // The text fields in dialogs: help invite note, capture, follow-up form, timebox title, settings, command menu search.
  const FIELDS = [el("TEXTAREA"), el("INPUT", { type: "text" }), el("INPUT", { type: "search" }), el("INPUT", { type: "time" }), el("INPUT", { type: "date" }), el("INPUT", { type: "number" }), el("SELECT"), el("DIV", { isContentEditable: true }), el("INPUT")];

  it("knows what typing is: text-like inputs, textareas, selects and contenteditable; not checkboxes or buttons", () => {
    for (const f of FIELDS) expect(isTypingTarget(f)).toBe(true);
    for (const f of [el("INPUT", { type: "checkbox" }), el("INPUT", { type: "radio" }), el("BUTTON"), el("DIV"), null]) expect(isTypingTarget(f)).toBe(false);
  });
  it("no shortcut reaches the views while typing in any field, with or without a dialog", () => {
    for (const f of FIELDS) for (const k of SHORTCUTS) for (const o of ["none", "details", "modal"] as const) expect(globalKeyAllowed(key(k), f, o), `${k} in ${f.tagName}/${o}`).toBe(false);
  });
  it("while a dialog or menu is open, the views behind it get no keys at all, Esc included (the dialog closes itself)", () => {
    for (const k of [...SHORTCUTS, "Escape", "F6"]) expect(globalKeyAllowed(key(k), el("BUTTON"), "modal")).toBe(false);
  });
  it("Esc in a text field outside a dialog still reaches the view (leaves Settings), and F6 still moves regions", () => {
    expect(globalKeyAllowed(key("Escape"), el("INPUT", { type: "text" }), "none")).toBe(true);
    expect(globalKeyAllowed(key("F6"), el("TEXTAREA"), "none")).toBe(true);
  });
  it("with the half-day details open, only F6 (its regions) reaches the window handlers", () => {
    expect(globalKeyAllowed(key("F6"), el("BUTTON"), "details")).toBe(true);
    for (const k of SHORTCUTS) expect(globalKeyAllowed(key(k), el("BUTTON"), "details")).toBe(false);
  });
  it("outside fields and dialogs, shortcuts work as before; chords with Ctrl, Alt or Meta are never plain shortcuts", () => {
    for (const k of SHORTCUTS) expect(globalKeyAllowed(key(k), el("BUTTON"), "none")).toBe(true);
    expect(globalKeyAllowed(key("n", { ctrlKey: true }), el("DIV"), "none")).toBe(false);
    expect(globalKeyAllowed(key("2", { altKey: true }), el("DIV"), "none")).toBe(false);
  });
  it("Ctrl+K opens the command menu unless another dialog is on top; it closes the command menu itself", () => {
    expect(commandKeyAllowed("none", false)).toBe(true);
    expect(commandKeyAllowed("details", false)).toBe(true);
    expect(commandKeyAllowed("modal", false)).toBe(false);
    expect(commandKeyAllowed("modal", true)).toBe(true);
  });
  it("finds the top overlay from data-overlay markers", () => {
    const doc = (sel: Record<string, boolean>) => ({ querySelector: (s: string) => (sel[s] ? {} : null) });
    expect(topOverlay(doc({}))).toBe("none");
    expect(topOverlay(doc({ '[data-overlay="details"]': true }))).toBe("details");
    expect(topOverlay(doc({ '[data-overlay="details"]': true, '[data-overlay="modal"]': true }))).toBe("modal");
  });
});
