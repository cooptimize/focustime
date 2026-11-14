// TD-1: the words guard finds "pick" in the to-do sense in text people read, and leaves code names and "pick" as
// choose alone.
import { describe, expect, it } from "vitest";
import { NAMES_ALLOWED, namesHits, namesIn, namesScanned, saysPick, wordsHits, wordsScanned } from "./words-guard.ts";

describe("saysPick", () => {
  it("the to-do sense", () => {
    for (const t of ["Move pick", "Unfinished picks", "Only a planned pick can be moved", "3 of 5 picks done", "Next pick", "Picks", "Which pick?", "Keep an unfinished pick from an earlier day", "Give every planned pick a time", "Today's blocks and picks", "Parent types that are picked directly"]) expect(saysPick(t), t).toBe(true);
  });
  it("pick as choose, and the rename's own words", () => {
    for (const t of ["Pick a day after today", "pick another conversation to merge into", "type a name and pick from the list", "the people you pick", "FocusTime picks the best-placed person", "nobody has picked it up", "Leave each client ready to pick up again", "up and down pick the half-day", "Sign in with Microsoft to pick a chat", "a to-do (code name pick)", "People may say pick or to-do", "SELECT id FROM picks WHERE id = ?"]) expect(saysPick(t), t).toBe(false);
  });
});

describe("wordsHits", () => {
  const ts = (src: string) => wordsHits("ui/x.ts", src);
  it("finds strings, template parts and the plural ternary", () => {
    expect(ts('const a = "Drop pick";\nconst b = `${n} picks done`;\nconst c = n === 1 ? "pick" : "picks";\n')).toEqual([1, 2, 3]);
  });
  it("leaves code names, kinds, class names, comments and Pick<>", () => {
    expect(ts('run("pick.move");\nconst k = { kind: "pick" };\nconst c = "today-picks now-pick";\n// a pick in a comment\ntype P = Pick<A, "b">;\nconst s = "[data-pick]";\nconst x = pick?.title;\n')).toEqual([]);
  });
  it("finds JSX text and attributes in .tsx", () => {
    const src = '<h3>Picks</h3>\n<span title="Start focus on this pick">x</span>\n<p>{n} pick{n === 1 ? " has" : "s have"} no time</p>\n<li className="menu-group">To-do</li>\n';
    expect(wordsHits("ui/x.tsx", src)).toEqual([1, 2, 3]);
  });
  it("a quote in a regex or an apostrophe doesn't throw the lines off", () => {
    expect(ts('const r = /["\']/;\nconst a = "fine";\nconst b = "Move pick";\n')).toEqual([3]);
    expect(wordsHits("ui/x.tsx", "<p>Don't stop</p>\n<p>Next pick</p>\n")).toEqual([2]);
  });
  it("the demo docs line by line", () => {
    expect(wordsHits("docs/demo/script.md", "- Pick the Northwind block\n- the pick lands in the block\n")).toEqual([2]);
  });
  it("scans the app's text, not tests, fakes, migrations or SQL files", () => {
    for (const f of ["ui/Day.tsx", "server/teams/cards.ts", "store/plan-store.ts", "docs/demo/script.md", "public/manifest.webmanifest", "scripts/teams-package.ts"]) expect(wordsScanned(f), f).toBe(true);
    for (const f of ["ui/Today.test.tsx", "host/fakes.ts", "store/sql/baseline.ts", "store/migrations/20261106T0900_week_carry.ts", "docs/decisions.md", "e2e/today.test.ts"]) expect(wordsScanned(f), f).toBe(false);
  });
});

// NM-1: the app's own words use today's names, and a control is named, never drawn as a character.
describe("namesIn", () => {
  it("a retired name in text people read", () => {
    for (const t of ["Back to Today", "Grid, Gantt, Gaps and Backlog need room", "Readiness nudges", "Fix next looks at the top N of each backlog", "Today and Week", "Click to open Plan ahead.", "views (Needs you, Promises, Waiting on, Captures and drafts and more)", "Undo is in Settings › Data.", "Logged in Settings > Data, with Undo.", "Shown next to Cooptimizers in Who and Roadmap", "Follow-ups due", "Inbox › Requests"]) expect(namesIn(t), t).not.toEqual([]);
  });
  it("a control written as a character", () => {
    for (const t of ["Actions (⋯) for what has focus", "also in Week's ⋯", "‹", "Close ×", "✕", "+ Add on a block", "Open ›"]) expect(namesIn(t), t).toEqual(["a control as a character"]);
  });
  it("today's names, paths, keys, sums and code are fine", () => {
    for (const t of ["Back to Day", "Day and Week", "Needs attention nudges", "Settings › Activity", "More › Keyboard shortcuts", "Ctrl +", "9:00 to 12:00 + 1:00 to 5:00", "look 8 to 12 weeks ahead", "what needs you", "UPDATE x SET version = version + 1 WHERE id = ?", "./ahead/Ahead.tsx", "calc(6px + 2px)", "A follow-up question", "Close the loop"]) expect(namesIn(t), t).toEqual([]);
  });
  it("the allow list: ordinary words that are also old names, each with a reason", () => {
    for (const t of ["Today's blocks and to-dos", "Today is Sat, Nov 7 · showing next week", "Today (Fri) is hidden", "Loop closed"]) expect(namesIn(t), t).toEqual([]);
    // The Today pill and button, only in the files that draw them: a tab named "Today" anywhere else fails.
    expect(namesIn("Today", "ui/WeekGrid.tsx")).toEqual([]);
    expect(namesIn("Today", "ui/nav.ts")).toEqual(["Today (the tab)"]);
    expect(namesIn("Waiting on ", "plan/conversations.ts")).toEqual([]);
    expect(namesIn("In your Waiting on ", "ui/meetings/Meetings.tsx")).toEqual(["Waiting on"]);
    // A size or a keyword in a sentence doesn't make it code.
    expect(namesIn("Width is 440px; see Settings › Data")).not.toEqual([]);
    expect(namesIn("Set the value in Settings › Planning")).not.toEqual([]);
    expect(namesIn("Needs you", "ui/Day.tsx")).toEqual([]);
    expect(namesIn("Needs you", "ui/App.tsx")).toEqual(["Needs you (the Inbox's view)"]);
    expect(namesIn("on Week and Today's timeline")).toEqual([]); // "Today's" reads as the day
    expect(namesIn("on Week and Today")).toEqual(["Today (the tab)"]);
    for (const a of NAMES_ALLOWED) expect(a.why.length, String(a.re)).toBeGreaterThan(15);
    expect(NAMES_ALLOWED.length).toBeLessThanOrEqual(16);
  });
});

