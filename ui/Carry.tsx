// UI-B: unfinished picks on Week's Board. Each unfinished pick from an earlier day of this week is suggested as a
// dashed card in its client's next plannable block (plan/suggest.ts), "From Wed", counting nothing until kept: Keep
// here, Move to… or Drop, each with Undo; drag works like any card. One summary line ("N unfinished picks suggested in
// your next blocks · Keep all · Review"); the original block shows the pick dimmed with "→ suggested Mon AM". Picks
// with no block left this week fold into "Unfinished from earlier days", and picks from earlier weeks into "From last
// week". Nothing is stored for a suggestion, and none applies on its own.
import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { cardGroups } from "../plan/blockstories.ts";
import { blockName, originNote, suggestCarry, type BlockAt, type CarryPlan, type Suggestion } from "../plan/suggest.ts";
import type { Pick } from "../plan/types.ts";
import type { Half, IsoDate, Week } from "../week/types.ts";
import { ActionRefusal, call, planAction } from "./api.ts";
import { clientColor, shortDate } from "./labels.ts";
import type { MenuItem, MenuStep } from "./menu.ts";
import { MenuCtx } from "./Menus.tsx";
import { FoldLine } from "./plan/FoldLine.tsx";
import { PlanCtx } from "./planview.ts";
import { TypeIcon } from "./TypeIcon.tsx";
import { DevOpsWork } from "./work.ts";
import { pickDragged, useDragSource, WeekDnd } from "./WeekStories.tsx";

type CarryData = { target: IsoDate | null; picks: Pick[]; hint?: boolean };

type CarryApi = {
  plan: CarryPlan;
  /** Where each suggested pick is suggested, by pick id. */
  suggested: ReadonlyMap<number, BlockAt>;
  /** Picks in a folded list (no block this week, or an earlier week), by id. */
  listed: ReadonlySet<number>;
  cardsAt: (date: IsoDate, half: Half) => Suggestion[];
  hint: boolean;
  dismissHint: () => void;
  keep: (s: Suggestion) => Promise<void>;
  keepAll: () => Promise<void>;
  drop: (p: Pick) => Promise<void>;
  /** "Move to…": the week's blocks with their fit. */
  moveMenu: (p: Pick) => MenuStep;
  committed: (date: IsoDate) => boolean;
};

const EMPTY: CarryPlan = { cards: [], earlierDays: [], earlierWeeks: [] };
export const CarryCtx = createContext<CarryApi | null>(null);

const weekday = (d: IsoDate) => Temporal.PlainDate.from(d).toLocaleString("en-US", { weekday: "short" });
const errText = (e: unknown) => (e instanceof ActionRefusal || e instanceof Error ? e.message : "That didn't work");

