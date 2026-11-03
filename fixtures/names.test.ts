// A1: no real people, clients, projects, addresses or the developer's desktop in the repo. Every tracked text file is
// read; the decision log and the Azure move docs keep the history, and system/README.md may name the desktop the
// developer loop was built on. The words are kept base64-encoded so this file never matches its own search.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..");
const word = (b64: string) => Buffer.from(b64, "base64").toString("utf8");
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Real clients and projects (inventory section 5, D286's originals), the owner, and company addresses in fixtures. */
const REAL = [
  ...["VyZD", "VCZT", "V0MgUHJvamVjdA==", "V0MlMjBQcm9qZWN0"].map((b) => esc(word(b))),
  ...["V29vZGFyZA==", "UXVpZGRpdHk=", "Q1ND", "dGFubmVy", "c3BhdWxkaW5n"].map((b) => `\\b${esc(word(b))}\\b`),
  `[A-Za-z0-9._%+-]+@${esc(word("Y29vcHRpbWl6ZS5vcmc="))}`,
];
/** The developer's desktop and workstation. */
const DESKTOP = ["b21hcmNoeQ==", "aHlwcmxhbmQ=", "cmVtbWluYQ==", "bW9vbmxpZ2h0"].map((b) => esc(word(b))).concat(`\\b${esc(word("dG1zLQ=="))}`);

const realRe = new RegExp(REAL.join("|"), "i");
const desktopRe = new RegExp(DESKTOP.join("|"), "i");
const HISTORY = (f: string) => f === "docs/decisions.md" || f.startsWith("docs/azure/");
const TEXT = /\.(ts|tsx|mjs|js|json|md|css|html|toml|sh|service|desktop|txt|svg|yml|yaml)$|(^|\/)[^.]+$/;

function tracked(): string[] {
  return execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" })
    .split("\0")
    .filter((f) => f && TEXT.test(f) && f !== "package-lock.json" && !f.startsWith("node_modules/"));
}

function hits(re: RegExp, allowed: (f: string) => boolean): string[] {
  const out: string[] = [];
  for (const f of tracked()) {
    if (allowed(f)) continue;
    let text: string;
    try {
      text = readFileSync(resolve(ROOT, f), "utf8");
    } catch {
      continue; // listed but not on disk (a delete not yet committed)
    }
    text.split("\n").forEach((line, i) => {
      if (re.test(line)) out.push(`${f}:${i + 1}`);
    });
  }
  return out;
}

describe("names in the repo (A1)", () => {
  it("the patterns find what they are for", () => {
    for (const s of [word("VyZD"), `a ${word("V29vZGFyZA==")} b`, `x@${word("Y29vcHRpbWl6ZS5vcmc=")}`, `/home/${word("dGFubmVy")}/x`]) expect(realRe.test(s), s).toBe(true);
    for (const s of ["T&W", "Tailspin & Wingtip", "ana@cooptimize.example", "OSCAR", "csc2"]) expect(realRe.test(s), s).toBe(false);
    expect(desktopRe.test(`${word("b21hcmNoeQ==")}-launch-webapp`)).toBe(true);
    expect(desktopRe.test("hyprctl clients")).toBe(false);
  });

  it("no real client, project, person or company address outside the history", () => {
    expect(hits(realRe, HISTORY)).toEqual([]);
  });

  it("no desktop or workstation names outside the history and the developer loop's README", () => {
    expect(hits(desktopRe, (f) => HISTORY(f) || f === "system/README.md")).toEqual([]);
  });
});
