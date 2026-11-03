// G1: the Guide's keys are ui/keys.ts's, its sandbox is the app's own fit math, and its address round-trips.
import { describe, expect, it } from "vitest";
import { storyMinutes, type StorySize } from "../../plan/estimate.ts";
import { blockFitWords } from "../../plan/fit.ts";
import { fitOf } from "../../plan/rules.ts";
import { KEYS } from "../keys.ts";
import { hashOf, parseHash } from "../nav.ts";
import * as C from "./content.ts";
import { sandbox } from "./sandbox.ts";
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
  it("the cards say what the keys do (the tabs are 1 2 3 4, capture N, check-in M, close out E, plan the week W)", () => {
    const shown = Object.fromEntries(C.SHORTCUTS.cards.map((c) => [c.label, keysFor(c.keys, c.all)]));
    expect(shown["Today, Week, Roadmap, Inbox"]).toEqual(["1", "2", "3", "4"]);
    expect(shown["Plan this view"]).toEqual(["P"]);
    expect(shown["Capture a thought"]).toEqual(["N"]);
    expect(shown["Check-in"]).toEqual(["M"]);
    expect(shown["Close out"]).toEqual(["E"]);
    expect(shown["Plan the week"]).toEqual(["W"]);
    expect(shown["Every action"]).toEqual(["Ctrl K"]);
    expect(shown["Next or previous client"]).toEqual(["J", "K"]);
    expect(shown["Text size"]).toEqual(KEYS.find((k) => k.command === "ui.set_text_size")!.keys);
  });
  it("every rhythm step's shortcut and every key in the copy comes from keys.ts", () => {
    for (const s of C.RHYTHM.steps) expect(() => keysFor(s.keys), s.name).not.toThrow();
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

  it("its fit words are Plan the day's for every S, M, L and unsized combination", () => {
    expect(combos.length).toBeGreaterThan(100);
    for (const c of combos) {
      const minutes = c.reduce((n, s) => n + storyMinutes(s), 0);
      const sb = sandbox(c, block);
      expect(sb.fit, c.join("")).toEqual(blockFitWords(fitOf(minutes, block.freeMinutes)));
      expect(sb.minutes, c.join("")).toBe(minutes);
    }
  });
  it("reads as the legend says: S 1h, M 2h, L 4h, unsized 2h; over is amber, never red", () => {
    expect(block.free).toBe("4h free after meetings");
    expect(sandbox(["M", "S"], block)).toMatchObject({ load: { planned: "3h", free: "4h" }, filled: 3, spill: 0, chips: ["M · 2h", "S · 1h"] });
    expect(C.SIZING.load("3h", "4h")).toBe("3h of 4h");
    expect(sandbox([null], block).chips).toEqual(["Size? · 2h"]);
    expect(sandbox([null, null], block).fit.kind).not.toBe("over");
    for (const c of [["S", "S", "S", "S"], ["M", "M"], ["L"], ["M", null]] as (StorySize | null)[][]) expect(sandbox(c, block)).toMatchObject({ filled: 4, spill: 0 });
    expect(sandbox(["L", "M"], block)).toMatchObject({ spill: 2, fit: { kind: "over", tone: "watch" } });
    expect(sandbox([], block).fit.kind).toBe("none");
    for (const c of combos) expect(sandbox(c, block).fit.tone).not.toBe("risk");
    expect(["S", "M", "L", null].map((z) => C.SIZING.add(z as StorySize | null))).toEqual(["S · 1h", "M · 2h", "L · 4h", "unsized"]);
  });
  it("the legend is exactly its four lines", () => {
    expect(C.SIZING.legend.map((l) => l.replace(/\{b:([^}]*)\}/g, "$1"))).toEqual([
      "S 1h · M 2h · L 4h",
      "Sizing is optional. An unsized story counts as 2h until you size it.",
      "Too much? It turns amber. Move something, or keep it. Your call.",
      "Features are their stories added up, or your estimate until they're sized.",
    ]);
  });
});

describe("estimates in the Guide are hours (E2)", () => {
  it("no fractions, decimals or blocks in estimate copy; a block is only named as the calendar unit", () => {
    const estimates = [C.SIZING.legend, C.SIZING.sub, C.BASICS, C.RHYTHM.steps.map((s) => s.mini)].flatMap(strings);
    for (const t of estimates) expect(t, t).not.toMatch(/½|¼|¾|\d[.,]\d|half blocks?\b|\d+ blocks?\b|\bof \d+ blocks?/);
    // "block" appears only where it names the calendar unit (a focus block, half a day), never as an amount.
    for (const t of strings(C).filter((x) => /\bblocks?\b/i.test(x))) expect(t, t).not.toMatch(/\d\s*(½\s*)?blocks?\b|blocks? (free|planned|available)/i);
  });
  it("the new questions are there", () => {
    const qs = Object.fromEntries(C.QUESTIONS.items.map((x) => [x.q, x.a]));
    expect(qs["Do I have to size everything?"]).toBe("No. Unsized stories count as 2h so the plan still adds up, and nothing waits on a size. Size them when you know.");
    expect(qs["What's a block, then?"]).toBe("Where you work: a half-day set aside for a client in Focus Time. How much work fits is measured in hours.");
    expect(C.FOOTER).toBe("FocusTime by Cooptimize. Questions or ideas? ⋯ › Send feedback, or message the FocusTime team in Teams.");
    expect(qs["How do I send an idea, a problem or a question?"]).toMatch(/^⋯ › Send feedback, .*message the FocusTime team in Teams\.$/);
  });
});

describe("the Guide's address", () => {
  it("#/guide and #/guide/<chapter> open it over Today, and write back the same", () => {
    expect(parseHash("#/guide")).toEqual({ nav: { tab: "today", mode: "now", date: null, half: null }, overlay: { kind: "guide", chapter: null } });
    for (const ch of C.CHAPTERS) {
      const l = parseHash(`#/guide/${ch.id}`)!;
      expect(l.overlay).toEqual({ kind: "guide", chapter: ch.id });
      expect(hashOf(l)).toBe(`#/guide/${ch.id}`);
    }
    expect(parseHash("#/guide/keys/x")).toBeNull();
    expect(parseHash("#/guide/K3!")).toBeNull();
  });
});

describe("example data only", () => {
  it("says so on screen", () => {
    expect(C.HERO.example).toBe("Example data");
    expect(C.RHYTHM.example).toBe("Example");
    expect(C.SIZING.block.label).toMatch(/example/i);
  });
  it("no em dashes in the copy", () => {
    for (const t of strings(C)) expect(t, t).not.toContain("—");
  });
});
