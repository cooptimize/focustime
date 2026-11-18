// PK-1: the PDF reader's worker thread (server/pdf-text.ts starts one per file and ends it after 10 seconds). Only a
// PDF's text is read: pdf.js's getTextContent, page by page. Nothing in the file is run, opened or followed: no eval,
// no fonts loaded, no XFA, no scripts (pdf.js runs a PDF's JavaScript only in a viewer's sandbox, never here), no
// annotations, links, forms or attachments asked for. Network use is cut off before pdf.js loads: fetch, and the
// http and https modules' requests, throw and are counted. Nothing is logged and nothing is written to disk; the text
// goes back to the parent once, as lines, and the thread ends.
import { parentPort, workerData } from "node:worker_threads";
import { pageLines, type PdfItem } from "../plan/pocket.ts";

type In = { data: Uint8Array; maxPages: number; maxChars: number };
export type PdfWorkerOut = { ok: true; pages: number; lines: string[]; blocked: number } | { ok: false; reason: "pages" | "locked" | "damaged" | "large"; pages?: number; blocked: number };

let blocked = 0;
const refuse = () => {
  blocked++;
  throw new Error("No network from the PDF reader");
};
globalThis.fetch = (async () => refuse()) as typeof fetch;
for (const m of ["node:http", "node:https"]) {
  const mod = ((await import(m)) as { default: { request: unknown; get: unknown } }).default;
  mod.request = refuse;
  mod.get = refuse;
}

async function read({ data, maxPages, maxChars }: In): Promise<PdfWorkerOut> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({
    data,
    // pdf.js 6 never compiles a font into code (it has no eval path left); no WebAssembly decoders either.
    useWasm: false,
    disableFontFace: true,
    useSystemFonts: false,
    enableXfa: false,
    disableAutoFetch: true,
    disableStream: true,
    disableRange: true,
    stopAtErrors: false,
    verbosity: 0,
  });
  let doc;
  try {
    doc = await task.promise;
  } catch (e) {
    return { ok: false, reason: (e as { name?: string })?.name === "PasswordException" ? "locked" : "damaged", blocked };
  }
  if (doc.numPages > maxPages) return { ok: false, reason: "pages", pages: doc.numPages, blocked };
  const lines: string[] = [];
  let chars = 0;
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    for (const l of pageLines(tc.items as PdfItem[])) {
      chars += l.length + 1;
      if (chars > maxChars) return { ok: false, reason: "large", blocked };
      lines.push(l);
    }
    page.cleanup();
  }
  const pages = doc.numPages;
  await task.destroy();
  return { ok: true, pages, lines, blocked };
}

if (parentPort) {
  const out = await read(workerData as In).catch((): PdfWorkerOut => ({ ok: false, reason: "damaged", blocked }));
  parentPort.postMessage(out);
}
