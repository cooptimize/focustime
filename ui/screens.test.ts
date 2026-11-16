// PF-1: the rules for a screen that loads when first opened (ui/screens.ts), with stand-in loaders and a stand-in
// page: the place drawn while a file arrives, the Loading clock, a file that fails offline, across a release (one
// reload, never two) and for good (Retry), a screen's own error (never mistaken for a missing file), and what is
// fetched in the background, in which order, and when not.
import { afterEach, describe, expect, it } from "vitest";
import { locScreens, parseHash } from "./nav.ts";
import { BACKGROUND, drawnLoc, fetchAhead, isLoadError, loadScreen, prefetchScreens, retryScreens, screen, screenReady, SCREENS, screensForTest, slowOrMetered, tryAgain, waiting, wantScreens, type Page, type ScreenName } from "./screens.ts";

const LOAD_ERROR = new TypeError("Failed to fetch dynamically imported module: https://focustime.example/assets/Ahead-abc.js");

/** Loaders the test settles by hand, and a page that records what was done to it. */
function setup(over: { online?: boolean; reach?: boolean; note?: Page["note"] } = {}) {
  const asked: ScreenName[] = [];
  const settle = new Map<ScreenName, { ok: (m: unknown) => void; fail: (e: unknown) => void }[]>();
  let note: string | null = null;
  const did = { reloads: 0, thrown: [] as unknown[], restyled: [] as string[] };
  const state = { online: over.online ?? true, reach: over.reach ?? true };
  screensForTest(
    (name) => {
      asked.push(name);
      return new Promise((ok, fail) => settle.set(name, [...(settle.get(name) ?? []), { ok, fail }]));
    },
    { online: () => state.online, reach: async () => state.reach, note: { get: () => note, set: (v) => void (note = v) }, reload: () => void did.reloads++, rethrow: (e) => void did.thrown.push(e), restyle: async (hrefs) => void did.restyled.push(...hrefs), ...(over.note ? { note: over.note } : {}) },
  );
  const last = (name: ScreenName) => settle.get(name)!.at(-1)!;
  const tick = () => new Promise((r) => setTimeout(r, 0));
  return { asked, did, state, arrive: async (n: ScreenName, mod: unknown = { name: n }) => (last(n).ok(mod), await tick()), fail: async (n: ScreenName, e: unknown = LOAD_ERROR) => (last(n).fail(e), await tick()), note: () => note, setNote: (v: string | null) => void (note = v) };
}
afterEach(() => screensForTest());

describe("which screens a place needs (ui/nav.ts)", () => {
  const needs = (hash: string) => locScreens(parseHash(hash)!);
  it("Day and Week need none; every other tab, flow and overlay names its own", () => {
    expect(needs("#/day")).toEqual([]);
    expect(needs("#/week")).toEqual([]);
    expect(needs("#/day/2026-11-03/PM")).toEqual([]);
    expect(needs("#/backlog")).toEqual(["ahead"]);
    expect(needs("#/backlog/gantt")).toEqual(["ahead"]);
    expect(needs("#/status")).toEqual(["status"]);
    expect(needs("#/inbox/promises")).toEqual(["inbox"]);
    expect(needs("#/code")).toEqual(["code"]);
    expect(needs("#/day/checkin")).toEqual(["checkin"]);
    expect(needs("#/day/closeout")).toEqual(["closeout"]);
    expect(needs("#/settings/you")).toEqual(["settings"]);
    expect(needs("#/focus")).toEqual(["focus"]);
    expect(needs("#/guide")).toEqual(["guide"]);
    expect(needs("#/docs")).toEqual(["docs"]);
    // A tour's screen is drawn at once; the tour's own file is asked for by App, like a dialog's.
    expect(needs("#/guide/tour/board")).toEqual([]);
    expect(needs("#/guide/tour/ahead")).toEqual(["ahead"]);
    expect(needs("#/item/Northwind/12")).toEqual(["card"]);
  });
  it("every name a place can need is a screen with a loader", () => {
    for (const h of ["#/backlog", "#/status", "#/inbox", "#/code", "#/day/checkin", "#/day/closeout", "#/settings", "#/focus", "#/guide", "#/docs", "#/item/Northwind/12"]) for (const n of needs(h)) expect(SCREENS).toContain(n);
    for (const n of BACKGROUND) expect(SCREENS).toContain(n);
  });
});

