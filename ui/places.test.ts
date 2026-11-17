// NM-2: the place lists the pointer check reads are the ones the screens draw.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BACKLOG_TOOLBAR, MORE_ITEMS, PLACES } from "./places.ts";

const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
/** The literal labels of the ⋯ menu and the phone's More menu (the two `title: "More"` steps). */
function moreLabels(): string[] {
  const out = new Set<string>();
  for (const m of app.matchAll(/title: "More",\s*items: \[([\s\S]*?)\n\s*\],/g)) for (const l of m[1]!.matchAll(/label: "([^"]+)"/g)) out.add(l[1]!);
  for (const l of app.matchAll(/const (?:codeItem|installItem) = [^\n]*/g)) for (const x of l[0].matchAll(/label: "([^"]+)"/g)) out.add(x[1]!);
  return [...out].sort();
}

describe("places", () => {
  it("More is the computer's ⋯ rows and the phone's More screen's (PH-1)", () => {
    expect([...MORE_ITEMS].sort()).toEqual(moreLabels());
  });
  it("Backlog's toolbar draws Needs attention, Filter and Search", () => {
    const bar = readFileSync(new URL("./ahead/Toolbar.tsx", import.meta.url), "utf8");
    for (const t of BACKLOG_TOOLBAR) expect(bar, t).toMatch(new RegExp(`>\\s*${t}\\b|"${t}`));
  });
  it("Settings, Admin and Inbox come from their own lists", () => {
    expect(PLACES.Settings).toContain("Accounts and calendars");
    expect(PLACES.Settings).not.toContain("Client"); // a client's page sits under Clients
    expect(PLACES.Admin).toContain("Audit");
    expect(PLACES.Inbox).toEqual(["From chats", "Promises", "Captures"]);
    expect(PLACES.Backlog.slice(0, 2)).toEqual(["Grid", "Gantt"]);
  });
});
