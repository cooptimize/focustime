// UI-5: the rebuilt Guide's sections. Every link opens a real place, every question has one home, every tour named
// exists, the words stay plain and within budget, no real person is named, and search finds what the Guide says.
import { isAdminSection } from "../settings/Admin.tsx";
import { describe, expect, it } from "vitest";
import { ACTIONS } from "../../actions/registry.ts";
import { hashOf, parseHash } from "../nav.ts";
import { SECTIONS as SETTINGS_SECTIONS, SETTINGS } from "../settings/registry.ts";
import * as C from "./content.ts";
import { guideIndex, searchGuide } from "./Guide.tsx";
import { plainText } from "./Rich.tsx";
import { SECTIONS } from "./sections.ts";
import { TOURS, tourById } from "./tours.ts";

const strings = (v: unknown): string[] => (typeof v === "string" ? [v] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v === "object" ? Object.values(v).flatMap(strings) : []);
const words = (v: unknown) => strings(v).map(plainText).join(" ").split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
const areaIds = Object.keys(C.AREAS) as (keyof typeof C.AREAS)[];
const allDoes = [...Object.values(C.AREAS).flatMap((a) => a.does), ...Object.values(C.FIRST_DAY.checks)];

describe("the sections", () => {
  it("are in nav order: Start here, Your first day, the four tabs, then the rest, with Renamed last", () => {
    expect(SECTIONS.map((s) => s.id)).toEqual(["start", "first-day", "today", "week", "ahead", "inbox", "capture", "assistant", "teams", "calls", "settings", "renamed"]);
    for (const s of SECTIONS) expect(C.SECTION_LINES[s.id], s.id).toBeTruthy();
    for (const id of areaIds) expect(SECTIONS.some((s) => s.id === id), id).toBe(true);
  });
  it("each area: one line on what it's for, 2 to 5 things you do, then How it works", () => {
    for (const id of areaIds) {
      const a = C.AREAS[id];
      expect(a.lead.split(/[.:]\s/).length, id).toBeLessThanOrEqual(2);
      expect(a.does.length, id).toBeGreaterThanOrEqual(2);
      expect(a.does.length, id).toBeLessThanOrEqual(5);
      expect(a.faqs.length, id).toBeGreaterThan(0);
    }
  });
  it("stays within the approved budgets (visible words; How it works is folded)", () => {
    const budget: Record<string, number> = { today: 200, week: 300, ahead: 250, inbox: 350, capture: 150, assistant: 200, teams: 150, calls: 120, settings: 200 };
    for (const id of areaIds) expect(words([C.AREAS[id].lead, C.AREAS[id].does]), id).toBeLessThanOrEqual(budget[id]! * 1.1);
    expect(words(C.START)).toBeLessThanOrEqual(300);
    // Your first day: the checklist and its seven to eight day-one questions, read open.
    const firstDay = words([C.FIRST_DAY.lead, C.FIRST_DAY.checks, C.FIRST_DAY.never]) + words(C.FIRST_DAY.faqs.map((q) => C.QUESTION_POOL.find((x) => x.q === q)!.a));
    expect(firstDay).toBeLessThanOrEqual(650 * 1.25);
    expect(C.FIRST_DAY.faqs.length).toBeGreaterThanOrEqual(5);
    expect(C.FIRST_DAY.faqs.length).toBeLessThanOrEqual(8);
    expect(words(C.RENAMED)).toBeLessThanOrEqual(120);
  });
});

describe("every question has exactly one home", () => {
  const placed = [...Object.values(C.AREAS).flatMap((a) => a.faqs), ...C.FIRST_DAY.faqs];
  it("each one asked is in the pool, once", () => {
    const pool = new Set(C.QUESTION_POOL.map((x) => x.q));
    for (const q of placed) expect(pool.has(q), q).toBe(true);
    expect(placed.length).toBe(new Set(placed).size);
    expect(C.QUESTION_POOL.length).toBe(new Set(C.QUESTION_POOL.map((x) => x.q)).size);
  });
  it("no question in the pool is lost: it's placed, or retired with where its answer went", () => {
    for (const { q } of C.QUESTION_POOL) expect(placed.includes(q) || q in C.RETIRED_QUESTIONS, q).toBe(true);
    for (const q of Object.keys(C.RETIRED_QUESTIONS)) expect(placed.includes(q), q).toBe(false);
  });
  it("Close the loop is LP-1's one entry, placed in the Inbox", () => {
    expect(C.AREAS.inbox.faqs).toContain(C.CLOSE_THE_LOOP.q);
  });
});

