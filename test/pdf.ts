// PK-1 tests: a PDF built in memory, with its text set in an embedded font under an Identity-H encoding, the way
// Pocket's export sets it. The font is made here (opentype.js: one box glyph per character used, in an order unlike
// the characters' own), so a glyph id is never the character's code and the text can only be read through the
// font's ToUnicode map. Invented words only; nothing here is a real export.
// @ts-expect-error opentype.js ships no types
import opentype from "opentype.js";

export type PdfLine = { text: string; /** Points from the page's left edge (72 by default). */ x?: number };
export type PdfPage = readonly PdfLine[] | { lines: readonly PdfLine[]; extra?: string };

type Built = { bytes: Uint8Array };

/** A font with one glyph per character in `chars` (plus .notdef), glyph ids in reverse order of first use. */
function fontOf(chars: readonly string[]): { otf: Uint8Array; gid: Map<string, number> } {
  const box = () => {
    const p = new opentype.Path();
    p.moveTo(50, 0);
    p.lineTo(450, 0);
    p.lineTo(450, 600);
    p.lineTo(50, 600);
    p.close();
    return p;
  };
  const order = [...chars].reverse();
  const glyphs = [new opentype.Glyph({ name: ".notdef", unicode: 0, advanceWidth: 500, path: new opentype.Path() })];
  const gid = new Map<string, number>();
  for (const c of order) {
    gid.set(c, glyphs.length);
    glyphs.push(new opentype.Glyph({ name: `g${glyphs.length}`, unicode: c.codePointAt(0)!, advanceWidth: c === " " ? 250 : 500, path: c === " " ? new opentype.Path() : box() }));
  }
  const font = new opentype.Font({ familyName: "Invented", styleName: "Regular", unitsPerEm: 1000, ascender: 800, descender: -200, glyphs });
  return { otf: new Uint8Array(font.toArrayBuffer()), gid };
}

const hex4 = (n: number) => n.toString(16).toUpperCase().padStart(4, "0");

/**
 * A PDF: each page's lines from the top, 14 points apart, at 10 points. `extra` adds raw objects to a page's
 * dictionary (an /Annots array, an /AA) for the tests that check nothing in a PDF is run or followed; `catalog` adds
 * to the catalog (/OpenAction, /Names). `noText` gives pages with no text at all (a scan).
 */
export function pdfOf(pages: readonly PdfPage[], o: { catalog?: string; noText?: boolean; objects?: readonly string[] } = {}): Uint8Array {
  const all = pages.map((p) => (Array.isArray(p) ? { lines: p as readonly PdfLine[] } : (p as { lines: readonly PdfLine[]; extra?: string })));
  const chars = [...new Set(all.flatMap((p) => p.lines.flatMap((l) => [...l.text])).concat(" "))];
  const { otf, gid } = fontOf(chars);
  const enc = new TextEncoder();
  const objs: (string | Uint8Array)[][] = [];
  const add = (...parts: (string | Uint8Array)[]) => {
    objs.push(parts);
    return objs.length;
  };
  const stream = (dict: string, body: Uint8Array | string) => {
    const b = typeof body === "string" ? enc.encode(body) : body;
    return [`<< ${dict} /Length ${b.length} >>\nstream\n`, b, "\nendstream"];
  };
  const catalog = add(""); // filled below
  const pagesId = add("");
  const fontFile = add(...stream("/Subtype /OpenType", otf));
  const descriptor = add(`<< /Type /FontDescriptor /FontName /Invented /Flags 4 /FontBBox [0 -200 500 800] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 600 /StemV 80 /FontFile3 ${fontFile} 0 R >>`);
  const cid = add(`<< /Type /Font /Subtype /CIDFontType0 /BaseFont /Invented /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${descriptor} 0 R /DW 500 >>`);
  const cmap = [
    "/CIDInit /ProcSet findresource begin", "12 dict begin", "begincmap", "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def", "/CMapName /Adobe-Identity-UCS def", "/CMapType 2 def",
    "1 begincodespacerange", "<0000> <FFFF>", "endcodespacerange",
    `${gid.size} beginbfchar`, ...[...gid].map(([c, g]) => `<${hex4(g)}> <${hex4(c.codePointAt(0)!)}>`), "endbfchar",
    "endcmap", "CMapName currentdict /CMap defineresource pop", "end", "end",
  ].join("\n");
  const toUnicode = add(...stream("", cmap));
  const font = add(`<< /Type /Font /Subtype /Type0 /BaseFont /Invented /Encoding /Identity-H /DescendantFonts [${cid} 0 R] /ToUnicode ${toUnicode} 0 R >>`);
  for (const extra of o.objects ?? []) add(extra);
  const kids: number[] = [];
  for (const p of all) {
    const ops = o.noText
      ? "0.5 g 72 600 200 100 re f"
      : p.lines.map((l, i) => `BT /F1 10 Tf ${l.x ?? 72} ${780 - i * 14} Td <${[...l.text].map((c) => hex4(gid.get(c)!)).join("")}> Tj ET`).join("\n");
    const content = add(...stream("", ops));
    kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R ${p.extra ?? ""} >>`));
  }
  objs[pagesId - 1] = [`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`];
  objs[catalog - 1] = [`<< /Type /Catalog /Pages ${pagesId} 0 R ${o.catalog ?? ""} >>`];
  const chunks: Uint8Array[] = [enc.encode("%PDF-1.7\n%\xE2\xE3\xCF\xD3\n")];
  let at = chunks[0]!.length;
  const offsets: number[] = [];
  for (const [i, parts] of objs.entries()) {
    offsets.push(at);
    const bs = [enc.encode(`${i + 1} 0 obj\n`), ...parts.map((x) => (typeof x === "string" ? enc.encode(x) : x)), enc.encode("\nendobj\n")];
    for (const b of bs) {
      chunks.push(b);
      at += b.length;
    }
  }
  const xref = [`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`, ...offsets.map((x) => `${String(x).padStart(10, "0")} 00000 n \n`), `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${at}\n%%EOF\n`].join("");
  chunks.push(enc.encode(xref));
  return new Uint8Array(Buffer.concat(chunks));
}

/**
 * A Pocket-style export: the date and length at the top right of the first page, a title, the "Transcript" heading,
 * then turns ("SPEAKER_00: words"), each wrapped at `wrap` characters, a blank line between turns, `perPage` lines a
 * page. Invented words only.
 */
export function pocketPdf(o: { date?: string | null; title?: string; before?: readonly string[]; turns: readonly { label: string; text: string }[]; wrap?: number; perPage?: number; heading?: boolean }): Uint8Array {
  const wrap = o.wrap ?? 60;
  const rows: PdfLine[] = [];
  if (o.date !== null) rows.push({ text: o.date ?? "Nov 16, 2026 • 27:02", x: 420 });
  rows.push({ text: o.title ?? "Invented planning chat" });
  for (const b of o.before ?? []) rows.push({ text: b });
  if (o.heading !== false) rows.push({ text: "Transcript" });
  for (const t of o.turns) {
    const words = `${t.label}: ${t.text}`.split(" ");
    let cur = "";
    for (const w of words) {
      if (cur && cur.length + w.length + 1 > wrap) {
        rows.push({ text: cur });
        cur = w;
      } else cur = cur ? `${cur} ${w}` : w;
    }
    if (cur) rows.push({ text: cur });
    rows.push({ text: "" });
  }
  const per = o.perPage ?? 40;
  const pages: PdfLine[][] = [];
  for (let i = 0; i < rows.length; i += per) pages.push(rows.slice(i, i + per).filter((r) => r.text));
  return pdfOf(pages);
}

export type { Built };
