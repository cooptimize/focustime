// QT-2: nothing a person reads tells them they planned too much. On test/builders/assistant-world.ts's week (next
// Wednesday afternoon has about 10h of to-dos in a block with little free time), the assistant's answers to the
// standard questions, a move's preview, the same answers as Teams cards, the Teams rhythm cards, the notices, the
// Guide and the shortcut list are searched for "over", "overloaded", "doesn't fit", "too much", "Full" and "Fits"
// (test/over-words.ts says what's left out and why: "overdue" and "leftover" are other words; "Take it over" is a
// promise changing hands). The visible strings in the check-in's, the assistant's and Teams' source files are
// searched too, so a line no test reaches is still caught. Ahead's Gantt keeps its amber "about 2h over" per week
// (QT-2 point 4, an open question for the product owner), so ui/ahead/ is not searched.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { call, NEXT_TUE, NEXT_WED, QD, say, setup } from "../test/builders/assistant-world.ts";
import { planWordsIn } from "../test/over-words.ts";
import { renderAnswer } from "../server/teams/render.ts";
import { proposalCard } from "../server/teams/cards.ts";
import { proposalOf } from "../server/teams/assistant.ts";
import { briefCard, checkinCard, closeoutCard, nudgeCard, type PickRow } from "../server/teams/rhythm-cards.ts";
import { CHECKIN_MESSAGE, CLOSEOUT_MESSAGE } from "../server/notify.ts";
import { KIND_HINT, KIND_LABEL, notices } from "../plan/notify.ts";
import { PUSH_GENERIC } from "../plan/push.ts";
import { KEYS } from "../ui/keys.ts";
import * as GUIDE from "../ui/guide/content.ts";
import type { HandleResult } from "./types.ts";

const URL_ = "https://focustime.example.com";
const read = (r: HandleResult) => JSON.stringify({ reply: r.reply, cards: r.cards, proposals: r.proposals.map((p) => ({ title: p.title, preview: p.preview })) });

/** The standard questions (AS-3's golden set, and "anything I should know about today?"), each with its intent. */
const QUESTIONS = [
  { text: "I'm planning next week. What should I look out for?", ask: { topic: "plan_check", period: "next_week" } },
  { text: "Anything I should know about today?", ask: { topic: "plan_check", period: "today" } },
  { text: "Anything I should know this week?", ask: { topic: "plan_check", period: "this_week" } },
  { text: "What's on my Wednesday next week?", ask: { topic: "agenda", period: "day", date: NEXT_WED } },
  { text: "What's on my plate next week?", ask: { topic: "agenda", period: "next_week" } },
  { text: "Which promises are late?", ask: { topic: "promises", period: "this_week", lateOnly: true } },
  { text: "What's not ready next week?", ask: { topic: "readiness", period: "next_week" } },
  { text: "Any deployments next week?", ask: { topic: "deployments", period: "next_week" } },
  { text: "Which features need an update for Monday?", ask: { topic: "status_updates", period: "this_week" } },
  { text: "What did I get done last week?", ask: { topic: "done", period: "last_week" } },
  { text: "What can you help me with here?", ask: { topic: "capabilities", period: "this_week" } },
] as const;

