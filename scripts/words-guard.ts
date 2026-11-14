// TD-1: the words guard. What people read calls a planned piece of work on a block a "to-do"; "pick" is only its code
// name (action names `pick.*`, tables, columns, stored values and URLs keep it). This finds "pick" in the to-do sense
// in text people read: string literals and JSX text in the app's code, and the demo docs and public pages. Code tokens
// ("pick.move", `kind: "pick"`, class names, `[data-pick]`, the `Pick<>` type) are not text, and "pick" meaning choose
// ("pick a date", "pick from the list", "picks it up") stays.
//
// Run by scripts/guards.ts with the other guards (`npm run guards`, CI).
//
// NM-1: the same scan also finds the names FocusTime no longer uses (the Guide's Renamed list, ui/guide/retired.ts) and
// controls written as characters, in every string a person reads. See `namesHits` at the foot of this file.
import { RETIRED } from "../ui/guide/retired.ts";

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

type Piece = { line: number; text: string; bare: boolean; /** Where a quoted string starts in the file (NM-1: to tell a string inside `old: [...]` from its neighbor). */ pos?: number };

/**
 * The text pieces of a code file: each string literal (or template literal part) with the line it starts on, and in
 * .tsx the JSX text. A tiny tokenizer (strings, templates with `${}`, comments, regex literals), so a quote in a
 * comment or a regex never flips the rest of the file.
 */
