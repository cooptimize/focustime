// UI-B, SG-1: unfinished to-dos and the board's suggestions. The provider reads what the suggestion rule needs from the
// store once (suggest.load: the unfinished to-dos and what was cleared) and works out the suggestions with
// plan/boardsuggest.ts: today's and the next working day's empty blocks offer to-dos, unfinished ones first, then my
// backlog. A suggestion is an offer: nothing is stored for it and it counts against nothing until kept. Keep makes an
// ordinary to-do through the existing add (pick.add, or pick.move for an unfinished one), with Undo; Clear stores
// only that it was cleared (suggest.clear), with Undo. The rows and lines are in ui/Suggest.tsx.
// Unfinished to-dos that aren't suggested anywhere fold into "Unfinished from earlier days" (this week) and "From
// last week" (earlier weeks), as before; the original block shows a suggested one dimmed, "→ suggested Wed AM".
// SG-1 removed UI-B's dashed cards (SuggestedCards), their "N unfinished to-dos suggested in your next blocks · Keep
// all · Review" line and its one-time hint: an unfinished to-do is now one of the board's suggestions.
import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { boardSuggestions, byBlock, clearKey, type ClearScope, type Suggestion } from "../plan/boardsuggest.ts";
import { cardGroups } from "../plan/blockstories.ts";
import { originNote, type BlockAt } from "../plan/suggest.ts";
import type { Pick } from "../plan/types.ts";
import type { Dragged } from "../plan/weekdrop.ts";
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
import { Icon } from "./icons.tsx";

type SuggestData = { picks: Pick[]; cleared: string[] };
/** UI-B's split of the unfinished to-dos (the dashed cards went in SG-1; `cards` stays empty). */
export type CarryPlan = { cards: never[]; earlierDays: Pick[]; earlierWeeks: Pick[] };

/** SG-1: the board's suggestions and what can be done with them. */
export type SuggestApi = {
  on: boolean;
  at: (date: IsoDate, half: Half) => Suggestion[];
  onDay: (date: IsoDate) => Suggestion[];
  /** Keep one, or several as one action with one Undo. */
  /** `whole`: a Keep all, so the blocks it kept on offer nothing more this visit. */
  keep: (list: readonly Suggestion[], label?: string, whole?: boolean) => Promise<void>;
  clear: (c: ClearScope, label: string) => Promise<void>;
  /** What a suggestion is when dragged (onto a block that can take it, which keeps it there). */
  dragged: (s: Suggestion) => Dragged | null;
};

type CarryApi = {
  plan: CarryPlan;
  /** "N to place" counts every unfinished to-do as before, suggested or not: this week's and earlier weeks'. */
  unfinished: { thisWeek: number; earlier: number };
  /** Where each suggested unfinished to-do is suggested, by its id. */
  suggested: ReadonlyMap<number, BlockAt>;
  /** Unfinished to-dos in a folded list (no suggestion for them now), by id. */
  listed: ReadonlySet<number>;
  drop: (p: Pick) => Promise<void>;
  /** "Move to…": the week's blocks with their fit. */
  moveMenu: (p: Pick) => MenuStep;
  sg: SuggestApi;
};

export const CarryCtx = createContext<CarryApi | null>(null);
export const useSuggest = (): SuggestApi | null => useContext(CarryCtx)?.sg ?? null;

const errText = (e: unknown) => (e instanceof ActionRefusal || e instanceof Error ? e.message : "That didn't work");
const mondayOf = (d: IsoDate) => {
  const p = Temporal.PlainDate.from(d);
  return p.subtract({ days: p.dayOfWeek - 1 }).toString();
};

/**
 * `thisWeek`: the week shown is today's (the unfinished lists and To place). `suggest`: the setting and whether the
 * week shown holds today or the next working day (the suggestions). Elsewhere it provides nothing and reads nothing.
 */
