// UI-7: planning words instead of "Commit". Week's modes are Board · Plan · Team, finishing is Confirm week or Confirm
// today, Team says Not confirmed yet, Ahead's change set saves; code names, routes and stored values are unchanged.
// What a person reads (string literals and JSX text in the UI, the notifications and the command titles) has no
// planning or change-set "commit" left; conversation commitments keep their words. The command menu still finds the
// renamed commands by "commit".
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACTIONS, type ActionSpec } from "../actions/registry.ts";
import { pendingText } from "../plan/ahead-edit.ts";
import { confirmLabel, weekTag } from "../plan/addwork.ts";
import { KEYS } from "./keys.ts";
import { filterCommands, type MenuItem } from "./menu.ts";

const root = join(import.meta.dirname, "..");
const code = (p: string) => readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) ? [p] : []; });
const WORD = /\bcommit(ted|ting|s)?\b/i;
/** Conversation commitments and the build's git commit keep their words; the Guide's Renamed table names the old one. */
const KEEP = [/committed in\b/, /\$\{committer\} committed/, /someone commits/, /The commit on GitHub/, /who committed to what/, /<Name> committed/, /the pull request, the commit\b/, /^Committed$/, /^Commit \(in Week\)$/, /^Week › Plan \(Plan the week, Commit\)$/, /a new commit every/, /^· commit$/];
const STR = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g;
/** JSX text after a tag, up to the next tag or expression. */
const JSX_TEXT = /(?<![=-])>([^<>{}();=\n]+)[<{]/g;
/** A line of JSX text on its own ("Nothing is written until you save.{…}"). */
const JSX_LINE = /^\s+([A-Z][^<>{}()=;:\n]*)(?=[{<]|$)/gm;

function readable(file: string): string[] {
  const out: string[] = [];
  const src = code(file);
  const found = [...src.matchAll(STR)].map((m) => m[0].slice(1, -1));
  if (file.endsWith(".tsx")) found.push(...[...src.matchAll(JSX_TEXT), ...src.matchAll(JSX_LINE)].map((m) => m[1]!));
  for (const raw of found) {
    const t = raw.replace(/\$\{[^}]*\}/g, " ").trim();
    // Words, not identifiers like "weekplan.commit" or a route segment.
    if (!WORD.test(t) || !/\s/.test(t)) continue;
    if (KEEP.some((k) => k.test(t))) continue;
    out.push(`${file.slice(root.length + 1)}: ${t.slice(0, 120)}`);
  }
  return out;
}

describe("planning words (UI-7)", () => {
  it("no planning or change-set Commit left in what a person reads", () => {
    const files = [...walk(join(root, "ui")), join(root, "plan/notify.ts"), join(root, "plan/ahead-edit.ts")];
    expect(files.flatMap(readable)).toEqual([]);
    expect((ACTIONS as readonly ActionSpec[]).flatMap((a) => [a.title, a.summary]).filter((t) => WORD.test(t) && !KEEP.some((k) => k.test(t)))).toEqual([]);
  });
  it("the key legend, the week's states and Ahead's pending line", () => {
    expect(KEYS.filter((k) => WORD.test(k.does)).map((k) => k.does)).toEqual([]);
    // WD-1: W and P open Week with the Add work panel (there is no Plan mode).
    expect(KEYS.find((k) => k.keys.includes("W"))?.does).toMatch(/^Week with Add work open/);
    expect(KEYS.find((k) => k.keys.includes("P"))?.does).toMatch(/^Week with Add work open/);
    // WD-1: the week's tag in Week's header, and its button.
    expect(weekTag({ committedAt: null }, false)).toBe("Draft");
    expect(weekTag({ committedAt: "2026-11-05T10:00:00Z", changed: false }, false)).toBe("Confirmed");
    expect(weekTag({ committedAt: "2026-11-05T10:00:00Z", changed: true }, false)).toBe("Changed since you confirmed");
    expect(weekTag({ committedAt: null }, true)).toBeNull();
    expect(confirmLabel(weekTag({ committedAt: null }, false))).toBe("Confirm week");
    expect(confirmLabel(weekTag({ committedAt: "2026-11-05T10:00:00Z", changed: true }, false))).toBe("Confirm again");
    expect(confirmLabel(weekTag({ committedAt: "2026-11-05T10:00:00Z", changed: false }, false))).toBeNull();
    expect(pendingText(3)).toBe("3 changes to save");
  });
  it("the command menu still finds the renamed commands by commit", () => {
    const items = (ACTIONS as readonly ActionSpec[]).map<MenuItem>((a) => ({ id: a.name, action: a.name, group: a.group, label: a.title, ...(a.aka ? { aka: a.aka } : {}) }));
    const found = filterCommands(items, "commit").map((i) => i.label);
    expect(found).toEqual(expect.arrayContaining(["Confirm the week", "Confirm the day"]));
  });
});