export function codePieces(src: string, tsx: boolean, /** NM-1: also JSX text that holds brackets or ends its line: "(Ctrl K) or a ⋯ menu item." */ loose = false): Piece[] {
  const out: Piece[] = [];
  const code: string[] = []; // the code with strings and comments blanked, per line, for JSX text
  let line = 1, i = 0, cur = "";
  const tpl: number[] = []; // brace depth at each open `${`
  let depth = 0;
  let prev = ""; // last significant code char, to tell a regex from a division
  const push = (text: string, at: number, bare: boolean, pos?: number) => out.push({ line: at, text, bare, ...(pos === undefined ? {} : { pos }) });
  const readString = (q: string) => {
    const at = line;
    const pos = i;
    let s = "";
    i++;
    while (i < src.length && src[i] !== q && src[i] !== "\n") {
      if (src[i] === "\\") { s += src[i + 1] ?? ""; i += 2; continue; }
      s += src[i++];
    }
    if (src[i] === q) i++; // an unclosed quote (an apostrophe in JSX text) ends at the line's end
    push(s, at, true, pos);
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
      // NM-1: text between two tags or expressions whatever it holds, and text that runs to the end of its line.
      // An entity is read as its character ("Settings &gt; Data"), written wide so it is never taken for a tag.
      if (loose) for (const m of l.replace(/&gt;/g, "＞").replace(/&lt;/g, "＜").replace(/&amp;/g, "＆").replace(/&[a-z]+;|&#\d+;/g, " ").matchAll(/[\w"'}\/]>([^<>{}]*)(?=[<{]|$)/g)) if (/[A-Za-z]{2}/.test(m[1]!) && m[1]!.trim().split(/\s+/).length >= 2 && !/[=;]|=>|\b(const|return|typeof)\b/.test(m[1]!)) push(m[1]!, k + 1, false);
      // NM-1: a line of JSX text with brackets or a colon in it: "On iPhone, add FocusTime to your home screen first (More".
      if (loose && /^\s*[A-Z][^<>{}=;]*$/.test(l) && l.trim().split(/\s+/).length >= 4 && !/=>|^\s*(return|const|let|if|else|await|export|import|type|case|throw|new|typeof)\b/.test(l)) push(l, k + 1, false);
      // NM-1: text after an {expression} to the end of the line: {name}'s DevOps. Undo is in Settings
      for (const m of l.matchAll(/\}([^<>{}=;()|&:]*)$/g)) if (m[1]!.trim().split(/\s+/).length >= 3 && !/^\s*(as|from|else|satisfies|catch|finally|while)\b/.test(m[1]!)) push(m[1]!, k + 1, false);
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

// ---------- NM-1: retired names and controls written as characters ----------
// The app's own words use today's names. A string a person reads (the same pieces as above: string literals, template
// parts, JSX text, the demo docs and public pages) fails when it uses a name on the Guide's Renamed list or writes a
// control as a character. Old names live on only where they are how people find things: the Renamed list itself, a
// setting's `old` names, a command's `aka` (its other names) and search `keywords`.

/**
 * Not scanned for names, each with its reason:
 * - ui/guide/: the Guide is held to the same list by ui/guide/app-names.test.ts, which knows its markup, and holds the Renamed list itself.
 * - ui/Roadmap.tsx and plan/work-templates.ts: nothing draws them any more (docs/open-questions.md, NM-1).
 * - scripts/demo-walkthrough.mjs and docs/demo/: a walkthrough and a script written for the app on a past date.
 */
const NAMES_SKIPPED = (f: string) => f.startsWith("ui/guide/") || f === "ui/Roadmap.tsx" || f === "plan/work-templates.ts" || f === "scripts/demo-walkthrough.mjs" || f.startsWith("docs/demo/");

/** "Pick" is left to `saysPick` above, which knows pick the code name from pick as choose. */
const NAMES = RETIRED.filter((r) => r.match && !r.was.startsWith("Pick"));

/** A control written as a character: ⋯ ‹ ✕, × that isn't between two numbers, › that isn't in a path (Day › Close out), and "+ Word". */
const CONTROL: readonly RegExp[] = [/[⋯‹✕]/u, /(?<![\d}])\s?×\s?(?![\d$])/u, /›(?! [A-Za-z<{$]| $)|(?<!(?:^|[A-Za-z'’)>}]) )›/u, /(?<![A-Za-z0-9+] ?)\+ (?=[A-Z][a-z])/u];

export type Allowed = { re: RegExp; file?: RegExp; why: string };
/**
 * Words on the Renamed list that are also ordinary words, each with its reason. An entry with `file` holds only there.
 * Keep it short: a new entry needs a reason a reader of the screen would accept.
 */
export const NAMES_ALLOWED: readonly Allowed[] = [
  { re: /^Today ?$/, file: /^ui\/(Day|WeekGrid|PhoneDay|StyleGuide|dateinput|stamp|inbox\/Detail)\.tsx?$/, why: "the Today pill and button, the quick date and a stamp (Today 4:07 PM): the day that is today" },
  { re: /\bToday(?='s\b| is\b| isn't\b| \(| \d)/g, why: "today the day, starting a sentence: Today's blocks, Today is Sat, Today isn't planned yet, Today (Fri) is hidden" },
  { re: /\bToday(?= onboarding| it's)/g, file: /^sources\/demo\//, why: "the demo's example text: today as in these days" },
  { re: /\bLoop (closed|updates sent)\b/g, why: "Close the loop is the action's name today; these are its results" },
  { re: /\bWaiting on $/g, file: /^plan\/conversations\.ts$/, why: "waiting on a person, by name: a sentence, not the Inbox's old view" },
  { re: /\bNeeds you\b/g, file: /^ui\/Day\.tsx$/, why: "the phone's heading over Day's urgent lines: plain words, not the Inbox's old view" },
  { re: /\bRequests (go to|and DevOps items)\b/g, file: /^(public\/legal\.html|ui\/settings\/DeliveryChats\.tsx)$/, why: "requests the plural noun, starting a sentence" },
  { re: /\b[Rr]equest types?\b|\bReadiness (as written|by request type)\b|^Readiness$/g, file: /^(ui|plan|actions)\/patterns[./]|^actions\/registry\.ts$/, why: "DevOps patterns' own words (WP-1): its list of request types and how ready an item reads as written" },
  { re: /^FocusTime's words:[\s\S]*$/, file: /^assistant\/service\.ts$/, why: "the assistant's glossary tells the model which old words people may still say, so it understands them" },
  { re: /\bCoopilot\b/g, file: /^(host\/local\/rename\.ts|plan\/timebox\.ts|config\/starter\.ts)$/, why: "the rename's own notice, and the old marker text still recognised on Outlook events" },
  { re: /^Follow-up$/, file: /^actions\/plan-actions\.ts$/, why: "a stored type name on a to-do made from a promise, never drawn as a label" },
  { re: /^×$/u, file: /^ui\/Feedback\.tsx$/, why: "a screen size, 1920×1080" },
];

/** Where the fields for old names are in a file: each `old: [...]`, `aka: [...]` and `keywords: [...]`, start to end. */
function oldNameRanges(text: string): [number, number][] {
  return [...text.matchAll(/\b(?:old|aka|keywords)\??:\s*\[[^\]]*\]/g)].map((m) => [m.index, m.index + m[0].length]);
}

/** Code, not words: SQL, a path, a pattern. */
const CODE_TEXT = (t: string) =>
  (SQL.test(t) && /\b(FROM|SET|INTO|TABLE|WHERE|VALUES|ON|KEY)\b/.test(t)) || /^\.{0,2}\/|\.(tsx?|css|md)$/.test(t.trim()) || /\\[sdwb]|\(\?[:=!<]/.test(t);

/** What a piece of text says that it shouldn't: retired names by their `was`, and "a control as a character". */
export function namesIn(text: string, f = ""): string[] {
  if (CODE_TEXT(text)) return [];
  // "Settings > Data" is the same path as "Settings › Data".
  let t = text.replace(/\b(Settings|Admin|Week|Inbox|Today|Ahead|Backlog|Day) (?:>|&gt;|＞) (?=[A-Z])/g, "$1 › ");
  for (const a of NAMES_ALLOWED) if (!a.file || a.file.test(f)) t = t.replace(a.re, " ");
  const out = NAMES.filter((r) => r.match!.test(t)).map((r) => r.was);
  if (CONTROL.some((re) => re.test(t))) out.push("a control as a character");
  return out;
}

/** The lines of a file that use a retired name or write a control as a character, with what each says. */
/** What the names check reads: everything the words guard reads, and the sources' own messages ("Set it up in Settings › …"). */
export const namesScanned = (f: string) => !NAMES_SKIPPED(f) && (wordsScanned(f) || (/^sources\//.test(f) && /\.ts$/.test(f) && !/\.test\.ts$/.test(f) && !/fakes\.ts$/.test(f)));

export function namesHits(f: string, text: string): { line: number; says: string[] }[] {
  if (NAMES_SKIPPED(f)) return [];
  const by = new Map<number, Set<string>>();
  const add = (line: number, says: string[]) => { if (says.length) by.set(line, new Set([...(by.get(line) ?? []), ...says])); };
  const lines = text.split("\n");
  if (/\.(ts|tsx|mjs)$/.test(f)) {
    const old = oldNameRanges(text);
    for (const p of codePieces(text, f.endsWith(".tsx"), true)) {
      if (p.pos !== undefined && old.some(([a, b]) => p.pos! > a && p.pos! < b)) continue;
      add(p.line, namesIn(p.text, f));
    }
  } else {
    lines.forEach((l, k) => add(k + 1, namesIn(l, f)));
  }
  return [...by].sort((a, b) => a[0] - b[0]).map(([line, says]) => ({ line, says: [...says] }));
}
