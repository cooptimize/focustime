import { describe, expect, it } from "vitest";
import { aFeedbackDraft, aSender, aUser, aWhere } from "../test/builders/index.ts";
import { buildFeedback, FEEDBACK_TAG, feedbackTitle, parseDraft, sentToday, TITLE_MAX } from "./feedback.ts";

describe("feedback title (F1)", () => {
  it("is the type and the first line", () => {
    expect(feedbackTitle("idea", "Show free hours\nsecond line", false)).toBe("Idea: Show free hours");
    expect(feedbackTitle("problem", "\n\n  Plan won't save  \nmore", false)).toBe("Problem: Plan won't save");
    expect(feedbackTitle("question", "Where is Close out?", false)).toBe("Question: Where is Close out?");
  });
  it("keeps at most 80 characters of the first line", () => {
    const t = feedbackTitle("idea", "x".repeat(200), false);
    expect(t).toBe(`Idea: ${"x".repeat(TITLE_MAX)}`);
  });
  it("starts with [dev] on dev", () => {
    expect(feedbackTitle("idea", "Try it", true)).toBe("[dev] Idea: Try it");
  });
});

describe("feedback description (F1)", () => {
  const sender = aSender(aUser({ displayName: "Alex Rivera", email: "alex@contoso.example" }));
  it("has the text, who sent it, where they were and the environment", () => {
    const p = buildFeedback(aFeedbackDraft({ text: "Line one\nLine two", where: aWhere() }), sender, "prod");
    expect(p.description).toBe(
      [
        "Line one\nLine two",
        "",
        "From Alex Rivera (alex@contoso.example)",
        "View: Today › Plan",
        "Version: prod · #42 · abc1234 · built Nov 2, 2026",
        "Browser: Chrome 141 on Windows",
        "Screen: 1920×1080, window 1920×960",
        "Environment: prod",
      ].join("\n"),
    );
    expect(p.tags).toEqual([FEEDBACK_TAG, "Idea"]);
    expect(p.title).toBe("Idea: Line one");
  });
  it("leaves out where when it isn't included", () => {
    const p = buildFeedback(aFeedbackDraft({ text: "Hello", where: null }), sender, "prod");
    expect(p.description).toBe("Hello\n\nFrom Alex Rivera (alex@contoso.example)\nEnvironment: prod");
  });
  it("adds [dev] to the title on dev", () => {
    expect(buildFeedback(aFeedbackDraft({ text: "Hi" }), sender, "dev").title).toBe("[dev] Idea: Hi");
  });
});

describe("the window's input (F1)", () => {
  it("takes kind, text and where only", () => {
    expect(parseDraft({ kind: "idea", text: " hi ", where: aWhere() })).toEqual({ kind: "idea", text: "hi", where: aWhere() });
    expect(parseDraft({ kind: "idea", text: "hi", plan: { clients: ["Northwind"] } })).toEqual({ error: "unknown input field plan" });
    expect(parseDraft({ kind: "idea", text: "hi", where: { ...aWhere(), clients: "Northwind" } })).toMatchObject({ error: expect.any(String) });
    expect(parseDraft({ kind: "rant", text: "hi" })).toMatchObject({ error: expect.any(String) });
    expect(parseDraft({ kind: "idea", text: "   " })).toEqual({ error: "Write something first" });
    expect(parseDraft({ kind: "idea", text: "x".repeat(4001) })).toMatchObject({ error: expect.any(String) });
  });
  it("cuts where lines short and to one line", () => {
    const d = parseDraft({ kind: "idea", text: "hi", where: { view: `a\nb${"v".repeat(100)}`, version: "", browser: "", screen: "" } });
    expect("error" in d ? null : d.where?.view).toBe(`a b${"v".repeat(57)}`);
  });
});

describe("sends today (F1)", () => {
  it("counts only today's", () => {
    expect(sentToday({ date: "2026-11-03", count: 4 }, "2026-11-03")).toBe(4);
    expect(sentToday({ date: "2026-11-02", count: 4 }, "2026-11-03")).toBe(0);
    expect(sentToday(null, "2026-11-03")).toBe(0);
    expect(sentToday({ date: "2026-11-03", count: "x" }, "2026-11-03")).toBe(0);
  });
});
