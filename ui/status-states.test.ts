// ST-1: STEP 0.3's table as tests of the one rule. Every kind of text under a feature lands in exactly one state.
import { describe, expect, it } from "vitest";
import { LINE_STATES, STATE_NAME, STATE_SHAPE, ST_WORDS, mondayWords, sendsWords, stateOf, type LineState, type TextKind } from "./status-states.ts";

// The table: kind → state (and why), as in docs/ux/st1/after.md.
const TABLE: [TextKind, LineState][] = [
  ["comment_mine", "on_report"],
  ["comment_other", "on_report"],
  ["comment_coop", "on_report"],
  ["suggestion_ai", "suggested"],
  ["suggestion_template", "suggested"],
  ["draft", "suggested"],
  ["used_suggestion", "ready"],
  ["typed", "ready"],
  ["saved_draft", "ready"],
  ["edit_pending", "ready"],
  ["delete_pending", "ready"],
  ["pushing", "ready"],
  ["pushed", "on_report"],
  ["push_failed", "ready"],
  ["last_week", "on_report"],
];

describe("ST-1 line states", () => {
  it.each(TABLE)("%s is %s", (kind, state) => {
    expect(stateOf(kind)).toBe(state);
    expect(LINE_STATES).toContain(stateOf(kind));
  });
  it("every state has a kind in it, and exactly three states", () => {
    expect(LINE_STATES).toHaveLength(3);
    for (const s of LINE_STATES) expect(TABLE.some(([, t]) => t === s)).toBe(true);
  });
  it("what the AI writes is Suggested until added", () => {
    expect(stateOf("draft")).toBe("suggested");
    expect(stateOf("suggestion_ai")).toBe("suggested");
    expect(stateOf("used_suggestion")).toBe("ready");
  });
  it("the three differ in shape and name", () => {
    expect(new Set(Object.values(STATE_SHAPE)).size).toBe(3);
    expect(Object.values(STATE_NAME)).toEqual(["On the report", "Ready to push", "Suggested"]);
  });
  it("words", () => {
    expect(ST_WORDS.updated(2, 5)).toBe("2 of 5 features have an update");
    expect(ST_WORDS.ready(1)).toBe("1 line ready to push");
    expect(ST_WORDS.notOnYet(3)).toBe("3 lines aren't on the report yet");
    expect(ST_WORDS.forClients([{ name: "Northwind", n: 2 }, { name: "Harbor", n: 1 }])).toBe("Northwind 2, Harbor 1");
    expect(mondayWords("2026-11-09")).toBe("Monday, Nov 9");
    expect(sendsWords("Kat sends it Monday 7:00 AM")).toBe("Kat sends it 7:00 AM");
    expect(ST_WORDS.forMonday(mondayWords("2026-11-23"), sendsWords("Kat sends it Monday 7:00 AM"))).toBe("For Monday, Nov 23 · Kat sends it 7:00 AM");
  });
});
