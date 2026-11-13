// RB-1 D10: coloring a file. Prism (the one coloring library, MIT, loaded only with the Code panel) is asked only for
// its token tree (Prism.tokenize): strings and typed pieces. Its HTML output (Prism.highlight) is never used, so file
// text never becomes page content: the panel draws each piece as a text node in a span whose class comes from the
// piece's type. TMDL uses ui/code/tmdl.ts, with Prism's DAX and Power Query grammars for its expressions. Prism runs
// in manual mode (ui/code/prism-manual.ts, imported first) and makes no network request: only its core and the
// grammars below are loaded.
import "./prism-manual.ts";
// The core only: the package's main file also carries the file-highlight plugin (which can request a file) and grammars
// FocusTime doesn't use. The core's highlightElement (HTML and a Web Worker) is never called.
import Prism, { type Token, type TokenStream } from "prismjs/components/prism-core";
import "prismjs/components/prism-markup";
import "prismjs/components/prism-sql";
import "prismjs/components/prism-json";
import "prismjs/components/prism-yaml";
import "prismjs/components/prism-powershell";
import "prismjs/components/prism-markdown";
import "prismjs/components/prism-python";
import "prismjs/components/prism-dax";
import "prismjs/components/prism-powerquery";
import { tmdlTokens, type Piece } from "./tmdl.ts";
import type { Lang } from "./languages.ts";

/** One run of text with the token types it sits in (outermost first); null for plain. */
export type Span = { text: string; kinds: string[] | null };
export type Line = Span[];

const GRAMMAR: Partial<Record<Lang, string>> = { sql: "sql", json: "json", yaml: "yaml", xml: "markup", powershell: "powershell", markdown: "markdown", python: "python", dax: "dax", powerquery: "powerquery" };

/** Prism's stream as pieces (the TMDL tokenizer's shape). */
function toPieces(s: TokenStream): Piece[] {
  if (typeof s === "string") return s ? [s] : [];
  if (Array.isArray(s)) return s.flatMap(toPieces);
  const t = s as Token;
  const alias = t.alias === undefined ? [] : Array.isArray(t.alias) ? t.alias : [t.alias];
  return [{ type: [t.type, ...alias].join(" "), content: toPieces(t.content) }];
}

function prismPieces(text: string, lang: string): Piece[] {
  const g = Prism.languages[lang];
  return g ? toPieces(Prism.tokenize(text, g)) : [text];
}

export function pieces(text: string, lang: Lang): Piece[] {
  if (lang === "tmdl") return tmdlTokens(text, (code, l) => prismPieces(code, l));
  const g = GRAMMAR[lang];
  return g ? prismPieces(text, g) : [text];
}

/** Flattens pieces into lines of spans, splitting on line ends. The characters are exactly the text's, in order. */
export function toLines(ps: readonly Piece[]): Line[] {
  const lines: Line[] = [[]];
  const walk = (p: Piece, kinds: string[]) => {
    if (typeof p === "string") {
      const parts = p.split("\n");
      parts.forEach((part, i) => {
        if (i > 0) lines.push([]);
        if (part) lines[lines.length - 1]!.push({ text: part, kinds: kinds.length ? kinds : null });
      });
      return;
    }
    const next = [...kinds, ...p.type.split(" ").filter(Boolean)];
    for (const c of p.content) walk(c, next);
  };
  for (const p of ps) walk(p, []);
  return lines;
}

/** Plain lines, for a file shown without color. */
export const plainLines = (text: string): Line[] => text.split("\n").map((l) => (l ? [{ text: l, kinds: null }] : []));

export const colorize = (text: string, lang: Lang): Line[] => (lang === "plain" ? plainLines(text) : toLines(pieces(text, lang)));

/** The characters a set of lines draws, joined with line ends: equal to the file's text (the tests' check). */
export const textOf = (lines: readonly Line[]): string => lines.map((l) => l.map((s) => s.text).join("")).join("\n");