describe("a screen arriving", () => {
  it("is fetched once however often it is asked for, and is there for good once in", async () => {
    const t = setup();
    expect(screen("ahead")).toBeNull();
    const off1 = wantScreens(["ahead"]);
    const off2 = wantScreens(["ahead"]);
    void loadScreen("ahead");
    expect(t.asked).toEqual(["ahead"]);
    expect(waiting().since).not.toBeNull();
    await t.arrive("ahead", { Ahead: 1 });
    expect(screen("ahead")).toEqual({ Ahead: 1 });
    expect(waiting()).toEqual({ since: null, failed: null });
    off1();
    off2();
    void loadScreen("ahead");
    expect(t.asked).toEqual(["ahead"]);
  });

  it("the place the person was on is drawn until the asked place's file is in", async () => {
    const t = setup();
    const needs = (l: string) => (l === "backlog" ? (["ahead"] as const) : []);
    expect(drawnLoc("day", needs, null, "day")).toBe("day");
    const off = wantScreens(["ahead"]);
    expect(drawnLoc("backlog", needs, "day", "day")).toBe("day");
    await t.arrive("ahead");
    expect(drawnLoc("backlog", needs, "day", "day")).toBe("backlog");
    off();
  });

  it("opened at an address: the asked place (under the loader) until its file is in, and Day if it fails", async () => {
    const t = setup({ online: false });
    const needs = (l: string) => (l === "backlog" ? (["ahead"] as const) : []);
    const off = wantScreens(["ahead"]);
    expect(drawnLoc("backlog", needs, null, "day")).toBe("backlog");
    await t.fail("ahead");
    expect(drawnLoc("backlog", needs, null, "day")).toBe("day");
    off();
  });

  it("only what is asked for on screen counts as waiting: a file fetched ahead says nothing", async () => {
    const t = setup();
    void loadScreen("status");
    expect(waiting()).toEqual({ since: null, failed: null });
    const off = wantScreens(["status"]);
    expect(waiting().since).not.toBeNull();
    off();
    expect(waiting().since).toBeNull();
    await t.arrive("status");
  });
});

describe("a screen's file that doesn't arrive", () => {
  it("tells a file that can't be fetched from an error in the screen's own code", () => {
    expect(isLoadError(new TypeError("Failed to fetch dynamically imported module: https://x/assets/Ahead-1.js"))).toBe(true);
    expect(isLoadError(new TypeError("error loading dynamically imported module: https://x/assets/Ahead-1.js"))).toBe(true);
    expect(isLoadError(new TypeError("Importing a module script failed."))).toBe(true);
    expect(isLoadError(new TypeError("'text/html' is not a valid JavaScript MIME type."))).toBe(true);
    expect(isLoadError(new Error("Unable to preload CSS for /assets/InboxPage-1.css"))).toBe(true);
    expect(isLoadError(new TypeError("Cannot read properties of undefined (reading 'map')"))).toBe(false);
    expect(isLoadError(new ReferenceError("x is not defined"))).toBe(false);
    expect(isLoadError(null)).toBe(false);
  });

  it("offline: the line says it needs a connection; nothing reloads; Retry fetches it again", async () => {
    const t = setup({ online: false });
    const off = wantScreens(["status"]);
    await t.fail("status");
    expect(waiting()).toEqual({ since: null, failed: "offline" });
    expect(t.did.reloads).toBe(0);
    // The browser says online but the server can't be reached: the same.
    t.state.online = true;
    t.state.reach = false;
    retryScreens();
    await t.fail("status");
    expect(waiting().failed).toBe("offline");
    expect(t.did.reloads).toBe(0);
    t.state.reach = true;
    retryScreens();
    expect(waiting().failed).toBeNull();
    await t.arrive("status");
    expect(screenReady("status")).toBe(true);
    off();
  });

  it("online: one reload to pick up a release, remembered so it is never a loop; then the line with Retry", async () => {
    const t = setup();
    const off = wantScreens(["ahead"]);
    await t.fail("ahead");
    expect(t.did.reloads).toBe(1);
    expect(t.note()).toBe("ahead");
    off();
    // The page after that reload (the note is still there): the file still can't be had.
    const t2 = setup();
    t2.setNote("ahead");
    const off2 = wantScreens(["ahead"]);
    await t2.fail("ahead");
    expect(t2.did.reloads).toBe(0);
    expect(waiting()).toEqual({ since: null, failed: "missing" });
    // Another screen loading doesn't forget it (or each new ask for the missing one would reload again).
    void loadScreen("status");
    await t2.arrive("status");
    expect(t2.note()).toBe("ahead");
    // Asked for again (its tab, its key): one more try, the line again, no reload.
    tryAgain(["ahead"]);
    await t2.fail("ahead");
    expect(t2.did.reloads).toBe(0);
    expect(waiting().failed).toBe("missing");
    // A second screen missing gets its own one reload.
    const off3 = wantScreens(["inbox"]);
    await t2.fail("inbox");
    expect(t2.did.reloads).toBe(1);
    expect(t2.note()).toBe("ahead,inbox");
    // Once the screen itself loads, it is forgotten: a later release may reload once for it again.
    retryScreens();
    await t2.arrive("ahead");
    expect(t2.note()).toBe("inbox");
    off2();
    off3();
  });

  it("the note can't be written (storage full): no reload at all, so nothing can loop", async () => {
    const t = setup({ note: { get: () => null, set: () => undefined } });
    const off = wantScreens(["ahead"]);
    await t.fail("ahead");
    expect(t.did.reloads).toBe(0);
    expect(waiting().failed).toBe("missing");
    off();
  });

  it("hover or focus never tries a failed screen again: only asking for it or Retry does", async () => {
    const t = setup();
    t.setNote("ahead");
    const off = wantScreens(["ahead"]);
    await t.fail("ahead");
    fetchAhead("ahead");
    expect(t.asked).toEqual(["ahead"]);
    fetchAhead("status");
    fetchAhead("status");
    expect(t.asked).toEqual(["ahead", "status"]);
    off();
  });

  it("a stylesheet that failed is fetched again before the screen's next try, so it never draws unstyled", async () => {
    const t = setup({ online: false });
    const off = wantScreens(["inbox"]);
    await t.fail("inbox", new Error("Unable to preload CSS for https://focustime.example/assets/InboxPage-1.css"));
    expect(waiting().failed).toBe("offline");
    t.state.online = true;
    retryScreens();
    await new Promise((r) => setTimeout(r, 0));
    expect(t.did.restyled).toEqual(["https://focustime.example/assets/InboxPage-1.css"]);
    expect(t.asked).toEqual(["inbox", "inbox"]);
    await t.arrive("inbox");
    expect(screenReady("inbox")).toBe(true);
    off();
  });

  it("Retry tries again and, if the file still can't be had, reloads once for that press", async () => {
    const t = setup();
    t.setNote("ahead");
    const off = wantScreens(["ahead"]);
    await t.fail("ahead");
    expect(t.did.reloads).toBe(0);
    retryScreens();
    expect(t.asked).toEqual(["ahead", "ahead"]);
    await t.fail("ahead");
    expect(t.did.reloads).toBe(1);
    off();
  });

  it("a file fetched ahead that fails never reloads and says nothing; asked for later, it is fetched again", async () => {
    const t = setup();
    void loadScreen("inbox");
    await t.fail("inbox");
    expect(t.did.reloads).toBe(0);
    expect(waiting()).toEqual({ since: null, failed: null });
    const off = wantScreens(["inbox"]);
    expect(t.asked).toEqual(["inbox", "inbox"]);
    await t.arrive("inbox");
    expect(screenReady("inbox")).toBe(true);
    off();
  });

  it("the screen's own code throws: thrown on, with no reload and no line; asked again, it is tried again", async () => {
    const t = setup();
    const off = wantScreens(["capture"]);
    const boom = new TypeError("Cannot read properties of undefined (reading 'x')");
    await t.fail("capture", boom);
    expect(t.did.thrown).toEqual([boom]);
    expect(t.did.reloads).toBe(0);
    expect(waiting()).toEqual({ since: null, failed: null });
    expect(t.note()).toBeNull();
    off();
    // Opened at that address: Day is drawn, not an empty page under a loader that never leaves.
    expect(drawnLoc("x", () => ["capture"] as const, null, "day")).toBe("day");
    const off2 = wantScreens(["capture"]);
    expect(t.asked).toEqual(["capture", "capture"]);
    off2();
  });
});

