// AH-1 (D653): Ahead is one model in three modes: Grid, Gantt and Fix next. This is the frame they share: the
// filters (client, epic, owner, has gaps, dates, text; remembered per person, D654), my change set ("N changes
// pending · Review", in every mode, surviving a reload, D657), the slim Fix next pane beside Grid and Gantt, and the
// review that commits through the write framework (preview, confirm, read back, audit log, undo), one patch per item,
// in batches of 10. Nothing is written to DevOps until Commit.
import { CloseButton, useReturnFocus } from "../CloseButton.tsx";
import type React from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { AheadFilters, AheadOwner } from "../../plan/ahead-edit.ts";
import type { AheadLoad, DevOpsLogView, RoadmapRow, RoadmapState, WeekLoadData } from "../../actions/types.ts";
import { byItem, pendingText, valueText, type ChangeField, type ChangeValue, type DayHalf, type StagedChange } from "../../plan/ahead-edit.ts";
import { fixCount } from "../../plan/fixnext.ts";
import { call } from "../api.ts";
import { useDevOpsWrite } from "../DevOpsWrite.tsx";
import { TypeIcon } from "../TypeIcon.tsx";
import { openBreakDown, type PanelAction } from "../menu.ts";
import { openSend } from "../send-event.ts";
import { clientColor } from "../labels.ts";
import { ModeArea } from "../ModeSwitch.tsx";
import type { AheadMode } from "../nav.ts";
import { buildRows, DEFAULT_FILTERS, epicsOf, fixGroups, groups, ownerOf, type Group, type Row } from "./model.ts";
import { Grid } from "./Grid.tsx";
import { Gantt } from "./Gantt.tsx";
import { FixNext } from "./FixNext.tsx";
import { Backlog } from "./Backlog.tsx";
import { backlogGroups, DEFAULT_AHEAD } from "../../plan/backlog.ts";
import { gridLayout, useWindowScale } from "./layout.ts";
import type { ModeName } from "../nav.ts";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const BATCH = 10;

/** What every mode needs: the model, staging, the side panels. */
export type AheadEnv = {
  load: AheadLoad;
  /** Roadmap's states for features and epics (by "client:id"), once read. */
  roadmap: Map<string, RoadmapRow>;
  readOnly: boolean;
  stage: (r: Row, field: ChangeField, value: ChangeValue, half?: DayHalf | null) => Promise<boolean>;
  unstage: (r: Row, field?: ChangeField) => Promise<void>;
  /** BH-1: my change set after a bulk action staged it on the server. */
  setChanges: (changes: StagedChange[]) => void;
  /** Break down's side panel for a feature or epic (Coop brief one click away there). */
  breakDown: (r: Row) => void;
  color: (clientKey: string) => string;
  /** The item a notice opened (#/ahead/item/<id>). */
  focusItem: number | null;
  error: (s: string) => void;
};
export const AheadCtx = createContext<AheadEnv | null>(null);
export const useAhead = () => useContext(AheadCtx)!;

