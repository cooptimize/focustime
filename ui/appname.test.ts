// R1: no user-visible string calls the app "Coopilot" (its name until Nov 2) or "Focus Time" (two words: that is the
// Dataverse table). The app's own source is read with comments removed, so every string, JSX text and identifier
// counts; the launcher, the desktop entries and the service too. The few kept on purpose are listed here.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const DIRS = ["ui", "server", "actions", "plan", "week", "sources", "config", "links", "store", "host", "log"];

/** Kept on purpose, by file: the Outlook marker and text already on Outlook events and DevOps items. */
const KEEP: Record<string, RegExp> = {
  "sources/graph/write.ts": /^export const MARKER_PROP = "String \{[0-9a-f-]+\} Name CoopilotId";$/,
  "plan/timebox.ts": /^const LEGACY_BODY_TAG = "Timebox planned in Coopilot\.";$/,
  "plan/devopswrite.ts": /^export const REMOVED_COMMENT = "Removed by Coopilot: undo of an item created from Coopilot\.";$/,
  // The Entra and Dataverse registrations keep their display names (R1): the starter config names them as they are.
  "config/starter.ts": /^# .*"Coopilot (Dataverse Reader|Desktop)"/,
};
/** The rename itself: it has to name the old folders and keyring service. */
const RENAME_MODULES = ["host/local/rename.ts", "host/local/keyring-rename.ts"];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "node_modules" || n === "fixtures" ? [] : files(p);
    return /\.(ts|tsx)$/.test(n) && !/\.test\.ts$/.test(n) && !/test-fakes|fake-/.test(n) ? [p] : [];
  });
}

/** The code without comments, split into lines (a line comment after "://" is left alone: it is a URL). */
function strings(path: string): string[] {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/(^|[^:"'`])\/\/.*$/, "$1").trim())
    .filter(Boolean);
}

describe("the app's name in user-visible text (R1)", () => {
  const all = DIRS.flatMap((d) => files(join(root, d))).map((p) => ({ file: relative(root, p), strings: strings(p) }));

  it("reads a real amount of source", () => {
    expect(all.length).toBeGreaterThan(150);
    expect(all.some((f) => f.strings.some((l) => l.includes("FocusTime")))).toBe(true);
  });

  it("no string says Coopilot, except the ones kept on purpose", () => {
    const bad = all.flatMap((f) => f.strings.filter((s) => /coopilot/i.test(s) && !(KEEP[f.file]?.test(s) ?? false) && !RENAME_MODULES.includes(f.file)).map((s) => `${f.file}: ${s}`));
    expect(bad).toEqual([]);
  });

  it('"Focus Time" with a space only ever names the Dataverse table', () => {
    const bad = all.flatMap((f) => f.strings.filter((s) => /Focus Time/.test(s) && !f.file.startsWith("sources/dataverse/") && !/Dataverse/.test(s)).map((s) => `${f.file}: ${s}`));
    expect(bad).toEqual([]);
  });

  it("the launcher, desktop entries and service say FocusTime", () => {
    for (const n of ["focustime-open", "FocusTime.desktop", "focustime-autostart.desktop", "focustime.service", "install-icons.sh"]) {
      const text = readFileSync(join(root, "system", n), "utf8");
      expect(text, n).not.toMatch(/coopilot|Focus Time/i);
    }
    expect(readFileSync(join(root, "system", "FocusTime.desktop"), "utf8")).toMatch(/^Name=FocusTime$/m);
    expect(readFileSync(join(root, "system", "FocusTime.desktop"), "utf8")).toMatch(/^Icon=focustime$/m);
  });
});
