// CP-1: the prepare request's schema, input and answer checks, and the words a draft row shows.
import { describe, expect, it } from "vitest";
import { strictProblems, validate } from "../ai/schema.ts";
import { draftRowState, draftRowText, offeredTypes, prepareInput, prepareSchema, toDraftAi, WRITING_MS, type PrepareAnswer } from "./capture-prepare.ts";
import type { DraftAi } from "./types.ts";

const NOW = "2026-11-05T15:00:00Z";
const answer = (o: Partial<PrepareAnswer> = {}): PrepareAnswer => ({ title: "Export invoices as CSV", description: "Finance wants a spreadsheet.", acceptance_criteria: "- A CSV button", type: "User Story", parent_id: 437, parent_reason: "The export feature", ...o });
const ai = (o: Partial<DraftAi> = {}): DraftAi => ({ state: "ready", title: "T", description: null, acceptance: null, type: null, parentId: 437, parentReason: null, note: null, ranAt: NOW, ...o });

describe("capture.prepare request (CP-1)", () => {
  it("the schema is strict and allows only the offered types and parents", () => {
    const s = prepareSchema(["User Story", "Bug"], [437, 438]);
    expect(strictProblems(s)).toEqual([]);
    expect(validate(answer(), s)).toEqual([]);
    expect(validate(answer({ type: null, parent_id: null }), s)).toEqual([]);
    expect(validate(answer({ type: "Epic" }), s)).not.toEqual([]);
    expect(validate(answer({ parent_id: 999 }), s)).not.toEqual([]);
    // Nothing offered: only null fits.
    const none = prepareSchema([], []);
    expect(strictProblems(none)).toEqual([]);
    expect(validate(answer(), none)).not.toEqual([]);
    expect(validate(answer({ type: null, parent_id: null }), none)).toEqual([]);
  });

  it("the input carries the note, the offered parents and examples, clipped", () => {
    const input = JSON.parse(prepareInput({ level: "story", clientName: "Contoso", note: "x".repeat(2000), title: "csv", types: ["User Story"], candidates: Array.from({ length: 80 }, (_, i) => ({ id: i + 1, title: `F${i}`, type: "Feature" })), examples: Array.from({ length: 9 }, (_, i) => ({ title: `E${i}`, summary: "s" })), style: null })) as { note: string; offered_parents: unknown[]; examples: unknown[]; house_style: null };
    expect(input.note.length).toBe(1000);
    expect(input.offered_parents).toHaveLength(60);
    expect(input.examples).toHaveLength(5);
    expect(input.house_style).toBeNull();
  });

  it("offered types: the children the parents take at the draft's level, the default first", () => {
    const childrenOf = (t: string) => (t === "Feature" ? ["User Story", "Bug"] : t === "Epic" ? ["Feature"] : []);
    expect(offeredTypes({ level: "story", levelTypes: ["User Story", "Bug", "Spike"], childrenOf, parentTypes: ["Feature"], defaultType: "Bug" })).toEqual(["Bug", "User Story"]);
    expect(offeredTypes({ level: "story", levelTypes: ["User Story", "Spike"], childrenOf, parentTypes: [], defaultType: null })).toEqual(["User Story", "Spike"]);
    expect(offeredTypes({ level: "feature", levelTypes: ["Feature"], childrenOf, parentTypes: ["Epic"], defaultType: null })).toEqual(["Feature"]);
  });

  it("an answer becomes the AI version: ready with a parent, needs a parent without, refused when not offered", () => {
    const o = { level: "story" as const, types: ["User Story"], candidateIds: [437], hasParent: false, ranAt: NOW };
    expect(toDraftAi(answer(), o)).toMatchObject({ state: "ready", parentId: 437, acceptance: "- A CSV button" });
    expect(toDraftAi(answer({ parent_id: null }), o)).toMatchObject({ state: "needs_parent" });
    expect(toDraftAi(answer({ parent_id: null }), { ...o, hasParent: true })).toMatchObject({ state: "ready" });
    expect(toDraftAi(answer({ title: "  " }), o)).toEqual({ problem: "empty title" });
    expect(toDraftAi(answer({ type: "Epic" }), o)).toEqual({ problem: "type not offered" });
    expect(toDraftAi(answer(), { ...o, level: "feature" })).toMatchObject({ acceptance: null });
  });
});

