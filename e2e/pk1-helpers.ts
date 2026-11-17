// PK-1: a Pocket export of the demo's fictional Northwind call, made here (never a real export), and a drop of files
// onto an element the way a browser delivers one. Used by e2e/week/call-pocket.test.ts and the PK-1 screenshots.
import type { Page } from "playwright-core";
import { zipOf } from "../test/docx.ts";
import { pocketPdf } from "../test/pdf.ts";

/** The demo call's words, as Pocket would number them: no names, no times. Line 5 names its speaker in its own words. */
export const POCKET_TURNS = [
  { label: "SPEAKER_00", text: "Morning everyone. Quick round on the order history export first." },
  { label: "SPEAKER_01", text: "The CSV export works well for us. We decided CSV only for now, Excel can wait until next quarter." },
  { label: "SPEAKER_02", text: "The Export button is on the order page in the test site, ready for a look." },
  { label: "SPEAKER_01", text: "Great. One more thing: our accountants need a monthly statement as a PDF from the same page. Nothing like that exists yet." },
  { label: "SPEAKER_00", text: "Alex here, I'll send you the date range filter for review by Thursday." },
  { label: "SPEAKER_01", text: "And I'll share three sample statements from last year so you can match the layout." },
  { label: "SPEAKER_02", text: "Next step on the export: I'll add the row limit warning before we ship it." },
  { label: "SPEAKER_00", text: "Thanks all, see you next week." },
];

/** Pocket's download (a zip with the PDF in it), dated `date` ("Nov 2, 2026"). */
export const pocketZip = (date = "Nov 2, 2026") => zipOf({ "Pocket export.pdf": pocketPdf({ date: `${date} • 27:02`, title: "Invented weekly call", turns: POCKET_TURNS, wrap: 70, perPage: 30 }) });

export type DropFile = { name: string; bytes: Uint8Array; type?: string };

/** A drag over the page and a drop on `selector` (or, with `stray`, on that element without a drop area): what the browser sends. Returns whether the page prevented the browser's own handling. */
export async function dropOn(page: Page, selector: string, files: readonly DropFile[]): Promise<boolean> {
  const dt = await page.evaluateHandle((fs) => {
    const d = new DataTransfer();
    for (const f of fs) d.items.add(new File([new Uint8Array(f.bytes)], f.name, { type: f.type ?? "" }));
    return d;
  }, files.map((f) => ({ name: f.name, bytes: [...f.bytes], type: f.type ?? "" })));
  return page.evaluate(([sel, d]) => {
    const el = document.querySelector(sel)!;
    const fire = (t: string, target: Element | Window) => {
      const e = new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: d as DataTransfer });
      target.dispatchEvent(e);
      return e.defaultPrevented;
    };
    fire("dragenter", document.body);
    fire("dragover", el);
    return fire("drop", el);
  }, [selector, dt] as const);
}

/** Only a drag over the page (no drop): the upload area shows it will take the file. */
export async function dragOver(page: Page, files: readonly DropFile[]): Promise<void> {
  const dt = await page.evaluateHandle((fs) => {
    const d = new DataTransfer();
    for (const f of fs) d.items.add(new File([new Uint8Array(f.bytes)], f.name));
    return d;
  }, files.map((f) => ({ name: f.name, bytes: [...f.bytes.subarray(0, 16)] })));
  await page.evaluate((d) => document.body.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer: d as DataTransfer })), dt);
}