export function CarryProvider({ thisWeek, suggest, nextWorkDay, version, week, now, onChanged, clientName, children }: { thisWeek: boolean; suggest: boolean; nextWorkDay: IsoDate | null; version: unknown; week: Week; now: string; onChanged: () => void; clientName?: (k: string) => string; children: ReactNode }) {
  const active = thisWeek || suggest;
  const [data, setData] = useState<SuggestData | null>(null);
  // Clears made here before the store answers (and their Undo), so a row goes at once.
  const [cleared, setCleared] = useState<ReadonlySet<string>>(new Set());
  // To-dos and placeholders kept from a suggestion in this visit: they don't stop the block's other suggestions.
  const [kept, setKept] = useState<ReadonlySet<number>>(new Set());
  const [keptFeatures, setKeptFeatures] = useState<ReadonlySet<string>>(new Set());
  // Blocks a Keep all ran on: what was offered is kept, so nothing new fills in behind it.
  const [keptBlocks, setKeptBlocks] = useState<ReadonlySet<string>>(new Set());
  // Rows being kept: hidden at once, until the next load shows them as to-dos (a second click can't keep twice).
  const [keeping, setKeeping] = useState<ReadonlySet<string>>(new Set());
  // Clears and Undos the store hasn't answered yet: a load that crosses one doesn't bring a row back or hide it again.
  const pendingClear = useRef(new Set<string>());
  const pendingUnclear = useRef(new Set<string>());
  // Blocks an Undo of Keep all gives back: open again only once the load after the Undo lands (until then the
  // to-dos it took away are still in the week's picks).
  const releaseOnLoad = useRef<string[]>([]);
  const dnd = useContext(WeekDnd);
  const pv = useContext(PlanCtx);
  const work = useContext(DevOpsWork);
  useEffect(() => {
    if (!active) return setData(null);
    let live = true;
    call<SuggestData>("suggest.load", {}).then(
      (c) => {
        if (!live) return;
        setData(c);
        setCleared(new Set([...c.cleared.filter((k) => !pendingUnclear.current.has(k)), ...pendingClear.current]));
        setKeeping(new Set());
        const back = releaseOnLoad.current;
        if (back.length) {
          releaseOnLoad.current = [];
          setKeptBlocks((b) => new Set([...b].filter((k) => !back.includes(k))));
        }
      },
      () => live && setData(null),
    );
    return () => void (live = false);
  }, [active, version]);
  const today = pv.today ?? week.days[0]!.date;
  // The clock moves every half minute; the suggestions change only when a block ends, so minutes are enough.
  const minute = now.slice(0, 16);
  const weekPicks = useMemo(() => Object.values(pv.week ?? {}).flatMap((d) => d.picks), [pv.week]);
  const list = useMemo(() => {
    if (!data || !suggest) return [];
    const busy = (date: IsoDate, half: Half) =>
      keptBlocks.has(`${date}:${half}`) ||
      (pv.weekFeatures ?? []).some((f) => f.level === "feature" && !f.doneAt && f.slots.some((s) => s.date === date && s.half === half) && !keptFeatures.has(`${date}:${half}:${f.clientKey}:${f.itemId}`)) ||
      (pv.checkins ?? []).some((c) => c.date === date && c.half === half);
    const resolved = new Set(pv.resolved ?? []);
    // A feature placed on a block this week (kept from a suggestion or pinned in Plan) is planned: never offered again.
    const placed = new Set((pv.weekFeatures ?? []).filter((f) => !f.doneAt && f.slots.length).map((f) => `i${f.clientKey}:${f.itemId}`));
    return boardSuggestions({
      on: true, now, today, nextWorkDay, days: week.days, weekPicks, busy, kept, placed, unfinished: data.picks,
      work: (k) => work.get(k), resolved: (k, id) => resolved.has(`${k}\u0000${id}`), cleared, sizes: pv.sizes,
      ...(clientName ? { clientName } : {}),
    });
  }, [data, suggest, week, weekPicks, minute, today, nextWorkDay, work, cleared, kept, keptFeatures, keptBlocks, pv.weekFeatures, pv.checkins, pv.sizes, pv.resolved]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = useMemo(() => (keeping.size ? list.filter((s) => !keeping.has(`${s.at.date}:${s.at.half}:${s.key}`)) : list), [list, keeping]);
  const blocks = useMemo(() => byBlock(shown), [shown]);
  const suggested = useMemo(() => new Map(list.filter((s) => s.pickId !== null).map((s) => [s.pickId!, s.at] as const)), [list]);
  const plan = useMemo<CarryPlan>(() => {
    if (!data || !thisWeek) return { cards: [], earlierDays: [], earlierWeeks: [] };
    const ws = mondayOf(today);
    const rest = data.picks.filter((p) => !suggested.has(p.id));
    return { cards: [], earlierDays: rest.filter((p) => p.date >= ws), earlierWeeks: rest.filter((p) => p.date < ws) };
  }, [data, thisWeek, suggested, today]);
  const listed = useMemo(() => new Set([...plan.earlierDays, ...plan.earlierWeeks].map((p) => p.id)), [plan]);
  const note = useCallback((t: string, undo: (() => Promise<void>) | null = null) => dnd?.note(t, undo), [dnd]);
  // Keep All and its Undo run one at a time.
  const busyRef = useRef(false);

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

  /** Keeps one suggestion: the existing add (or move, or a feature's placeholder). Answers its Undo. */
  const keepOne = async (s: Suggestion): Promise<() => Promise<void>> => {
    const { date, half } = s.at;
    if (s.pickId !== null) {
      const r = await planAction("pick.move", { id: s.pickId, date, half });
      const copy = r.pick?.id ?? null;
      if (copy !== null) setKept((k) => new Set([...k, copy]));
      return async () => void (copy !== null && (await planAction("pick.uncarry", { id: copy })));
    }
    if (s.kind === "feature" && s.itemId !== null) {
      const weekStart = mondayOf(date);
      const pin = (on: boolean) => planAction("weekplan.place", { weekStart, clientKey: s.clientKey, itemId: s.itemId, date, half, on });
      // Placing a feature not on the week yet adds it; Undo takes it off again, not just off the block.
      const wasOn = (pv.weekFeatures ?? []).some((f) => f.weekStart === weekStart && f.clientKey === s.clientKey && f.itemId === s.itemId);
      const r = (await pin(true)) as { feature?: { id?: number } };
      setKeptFeatures((k) => new Set([...k, `${date}:${half}:${s.clientKey}:${s.itemId}`]));
      const added = wasOn ? null : (r.feature?.id ?? null);
      return async () => void (added !== null ? await planAction("weekplan.remove", { id: added }) : await pin(false));
    }
    const r = await planAction("pick.add", { date, half, clientKey: s.clientKey, itemId: s.itemId });
    const id = r.pick?.id ?? null;
    const undo = (r as { undo?: unknown }).undo;
    if (id !== null) setKept((k) => new Set([...k, id]));
    return async () => void (id !== null && (await planAction("pick.remove", { id, ...(undo ? { undo } : {}) })));
  };

  const sg: SuggestApi = {
    on: suggest,
    at: (date, half) => blocks.get(`${date}:${half}`) ?? [],
    onDay: (date) => shown.filter((s) => s.at.date === date),
    keep: async (many, label, whole = false) => {
      if (!many.length || busyRef.current) return;
      busyRef.current = true;
      const where = whole ? [...new Set(many.map((s) => `${s.at.date}:${s.at.half}`))] : [];
      const undos: (() => Promise<void>)[] = [];
      let failed: string | null = null;
      try {
        setKeeping((k) => new Set([...k, ...many.map((s) => `${s.at.date}:${s.at.half}:${s.key}`)]));
        for (const s of many) {
          try {
            undos.push(await keepOne(s));
          } catch (e) {
            failed = errText(e);
            setKeeping((k) => new Set([...k].filter((x) => x !== `${s.at.date}:${s.at.half}:${s.key}`)));
          }
        }
      } finally {
        busyRef.current = false;
      }
      if (undos.length && where.length) setKeptBlocks((b) => new Set([...b, ...where]));
      onChanged();
      const n = undos.length;
      // "Kept Validate date of birth", "Kept 3 to-dos for Tuesday"; the plain count when some couldn't be kept.
      const what = n === many.length ? (many.length === 1 ? many[0]!.title : (label ?? `${n} to-dos`)) : `${n} to-dos`;
      const text = n === 0 ? (failed ?? "That didn't work") : `Kept ${what}${failed ? `. ${many.length - n} couldn't be kept: ${failed}` : ""}`;
      note(
        text,
        n
          ? async () => {
              if (busyRef.current) return;
              busyRef.current = true;
              try {
                for (const u of [...undos].reverse()) await u().catch(() => undefined);
              } finally {
                busyRef.current = false;
              }
              releaseOnLoad.current = [...releaseOnLoad.current, ...where];
              onChanged();
            }
          : null,
      );
    },
    clear: async (c, label) => {
      const key = clearKey(c);
      const drop = () => setCleared((x) => new Set([...x].filter((k) => k !== key)));
      const add = () => setCleared((x) => new Set([...x, key]));
      add();
      pendingClear.current.add(key);
      try {
        await call("suggest.clear", { keys: [key] });
        note(`Cleared ${label}`, async () => {
          drop();
          pendingUnclear.current.add(key);
          try {
            await call("suggest.unclear", { keys: [key] });
          } catch (e) {
            add();
            note(errText(e));
          } finally {
            pendingUnclear.current.delete(key);
          }
        });
      } catch (e) {
        drop();
        note(errText(e));
      } finally {
        pendingClear.current.delete(key);
      }
    },
    dragged: (s) => {
      if (s.pickId !== null) {
        const p = data?.picks.find((x) => x.id === s.pickId);
        return p ? pickDragged(p) : null;
      }
      if (s.itemId === null) return null;
      return { clientKey: s.clientKey, itemId: s.itemId, size: null, title: s.title, ...(s.kind === "feature" ? { feature: true as const } : {}) };
    },
  };

  const ws = mondayOf(today);
  const api: CarryApi = {
    plan,
    unfinished: thisWeek && data ? { thisWeek: data.picks.filter((p) => p.date >= ws).length, earlier: data.picks.filter((p) => p.date < ws).length } : { thisWeek: 0, earlier: 0 },
    suggested,
    listed,
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
    sg,
  };
  return <CarryCtx.Provider value={active ? api : null}>{children}</CarryCtx.Provider>;
}

function openAt(e: ReactMouseEvent, open: (at: { x: number; y: number }, s: MenuStep) => void, step: MenuStep) {
  e.stopPropagation();
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  open({ x: r.left, y: r.bottom + 4 }, step);
}

/** The original block's line for a pick that is suggested elsewhere, listed, or moved on: dimmed, never tickable. */
export function OriginPick({ pick }: { pick: Pick }) {
  const c = useContext(CarryCtx);
  const text = originNote(pick, c?.suggested ?? new Map()) ?? (c?.listed.has(pick.id) ? "→ in To place" : null);
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

/** The fold for unfinished to-dos with no suggestion now ("Unfinished from earlier days"). Hidden when there are none. */
export function CarrySummary({ colors, nameOf }: { colors: Record<string, string>; nameOf: (k: string) => string }) {
  const c = useContext(CarryCtx);
  const [openDays, setOpenDays] = useState(false);
  if (!c) return null;
  const { earlierDays } = c.plan;
  if (!earlierDays.length) return null;
  return (
    <section className="carry-summary" aria-label="Unfinished to-dos">
      <div className="cs-fold">
        <FoldLine className="flw-fold" open={openDays} onToggle={() => setOpenDays((o) => !o)} label={`Unfinished from earlier days (${earlierDays.length})`} title="Not suggested in a block now. Drag one onto a block, or use Move to…" />
        {openDays && <Grouped picks={earlierDays} colors={colors} nameOf={nameOf} row={(p) => <ListRow pick={p} />} />}
      </div>
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

/** A folded-list row: a drag handle and Move to…. */
export function ListRow({ pick }: { pick: Pick }) {
  const c = useContext(CarryCtx);
  const { open } = useContext(MenuCtx);
  const drag = useDragSource(pickDragged(pick));
  return (
    <li className="flw-row" {...drag}>
      <span className="flw-row-inner">
        {drag.draggable && <span className="drag-handle" aria-hidden="true" title="Drag onto a block"><Icon name="grip" /></span>}
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
