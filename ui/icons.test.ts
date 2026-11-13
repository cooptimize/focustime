// RS-1: one icon family, one source. Only ui/icons.tsx imports the icon package, by name (so only the icons used are
// bundled); an icon beside a word is hidden from screen readers and an icon alone carries its name; and no file in ui/
// puts a text character where an icon belongs.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Icon, ICON_NAMES } from "./icons.tsx";

const root = new URL(".", import.meta.url).pathname;
const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : /\.tsx?$/.test(f) && !/\.test\./.test(f) ? [join(dir, f)] : []));
const all = files(root);

describe("the icon family", () => {
  it("only ui/icons.tsx imports the icon package, and only by name", () => {
    const importers = all.filter((f) => /from "lucide-react/.test(readFileSync(f, "utf8"))).map((f) => f.slice(root.length));
    expect(importers).toEqual(["icons.tsx"]);
    const src = readFileSync(join(root, "icons.tsx"), "utf8");
    expect(src).not.toMatch(/import \* as|DynamicIcon|lucide-react\/dynamic|\bicons\b\s*[,}]/);
    expect(src.match(/from "lucide-react"/g)?.length).toBe(1);
  });

  it("has the icons the tabs, the top bar, the actions and the things need", () => {
    for (const n of ["day", "week", "backlog", "status", "inbox", "focus", "capture", "ask", "more", "vm", "code", "settings", "add", "edit", "move", "copy", "link", "search", "filter", "refresh", "done", "close", "loop", "time", "open", "closed", "back", "next", "preview", "ai", "promise", "chats", "to-sort", "meeting", "call", "personal", "all-day", "pto", "holiday", "catchup", "standing", "risk", "folder", "file", "repo", "people"]) expect(ICON_NAMES, n).toContain(n);
  });

  it("beside a word an icon is hidden from screen readers; alone it has its name; the stroke is 1.5 and doesn't scale", () => {
    const beside = renderToStaticMarkup(h(Icon, { name: "add" }));
    expect(beside).toMatch(/aria-hidden="true"/);
    expect(beside).not.toMatch(/aria-label|role="img"/);
    expect(beside).toMatch(/class="[^"]*ft-icon/);
    expect(beside).toMatch(/stroke-width="1.5"/);
    expect(beside).toMatch(/non-scaling-stroke/);
    const alone = renderToStaticMarkup(h(Icon, { name: "more", label: "More" }));
    expect(alone).toMatch(/role="img"/);
    expect(alone).toMatch(/aria-label="More"/);
    expect(alone).not.toMatch(/aria-hidden="true"/);
  });

  it("no text character stands in for a control or a mark in ui/ (the Guide's and the key list's sentences aside)", () => {
    // Characters that were controls or marks before RS-1, as a JSX child on their own or as a button's whole text.
    const alone = /^\s*(‹|›|⋯|×|✕|▸|▾|✓|✗|⋮⋮|\+|−|↵|↑|↓|⚠|★)\s*$/u;
    const inButton = />(‹|›|⋯|×|✕|▸|▾|✓|⋮⋮|\+|↵|↑|↓)<\/button>/u;
    const quoted = /[>}]\s*\+ (Add|New)\b|"\+ (Add|New|time|date|owner|size)\b/u;
    const hits: string[] = [];
    for (const f of all) {
      const rel = f.slice(root.length);
      if (rel === "guide/content.ts" || rel === "keys.ts" || rel === "StyleGuide.tsx" || rel === "textsize.ts" || rel === "pwa.ts") continue;
      for (const [i, line] of readFileSync(f, "utf8").split("\n").entries()) {
        const t = line.trim();
        if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") || t.startsWith("{/*")) continue;
        if (alone.test(line) || inButton.test(line) || quoted.test(line)) hits.push(`${rel}:${i + 1}: ${t.slice(0, 80)}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