describe("the link checker", () => {
  it("every Open link is an address the app opens, and writes back the same", () => {
    const links = allDoes.flatMap((d) => (d.go ? [d.go.href] : []));
    expect(links.length).toBeGreaterThan(15);
    for (const href of links) {
      const l = parseHash(href);
      expect(l, href).not.toBeNull();
      expect(hashOf(l!), href).toBe(href);
    }
  });
  it("every Settings link names a section and setting in Settings' registry", () => {
    for (const href of allDoes.flatMap((d) => (d.go?.href.startsWith("#/settings") ? [d.go.href] : []))) {
      const [, , section, setting] = href.split("/");
      if (!section) continue;
      // IN-1: an Admin section (Admin › People) opens through the same address; its parts aren't in Settings' registry.
      if (isAdminSection(section)) continue;
      expect(SETTINGS_SECTIONS.some((s) => s.id === section), href).toBe(true);
      if (setting) expect(SETTINGS.find((s) => s.id === setting)?.section, href).toBe(section);
    }
  });
  it("every Show me names a tour that exists", () => {
    const named = [...allDoes.flatMap((d) => ("tour" in d && d.tour ? [d.tour] : [])), ...C.START.week.steps.flatMap((s) => (s.tour ? [s.tour] : []))];
    for (const id of named) expect(tourById(id), id).toBeDefined();
    // And every tour is offered somewhere.
    for (const t of TOURS) expect(named, t.id).toContain(t.id);
  });
  it("every tour's screens and its Guide section exist", () => {
    for (const t of TOURS) {
      expect(SECTIONS.some((s) => s.id === t.section), t.id).toBe(true);
      for (const at of [t.start, ...t.steps.flatMap((s) => (s.at ? [s.at] : []))]) expect(parseHash(hashOf({ nav: at, overlay: null })), t.id).toEqual({ nav: at, overlay: null });
    }
  });
  it("commands the Guide names are in the command menu", () => {
    const titles = new Set(ACTIONS.map((a) => a.title));
    for (const name of ["Send feedback", "Diagnostics", "Export my data", "Your first day"]) expect(titles.has(name), name).toBe(true);
    for (const t of strings(C)) for (const m of t.matchAll(/([A-Z]\w+(?: [a-z]\w+)*) in \{key:Ctrl K\}/g)) expect(titles.has(m[1]!.trim()), m[1]).toBe(true);
  });
});

describe("plain words", () => {
  const all = strings(C);
  it("no em dashes", () => {
    for (const t of all) expect(t, t).not.toContain("—");
  });
  it("no real people: never the report's sender or a developer; the example people are the fictional ones", () => {
    // The report's sender and the developer, base64 so the names guard never matches this file.
    const real = new RegExp(`\\b(${["S2F0", "VGFubmVy"].map((b) => Buffer.from(b, "base64").toString()).join("|")})\\b`);
    for (const t of all) expect(t, t).not.toMatch(real);
    const people = new Set(["Priya", "Sam", "Alex", "Jordan", "Dana"]);
    // The try-its' and tours' example people, wherever a name is the subject or the one owed.
    const named = [...strings(C.TRY), ...strings(C.TOUR_EXAMPLES)].flatMap((t) => [...t.matchAll(/\b([A-Z][a-z]+) (?:says|asked|sent)\b|\b(?:to|Reply to|from) ([A-Z][a-z]+)\b/g)].map((m) => m[1] ?? m[2]!));
    expect(named.length).toBeGreaterThan(2);
    for (const n of named.filter((n) => !["Friday", "Teams", "DevOps", "Northwind", "Harbor", "Atlas", "Cooptimize", "Mon", "Tue", "Wed", "Closed", "Active"].includes(n))) expect(people.has(n), n).toBe(true);
  });
  it("the tours and Start here use today's names", () => {
    for (const w of [...strings(TOURS), ...strings(C.START), ...strings(C.AREAS)]) expect(w, w).not.toMatch(/\b(Plan the day|Roadmap|Requests|Draft stories|Needs help from|Fix next|Sort later|picks?)\b/);
  });
});

describe("search", () => {
  const index = guideIndex();
  it("finds a section, a thing you do and a question, the title matches first", () => {
    expect(searchGuide("stale", index)[0]).toMatchObject({ section: "ahead" });
    expect(searchGuide("close the loop", index).some((h) => h.q === C.CLOSE_THE_LOOP.q)).toBe(true);
    expect(searchGuide("timeline", index).some((h) => h.section === "week")).toBe(true);
    expect(searchGuide("sort later", index)[0]).toMatchObject({ section: "renamed" });
    const hits = searchGuide("inbox", index);
    expect(hits[0]!.title.toLowerCase()).toContain("inbox");
  });
  it("needs every word, and nothing typed finds nothing", () => {
    expect(searchGuide("", index)).toEqual([]);
    expect(searchGuide("zzzz qqqq", index)).toEqual([]);
    expect(searchGuide("export xyzzy", index)).toEqual([]);
    expect(searchGuide("a", index).length).toBeLessThanOrEqual(20);
  });
});
