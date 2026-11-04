// AI-0: structured output only. Every task's schema must be one OpenAI's strict mode takes (every object lists all its
// properties in required and sets additionalProperties: false; the root is an object), and every answer is checked
// against it here before anyone sees it. No dependency: the subset is small.
import type { JsonSchema, JsonType } from "./types.ts";

/** Why a schema can't be used in strict mode, or [] when it can. */
export function strictProblems(s: JsonSchema, path = "$"): string[] {
  const out: string[] = [];
  const types = s.type === undefined ? [] : Array.isArray(s.type) ? s.type : [s.type];
  if (path === "$" && (types.length !== 1 || types[0] !== "object")) out.push("$: the root must be an object");
  if (types.includes("object")) {
    const props = Object.keys(s.properties ?? {});
    if (s.additionalProperties !== false) out.push(`${path}: additionalProperties must be false`);
    const req = new Set(s.required ?? []);
    for (const p of props) if (!req.has(p)) out.push(`${path}.${p}: every property must be required (use a null type for optional)`);
    for (const r of req) if (!props.includes(r)) out.push(`${path}: required names ${r}, which isn't a property`);
  }
  for (const [k, v] of Object.entries(s.properties ?? {})) out.push(...strictProblems(v, `${path}.${k}`));
  if (s.items) out.push(...strictProblems(s.items, `${path}[]`));
  for (const [i, a] of (s.anyOf ?? []).entries()) out.push(...strictProblems(a, `${path}|${i}`));
  if (!types.length && !s.anyOf && !s.enum) out.push(`${path}: needs a type, anyOf or enum`);
  return out;
}

const typeOf = (v: unknown): JsonType => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v === "number" ? (Number.isInteger(v) ? "integer" : "number") : (typeof v as JsonType));
const fits = (v: unknown, t: JsonType) => (t === "number" ? typeof v === "number" && Number.isFinite(v) : typeOf(v) === t);

/** Where a value doesn't fit the schema (paths, never the values), or [] when it fits. */
export function validate(v: unknown, s: JsonSchema, path = "$"): string[] {
  if (s.anyOf) return s.anyOf.some((a) => !validate(v, a, path).length) ? [] : [`${path}: matches none of anyOf`];
  const types = s.type === undefined ? [] : Array.isArray(s.type) ? s.type : [s.type];
  if (types.length && !types.some((t) => fits(v, t))) return [`${path}: expected ${types.join(" or ")}`];
  if (s.enum && !s.enum.some((e) => e === v)) return [`${path}: not one of the allowed values`];
  const out: string[] = [];
  if (typeof v === "string" && s.pattern && !new RegExp(s.pattern, "u").test(v)) out.push(`${path}: doesn't match the pattern`);
  if (typeof v === "number") {
    if (s.minimum !== undefined && v < s.minimum) out.push(`${path}: below ${s.minimum}`);
    if (s.maximum !== undefined && v > s.maximum) out.push(`${path}: above ${s.maximum}`);
  }
  if (Array.isArray(v)) {
    if (s.minItems !== undefined && v.length < s.minItems) out.push(`${path}: fewer than ${s.minItems} items`);
    if (s.maxItems !== undefined && v.length > s.maxItems) out.push(`${path}: more than ${s.maxItems} items`);
    if (s.items) v.forEach((x, i) => out.push(...validate(x, s.items!, `${path}[${i}]`)));
  }
  if (typeOf(v) === "object" && (s.properties || s.required)) {
    const o = v as Record<string, unknown>;
    for (const r of s.required ?? []) if (!(r in o)) out.push(`${path}.${r}: missing`);
    for (const [k, x] of Object.entries(o)) {
      const ps = s.properties?.[k];
      if (ps) out.push(...validate(x, ps, `${path}.${k}`));
      else if (s.additionalProperties === false) out.push(`${path}.${k}: not allowed`);
    }
  }
  return out;
}

/** A value that fits the schema, made from it alone: the stub provider's answer (first enum value, empty strings). */
export function sampleOf(s: JsonSchema): unknown {
  if (s.enum) return s.enum[0];
  if (s.anyOf) return sampleOf(s.anyOf[0]!);
  const t = Array.isArray(s.type) ? (s.type.find((x) => x !== "null") ?? "null") : s.type;
  switch (t) {
    case "object":
      return Object.fromEntries(Object.entries(s.properties ?? {}).map(([k, v]) => [k, sampleOf(v)]));
    case "array":
      return s.items && s.minItems ? Array.from({ length: s.minItems }, () => sampleOf(s.items!)) : [];
    case "string":
      return "";
    case "number":
    case "integer":
      return s.minimum ?? 0;
    case "boolean":
      return false;
    default:
      return null;
  }
}
