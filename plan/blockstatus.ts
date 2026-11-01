// One status per block (step 10): the card, Today and the Plan button say one plain thing, details are a click away.
import type { Risk } from "../week/types.ts";
import type { Fit } from "./rules.ts";

export type BlockStatus = { kind: "at_risk" | "too_much" | "tight" | "fits" | "none"; label: string; detail: string | null };

/**
 * At risk wins (a meeting or event threatens the block), then too much planned, then fits. "Watch" risks and a
 * tight fit read as "Fits" with the detail behind a click; nothing planned and no risk shows nothing.
 */
export function blockStatus(fit: Fit | null, risks: readonly Risk[]): BlockStatus {
  const atRisk = risks.find((r) => r.severity === "at_risk");
  if (atRisk) return { kind: "at_risk", label: "At risk", detail: atRisk.reason };
  if (fit?.kind === "over") return { kind: "too_much", label: "Too much planned", detail: `About ${roundHours(fit.by)} more than the free time left` };
  if (fit?.kind === "tight") return { kind: "tight", label: "Fits, just", detail: `${fit.spare} min to spare` };
  if (fit?.kind === "fits") return { kind: "fits", label: "Fits", detail: null };
  return { kind: "none", label: "", detail: null };
}

/** "45 min", "1 h", "1.5 h": to the half hour above an hour, plain minutes below. */
export function roundHours(minutes: number): string {
  if (minutes < 60) return `${Math.max(5, Math.round(minutes / 5) * 5)} min`;
  const h = Math.round(minutes / 30) / 2;
  return `${h} h`;
}
