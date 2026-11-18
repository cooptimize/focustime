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
/**
 * The most the process may grow while one PDF is read (PK-1 review). The worker's resourceLimits cap only its
 * JavaScript heap; pdf.js decodes streams into buffers outside it, so a 1 MB PDF holding 1 GB of compressed spaces
 * took the process past 2 GB. The process's size is watched every 25 ms and the worker ended past this.
 */
const MEMORY_MB = 512;
/** PDFs read at once; more wait their turn, and past WAITING waiting the upload is refused as busy. */
const AT_ONCE = 2;
const WAITING = 8;

export type PdfText = { ok: true; pages: number; lines: string[]; blocked: number } | { ok: false; reason: "pages" | "locked" | "damaged" | "large" | "slow" | "busy"; pages?: number };
export type ReadPdf = (bytes: Uint8Array) => Promise<PdfText>;

export function pdfReader(o: { timeoutMs?: number; maxPages?: number; memoryMb?: number; atOnce?: number; waiting?: number } = {}): ReadPdf {
  const timeoutMs = o.timeoutMs ?? PDF_SECONDS * 1000;
  const maxPages = o.maxPages ?? PDF_MAX_PAGES;
  const memory = (o.memoryMb ?? MEMORY_MB) * 1024 * 1024;
  const atOnce = o.atOnce ?? AT_ONCE;
  const waitMax = o.waiting ?? WAITING;
  let running = 0;
  const queue: (() => void)[] = [];
  const one = (bytes: Uint8Array) =>
    new Promise<PdfText>((resolve) => {
      let done = false;
      const start = process.memoryUsage.rss();
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
        clearInterval(watch);
        void w.terminate();
        resolve(r);
      };
      const timer = setTimeout(() => finish({ ok: false, reason: "slow" }), timeoutMs);
      const watch = setInterval(() => process.memoryUsage.rss() - start > memory && finish({ ok: false, reason: "large" }), 25);
      w.once("message", (m: PdfWorkerOut) => finish(m.ok ? m : { ok: false, reason: m.reason, ...(m.pages !== undefined ? { pages: m.pages } : {}) }));
      w.once("error", (e: Error & { code?: string }) => finish({ ok: false, reason: e.code === "ERR_WORKER_OUT_OF_MEMORY" ? "large" : "damaged" }));
      w.once("exit", () => finish({ ok: false, reason: "damaged" }));
    });
  return async (bytes) => {
    // A turn is handed straight from the one ending to the first waiting, so never more than atOnce run.
    if (running >= atOnce) {
      if (queue.length >= waitMax) return { ok: false, reason: "busy" };
      await new Promise<void>((r) => queue.push(r));
    } else running++;
    try {
      return await one(bytes);
    } finally {
      const turn = queue.shift();
      if (turn) turn();
      else running--;
    }
  };
}
