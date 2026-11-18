// DY-1: whether Day draws a block folded to one line. Pure: Day hands in what it knows about the block and the person.
//
// By itself, a block folds only on today, in the ordinary view (not Midday check-in, Close out or Timebox my day), with
// "Fold blocks that have ended" on, once its end has passed. It never folds by itself while its panel is open, or while
// the person is in it (keyboard focus, the pointer, or a menu or dialog open, when it ends). A fold or unfold by hand
// wins over that, for today, in this browser. A focus session on one of its to-dos, or a drag over it, opens it; with
// the option off every block is open.

export type FoldFacts = {
  /** The day shown is today. */
  isToday: boolean;
  /** The ordinary view: not Midday check-in, Close out or Timebox my day's suggestions. */
  ordinary: boolean;
  /** "Fold blocks that have ended" (on to start). */
  option: boolean;
  /** The block's end has passed. */
  ended: boolean;
  /** A focus session runs on one of the block's to-dos. */
  working: boolean;
  /** The block's panel is open. */
  panelOpen: boolean;
  /** A drag has passed over the block (it stays open until the drag ends). */
  dragOver: boolean;
  /** The person is in the block (focus or pointer inside) as it would fold: it waits until they leave. */
  inside: boolean;
  /** Folded (true) or unfolded (false) by hand today; undefined when untouched. */
  hand: boolean | undefined;
};

/** Folded by itself, before what the person did by hand. */
export function foldsByItself(f: Omit<FoldFacts, "hand" | "dragOver">): boolean {
  return f.isToday && f.ordinary && f.option && f.ended && !f.working && !f.panelOpen && !f.inside;
}

/** Whether the block is drawn folded. */
export function isFolded(f: FoldFacts): boolean {
  // Off, every block is drawn open; a focus session on one of its to-dos always shows (even folded by hand before).
  if (!f.isToday || !f.ordinary || !f.option || f.working || f.dragOver) return false;
  if (f.hand !== undefined) return f.hand;
  return foldsByItself(f);
}

/** What a folded line counts: done, not done (late once the block ended), and meetings. */
export type FoldCounts = { done: number; notDone: number; meetings: number };

export function foldCounts(picks: readonly { half: string; status: string }[], half: string, events: readonly { event: { showAs?: string | undefined; isPersonal?: boolean | undefined; unavailable?: unknown; allDay?: boolean | undefined; notMeeting?: unknown } }[]): FoldCounts {
  const mine = picks.filter((p) => p.half === half);
  return {
    done: mine.filter((p) => p.status === "done").length,
    notDone: mine.filter((p) => p.status === "planned").length,
    // Meetings as everywhere else (isMeeting): not personal events, my own timeboxes and solo time, all-day or unavailable time.
    meetings: events.filter((e) => !e.event.allDay && !e.event.unavailable && !e.event.isPersonal && !e.event.notMeeting && e.event.showAs !== "free").length,
  };
}

/** The folded line's words: "2 done · 1 not done · 3 meetings" (parts with nothing left out; "Nothing planned" alone). */
export function foldWords(c: FoldCounts): { done: string | null; notDone: string | null; meetings: string | null } {
  return {
    done: c.done ? `${c.done} done` : c.notDone ? null : "Nothing planned",
    notDone: c.notDone ? `${c.notDone} not done` : null,
    meetings: c.meetings ? `${c.meetings} meeting${c.meetings === 1 ? "" : "s"}` : null,
  };
}

// ---- folds by hand: kept for today in this browser, forgotten the next day; nothing goes to the server ----

export type HandFolds = { date: string; folds: Record<string, boolean> };

/** The stored folds, only when they are for `today` (another day's are forgotten). */
export function readHandFolds(raw: string | null, today: string): Record<string, boolean> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as Partial<HandFolds>;
    if (!v || v.date !== today || typeof v.folds !== "object" || v.folds === null) return {};
    const out: Record<string, boolean> = {};
    for (const [k, b] of Object.entries(v.folds)) if (typeof b === "boolean" && /^(AM|PM|EVE)$/.test(k)) out[k] = b;
    return out;
  } catch {
    return {};
  }
}

export const writeHandFolds = (today: string, folds: Record<string, boolean>): string => JSON.stringify({ date: today, folds } satisfies HandFolds);

// ---- arrival ----

/**
 * How far Day scrolls on arrival so the block under way (or the next one) shows its header and first to-dos, and the
 * now line is in view. Positions are in the page's pixels; `top` is the first line under Day's own header. 0: no scroll.
 */
export function arrivalScroll(m: { top: number; bottom: number; target: number; firstRows: number; now: number | null; blockHead: number }): number {
  const fits = (d: number) => m.target - d >= m.top && m.target - d + m.firstRows <= m.bottom && (m.now === null || (m.now - d >= m.top + m.blockHead && m.now - d <= m.bottom - 24));
  if (fits(0)) return 0;
  // As little as it takes (what is above, like Close out's card, stays in view where it can): the block's first lines
  // and the now line up into view. Past the block's top its header stays under Day's (sticky), so it is still seen.
  const rows = m.target + m.firstRows - m.bottom;
  const now = m.now === null ? 0 : m.now - (m.bottom - 24) + 40;
  const above = m.target - m.top;
  return Math.round(above < 0 ? above - 8 : Math.max(0, rows, now));
}