export function Ahead({ data, mode, item, switcher, renderSwitch, onChanged, readOnly }: { data: WeekLoadData; mode: AheadMode; item: number | null; switcher?: React.ReactNode; renderSwitch?: (counts: Partial<Record<ModeName, number>>) => React.ReactNode; onChanged: () => void; readOnly: boolean }) {
  const win = useWindowScale();
  const layout = gridLayout(win.width, win.scale);
  const [load, setLoad] = useState<AheadLoad | null>(null);
  const [filters, setFiltersRaw] = useState<AheadFilters | null>(null);
  const [roadmap, setRoadmap] = useState<Map<string, RoadmapRow>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState(false);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const head = useRef<HTMLHeadingElement>(null);
  const dw = useDevOpsWrite();

  // BH-1: only Backlog asks for the change log's last change per item.
  const wantLast = useRef(mode === "backlog");
  wantLast.current = wantLast.current || mode === "backlog";
  const reload = useCallback(async (refresh = false) => {
    setBusy(true);
    try {
      const l = await call<AheadLoad>("ahead.load", { ...(refresh ? { refresh: true } : {}), ...(wantLast.current ? { lastChanges: true } : {}) });
      setLoad(l);
      setError(null);
      void call<RoadmapState>("roadmap.load", refresh ? { refresh: true } : {}).then(
        (r) => setRoadmap(new Map(r.clients.flatMap((c) => c.rows.map((x) => [`${c.clientKey}:${x.id}`, x] as const)))),
        () => null,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read Ahead");
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => void reload(), [reload, dw?.version]);
  useEffect(() => {
    call<{ filters: AheadFilters | null }>("ahead.filters", {}).then((r) => setFiltersRaw({ ...DEFAULT_FILTERS, ...(r.filters ?? {}) }), () => setFiltersRaw(DEFAULT_FILTERS));
  }, []);
  useEffect(() => head.current?.focus(), [mode]);
  const askedLast = useRef(mode === "backlog");
  useEffect(() => {
    if (mode === "backlog" && !askedLast.current) {
      askedLast.current = true;
      void reload();
    }
  }, [mode, reload]);

  const setFilters = (f: AheadFilters) => {
    setFiltersRaw(f);
    void call("ahead.set_filters", { filters: f }).catch(() => null);
  };
  // AH-2: "Show the whole project" changes what the server reads, so it's saved first, then Ahead reads again.
  const setWhole = async (whole: boolean) => {
    const next = { ...(filters ?? DEFAULT_FILTERS), whole };
    setFiltersRaw(next);
    await call("ahead.set_filters", { filters: next }).catch(() => null);
    await reload();
  };

  const stage: AheadEnv["stage"] = async (r, field, value, half = null) => {
    try {
      const res = await call<{ changes: StagedChange[] }>("ahead.stage", { clientKey: r.clientKey, itemId: r.item.id, field, value, ...(half ? { half } : {}) });
      setLoad((l) => (l ? { ...l, changes: res.changes } : l));
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "That change couldn't be kept");
      return false;
    }
  };
  const unstage: AheadEnv["unstage"] = async (r, field) => {
    const res = await call<{ changes: StagedChange[] }>("ahead.unstage", { clientKey: r.clientKey, itemId: r.item.id, ...(field ? { field } : {}) }).catch(() => null);
    if (res) setLoad((l) => (l ? { ...l, changes: res.changes } : l));
  };
  // The side panel's action list (D665): Send to… for a feature, SW-1's one dialog and rules (an epic is sent through its features).
  const panelActions = (r: Row): PanelAction[] =>
    r.tier === "feature" && r.item.id > 0
      ? [{ id: "send", label: "Send to…", hint: "a teammate's week", run: () => openSend({ clientKey: r.clientKey, clientName: load?.clients.find((c) => c.clientKey === r.clientKey)?.clientName ?? null, itemId: r.item.id, level: "feature", title: r.item.title, itemType: r.item.type, url: r.item.url, parentId: r.item.parentId }) }]
      : [];
  const breakDown = (r: Row) => openBreakDown(r.clientKey, { id: r.item.id, title: r.item.title, type: r.item.type, actions: panelActions(r) });

  const f = filters ?? DEFAULT_FILTERS;
  const shown: Group[] = useMemo(() => (load ? groups(load, f, { stories: mode !== "gantt" }) : []), [load, f, mode]);
  // AH-3: Fix next for every client, whatever the filters (it has none): ranked by each client's backlog.
  const fix = useMemo(() => (load ? fixGroups(load, { readOnly, skipped }) : []), [load, skipped, readOnly]);
  const fixN = fixCount(fix.map((x) => x.group));
  const tier = f.tier ?? "story";
  const backlog = useMemo(() => (load && mode === "backlog" ? backlogGroups(load, f, { staleWeeks: load.staleWeeks ?? DEFAULT_AHEAD.staleWeeks, last: Object.fromEntries(load.clients.flatMap((c) => (c.last ? [[c.clientKey, c.last] as const] : []))) }) : []), [load, f, mode]);

  const n = load?.changes.length ?? 0;
  const color = (k: string) => clientColor(k, data.clients);
  const setChanges = (changes: StagedChange[]) => setLoad((l) => (l ? { ...l, changes } : l));
  const env: AheadEnv | null = load ? { load, roadmap, readOnly, stage, unstage, setChanges, breakDown, color, focusItem: item, error: setError } : null;
  const anyFilter = f.clients.length || f.epic || f.gaps || f.from || f.to || f.q.trim();
  const visible = mode === "backlog" ? backlog.reduce((k, g) => k + g.rows.length, 0) : shown.reduce((k, g) => k + g.rows.filter((r) => !r.context).length, 0);
  const title = mode === "fix" ? "Gaps" : mode === "gantt" ? "Gantt" : mode === "backlog" ? "Backlog" : "Grid";

  return (
    <main className={`roadmap ahead ahead-${mode}`} aria-label={`Ahead: ${title}`}>
      <div className="follow-ups-head">
        <h2 ref={head} tabIndex={-1}>
          Ahead <span className="muted">{load ? (mode === "fix" ? plural(fixN, "thing to fix", "things to fix") : plural(visible, "item", "items")) : ""}</span>
        </h2>
        <button type="button" className="top-btn" disabled={busy} onClick={() => void reload(true)} title="Read DevOps again">
          {busy ? "Reading…" : "Refresh"}
        </button>
        <ModeArea>{renderSwitch && load && !readOnly ? renderSwitch({ fix: fixN }) : switcher}</ModeArea>
      </div>
      {load && n > 0 && (
        <div className="ah-pending" role="status">
          <strong>{pendingText(n)}</strong>
          <span className="muted">{load.changes.some((c) => c.theirs !== undefined) ? "Some changed in DevOps since you started. " : ""}Nothing is written until you save.</span>
          <button type="button" className="primary" onClick={() => setReview(true)} disabled={readOnly}>
            Review
          </button>
        </div>
      )}
      {readOnly && load && <p className="muted ah-ro-note">Read only on a phone. Open FocusTime on a computer to change dates, sizes or owners.</p>}
      {load && filters && mode !== "fix" && mode !== "backlog" && <Filters load={load} f={f} set={setFilters} setWhole={(w) => void setWhole(w)} color={color} anyFilter={!!anyFilter} />}
      {load && filters && mode === "backlog" && <BacklogFilters load={load} f={f} set={setFilters} color={color} />}
      {load && <ScopeNote load={load} whole={!!f.whole} />}
      {error && <p className="error" role="alert">{error}</p>}
      {!load && !error && <p className="muted">Reading DevOps…</p>}
      {env && (
        <AheadCtx.Provider value={env}>
          <div className={`ah-body lay-${layout}`}>
            <div className="ah-main">
              {load && !load.clients.length && <p className="muted">No followed clients with DevOps this week.</p>}
              {load && load.clients.length > 0 && mode !== "fix" && mode !== "backlog" && visible === 0 && <p className="muted">{anyFilter ? "Nothing matches these filters." : "Nothing here for you yet. Try Owner: All."}</p>}
              {mode === "grid" && <Grid groups={shown} layout={layout} />}
              {mode === "gantt" && <Gantt data={data} groups={shown} onChanged={onChanged} />}
              {mode === "backlog" && <Backlog groups={backlog} tier={tier} onChanged={onChanged} />}
              {mode === "fix" && <FixNext groups={fix} skip={(k) => setSkipped((s) => new Set(s).add(k))} dots={layout === "cards" || layout === "dots"} />}
            </div>
          </div>
          {review && <Review onClose={() => setReview(false)} onDone={() => void reload()} />}
        </AheadCtx.Provider>
      )}
    </main>
  );
}

/**
 * AH-2: one quiet line for the clients whose scope is automatic and narrows what's shown (a project with only its root
 * area shows everything, so it gets none), and a problem with a set scope (teams not readable) in plain words.
 */
function ScopeNote({ load, whole }: { load: AheadLoad; whole: boolean }) {
  const auto = load.clients.filter((c) => c.scope?.automatic && !c.scope.all);
  const problems = load.clients.filter((c) => c.scope?.problem);
  if (!auto.length && !problems.length) return null;
  const names = (cs: typeof auto) => (cs.length === 1 ? cs[0]!.clientName : `${cs.slice(0, -1).map((c) => c.clientName).join(", ")} and ${cs[cs.length - 1]!.clientName}`);
  return (
    <div className="ah-scope-note">
      {auto.length > 0 && (
        <p className="muted">
          {whole ? "Showing the whole project" : "Showing Cooptimize's work (automatic)"} for {names(auto)}. Set the scope in Admin › Clients.
        </p>
      )}
      {problems.map((c) => (
        <p key={c.clientKey} className="muted">
          {c.clientName}: {c.scope!.problem}.
        </p>
      ))}
    </div>
  );
}

/**
 * BH-1: Backlog's filters: the clients (as everywhere in Ahead), the owner (Mine, Contributing, Everything in scope;
 * remembered per client with Grid's), the tier and Stale. Saved with Ahead's other filters.
 */
function BacklogFilters({ load, f, set, color }: { load: AheadLoad; f: AheadFilters; set: (f: AheadFilters) => void; color: (k: string) => string }) {
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const shownClients = load.clients.filter((c) => !f.clients.length || f.clients.includes(c.clientKey));
  const owners = new Set(shownClients.map((c) => ownerOf(f, c)));
  const owner: AheadOwner | null = owners.size === 1 ? [...owners][0]! : null;
  const setOwner = (o: AheadOwner) => set({ ...f, owner: { ...f.owner, ...Object.fromEntries(shownClients.map((c) => [c.clientKey, o])) } });
  const tier = f.tier ?? "story";
  return (
    <div className="rm-filters ah-filters bl-filters">
      <span className="rm-chips" role="group" aria-label="Clients">
        {load.clients.map((c) => (
          <button key={c.clientKey} type="button" className="rm-chip" style={{ "--c": color(c.clientKey) } as CSSProperties} aria-pressed={f.clients.includes(c.clientKey)} onClick={() => set({ ...f, clients: toggle(f.clients, c.clientKey) })}>
            <span className="dl-swatch" aria-hidden="true" />
            {c.clientName}
          </button>
        ))}
      </span>
      <span className="rm-seg" role="group" aria-label="Level">
        {(["story", "feature", "epic"] as const).map((t) => (
          <button key={t} type="button" aria-pressed={tier === t} onClick={() => set({ ...f, tier: t })}>
            {t === "story" ? "Stories" : t === "feature" ? "Features" : "Epics"}
          </button>
        ))}
      </span>
      <span className="rm-seg" role="group" aria-label="Owner" title="Mine: assigned to you and what's under your features and epics. Contributing: the features and epics your stories are under. Remembered per client.">
        {(["mine", "contributing", "all"] as const).map((o) => (
          <button key={o} type="button" aria-pressed={owner === o} onClick={() => setOwner(o)}>
            {o === "mine" ? "Mine" : o === "contributing" ? "Contributing" : "Everything in scope"}
          </button>
        ))}
      </span>
      <button type="button" className="rm-chip" aria-pressed={!!f.stale} onClick={() => set({ ...f, stale: !f.stale })} title={`Only open items with no change in DevOps for ${load.staleWeeks ?? DEFAULT_AHEAD.staleWeeks} weeks or more (Settings › Ahead)`}>
        Stale
      </button>
    </div>
  );
}

function Filters({ load, f, set, setWhole, color, anyFilter }: { load: AheadLoad; f: AheadFilters; set: (f: AheadFilters) => void; setWhole: (whole: boolean) => void; color: (k: string) => string; anyFilter: boolean }) {
  const scoped = load.clients.filter((c) => c.scope && !c.scope.all);
  const scopeTitle = scoped.map((c) => `${c.clientName}: ${c.scope!.inScope} of ${c.scope!.total} open items are Cooptimize's work`).join("\n");
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const shownClients = load.clients.filter((c) => !f.clients.length || f.clients.includes(c.clientKey));
  const owners = new Set(shownClients.map((c) => ownerOf(f, c)));
  const owner: AheadOwner | null = owners.size === 1 ? [...owners][0]! : null;
  const setOwner = (o: AheadOwner) => set({ ...f, owner: { ...f.owner, ...Object.fromEntries(shownClients.map((c) => [c.clientKey, o])) } });
  const epics = epicsOf(load, f);
  return (
    <div className="rm-filters ah-filters">
      <span className="rm-chips" role="group" aria-label="Clients">
        {load.clients.map((c) => (
          <button key={c.clientKey} type="button" className="rm-chip" style={{ "--c": color(c.clientKey) } as CSSProperties} aria-pressed={f.clients.includes(c.clientKey)} onClick={() => set({ ...f, clients: toggle(f.clients, c.clientKey), epic: null })}>
            <span className="dl-swatch" aria-hidden="true" />
            {c.clientName}
          </button>
        ))}
      </span>
      <span className="rm-seg" role="group" aria-label="Owner" title="Mine: assigned to you and what's under your features and epics. Contributing: the features and epics your stories are under. Remembered per client.">
        {(["mine", "contributing", "all"] as const).map((o) => (
          <button key={o} type="button" aria-pressed={owner === o} onClick={() => setOwner(o)}>
            {o === "mine" ? "Mine" : o === "contributing" ? "Contributing" : "All"}
          </button>
        ))}
      </span>
      {epics.length > 0 && (
        <label className="rm-sort">
          Epic
          <select value={f.epic ?? ""} onChange={(e) => set({ ...f, epic: e.target.value || null })}>
            <option value="">Any</option>
            {epics.map((x) => (
              <option key={x.key} value={x.key}>
                {x.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <button type="button" className="rm-chip ah-gaps" aria-pressed={f.gaps} onClick={() => set({ ...f, gaps: !f.gaps })} title="Only items missing dates, an owner, a size or stories">
        Has gaps
      </button>
      <label className="rm-sort">
        From
        <input type="date" value={f.from ?? ""} onChange={(e) => set({ ...f, from: e.target.value || null })} />
      </label>
      <label className="rm-sort">
        To
        <input type="date" value={f.to ?? ""} onChange={(e) => set({ ...f, to: e.target.value || null })} />
      </label>
      <input className="rm-search" type="search" placeholder="Search titles or #id" aria-label="Search Ahead" value={f.q} onChange={(e) => set({ ...f, q: e.target.value })} />
      {(scoped.length > 0 || f.whole) && (
        <button type="button" className="rm-chip ah-whole" aria-pressed={!!f.whole} onClick={() => setWhole(!f.whole)} title={scopeTitle || "Every item in the project, not only Cooptimize's work"}>
          Show the whole project
        </button>
      )}
      {anyFilter && (
        <button type="button" className="mini quiet" onClick={() => set({ ...DEFAULT_FILTERS, owner: f.owner, ...(f.whole ? { whole: true } : {}) })}>
          Clear filters
        </button>
      )}
    </div>
  );
}

/** "Mon, Nov 16 PM", "5 (Story Points)", "Dana Reyes", or "None". */
export function changeText(c: Pick<StagedChange, "field" | "value" | "half">, sizeLabel: string | null): string {
  if (c.field === "size") return typeof c.value === "number" ? `${c.value}${sizeLabel ? ` ${sizeLabel}` : ""}` : "None";
  return valueText(c.field, c.value, c.half);
}
const FIELD_WORD: Record<ChangeField, string> = { start: "Start", target: "Target", size: "Size", assignee: "Assigned to" };

/**
 * The review (D657): my changes grouped by item, before → after, each removable; a conflict shows DevOps's value now
 * with Keep mine or Take theirs (D658). Commit previews each client's items in batches of 10 through the write
 * framework; what landed leaves the list, what didn't stays with its reason, and Retry is the preview's Try again.
 */
function Review({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const a = useAhead();
  const dw = useDevOpsWrite();
  const [busy, setBusy] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [landed, setLanded] = useState<DevOpsLogView["entries"]>([]);
  const [since] = useState(() => new Date().toISOString());
  const panel = useRef<HTMLDivElement>(null);
  useReturnFocus();
  useEffect(() => panel.current?.focus(), []);
  const rowsByKey = useMemo(() => new Map(a.load.clients.flatMap((c) => buildRows(a.load, c).map((r) => [r.key, r] as const))), [a.load]);
  const items = byItem(a.load.changes);
  const clientName = (k: string) => a.load.clients.find((c) => c.clientKey === k)?.clientName ?? k;
  const refreshLanded = useCallback(async () => {
    const log = await call<DevOpsLogView>("devops.log", {}).catch(() => null);
    if (log) setLanded(log.entries.filter((e) => (e.op === "fields" || e.op === "undo_fields") && e.at >= since));
  }, [since]);
  useEffect(() => void refreshLanded(), [refreshLanded, dw?.version]);

  const resolve = async (clientKey: string, itemId: number, keep: "mine" | "theirs") => {
    await call("ahead.resolve", { clientKey, itemId, keep }).catch((e: unknown) => a.error(e instanceof Error ? e.message : "That didn't work"));
    onDone();
  };
  const commit = async () => {
    if (!dw) return;
    setBusy(true);
    try {
      const perClient = new Map<string, number[]>();
      for (const g of items) if (!g.changes.some((c) => c.theirs !== undefined)) perClient.set(g.clientKey, [...(perClient.get(g.clientKey) ?? []), g.itemId]);
      for (const [clientKey, ids] of perClient) {
        if (!dw.can(clientKey)) continue;
        for (let i = 0; i < ids.length; i += BATCH) {
          const chunk = ids.slice(i, i + BATCH);
          const done = await new Promise<{ confirmed: boolean; sent: boolean }>((ok) => void dw.begin(clientKey, chunk.map((itemId) => ({ kind: "fields" as const, itemId })), ok));
          // Cancelled before Confirm: stop here, nothing more is sent.
          if (!done.sent) return;
        }
      }
    } finally {
      setBusy(false);
      onDone();
      void refreshLanded();
    }
  };
  const blocked = [...new Set(items.map((g) => g.clientKey))].filter((k) => !dw?.can(k));
  const conflicts = items.filter((g) => g.changes.some((c) => c.theirs !== undefined)).length;
  const ready = items.length - conflicts - items.filter((g) => blocked.includes(g.clientKey)).length;

  const changeCount = a.load.changes.length;
  const lookOf = (clientKey: string, type: string | undefined) => (type ? (a.load.clients.find((c) => c.clientKey === clientKey)?.types.find((t) => t.name === type) ?? null) : null);

  return (
    <div className="bd-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <aside
        ref={panel}
        tabIndex={-1}
        className="bd-panel ah-review"
        data-overlay="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Review changes"
        onKeyDown={(e) => {
          if (e.key === "Escape" && !busy) (e.stopPropagation(), e.preventDefault(), onClose());
        }}
      >
        <header className="bd-head">
          <h2>Review changes</h2>
          <CloseButton onClose={onClose} disabled={busy} />
        </header>
        <div className="bd-body ah-review-body">
          <p className="muted ah-review-sum">
            {items.length
              ? `${plural(changeCount, "change", "changes")} on ${plural(items.length, "item", "items")}. Each item is written to DevOps as one change, only if nobody changed those fields since you started editing.`
              : "Nothing pending."}
          </p>
          {blocked.map((k) => (
            <p key={k} className="set-problem">
              {clientName(k)}: DevOps writes aren't on for you.{" "}
              <button type="button" className="mini" onClick={() => dw?.enable(k)}>
                Enable DevOps writes
              </button>
            </p>
          ))}
          {items.length > 0 && (
            // AH-2: one grid for every card (Field | Before | → | After | Remove), so arrows and values line up.
            <div className="ah-rv-grid" role="list">
              <div className="ah-rv-cols" aria-hidden="true">
                <span>Field</span>
                <span>Before</span>
                <span />
                <span>After</span>
                <span />
              </div>
              {items.map((g) => {
                const r = rowsByKey.get(`${g.clientKey}:${g.itemId}`);
                const conflict = g.changes.some((c) => c.theirs !== undefined);
                const look = lookOf(g.clientKey, r?.item.type);
                return (
                  <section key={`${g.clientKey}:${g.itemId}`} role="listitem" className={`ah-review-item ah-rv-card${conflict ? " conflict" : ""}`} aria-label={`#${g.itemId} ${r?.item.title ?? ""}`}>
                    <h3 className="ah-rv-title">
                      <span className="dl-swatch" style={{ "--c": a.color(g.clientKey) } as CSSProperties} aria-hidden="true" />
                      {r && <TypeIcon type={r.item.type} look={look} />}
                      <span className="ah-rv-name">
                        #{g.itemId} {r?.item.title ?? ""}
                      </span>
                      <span className="muted ah-rv-client">{clientName(g.clientKey)}</span>
                    </h3>
                    {conflict && (
                      <p className="ah-conflict ah-rv-conflict" role="alert">
                        <span>Changed in DevOps since you started editing.</span>
                        <button type="button" className="mini" onClick={() => void resolve(g.clientKey, g.itemId, "mine")}>
                          Keep mine
                        </button>
                        <button type="button" className="mini quiet" onClick={() => void resolve(g.clientKey, g.itemId, "theirs")}>
                          Take theirs
                        </button>
                      </p>
                    )}
                    {g.changes.map((c) => {
                      const field = c.field === "size" ? (r?.sizeLabel ?? "Size") : FIELD_WORD[c.field];
                      const before = changeText({ field: c.field, value: c.baseValue, half: null }, null);
                      const after = changeText(c, null);
                      return (
                        <div key={c.field} className={`ah-rv-row${c.theirs !== undefined ? " conflict" : ""}`} role="group" aria-label={`${field}: ${before} to ${after}`}>
                          <span className="ah-rv-field">{field}</span>
                          <span className="ah-rv-before">{before}</span>
                          <span className="ah-rv-arrow" aria-hidden="true">
                            →
                          </span>
                          <span className="ah-rv-after">
                            <strong>{after}</strong>
                            {c.theirs !== undefined && <span className="ah-theirs">DevOps has {changeText({ field: c.field, value: c.theirs, half: null }, null)} now</span>}
                          </span>
                          <span className="ah-rv-remove">
                            <button type="button" className="mini quiet" disabled={busy} onClick={() => r && void a.unstage(r, c.field)} aria-label={`Remove the ${FIELD_WORD[c.field].toLowerCase()} change on #${g.itemId}`}>
                              Remove
                            </button>
                          </span>
                        </div>
                      );
                    })}
                  </section>
                );
              })}
            </div>
          )}
          {landed.length > 0 && (
            <section className="ah-landed" aria-label="Saved">
              <h3>Saved</h3>
              <ul>
                {landed.map((e) => (
                  <li key={e.id} className={`wl-${e.status}`}>
                    {e.op === "undo_fields" ? "Undone: " : ""}#{e.itemId} {e.title} <span className="muted">{e.status === "confirmed" ? "in DevOps" : e.status === "refused" ? "not written" : "not confirmed yet"}</span>
                    {e.undoable && (
                      <button type="button" className="mini" onClick={() => void dw?.begin(e.clientKey, [{ kind: "undo", writeId: e.id }])}>
                        Undo
                      </button>
                    )}
                    {e.retryable && (
                      <button type="button" className="mini" onClick={() => void dw?.retry(e.id)}>
                        Retry
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
        <footer className="bd-foot ah-review-foot">
          <div className="ah-review-buttons">
            <button type="button" className="primary" disabled={busy || ready <= 0} onClick={() => void commit()}>
              {busy ? "Saving…" : ready > 0 ? `Save ${plural(ready, "item", "items")} to DevOps` : "Save to DevOps"}
            </button>
            {confirmDiscard ? (
              <span className="ah-discard" role="alert">
                Discard all {plural(changeCount, "change", "changes")}?{" "}
                <button type="button" className="mini danger" onClick={() => void call("ahead.discard", { confirm: true }).then(() => (setConfirmDiscard(false), onDone()))}>
                  Discard all
                </button>{" "}
                <button type="button" className="mini quiet" onClick={() => setConfirmDiscard(false)}>
                  Keep them
                </button>
              </span>
            ) : (
              changeCount > 0 && (
                <button type="button" className="mini quiet" disabled={busy} onClick={() => setConfirmDiscard(true)}>
                  Discard all
                </button>
              )
            )}
          </div>
          <p className="muted ah-review-note">
            Nothing is written until you save.{conflicts > 0 ? ` ${plural(conflicts, "item waits", "items wait")} for Keep mine or Take theirs.` : ""}
          </p>
        </footer>
      </aside>
    </div>
  );
}
