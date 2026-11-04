// AP-2: the pure parts of AI sorting and Promises: the schemas are strict, an answer becomes a sort (an item id that
// wasn't offered rejects it), the context builder keeps only what it's given with no email addresses and the caps,
// urgency windows, the promise rules (table-driven) and how a promise answer is checked.
import { describe, expect, it } from "vitest";
import { strictProblems } from "../ai/schema.ts";
import { aClassifyAnswer, aPromiseAnswer } from "../test/builders/index.ts";
import { buildContext, CLASSIFY_SCHEMA, contextText, matchPromise, notSortedText, pastUrgency, processName, promiseClosedBy, promiseFrom, PROMISE_SCHEMA, promiseWithoutAi, sortFrom, title80, type AiMessage } from "./asks-ai.ts";
import { DEFAULT_PROMISE_PHRASES } from "./asks.ts";

const NY = "America/New_York";
const msg = (id: string, text: string, from: AiMessage["from"] = "client"): AiMessage => ({ id, from, text, attachment: null });

describe("the schemas", () => {
  it("both are strict-mode schemas", () => {
    expect(strictProblems(CLASSIFY_SCHEMA)).toEqual([]);
    expect(strictProblems(PROMISE_SCHEMA)).toEqual([]);
  });
});

describe("an answer as a sort", () => {
  it("maps the fields a card shows", () => {
    expect(sortFrom(aClassifyAnswer({ likely_existing_item: { id: 501, confidence: 0.8 } }), [501, 502])).toEqual({
      kind: "bug", urgency: "this_week", itemType: "bug", title: "Totals report shows last month",
      description: "The client says the totals report still shows last month's numbers.", likely: { id: 501, confidence: 0.8 }, reason: "It describes something that is wrong in a report.",
    });
  });
  it("an item id that wasn't offered rejects the whole answer", () => {
    expect(sortFrom(aClassifyAnswer({ likely_existing_item: { id: 999, confidence: 0.9 } }), [501])).toBeNull();
  });
  it("none: no item type; an empty title only for none", () => {
    expect(sortFrom(aClassifyAnswer({ kind: "none", item_type: "story", title: "" }), [])).toMatchObject({ kind: "none", itemType: null });
    expect(sortFrom(aClassifyAnswer({ title: "  " }), [])).toBeNull();
  });
  it("a long title is cut to 80 characters at a word", () => {
    const t = title80("Fix the export of the monthly totals report so that it includes the archived projects as well as the active ones");
    expect(t.length).toBeLessThanOrEqual(80);
    expect(t.endsWith("…")).toBe(true);
  });
});

describe("the context for one request", () => {
  it("caps earlier messages at 5 and items at 50, newest change first, and keeps no email addresses", () => {
    const earlier = Array.from({ length: 8 }, (_, i) => msg(`m${i}`, `message ${i} from dana@fabrikam.example`));
    const items = Array.from({ length: 70 }, (_, i) => ({ id: 1000 + i, title: `Item ${i}`, type: i % 2 ? "Bug" : "User Story", state: "Active", changedAt: `2026-11-${String(1 + (i % 28)).padStart(2, "0")}T00:00:00Z` }));
    const c = buildContext({ clientName: "Fabrikam", items, earlier, message: msg("x", "Ping lee@cooptimize.example please") });
    expect(c.earlier.map((m) => m.id)).toEqual(["m3", "m4", "m5", "m6", "m7"]);
    expect(c.items).toHaveLength(50);
    expect(c.process).toEqual({ name: "Agile", types: ["Bug", "User Story"], states: ["Active"] });
    const text = contextText(c);
    expect(text).not.toMatch(/@/);
    expect(text).toContain("[email address]");
  });
  it("the process from the types it uses, never guessed", () => {
    expect([processName(["Product Backlog Item"]), processName(["User Story"]), processName(["Requirement"]), processName(["Issue"]), processName(["Task"])]).toEqual(["Scrum", "Agile", "CMMI", "Basic", null]);
  });
});

