// AH-2: Ahead's readiness as quiet chips: an outlined chip with a small dot, the dot one muted amber when something
// needs doing (a gap, or a roadmap state like At risk), neutral otherwise. At most two per row, then "+N" with the rest
// in its tooltip. Text stays the normal text color. Grid, Gantt and Fix next share these.
import { GAP_ACTION, GAP_WORDS, type GapKind } from "../../plan/fixnext.ts";
import { STATE_WORDS, type RoadmapStateKind } from "../../plan/roadmap.ts";

export type Chip = { key: string; text: string; action: boolean; title: string; onClick?: () => void };

/** Roadmap states that ask for something; On track and Done don't. */
const CALM: ReadonlySet<RoadmapStateKind> = new Set(["on_track", "done"]);
export const stateChip = (state: RoadmapStateKind, reason: string): Chip => ({ key: `state:${state}`, text: STATE_WORDS[state], action: !CALM.has(state), title: `${STATE_WORDS[state]}: ${reason}` });
export const gapChip = (k: GapKind, onClick?: () => void): Chip => ({ key: `gap:${k}`, text: GAP_WORDS[k], action: true, title: `${GAP_WORDS[k]}: ${GAP_ACTION[k]}`, ...(onClick ? { onClick } : {}) });

export const MAX_CHIPS = 2;

/**
 * AH-3: `dots` (narrow windows): one small dot per chip, the words in the tooltip and for screen readers; the one
 * Break down click stays a button.
 */
export function ReadyChips({ chips, max = MAX_CHIPS, dots = false }: { chips: readonly Chip[]; max?: number; dots?: boolean }) {
  if (dots) {
    if (!chips.length) return null;
    const words = chips.map((c) => c.title).join("\n");
    return (
      <span className="ah-ready ah-dots" title={words}>
        {chips.map((c) =>
          c.onClick ? (
            <button key={c.key} type="button" tabIndex={-1} className={`ah-gapdot${c.action ? " action" : ""}`} onClick={c.onClick} title={c.title} aria-label={c.title} />
          ) : (
            <span key={c.key} className={`ah-gapdot${c.action ? " action" : ""}`} aria-hidden="true" />
          ),
        )}
        <span className="sr-only">{chips.map((c) => c.text).join(", ")}</span>
      </span>
    );
  }
  const shown = chips.slice(0, max);
  const rest = chips.slice(max);
  return (
    <span className="ah-ready">
      {shown.map((c) => <OneChip key={c.key} c={c} />)}
      {rest.length > 0 && (
        <span className="ah-chip ah-more" title={rest.map((c) => c.text).join("\n")}>
          +{rest.length}
        </span>
      )}
    </span>
  );
}

export function OneChip({ c }: { c: Chip }) {
  const body = (
    <>
      <span className={`ah-chip-dot${c.action ? " action" : ""}`} aria-hidden="true" />
      {c.text}
    </>
  );
  return c.onClick ? (
    <button type="button" tabIndex={-1} className="ah-chip" onClick={c.onClick} title={c.title}>
      {body}
    </button>
  ) : (
    <span className="ah-chip" title={c.title}>
      {body}
    </span>
  );
}
