// AH-6: Ahead's one toolbar, the same in Grid, Gantt, Readiness and Backlog, with the same controls in the same places.
// Filters on the left, in labelled groups: Clients, People, Epic, Dates, Readiness, Search. The view on the right:
// Show (levels), Callouts, Whole project. A control that can't apply in a mode is shown disabled with the reason as
// its tooltip, never removed, so the layout never moves. Under it, one line says what's shown ("Showing 76 of 132 ·
// Northwind Foods · Everyone · Next 4 weeks") with a removable chip per non-default filter and Clear filters.
// No native selects or date inputs: AH-5's popover, date picker and filterable list.
import type React from "react";
import { useRef, useState, type CSSProperties } from "react";
import type { AheadLoad } from "../../actions/types.ts";
import type { AheadFilters, AheadGapKind, AheadOwner } from "../../plan/ahead-edit.ts";
import { cleared, dateWords, KIND_WORDS, KINDS, notHere, notReadyOnly, PEOPLE_WORDS, peopleWord, RANGE_WORDS, RANGES, readinessWords, summary, type AheadModeKey, type Control } from "../../plan/ahead-view.ts";
import type { Fold } from "../../plan/gantt-tree.ts";
import { DEFAULT_AHEAD } from "../../plan/backlog.ts";
import { CellPopover, Segmented } from "../CellPopover.tsx";
import { DatePicker } from "../DatePicker.tsx";
import { SelectField } from "../SelectField.tsx";
import { LevelControl } from "./Levels.tsx";
import { DEFAULT_FILTERS, epicsOf, type Tier } from "./model.ts";

export type AheadViewState = {
  fold: Fold;
  setFold: (f: Fold | ((o: Fold) => Fold)) => void;
  names: Record<Tier, string>;
  callouts: boolean;
  setCallouts: (on: boolean) => void;
};

