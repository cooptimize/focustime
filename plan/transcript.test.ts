import { describe, expect, it } from "vitest";
import { MAX_LINE_CHARS, numbered, parseDocxXml, parseVtt, quotesOf, timeOf, TranscriptError, windowsOf } from "./transcript.ts";

const VTT = `WEBVTT

0f1c/12-0
00:00:03.120 --> 00:00:05.000
<v Alex Kim>Morning everyone.</v>

0f1c/13-0
00:00:05.500 --> 00:00:09.000
<v Alex Kim>Let's start with the export.</v>

00:00:10.000 --> 00:00:14.000
<v Dana Ruiz>We need a CSV export for the &amp; rates page.</v>
`;

const docxXml = (paras: string[]) =>
  `<?xml version="1.0"?><w:document><w:body>${paras.map((p) => `<w:p><w:r><w:t xml:space="preserve">${p}</w:t></w:r></w:p>`).join("")}</w:body></w:document>`;

describe("transcripts (MC-1)", () => {
  it("reads WebVTT voice tags, merges one speaker's cues and numbers the lines", () => {
    const lines = parseVtt(VTT);
    expect(lines).toEqual([
      { n: 1, speaker: "Alex Kim", at: 3, text: "Morning everyone. Let's start with the export." },
      { n: 2, speaker: "Dana Ruiz", at: 10, text: "We need a CSV export for the & rates page." },
    ]);
  });

  it("reads the older 'Name: words' cues", () => {
    expect(parseVtt("WEBVTT\n\n00:01:00.000 --> 00:01:02.000\nSam Lee: Next item\n")[0]).toEqual({ n: 1, speaker: "Sam Lee", at: 60, text: "Next item" });
  });

  it("refuses a file that isn't WebVTT or has no lines", () => {
    expect(() => parseVtt("hello")).toThrow(TranscriptError);
    expect(() => parseVtt("WEBVTT\n\nNOTE nothing here\n")).toThrow(TranscriptError);
  });

  it("parses a Teams .docx transcript into the same structure as the .vtt", () => {
    const xml = docxXml(["Alex Kim   0:03", "Morning everyone.", "Alex Kim   0:05", "Let's start with the export.", "Dana Ruiz   0:10", "We need a CSV export for the &amp; rates page."]);
    expect(parseDocxXml(xml)).toEqual(parseVtt(VTT));
  });

  it("parses a heading and words in one paragraph", () => {
    expect(parseDocxXml(docxXml(["Dana Ruiz 1:02:03 Ship it Friday."]))).toEqual([{ n: 1, speaker: "Dana Ruiz", at: 3723, text: "Ship it Friday." }]);
  });

  it("refuses a document with no transcript in it", () => {
    expect(() => parseDocxXml(docxXml(["Quarterly notes", "Nothing timed here"]))).toThrow(TranscriptError);
  });

  it("splits an overlong line at a sentence end", () => {
    const long = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} is here and it goes on a bit.`).join(" ");
    const lines = parseVtt(`WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<v A>${long}</v>\n`);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every((l) => l.text.length <= MAX_LINE_CHARS)).toBe(true);
    expect(lines.map((l) => l.text).join(" ")).toBe(long);
  });

  it("reads times with or without hours", () => {
    expect(timeOf("01:02.5")).toBe(62.5);
    expect(timeOf("1:00:00,250")).toBe(3600.25);
    expect(timeOf("nope")).toBeNull();
  });

  it("quotes at most two cited lines that exist, cut short", () => {
    const lines = parseVtt(VTT);
    expect(quotesOf(lines, [2, 99, 1, 1])).toEqual([
      { n: 1, speaker: "Alex Kim", at: "0:03", text: "Morning everyone. Let's start with the export." },
      { n: 2, speaker: "Dana Ruiz", at: "0:10", text: "We need a CSV export for the & rates page." },
    ]);
  });

  it("sends a one-hour meeting in one window and a very long one in overlapping windows", () => {
    const hour = Array.from({ length: 600 }, (_, i) => ({ n: i + 1, speaker: i % 2 ? "A" : "B", at: i * 6, text: "word ".repeat(15).trim() }));
    expect(windowsOf(hour)).toHaveLength(1);
    const long = Array.from({ length: 3000 }, (_, i) => ({ n: i + 1, speaker: "A", at: i, text: "word ".repeat(15).trim() }));
    const w = windowsOf(long);
    expect(w.length).toBeGreaterThan(1);
    expect(w[0]!.at(-1)!.n).toBeGreaterThan(w[1]![0]!.n);
    expect(w.at(-1)!.at(-1)!.n).toBe(3000);
    expect(numbered(long.slice(0, 1))).toBe("L1 [0:00] A: word word word word word word word word word word word word word word word");
  });
});
