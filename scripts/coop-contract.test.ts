// CX-0: the FocusTime and Coop comment contract v1 (docs/technical/coop-contract.md). Every example fixture is checked
// against its JSON Schema, and every comment fixture is parsed by the rules on that page, so Coop can copy
// docs/technical/coop-contract/ for its own contract test. The validator below is here because the repo has no JSON
// Schema library (CX-0 adds no dependency); it throws on a keyword it doesn't implement, so a schema can't carry a
// rule nobody enforces. Any draft 2020-12 validator gives the same answers.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SECRET_SHAPES } from "../ai/guard.ts";
import { validate as validateStrict } from "../ai/schema.ts";
import { coopLine, COOP_PROPOSALS_V1, proposalProblems, PROPOSAL_ID, type CoopProposals } from "../plan/stories.ts";
import { isCoopComment } from "../plan/status-report.ts";
import { aProposalsAnswer } from "../test/builders/index.ts";

const DIR = join(import.meta.dirname, "../docs/technical/coop-contract");
const read = (p: string) => readFileSync(join(DIR, p), "utf8");
const json = (p: string) => JSON.parse(read(p)) as Record<string, unknown>;
const names = (p: string) => readdirSync(join(DIR, p), { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name);

type Schema = Record<string, unknown>;
const SCHEMAS: Record<string, Schema> = Object.fromEntries(["brief", "update", "answer", "proposal"].map((n) => [`${n}.schema.json`, json(`${n}.schema.json`)]));
const BY_KIND: Record<string, string> = { coop_brief: "brief.schema.json", coop_update: "update.schema.json", coop_answer: "answer.schema.json", story_proposals: "proposal.schema.json" };

const NOTES = new Set(["$schema", "$id", "title", "description"]);
const typeOf = (v: unknown) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);
const fits = (v: unknown, t: string) => (t === "integer" ? Number.isInteger(v) : typeOf(v) === t);

function check(v: unknown, s: Schema, path = "$"): string[] {
  const out: string[] = [];
  for (const [k, a] of Object.entries(s) as [string, never][]) {
    if (NOTES.has(k) || k === "then") continue;
    const str = typeof v === "string" ? v : null;
    const arr = Array.isArray(v) ? (v as unknown[]) : null;
    const obj = typeOf(v) === "object" ? (v as Record<string, unknown>) : null;
    switch (k) {
      case "type": if (![a as string | string[]].flat().some((t) => fits(v, t))) out.push(`${path}: type`); break;
      case "const": if (v !== a) out.push(`${path}: const`); break;
      case "enum": if (!(a as unknown[]).includes(v)) out.push(`${path}: enum`); break;
      case "pattern": if (str !== null && !new RegExp(a as string, "u").test(str)) out.push(`${path}: pattern`); break;
      case "minLength": if (str !== null && [...str].length < a) out.push(`${path}: minLength`); break;
      case "maxLength": if (str !== null && [...str].length > a) out.push(`${path}: maxLength`); break;
      case "minimum": if (typeof v === "number" && v < a) out.push(`${path}: minimum`); break;
      case "maximum": if (typeof v === "number" && v > a) out.push(`${path}: maximum`); break;
      case "minItems": if (arr && arr.length < a) out.push(`${path}: minItems`); break;
      case "maxItems": if (arr && arr.length > a) out.push(`${path}: maxItems`); break;
      case "uniqueItems": if (arr && a && new Set(arr.map((x) => JSON.stringify(x))).size !== arr.length) out.push(`${path}: uniqueItems`); break;
      case "items": if (arr) arr.forEach((x, i) => out.push(...check(x, a as Schema, `${path}[${i}]`))); break;
      case "required": if (obj) for (const r of a as string[]) if (!(r in obj)) out.push(`${path}.${r}: required`); break;
      case "properties": if (obj) for (const [p, ps] of Object.entries(a as Record<string, Schema>)) if (p in obj) out.push(...check(obj[p], ps, `${path}.${p}`)); break;
      case "allOf": for (const x of a as Schema[]) out.push(...check(v, x, path)); break;
      case "if": if (!check(v, a as Schema, path).length && s.then) out.push(...check(v, s.then as Schema, path)); break;
      case "$ref": out.push(...check(v, SCHEMAS[a as string]!, path)); break;
      default: throw new Error(`The test's validator doesn't implement "${k}"`);
    }
  }
  return out;
}

// ---------- the page's parsing rules, as a reference for both sides ----------

