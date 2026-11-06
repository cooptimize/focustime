// One status per block (step 10): the card, Today and the Plan button say one plain thing, details are a click away.
import type { Risk } from "../week/types.ts";
import type { Fit } from "./rules.ts";
import { fitWords } from "./fit.ts";

/** short (U2): the risk's reason in a few words for the pill ("At risk · Dentist 12:00"); null when not at risk. */
export type BlockStatus = { kind: "at_risk" | "too_much" | "tight" | "fits" | "none"; label: string; detail: string | null; short?: string | null };

/**
 * At risk wins (a meeting or event threatens the block, red), then the plan's fit in the same calm words as Plan the
 * day (step 15, D266): "About 1h over" (amber), "Fits" or "Room for about 45m more" (neutral). "Watch" risks read as
 * the fit, with the detail behind a click; nothing planned and no risk shows nothing.
 */
export function blockStatus(fit: Fit | null, risks: readonly Risk[]): BlockStatus {
  const atRisk = risks.find((r) => r.severity === "at_risk");
  if (atRisk) return { kind: "at_risk", label: "At risk", detail: atRisk.reason, short: atRisk.short ?? null };
  const w = fitWords(fit);
  if (w.kind === "over") return { kind: "too_much", label: w.text, detail: "More planned than the block's free time. Shrink or move a to-do" };
  if (w.kind === "fits") return { kind: "tight", label: w.text, detail: null };
  if (w.kind === "room") return { kind: "fits", label: w.text, detail: null };
  return { kind: "none", label: "", detail: null };
}