describe("namesHits", () => {
  it("finds strings and JSX text, and leaves comments alone", () => {
    expect(namesHits("ui/x.tsx", '// Today, the tab\nconst a = "Back to Today";\n<p>Open Ahead</p>\n<span title="in Week\'s ⋯">x</span>\n').map((h) => h.line)).toEqual([2, 3, 4]);
  });
  it("finds JSX text that holds brackets or a colon, and text that ends its line", () => {
    const src = '<div className="foot">Every key is also a command menu entry (Ctrl K) or a ⋯ menu item.</div>\n<p className="muted">\n  On iPhone, add FocusTime to your home screen first (⋯ › Install app), then open it.\n</p>\n<p>\n  As {who}, in {client}\'s DevOps. Undo is in Settings › Data.\n</p>\n<p>Open it from More › Install app (on iPhone).</p>\n';
    expect(namesHits("ui/x.tsx", src).map((h) => h.line)).toEqual([1, 3, 6]);
  });
  it("old names stay where people search for them: old, aka and keywords", () => {
    const src = '{ id: "planning", label: "Day and Week", old: ["Today and Week", "Planning"] },\n{ id: "v", label: "Day", aka: ["Today"] },\n{ id: "r", label: "Needs attention nudges", keywords: ["Readiness nudges"] },\n{ id: "bad", label: "Today and Week" },\n';
    expect(namesHits("ui/settings/registry.ts", src).map((h) => h.line)).toEqual([4]);
  });
  it("only the strings inside old, aka and keywords are let through, not a label beside them", () => {
    expect(namesHits("actions/registry.ts", '{ name: "roadmap.ahead", aka: ["Plan ahead"], title: "Plan ahead" },\n{ name: "x", aka: ["Plan ahead"], title: "Backlog › Gantt" },\n').map((h) => h.line)).toEqual([1]);
    // An array over several lines.
    expect(namesHits("ui/menu.ts", '{ label: "Day",\n  aka: [\n    "Today",\n    "Board",\n  ] },\n')).toEqual([]);
  });
  it("reads the text after a tag that closes itself, and a line that starts with a plus", () => {
    const src = '<label>\n  <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} /> Show personal events on Week and Today\n</label>\n<button type="button" onClick={add}>\n  + Another client\n</button>\n';
    expect(namesHits("ui/x.tsx", src)).toEqual([{ line: 2, says: ["Today (the tab)"] }, { line: 5, says: ["a control as a character"] }]);
  });
  it("reads an entity as its character", () => {
    expect(namesHits("ui/x.tsx", '<span className="muted">Logged in Settings &gt; Data, with Undo.</span>\n<p>Undo &amp; Retry are in Settings › Data.</p>\n<p>Undo &amp; Retry are in Settings › Activity.</p>\n').map((h) => h.line)).toEqual([1, 2]);
  });
  it("reads the sources' own messages too, but not the demo docs or the Guide", () => {
    for (const f of ["sources/not-set-up.ts", "sources/oauth/oauth.ts", "ui/keys.ts", "ui/menu.ts", "ui/settings/registry.ts", "config/org.ts", "plan/notify.ts", "server/teams/cards.ts", "public/legal.html"]) expect(namesScanned(f), f).toBe(true);
    for (const f of ["sources/devops/write.test.ts", "ui/guide/content.ts", "docs/demo/script.md", "scripts/demo-walkthrough.mjs", "ui/Roadmap.tsx", "docs/decisions.md"]) expect(namesScanned(f), f).toBe(false);
  });
  it("the Guide has its own check, and the Renamed list holds the old names", () => {
    expect(namesHits("ui/guide/retired.ts", 'const r = { was: "Roadmap", now: "Backlog" };\n')).toEqual([]);
  });
  it("public pages line by line", () => {
    expect(namesHits("public/legal.html", "<p>Settings › Data › Export my data</p>\n<p>Settings › Your data</p>\n").map((h) => h.line)).toEqual([1]);
  });
});
