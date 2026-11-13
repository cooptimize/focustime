// AH-6, BL-1: the Backlog tab's one toolbar, the same in Grid and Gantt. One row under the header: Clients (chips),
// People (Mine · Contributing · Everyone), Needs attention (a chip with its count) and Search; at its end one Filter
// button (Epic, Dates and the levels shown, with a count when any is off its default) and ⋯ (Expand all, Collapse all,
// Callouts, Whole project, and the note about a client's scope). Under it, only when a filter is off its default,
// "Showing 33 of 583" with a removable chip per filter and Clear filters. No native selects or date inputs: AH-5's
// popover, date picker and filterable list.
import type React from "react";
import { useContext, useRef, useState, type CSSProperties } from "react";
import type { AheadLoad } from "../../actions/types.ts";
import type { AheadFilters, AheadOwner } from "../../plan/ahead-edit.ts";
import { cleared, dateWords, filterCount, notHere, PEOPLE_WORDS, peopleWord, RANGE_WORDS, RANGES, summary, type AheadModeKey } from "../../plan/ahead-view.ts";
import { atLevel, collapseAll, expandAll, LEVELS, type Fold } from "../../plan/gantt-tree.ts";
import { START_RULE } from "../../plan/readiness.ts";
import { CellPopover, Segmented } from "../CellPopover.tsx";
import { DatePicker } from "../DatePicker.tsx";
import { MenuCtx } from "../Menus.tsx";
import type { MenuItem } from "../menu.ts";
import { SelectField } from "../SelectField.tsx";
import { useAdmin } from "../settings/Admin.tsx";
import { DEFAULT_FILTERS, epicsOf, type Tier } from "./model.ts";
import { Icon } from "../icons.tsx";

export type AheadViewState = {
  fold: Fold;
  setFold: (f: Fold | ((o: Fold) => Fold)) => void;
  names: Record<Tier, string>;
  callouts: boolean;
  setCallouts: (on: boolean) => void;
};