describe("fetching ahead in the background", () => {
  it("one file at a time while idle, in the tabs' order then what a key opens; never the Guide or the docs", async () => {
    const t = setup();
    const idle: (() => void)[] = [];
    prefetchScreens(BACKGROUND, (f) => void idle.push(f));
    expect(t.asked).toEqual([]);
    for (const n of BACKGROUND) {
      idle.shift()!();
      expect(t.asked.at(-1)).toBe(n);
      await t.arrive(n);
    }
    expect(t.asked).toEqual([...BACKGROUND]);
    expect(BACKGROUND.slice(0, 4)).toEqual(["ahead", "status", "inbox", "code"]);
    expect(BACKGROUND).not.toContain("guide");
    expect(BACKGROUND).not.toContain("docs");
    expect(idle).toEqual([]);
  });

  it("skips a screen already in, and goes on past one that fails", async () => {
    const t = setup();
    void loadScreen("status");
    await t.arrive("status");
    const idle: (() => void)[] = [];
    prefetchScreens(["ahead", "status", "inbox"], (f) => void idle.push(f));
    idle.shift()!();
    await t.fail("ahead");
    idle.shift()!();
    expect(t.asked).toEqual(["status", "ahead", "inbox"]);
    await t.arrive("inbox");
  });

  it("not on a slow or data-saving connection, and not offline", () => {
    expect(slowOrMetered(undefined)).toBe(false);
    expect(slowOrMetered({ effectiveType: "4g" })).toBe(false);
    expect(slowOrMetered({ effectiveType: "4g", saveData: true })).toBe(true);
    for (const e of ["slow-2g", "2g", "3g"]) expect(slowOrMetered({ effectiveType: e })).toBe(true);
    const t = setup({ online: false });
    const idle: (() => void)[] = [];
    prefetchScreens(BACKGROUND, (f) => void idle.push(f));
    expect(idle).toEqual([]);
    expect(t.asked).toEqual([]);
  });
});