describe("urgency windows", () => {
  const at = "2026-11-04T15:00:00Z"; // Wednesday 10:00 in New York
  it.each([
    ["now, after 2 hours", "now", "2026-11-04T17:00:00Z", true],
    ["now, before 2 hours", "now", "2026-11-04T16:59:00Z", false],
    ["this week, on Friday evening", "this_week", "2026-11-07T04:59:00Z", false],
    ["this week, after Friday", "this_week", "2026-11-07T05:00:00Z", true],
    ["backlog, never", "backlog", "2026-12-04T15:00:00Z", false],
  ] as const)("%s", (_why, u, now, past) => {
    expect(pastUrgency(u, at, now, NY)).toBe(past);
  });
});

describe("promise rules (no AI)", () => {
  it.each([
    ["I'll send it tomorrow", "i'll"],
    ["I’ll look tonight", "i'll"],
    ["I will check with the team", "i will"],
    ["Let me find out", "let me"],
    ["I can do that", "i can"],
    ["Done by Friday", "by friday"],
    ["Back to you end of day", "end of day"],
    ["Next week works", "next week"],
    ["Thanks, looks good", null],
    ["Can you send the file?", null],
    ["Billion-dollar idea", null],
  ])("%s", (text, phrase) => {
    expect(matchPromise(text, DEFAULT_PROMISE_PHRASES)).toBe(phrase);
  });
  it("without AI: the first line as what, no due date", () => {
    expect(promiseWithoutAi("\nI'll send the totals tomorrow\nThanks")).toEqual({ what: "I'll send the totals tomorrow", due: null, toWhom: null, answers: null, reason: null });
  });
});

describe("a promise answer", () => {
  const o = { messageDay: "2026-11-04", offeredIds: ["m1", "m2"], names: ["Dana Client", "Lee Colleague"] };
  it("keeps a due date from the message's day up to 90 days, a name from the chat and an offered message", () => {
    expect(promiseFrom(aPromiseAnswer({ due_hint: "2026-11-05", to_whom: "Dana", answers_message_id: "m2" }), o)).toEqual({ what: "Send the corrected totals", due: "2026-11-05", toWhom: "Dana", answers: "m2", reason: "It commits to sending something." });
  });
  it.each([
    ["a date before the message", { due_hint: "2026-11-03" }, { due: null }],
    ["a date too far ahead", { due_hint: "2027-03-01" }, { due: null }],
    ["not a real date", { due_hint: "2026-02-30" }, { due: null }],
    ["a name not in the chat", { to_whom: "Pat Stranger" }, { toWhom: null }],
    ["a message that wasn't offered", { answers_message_id: "m9" }, { answers: null }],
  ])("drops %s", (_why, a, want) => {
    expect(promiseFrom(aPromiseAnswer(a), o)).toMatchObject(want);
  });
  it("not a promise: no card", () => {
    expect(promiseFrom(aPromiseAnswer({ is_promise: false }), o)).toBeNull();
  });
  it("closes by its follow-up done or its item done, and only those", () => {
    expect(promiseClosedBy({ status: "followup" }, { followUpDone: true, itemDone: null })).toBe(true);
    expect(promiseClosedBy({ status: "followup" }, { followUpDone: false, itemDone: true })).toBe(false);
    expect(promiseClosedBy({ status: "linked" }, { followUpDone: null, itemDone: true })).toBe(true);
    expect(promiseClosedBy({ status: "linked" }, { followUpDone: null, itemDone: null })).toBe(false);
    expect(promiseClosedBy({ status: "open" }, { followUpDone: true, itemDone: true })).toBe(false);
  });
});

it("Not sorted reasons are plain and name only the client", () => {
  expect(notSortedText("client_off", "Fabrikam")).toBe("AI isn't allowed for Fabrikam");
  expect(notSortedText("over_budget", "Fabrikam")).toBe("AI budget reached for this month");
  expect(notSortedText("refused_client", "Fabrikam")).toBe("it mentions another client");
  expect(notSortedText("unknown_item", "Fabrikam")).toBe("the AI's answer wasn't usable");
});