const HEADER = /^\[Coop (brief|update|answer) v([0-9]+)\] \S.{0,199}$/u;
const FOOTER = /^Coop-Proposal: ([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/([A-Za-z0-9_-]{1,16})$/mu;
const MAX_COMMENT = 32_000;
const KNOWN_MAJOR = "1";

/** A comment stored as HTML, as text with its lines kept. Decoded once, and the whole of it. */
function fromHtml(html: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|pre|li)\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#[0-9]+|[a-z]+);/gi, (m, e: string) => (e[0] === "#" ? String.fromCodePoint(Number(e.slice(1))) : (named[e.toLowerCase()] ?? m)));
}

type Parsed = { ok: true; word: string; body: Record<string, unknown> } | { ok: false; why: "not_contract" | "too_long" | "unknown_major" | "no_block" | "bad_json" | "kind_mismatch" };

function parseComment(raw: string, format: "markdown" | "html" = "markdown"): Parsed {
  if (raw.length > MAX_COMMENT) return { ok: false, why: "too_long" };
  const lines = (format === "html" ? fromHtml(raw) : raw).split(/\r?\n/);
  const at = lines.findIndex((l) => l.trim() !== "");
  const head = at < 0 ? null : HEADER.exec(lines[at]!.trim());
  if (!head) return { ok: false, why: "not_contract" };
  if (head[2] !== KNOWN_MAJOR) return { ok: false, why: "unknown_major" };
  const open = lines.findIndex((l, i) => i > at && l.trim() === "```json");
  const close = open < 0 ? -1 : lines.findIndex((l, i) => i > open && l.trim() === "```");
  if (close < 0) return { ok: false, why: "no_block" };
  let body: unknown;
  try {
    body = JSON.parse(lines.slice(open + 1, close).join("\n"));
  } catch {
    return { ok: false, why: "bad_json" };
  }
  if (typeOf(body) !== "object" || (body as { kind?: unknown }).kind !== `coop_${head[1]}`) return { ok: false, why: "kind_mismatch" };
  return { ok: true, word: head[1]!, body: body as Record<string, unknown> };
}

/** What a schema can't say about an update. */
function updateProblems(u: { proposal_ids: string[]; question_ids: string[]; questions?: { id: string }[]; proposals?: { proposals: { id: string }[] } }): string[] {
  const same = (a: readonly string[], b: readonly string[]) => [...a].sort().join() === [...b].sort().join();
  const out: string[] = [];
  if (u.proposals && !same(u.proposal_ids, u.proposals.proposals.map((p) => p.id))) out.push("proposal_ids");
  if (u.questions ? !same(u.question_ids, u.questions.map((q) => q.id)) : u.question_ids.length > 0) out.push("question_ids");
  return out;
}

const FORBIDDEN: readonly [string, RegExp][] = [
  ...SECRET_SHAPES,
  ["sql", /\b(select\s.+\sfrom|insert\s+into|delete\s+from|create\s+table|drop\s+table|update\s+\S+\s+set)\b/i],
  ["code", /```|=>|\bfunction\s*\(|\bclass\s+\w+\s*[{:]|;\s*$/],
  ["file_path", /[A-Za-z]:\\|(^|\s)\.{0,2}\/[\w.-]+\/[\w.-]+|\b[\w-]+\.(sql|py|ts|js|cs|ps1|sh|ipynb|bicep)\b/],
  ["server_name", /\b[\w-]+\.(database\.windows\.net|cloudapp\.azure\.com|corp|internal|local)\b/i],
];
const stringsIn = (v: unknown): string[] => (typeof v === "string" ? [v] : Array.isArray(v) ? v.flatMap(stringsIn) : v && typeof v === "object" ? Object.values(v).flatMap(stringsIn) : []);

// ---------- the tests ----------

const VALID = names("fixtures").filter((n) => n.endsWith(".json"));
const COMMENTS = names("fixtures/comments").filter((n) => n.endsWith(".txt"));

describe("CX-0 fixtures against the schemas", () => {
  it.each(VALID)("%s is valid", (n) => {
    const v = json(`fixtures/${n}`);
    expect(check(v, SCHEMAS[BY_KIND[v.kind as string]!]!)).toEqual([]);
  });

  it.each(names("fixtures/invalid"))("%s is refused", (n) => {
    const v = json(`fixtures/invalid/${n}`);
    expect(check(v, SCHEMAS[`${n.split("-")[0]}.schema.json`]!).length).toBeGreaterThan(0);
  });

  it("accepts an added optional field and refuses an unknown major version", () => {
    const added = json("fixtures/update-added-field.json");
    expect(added.future_optional_field).toBeDefined();
    expect(check(added, SCHEMAS["update.schema.json"]!)).toEqual([]);
    expect(check({ ...added, version: 2 }, SCHEMAS["update.schema.json"]!)).toContain("$.version: const");
  });

  it("has no real-looking content: no secrets, SQL, code, paths or server names", () => {
    const hits = VALID.flatMap((n) => stringsIn(json(`fixtures/${n}`)).flatMap((s) => FORBIDDEN.filter(([, re]) => re.test(s)).map(([what]) => `${n}: ${what}`)));
    expect(hits).toEqual([]);
  });

  it("keeps each JSON example on the page valid", () => {
    const page = read("../coop-contract.md").replace(/^````text\n[\s\S]*?^````$/gm, ""); // the layout example isn't JSON
    const blocks = [...page.matchAll(/^```json\n([\s\S]*?)^```$/gm)].map((m) => JSON.parse(m[1]!) as Record<string, unknown>);
    expect(blocks.length).toBeGreaterThanOrEqual(4);
    for (const b of blocks) expect(check(b, SCHEMAS[BY_KIND[b.kind as string]!]!)).toEqual([]);
  });
});

describe("CX-0 comments", () => {
  it.each(COMMENTS)("%s parses to its JSON fixture", (n) => {
    const r = parseComment(read(`fixtures/comments/${n}`));
    expect(r).toMatchObject({ ok: true });
    expect(r.ok && r.body).toEqual(json(`fixtures/${n.replace(".txt", ".json")}`));
  });

  it("reads a comment DevOps stored as HTML", () => {
    const r = parseComment(read("fixtures/comments/update-received.html"), "html");
    expect(r.ok && r.body).toEqual(json("fixtures/update-received.json"));
  });

  it("ignores the words around the block", () => {
    const c = read("fixtures/comments/answer.txt");
    const noisy = c.replace("\n\n```json", "\nA note for people reading this.\n\n```json").concat("\nSent from FocusTime\n\n```json\n{ \"ignored\": true }\n```\n");
    expect(parseComment(noisy)).toEqual(parseComment(c));
  });

  it("refuses what isn't the format", () => {
    const c = read("fixtures/comments/answer.txt");
    expect(parseComment(`Quoting Ada:\n${c}`)).toEqual({ ok: false, why: "not_contract" });
    expect(parseComment(c.replace("[Coop answer v1]", "[coop answer v1]"))).toEqual({ ok: false, why: "not_contract" });
    expect(parseComment(c.replace("[Coop answer v1]", "[Coop answer v2]"))).toEqual({ ok: false, why: "unknown_major" });
    expect(parseComment(c.replace("[Coop answer v1]", "[Coop update v1]"))).toEqual({ ok: false, why: "kind_mismatch" });
    expect(parseComment("[Coop answer v1] No block here")).toEqual({ ok: false, why: "no_block" });
    expect(parseComment(c.replace('"answer":', '"answer"'))).toEqual({ ok: false, why: "bad_json" });
    expect(parseComment(`${c}${" ".repeat(MAX_COMMENT)}`)).toEqual({ ok: false, why: "too_long" });
  });

  it("holds what the schema can't: ids match their content, across every update", () => {
    for (const n of VALID.filter((x) => x.startsWith("update-"))) expect(updateProblems(json(`fixtures/${n}`) as never)).toEqual([]);
    const done = json("fixtures/update-done.json");
    expect(updateProblems({ ...done, proposal_ids: ["P1"] } as never)).toEqual(["proposal_ids"]);
  });

  it("finds a published story's proposal id in its description", () => {
    const m = FOOTER.exec(fromHtml(read("fixtures/story-description.html")));
    const brief = json("fixtures/brief.json");
    expect(m?.[1]).toBe(brief.brief_id);
    expect(m?.[2]).toBe("P1");
  });

  it("gives FocusTime's existing readers one line for a brief and an update", () => {
    expect(coopLine(read("fixtures/comments/update-blocked.txt"))).toBe("[Coop update v1] blocked: Need to know how far back the export goes.");
    expect(isCoopComment(read("fixtures/comments/brief.txt"))).toBe(true);
    expect(isCoopComment(read("fixtures/comments/update-received.html"))).toBe(true);
  });
});

