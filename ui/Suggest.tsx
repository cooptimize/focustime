// SG-1: the board's suggestions as people see them. An empty block's suggested to-dos sit in its card in the dotted
// style (type icon, title; a click or + keeps it, × clears it, a drag keeps it on the block it lands on), under one
// small line "Suggested · Keep all · Clear". A day with any says "5 suggested · Keep all · Clear" in Day's header
// row and in its header on Week. They are offers: they count against nothing, never nag and leave as soon as the
// block has work of its own. The rule is plan/boardsuggest.ts; keeping and clearing are in ui/Carry.tsx.
import type { Suggestion } from "../plan/boardsuggest.ts";
import { blockName } from "../plan/suggest.ts";
import type { Half, IsoDate } from "../week/types.ts";
import { useSuggest, type SuggestApi } from "./Carry.tsx";
import { TypeIcon } from "./TypeIcon.tsx";
import { useDragSource } from "./WeekStories.tsx";

/**
 * After a Keep or Clear the focused row goes; focus moves to the block's next suggestion, else the block itself (or
 * the day's header), never to the page's body.
 */
function holdFocus(from: HTMLElement) {
  const row = from.closest<HTMLElement>(".sug-row");
  const next = row?.nextElementSibling?.querySelector<HTMLElement>(".sug-take") ?? row?.previousElementSibling?.querySelector<HTMLElement>(".sug-take") ?? null;
  const home = from.closest<HTMLElement>("[data-drop], .day-head, .day-bar, .moment-card");
  const nextKey = next?.closest<HTMLElement>(".sug-row")?.dataset.sg ?? null;
  window.setTimeout(() => {
    if (document.activeElement && document.activeElement !== document.body && document.contains(document.activeElement)) return;
    const again = nextKey ? document.querySelector<HTMLElement>(`.sug-row[data-sg="${CSS.escape(nextKey)}"] .sug-take`) : null;
    const target = again ?? (home && document.contains(home) ? (home.matches("[tabindex]") ? home : home.querySelector<HTMLElement>("button, [tabindex]")) : null);
    target?.focus();
  }, 350);
}
const act = (e: { stopPropagation(): void; currentTarget: HTMLElement }, run: () => void) => {
  e.stopPropagation();
  holdFocus(e.currentTarget);
  run();
};

const dayWord = (d: IsoDate) => Temporal.PlainDate.from(d).toLocaleString("en-US", { weekday: "long" });
const plural = (n: number) => (n === 1 ? "1 suggestion" : `${n} suggestions`);

/** "Suggested · Keep all · Clear" and the rows, in a block's card, its timeline checklist, the panel or the phone. */
export function BlockSuggestions({ date, half, tabIndex = 0, where = "card" }: { date: IsoDate; half: Half; tabIndex?: number; where?: "card" | "panel" | "phone" | "timeline" }) {
  const sg = useSuggest();
  if (!sg?.on || half === "EVE") return null;
  const here = sg.at(date, half);
  if (!here.length) return null;
  const block = blockName({ date, half });
  return (
    <div className={`sug-block sug-${where}`} role="group" aria-label={`Suggested for ${block}`}>
      <p className="sug-line">
        <span className="sug-word" title="Offers from your unfinished to-dos and your backlog. Nothing is planned until you keep it">
          Suggested
        </span>
        <span className="sug-sep" aria-hidden="true">·</span>
        <button type="button" className="link-btn sug-keep-all" tabIndex={tabIndex} onClick={(e) => act(e, () => void sg.keep(here, undefined, true))} aria-label={`Keep all ${here.length} suggested for ${block}`}>
          Keep all
        </button>
        <span className="sug-sep" aria-hidden="true">·</span>
        <button type="button" className="link-btn sug-clear" tabIndex={tabIndex} onClick={(e) => act(e, () => void sg.clear({ scope: "block", date, half }, `suggestions for ${block}`))} aria-label={`Clear the suggestions for ${block}`} title="No suggestions on this block for the rest of the day">
          Clear
        </button>
      </p>
      <ul className="sug-list">
        {here.map((s) => (
          <SuggestRow key={s.key} s={s} sg={sg} tabIndex={tabIndex} panel={where === "panel"} />
        ))}
      </ul>
    </div>
  );
}

function SuggestRow({ s, sg, tabIndex, panel }: { s: Suggestion; sg: SuggestApi; tabIndex: number; panel: boolean }) {
  const drag = useDragSource(sg.dragged(s));
  const keep = () => void sg.keep([s]);
  const tip = `${s.reason}. Suggested: not planned until you keep it`;
  return (
    <li className={`sug-row${s.needsBreakdown ? " sug-feature" : ""}`} {...drag} data-sg={s.key}>
      <button type="button" className="sug-take" tabIndex={tabIndex} title={tip} aria-label={`${s.title}, suggested. ${s.reason}. Keep it`} onClick={(e) => act(e, keep)}>
        {s.itemType && <TypeIcon clientKey={s.clientKey} type={s.itemType} decorative />}
        <span className="sug-title">{s.title}</span>
        {s.needsBreakdown && <span className="sug-needs">Needs breakdown</span>}
      </button>
      <button type="button" className={panel ? "mini sug-keep" : "sug-plus"} tabIndex={tabIndex} title="Keep it on this block" aria-label={`Keep ${s.title}`} onClick={(e) => act(e, keep)}>
        {panel ? "Keep" : "+"}
      </button>
      <button type="button" className="sug-x" tabIndex={tabIndex} title="Not this one this week" aria-label={`Clear ${s.title}`} onClick={(e) => act(e, () => void sg.clear({ scope: "item", date: s.at.date, key: s.key }, s.title))}>
        ×
      </button>
    </li>
  );
}

/** A day's line: "5 suggested · Keep all · Clear"; nothing when the day has none. */
export function DaySuggestLine({ date, className = "", tabIndex = 0 }: { date: IsoDate; className?: string; tabIndex?: number }) {
  const sg = useSuggest();
  if (!sg?.on) return null;
  const all = sg.onDay(date);
  if (!all.length) return null;
  const day = dayWord(date);
  return (
    <p className={`sug-day ${className}`.trim()} role="group" aria-label={`Suggested for ${day}`}>
      <span className="sug-count">{all.length} suggested</span>
      <span className="sug-sep" aria-hidden="true">·</span>
      <button type="button" className="link-btn sug-keep-all" tabIndex={tabIndex} onClick={(e) => act(e, () => void sg.keep(all, `${all.length === 1 ? "1 to-do" : `${all.length} to-dos`} for ${day}`, true))} aria-label={`Keep all ${all.length} suggested for ${day}`}>
        Keep all
      </button>
      <span className="sug-sep" aria-hidden="true">·</span>
      <button type="button" className="link-btn sug-clear" tabIndex={tabIndex} onClick={(e) => act(e, () => void sg.clear({ scope: "day", date }, `suggestions for ${day}`))} aria-label={`Clear the suggestions for ${day}`} title={`No suggestions on ${day}`}>
        Clear
      </button>
    </p>
  );
}

/** The morning card's words and its Keep all, when today's blocks hold suggestions; null when they don't. */
export function useMorningSuggestions(date: IsoDate): { body: string; keepAll: () => void; count: number } | null {
  const sg = useSuggest();
  if (!sg?.on) return null;
  const all = sg.onDay(date);
  if (!all.length) return null;
  return { body: `${plural(all.length)} ${all.length === 1 ? "is" : "are"} in your blocks.`, keepAll: () => void sg.keep(all, `${all.length === 1 ? "1 to-do" : `${all.length} to-dos`} for today`, true), count: all.length };
}
