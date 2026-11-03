// G1: the Guide's keys are ui/keys.ts's, its sandbox is the app's own fit math, and its address round-trips.
import { describe, expect, it } from "vitest";
import { DEFAULT_PLAN } from "../../config/schema.ts";
import { blocksNumber, STORY_QUARTERS, type StorySize } from "../../plan/estimate.ts";
import { blockFitWords } from "../../plan/fit.ts";
import { fitOf } from "../../plan/rules.ts";
import { KEYS } from "../keys.ts";
import { hashOf, parseHash } from "../nav.ts";
import * as C from "./content.ts";
import { blockMinutes, sandbox } from "./sandbox.ts";
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
    expect(marked.length).toBeGreaterThan(3);
    for (const t of marked) expect(() => richParts(t), t).not.toThrow();
    // No key is typed into the copy as a bare <kbd> or "press X".
    for (const t of strings(C)) expect(t, t).not.toMatch(/<kbd>|\bpress [A-Z]\b/i);
  });
  it("? opens the Guide, and the legend still lists every key", () => {
    expect(KEYS.find((k) => k.keys[0] === "?")).toMatchObject({ command: "ui.guide" });
  });
});

describe("the sizing sandbox uses plan/fit.ts", () => {
  const block = C.SIZING.block;
  const sizes: StorySize[] = ["S", "M", "L"];
  /** Every multiset of up to five stories. */
  const combos: StorySize[][] = [[]];
  for (let n = 1; n <= 5; n++) for (const c of combos.filter((x) => x.length === n - 1)) for (const s of sizes) if (!c.length || sizes.indexOf(s) >= sizes.indexOf(c.at(-1)!)) combos.push([...c, s]);

  it("its fit words are Plan the day's for every S, M and L combination", () => {
    expect(combos.length).toBeGreaterThan(50);
    for (const c of combos) {
      const minutes = c.reduce((n, s) => n + DEFAULT_PLAN.sizes[s], 0);
      const sb = sandbox(c, block);
      expect(sb.fit, c.join("")).toEqual(blockFitWords(fitOf(minutes, blockMinutes(block))));
      expect(sb.blocks, c.join("")).toBe(blocksNumber(c.reduce((n, s) => n + STORY_QUARTERS[s], 0)));
    }
  });
  it("reads as the legend says: four S, two M or one L fill the block; more spills over in amber, never red", () => {
    for (const c of [["S", "S", "S", "S"], ["M", "M"], ["L"]] as StorySize[][]) {
      const sb = sandbox(c, block);
      expect(sb).toMatchObject({ quarters: 4, filled: 4, spill: 0, blocks: "1" });
      expect(sb.fit.kind, c.join("")).not.toBe("over");
    }
    expect(sandbox(["L", "M"], block)).toMatchObject({ spill: 2, blocks: "1½", fit: { kind: "over", tone: "watch", text: "About 1h over" } });
    expect(sandbox(["M", "S"], block).fit).toEqual({ kind: "room", text: "Fits · 1h 30m spare", tone: "neutral" });
    expect(sandbox([], block).fit.kind).toBe("none");
    for (const c of combos) expect(sandbox(c, block).fit.tone).not.toBe("risk");
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