const toggle = <T,>(list: readonly T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function Toolbar({ mode, load, f, set, setWhole, view, counts, attention, color, extra = null }: {
  mode: AheadModeKey;
  load: AheadLoad;
  f: AheadFilters;
  set: (f: AheadFilters) => void;
  setWhole: (whole: boolean) => void;
  view: AheadViewState;
  counts: { shown: number; total: number };
  /** Needs attention's count (BL-1: Readiness's count plus stale items) for the clients and filters shown. */
  attention: number;
  color: (k: string) => string;
  /** A view's own quiet control at the row's end (the Gantt's Legend). */
  extra?: React.ReactNode;
}) {
  const menus = useContext(MenuCtx);
  const admin = useAdmin();
  const more = useRef<HTMLButtonElement>(null);
  const scoped = load.clients.filter((c) => c.scope && !c.scope.all);
  const ctx = { scoped: scoped.length > 0, whole: !!f.whole };
  const shownClients = load.clients.filter((c) => !f.clients.length || f.clients.includes(c.clientKey));
  const people = peopleWord(f, shownClients);
  const setOwner = (o: AheadOwner) => set({ ...f, owner: { ...f.owner, ...Object.fromEntries(shownClients.map((c) => [c.clientKey, o])) } });
  const epics = epicsOf(load, f);
  const epicLabel = f.epic ? (epics.find((e) => e.key === f.epic)?.label ?? null) : null;
  const sum = summary(load.clients, f, { today: load.today, shown: counts.shown, total: counts.total, epicLabel });
  const nFilter = filterCount(f, view.fold.level);

  const openMore = () => {
    const r = more.current?.getBoundingClientRect();
    if (!r) return;
    const callOff = notHere(mode, "callouts", ctx);
    const wholeOff = notHere(mode, "whole", ctx);
    const auto = load.clients.filter((c) => c.scope?.automatic && !c.scope.all);
    const names = auto.map((c) => c.clientName).join(", ");
    const scopeCounts = scoped.map((c) => `${c.clientName}: ${c.scope!.inScope} of ${c.scope!.total} open items are Cooptimize's work`).join("; ");
    const scopeWords = `${f.whole ? "Showing the whole project" : "Showing Cooptimize's work (automatic)"} for ${names}`;
    const items: MenuItem[] = [
      { id: "expand-all", group: "Rows", label: "Expand all", run: () => view.setFold(expandAll()) },
      { id: "collapse-all", group: "Rows", label: "Collapse all", run: () => view.setFold(collapseAll()) },
      // Callouts are the Gantt's; in the Grid the item stays, saying why (it's found where it was looked for).
      { id: "callouts", group: "View", label: "Callouts at the end of bars", toggle: true, checked: view.callouts, ...(callOff ? { disabled: callOff, expected: true } : { run: () => view.setCallouts(!view.callouts) }) },
      // The counts per client ("Northwind Foods: 14 of 19 open items are Cooptimize's work") as its hint.
      { id: "whole", group: "View", label: "Show the whole project", toggle: true, checked: !!f.whole, ...(scopeCounts ? { hint: scopeCounts } : {}), ...(wholeOff ? { disabled: wholeOff, expected: true } : { run: () => setWhole(!f.whole) }) },
      ...(auto.length
        ? [
            admin
              ? { id: "scope", group: "Scope", label: scopeWords, hint: "Set it in Admin › Clients", run: () => void (location.hash = "#/settings/admin-clients") }
              : { id: "scope", group: "Scope", label: scopeWords, disabled: "Your FocusTime admin sets each client's scope in Admin › Clients", expected: true },
          ]
        : []),
    ];
    menus.open({ x: Math.max(8, r.right - 300), y: r.bottom + 4 }, { title: "Backlog", items });
  };

  return (
    <section className="ah-toolbar" aria-label="Filters" data-mode={mode}>
      <div className="ah-tb-row">
        <span className="rm-chips ah-tb-clients" role="group" aria-label="Clients">
          {load.clients.map((c) => (
            <button key={c.clientKey} type="button" className="rm-chip" style={{ "--c": color(c.clientKey) } as CSSProperties} aria-pressed={f.clients.includes(c.clientKey)} onClick={() => set({ ...f, clients: toggle(f.clients, c.clientKey), epic: null })}>
              <span className="dl-swatch" aria-hidden="true" />
              {c.clientName}
            </button>
          ))}
        </span>
        <span
          className="rm-seg ah-tb-people"
          role="group"
          aria-label={people.owner ? "People" : `People: ${people.word}`}
          data-tour="ah-owner"
          title={`Mine: assigned to you and what's under your features and epics. Contributing: the features and epics your stories are under. Everyone: all of Cooptimize's work. Remembered per client.${people.owner ? "" : `\nNow: ${people.word}.`}`}
        >
          {(["mine", "contributing", "all"] as const).map((o) => (
            <button key={o} type="button" aria-pressed={people.owner === o} onClick={() => setOwner(o)}>
              {PEOPLE_WORDS[o]}
            </button>
          ))}
        </span>
        <button
          type="button"
          className="rm-chip ah-attention"
          data-tour="ah-attention"
          aria-pressed={f.gaps}
          title="Items you can change near the top of each backlog, dated in the next 4 weeks, or yours, that are missing stories, a target date, an owner or a size, or are stale"
          onClick={() => {
            const { kinds: _k, stale: _s, ...rest } = f;
            set({ ...rest, gaps: !f.gaps });
          }}
        >
          Needs attention <span className="ah-attention-n">{attention}</span>
        </button>
        <span className="ah-search ah-tb-search">
          <input className="rm-search" type="text" placeholder="Titles or #id" aria-label="Search titles or #id" value={f.q} onChange={(e) => set({ ...f, q: e.target.value })} onKeyDown={(e) => e.key === "Escape" && f.q && (e.stopPropagation(), set({ ...f, q: "" }))} />
          {f.q && (
            <button type="button" className="ah-search-clear" aria-label="Clear the search" onClick={() => set({ ...f, q: "" })}>
              <Icon name="close" />
            </button>
          )}
        </span>
        <span className="ah-tb-end">
          {extra}
          <FilterButton f={f} set={set} load={load} view={view} count={nFilter} epics={epics} />
          <button ref={more} type="button" className="top-btn ah-tb-more" aria-label="More: rows and view" aria-haspopup="menu" title="Expand all, Collapse all, Callouts, Whole project, scope" onClick={openMore}>
            <Icon name="more" />
          </button>
        </span>
      </div>
      {sum && (
        <div className="ah-tb-summary" role="status">
          <span className="ah-tb-sumtext">{sum.text}</span>
          <span className="ah-tb-chips">
            {sum.chips.map((c) => (
              <button key={c.id} type="button" className="ah-tb-chip" data-chip={c.id} aria-label={`Remove the filter ${c.label}`} title="Remove this filter" onClick={() => set(c.clear(f))}>
                {c.label}
                <Icon name="close" />
              </button>
            ))}
            <button type="button" className="mini quiet ah-tb-clear" onClick={() => set(cleared(f, DEFAULT_FILTERS))}>
              Clear filters
            </button>
          </span>
        </div>
      )}
    </section>
  );
}

/** Filter: Epic, Dates and the levels shown, in one popover; its count says how many are off their defaults. */
function FilterButton({ f, set, load, view, count, epics }: { f: AheadFilters; set: (f: AheadFilters) => void; load: AheadLoad; view: AheadViewState; count: number; epics: { key: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const close = () => (setOpen(false), requestAnimationFrame(() => btn.current?.focus()));
  const touched = Object.keys(view.fold.rows).length > 0;
  const unflat = (({ flat: _f, ...x }: AheadFilters) => x)(f);
  return (
    <>
      <button ref={btn} type="button" className="top-btn ah-filter" data-tour="ah-filter" aria-haspopup="dialog" aria-expanded={open} aria-label={count ? `Filter: ${plural(count, "choice", "choices")} set` : "Filter: epic, dates, levels"} onClick={() => setOpen(!open)}>
        Filter{count > 0 && <span className="ah-filter-n" aria-hidden="true">{count}</span>}
      </button>
      {open && (
        <CellPopover anchor={btn.current} title="Filter" onSave={close} onCancel={close} saveLabel="Done" className="ah-tb-pop ah-filter-pop">
          <div className="ah-fp-row">
            <span className="ah-fp-label">Epic</span>
            {epics.length ? (
              <SelectField label="Epic" value={f.epic ?? ""} onChange={(k) => set({ ...f, epic: k || null })} options={[{ key: "", label: "Any" }, ...epics.map((x) => ({ key: x.key, label: x.label }))]} className="ah-tb-select" />
            ) : (
              <span className="muted ah-tb-note">No epics in the clients shown</span>
            )}
          </div>
          <div className="ah-fp-row">
            <span className="ah-fp-label">Dates</span>
            <DatesButton f={f} set={set} today={load.today} />
          </div>
          <div className="ah-fp-row ah-fp-levels">
            <span className="ah-fp-label" id="ah-fp-levels">
              Levels
            </span>
            <span className="rm-seg" role="group" aria-labelledby="ah-fp-levels" title={touched && !f.flat ? "Some rows are opened or closed by hand; a level starts them over" : undefined}>
              {LEVELS.map((t) => (
                <button
                  key={t}
                  type="button"
                  data-level={t}
                  aria-pressed={f.flat ? f.flat === t : view.fold.level === t && !touched}
                  className={!f.flat && view.fold.level === t && touched ? "partly" : undefined}
                  onClick={() => (f.flat ? set({ ...f, flat: t }) : view.setFold(atLevel(t)))}
                  title={f.flat ? `Only ${view.names[t].toLowerCase()}, in rank order` : `Show down to ${view.names[t].toLowerCase()}`}
                >
                  {view.names[t]}
                </button>
              ))}
            </span>
            <label className="ah-fp-flat">
              <input type="checkbox" checked={!!f.flat} onChange={(e) => set(e.target.checked ? { ...f, flat: view.fold.level } : unflat)} />
              One level as a list, in each backlog's rank order
            </label>
            {!f.gaps && (
              <label className="ah-fp-flat">
                <input type="checkbox" checked={!!f.stale} onChange={(e) => set(e.target.checked ? { ...f, stale: true } : (({ stale: _s, ...x }) => x)(f))} />
                Stale only: no change in DevOps for {load.staleWeeks ?? 6} weeks
              </label>
            )}
          </div>
        </CellPopover>
      )}
    </>
  );
}

/** Dates: one popover with the quick picks and a custom range (one calendar, From or To). */
function DatesButton({ f, set, today }: { f: AheadFilters; set: (f: AheadFilters) => void; today: string }) {
  const [open, setOpen] = useState(false);
  const [end, setEnd] = useState<"from" | "to">("from");
  const btn = useRef<HTMLButtonElement>(null);
  const close = () => (setOpen(false), requestAnimationFrame(() => btn.current?.focus()));
  const words = dateWords(f, today);
  const pick = (r: AheadFilters["range"] | null) => {
    const { range: _r, ...rest } = f;
    set(r ? { ...rest, range: r, from: null, to: null } : { ...rest, from: null, to: null });
  };
  const custom = !f.range && (f.from || f.to);
  return (
    <>
      <button ref={btn} type="button" className="date-field select-field ah-tb-select" aria-label={`Dates: ${words}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>{words}</span>
        <span className="date-field-icon" aria-hidden="true">
          <Icon name="open" />
        </span>
      </button>
      {open && (
        <CellPopover anchor={btn.current} title="Dates" sub="items that overlap them" onSave={close} onCancel={close} saveLabel="Done" className="ah-tb-pop">
          <div className="ah-tb-picks" role="group" aria-label="Quick dates">
            {RANGES.map((r) => (
              <button key={r} type="button" className="rm-chip" aria-pressed={f.range === r} onClick={() => pick(r)}>
                {RANGE_WORDS[r]}
              </button>
            ))}
            <button type="button" className="rm-chip" aria-pressed={!f.range && !f.from && !f.to} onClick={() => pick(null)}>
              Any time
            </button>
          </div>
          <div className="ah-tb-custom">
            <Segmented label="Custom dates" value={end} onChange={setEnd} options={[{ value: "from", label: `From${!f.range && f.from ? `: ${dateWords({ from: f.from, to: null }, today).replace(/^From /, "")}` : ""}` }, { value: "to", label: `To${!f.range && f.to ? `: ${dateWords({ from: null, to: f.to }, today).replace(/^Until /, "")}` : ""}` }]} />
            <DatePicker
              key={end}
              label={end === "from" ? "From" : "To"}
              today={today}
              value={custom ? f[end] : null}
              onChange={(d) => {
                const { range: _r, ...rest } = f;
                set({ ...rest, ...(f.range ? { from: null, to: null } : {}), [end]: d });
              }}
            />
          </div>
        </CellPopover>
      )}
    </>
  );
}

const KIND_LABELS = { needs_stories: "Needs stories", no_dates: "No target date", unassigned: "Unassigned", unsized: "Unsized" } as const;
type KindKey = keyof typeof KIND_LABELS;

/**
 * BL-1: Needs attention's one line, under the toolbar while it's on: "Why these?" (the rule), the counts by kind and
 * Stale (each narrows to that kind; again shows every kind), and my progress this week.
 */
export function AttentionLine({ start, counts, stale, f, set, progress, staleWeeks }: { /** AH-7: Start here, the most urgent few (on: only those). */ start: { on: boolean; n: number; toggle: () => void }; counts: Record<KindKey, number>; stale: number; f: AheadFilters; set: (f: AheadFilters) => void; progress: string | null; staleWeeks: number }) {
  const [why, setWhy] = useState(false);
  const kinds = f.kinds ?? [];
  const only = (k: KindKey | "stale") => {
    const { kinds: _k, stale: _s, ...rest } = f;
    const on = k === "stale" ? !!f.stale : kinds.length === 1 && kinds[0] === k;
    set(on ? rest : k === "stale" ? { ...rest, stale: true } : { ...rest, kinds: [k] });
  };
  const chip = (k: KindKey | "stale", word: string, n: number) => {
    const active = k === "stale" ? !!f.stale : kinds.includes(k);
    return (
      <button key={k} type="button" className={`ah-fx-kind${active ? " on" : ""}`} aria-pressed={active} aria-disabled={!n && !active ? true : undefined} title={active ? "Show every kind again" : n ? `Show only ${word.toLowerCase()}` : `Nothing is ${word.toLowerCase()} here`} onClick={() => (n || active) && only(k)}>
        {word} <strong>{n}</strong>
      </button>
    );
  };
  return (
    <div className="ah-att-line" role="group" aria-label="Needs attention, by kind">
      <span className="ah-fx-why">
        <button type="button" className="mini quiet" aria-describedby="ah-why-tip" aria-expanded={why} onClick={() => setWhy(!why)} onMouseEnter={() => setWhy(true)} onMouseLeave={() => setWhy(false)} onFocus={() => setWhy(true)} onBlur={() => setWhy(false)}>
          Why these?
        </button>
        <span id="ah-why-tip" role="tooltip" className="ah-fx-tip" hidden={!why}>
          Items you can change near the top of each backlog, dated in the next 4 weeks, or yours, that are missing stories, a target date, an owner or a size, or have had no change in DevOps for {staleWeeks} weeks. In backlog order: work from the top.
        </span>
      </span>
      {start.n > 0 && (
        <button type="button" className={`ah-fx-kind ah-fx-start-btn${start.on ? " on" : ""}`} aria-pressed={start.on} title={start.on ? "Show everything that needs attention again" : `Only the ${start.n} most urgent. ${START_RULE}`} onClick={start.toggle}>
          Start here <strong>{start.n}</strong>
        </button>
      )}
      {(Object.keys(KIND_LABELS) as KindKey[]).map((k) => chip(k, KIND_LABELS[k], counts[k]))}
      {chip("stale", "Stale", stale)}
      {progress && <span className="muted ah-fx-progress">{progress}</span>}
    </div>
  );
}
