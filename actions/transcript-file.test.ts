import { createServer } from "node:http";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { pdfReader } from "../server/pdf-text.ts";
import { transcriptDocx, transcriptVtt, zipOf } from "../test/docx.ts";
import { pdfOf, pocketPdf } from "../test/pdf.ts";
import { kindOf, MAX_UPLOAD_BYTES, readTranscriptFile, ZIP_ENTRIES } from "./transcript-file.ts";

const cues = [
  { speaker: "Alex Kim", at: "0:03", text: "Morning everyone." },
  { speaker: "Dana Ruiz", at: "0:10", text: "We need a CSV export for the rates page." },
  { speaker: "Alex Kim", at: "1:05", text: "I'll draft it by Thursday." },
];
const enc = (s: string) => new TextEncoder().encode(s);
const readPdf = pdfReader();
const read = (b: Uint8Array) => readTranscriptFile(b, { readPdf });

/** Invented turns, long enough to wrap and to cross a page. */
const TURNS = [
  { label: "SPEAKER_00", text: "Morning. The invented widget page needs a second filter before the review, and the copper form too." },
  { label: "SPEAKER_01", text: "I can look at that. One thing: the export button still opens the old dialog on Tuesdays." },
  { label: "SPEAKER_00", text: "Noted. Let's say next steps: filter first, then the dialog." },
  { label: "SPEAKER_02", text: "Sounds right to me." },
];

describe("uploaded transcript files (MC-1)", () => {
  it(".vtt and .docx parse into the same lines", async () => {
    const vtt = await read(enc(transcriptVtt(cues)));
    const docx = await read(transcriptDocx(cues));
    const stored = await read(transcriptDocx(cues, { store: true }));
    expect(vtt.format).toBe("vtt");
    expect(docx.format).toBe("docx");
    expect(docx.lines).toEqual(vtt.lines);
    expect(stored.lines).toEqual(vtt.lines);
    expect(vtt.lines.map((l) => l.speaker)).toEqual(["Alex Kim", "Dana Ruiz", "Alex Kim"]);
    expect(vtt.lines.map((l) => l.at)).toEqual([3, 10, 65]);
  });

  it("refuses empty, oversized, unknown and broken files in plain words", async () => {
    await expect(read(new Uint8Array())).rejects.toThrow("That file is empty");
    await expect(read(new Uint8Array(MAX_UPLOAD_BYTES + 1))).rejects.toThrow("over 5 MB");
    await expect(read(enc("PK not a zip"))).rejects.toThrow("isn't one FocusTime reads");
    await expect(read(zipOf({ "other.xml": "<x/>" }))).rejects.toThrow("no transcript in it (1 other file)");
  });
});