describe("draft row states (CP-1)", () => {
  const d = (o: { parentItemId?: number | null; ai?: DraftAi | null } = {}) => ({ parentItemId: null, ai: null, ...o });
  it("says what the draft needs next", () => {
    const at = { canWrite: true, now: NOW };
    expect(draftRowState(d({ ai: ai() }), { ...at, canWrite: false })).toBe("no_pat");
    expect(draftRowText("no_pat", d(), "Northwind")).toBe("Add a write PAT for Northwind");
    expect(draftRowState(d({ ai: ai() }), at)).toBe("ready");
    expect(draftRowText("ready", d(), "Northwind")).toBe("Ready to create");
    expect(draftRowState(d({ ai: ai({ state: "needs_parent", parentId: null }) }), at)).toBe("needs_parent");
    expect(draftRowState(d({ parentItemId: 438, ai: ai({ state: "needs_parent", parentId: null }) }), at)).toBe("ready");
    expect(draftRowState(d({ ai: ai({ state: "writing", ranAt: NOW }) }), at)).toBe("writing");
    expect(draftRowText("writing", d(), "Northwind")).toBe("AI still writing…");
    expect(draftRowState(d({ ai: ai({ state: "off" }) }), at)).toBe("plain");
    expect(draftRowText("plain", d({ ai: ai({ state: "off" }) }), "Northwind")).toBe("AI off: plain draft · needs a parent");
    expect(draftRowText("plain", d({ parentItemId: 5 }), "Northwind")).toBe("AI off: plain draft");
  });

  it("a writing left by a lost request reads as a plain draft", () => {
    const late = Temporal.Instant.from(NOW).add({ milliseconds: WRITING_MS + 1 }).toString();
    expect(draftRowState(d({ ai: ai({ state: "writing", ranAt: NOW }) }), { canWrite: true, now: late })).toBe("plain");
  });
});


describe("KB-1: the standards on a captured draft", () => {
  const used = { commit: "0123456789abcdef0123456789abcdef01234567", used: [{ title: "Gold Fact Tables", url: "https://github.com/contoso/standards/blob/x/SQL/Gold/Fact%20Tables.md" }], leftOut: [], overrides: [], notes: [] };
  const ans = { title: "Write Silver SQL for sales", description: "Why", acceptance_criteria: "- Follows Gold Fact Tables: fact schema\n- Follows Made Up: x\n- Totals match", type: null, parent_id: null, parent_reason: "None fits", standards_note: "Client override: Gold Fact Tables: the client asked for snake_case" };
  const base = { types: [], candidateIds: [], hasParent: true, ranAt: "2026-11-08T15:00:00Z" };
  it("links citations, rewords Silver, states the override and keeps the record", () => {
    const d = toDraftAi(ans, { ...base, level: "story", standards: used }) as DraftAi;
    expect(d.title).toBe("Configure or regenerate Silver for sales");
    expect(d.acceptance).toBe(`- Follows Gold Fact Tables: fact schema (${used.used[0]!.url})\n- Totals match`);
    expect(d.standards?.overrides).toEqual(["Client override: Gold Fact Tables: the client asked for snake_case"]);
    expect(d.standards?.notes).toHaveLength(1);
  });
  it("keeps a feature's Follows lines only when standards were sent", () => {
    expect((toDraftAi({ ...ans, title: "T" }, { ...base, level: "feature", standards: used }) as DraftAi).acceptance).toContain("Follows Gold Fact Tables");
    expect((toDraftAi({ ...ans, title: "T" }, { ...base, level: "feature" }) as DraftAi).acceptance).toBeNull();
  });
  it("asks for standards_note only when standards go with the request", () => {
    expect(prepareSchema([], [], { standards: true }).required).toContain("standards_note");
    expect(prepareSchema([], []).required).not.toContain("standards_note");
  });
});
