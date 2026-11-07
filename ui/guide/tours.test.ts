// UI-5: the tours point at hooks that exist on the real screens, open where they say, and read in the Guide's words.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hashOf, parseHash } from "../nav.ts";
import * as C from "./content.ts";
import { TOURS } from "./tours.ts";

const UI = join(import.meta.dirname, "..");
/** Every .tsx under ui/ outside the Guide (the real screens). */
const screens = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === "guide" ? [] : screens(join(dir, e.name))) : e.name.endsWith(".tsx") ? [readFileSync(join(dir, e.name), "utf8")] : []));
const source = screens(UI).join("\n");
/** The data-tour hooks the screens carry: literal ones, and the mode switch's per tab. */
const hooks = new Set([...source.matchAll(/data-tour="([a-z0-9-]+)"/g), ...[...source.matchAll(/data-tour=\{([^}]*)\}/g)].flatMap((e) => [...e[1]!.matchAll(/"([a-z0-9]+-[a-z0-9-]+)"/g)])].map((m) => m[1]!).concat([...source.matchAll(/\btour="([a-z0-9-]+)"/g)].map((m) => m[1]!)).concat(["today", "week", "ahead", "inbox"].map((t) => `modes-${t}`)));
const strings = (v: unknown): string[] => (typeof v === "string" ? [v] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v === "object" ? Object.values(v).flatMap(strings) : []);

describe("the tours", () => {
  it("every step points at a data-tour hook on a real screen, or is its example drawing", () => {
    for (const t of TOURS)
      for (const s of t.steps) {
        if (s.target) expect(hooks.has(s.target), `${t.id}: ${s.target}`).toBe(true);
        else expect(s.example, `${t.id}: ${s.title}`).toBeTruthy();
      }
  });
  it("every example drawing a step names is drawn", async () => {
    const { TOUR_EXAMPLES } = await import("./content.ts");
    const drawn = new Set(["pw-grid", "pw-carry", "pw-card", "pw-add", "pw-next", ...Object.keys(TOUR_EXAMPLES.cards)]);
    for (const t of TOURS) for (const s of t.steps) if (s.example) expect(drawn.has(s.example), `${t.id}: ${s.example}`).toBe(true);
  });
  it("seven tours, as approved", () => {
    expect(TOURS.map((t) => t.title)).toEqual(["Plan your week", "Your Board and to-dos", "Today, focus and close out", "The Inbox", "Ahead", "The assistant", "Status"]);
  });
  it("each has 4 to 7 steps, a start the address opens, and #/guide/tour/<id> round-trips", () => {
    for (const t of TOURS) {
      expect(t.steps.length).toBeGreaterThanOrEqual(4);
      expect(t.steps.length).toBeLessThanOrEqual(7);
      const l = parseHash(`#/guide/tour/${t.id}`)!;
      expect(l).toEqual({ nav: t.start, overlay: { kind: "tour", id: t.id } });
      expect(hashOf(l)).toBe(`#/guide/tour/${t.id}`);
    }
    expect(parseHash("#/guide/tour/nope")).toBeNull();
    expect(parseHash("#/guide/tour")).toBeNull();
  });
  it("Start here's Show me buttons name tours that exist", () => {
    const ids = new Set(TOURS.map((t) => t.id));
    for (const s of C.START.week.steps) if (s.tour) expect(ids.has(s.tour), s.tour).toBe(true);
  });
  it("plain words: no em dashes, and none of the old names", () => {
    const words = [...strings(TOURS), ...strings(C.START), ...strings(C.TOUR_UI), ...strings(C.TOUR_EXAMPLES)];
    for (const w of words) {
      expect(w, w).not.toContain("—");
      expect(w, w).not.toMatch(/\b(Plan the day|Roadmap|Requests|Draft stories|Needs help from|Fix next|Sort later|picks?)\b/);
    }
  });
});

describe("Start here", () => {
  it("is the first section and the default", () => {
    expect(C.SECTIONS[0]).toMatchObject({ id: "start", name: "Start here" });
    expect(parseHash("#/guide/start")?.overlay).toEqual({ kind: "guide", chapter: "start" });
  });
  it("says what FocusTime is for in three lines, the day in five steps and the week in three", () => {
    expect(C.START.why).toHaveLength(3);
    expect(C.START.day.steps).toHaveLength(5);
    expect(C.START.week.steps.map((s) => s.name)).toEqual(["Plan", "Board", "Status"]);
  });
  it("stays about 250 words", () => {
    const n = strings(C.START).join(" ").split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
    expect(n).toBeLessThanOrEqual(300);
  });
});
