// TP-1b: the three questions, pure: their words, what a create writes from every mix of typed description and answers
// (the third in the acceptance field or the description), the answers the server takes, and a draft's column read
// back, both this step's shape and a TP-1 brief (nothing a person typed is lost).
import { describe, expect, it } from "vitest";
import { aTp1Brief } from "../test/builders/index.ts";
import { TP1_CARRIED } from "../test/tp1-drafts.ts";
import { answersEmpty, AnswersError, keptOf, NO_ANSWERS, parseAnswers, QUESTION_KEYS, QUESTIONS, storedOf, withCarried, written } from "./three-questions.ts";

const a = (o: Partial<typeof NO_ANSWERS>) => ({ ...NO_ANSWERS, ...o });

describe("the three questions", () => {
  it("have exactly these labels and grey text, in this order", () => {
    expect(QUESTION_KEYS.map((k) => QUESTIONS[k].label)).toEqual(["Where is it?", "What should change?", "How will we know it's right?"]);
    expect(QUESTION_KEYS.map((k) => QUESTIONS[k].hint)).toEqual(["The report and page, model, table or pipeline", "Before and after, or the rule", "One example and the answer it should give"]);
    for (const k of QUESTION_KEYS) expect(QUESTIONS[k].label + QUESTIONS[k].hint, k).not.toMatch(/—/);
  });
});

describe("what a create writes", () => {
  it("nothing typed: nothing written", () => {
    expect(written({ description: null, answers: null, acField: true })).toEqual({ descriptionHtml: null, descriptionText: null, acceptance: null });
    expect(written({ description: "  ", answers: a({ where: " " }), acField: false })).toEqual({ descriptionHtml: null, descriptionText: null, acceptance: null });
  });
  it("every mix of typed description and the first two answers, empty ones left out", () => {
    const cases: [string | null, Partial<typeof NO_ANSWERS>, string | null, string | null][] = [
      ["D", {}, "<div>D</div>", "D"],
      [null, { where: "W" }, "<p><strong>Where:</strong> W</p>", "Where: W"],
      [null, { change: "C" }, "<p><strong>What should change:</strong> C</p>", "What should change: C"],
      [null, { where: "W", change: "C" }, "<p><strong>Where:</strong> W</p><p><strong>What should change:</strong> C</p>", "Where: W\n\nWhat should change: C"],
      ["D", { where: "W" }, "<div>D</div><p><strong>Where:</strong> W</p>", "D\n\nWhere: W"],
      ["D", { change: "C" }, "<div>D</div><p><strong>What should change:</strong> C</p>", "D\n\nWhat should change: C"],
      ["D\nE", { where: "W", change: "C" }, "<div>D</div><div>E</div><p><strong>Where:</strong> W</p><p><strong>What should change:</strong> C</p>", "D\nE\n\nWhere: W\n\nWhat should change: C"],
    ];
    for (const [d, x, html, text] of cases) {
      const w = written({ description: d, answers: a(x), acField: true });
      expect([w.descriptionHtml, w.descriptionText], JSON.stringify([d, x])).toEqual([html, text]);
      expect(w.acceptance).toBeNull();
    }
  });
  it("the third answer: the acceptance field when the type has it, after a draft's own acceptance", () => {
    expect(written({ description: null, answers: a({ check: "October: 31.2%" }), acField: true })).toEqual({ descriptionHtml: null, descriptionText: null, acceptance: "October: 31.2%" });
    expect(written({ description: null, answers: a({ check: "K" }), acceptance: "Given a week, a CSV", acField: true }).acceptance).toBe("Given a week, a CSV\n\nK");
  });
  it("the third answer: the description when the type has no acceptance field", () => {
    const w = written({ description: "D", answers: a({ where: "W", check: "K" }), acField: false });
    expect(w.descriptionHtml).toBe("<div>D</div><p><strong>Where:</strong> W</p><p><strong>How we'll know it's right:</strong> K</p>");
    expect(w.descriptionText).toBe("D\n\nWhere: W\n\nHow we'll know it's right: K");
  });
  it("never writes a heading, a tag or the four lines' names", () => {
    const w = written({ description: "D", answers: a({ where: "W", change: "C", check: "K" }), acField: false });
    expect(w.descriptionHtml).not.toMatch(/<h\d|type:|What and where|How far and who signs off/);
  });
  it("escapes what was typed and keeps its lines", () => {
    expect(written({ description: null, answers: a({ change: "a < b & \"c\"\nthen d" }), acField: true }).descriptionHtml).toBe("<p><strong>What should change:</strong> a &lt; b &amp; &quot;c&quot;<br>then d</p>");
  });
});