describe("CX-0 proposal v1 stays FocusTime's shared schema", () => {
  type Strict = { properties: Record<string, Strict>; required: string[]; items: Strict; maxItems?: number; enum?: unknown[]; pattern?: string };
  const strict = COOP_PROPOSALS_V1 as unknown as Strict;
  const wire = SCHEMAS["proposal.schema.json"] as unknown as Strict;

  it("has the same fields, required lists, sizes and id format", () => {
    const shape = (s: Strict) => ({ fields: Object.keys(s.properties).sort(), required: [...s.required].sort() });
    expect(shape(wire)).toEqual(shape(strict));
    for (const list of ["proposals", "set_aside"]) {
      expect(shape(wire.properties[list]!.items)).toEqual(shape(strict.properties[list]!.items));
      expect(wire.properties[list]!.maxItems).toBe(strict.properties[list]!.maxItems);
    }
    const [w, s] = [wire.properties.proposals!.items.properties, strict.properties.proposals!.items.properties];
    expect(w.id!.pattern).toBe(PROPOSAL_ID);
    expect(w.size!.enum).toEqual(s.size!.enum);
    for (const f of ["acceptance_criteria", "depends_on", "evidence", "open_questions"]) expect(w[f]!.maxItems).toBe(s[f]!.maxItems);
  });

  it("passes FocusTime's own checks, and FocusTime's answers pass the contract", () => {
    const fx = json("fixtures/proposal.json");
    expect(validateStrict(fx, COOP_PROPOSALS_V1)).toEqual([]);
    expect(proposalProblems(fx as unknown as CoopProposals, { featureId: 240, childIds: [241] })).toEqual([]);
    expect(check(aProposalsAnswer(), wire as unknown as Schema)).toEqual([]);
  });

  it("is embedded unchanged in the done update", () => {
    expect(json("fixtures/update-done.json").proposals).toEqual(json("fixtures/proposal.json"));
  });
});
