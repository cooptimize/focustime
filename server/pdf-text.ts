// PK-1: a PDF's text, read in a worker thread that is ended after 10 seconds (or on its first answer), with its own
// memory limit, so a hostile PDF can't hold the server or fill its memory. Handed to the meeting actions as
// `readPdf` (server/main.ts, server/demo.ts): the core modules never start a thread themselves (the host boundary).
// The bytes are copied into the worker and go with it when it ends; nothing is logged, nothing is written to disk.
import { Worker } from "node:worker_threads";
import type { PdfWorkerOut } from "./pdf-text-worker.ts";

export const PDF_MAX_PAGES = 500;
export const PDF_SECONDS = 10;
/** The most text one PDF may give: far past any call's transcript. */
const MAX_CHARS = 4_000_000;

export type PdfText = { ok: true; pages: number; lines: string[]; blocked: number } | { ok: false; reason: "pages" | "locked" | "damaged" | "large" | "slow"; pages?: number };
export type ReadPdf = (bytes: Uint8Array) => Promise<PdfText>;

export function pdfReader(o: { timeoutMs?: number; maxPages?: number } = {}): ReadPdf {
  const timeoutMs = o.timeoutMs ?? PDF_SECONDS * 1000;
  const maxPages = o.maxPages ?? PDF_MAX_PAGES;
  return (bytes) =>
    new Promise<PdfText>((resolve) => {
      let done = false;
      const w = new Worker(new URL("./pdf-text-worker.ts", import.meta.url), {
        workerData: { data: bytes.slice(), maxPages, maxChars: MAX_CHARS },
        resourceLimits: { maxOldGenerationSizeMb: 384, maxYoungGenerationSizeMb: 48, codeRangeSizeMb: 64 },
        stdout: true,
        stderr: true,
      });
      // pdf.js's own warnings go nowhere: they can quote a file's contents.
      w.stdout.resume();
      w.stderr.resume();
      const finish = (r: PdfText) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        void w.terminate();
        resolve(r);
      };
      const timer = setTimeout(() => finish({ ok: false, reason: "slow" }), timeoutMs);
      w.once("message", (m: PdfWorkerOut) => finish(m.ok ? m : { ok: false, reason: m.reason, ...(m.pages !== undefined ? { pages: m.pages } : {}) }));
      w.once("error", (e: Error & { code?: string }) => finish({ ok: false, reason: e.code === "ERR_WORKER_OUT_OF_MEMORY" ? "large" : "damaged" }));
      w.once("exit", () => finish({ ok: false, reason: "damaged" }));
    });
}
