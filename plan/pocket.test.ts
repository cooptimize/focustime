import { describe, expect, it } from "vitest";
import { pageLines, parsePocket, recordedOf } from "./pocket.ts";

describe("reading a Pocket export's text (PK-1)", () => {
  it("only what follows the Transcript heading is transcript; a summary before it is not, even with a label in it", () => {
    const r = parsePocket([
      "Nov 16, 2026 • 27:02",
      "An invented title: with a colon",
      "Summary",
      "SPEAKER_01: this line is in the summary, not the transcript",
      "Transcript",
      "SPEAKER_00: First words of the turn, and one more",
      "thing: a wrapped line with a colon stays in this turn.",
      "SPEAKER_01: Agreed.",
    ]);
    expect(r.lines.map((l) => [l.speaker, l.text])).toEqual([
      ["Speaker 1", "First words of the turn, and one more thing: a wrapped line with a colon stays in this turn."],
      ["Speaker 2", "Agreed."],
    ]);
    expect(r.recorded).toEqual({ date: "2026-11-16", length: "27:02" });
  });

  it("with no heading, the transcript starts at the first label; a wrapped line that looks like 'Name: words' is not a speaker", () => {
    const r = parsePocket(["Invented title", "SPEAKER_03: We met Dana", "Dana: is not a label Pocket writes, so this is the same turn", "SPEAKER_07: ok"]);
    expect(r.lines.map((l) => l.speaker)).toEqual(["Speaker 1", "Speaker 2"]);
    expect(r.lines[0]!.text).toContain("Dana: is not a label");
    expect(r.lines.every((l) => l.at === null)).toBe(true);
    expect(r.recorded).toBeNull();
  });

  it("finds the date and length only in the header, and a date alone without a length", () => {
    expect(recordedOf(["Mar 3, 2026"])).toEqual({ date: "2026-03-03", length: null });
    expect(recordedOf(["Feb 30, 2026 • 1:00"])).toBeNull();
    expect(parsePocket(["Transcript", "SPEAKER_00: Back on Nov 2, 2026 • 3:00 we said so."]).recorded).toBeNull();
  });

  it("a page's text items become lines top to bottom, left to right, with the spaces the PDF didn't write", () => {
    const at = (s: string, x: number, y: number, w = s.length * 5) => ({ str: s, transform: [10, 0, 0, 10, x, y], width: w });
    expect(pageLines([at("second", 72, 700), at("SPEAKER_00:", 72, 714), at("words", 140, 714), at("line", 110, 700)])).toEqual(["SPEAKER_00: words", "second line"]);
  });
});
