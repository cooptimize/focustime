import { describe, expect, it } from "vitest";
import { transcriptDocx, transcriptVtt, zipOf } from "../test/docx.ts";
import { MAX_UPLOAD_BYTES, readTranscriptFile } from "./transcript-file.ts";

const cues = [
  { speaker: "Alex Kim", at: "0:03", text: "Morning everyone." },
  { speaker: "Dana Ruiz", at: "0:10", text: "We need a CSV export for the rates page." },
  { speaker: "Alex Kim", at: "1:05", text: "I'll draft it by Thursday." },
];

describe("uploaded transcript files (MC-1)", () => {
  it(".vtt and .docx parse into the same lines", () => {
    const vtt = readTranscriptFile("call.vtt", new TextEncoder().encode(transcriptVtt(cues)));
    const docx = readTranscriptFile("call.docx", transcriptDocx(cues));
    const stored = readTranscriptFile("call.docx", transcriptDocx(cues, { store: true }));
    expect(vtt.format).toBe("vtt");
    expect(docx.format).toBe("docx");
    expect(docx.lines).toEqual(vtt.lines);
    expect(stored.lines).toEqual(vtt.lines);
    expect(vtt.lines.map((l) => l.speaker)).toEqual(["Alex Kim", "Dana Ruiz", "Alex Kim"]);
  });

  it("knows the format from the bytes when the name doesn't say", () => {
    expect(readTranscriptFile("transcript", transcriptDocx(cues)).format).toBe("docx");
    expect(readTranscriptFile("transcript", new TextEncoder().encode(transcriptVtt(cues))).format).toBe("vtt");
  });

  it("refuses empty, oversized, unknown and broken files in plain words", () => {
    expect(() => readTranscriptFile("a.vtt", new Uint8Array())).toThrow("That file is empty");
    expect(() => readTranscriptFile("a.vtt", new Uint8Array(MAX_UPLOAD_BYTES + 1))).toThrow("over 5 MB");
    expect(() => readTranscriptFile("a.pdf", new TextEncoder().encode("%PDF-1.7"))).toThrow(".vtt or .docx");
    expect(() => readTranscriptFile("a.docx", new TextEncoder().encode("PK not a zip"))).toThrow("can't be opened");
    expect(() => readTranscriptFile("a.docx", zipOf({ "other.xml": "<x/>" }))).toThrow("no document");
  });
});
