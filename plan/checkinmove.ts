// U2: Check-in's one move for a pick that isn't done (QT-2: every unfinished to-do has it, not only ones that "don't fit").
// Owed today: make it up tonight. Else the same client's later block today, else the next workday, else tonight.
// Everything else stays in the pick's ⋯ menu. Pure.
import type { Half, IsoDate } from "../week/types.ts";

export type SuggestedMove = { kind: "move"; date: IsoDate; half: Half; label: string } | { kind: "tonight"; label: string };

const HALF_SHORT: Record<Half, string> = { AM: "AM", PM: "PM", EVE: "this evening" };

export function suggestedMove(
  p: { clientKey: string; half: Half; date: IsoDate },
  o: {
    /** The follow-up this pick is for is due today or overdue. */
    owedToday: boolean;
    /** Later blocks today that haven't ended, with their client (null for an Open half-day). */
    later: readonly { half: Half; clientKey: string | null }[];
    /** The next plannable day (Close out's carry-over day), or null. */
    carryTo: IsoDate | null;
  },
): SuggestedMove {
  if (o.owedToday) return { kind: "tonight", label: "Tonight" };
  const same = o.later.find((b) => b.half !== p.half && b.half !== "EVE" && b.clientKey === p.clientKey);
  if (same) return { kind: "move", date: p.date, half: same.half, label: `Move to ${HALF_SHORT[same.half]}` };
  if (o.carryTo) {
    const day = Temporal.PlainDate.from(o.carryTo).toLocaleString("en-US", { weekday: "short" });
    return { kind: "move", date: o.carryTo, half: p.half === "EVE" ? "AM" : p.half, label: `Move to ${day}` };
  }
  return { kind: "tonight", label: "Tonight" };
}