describe("QT-2: no over-planning words in what a person reads", () => {
  for (const q of QUESTIONS)
    it(`the assistant's answer to "${q.text}", in the panel and in Teams`, async () => {
      const s = setup({ channel: "teams" });
      await s.seed();
      s.question(q.ask as never);
      const r = await s.a.handle(q.text);
      expect(r.status).toBe("ok");
      expect(planWordsIn(read(r))).toEqual([]);
      expect(planWordsIn(JSON.stringify(renderAnswer(r, URL_)))).toEqual([]);
    });

  it("an answer for one day mentions its meetings and free time, and a block at risk with its reason", async () => {
    const s = setup();
    await s.seed();
    s.question({ topic: "plan_check", period: "day", date: NEXT_WED } as never);
    const r = await s.a.handle("Anything I should know about next Wednesday?");
    const text = read(r);
    expect(text).toMatch(/of meetings/);
    expect(text).toMatch(/free for focus/);
    expect(text).toMatch(/Wed PM: at risk/);
    expect(planWordsIn(text)).toEqual([]);
  });

  it("a block planned well past its free time but not at risk gets no line and no suggestion", async () => {
    const s = setup();
    await s.seed();
    // Wingtip's Wed AM has no meetings; three more 4h to-dos put it far past its free time.
    for (const t of ["Claims audit", "Claims mapping", "Claims backlog"]) await s.plan.addPick({ date: NEXT_WED, half: "AM", clientKey: QD, kind: "intention", title: t, size: "L" });
    s.question({ topic: "plan_check", period: "next_week" } as never);
    const r = await s.a.handle("I'm planning next week. What should I look out for?");
    expect(read(r)).not.toMatch(/Wed AM/);
    expect(JSON.stringify(r.cards.filter((c) => c.kind === "suggest"))).not.toMatch(/Wingtip/);
  });

  it("asked about an ordinary day, its facts are shown but not counted as a thing to look at", async () => {
    const s = setup();
    s.question({ topic: "plan_check", period: "day", date: "2026-11-09" } as never);
    const r = await s.a.handle("Anything I should know about next Monday?");
    // The day's facts line is shown but isn't counted: only the client lines are things to look at.
    const lines = r.cards.flatMap((c) => (c.kind === "section" ? c.lines.map((l) => l.text) : []));
    expect(lines).toContain("Mon, Nov 9: no meetings, 8h free for focus");
    expect(r.reply).toBe(`For Mon, Nov 9, ${lines.length - 1} things to look at, by client.`);
  });

  it("a move's preview into a block with no free time says where it goes and that block's free time", async () => {
    // Next Tuesday morning is all meetings: Wingtip's block there has no free time.
    const s = setup();
    await s.seed();
    s.action(["move_plan"], {}, call(["move_plan", { fromDate: NEXT_WED, fromHalf: "AM", toDate: NEXT_TUE, toHalf: "AM", which: "all" }]), say("Here's the move."));
    const r = await s.a.handle("Move my Wednesday AM to-dos to Tuesday morning");
    expect(r.proposals, r.reply).toHaveLength(1);
    const p = r.proposals[0]!;
    expect(p.preview.rows).toEqual([expect.objectContaining({ label: "Intake form", after: expect.stringMatching(/Tue/) })]);
    expect(p.preview.notes).toContain("Tuesday AM: no free time");
    expect(planWordsIn(read(r))).toEqual([]);
    expect(planWordsIn(JSON.stringify(proposalCard(proposalOf(p), { publicUrl: URL_ })))).toEqual([]);
  });

  it("the Teams rhythm cards: brief, midday check-in, close out, nudges", () => {
    const pk = (id: number, title: string, state: PickRow["state"] = "open"): PickRow => ({ id, title, client: "Northwind", state, note: null });
    const base = { occasion: "x:2026-11-04", date: "2026-11-04", dateLabel: "Wednesday, Nov 4" };
    const picks = [pk(1, "Draft the cutover checklist"), pk(2, "Answer the pricing questions", "done"), pk(3, "Walk through the import errors", "not_yet")];
    const dest = [{ value: "2026-11-05:AM", label: "Thu AM" }];
    const cards = [
      briefCard({ ...base, kind: "brief", blocks: [{ label: "Afternoon 12:30–5:00", client: "Northwind", meetings: ["1:00 Sprint review"], picks }], promises: ["Send the notes to Dana"], sends: [], destinations: dest, more: 0 }, URL_),
      checkinCard({ ...base, kind: "checkin", picks, destinations: dest, sessions: [{ pickId: 4, title: "Fix the login timeout", client: "Northwind", minutes: 60, state: "open" }] }, URL_),
      closeoutCard({ ...base, kind: "closeout", picks, closed: false }, URL_),
      nudgeCard({ kind: "nudges", occasion: "n:2026-11-04", items: [] }, URL_),
    ];
    for (const c of cards) expect(planWordsIn(JSON.stringify(c))).toEqual([]);
  });

  it("notices, reminders and pushes", () => {
    const words = [CHECKIN_MESSAGE, CLOSEOUT_MESSAGE, JSON.stringify(KIND_LABEL), JSON.stringify(KIND_HINT), JSON.stringify(PUSH_GENERIC), JSON.stringify(notices.checkin("2026-11-04", "2026-11-04T17:00:00Z"))];
    for (const w of words) expect(planWordsIn(w)).toEqual([]);
  });

  it("the Guide and the shortcut list", () => {
    expect(planWordsIn(JSON.stringify(GUIDE))).toEqual([]);
    expect(planWordsIn(JSON.stringify(KEYS))).toEqual([]);
  });

  // The strings a person can read in the files that draw the check-in, the assistant, Teams and the notices (string
  // and template literals, JSX text; not comments, identifiers or the AI's own instructions).
  const FILES = [
    "ui/Checkin.tsx", "ui/Day.tsx", "ui/TimeboxCheckin.tsx", "ui/keys.ts",
    "assistant/answer.ts", "assistant/reads.ts", "plan/days.ts", "plan/weekdrop.ts", "plan/checkin.ts", "plan/checkinmove.ts", "plan/addwork.ts",
    "server/teams/cards.ts", "server/teams/render.ts", "server/teams/rhythm-cards.ts", "server/teams/rhythm.ts", "server/teams/bot.ts",
    "plan/notify.ts", "plan/push.ts", "server/notify.ts",
  ];
  for (const f of FILES)
    it(`visible strings in ${f}`, () => {
      expect(planWordsIn(visibleStrings(readFileSync(new URL(`../${f}`, import.meta.url), "utf8")).join("\n"))).toEqual([]);
    });
});

/** String and template literals and JSX text, with comments and `${…}` parts left out. Good enough for copy. */
function visibleStrings(src: string): string[] {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ").replace(/\s\/\/\s.*$/gm, " ");
  const out: string[] = [];
  for (const m of code.matchAll(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g)) out.push((m[1] ?? m[2] ?? m[3] ?? "").replace(/\$\{[^}]*\}/g, " "));
  for (const m of code.matchAll(/>([^<>{}]*[A-Za-z][^<>{}]*)</g)) out.push(m[1]!);
  return out;
}
