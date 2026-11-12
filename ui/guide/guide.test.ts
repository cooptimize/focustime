// G1, UI-5: the Guide's keys are ui/keys.ts's, its sandbox is the app's own fit math, and its address round-trips.
import { describe, expect, it } from "vitest";
import { DEFAULT_SIZE_SCALE, storyMinutes, type StorySize } from "../../plan/estimate.ts";
import { roomWords } from "../../plan/addwork.ts";
import { KEYS } from "../keys.ts";
import { hashOf, parseHash } from "../nav.ts";
import * as C from "./content.ts";
import { sandbox } from "./sandbox.ts";
import { CONTENTS, OLD_SECTIONS, sectionFor } from "./sections.ts";
import { keyRow, keysFor, richParts } from "./shortcuts.ts";

/** Every string in the content, however deep. */
const strings = (v: unknown): string[] => (typeof v === "string" ? [v] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v === "object" ? Object.values(v).flatMap(strings) : []);

describe("the Guide's shortcuts are ui/keys.ts's", () => {
  it("every shortcut card names keys that exist, and shows exactly those keys", () => {
    for (const card of C.SHORTCUTS.cards) {
      const rows = card.keys.map((r) => keyRow(r));
      expect(rows.every(Boolean), card.label).toBe(true);
      expect(keysFor(card.keys, card.all), card.label).toEqual(rows.flatMap((r) => ("all" in card && card.all ? r!.keys : [r!.keys[0]!])));
    }
  });
  it("the cards say what the keys do (the tabs are 1 to 5, capture N or C, midday check-in M, close out E; WD-2: a block opens with A, or W)", () => {
    const shown = Object.fromEntries(C.SHORTCUTS.cards.map((c) => [c.label, keysFor(c.keys, c.all)]));
    expect(shown["Day, Week, Backlog, Status, Inbox"]).toEqual(["1", "2", "3", "4", "5"]);
    expect(shown["Add work (on Backlog, Grid or Gantt)"]).toEqual(["P"]);
    expect(shown["Capture a thought"]).toEqual(["N", "C"]);
    expect(shown["Midday check-in"]).toEqual(["M"]);
    expect(shown["Close out"]).toEqual(["E"]);
    expect(shown["Open a block (A puts the cursor in Add)"]).toEqual(["A", "W"]);
    expect(shown["Every action"]).toEqual(["Ctrl K"]);
    expect(shown["Next or previous client"]).toEqual(["J", "K"]);
    expect(shown["Text size"]).toEqual(KEYS.find((k) => k.command === "ui.set_text_size")!.keys);
  });
  it("every key in the copy comes from keys.ts", () => {
    const marked = strings(C).filter((t) => t.includes("{key:"));
    expect(marked.length).toBeGreaterThan(2);
    for (const t of marked) expect(() => richParts(t), t).not.toThrow();
    // No key is typed into the copy as a bare <kbd> or "press X".
    for (const t of strings(C)) expect(t, t).not.toMatch(/<kbd>|\bpress [A-Z]\b/i);
  });
  it("? opens the Guide, and the legend still lists every key", () => {
    expect(KEYS.find((k) => k.keys[0] === "?")).toMatchObject({ command: "ui.guide" });
  });
});

describe("the sizing sandbox uses plan/estimate.ts and plan/fit.ts (E2: hours)", () => {
  const block = C.SIZING.block;
  const sizes: (StorySize | null)[] = ["S", "M", "L", null];
  /** Every multiset of up to five stories, unsized ones included. */
  const combos: (StorySize | null)[][] = [[]];
  for (let n = 1; n <= 5; n++) for (const c of combos.filter((x) => x.length === n - 1)) for (const s of sizes) if (!c.length || sizes.indexOf(s) >= sizes.indexOf(c.at(-1)!)) combos.push([...c, s]);

  it("its words are the block panel's free time for every S, M, L and unsized combination (QT-1)", () => {
    expect(combos.length).toBeGreaterThan(100);
    for (const c of combos) {
      const minutes = c.reduce((n, s) => n + storyMinutes(s, DEFAULT_SIZE_SCALE), 0);
      const sb = sandbox(c, block);
      expect(sb.fit, c.join("")).toEqual({ text: roomWords(block.freeMinutes, minutes).text, tone: "neutral" });
      expect(sb.fit.text, c.join("")).not.toMatch(/over|Full/);
      expect(sb.minutes, c.join("")).toBe(minutes);
    }
  });
  it("reads as the legend says: S 1h, M 2h, L 4h, unsized 1h; free time only, never amber or red", () => {
    expect(block.free).toBe("4h free after meetings");
    expect(sandbox(["M", "S"], block)).toMatchObject({ load: { planned: "3h", free: "4h" }, filled: 3, spill: 0, chips: ["M · 2h", "S · 1h"] });
    expect(C.SIZING.load("3h", "4h")).toBe("3h of 4h");
    expect(sandbox([null], block).chips).toEqual(["Size? · 1h"]);
    expect(sandbox([null, null], block).fit.text).toBe("2h free");
    for (const c of [["S", "S", "S", "S"], ["M", "M"], ["L"], ["M", null, null]] as (StorySize | null)[][]) expect(sandbox(c, block)).toMatchObject({ filled: 4, spill: 0 });
    expect(sandbox(["L", "M"], block)).toMatchObject({ spill: 2, fit: { text: "No free time", tone: "neutral" } });
    for (const c of combos) expect(sandbox(c, block).fit.tone).toBe("neutral");
    expect(["S", "M", "L", null].map((z) => C.SIZING.add(z as StorySize | null))).toEqual(["S · 1h", "M · 2h", "L · 4h", "unsized"]);
  });
  it("the legend is exactly its four lines", () => {
    expect(C.SIZING.legend.map((l) => l.replace(/\{b:([^}]*)\}/g, "$1"))).toEqual([
      "S 1h · M 2h · L 4h",
      "Sizing is optional. An unsized story counts as 1h until you size it. Change that in Settings › Planning.",
      "Hours are a guide, not a limit. Plan what you like; what doesn't get done moves forward.",
      "Features are their stories added up, or your estimate until they're sized.",
    ]);
  });
});

