// AI-0: structured output only. A schema must be one strict mode takes; an answer must fit it, or it is never used.
import { describe, expect, it } from "vitest";
import { sampleOf, strictProblems, validate } from "./schema.ts";
import type { JsonSchema } from "./types.ts";

const S: JsonSchema = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["bug", "request"] },
    title: { type: "string" },
    hours: { type: ["integer", "null"], minimum: 1, maximum: 80 },
    tags: { type: "array", items: { type: "string" }, maxItems: 3 },
    parent: { type: "object", properties: { id: { type: "integer" } }, required: ["id"], additionalProperties: false },
  },
  required: ["kind", "title", "hours", "tags", "parent"],
  additionalProperties: false,
};

describe("strict schemas", () => {
  it("a strict schema has no problems", () => expect(strictProblems(S)).toEqual([]));
  it.each<[string, JsonSchema]>([
    ["the root isn't an object", { type: "array", items: { type: "string" } } as JsonSchema],
    ["a property isn't required", { ...S, required: ["kind"] }],
    ["additionalProperties isn't false", (({ additionalProperties: _a, ...rest }) => rest)(S) as JsonSchema],
    ["a nested object isn't strict", { ...S, properties: { ...S.properties, parent: { type: "object", properties: { id: { type: "integer" } }, required: [] } } }],
  ])("%s", (_why, s) => expect(strictProblems(s).length).toBeGreaterThan(0));
});

describe("answers", () => {
  const ok = { kind: "bug", title: "Export fails", hours: null, tags: ["export"], parent: { id: 7 } };
  it("an answer that fits", () => expect(validate(ok, S)).toEqual([]));
  it.each([
    ["a value not in the enum", { ...ok, kind: "incident" }],
    ["a missing field", (({ title: _t, ...rest }) => rest)(ok)],
    ["an extra field", { ...ok, extra: 1 }],
    ["a wrong type", { ...ok, title: 3 }],
    ["a number out of range", { ...ok, hours: 81 }],
    ["a fraction where a whole number is needed", { ...ok, hours: 2.5 }],
    ["too many items", { ...ok, tags: ["a", "b", "c", "d"] }],
    ["a nested object that doesn't fit", { ...ok, parent: { id: "7" } }],
    ["not an object at all", "ok"],
  ])("%s doesn't fit", (_why, v) => expect(validate(v, S).length).toBeGreaterThan(0));
  it("problems name paths, never values", () => {
    expect(validate({ ...ok, title: 3 }, S)).toEqual(["$.title: expected string"]);
  });
  it("the stub's sample fits its schema", () => expect(validate(sampleOf(S), S)).toEqual([]));
});
