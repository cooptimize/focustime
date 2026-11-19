// MC-7: a pasted transcript or notes to lines, and which of the two a text is. Made-up words only.
import { describe, expect, it } from "vitest";
import { MAX_LINES, parseVtt, readPaste } from "./transcript.ts";

const said = (t: string) => readPaste(t).lines.map((l) => [l.speaker, l.at, l.text]);

describe("readPaste: a pasted transcript's shapes", () => {
  it("Name: words, with no times", () => {
    const r = readPaste("Alex Rivera: Morning all.\nDana Brooks: The export works.\nAlex Rivera: Good, I'll send the filter.\nDana Brooks: Thanks.");
    expect(r.as).toBe("transcript");
    expect(r.speakers).toBe(2);
    expect(said("Alex Rivera: Morning all.\nDana Brooks: The export works.\nAlex Rivera: Good.\nDana Brooks: Thanks.")).toEqual([
      ["Alex Rivera", null, "Morning all."],
      ["Dana Brooks", null, "The export works."],
      ["Alex Rivera", null, "Good."],
      ["Dana Brooks", null, "Thanks."],
    ]);
  });

  it("a name and a time on one line, the words under it", () => {
    expect(said("Alex Rivera  0:03\nMorning all.\nDana Brooks  0:15\nThe export works.\nIt is fast too.")).toEqual([
      ["Alex Rivera", 3, "Morning all."],
      ["Dana Brooks", 15, "The export works. It is fast too."],
    ]);
  });

  it("a name alone with its time on the next line", () => {
    expect(said("Alex Rivera\n0:03\nMorning all.\nDana Brooks\n1:02:05\nThe export works.")).toEqual([
      ["Alex Rivera", 3, "Morning all."],
      ["Dana Brooks", 3725, "The export works."],
    ]);
  });

  it("a time, then a name, then words", () => {
    expect(said("00:00:05 Alex Rivera: Morning all.\n[00:01:10] Dana Brooks: The export works.")).toEqual([
      ["Alex Rivera", 5, "Morning all."],
      ["Dana Brooks", 70, "The export works."],
    ]);
  });

  it("numbered and lettered speakers are kept and said to be numbered", () => {
    const r = readPaste("Speaker 1: Morning.\nSpeaker B: The export works.\nSpeaker 1: Good.");
    expect(r.as).toBe("transcript");
    expect(r.numbered).toBe(true);
    expect(r.lines.map((l) => l.speaker)).toEqual(["Speaker 1", "Speaker B", "Speaker 1"]);
  });

  it("a line that fits no shape joins the line before it", () => {
    expect(said("Alex Rivera: Morning all, quick round\non the export first.\nDana Brooks: Fine.\nAlex Rivera: Ok.")).toEqual([
      ["Alex Rivera", null, "Morning all, quick round on the export first."],
      ["Dana Brooks", null, "Fine."],
      ["Alex Rivera", null, "Ok."],
    ]);
  });

  it("a clock time (10:03 AM) is no time into the call", () => {
    expect(said("Alex Rivera 10:03 AM\nMorning.\nDana Brooks 10:04 AM\nHi.")).toEqual([
      ["Alex Rivera", null, "Morning."],
      ["Dana Brooks", null, "Hi."],
    ]);
  });

  it("a pasted .vtt gives what the same .vtt gives as a file", () => {
    const vtt = "WEBVTT\n\n00:00:05.000 --> 00:00:09.000\n<v Alex Rivera>Morning all.</v>\n\n00:00:10.000 --> 00:00:12.000\n<v Dana Brooks>The export works.</v>\n";
    const r = readPaste(vtt);
    expect(r.as).toBe("transcript");
    expect(r.lines).toEqual(parseVtt(vtt));
  });
});

describe("readPaste: which reading a text gets", () => {
  it("mostly speaker lines is a transcript; bullets and sentences are notes", () => {
    expect(readPaste("Alex Rivera: One.\nDana Brooks: Two.\nAlex Rivera: Three.").as).toBe("transcript");
    expect(readPaste("- Export works, CSV only for now\n- Priya to add the row limit warning\n- I'll send the filter by Thursday").as).toBe("notes");
    expect(readPaste("We talked about the export. Dana liked it.\nNext week we look at statements.").as).toBe("notes");
  });

  it("labels written before a colon in notes aren't speakers", () => {
    const r = readPaste("Decision: CSV only\nNext steps: send the filter\nBudget: as planned\nTimeline: two weeks");
    expect(r.as).toBe("notes");
  });

  it("the switch reads the same text the other way", () => {
    const t = "Alex Rivera: One.\nDana Brooks: Two.\nAlex Rivera: Three.";
    const n = readPaste(t, "notes");
    expect(n.as).toBe("notes");
    expect(n.lines.map((l) => [l.speaker, l.at, l.text])).toEqual([["", null, "Alex Rivera: One."], ["", null, "Dana Brooks: Two."], ["", null, "Alex Rivera: Three."]]);
    expect(readPaste("- one thing\n- another thing here", "transcript").as).toBe("transcript");
  });
});

describe("readPaste: notes", () => {
  it("drop blank lines and bullet marks; each line is one line with no speaker and no time", () => {
    const r = readPaste("* Export works\n\n  1. Priya to confirm the dates\n• I'll send the filter\n[ ] statements later");
    expect(r.lines).toEqual([
      { n: 1, speaker: "", at: null, text: "Export works" },
      { n: 2, speaker: "", at: null, text: "Priya to confirm the dates" },
      { n: 3, speaker: "", at: null, text: "I'll send the filter" },
      { n: 4, speaker: "", at: null, text: "statements later" },
    ]);
    expect(r.speakers).toBe(0);
  });
});

describe("readPaste: limits", () => {
  it("a few words at least", () => {
    expect(readPaste("ok").tooShort).toBe(true);
    expect(readPaste("   \n\n").tooShort).toBe(true);
    expect(readPaste("the export works").tooShort).toBe(false);
  });
  it("no more lines than a transcript may have", () => {
    expect(readPaste(Array.from({ length: MAX_LINES }, (_, i) => `- note ${i}`).join("\n")).tooLong).toBe(false);
    const over = readPaste(Array.from({ length: MAX_LINES + 1 }, (_, i) => `- note ${i}`).join("\n"));
    expect(over.tooLong).toBe(true);
    expect(over.lines.length).toBe(MAX_LINES);
  });
});