describe("estimates in the Guide are hours (E2)", () => {
  it("no fractions, decimals or blocks in estimate copy; a block is only named as the calendar unit", () => {
    const estimates = [C.SIZING.legend, C.SIZING.sub, C.TRY, C.AREAS].flatMap(strings);
    for (const t of estimates) expect(t, t).not.toMatch(/½|¼|¾|\d[.,]\d|half blocks?\b|\d+ blocks?\b|\bof \d+ blocks?/);
    // "block" appears only where it names the calendar unit (a focus block, half a day), never as an amount.
    for (const t of strings(C).filter((x) => /\bblocks?\b/i.test(x))) expect(t, t).not.toMatch(/\d\s*(½\s*)?blocks?\b|blocks? (free|planned|available)/i);
  });
  it("the new questions are there", () => {
    const qs = Object.fromEntries(C.QUESTION_POOL.map((x) => [x.q, x.a]));
    expect(qs["Do I have to size everything?"]).toBe("No. Unsized stories count as 1h so the plan still adds up (change that in Settings › Planning), and nothing waits on a size. Size them when you know.");
    expect(qs["What's a block, then?"]).toBe("Where you work: a half-day set aside for a client in Focus Time. How much work fits is measured in hours.");
    expect(C.FOOTER).toBe("FocusTime by Cooptimize. Questions or ideas? ⋯ › Send feedback, or message the FocusTime team in Teams.");
    expect(qs["How do I send an idea, a problem or a question?"]).toMatch(/^⋯ › Send feedback, .*message the FocusTime team in Teams\.$/);
  });
});

describe("the Guide's address", () => {
  it("#/guide and #/guide/<section> open it over Today, and write back the same", () => {
    expect(parseHash("#/guide")).toEqual({ nav: { tab: "today", flow: null, date: null }, overlay: { kind: "guide", chapter: null } });
    for (const ch of [...C.SECTIONS, { id: CONTENTS }]) {
      const l = parseHash(`#/guide/${ch.id}`)!;
      expect(l.overlay).toEqual({ kind: "guide", chapter: ch.id });
      expect(hashOf(l)).toBe(`#/guide/${ch.id}`);
    }
    expect(parseHash("#/guide/keys/x")).toBeNull();
    expect(parseHash("#/guide/K3!")).toBeNull();
  });
  it("an old G1 chapter opens where its content is now; nothing or something unknown is Start here; contents is the phone's list", () => {
    for (const [old, now] of Object.entries(OLD_SECTIONS)) {
      expect(C.SECTIONS.some((s) => s.id === now), old).toBe(true);
      expect(sectionFor(old)).toBe(now);
    }
    expect(sectionFor(null)).toBe("start");
    expect(sectionFor("nope")).toBe("start");
    expect(sectionFor(CONTENTS)).toBeNull();
  });
});

describe("example data only", () => {
  it("says so on screen", () => {
    expect(C.TRY.example).toMatch(/^Example data\. Nothing here is saved or sent\.$/);
    expect(C.SIZING.block.label).toMatch(/example/i);
    expect(C.TOUR_UI.example).toMatch(/^Example/);
  });
  it("no em dashes in the copy", () => {
    for (const t of strings(C)) expect(t, t).not.toContain("—");
  });
});
