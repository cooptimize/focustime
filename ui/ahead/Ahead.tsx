// AH-1 (D653): Ahead is one model in three modes: Grid, Gantt and Fix next. This is the frame they share: the
// filters (client, epic, owner, has gaps, dates, text; remembered per person, D654), my change set ("N changes
// pending · Review", in every mode, surviving a reload, D657), the slim Fix next pane beside Grid and Gantt, and the
// review that commits through the write framework (preview, confirm, read back, audit log, undo), one patch per item,
// in batches of 10. Nothing is written to DevOps until Commit.
import { CloseButton, useReturnFocus } from "../CloseButton.tsx";
import type React from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { AheadFilters } from "../../plan/ahead-edit.ts";
import type { AheadLoad, DevOpsLogView, RoadmapRow, RoadmapState, WeekLoadData } from "../../actions/types.ts";
import { byItem, pendingText, valueText, type ChangeField, type ChangeValue, type DayHalf, type StagedChange } from "../../plan/ahead-edit.ts";
import { fixCount } from "../../plan/fixnext.ts";
import { call } from "../api.ts";
import { useDevOpsWrite } from "../DevOpsWrite.tsx";
import { useDevOpsChanged, useDevOpsFresh } from "../DevOpsFresh.tsx";
import { TypeIcon } from "../TypeIcon.tsx";
import { openBreakDown, type PanelAction } from "../menu.ts";
import { openSend } from "../send-event.ts";
import { clientColor } from "../labels.ts";
import { ModeArea } from "../ModeSwitch.tsx";
import type { AheadMode } from "../nav.ts";
import { buildRows, DEFAULT_FILTERS, fixGroups, groups, type Group, type Row } from "./model.ts";
import { Grid } from "./Grid.tsx";
import { Gantt } from "./Gantt.tsx";
import { FixNext } from "./FixNext.tsx";
import { Backlog } from "./Backlog.tsx";
import { backlogGroups, DEFAULT_AHEAD } from "../../plan/backlog.ts";
import { gridLayout, useWindowScale } from "./layout.ts";
import { queryOf, setAheadQuery, type ModeName } from "../nav.ts";
import { DEFAULT_LEVEL, fromQuery, toQuery, withQuery } from "../../plan/ahead-view.ts";
import { atLevel, isFold, levelNames, type Fold } from "../../plan/gantt-tree.ts";
import { isBool, usePref } from "./prefs.ts";
import { Toolbar, type AheadViewState } from "./Toolbar.tsx";
import { progressText, type Skips } from "../../plan/readiness.ts";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const BATCH = 10;
/** AH-7: how long a just-fixed entry fades out before it leaves Readiness. */
const LEAVE_MS = 900;

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
  /** AH-6: the one level, carets and Show callouts, shared by every mode. */
  view: AheadViewState;
  /**
   * DV-2: an item I have staged changes on that changed in DevOps while Ahead was open: what DevOps has now for each
   * staged field beside mine (null: it didn't). Nothing is overwritten on either side.
   */
  changedUnder: (clientKey: string, itemId: number) => { field: string; devops: string; mine: string }[] | null;
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
  // AH-7: my skips live in the plan store (2 weeks each), so they follow me; entries just fixed fade out with Undo.
  const [skipOverride, setSkipOverride] = useState<Skips | null>(null);
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{ id: number; text: string; undo: (() => Promise<void>) | null } | null>(null);
  const head = useRef<HTMLHeadingElement>(null);
  const dw = useDevOpsWrite();
  // AH-6: one view for every mode: the level and carets and Show callouts (remembered in this browser), and the
  // address's query, which wins when it names them (a link opens what its sender saw).
  const linked = useRef(fromQuery(queryOf(location.hash)));
  const [fold, setFold] = usePref<Fold>("view.fold", isFold, atLevel(DEFAULT_LEVEL));
  const [callouts, setCallouts] = usePref("view.callouts", isBool, true);
  useEffect(() => {
    const q = linked.current;
    if (q?.level) setFold(atLevel(q.level));
    if (q?.callouts !== undefined) setCallouts(q.callouts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // BH-1: only Backlog asks for the change log's last change per item.
  const wantLast = useRef(mode === "backlog");
  wantLast.current = wantLast.current || mode === "backlog";
  // DV-2: the revision of each item as last read, to see an item I have staged changes on change in DevOps underneath.
  const revs = useRef<Map<string, number>>(new Map());
  const [changedNow, setChangedNow] = useState<Set<string>>(new Set());
  /** `quiet` (DV-2's signal): no "Reading…", and the place, filters, folds and staged changes all stay. */
  const reload = useCallback(async (refresh = false, quiet = false) => {
    if (!quiet) setBusy(true);
    try {
      const l = await call<AheadLoad>("ahead.load", { ...(refresh ? { refresh: true } : {}), ...(wantLast.current ? { lastChanges: true } : {}) }, quiet ? { background: true } : {});
      const staged = new Set(l.changes.map((c) => `${c.clientKey}:${c.itemId}`));
      const moved: string[] = [];
      for (const c of l.clients)
        for (const i of c.items) {
          const k = `${c.clientKey}:${i.id}`;
          const was = revs.current.get(k);
          if (staged.has(k) && was !== undefined && i.rev > was) moved.push(k);
          revs.current.set(k, i.rev);
        }
      if (moved.length) setChangedNow((x) => new Set([...x, ...moved]));
      setLoad(l);
      setError(null);
      void call<RoadmapState>("roadmap.load", refresh ? { refresh: true } : {}).then(
        (r) => setRoadmap(new Map(r.clients.flatMap((c) => c.rows.map((x) => [`${c.clientKey}:${x.id}`, x] as const)))),
        () => null,
      );
    } catch (e) {
      // A quiet reread that fails keeps what's showing, without a banner (the next signal tries again).
      if (!quiet) setError(e instanceof Error ? e.message : "Could not read Ahead");
    } finally {
      if (!quiet) setBusy(false);
    }
  }, []);
  useEffect(() => void reload(), [reload, dw?.version]);
  // DV-2: a change in DevOps for a client shown here rereads Ahead quietly, in every mode.
  useDevOpsChanged(load ? load.clients.map((c) => c.clientKey) : [], () => void reload(false, true));
  const fresh = useDevOpsFresh();
  /** Ahead's Refresh: the shared check for Ahead's clients, its answer, then Ahead reread. */
  const refreshNow = async () => {
    setBusy(true);
    const r = fresh ? await fresh.refresh(load?.clients.map((c) => c.clientKey)) : null;
    await reload(!fresh);
    setBusy(false);
    if (r) setSaid({ id: Date.now(), text: r.line });
  };
  const [said, setSaid] = useState<{ id: number; text: string } | null>(null);
  useEffect(() => {
    if (!said) return;
    const t = window.setTimeout(() => setSaid((x) => (x?.id === said.id ? null : x)), 6000);
    return () => window.clearTimeout(t);
  }, [said]);
  // AH-7: a fresh read brings my skips (and this week's fixes) from the server again.
  useEffect(() => setSkipOverride(null), [load?.skips]);
  useEffect(() => {
    const fromLink = (mine: AheadFilters) => {
      const f = withQuery(mine, DEFAULT_FILTERS, linked.current);
      if (f !== mine) void call("ahead.set_filters", { filters: f }).catch(() => null);
      return f;
    };
    call<{ filters: AheadFilters | null }>("ahead.filters", {}).then((r) => setFiltersRaw(fromLink({ ...DEFAULT_FILTERS, ...(r.filters ?? {}) })), () => setFiltersRaw(fromLink(DEFAULT_FILTERS)));
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
  // AH-6: the address mirrors the view, so Back, a reload and a copied link open the same thing.
  useEffect(() => {
    if (!filters) return;
    const q = toQuery({ f: filters, level: fold.level, callouts });
    setAheadQuery(q);
    const base = location.hash.split("?")[0] ?? "";
    if (/^#\/?ahead(\/|$)/.test(base) && location.hash !== base + (q ? `?${q}` : "")) history.replaceState(history.state, "", base + (q ? `?${q}` : ""));
  }, [filters, fold.level, callouts, mode]);
  const staleWeeks = load?.staleWeeks ?? DEFAULT_AHEAD.staleWeeks;
  const shown: Group[] = useMemo(() => (load ? groups(load, f, { stories: true }) : []), [load, f, mode]);
  // AH-6: what every mode would show with no filters (all clients, everyone): the summary's "of N".
  const everything = useMemo<AheadFilters>(() => ({ ...DEFAULT_FILTERS, owner: Object.fromEntries((load?.clients ?? []).map((c) => [c.clientKey, "all" as const])), ...(f.whole ? { whole: true } : {}) }), [load, f.whole]);
  // AH-3: Readiness for every client, ranked by each client's backlog; AH-6: Ahead's filters apply to it too.
  const skips = skipOverride ?? load?.skips ?? {};
  const skipped = useMemo(() => new Set(Object.keys(skips)), [skips]);
  const fix = useMemo(() => (load ? fixGroups(load, { readOnly, skipped, leaving, f, staleWeeks }) : []), [load, skipped, leaving, readOnly, f, staleWeeks]);
  // AH-7: with no filters, for my progress ("N pending save") and to see which entries a change just fixed.
  const fixAll = useMemo(() => (load ? fixGroups(load, { readOnly, skipped }) : []), [load, skipped, readOnly]);
  const pendingFixes = fixAll.reduce((k, x) => k + (x.group.pending?.length ?? 0), 0);
  const before = useRef<{ keys: Map<string, string[]>; changes: StagedChange[] } | null>(null);
  useEffect(() => {
    if (!load) return;
    const keys = new Map(fixAll.flatMap((x) => x.group.entries.map((e) => [e.key, e.gaps as string[]] as const)));
    const filled = new Set(fixAll.flatMap((x) => (x.group.pending ?? []).map((p) => `${p.key}|${p.gap}`)));
    const was = before.current;
    before.current = { keys, changes: load.changes };
    if (!was || mode !== "fix") return;
    // Gone because every gap it had is filled in my change set (not because a new date moved it out of view).
    const gone = [...was.keys].filter(([k, gs]) => !keys.has(k) && !skipped.has(k) && gs.every((g) => filled.has(`${k}|${g}`))).map(([k]) => k);
    // A change of mine made it ready: it fades out, and Undo takes back just those changes.
    const fixed = gone.flatMap((k) => {
      const [clientKey, id] = [k.slice(0, k.lastIndexOf(":")), Number(k.slice(k.lastIndexOf(":") + 1))];
      const added = load.changes.filter((c) => c.clientKey === clientKey && c.itemId === id && !was.changes.some((p) => p.clientKey === clientKey && p.itemId === id && p.field === c.field && JSON.stringify(p.value) === JSON.stringify(c.value)));
      return added.length ? [{ k, clientKey, id, fields: added.map((c) => c.field) }] : [];
    });
    if (!fixed.length) return;
    setLeaving((s) => new Set([...s, ...fixed.map((x) => x.k)]));
    window.setTimeout(() => setLeaving((s) => new Set([...s].filter((k) => !fixed.some((x) => x.k === k)))), LEAVE_MS);
    const one = fixed[0]!;
    setToast({
      id: Date.now(),
      text: fixed.length === 1 ? `#${one.id} is ready. Saved to your changes; nothing is written until you save.` : `${fixed.length} items are ready. Saved to your changes.`,
      undo: async () => {
        let changes: StagedChange[] | null = null;
        for (const x of fixed) for (const field of x.fields) changes = (await call<{ changes: StagedChange[] }>("ahead.unstage", { clientKey: x.clientKey, itemId: x.id, field })).changes;
        if (changes) setLoad((l) => (l ? { ...l, changes: changes! } : l));
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixAll]);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast((x) => (x?.id === toast.id ? null : x)), 8000);
    return () => window.clearTimeout(t);
  }, [toast]);
  const skipOne = (key: string, on: boolean) => {
    const clientKey = key.slice(0, key.lastIndexOf(":"));
    const itemId = Number(key.slice(key.lastIndexOf(":") + 1));
    const next = { ...skips };
    if (on) next[key] = load?.today ?? "";
    else delete next[key];
    setSkipOverride(next);
    void call<{ skips: Skips }>(on ? "ahead.skip" : "ahead.unskip", { clientKey, itemId }).then((r) => setSkipOverride(r.skips), (e: unknown) => {
      setSkipOverride(skips);
      setError(e instanceof Error ? e.message : "That skip couldn't be kept");
    });
  };
  const fixN = fixCount(fix.map((x) => x.group));
  // AH-6: Backlog's level is the shared one (BH-1's own tier is kept but no longer read).
  const tier = fold.level;
  const last = useMemo(() => Object.fromEntries((load?.clients ?? []).flatMap((c) => (c.last ? [[c.clientKey, c.last] as const] : []))), [load]);
  const backlog = useMemo(() => (load && mode === "backlog" ? backlogGroups(load, { ...f, tier }, { staleWeeks, last }) : []), [load, f, mode, tier, staleWeeks, last]);
  const names = useMemo(() => levelNames(shown), [shown]);
  const view: AheadViewState = { fold, setFold, names, callouts, setCallouts };
  const counts = useMemo(() => {
    if (!load) return { shown: 0, total: 0 };
    if (mode === "fix") return { shown: fixN, total: fix.reduce((n, x) => n + x.total, 0) };
    if (mode === "backlog") return { shown: backlog.reduce((k, g) => k + g.rows.length, 0), total: backlogGroups(load, { ...everything, tier }, { staleWeeks }).reduce((k, g) => k + g.rows.length, 0) };
    const n = (gs: Group[]) => gs.reduce((k, g) => k + g.rows.filter((r) => !r.context).length, 0);
    return { shown: n(shown), total: n(groups(load, everything, { stories: true })) };
  }, [load, mode, fix, fixN, backlog, shown, everything, tier, staleWeeks]);

  const n = load?.changes.length ?? 0;
  const color = (k: string) => clientColor(k, data.clients);
  const setChanges = (changes: StagedChange[]) => setLoad((l) => (l ? { ...l, changes } : l));
  const changedUnder: AheadEnv["changedUnder"] = (clientKey, itemId) => {
    if (!load || !changedNow.has(`${clientKey}:${itemId}`)) return null;
    const mine = load.changes.filter((c) => c.clientKey === clientKey && c.itemId === itemId);
    const it = load.clients.find((c) => c.clientKey === clientKey)?.items.find((i) => i.id === itemId);
    if (!mine.length || !it) return null;
    const now = (f: ChangeField): ChangeValue => (f === "start" ? it.start : f === "target" ? it.target : f === "size" ? it.size : f === "state" ? it.state : it.assignee?.email ? { email: it.assignee.email, name: it.assignee.name } : null) as ChangeValue;
    const label: Record<ChangeField, string> = { start: "Start", target: "Target", size: "Size", assignee: "Owner", state: "State" };
    return mine.map((c) => ({ field: label[c.field], devops: valueText(c.field, now(c.field)), mine: valueText(c.field, c.value, c.half) }));
  };
  const env: AheadEnv | null = load ? { load, roadmap, readOnly, stage, unstage, setChanges, breakDown, color, focusItem: item, error: setError, view, changedUnder } : null;
  const anyFilter = counts.shown !== counts.total;
  const visible = counts.shown;
  const title = mode === "fix" ? "Readiness" : mode === "gantt" ? "Gantt" : mode === "backlog" ? "Backlog" : "Grid";

  return (
    <main className={`roadmap ahead ahead-${mode}`} aria-label={`Ahead: ${title}`}>
      <div className="follow-ups-head">
        <h2 ref={head} tabIndex={-1}>
          Ahead <span className="muted">{load ? `· ${mode === "fix" ? `${fixN} not ready yet` : plural(visible, "item", "items")}` : ""}</span>
        </h2>
        <button type="button" className="top-btn" disabled={busy} onClick={() => void refreshNow()} title="Check DevOps now (R)">
          {busy ? "Reading…" : "Refresh"}
        </button>
        {said && (
          <span className="muted ah-refreshed" role="status">
            {said.text}
          </span>
        )}
        <ModeArea>{renderSwitch && load && !readOnly ? renderSwitch({ fix: fixN }) : switcher}</ModeArea>
      </div>
      {load && n > 0 && (
        <div className="ah-pending" data-tour="ah-pending" role="status">
          <strong>{pendingText(n)}</strong>
          <span className="muted">{load.changes.some((c) => c.theirs !== undefined) ? "Some changed in DevOps since you started. " : ""}Nothing is written until you save.</span>
          <button type="button" className="primary" onClick={() => setReview(true)} disabled={readOnly}>
            Review
          </button>
        </div>
      )}
      {load && mode === "fix" && progressText(load.fixedWeek ?? 0, pendingFixes) && (
        <p className="muted ah-fx-progress" role="status">
          {progressText(load.fixedWeek ?? 0, pendingFixes)}
        </p>
      )}
      {readOnly && load && <p className="muted ah-ro-note">Read only on a phone. Open FocusTime on a computer to change dates, sizes or owners.</p>}
      {load && filters && <Toolbar mode={mode} load={load} f={f} set={setFilters} setWhole={(w) => void setWhole(w)} view={view} counts={counts} color={color} />}
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
              {mode === "fix" && <FixNext groups={fix} skip={(k) => skipOne(k, true)} unskip={(k) => skipOne(k, false)} skips={skips} f={f} setFilters={setFilters} dots={layout === "cards" || layout === "dots"} filtered={anyFilter} />}
            </div>
          </div>
          {toast && mode === "fix" && (
            <div className="undo-toast" role="status" aria-live="polite">
              <span>{toast.text}</span>
              {toast.undo && (
                <button type="button" className="mini" onClick={() => void toast.undo!().then(() => setToast({ id: Date.now(), text: "Undone", undo: null }), (e: unknown) => setToast({ id: Date.now(), text: e instanceof Error ? e.message : "Couldn't undo", undo: null }))}>
                  Undo
                </button>
              )}
            </div>
          )}
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

/** "Mon, Nov 16 PM", "5 (Story Points)", "Dana Reyes", or "None". */
export function changeText(c: Pick<StagedChange, "field" | "value" | "half">, sizeLabel: string | null): string {
  if (c.field === "size") return typeof c.value === "number" ? `${c.value}${sizeLabel ? ` ${sizeLabel}` : ""}` : "None";
  return valueText(c.field, c.value, c.half);
}
const FIELD_WORD: Record<ChangeField, string> = { start: "Start", target: "Target", size: "Size", assignee: "Assigned to", state: "State" };

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
