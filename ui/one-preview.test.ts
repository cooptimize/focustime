// OP-1: one DevOps preview on every screen. ui/DevOpsWrite.tsx (useDevOpsWrite's begin, series and retry) is the only
// place in the UI that asks DevOps for a preview, confirms or retries one, or draws a confirm for a change to a client's
// DevOps. Every other file reaches DevOps through it. The exceptions are named here with their reason; a new one needs
// a decision in docs/decisions.md first.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const root = new URL(".", import.meta.url).pathname;
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return files(p);
    return /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) ? [p] : [];
  });
const all = files(root).map((p) => ({ path: relative(root, p), src: readFileSync(p, "utf8") }));

/** The write actions behind a DevOps preview, and the screens' own batch actions that wrap them. */
const ACTIONS = ["devops.preview", "devops.confirm", "devops.retry", "stories.publish_preview", "stories.publish", "stories.retry", "wrapup.preview", "wrapup.confirm", "feedback.preview", "feedback.send"];
const DOOR = "DevOpsWrite.tsx";
/** Who else may name an action, and why. */
const EXCEPTIONS: Record<string, { actions: string[]; why: string }> = {
  "Feedback.tsx": { actions: ["feedback.preview", "feedback.send"], why: "Send feedback writes to FocusTime's own backlog, not a client's DevOps; it keeps its own action and shows through the one preview's parts (OP-1 B)" },
  "WrapUp.tsx": { actions: ["wrapup.preview", "wrapup.confirm", "devops.retry"], why: "not yet moved: Wrap it up's confirm is the server's composite of several changes to one item, previewed again between them; moving it changes the server's write rules (docs/open-questions.md, OP-1)" },
  "DoneOffer.tsx": { actions: ["wrapup.preview", "wrapup.confirm"], why: "not yet moved: Close out's Wrap up batch is the same composite (docs/open-questions.md, OP-1)" },
};
/** A line that only names an action (the command menu's metadata), never calls it. */
const naming = (line: string) => /^\s*case "[^"]+":/.test(line) || /\baction: "[^"]+"/.test(line) && !/\bcall\b/.test(line);

describe("one DevOps preview on every screen (OP-1)", () => {
  it("only DevOpsWrite.tsx calls the preview, confirm and retry actions, apart from the named exceptions", () => {
    const found: string[] = [];
    for (const f of all) {
      if (f.path === DOOR) continue;
      f.src.split("\n").forEach((line, i) => {
        if (naming(line)) return;
        for (const a of ACTIONS) if (line.includes(`"${a}"`) || line.includes(`'${a}'`) || line.includes(`\`${a}\``)) if (!EXCEPTIONS[f.path]?.actions.includes(a)) found.push(`${f.path}:${i + 1} ${a}`);
      });
    }
    expect(found).toEqual([]);
  });

  it("each exception still needs its reason (a stale one is removed)", () => {
    for (const [path, e] of Object.entries(EXCEPTIONS)) {
      const src = all.find((f) => f.path === path)?.src ?? "";
      expect(e.why.length, path).toBeGreaterThan(20);
      expect(e.actions.some((a) => src.includes(`"${a}"`)), `${path} no longer needs its exception`).toBe(true);
    }
  });

  it("no other file draws a DevOps confirm: the preview's dialog and its parts stay in DevOpsWrite.tsx", () => {
    const parts = ["PreviewFrame", "PreviewWhere", "PreviewFields", "PreviewVisibility", "PreviewActions"];
    const found: string[] = [];
    for (const f of all) {
      if (f.path === DOOR) continue;
      // The DevOps flavour of the write dialog (Outlook's own preview in Timeboxes.tsx is another framework).
      if (/write-dialog devops|"devops"[^\n]*write-dialog/.test(f.src)) found.push(`${f.path}: the DevOps write dialog`);
      const imported = /import\s*\{([^}]*)\}\s*from\s*"[./]*DevOpsWrite\.tsx"/.exec(f.src)?.[1] ?? "";
      for (const p of parts) if (new RegExp(`\\b${p}\\b`).test(imported) && f.path !== "Feedback.tsx") found.push(`${f.path}: ${p}`);
      // Modal is the plain dialog shell; only a screen that writes nothing to DevOps may use it (WK-3's offer, LP-1).
      if (/\bModal\b/.test(imported) && f.path !== "Deploy.tsx") found.push(`${f.path}: Modal`);
    }
    expect(found).toEqual([]);
  });

  it("the screens OP-1 moved reach DevOps through useDevOpsWrite", () => {
    for (const path of ["Status.tsx", "TimeboxCheckin.tsx", "BreakDownPanel.tsx", "CloseOut.tsx", "FollowUps.tsx"]) {
      const src = all.find((f) => f.path === path)?.src ?? "";
      expect(src, path).toMatch(/useDevOpsWrite|useWriteFlows|\.markDone\b/);
    }
  });
});
