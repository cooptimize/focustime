// GU-1: the Guide says what the app says. No retired name outside Renamed; no control written as a character; every
// bold control name and every path's last label is a string the app shows; every tab has a section, in the app's order,
// with the tab's icon; every {icon:name} is in the app's family and stands beside a name; no answer is over 120 words;
// search finds every old name. A step that renames a control fails here until the Guide follows (docs/guide.md).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ICON_NAMES } from "../icons.tsx";
import { TABS } from "../nav.ts";
import * as C from "./content.ts";
import { guideIndex, searchGuide } from "./Guide.tsx";
import { TAB_ICON } from "./GuideFrame.tsx";
import { plainText } from "./Rich.tsx";
import { CONTROL_CHARS, RENAMED_ROWS, RETIRED, retiredIn } from "./retired.ts";
import { SECTIONS, TAB_SECTIONS } from "./sections.ts";
import { TOURS } from "./tours.ts";

const strings = (v: unknown): string[] => (typeof v === "string" ? [v] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v === "object" ? Object.values(v).flatMap(strings) : []);
/** Everything the Guide says outside Renamed's rows: its content, its section names and its tours. */
const said = [...strings({ ...C, RENAMED_ROWS: null }), ...SECTIONS.map((s) => s.name), ...strings(TOURS)];

// ---------- The app's own words: every string and every run of text in the screens, the actions and the settings ----------

const root = join(import.meta.dirname, "../..");
function files(dir: string): string[] {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) => {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) return p === "ui/guide" ? [] : files(p);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}
const source = ["ui", "actions", "config", "plan"].flatMap(files).map((f) => readFileSync(join(root, f), "utf8"));
const APP = new Set<string>();
for (const src of source) {
  for (const m of src.matchAll(/"((?:[^"\\\n]|\\.){1,90})"|'((?:[^'\\\n]|\\.){1,90})'|`([^`$\n]{1,90})`/g)) APP.add((m[1] ?? m[2] ?? m[3]!).trim());
  for (const m of src.matchAll(/>([^<>{}\n]{1,90})</g)) APP.add(m[1]!.trim());
  for (const m of src.matchAll(/^\s+([A-Z][^<>{}=;\n]{0,90})$/gm)) APP.add(m[1]!.trim());
}
/** Whether a label, or its first words, is exactly something the app shows ("Run setup again runs it again" is "Run setup again"). */
function inApp(label: string): boolean {
  const w = label.trim().split(/\s+/);
  for (let n = w.length; n > 0; n--) {
    const head = w.slice(0, n).join(" ");
    if (APP.has(head) || APP.has(`${head}…`) || APP.has(`${head}:`)) return true;
  }
  return false;
}

describe("names", () => {
  it("no retired name outside Renamed", () => {
    for (const t of said) expect(retiredIn(t), t).toEqual([]);
  });
  it("no control written as a character: each is its app name, with its icon", () => {
    for (const t of said) expect(t.match(CONTROL_CHARS)?.[0] ?? null, t).toBeNull();
  });
  it("every bold control name is a string the app shows", () => {
    const bold = said.flatMap((t) => [...t.matchAll(/\{b:([^}]+)\}/g)].map((m) => m[1]!));
    expect(bold.length).toBeGreaterThan(5);
    // The sizes are the app's size letters, shown on chips built from data, not from a literal.
    for (const b of bold.filter((b) => !/^(XS|S|M|L)$/.test(b))) expect(inApp(b), b).toBe(true);
  });
  it("every path's last label is a string the app shows (More › About)", () => {
    const paths = said.flatMap((t) => [...plainText(t).matchAll(/(?:[A-Z][\w' ]*? › )+([^.,;:()›\n]+)/g)].map((m) => m[1]!));
    expect(paths.length).toBeGreaterThan(20);
    for (const p of paths) expect(inApp(p), p).toBe(true);
  });
  it("every Renamed row says where the old name lives now, in the app's words", () => {
    expect(RENAMED_ROWS.length).toBe(RETIRED.length);
    expect(new Set(RENAMED_ROWS.map(([was]) => was)).size).toBe(RENAMED_ROWS.length);
    for (const [was, now] of RENAMED_ROWS) {
      expect(now.length, was).toBeGreaterThanOrEqual(3);
      // No chains: a row never points at another old name.
      expect(retiredIn(now), `${was} → ${now}`).toEqual([]);
    }
    expect(RENAMED_ROWS.flat().join(" ").split(/\s+/).length).toBeLessThanOrEqual(260);
  });
});

describe("tabs and icons", () => {
  it("every tab has a section, in the app's tab order, with the tab's own icon", () => {
    const tabSections = SECTIONS.filter((s) => s.group === "tabs").map((s) => s.id);
    expect(tabSections.map((id) => TAB_SECTIONS[id])).toEqual([...TABS]);
    // The same names the top bar draws (ui/App.tsx TAB_ICONS).
    const app = readFileSync(join(root, "ui/App.tsx"), "utf8").match(/const TAB_ICONS[^=]*= \{([^}]+)\}/)![1]!;
    for (const t of TABS) expect(app, t).toContain(`${t}: "${TAB_ICON[t]}"`);
  });
  it("every {icon:name} is one of the app's icons and stands beside the control's name", () => {
    const marks = said.flatMap((t) => [...t.matchAll(/\{icon:([^}]+)\}(.{0,2})/g)].map((m) => [m[1]!, m[2]!, t] as const));
    expect(marks.length).toBeGreaterThan(10);
    for (const [name, after, t] of marks) {
      expect(ICON_NAMES, name).toContain(name);
      expect(after, t).toMatch(/^ [A-Z{]/);
    }
  });
});

describe("answers", () => {
  it("no answer is over 120 words", () => {
    expect(C.MAX_ANSWER_WORDS).toBe(120);
    for (const { q, a } of C.QUESTION_POOL) expect(plainText(a).split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length, q).toBeLessThanOrEqual(C.MAX_ANSWER_WORDS);
  });
  it("no question asks where an old name went: Renamed is the one list", () => {
    for (const { q } of C.QUESTION_POOL) expect(q, q).not.toMatch(/^Where did .* go\??$|^What happened to /);
  });
});

describe("search", () => {
  const index = guideIndex();
  it("finds every old name, in Renamed", () => {
    for (const r of RETIRED) {
      const typed = r.was.replace(/\(.*\)/, "").replace(/[›…]/g, " ").trim();
      expect(searchGuide(typed, index).some((h) => h.section === "renamed"), r.was).toBe(true);
    }
  });
});
