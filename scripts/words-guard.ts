// TD-1: the words guard. What people read calls a planned piece of work on a block a "to-do"; "pick" is only its code
// name (action names `pick.*`, tables, columns, stored values and URLs keep it). This finds "pick" in the to-do sense
// in text people read: string literals and JSX text in the app's code, and the demo docs and public pages. Code tokens
// ("pick.move", `kind: "pick"`, class names, `[data-pick]`, the `Pick<>` type) are not text, and "pick" meaning choose
// ("pick a date", "pick from the list", "picks it up") stays.
//
// Run by scripts/guards.ts with the other guards (`npm run guards`, CI).

/** Where people read text: the app's code (not tests or fakes), the demo docs and the public pages. */
export const wordsScanned = (f: string) =>
  ((/^(ui|server|assistant|actions|plan|sources\/demo|config|week|ai|host)\//.test(f) || /^store\/[^/]+\.ts$/.test(f) || /^scripts\/(teams-[^/]+\.ts|demo-walkthrough\.mjs)$/.test(f)) && /\.(ts|tsx|mjs)$/.test(f) && !/\.test\.tsx?$/.test(f) && !/fakes\.ts$/.test(f)) ||
  /^docs\/demo\/[^/]+\.md$/.test(f) ||
  /^public\/[^/]+\.(html|webmanifest)$/.test(f);

/** The word in the to-do sense, not inside a code token (pick.move, today-picks, data-pick, $pick, Pick<T>). */
const WORD = /(?<![\w\-.\/\[#$@])(picks|pick|Picks|Pick|PICKS|PICK)(?![\w\-<])(?!\??\.\w)/g;
/** "pick" as choose: the words after it. */
const CHOOSE_AFTER = /^\s+(a|an|another|the|one|from|who|whom|their|people|it|each|your|up|any|one's)\b/i;
/** "picks" as a verb: FocusTime picks the best-placed person, picks it up. */
const CHOOSES_AFTER = /^\s+(the|it|up|a|an)\b/i;
/** "pick" as choose: the words before it (people you pick, can pick another, FocusTime picks). */
const CHOOSE_BEFORE = /\b(you|can|may|to|will|FocusTime|I'll)\s+$/;
/** A noun before it: "a pick", "the pick it came from", "today's picks", "3 picks", "several picks". Then it is a to-do,
 * whatever follows ("an unfinished pick from an earlier day", "every planned pick a time"). */
const NOUN_BEFORE = /(\b(a|an|the|each|every|one|planned|unfinished|next|dropped|suggested|done|which|this|that|no|your|my|its|their|our|of|several|more|all|some|any|two|three|larger|smaller|other|today's|tomorrow's|morning's)|'s|\d|\})\s+$/i;
/** "picked" in the to-do sense: a type that is picked directly (one that "can't be picked" is often a person, so left alone). */
const PICKED = /\bpicked directly\b/i;
/** One-off phrases where it means choose. */
const ALLOWED = [
  /Pick Idea, Problem or Question/,
  /supplier picks payment terms/,
  /Enter \(picks$/,
  // the rename itself: the assistant's glossary and the Guide's answer
  /code name:? pick\b/,
  /\bpick (and|or) to-do\b/,
  /Where did picks go\?/,
  // the Guide's Renamed table (UI-5)
  /^Pick \(a planned piece of work\)$/,
];
/** SQL in the store names the picks table. */
const SQL = /\b(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|FROM|JOIN|REFERENCES|WHERE|INDEX)\b/;

/** Does this piece of text say pick in the to-do sense? */
export function saysPick(text: string): boolean {
  if (SQL.test(text) || ALLOWED.some((re) => re.test(text))) return false;
  if (PICKED.test(text)) return true;
  for (const m of text.matchAll(WORD)) {
    const w = m[1]!, after = text.slice(m.index + m[0].length), before = text.slice(0, m.index);
    if (NOUN_BEFORE.test(before)) return true;
    if (/^picks$/i.test(w) ? CHOOSES_AFTER.test(after) : CHOOSE_AFTER.test(after) && !/^\s+which\b/i.test(after)) continue;
    if (CHOOSE_BEFORE.test(before)) continue;
    return true;
  }
  return false;
}

type Piece = { line: number; text: string; bare: boolean };

/**
 * The text pieces of a code file: each string literal (or template literal part) with the line it starts on, and in
 * .tsx the JSX text. A tiny tokenizer (strings, templates with `${}`, comments, regex literals), so a quote in a
 * comment or a regex never flips the rest of the file.
 */
export function codePieces(src: string, tsx: boolean): Piece[] {
  const out: Piece[] = [];
  const code: string[] = []; // the code with strings and comments blanked, per line, for JSX text
  let line = 1, i = 0, cur = "";
  const tpl: number[] = []; // brace depth at each open `${`
  let depth = 0;
  let prev = ""; // last significant code char, to tell a regex from a division
  const push = (text: string, at: number, bare: boolean) => out.push({ line: at, text, bare });
  const readString = (q: string) => {
    const at = line;
    let s = "";
    i++;
    while (i < src.length && src[i] !== q && src[i] !== "\n") {
      if (src[i] === "\\") { s += src[i + 1] ?? ""; i += 2; continue; }
      s += src[i++];
    }
    if (src[i] === q) i++; // an unclosed quote (an apostrophe in JSX text) ends at the line's end
    push(s, at, true);
    cur += q + " ".repeat(s.length) + q;
  };
  const readTemplate = () => {
    // from just after a ` or a } closing ${, up to the next ` or ${
    const at = line;
    let s = "";
    while (i < src.length) {
      const c = src[i]!;
      if (c === "\\") { s += src[i + 1] ?? ""; i += 2; continue; }
      if (c === "`") { i++; push(s, at, false); return; }
      if (c === "$" && src[i + 1] === "{") { i += 2; tpl.push(depth); depth++; push(s, at, false); return; }
      if (c === "\n") { line++; code.push(cur); cur = ""; }
      s += c;
      i++;
    }
    push(s, at, false);
  };
  while (i < src.length) {
    const c = src[i]!;
    if (c === "\n") { line++; code.push(cur); cur = ""; i++; continue; }
    if (c === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) { if (src[i] === "\n") { line++; code.push(cur); cur = ""; } i++; }
      i += 2;
      continue;
    }
    if (c === "/" && (prev === "" || /[(,=:[!&|?{};]/.test(prev) || /\b(return|typeof|case)\s*$/.test(cur))) {
      // a regex literal: skip to its closing slash on this line
      let inClass = false;
      i++;
      while (i < src.length && src[i] !== "\n") {
        if (src[i] === "\\") { i += 2; continue; }
        if (src[i] === "[") inClass = true;
        else if (src[i] === "]") inClass = false;
        else if (src[i] === "/" && !inClass) break;
        i++;
      }
      if (src[i] === "/") i++;
      prev = "/";
      cur += " ";
      continue;
    }
    if (c === "'" || c === '"') { readString(c); prev = c; continue; }
    if (c === "`") { i++; readTemplate(); prev = "`"; cur += " "; continue; }
    if (c === "{") depth++;
    if (c === "}") {
      depth--;
      if (tpl.length && tpl[tpl.length - 1] === depth) { tpl.pop(); i++; readTemplate(); prev = "`"; cur += " "; continue; }
    }
    if (!/\s/.test(c)) prev = c;
    cur += c;
    i++;
  }
  code.push(cur);
  if (tsx) {
    code.forEach((l, k) => {
      // text after a tag's > up to the next < or {; or a line of plain words inside JSX
      for (const m of l.matchAll(/[\w"'}\/]>([^<>{}=;()|&]*)/g)) if (/[A-Za-z]/.test(m[1]!)) push(m[1]!, k + 1, false);
      // text between a {expression} and the next tag or expression: {n} picks</span>, {n} pick{n === 1 ? ...
      for (const m of l.matchAll(/\}([^<>{}=;()|&:]*)(?=[<{])/g)) if (/[A-Za-z]/.test(m[1]!)) push(m[1]!, k + 1, false);
      if (/^\s*[A-Za-z][^<>{}=;()|&:]*$/.test(l) && l.trim().split(/\s+/).length >= 3 && !/^\s*(return|const|let|if|else|await|export|import|type|case|throw|new|typeof)\b/.test(l)) push(l, k + 1, false);
    });
  }
  return out;
}

/** The lines of a file that say pick in the to-do sense. */
export function wordsHits(f: string, text: string): number[] {
  const lines = new Set<number>();
  if (/\.(ts|tsx|mjs)$/.test(f)) {
    for (const p of codePieces(text, f.endsWith(".tsx"))) {
      // A bare "pick" or "picks" literal is code (kind: "pick") unless it is a ternary's branch: n === 1 ? "pick" : "picks".
      if (p.bare && /^(pick|picks)$/.test(p.text)) continue;
      if (p.bare && !/\s/.test(p.text) && !/^[A-Z]/.test(p.text)) continue;
      // class names: "as-card pick", "now-pick now-draft"
      if (p.bare && p.text.trim().split(/\s+/).every((t) => /^[a-z][a-z0-9-]*$/.test(t)) && /-/.test(p.text)) continue;
      if (saysPick(p.text)) lines.add(p.line);
    }
    // the ternary shape on one line
    text.split("\n").forEach((l, k) => { if (/\?\s*["'`](pick|picks)["'`]\s*:/.test(l)) lines.add(k + 1); });
  } else {
    text.split("\n").forEach((l, k) => { if (saysPick(l)) lines.add(k + 1); });
  }
  return [...lines].sort((a, b) => a - b);
}
