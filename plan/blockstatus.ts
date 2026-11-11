// One status per block (step 10): the card, Day and the panel say one plain thing, details are a click away.
// QT-1: only the calendar makes a block's status. A meeting, a personal event or out of office cutting into the block
// makes it At risk (week/risks.ts); how much is planned never does, and there is no "Fits", "Room for…" or "over".
import type { Risk } from "../week/types.ts";

/** short (U2): the risk's reason in a few words ("At risk · Dentist 12:00"); null when not at risk. */
export type BlockStatus = { kind: "at_risk" | "none"; label: string; detail: string | null; short?: string | null };

/** At risk when a calendar rule says so (red, with its reason); otherwise nothing. Watch alone shows no status. */
export function blockStatus(risks: readonly Risk[]): BlockStatus {
  const atRisk = risks.find((r) => r.severity === "at_risk");
  if (atRisk) return { kind: "at_risk", label: "At risk", detail: atRisk.reason, short: atRisk.short ?? null };
  return { kind: "none", label: "", detail: null };
}

/** QT-1: the Watch reasons for a hover (a card's header, the panel's time line); null when there are none. */
export function watchTip(risks: readonly Risk[]): string | null {
  const w = risks.filter((r) => r.severity === "watch").map((r) => r.reason);
  return w.length ? w.join("\n") : null;
}
