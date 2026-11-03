// U6 (D410, D413): Plan the week one client at a time. Which clients get a line (followed clients with blocks this
// week, in the order of their first block, plus one with a must pinned to Friday), what each line says, how many are
// planned (a must, or marked Nothing this week), and which opens first (the first with trouble: over budget or a must
// that needs stories; otherwise the first). Pure.
import type { IsoDate } from "../week/types.ts";
import type { ClientBudget } from "./weekplan.ts";

type ItemLike = { clientKey: string; itemId: number; tier: "must" | "nice"; level: "feature" | "story"; parentId: number | null; slots: readonly { date: IsoDate; half: "AM" | "PM" }[] };

export type WeekLine = {
  clientKey: string;
  /** Its first half-day this week, "2026-11-09 AM". */
  first: string;
  fit: ClientBudget | null;
  /** Musts on its list (a story nested under a listed feature counts with the feature), draft features included. */
  musts: number;
  /** Musts that need stories. */
  needs: number;
  quiet: boolean;
  trouble: boolean;
};

const order = (date: IsoDate, half: "AM" | "PM") => `${date} ${half}`;

export function weekLines<I extends ItemLike>(o: {
  fits: readonly ClientBudget[];
  items: readonly I[];
  days: readonly { date: IsoDate; kind: string }[];
  drafts?: readonly { clientKey: string; tier: "must" | "nice" }[];
  quiet?: readonly string[];
  needs: (i: I) => boolean;
}): WeekLine[] {
  const firsts = new Map<string, string>();
  for (const f of o.fits) {
    // S1: a client whose blocks are all on PTO keeps its line ("No time this week").
    const b = [...(f.blocks.length ? f.blocks : (f.ptoBlocks ?? []))].map((x) => order(x.date, x.half)).sort()[0];
    if (b) firsts.set(f.clientKey, b);
  }
  const fridays = new Set(o.days.filter((d) => d.kind === "overflow").map((d) => d.date));
  for (const i of o.items) {
    if (firsts.has(i.clientKey) || i.tier !== "must") continue;
    const s = i.slots.find((x) => fridays.has(x.date));
    if (s) firsts.set(i.clientKey, order(s.date, s.half));
  }
  const quiet = new Set(o.quiet ?? []);
  return [...firsts.entries()]
    .sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
    .map(([clientKey, first]) => {
      const mine = o.items.filter((i) => i.clientKey === clientKey);
      const features = new Set(mine.filter((i) => i.level === "feature").map((i) => i.itemId));
      const musts = mine.filter((i) => i.tier === "must" && !(i.level === "story" && i.parentId !== null && features.has(i.parentId)));
      const drafts = (o.drafts ?? []).filter((d) => d.clientKey === clientKey && d.tier === "must").length;
      const fit = o.fits.find((f) => f.clientKey === clientKey) ?? null;
      const needs = musts.filter(o.needs).length;
      return { clientKey, first, fit, musts: musts.length + drafts, needs, quiet: quiet.has(clientKey), trouble: fit?.status === "over" || needs > 0 };
    });
}

/** S1 (D453): a client whose blocks that week are all on PTO: its line says "No time this week"; the header leaves it out. */
export const onlyPto = (l: WeekLine) => !!l.fit && l.fit.blocks.length === 0 && (l.fit.ptoBlocks?.length ?? 0) > 0;
/** The lines the header counts: not the PTO-only ones. */
export const countedLines = (lines: readonly WeekLine[]) => lines.filter((l) => !onlyPto(l));

/** "N of M clients planned": a client with a must, or one marked Nothing this week. */
export const plannedCount = (lines: readonly WeekLine[]) => lines.filter((l) => l.musts > 0 || l.quiet).length;

/** The client the view opens on: the first with trouble, else the first. */
export const planOpenClient = (lines: readonly WeekLine[]): string | null => (lines.find((l) => l.trouble) ?? lines[0])?.clientKey ?? null;