describe("a Pocket export (PK-1)", () => {
  it("its zip and its PDF become the same lines: turns in order, wraps and pages joined, numbered speakers, the date and length", async () => {
    const pdf = pocketPdf({ turns: TURNS, wrap: 40, perPage: 5 });
    const alone = await read(pdf);
    const zipped = await read(zipOf({ "export.pdf": pdf }));
    expect(alone.format).toBe("pocket");
    expect(zipped.lines).toEqual(alone.lines);
    expect(alone.lines).toEqual([
      { n: 1, speaker: "Speaker 1", at: null, text: TURNS[0]!.text },
      { n: 2, speaker: "Speaker 2", at: null, text: TURNS[1]!.text },
      { n: 3, speaker: "Speaker 1", at: null, text: TURNS[2]!.text },
      { n: 4, speaker: "Speaker 3", at: null, text: TURNS[3]!.text },
    ]);
    expect(alone.recorded).toEqual({ date: "2026-11-16", length: "27:02" });
    expect(zipped.facts).toMatchObject({ kind: "pocket.zip", entries: 1 });
    expect(alone.facts.pages).toBeGreaterThan(1);
  });

  it("the PDF's text really is in an embedded font with an Identity-H encoding", () => {
    const pdf = new TextDecoder("latin1").decode(pocketPdf({ turns: TURNS }));
    expect(pdf).toContain("/Encoding /Identity-H");
    expect(pdf).toContain("/FontFile3");
    expect(pdf).toContain("/ToUnicode");
    expect(pdf).not.toContain("SPEAKER_00"); // the words are glyph ids, not text
  });

  it("a stored (not deflated) zip and a zip with folders and other files read the same", async () => {
    const pdf = pocketPdf({ turns: TURNS });
    const lines = (await read(pdf)).lines;
    expect((await read(zipOf({ "a.pdf": pdf }, { store: true }))).lines).toEqual(lines);
    expect((await read(zipOf({ "folder/": "", "folder/export.pdf": pdf, "notes.txt": "invented" }))).lines).toEqual(lines);
  });

  it("a zip holding a Teams .vtt or .docx reads as that", async () => {
    expect((await read(zipOf({ "t.vtt": transcriptVtt(cues) }))).format).toBe("vtt");
    expect((await read(zipOf({ "t.docx": transcriptDocx(cues) }))).format).toBe("docx");
  });

  it("refuses a zip it shouldn't open, saying what it found by kind and count, never by name", async () => {
    const pdf = pocketPdf({ turns: TURNS });
    const cases: [Uint8Array, string][] = [
      [zipOf({ "secret-plan.txt": "invented", "b.png": "x" }), "That zip has no transcript in it (2 other files)"],
      [zipOf({ "secret-a.pdf": pdf, "secret-b.pdf": pdf }), "That zip holds 2 PDFs"],
      [zipOf({ "secret-a.pdf": pdf, "secret-b.vtt": transcriptVtt(cues) }), "That zip holds 1 PDF and 1 .vtt file"],
      [zipOf({ "secret-a.pdf": pdf, "secret-inner.zip": zipOf({ "x.pdf": pdf }) }), "another archive inside it"],
      [zipOf({ "secret.gz": new Uint8Array([0x1f, 0x8b, 8, 0, 0, 0]), "x.pdf": pdf }), "another archive inside it"],
      [zipOf(Object.fromEntries(Array.from({ length: ZIP_ENTRIES + 1 }, (_, i) => [`secret-${i}.txt`, "x"]))), `That zip holds ${ZIP_ENTRIES + 1} files`],
      [zipOf({ "secret-big.bin": "\0".repeat(21 * 1024 * 1024) }), "over 20 MB unpacked"],
      // A bomb whose headers say 10 bytes each: inflating stops at the limit, whatever the headers say.
      [zipOf({ "secret-a.bin": "\0".repeat(15 * 1024 * 1024), "secret-b.bin": "\0".repeat(15 * 1024 * 1024) }, { lie: true }), "over 20 MB unpacked"],
    ];
    for (const [bytes, words] of cases) {
      expect(bytes.length).toBeLessThan(MAX_UPLOAD_BYTES);
      const e = await read(bytes).then(() => null, (x: Error) => x);
      expect(e?.message).toContain(words);
      expect(e?.message).not.toMatch(/secret|\.txt|\.png|\.bin|\.gz|inner/);
    }
  });

  it("decides a file's kind by its content, not its name", async () => {
    expect(kindOf(enc("not really a pdf, just named like one"))).toBe("other");
    await expect(read(enc("not really a pdf, just named like one"))).rejects.toThrow("That file isn't one FocusTime reads. FocusTime reads a Teams transcript (.vtt or .docx) or a Pocket export (.zip or .pdf)");
    // A PDF header with nothing after it: a PDF, but one that can't be opened.
    await expect(read(enc("%PDF-1.7\nnothing else"))).rejects.toThrow("That PDF can't be opened");
  });

  it("refuses a PDF with no text (a scan), one with no turns, one over 500 pages and one that takes too long", async () => {
    await expect(read(pdfOf([[{ text: "x" }]], { noText: true }))).rejects.toThrow("That PDF has no text in it: it may be a scan");
    await expect(read(pdfOf([[{ text: "An invented letter" }, { text: "Dear team: hello" }]]))).rejects.toThrow("FocusTime found no transcript in that PDF");
    await expect(read(pdfOf(Array.from({ length: 501 }, () => [])))).rejects.toThrow("That PDF has 501 pages. FocusTime reads a PDF of up to 500");
    await expect(readTranscriptFile(pocketPdf({ turns: TURNS }), { readPdf: pdfReader({ timeoutMs: 1 }) })).rejects.toThrow("took over 10 seconds");
  });

  it("without a PDF reader a PDF is refused in plain words", async () => {
    await expect(readTranscriptFile(pocketPdf({ turns: TURNS }))).rejects.toThrow("can't read a PDF here");
  });
});

describe("Pocket intake is safe (PK-1)", () => {
  const dirs: string[] = [];
  afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

  it("an entry named with a path writes nothing anywhere", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pk1-"));
    dirs.push(dir);
    const r = await read(zipOf({ "../../../../tmp/pk1-escape.pdf": pocketPdf({ turns: TURNS }), "/etc/pk1-escape.txt": "x" }));
    expect(r.format).toBe("pocket");
    expect(readdirSync(dir)).toEqual([]);
    expect(readdirSync(tmpdir()).filter((f) => f.includes("pk1-escape"))).toEqual([]);
    expect(readdirSync(process.cwd()).filter((f) => f.includes("pk1-escape"))).toEqual([]);
  });

  it("nothing in a PDF is run or followed: a link, an open action, a script and a launch reach nothing", async () => {
    let hits = 0;
    const srv = createServer((_q, res) => {
      hits++;
      res.end();
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    const url = `http://127.0.0.1:${(srv.address() as { port: number }).port}/pk1`;
    try {
      const pdf = pdfOf(
        [{ lines: [{ text: "Transcript" }, { text: "SPEAKER_00: An invented line." }], extra: `/Annots [<< /Type /Annot /Subtype /Link /Rect [0 0 600 800] /A << /S /URI /URI (${url}) >> >>] /AA << /O << /S /JavaScript /JS (app.launchURL\\('${url}'\\);) >> >>` }],
        { catalog: `/OpenAction << /S /JavaScript /JS (this.submitForm\\('${url}'\\); app.launchURL\\('${url}'\\);) /Next << /S /Launch /F (calc.exe) >> >> /AcroForm << /Fields [] /XFA (${url}) >>` },
      );
      const r = await readPdf(pdf);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.blocked).toBe(0);
        expect(r.lines).toContain("SPEAKER_00: An invented line.");
      }
      await new Promise((res) => setTimeout(res, 200));
      expect(hits).toBe(0);
    } finally {
      srv.close();
    }
  });
});