describe("the answers the server takes", () => {
  it("each optional; empty is none", () => {
    expect(parseAnswers(undefined)).toBeNull();
    expect(parseAnswers(null)).toBeNull();
    expect(parseAnswers({})).toBeNull();
    expect(parseAnswers({ where: "  ", change: "" })).toBeNull();
    expect(parseAnswers({ check: " One row \r\n" })).toEqual(a({ check: "One row" }));
    expect(answersEmpty(a({}))).toBe(true);
  });
  it("refuses anything else, and a too-long answer", () => {
    expect(() => parseAnswers({ type: "new-measure" })).toThrow(AnswersError);
    expect(() => parseAnswers({ where: 1 })).toThrow(/Where is it\? must be text/);
    expect(() => parseAnswers([])).toThrow(AnswersError);
    expect(() => parseAnswers({ change: "x".repeat(2001) })).toThrow(/at most 2000/);
  });
});

describe("a draft's column", () => {
  it("this step's shape: the three answers and nothing carried; stored as only the three", () => {
    const x = a({ where: "W", check: "K" });
    expect(storedOf(x)).toBe('{"where":"W","change":"","check":"K"}');
    expect(keptOf(storedOf(x))).toEqual({ answers: x, carried: null });
    expect(storedOf(a({}))).toBeNull();
    expect(keptOf(null)).toEqual({ answers: null, carried: null });
  });
  it("a TP-1 brief keeps every word: the first three lines are the answers, the rest carried as plain words", () => {
    const k = keptOf(JSON.stringify(aTp1Brief()));
    expect(k.answers).toEqual({ where: "The Sales model", change: "Gross margin percent", check: "October, East: 31.2%" });
    expect(k.carried).toBe(TP1_CARRIED);
    // Every word the person typed or chose is in the answers or the carried words; the request type isn't a word of theirs.
    const all = `${Object.values(k.answers!).join(" ")} ${k.carried}`;
    for (const w of ["Sales model", "Gross margin percent", "31.2%", "Test", "Data", "Model", "the finance lead", "Only the margin page", "In test", "Sam Lee", "Deploy to production"]) expect(all).toContain(w);
    expect(all).not.toContain("new-measure");
  });
  it("a TP-1 brief with only a type or only choices, or unreadable: nothing lost, nothing made up", () => {
    expect(keptOf(JSON.stringify(aTp1Brief({ where: "", change: "", check: "", env: null, touches: [], checkedBy: null, done: "", doneWhen: null, signedOffBy: null, notWithout: [] })))).toEqual({ answers: null, carried: null });
    expect(keptOf(JSON.stringify({ doneWhen: "Published" }))).toEqual({ answers: null, carried: "Done when it is: Published." });
    expect(keptOf("{oops")).toEqual({ answers: null, carried: null });
    expect(keptOf("[1]")).toEqual({ answers: null, carried: null });
    expect(keptOf(JSON.stringify({ where: 3, touches: "Data", checkedBy: "x" }))).toEqual({ answers: null, carried: null });
  });
  it("the description shown: the person's own text, then the carried words once", () => {
    expect(withCarried("Context.", "Environment: Test.")).toBe("Context.\n\nEnvironment: Test.");
    expect(withCarried(null, "Environment: Test.")).toBe("Environment: Test.");
    expect(withCarried("Context.", null)).toBe("Context.");
    expect(withCarried(" ", null)).toBeNull();
  });
});