const toggle = <T,>(list: readonly T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

/** One labelled group. Off: shown, but every control in it says why it doesn't apply here. */
function Group({ label, control, off, children, className = "" }: { label: string; control: Control; off?: string | null; children: React.ReactNode; className?: string }) {
  return (
    <div className={`ah-tb-group ${className}${off ? " off" : ""}`} role="group" aria-label={label} data-control={control} title={off ?? undefined}>
      <span className="ah-tb-label" aria-hidden="true">
        {label}
      </span>
      {children}
    </div>
  );
}

/** A button that says why it can't be used here instead of disappearing (aria-disabled keeps its tooltip and focus). */
function OffButton({ off, onClick, className = "", children, ...rest }: { off: string | null; onClick: () => void; className?: string; children: React.ReactNode } & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "className">) {
  return (
    <button type="button" {...rest} className={`${className}${off ? " is-off" : ""}`} aria-disabled={off ? true : undefined} title={off ?? rest.title} onClick={() => !off && onClick()}>
      {children}
    </button>
  );
}

export function Toolbar({ mode, load, f, set, setWhole, view, counts, color }: {
  mode: AheadModeKey;
  load: AheadLoad;
  f: AheadFilters;
  set: (f: AheadFilters) => void;
  setWhole: (whole: boolean) => void;
  view: AheadViewState;
  counts: { shown: number; total: number };
  color: (k: string) => string;
}) {
  const scoped = load.clients.filter((c) => c.scope && !c.scope.all);
  const ctx = { scoped: scoped.length > 0, whole: !!f.whole };
  const off = (c: Control) => notHere(mode, c, ctx);
  const shownClients = load.clients.filter((c) => !f.clients.length || f.clients.includes(c.clientKey));
  const people = peopleWord(f, shownClients);
  const setOwner = (o: AheadOwner) => set({ ...f, owner: { ...f.owner, ...Object.fromEntries(shownClients.map((c) => [c.clientKey, o])) } });
  const epics = epicsOf(load, f);
  const epicLabel = f.epic ? (epics.find((e) => e.key === f.epic)?.label ?? null) : null;
  const sum = summary(load.clients, f, { today: load.today, shown: counts.shown, total: counts.total, epicLabel });
  const scopeTitle = scoped.map((c) => `${c.clientName}: ${c.scope!.inScope} of ${c.scope!.total} open items are Cooptimize's work`).join("\n");
  const wholeOff = off("whole");

  return (
    <section className="ah-toolbar" aria-label="Filters and view" data-mode={mode}>
      <div className="ah-tb-row">
        <div className="ah-tb-filters">
          <Group label="Clients" control="clients">
            <span className="rm-chips">
              {load.clients.map((c) => (
                <button key={c.clientKey} type="button" className="rm-chip" style={{ "--c": color(c.clientKey) } as CSSProperties} aria-pressed={f.clients.includes(c.clientKey)} onClick={() => set({ ...f, clients: toggle(f.clients, c.clientKey), epic: null })}>
                  <span className="dl-swatch" aria-hidden="true" />
                  {c.clientName}
                </button>
              ))}
            </span>
          </Group>
          <Group label="People" control="people">
            <span className="rm-seg" data-tour="ah-owner" title="Mine: assigned to you and what's under your features and epics. Contributing: the features and epics your stories are under. Everyone: all of Cooptimize's work. Remembered per client.">
              {(["mine", "contributing", "all"] as const).map((o) => (
                <button key={o} type="button" aria-pressed={people.owner === o} onClick={() => setOwner(o)}>
                  {PEOPLE_WORDS[o]}
                </button>
              ))}
            </span>
          </Group>
          <Group label="Epic" control="epic" off={epics.length ? null : "No epics in the clients shown"}>
            {epics.length ? (
              <SelectField label="Epic" value={f.epic ?? ""} onChange={(k) => set({ ...f, epic: k || null })} options={[{ key: "", label: "Any" }, ...epics.map((x) => ({ key: x.key, label: x.label }))]} className="ah-tb-select" />
            ) : (
              <OffButton off="No epics in the clients shown" onClick={() => null} className="date-field select-field ah-tb-select">
                Any
              </OffButton>
            )}
          </Group>
          <Group label="Dates" control="dates">
            <DatesButton f={f} set={set} today={load.today} />
          </Group>
          <Group label="Readiness" control="readiness">
            <ReadinessButton f={f} set={set} notReadyOff={off("readiness")} staleWeeks={load.staleWeeks ?? DEFAULT_AHEAD.staleWeeks} />
          </Group>
          <Group label="Search" control="search" className="ah-tb-search">
            <span className="ah-search">
              <input className="rm-search" type="text" placeholder="Titles or #id" aria-label="Search titles or #id" value={f.q} onChange={(e) => set({ ...f, q: e.target.value })} onKeyDown={(e) => e.key === "Escape" && f.q && (e.stopPropagation(), set({ ...f, q: "" }))} />
              {f.q && (
                <button type="button" className="ah-search-clear" aria-label="Clear the search" onClick={() => set({ ...f, q: "" })}>
                  ×
                </button>
              )}
            </span>
          </Group>
        </div>
        <div className="ah-tb-view" role="group" aria-label="View">
          <Group label="Show" control="level">
            <LevelControl fold={view.fold} setFold={view.setFold} names={view.names} />
          </Group>
          <Group label="Callouts" control="callouts" off={off("callouts")}>
            <OffButton off={off("callouts")} className="rm-chip ah-callouts-toggle" aria-pressed={view.callouts} onClick={() => view.setCallouts(!view.callouts)} title="The marker at the end of a bar: what needs attention, with its fix">
              {view.callouts ? "On" : "Off"}
            </OffButton>
          </Group>
          <Group label="Whole project" control="whole" off={wholeOff}>
            <OffButton off={wholeOff} className="rm-chip ah-whole" aria-pressed={!!f.whole} onClick={() => setWhole(!f.whole)} title={scopeTitle || "Every item in the project, not only Cooptimize's work"}>
              {f.whole ? "On" : "Off"}
            </OffButton>
          </Group>
        </div>
      </div>
      <div className="ah-tb-summary" role="status">
        <span className="ah-tb-sumtext">{sum.text}</span>
        {sum.chips.length > 0 && (
          <span className="ah-tb-chips">
            {sum.chips.map((c) => (
              <button key={c.id} type="button" className="ah-tb-chip" data-chip={c.id} aria-label={`Remove the filter ${c.label}`} title="Remove this filter" onClick={() => set(c.clear(f))}>
                {c.label}
                <span aria-hidden="true">×</span>
              </button>
            ))}
            <button type="button" className="mini quiet ah-tb-clear" onClick={() => set(cleared(f, DEFAULT_FILTERS))}>
              Clear filters
            </button>
          </span>
        )}
      </div>
    </section>
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
          ▾
        </span>
      </button>
      {open && (
        <CellPopover anchor={btn.current} title="Dates" sub="items that overlap them" onSave={close} onCancel={close} saveLabel="Done" className="ah-tb-pop">
          <div className="ah-tb-picks" role="group" aria-label="Quick picks">
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

/** Readiness: Any or Not ready only, the kinds that count, and Stale. */
function ReadinessButton({ f, set, notReadyOff, staleWeeks }: { f: AheadFilters; set: (f: AheadFilters) => void; notReadyOff: string | null; staleWeeks: number }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const close = () => (setOpen(false), requestAnimationFrame(() => btn.current?.focus()));
  const kinds = f.kinds ?? [];
  const words = `${notReadyOff ? (kinds.length ? readinessWords({ gaps: true, kinds }) : "Any") : readinessWords(f)}${f.stale ? " · Stale" : ""}`;
  const setKinds = (k: AheadGapKind[]) => {
    const { kinds: _k, ...rest } = f;
    set(k.length ? { ...rest, kinds: k, gaps: true } : rest);
  };
  return (
    <>
      <button ref={btn} type="button" className="date-field select-field ah-tb-select" aria-label={`Readiness: ${words}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>{words}</span>
        <span className="date-field-icon" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <CellPopover anchor={btn.current} title="Readiness" onSave={close} onCancel={close} saveLabel="Done" className="ah-tb-pop">
          <div className={`ah-tb-ready${notReadyOff ? " off" : ""}`} title={notReadyOff ?? undefined}>
            {notReadyOff ? (
              <p className="muted ah-tb-note">{notReadyOff}.</p>
            ) : (
              <Segmented
                label="Readiness"
                value={notReadyOnly(f) ? "not" : "any"}
                onChange={(v) => {
                  const { kinds: _k, ...rest } = f;
                  set(v === "not" ? { ...f, gaps: true } : { ...rest, gaps: false });
                }}
                options={[{ value: "any", label: "Any" }, { value: "not", label: "Not ready only" }]}
              />
            )}
          </div>
          <div className="ah-tb-kinds" role="group" aria-label="Missing">
            <span className="muted ah-tb-sub">Missing</span>
            {KINDS.map((k) => (
              <button key={k} type="button" className="rm-chip" aria-pressed={kinds.includes(k)} onClick={() => setKinds(toggle(kinds, k))}>
                {KIND_WORDS[k]}
              </button>
            ))}
          </div>
          <div className="ah-tb-kinds">
            <button type="button" className="rm-chip" data-tour="ah-stale" aria-pressed={!!f.stale} onClick={() => set({ ...f, stale: !f.stale })} title={`Open items with no change in DevOps for ${staleWeeks} weeks or more (Settings › Ahead)`}>
              Stale
            </button>
            <span className="muted ah-tb-sub">No change in DevOps for {staleWeeks} weeks</span>
          </div>
        </CellPopover>
      )}
    </>
  );
}