/** Only on this week's Board (`active`); elsewhere it provides nothing and reads nothing. */
export function CarryProvider({ active, version, week, now, onChanged, children }: { active: boolean; version: unknown; week: Week; now: string; onChanged: () => void; children: ReactNode }) {
  const [data, setData] = useState<CarryData | null>(null);
  const [hintGone, setHintGone] = useState(false);
  const dnd = useContext(WeekDnd);
  const pv = useContext(PlanCtx);
  useEffect(() => {
    if (!active) return setData(null);
    let live = true;
    call<CarryData>("planday.carry", {}).then((c) => live && setData(c), () => live && setData(null));
    return () => void (live = false);
  }, [active, version]);
  // The clock moves every half minute; the plan only changes when a block ends, so minutes are enough.
  const minute = now.slice(0, 16);
  const plan = useMemo(() => (data ? suggestCarry(data.picks, week.days, week.weekStart, now) : EMPTY), [data, week, minute]); // eslint-disable-line react-hooks/exhaustive-deps
  const suggested = useMemo(() => new Map(plan.cards.map((s) => [s.pick.id, s.to] as const)), [plan]);
  const listed = useMemo(() => new Set([...plan.earlierDays, ...plan.earlierWeeks].map((p) => p.id)), [plan]);
  const note = useCallback((t: string, undo: (() => Promise<void>) | null = null) => dnd?.note(t, undo), [dnd]);
  const committed = useCallback((d: IsoDate) => !!pv.week?.[d]?.committedAt, [pv.week]);

  const moveTo = useCallback(
    async (p: Pick, to: { date: IsoDate; half: Half }, label: string, anyway = false) => {
      try {
        const r = await planAction("pick.move", { id: p.id, date: to.date, half: to.half, ...(anyway ? { anyway: true } : {}) });
        onChanged();
        const copy = r.pick?.id;
        note(`Moved to ${label}`, copy ? async () => (await planAction("pick.uncarry", { id: copy }), onChanged()) : null);
      } catch (e) {
        note(errText(e));
      }
    },
    [note, onChanged],
  );

  const api: CarryApi = {
    plan,
    suggested,
    listed,
    cardsAt: (date, half) => plan.cards.filter((s) => s.to.date === date && s.to.half === half),
    hint: !!data?.hint && !hintGone && plan.cards.length > 0,
    dismissHint: () => {
      setHintGone(true);
      void call("planday.carry_hint", {}).catch(() => {});
    },
    keep: (s) => moveTo(s.pick, s.to, blockName(s.to)),
    keepAll: async () => {
      const copies: number[] = [];
      let failed = 0;
      for (const s of plan.cards) {
        try {
          const r = await planAction("pick.move", { id: s.pick.id, date: s.to.date, half: s.to.half });
          if (r.pick?.id) copies.push(r.pick.id);
        } catch {
          failed++;
        }
      }
      onChanged();
      const undo = copies.length
        ? async () => {
            for (const id of copies.reverse()) await planAction("pick.uncarry", { id });
            onChanged();
          }
        : null;
      note(`Kept ${copies.length} ${copies.length === 1 ? "pick" : "picks"} in your next blocks${failed ? `; ${failed} couldn't be kept` : ""}`, undo);
    },
    drop: async (p) => {
      try {
        const r = await planAction("pick.remove", { id: p.id });
        onChanged();
        note(`Dropped ${p.title}`, r.result === "dropped" ? async () => (await planAction("pick.undrop", { id: p.id }), onChanged()) : null);
      } catch (e) {
        note(errText(e));
      }
    },
    moveMenu: (p) => {
      const d = pickDragged(p);
      const blocks = dnd?.blocks ?? [];
      return {
        title: `Move ${p.title} to…`,
        items: blocks.map<MenuItem>((b) => {
          const c = d && dnd ? dnd.check(d, b) : null;
          const base = { id: `to-${b.date}-${b.half}`, label: b.label, action: "pick.move" };
          if (c && !c.ok) return { ...base, disabled: c.why, expected: true };
          if (b.ptoDay || b.date < (pv.today ?? "")) return { ...base, disabled: b.ptoDay ? "A PTO day" : "That block is over", expected: true };
          return { ...base, ...(c ? { hint: c.text } : {}), run: () => moveTo(p, b, b.label, b.catchUp) };
        }),
      };
    },
    committed,
  };
  return <CarryCtx.Provider value={active ? api : null}>{children}</CarryCtx.Provider>;
}

function openAt(e: ReactMouseEvent, open: (at: { x: number; y: number }, s: MenuStep) => void, step: MenuStep) {
  e.stopPropagation();
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  open({ x: r.left, y: r.bottom + 4 }, step);
}

function suggestionMenu(c: CarryApi, s: Suggestion): MenuStep {
  return {
    title: s.pick.title,
    items: [
      { id: "keep", label: `Keep here, ${blockName(s.to)}`, action: "pick.move", ...(c.committed(s.to.date) ? { hint: "Adds to a confirmed day" } : {}), run: () => c.keep(s) },
      { id: "move", label: "Move to…", action: "pick.move", next: () => c.moveMenu(s.pick) },
      { id: "drop", label: "Drop", danger: true, action: "pick.remove", run: () => c.drop(s.pick) },
    ],
  };
}

/** The dashed suggested cards in one block (none when nothing is suggested there). */
export function SuggestedCards({ date, half, tabIndex }: { date: IsoDate; half: Half; tabIndex: number }) {
  const c = useContext(CarryCtx);
  const here = c?.cardsAt(date, half) ?? [];
  if (!c || !here.length) return null;
  return (
    <ul className="suggested-cards" aria-label="Suggested from earlier days">
      {here.map((s) => (
        <SuggestedCard key={s.pick.id} s={s} c={c} tabIndex={tabIndex} />
      ))}
    </ul>
  );
}

function SuggestedCard({ s, c, tabIndex }: { s: Suggestion; c: CarryApi; tabIndex: number }) {
  const { open } = useContext(MenuCtx);
  const drag = useDragSource(pickDragged(s.pick));
  const from = `From ${weekday(s.pick.date)}`;
  const title = `Suggested from ${blockName(s.pick)}. It doesn't count against this block until you keep it${c.committed(s.to.date) ? ". Adds to a confirmed day" : ""}`;
  return (
    <li className="suggested-card" {...drag}>
      <button type="button" className="sc-open" tabIndex={tabIndex} title={title} aria-label={`${s.pick.title}, ${from.toLowerCase()}, suggested here. Keep, move or drop`} onClick={(e) => openAt(e, open, suggestionMenu(c, s))}>
        {s.pick.itemType && <TypeIcon clientKey={s.pick.clientKey} type={s.pick.itemType} decorative />}
        <span className="sc-title">{s.pick.title}</span>
        <span className="sc-from">{from}</span>
      </button>
    </li>
  );
}

/** The original block's line for a pick that is suggested elsewhere, listed, or moved on: dimmed, never tickable. */
export function OriginPick({ pick }: { pick: Pick }) {
  const c = useContext(CarryCtx);
  const text = originNote(pick, c?.suggested ?? new Map()) ?? (c?.listed.has(pick.id) ? "→ in the list above" : null);
  return (
    <li className="pick-origin" data-pick={pick.id} title={text ? `${pick.title} ${text}` : pick.title}>
      {pick.itemType && <TypeIcon clientKey={pick.clientKey} type={pick.itemType} decorative />}
      <span className="po-title">{pick.title}</span>
      {text && <span className="po-note">{text}</span>}
    </li>
  );
}

/** Whether a block's pick is shown as an origin line instead of a checklist row. */
export function useIsOrigin(): (p: Pick) => boolean {
  const c = useContext(CarryCtx);
  return (p) => !!c && p.status === "planned" && (c.suggested.has(p.id) || c.listed.has(p.id));
}

/**
 * The summary over the Board: one line for the suggested cards (Keep all, Review opens them grouped), the first-time
 * hint, and the fold for picks with no block left this week. Hidden when there is nothing.
 */
export function CarrySummary({ colors, nameOf }: { colors: Record<string, string>; nameOf: (k: string) => string }) {
  const c = useContext(CarryCtx);
  const [review, setReview] = useState(false);
  const [openDays, setOpenDays] = useState(false);
  if (!c) return null;
  const { cards, earlierDays } = c.plan;
  if (!cards.length && !earlierDays.length) return null;
  return (
    <section className="carry-summary" aria-label="Unfinished picks">
      {cards.length > 0 && (
        <div className="cs-line">
          <span className="cs-text">
            {cards.length} unfinished {cards.length === 1 ? "pick" : "picks"} suggested in your next blocks
          </span>
          <span className="cs-sep" aria-hidden="true">·</span>
          <button type="button" className="link-btn" onClick={() => void c.keepAll()} title="Keep every suggestion in the block it's in">
            Keep all
          </button>
          <span className="cs-sep" aria-hidden="true">·</span>
          <button type="button" className="link-btn" aria-expanded={review} onClick={() => setReview((r) => !r)}>
            Review
          </button>
        </div>
      )}
      {c.hint && (
        <p className="cs-hint" role="note">
          We've suggested these in your next blocks. Keep, move or drop them.
          <button type="button" className="mini quiet" aria-label="Dismiss the hint" onClick={c.dismissHint}>
            ×
          </button>
        </p>
      )}
      {review && cards.length > 0 && <Grouped picks={cards.map((s) => s.pick)} colors={colors} nameOf={nameOf} row={(p) => <ReviewRow pick={p} s={cards.find((x) => x.pick.id === p.id)!} />} />}
      {earlierDays.length > 0 && (
        <div className="cs-fold">
          <FoldLine className="flw-fold" open={openDays} onToggle={() => setOpenDays((o) => !o)} label={`Unfinished from earlier days (${earlierDays.length})`} title="No block left for their client this week. Drag one onto a block, or use Move to…" />
          {openDays && <Grouped picks={earlierDays} colors={colors} nameOf={nameOf} row={(p) => <ListRow pick={p} />} />}
        </div>
      )}
    </section>
  );
}

/** Picks grouped by client, then feature (with TypeIcons), as Week's cards group them. */
export function Grouped({ picks, colors, nameOf, row }: { picks: readonly Pick[]; colors: Record<string, string>; nameOf: (k: string) => string; row: (p: Pick) => ReactNode }) {
  const work = useContext(DevOpsWork);
  const clients = [...new Set(picks.map((p) => p.clientKey))];
  return (
    <div className="cs-groups">
      {clients.map((k) => {
        const mine = picks.filter((p) => p.clientKey === k);
        const groups = cardGroups(mine, work.get(k));
        return (
          <div key={k} className="cs-client" style={{ "--c": clientColor(k, colors) } as CSSProperties} role="group" aria-label={nameOf(k)}>
            <h3 className="cs-client-name">
              <span className="swatch" aria-hidden="true" />
              {nameOf(k)}
            </h3>
            <ul className="flw-list">
              {groups.map((g) => (
                <Fragment key={g.feature?.id ?? "none"}>
                  {groups.some((x) => x.feature) && (
                    <li className="card-feat">
                      {g.feature && <TypeIcon clientKey={k} type={g.feature.type} decorative />}
                      <span className="cf-title">{g.feature?.title ?? "No feature"}</span>
                    </li>
                  )}
                  {g.picks.map((p) => (
                    <Fragment key={p.id}>{row(p)}</Fragment>
                  ))}
                </Fragment>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function ReviewRow({ pick, s }: { pick: Pick; s: Suggestion }) {
  const c = useContext(CarryCtx)!;
  const { open } = useContext(MenuCtx);
  const drag = useDragSource(pickDragged(pick));
  return (
    <li className="flw-row" {...drag}>
      <span className="flw-row-inner">
        {pick.itemType && <TypeIcon clientKey={pick.clientKey} type={pick.itemType} decorative />}
        <span className="pr-title">{pick.title}</span>
        <span className="pr-note">
          from {shortDate(pick.date)} · suggested {blockName(s.to)}
        </span>
        <button type="button" className="link-btn" onClick={() => void c.keep(s)} title={c.committed(s.to.date) ? "Adds to a confirmed day" : `Keep it in ${blockName(s.to)}`}>
          Keep
        </button>
        <button type="button" className="link-btn" onClick={(e) => openAt(e, open, c.moveMenu(pick))}>
          Move to…
        </button>
        <button type="button" className="link-btn danger" onClick={() => void c.drop(pick)}>
          Drop
        </button>
      </span>
    </li>
  );
}

/** A folded-list row: a drag handle and Move to…. */
export function ListRow({ pick }: { pick: Pick }) {
  const c = useContext(CarryCtx);
  const { open } = useContext(MenuCtx);
  const drag = useDragSource(pickDragged(pick));
  return (
    <li className="flw-row" {...drag}>
      <span className="flw-row-inner">
        {drag.draggable && <span className="drag-handle" aria-hidden="true" title="Drag onto a block">⋮⋮</span>}
        {pick.itemType && <TypeIcon clientKey={pick.clientKey} type={pick.itemType} decorative />}
        <span className="pr-title">{pick.title}</span>
        <span className="pr-note">from {shortDate(pick.date)}</span>
        {c && (
          <button type="button" className="link-btn ps-moveto" onClick={(e) => openAt(e, open, c.moveMenu(pick))}>
            Move to…
          </button>
        )}
        {c && (
          <button type="button" className="link-btn danger" onClick={() => void c.drop(pick)}>
            Drop
          </button>
        )}
      </span>
    </li>
  );
}
