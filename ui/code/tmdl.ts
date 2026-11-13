// RB-1 D10: TMDL (the Tabular Model Definition Language Power BI and Fabric keep semantic models in) has no grammar in
// the coloring library, so this is a small one: object keywords (model, table, column, measure, partition,
// relationship, role and the like), names, properties, annotations and descriptions, and the expression after "="
// handed to DAX or Power Query (M) by what it belongs to: a measure, a calculated column, a calculation item, a
// table permission or a calculated partition's source is DAX; an M partition's source and a shared expression are M.
// A multi-line expression is every following line indented deeper than the line that opened it.
//
// It only ever cuts the text into pieces: joined back, the pieces are exactly the file's characters, in order.

/** A token tree like the coloring library's (strings and typed pieces), so one renderer draws both. */
export type Piece = string | { type: string; content: Piece[] };
export type Embed = (code: string, lang: "dax" | "powerquery") => Piece[];

const OBJECTS = "model|database|table|column|measure|partition|relationship|role|hierarchy|level|calculationGroup|calculationItem|perspective|perspectiveTable|perspectiveColumn|perspectiveMeasure|perspectiveHierarchy|culture|cultureInfo|translation|linguisticMetadata|expression|annotation|extendedProperty|dataSource|tablePermission|columnPermission|member|formatStringDefinition|detailRowsDefinition|alternateOf|refreshPolicy|queryGroup|variation|function|calendar|ref|createOrReplace";
const DECL = new RegExp(`^(\\s*)((?:(?:createOrReplace|ref)\\s+)?)(${OBJECTS})\\b(?!\\s*:)(.*)$`);
const DAX_OBJECTS = new Set(["measure", "column", "calculationItem", "tablePermission", "formatStringDefinition", "detailRowsDefinition", "member"]);
const PARTITION_KINDS = /^(m|calculated|entity|policyRange|calculationGroup|query)$/;

const t = (type: string, text: string): Piece[] => (text ? [{ type, content: [text] }] : []);
const s = (text: string): Piece[] => (text ? [text] : []);
const indentOf = (line: string) => /^[\t ]*/.exec(line)![0].replace(/ {4}/g, "\t").length;

/** A property value: true/false, a number, a quoted or plain string. */
function value(v: string): Piece[] {
  const m = /^(\s*)(.*?)(\s*)$/.exec(v)!;
  const [, a = "", body = "", b = ""] = m;
  if (!body) return s(v);
  const type = /^(true|false)$/.test(body) ? "boolean" : /^-?\d+(\.\d+)?$/.test(body) ? "number" : "string";
  return [...s(a), ...t(type, body), ...s(b)];
}

/** A name: 'Quoted name' or a bare one, with any .'part' after it. */
function name(rest: string): { pieces: Piece[]; after: string } {
  const m = /^(\s*)((?:'(?:[^']|'')*'|[^\s=:'][^=:]*?)(?:\.(?:'(?:[^']|'')*'|[^\s=.:]+))*)(?=\s*(?:=|$))/.exec(rest);
  if (!m || !m[2]) return { pieces: [], after: rest };
  return { pieces: [...s(m[1]!), ...t("class-name", m[2])], after: rest.slice(m[0].length) };
}

export function tmdlTokens(text: string, embed: Embed): Piece[] {
  const out: Piece[] = [];
  const lines = text.split(/(?<=\n)/);
  /** The language of the next expression block (set by the object that opened it), and whether a partition is M. */
  let objectLang: "dax" | "powerquery" | null = null;
  let partition: "dax" | "powerquery" | null = null;
  let i = 0;
  const block = (fromIndent: number, lang: "dax" | "powerquery" | null) => {
    // Every following line indented deeper (or blank) belongs to the expression.
    let j = i + 1;
    let end = j;
    while (j < lines.length) {
      const l = lines[j]!;
      if (l.trim() === "") {
        j++;
        continue;
      }
      if (indentOf(l) <= fromIndent) break;
      j++;
      end = j;
    }
    if (end > i + 1) {
      const code = lines.slice(i + 1, end).join("");
      out.push(...(lang ? embed(code, lang) : s(code)));
      i = end - 1;
    }
  };
  for (; i < lines.length; i++) {
    const raw = lines[i]!;
    const nl = raw.endsWith("\n") ? (raw.endsWith("\r\n") ? "\r\n" : "\n") : "";
    const line = nl ? raw.slice(0, -nl.length) : raw;
    const ind = indentOf(line);
    const lead = /^[\t ]*/.exec(line)![0];
    const body = line.slice(lead.length);
    if (body.startsWith("///") || body.startsWith("//")) {
      out.push(...s(lead), ...t("comment", body), ...s(nl));
      continue;
    }
    const d = DECL.exec(line);
    if (d) {
      const [, sp = "", pre = "", kw = "", rest0 = ""] = d;
      out.push(...s(sp), ...t("keyword", pre), ...t("keyword", kw));
      const n = name(rest0);
      out.push(...n.pieces);
      let rest = n.after;
      const lang = kw === "expression" ? "powerquery" : DAX_OBJECTS.has(kw) ? "dax" : null;
      objectLang = lang;
      if (kw === "partition" || kw === "table" || kw === "model") partition = null;
      const eq = /^(\s*=\s*)(.*)$/.exec(rest);
      if (eq) {
        out.push(...t("operator", eq[1]!));
        rest = eq[2]!;
        if (kw === "partition") {
          partition = rest.trim() === "m" ? "powerquery" : rest.trim() === "calculated" ? "dax" : null;
          out.push(...(PARTITION_KINDS.test(rest.trim()) ? t("keyword", rest) : s(rest)), ...s(nl));
          continue;
        }
        if (kw === "annotation" || kw === "extendedProperty") {
          out.push(...t("string", rest), ...s(nl));
          continue;
        }
        if (rest.trim() === "") {
          out.push(...s(rest), ...s(nl));
          block(ind, lang);
          continue;
        }
        out.push(...(lang ? embed(rest, lang) : s(rest)), ...s(nl));
        continue;
      }
      out.push(...s(rest), ...s(nl));
      continue;
    }
    // A property: "name: value", or "name = expression" (source, expression, defaultExpression...).
    const p = /^([A-Za-z][\w]*)(\s*)(:|=)(.*)$/.exec(body);
    if (p) {
      const [, key = "", gap = "", op = "", rest = ""] = p;
      out.push(...s(lead), ...t("property", key), ...s(gap), ...t(op === ":" ? "punctuation" : "operator", op));
      if (op === ":") {
        out.push(...value(rest), ...s(nl));
        continue;
      }
      const lang = key === "source" && partition ? partition : key === "expression" || key === "defaultExpression" ? (objectLang ?? "powerquery") : objectLang;
      if (rest.trim() === "") {
        out.push(...s(rest), ...s(nl));
        block(ind, lang);
        continue;
      }
      out.push(...(lang ? embed(rest, lang) : s(rest)), ...s(nl));
      continue;
    }
    // A flag on its own line (isHidden, isKey, discourageImplicitMeasures).
    if (/^[A-Za-z]\w*\s*$/.test(body)) {
      out.push(...s(lead), ...t("property", body), ...s(nl));
      continue;
    }
    out.push(...s(raw));
  }
  return out;
}
