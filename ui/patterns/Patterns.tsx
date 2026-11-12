// WP-1, WP-2: DevOps patterns (#/patterns), a hidden working page, only for people an admin turned it on for. Top to
// bottom: Runs (inventory, estimate with items and a rough time, classification, each client's progress, Resume),
// Scope (each client's DevOps laid out by project, team and area with counts and types, and the part to read: the
// page's own, never Admin › Clients'), Kinds (each type's kind with the numbers behind the guess), Coverage (where every
// item went, adding up), Build work (the default view: inventory and classification), Tickets and support, Request
// types, Check by hand (clients I'm on only) and two Markdown downloads. Any figure built on fewer than 20 items says
// "too few to read". Existing classes only, plus a few pat-* ones.
//
// WP-3: classification shows agreement first, per missing fact and per layer, so it is clear which findings to trust;
// request types, readiness and layers have a column per client; the Request types section is the list in use, which a
// person changes here (add, rename, merge, remove, edit), each change saying what it costs before Save, with the names
// the AI suggested for "other". Nothing on this page makes an AI request but Run classification and Resume.
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { ActionRefusal, call } from "../api.ts";
import { useReturnFocus } from "../CloseButton.tsx";
import { fmtUsd } from "../../ai/cost.ts";
import type { Pair, Snapshot, Spread, Tickets, Writing } from "../../plan/patterns/inventory.ts";
import { FEW, FEW_WORDS, shareWords, tooFew, type ClientAnalysis } from "../../plan/patterns/analysis.ts";
import { KIND_WORDS, KINDS, TICKET_RULE_WORDS, guessWords, type Kind } from "../../plan/patterns/kinds.ts";
import { PARENT_SHARE_WORDS } from "../../plan/patterns/levels.ts";
import { sampleWords, sumCoverage, sumResults, type ClientResults, type Coverage } from "../../plan/patterns/results.ts";
import { Classification } from "./Classification.tsx";
import { RequestTypes } from "./RequestTypes.tsx";
import { analysisScopeWords, type AnalysisScope, type Layout, type ProjectLayout } from "../../plan/patterns/scope.ts";
import type { Labels, Platform, TypeChange, TypeList } from "../../plan/patterns/types.ts";

type ClientProgress = { state: "waiting" | "reading" | "done" | "stopped" | "skipped" | "needs_scope"; reason?: string | null; phase?: string; month?: number; next?: number; total?: number; done?: number; dropped?: number; capped?: boolean; project?: number; projects?: string[]; read?: number; outside?: number };
type RunView = { id: number; kind: "inventory" | "classify"; state: "running" | "stopped" | "done"; rules: number; reason: string | null; startedAt: string; finishedAt: string | null; pass: 1 | 2 | null; listVersion: string | null; estimateMicros: number; spentMicros: number; clients: Record<string, ClientProgress> };
type ScopeView = { page: AnalysisScope | null; admin: string; adminKind: string; next: AnalysisScope | null; nextWords: string; nextSource: string | null; problems: string[]; used: AnalysisScope | null; usedWords: string | null; changed: boolean };
type ClientRow = { key: string; mine: boolean; platform: Platform | null; platformHint: string | null; snapshot: Snapshot | null; snapshotAt: string | null; previous: Snapshot | null; previousAt: string | null; analysis: ClientAnalysis | null; results: ClientResults | null; layout: Layout | null; scope: ScopeView; kindsChanged: boolean };
type Version = { version: string; number: number; at: string; by: string | null; why: string | null; change: TypeChange | null };
type SuggestionRow = { name: string; meaning: string; count: number; clients: Record<string, number> };
type Status = { clients: ClientRow[]; inventory: { last: RunView | null; lastDone: string | null }; classify: { last: RunView | null; lastDone: string | null }; lists: TypeList[]; inUse: TypeList; versions: Version[]; labelsOn: { mode: "in use" | "earlier"; version: string; wp1?: boolean }; suggestions: SuggestionRow[]; ignored: string[]; shownVersion: string; shownRules: number; ai: { ready: boolean; words: string | null } };
type Estimate = { clients: Record<string, { items: number; toClassify: number; micros: number; seconds: number; skipped: string | null }>; totalItems: number; totalMicros: number; totalSeconds: number; agreement: number; list: string };
type CheckRow = { id: number; url: string | null; title: string; type: string; level: string; labels: Labels };

const errText = (e: unknown) => (e instanceof ActionRefusal || e instanceof Error ? e.message : "Something went wrong");
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "never");
const num = (v: number | null | undefined) => (v === null || v === undefined ? "n/a" : String(v));
const minutes = (s: number) => (s < 90 ? "about a minute" : s < 3600 ? `about ${Math.round(s / 60)} minutes` : `about ${Math.round((s / 3600) * 10) / 10} hours`);
const PLATFORM: Record<Platform, string> = { azure: "Azure", fabric: "Fabric", both: "Both" };
type Filter = "all" | Platform | "unset";
const FILTERS: [Filter, string][] = [["all", "All clients"], ["azure", "Azure"], ["fabric", "Fabric"], ["both", "Both"], ["unset", "Not set"]];
const STATE_WORDS: Record<ClientProgress["state"], string> = { waiting: "Waiting", reading: "Reading", done: "Done", stopped: "Stopped", skipped: "Skipped", needs_scope: "Choose its scope" };
const PHASE_WORDS: Record<string, string> = { first: "first item", tree: "reading areas and teams", months: "finding items", rows: "reading the layout", scope: "choosing the scope", items: "reading items in scope", parents: "reading parents", history: "reading history", numbers: "counting", pass1: "pass 1", pass2: "pass 2", labels: "labeling", done: "" };
const SOURCE_WORDS: Record<string, string> = { page: "set on this page", admin: "from Admin › Clients", "one area": "the project has one area" };
const sorted = (m: Record<string, number>) => Object.entries(m).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
const types = (m: Record<string, number>) => sorted(m).map(([k, v]) => `${k} ${v}`).join(", ");
/** A figure built on n items: the figure, or "too few to read" under 20. */
const fig = (v: number | null | undefined, n: number, unit = "") => (v === null || v === undefined ? "n/a" : tooFew(n) ? `${FEW_WORDS} (${n})` : `${v}${unit}`);
const Few = ({ n }: { n: number }) => (tooFew(n) ? <span className="set-hint"> · {FEW_WORDS}</span> : null);

export function Patterns({ onClose }: { onClose: () => void }) {
  useReturnFocus();
  const [data, setData] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const load = useCallback(() => call<Status>("patterns.status", {}).then((d) => (setData(d), setError(null)), (e: unknown) => setError(errText(e))), []);
  useEffect(() => void load(), [load]);
  const running = data?.inventory.last?.state === "running" || data?.classify.last?.state === "running";
  // While a run goes, the page asks every 5 seconds (and keeps a test site's server up while it is open).
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [running, load]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && !(e.target as HTMLElement | null)?.closest("input, textarea, select, dialog") && (e.preventDefault(), onClose());
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  const act = async (name: string, input: Record<string, unknown>, done?: string | ((r: unknown) => string)) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await call<unknown>(name, input);
      if (done) setMsg(typeof done === "string" ? done : done(r));
      await load();
      return r;
    } catch (e) {
      setMsg(errText(e));
      return null;
    } finally {
      setBusy(false);
    }
  };
  const shown = useMemo(() => (data?.clients ?? []).filter((c) => filter === "all" || (filter === "unset" ? !c.platform : c.platform === filter)), [data, filter]);

  return (
    <main className="mtg-view pat-view" aria-label="DevOps patterns" tabIndex={-1}>
      <header className="page-head">
        <div className="ph-title">
          <h2>DevOps patterns</h2>
          <span className="muted">Preview · how Cooptimize's BI and analytics work is entered and broken down in each client's DevOps, from the last 24 months, within a scope per client. Read only.</span>
        </div>
        <button type="button" className="mini" onClick={onClose}>Close</button>
      </header>
      {error && <p className="error-line" role="alert">{error}</p>}
      {!data && !error && <p className="muted">Loading…</p>}
      {data && (
        <>
          <Runs data={data} busy={busy} estimate={estimate} msg={msg}
            onInventory={() => void act("patterns.run_inventory", {}, "Inventory started. It reads slowly on purpose.")}
            onResume={(id) => void act("patterns.resume", { runId: id }, "Resumed.")}
            onEstimate={async () => {
              const e = (await act("patterns.estimate", {})) as Estimate | null;
              if (e) setEstimate(e);
            }}
            onClassify={(resume) => {
              const stopped = resume && data.classify.last?.state === "stopped" ? data.classify.last.id : null;
              void act(stopped ? "patterns.resume" : "patterns.run_classification", { ...(stopped ? { runId: stopped } : {}), total: estimate!.totalMicros }, stopped ? "Classification resumed." : "Classification started.").then(() => setEstimate(null));
            }}
          />
          <ScopeSection clients={data.clients} busy={busy} onSave={(k, scope) => void act("patterns.set_scope", { clientKey: k, scope }, (r) => (r as { words: string }).words)} />
          <KindsSection clients={data.clients} busy={busy} onKind={(k, type, kind) => void act("patterns.set_kind", { clientKey: k, type, kind }, "Kind saved. It applies to the page now and to the next classification.")} />
          <section aria-label="Platform" className="pat-section">
            <h3>Platform</h3>
            <label className="set-inline">
              Show{" "}
              <select aria-label="Show clients on" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
                {FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <span className="set-hint"> Set each client's platform in the Build work table; every table below follows the choice.</span>
          </section>
          <CoverageSection clients={shown} />
          <Inventory clients={shown} onPlatform={(k, p) => void act("patterns.set_platform", { clientKey: k, platform: p })} />
          <Classification title="Build work: classification" label="Classification" clients={shown.flatMap((c) => (c.results?.build.labeled ? [{ key: c.key, r: c.results.build }] : []))} labelsOn={data.labelsOn} sample={sampleWords(sumResults(data.clients.flatMap((c) => (c.results ? [c.results.build, c.results.tickets] : []))))} />
          <TicketsSection clients={shown} />
          <RequestTypes data={data} busy={busy} results={sumResults(data.clients.flatMap((c) => (c.results ? [c.results.build, c.results.tickets] : [])))} act={act} />
          <CheckByHand clients={data.clients.filter((c) => c.mine && c.results?.coverage.labeled)} />
          <Downloads />
        </>
      )}
    </main>
  );
}

// ---------- runs ----------

function RunTable({ run }: { run: RunView }) {
  return (
    <table className="adm-table pat-run">
      <thead><tr><th>Client</th><th>State</th><th>Where</th></tr></thead>
      <tbody>
        {Object.entries(run.clients).map(([k, c]) => (
          <tr key={k}>
            <th scope="row">{k}</th>
            <td className={c.state === "stopped" || c.state === "needs_scope" ? "field-problem" : undefined}>{STATE_WORDS[c.state]}</td>
            <td>
              {[
                c.phase && c.state !== "done" ? PHASE_WORDS[c.phase] : null,
                c.projects && c.projects.length > 1 && c.state === "reading" && ["tree", "months", "rows"].includes(c.phase ?? "") ? `project ${(c.project ?? 0) + 1} of ${c.projects.length}` : null,
                c.phase === "months" && c.state === "reading" ? `month ${c.month ?? 0} of 24` : null,
                run.kind === "inventory" && c.read !== undefined ? `${c.read} read, ${c.outside ?? 0} outside scope` : null,
                run.kind === "classify" && c.total ? `${c.done ?? 0} of ${c.total} labeled` : null,
                c.dropped ? `${c.dropped} failed the check` : null,
                c.capped ? "a month hit DevOps's 20,000 limit" : null,
                c.reason ?? null,
              ].filter(Boolean).join(" · ") || ""}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Runs({ data, busy, estimate, msg, onInventory, onResume, onEstimate, onClassify }: { data: Status; busy: boolean; estimate: Estimate | null; msg: string | null; onInventory: () => void; onResume: (id: number) => void; onEstimate: () => void; onClassify: (resume: boolean) => void }) {
  const inv = data.inventory.last;
  const cls = data.classify.last;
  const running = inv?.state === "running" || cls?.state === "running";
  const current = [inv, cls].filter((r): r is RunView => !!r).sort((a, b) => b.id - a.id)[0] ?? null;
  // Inventory under WP-2's rules; classification only under WP-3's (one pass against the list in use).
  // A classification only on the list still in use (the estimate prices that list).
  const canResume = (r: RunView | null | undefined) => r?.state === "stopped" && r.rules === (r.kind === "inventory" ? 2 : 3) && (r.kind === "inventory" || r.listVersion === data.inUse.version);
  return (
    <section aria-label="Runs" className="pat-section">
      <h3>Runs</h3>
      <p className="muted">Last inventory: {when(data.inventory.lastDone)} · Last classification: {when(data.classify.lastDone)}</p>
      <div className="set-inline pat-buttons">
        <button type="button" className="mini" disabled={busy || running} onClick={onInventory}>Run inventory</button>
        {canResume(inv) && <button type="button" className="mini" disabled={busy || running} onClick={() => onResume(inv!.id)}>Resume inventory</button>}
        <button type="button" className="mini" disabled={busy || running || !data.ai.ready} onClick={onEstimate}>Estimate</button>
        {estimate && (
          <button type="button" className="mini" disabled={busy || running || !estimate.totalItems} onClick={() => onClassify(false)}>
            Run classification ({estimate.totalItems} items, about {fmtUsd(estimate.totalMicros)})
          </button>
        )}
        {estimate && canResume(cls) && (
          <button type="button" className="mini" disabled={busy || running || !estimate.totalItems} onClick={() => onClassify(true)}>
            Resume classification
          </button>
        )}
      </div>
      {!data.ai.ready && <p className="set-hint">{data.ai.words} The inventory works without it.</p>}
      {cls?.state === "stopped" && !estimate && <p className="set-hint">{canResume(cls) ? "Classification stopped. Estimate again to resume it." : cls.rules === 3 ? "Classification stopped, and the request types list changed since it started. Estimate, then Run classification: the labels it made carry over." : "Classification stopped."}</p>}
      <p className="set-hint">A run lives in the server, not in this page. On dev keep the page open: dev scales to zero a few minutes after the last visit, and a new deploy restarts it. Either leaves the run Stopped; Resume carries on where it stopped and never pays for an item twice.</p>
      {msg && <p className="set-hint" role="status">{msg}</p>}
      {estimate && (
        <table className="adm-table pat-estimate">
          <thead><tr><th>Client</th><th>Items in scope to classify</th><th>Answers to ask for</th><th>Expected cost</th><th>Rough time</th></tr></thead>
          <tbody>
            {Object.entries(estimate.clients).map(([k, e]) => (
              <tr key={k}><th scope="row">{k}</th><td>{e.toClassify}</td><td>{e.skipped ? <span className="muted">{e.skipped}</span> : e.items}</td><td>{e.skipped ? "" : fmtUsd(e.micros)}</td><td>{e.skipped ? "" : minutes(e.seconds)}</td></tr>
            ))}
            <tr><th scope="row">Total</th><td>{Object.values(estimate.clients).reduce((s, c) => s + c.toClassify, 0)}</td><td>{estimate.totalItems}</td><td>{fmtUsd(estimate.totalMicros)}</td><td>{minutes(estimate.totalSeconds)}</td></tr>
          </tbody>
        </table>
      )}
      {estimate && <p className="set-hint">Against the list in use (version {estimate.list.replace("own-", "")}). Answers cover every item in scope whose kind isn't Leave out and that has no label on the list in use (or one that needs labeling again), and a second answer for the agreement sample ({estimate.agreement} items). A run never changes the list. It stops if it spends more than 1.5 times the estimate.</p>}
      {current && (
        <>
          <p className={current.state === "stopped" ? "field-problem" : "muted"}>
            {current.kind === "inventory" ? "Inventory" : `Classification${current.pass && current.rules === 2 ? `, pass ${current.pass}` : ""}`}: {current.state === "running" ? "running" : current.state === "done" ? `done ${when(current.finishedAt)}` : (current.reason ?? "Stopped")}
            {current.kind === "classify" && current.estimateMicros ? ` · spent ${fmtUsd(current.spentMicros)} of about ${fmtUsd(current.estimateMicros)}` : ""}
            {current.rules < 2 ? " · made before scopes and kinds (WP-2), kept as it was" : current.kind === "classify" && current.rules === 2 ? " · made before the list in use (WP-3), kept as it was" : ""}
          </p>
          <RunTable run={current} />
        </>
      )}
    </section>
  );
}

// ---------- scope ----------

function ScopeSection({ clients, busy, onSave }: { clients: ClientRow[]; busy: boolean; onSave: (k: string, s: AnalysisScope | null) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section aria-label="Scope" className="pat-section">
      <h3>Scope</h3>
      <p className="set-hint">The part of each client's DevOps that is Cooptimize's BI and analytics work. Only items in scope are read in full and classified; the rest are counted once as outside scope. The scope here is this page's own: changing it never changes Admin › Clients.</p>
      <table className="adm-table pat-scope">
        <thead><tr><th>Client</th><th>Next run reads</th><th>Last inventory read</th><th>Admin › Clients</th></tr></thead>
        <tbody>
          {clients.map((c) => (
            <Fragment key={c.key}>
              <tr>
                <th scope="row">
                  {c.layout ? <button type="button" className="pl-fold" aria-expanded={open === c.key} onClick={() => setOpen(open === c.key ? null : c.key)}>{open === c.key ? "▾" : "▸"} {c.key}</button> : c.key}
                </th>
                <td className={c.scope.next ? undefined : "field-problem"}>
                  {c.scope.next ? <>{analysisScopeWords(c.scope.next)}<span className="set-hint adm-block">{SOURCE_WORDS[c.scope.nextSource ?? ""] ?? ""}</span></> : c.scope.nextWords}
                  {c.scope.problems.map((p) => <span key={p} className="set-hint adm-block">{p}</span>)}
                </td>
                <td>{c.scope.usedWords ?? <span className="muted">{c.snapshot ? "Whole project (before scopes)" : "Not read yet"}</span>}{c.scope.changed && <span className="set-hint adm-block">Changed since: run inventory again to apply</span>}</td>
                <td>{c.scope.admin}</td>
              </tr>
              {open === c.key && c.layout && (
                <tr className="pat-detail-row"><td colSpan={4}><ScopeEditor client={c} busy={busy} onSave={(s) => onSave(c.key, s)} /></td></tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </section>
  );
}

type Draft = { kind: AnalysisScope["kind"]; projects: Set<string>; teams: Set<string>; areas: Map<string, boolean> };
const draftOf = (s: AnalysisScope | null): Draft => ({
  kind: s?.kind ?? "areas",
  projects: new Set(s?.kind === "whole" ? s.projects : []),
  teams: new Set(s?.kind === "teams" ? s.teams.map((t) => `${t.project}\u0000${t.name}`) : []),
  areas: new Map(s?.kind === "areas" ? s.areas.map((a) => [a.path, a.sub]) : []),
});
function scopeOfDraft(d: Draft): AnalysisScope | null {
  if (d.kind === "whole") return d.projects.size ? { kind: "whole", projects: [...d.projects] } : null;
  if (d.kind === "teams") return d.teams.size ? { kind: "teams", teams: [...d.teams].map((k) => ({ project: k.split("\u0000")[0]!, name: k.split("\u0000")[1]! })) } : null;
  return d.areas.size ? { kind: "areas", areas: [...d.areas].map(([path, sub]) => ({ path, sub })) } : null;
}

function ScopeEditor({ client, busy, onSave }: { client: ClientRow; busy: boolean; onSave: (s: AnalysisScope | null) => void }) {
  const [d, setD] = useState<Draft>(() => draftOf(client.scope.page ?? client.scope.next));
  const set = (f: (x: Draft) => void) => setD((x) => {
    const y: Draft = { kind: x.kind, projects: new Set(x.projects), teams: new Set(x.teams), areas: new Map(x.areas) };
    f(y);
    return y;
  });
  const chosen = scopeOfDraft(d);
  const layout = client.layout!;
  return (
    <div className="pat-detail">
      <p className="set-hint">{layout.items} items created in the last 24 months, across {layout.projects.length === 1 ? "1 project" : `${layout.projects.length} projects`}. Counts and types only.</p>
      <div className="set-inline pat-buttons" role="radiogroup" aria-label={`${client.key}: scope kind`}>
        {(["whole", "teams", "areas"] as const).map((k) => (
          <label key={k}><input type="radio" name={`kind-${client.key}`} checked={d.kind === k} onChange={() => set((x) => void (x.kind = k))} /> {k === "whole" ? "Whole project" : k === "teams" ? "Chosen teams" : "Chosen area paths"}</label>
        ))}
      </div>
      {layout.projects.map((p) => <ProjectLayoutView key={p.project} p={p} d={d} set={set} client={client.key} />)}
      <div className="set-inline pat-buttons">
        <button type="button" className="mini" disabled={busy || !chosen} onClick={() => onSave(chosen)}>Save scope for this page</button>
        {client.scope.page && <button type="button" className="mini" disabled={busy} onClick={() => onSave(null)}>Clear</button>}
        <a className="mini" href={`#/settings/admin-clients/${encodeURIComponent(client.key)}`}>Use this in Admin › Clients too</a>
      </div>
      <p className="set-hint">{chosen ? `Reads: ${analysisScopeWords(chosen)}.` : "Choose at least one."} Saved here, it applies from the next inventory or Resume. Admin › Clients is unchanged; the link only opens it.</p>
    </div>
  );
}

function ProjectLayoutView({ p, d, set, client }: { p: ProjectLayout; d: Draft; set: (f: (x: Draft) => void) => void; client: string }) {
  return (
    <div className="pat-layout">
      <h4>
        {d.kind === "whole" ? <label><input type="checkbox" checked={d.projects.has(p.project)} onChange={(e) => set((x) => void (e.target.checked ? x.projects.add(p.project) : x.projects.delete(p.project)))} aria-label={`${client}: whole project ${p.project}`} /> Project {p.project}</label> : <>Project {p.project}</>}
        <span className="set-hint"> · {p.items} items · {types(p.types) || "none"}{p.oneArea ? " · one area only" : ""}</span>
      </h4>
      {p.areasProblem && <p className="set-hint">{p.areasProblem}</p>}
      {d.kind === "teams" && (
        p.teams === null ? <p className="set-hint">{p.teamsProblem ?? "The teams couldn't be read."} Choose area paths instead.</p> : (
          <table className="adm-table">
            <thead><tr><th>Team</th><th>Items</th><th>Types</th></tr></thead>
            <tbody>{p.teams.map((t) => {
              const key = `${p.project}\u0000${t.name}`;
              return (
                <tr key={t.name}>
                  <th scope="row"><label><input type="checkbox" disabled={t.otherField} checked={d.teams.has(key)} onChange={(e) => set((x) => void (e.target.checked ? x.teams.add(key) : x.teams.delete(key)))} aria-label={`${client}: team ${t.name}`} /> {t.name}</label>{t.otherField && <span className="set-hint adm-block">Uses its own field, not area paths: choose its areas instead</span>}</th>
                  <td>{t.items}</td><td>{types(t.types)}</td>
                </tr>
              );
            })}</tbody>
          </table>
        )
      )}
      {d.kind === "areas" && (
        <table className="adm-table">
          <thead><tr><th>Area path</th><th>Items here</th><th>With the areas under it</th><th>Types (with the areas under it)</th><th>Include the areas under it</th></tr></thead>
          <tbody>{p.areas.map((a) => (
            <tr key={a.path}>
              <th scope="row" style={{ paddingLeft: `${8 + a.depth * 16}px` }}><label><input type="checkbox" checked={d.areas.has(a.path)} onChange={(e) => set((x) => void (e.target.checked ? x.areas.set(a.path, true) : x.areas.delete(a.path)))} aria-label={`${client}: area ${a.path}`} /> {a.path.split("\\").at(-1)}</label></th>
              <td>{a.items}</td><td>{a.under.items}</td><td>{types(a.under.types)}</td>
              <td>{d.areas.has(a.path) && <input type="checkbox" checked={d.areas.get(a.path)} onChange={(e) => set((x) => void x.areas.set(a.path, e.target.checked))} aria-label={`${client}: area ${a.path} and the areas under it`} />}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );
}

// ---------- kinds ----------

function KindsSection({ clients, busy, onKind }: { clients: ClientRow[]; busy: boolean; onKind: (k: string, type: string, kind: Kind | null) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const withKinds = clients.filter((c) => c.analysis?.kinds.length);
  return (
    <section aria-label="Kinds of work" className="pat-section">
      <h3>Kinds of work</h3>
      <p className="set-hint">Each work item type in scope is Build work, Tickets and support, or Leave out. {TICKET_RULE_WORDS} Change any type; the choice is kept for later runs and applies to this page at once.</p>
      {!withKinds.length && <p className="muted">After an inventory, each client's types show here with a guess.</p>}
      {withKinds.map((c) => (
        <Fragment key={c.key}>
          <button type="button" className="pl-fold" aria-expanded={open === c.key} onClick={() => setOpen(open === c.key ? null : c.key)}>
            {open === c.key ? "▾" : "▸"} {c.key} · {(["build", "tickets", "leave_out"] as const).map((k) => [k, c.analysis!.kinds.filter((r) => r.kind === k).length] as const).filter(([, n]) => n).map(([k, n]) => `${KIND_WORDS[k]} ${n}`).join(" · ")}{c.kindsChanged ? " · changed since the last inventory" : ""}
          </button>
          {open === c.key && (
            <table className="adm-table pat-kinds">
              <thead><tr><th>Type</th><th>Kind</th><th>Guess</th><th>The numbers behind it</th></tr></thead>
              <tbody>{c.analysis!.kinds.map((r) => (
                <tr key={r.type}>
                  <th scope="row">{r.type}</th>
                  <td>
                    <select aria-label={`${c.key}: ${r.type} kind`} disabled={busy} value={r.kind} onChange={(e) => onKind(c.key, r.type, e.target.value === r.guess && !r.chosen ? null : (e.target.value as Kind))}>
                      {KINDS.map((k) => <option key={k} value={k}>{KIND_WORDS[k]}</option>)}
                    </select>
                    {r.chosen && <button type="button" className="mini" disabled={busy} onClick={() => onKind(c.key, r.type, null)}>Use the guess</button>}
                  </td>
                  <td>{KIND_WORDS[r.guess]}{r.chosen ? "" : " (in use)"}</td>
                  <td>{guessWords(r)}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </Fragment>
      ))}
    </section>
  );
}

// ---------- coverage ----------

function coverageCells(c: Coverage) {
  return (
    <>
      <td>{num(c.read)}</td><td>{num(c.outside)}</td><td>{c.inScope}</td><td>{c.leftOut}</td><td>{c.toClassify}</td><td>{c.labeled}</td><td>{c.aiOff}</td><td>{c.failed}</td><td>{c.earlier ?? 0}</td><td>{c.notReached}</td>
    </>
  );
}

function CoverageSection({ clients }: { clients: ClientRow[] }) {
  const rows = clients.filter((c) => c.results);
  return (
    <section aria-label="Coverage" className="pat-section">
      <h3>Coverage</h3>
      <p className="set-hint">Where every item from the last 24 months went. Read = outside scope + in scope; in scope = left out by kind + to classify; to classify = labeled (on the list in use) + not labeled, by reason.</p>
      {!rows.length ? <p className="muted">After an inventory in scope.</p> : (
        <table className="adm-table pat-coverage">
          <thead><tr><th>Client</th><th>Scope</th><th>Read</th><th>Outside scope</th><th>In scope</th><th>Left out by kind</th><th>To classify</th><th>Labeled</th><th>AI not allowed</th><th>Answer failed its check</th><th>On an earlier list</th><th>Not reached</th></tr></thead>
          <tbody>
            {rows.map((c) => <tr key={c.key}><th scope="row">{c.key}</th><td>{c.scope.usedWords ?? <span className="muted">Whole project (before scopes)</span>}</td>{coverageCells(c.results!.coverage)}</tr>)}
            {rows.length > 1 && <tr><th scope="row">All</th><td></td>{coverageCells(sumCoverage(rows.map((c) => c.results!.coverage)))}</tr>}
          </tbody>
        </table>
      )}
      <p className="set-hint">On an earlier list: labeled only on a list that can't be carried to the list in use; a classification run labels them again. Not reached: the run stopped (at its cost limit, a restart, an AI outage or cap) or hasn't run since the inventory.</p>
    </section>
  );
}

// ---------- build work: inventory ----------

const mainPairWords = (p: Pair | null | undefined) => (p ? `${p.parent} with no ${p.child}: ${p.without} of ${p.of}` : "n/a");

function Inventory({ clients, onPlatform }: { clients: ClientRow[]; onPlatform: (k: string, p: Platform | null) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section aria-label="Build work" className="pat-section">
      <h3>Build work: inventory</h3>
      <p className="set-hint">Items in scope whose kind is Build work, with the parents they hang from. {PARENT_SHARE_WORDS} A figure built on fewer than {FEW} items says "{FEW_WORDS}".</p>
      {!clients.some((c) => c.snapshot) && <p className="muted">No inventory yet. Run inventory reads each client's layout, then the items in its scope.</p>}
      <table className="adm-table pat-inventory">
        <thead>
          <tr><th>Client</th><th>Platform</th><th>Scope</th><th>First item</th><th>Items</th><th>With description</th><th>With acceptance</th><th>Typical children</th><th>Biggest pair</th><th>Changed after work started</th></tr>
        </thead>
        <tbody>
          {clients.map((c) => {
            const s = c.analysis?.build ?? null;
            const h = s?.headline;
            const prev = c.previous?.rules === 2 && !c.scope.changed && !c.kindsChanged ? c.previous.headline : null;
            const kidsN = s ? s.breakdown.children.top.n + s.breakdown.children.middle.n : 0;
            return (
              <Fragment key={c.key}>
                <tr>
                  <th scope="row">
                    {s ? <button type="button" className="pl-fold" aria-expanded={open === c.key} onClick={() => setOpen(open === c.key ? null : c.key)}>{open === c.key ? "▾" : "▸"} {c.key}</button> : c.key}
                    {c.snapshotAt && <span className="set-hint adm-block">{when(c.snapshotAt)}</span>}
                  </th>
                  <td>
                    <select aria-label={`${c.key}: platform`} value={c.platform ?? ""} onChange={(e) => onPlatform(c.key, (e.target.value || null) as Platform | null)}>
                      <option value="">Not set</option>
                      {(Object.keys(PLATFORM) as Platform[]).map((k) => <option key={k} value={k}>{PLATFORM[k]}</option>)}
                    </select>
                    {!c.platform && c.platformHint && <span className="set-hint adm-block">Admin › Clients says {c.platformHint}</span>}
                  </td>
                  <td>{c.scope.usedWords ?? <span className="muted">{c.snapshot ? "Whole project (before scopes)" : "n/a"}</span>}</td>
                  <td>{c.snapshot?.firstItemAt?.slice(0, 10) ?? <span className="muted">n/a</span>}</td>
                  <td>{num(h?.items)}{prev && h && <Delta d={h.items - prev.items} unit="" />}</td>
                  <td>{shareWords(h?.description, h?.items, { base: false })}{prev && h && !tooFew(h.items) && <Delta d={Math.round(((h.description ?? 0) - (prev.description ?? 0)) * 100)} unit=" pts" />}</td>
                  <td>{shareWords(h?.acceptance, h?.items, { base: false })}{prev && h && !tooFew(h.items) && <Delta d={Math.round(((h.acceptance ?? 0) - (prev.acceptance ?? 0)) * 100)} unit=" pts" />}</td>
                  <td>{fig(h?.typicalChildren, kidsN)}</td>
                  <td>{mainPairWords(h?.mainPair)}{h?.mainPair && <Few n={h.mainPair.of} />}</td>
                  <td>{shareWords(h?.changedAfterStart, s?.afterFact.sampled, { base: false })}</td>
                </tr>
                {open === c.key && s && <tr className="pat-detail-row"><td colSpan={10}><Detail s={s} /></td></tr>}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function Delta({ d, unit }: { d: number; unit: string }) {
  return <span className="set-hint adm-block">{d ? `${d > 0 ? "+" : ""}${d}${unit}` : "no change"}</span>;
}

const spread = (s: Spread) => (s.n ? (tooFew(s.n) ? `${s.n} item${s.n === 1 ? "" : "s"}, ${FEW_WORDS}` : `${s.n} items · median ${num(s.median)}, 75% at most ${num(s.p75)}, 90% at most ${num(s.p90)}, most ${num(s.max)} · ${Object.entries(s.bands).map(([k, v]) => `${k}: ${v}`).join(", ")}`) : "none");
const writingRow = (label: string, w: Writing) => (
  <tr key={label}><th scope="row">{label}</th><td>{w.n}</td><td>{shareWords(w.description, w.n, { base: false })}</td><td>{shareWords(w.acceptance, w.n, { base: false })}</td><td>{shareWords(w.tags, w.n, { base: false })}</td><td>{shareWords(w.estimate, w.n, { base: false })}</td><td>{Object.entries(w.descBands).map(([k, v]) => `${k} ${v}`).join(", ")}</td><td>{Object.entries(w.commentBands).map(([k, v]) => `${k} ${v}`).join(", ")}</td></tr>
);

function Detail({ s }: { s: Snapshot }) {
  return (
    <div className="pat-detail">
      <h4>Shape</h4>
      <table className="adm-table">
        <thead><tr><th>Type</th><th>Level</th><th>Items</th><th>States</th></tr></thead>
        <tbody>{s.types.map((t) => <tr key={t.type}><th scope="row">{t.type}</th><td>{t.level}</td><td>{t.count}</td><td>{types(t.states)}</td></tr>)}</tbody>
      </table>
      <p>How they nest (from the links): {s.nesting.length ? s.nesting.map((n) => `${n.parent} › ${n.child} (${n.count})`).join(", ") : "no parent links"}. Parents read from outside the items (older, or outside scope): {s.olderParents}.</p>
      <h4>Breakdown</h4>
      {s.breakdown.pairs?.length ? (
        <table className="adm-table pat-pairs">
          <thead><tr><th>Pair</th><th>Parents without</th><th>Children per parent</th></tr></thead>
          <tbody>{s.breakdown.pairs.map((p) => <tr key={`${p.parent}>${p.child}`}><th scope="row">{p.parent} with no {p.child}</th><td>{p.without} of {p.of}<Few n={p.of} /></td><td>{spread(p.children)}</td></tr>)}</tbody>
        </table>
      ) : <p className="muted">No parent and child pair shows twice.</p>}
      {!!s.breakdown.noParent?.length && <p>With no parent: {s.breakdown.noParent.map((x) => `${x.type} ${x.count} of ${x.of}${tooFew(x.of) ? ` (${FEW_WORDS})` : ""}`).join(", ")}.</p>}
      <p>Depth: {Object.entries(s.breakdown.depth).map(([k, v]) => `${k} level${k === "1" ? "" : "s"} ${v}`).join(", ")}.</p>
      <h4>How much is written</h4>
      <table className="adm-table">
        <thead><tr><th></th><th>Items</th><th>Description</th><th>Acceptance</th><th>Tags</th><th>Estimate</th><th>Description length</th><th>Comments</th></tr></thead>
        <tbody>
          {writingRow("All", s.writing.all)}
          {Object.entries(s.writing.byType).map(([t, w]) => writingRow(t, w))}
        </tbody>
      </table>
      <h4>Titles</h4>
      <p>{Object.entries(s.titles.lengthBands).map(([k, v]) => `${k} ${v}`).join(", ")}. Starts with a verb {s.titles.patterns.verb}, "As a ..." {s.titles.patterns.as_a}, a question {s.titles.patterns.question}, a bare noun {s.titles.patterns.bare_noun}, other {s.titles.patterns.other}.</p>
      <h4>Timing</h4>
      <p>Created to started: median {fig(s.timing.createdToStarted.median, s.timing.createdToStarted.n, " days")}, 90% within {fig(s.timing.createdToStarted.p90, s.timing.createdToStarted.n)} ({s.timing.createdToStarted.n} items). Started to closed: median {fig(s.timing.startedToClosed.median, s.timing.startedToClosed.n, " days")}, 90% within {fig(s.timing.startedToClosed.p90, s.timing.startedToClosed.n)} ({s.timing.startedToClosed.n}). Created and closed the same day: {s.timing.sameDay.count} of {s.timing.sameDay.of} closed.</p>
      <h4>Written after the fact</h4>
      <p>Of {s.afterFact.sampled} closed items sampled{tooFew(s.afterFact.sampled) ? ` (${FEW_WORDS})` : ""}: the description or acceptance changed after work started on {s.afterFact.changedAfterStart}; both were still empty at close on {s.afterFact.emptyAtClose}.</p>
      <h4>Created per month</h4>
      <p>{Object.entries(s.months).sort().map(([k, v]) => `${k}: ${v}`).join(" · ") || "none"}</p>
    </div>
  );
}

// ---------- tickets and support ----------

function TicketsSection({ clients }: { clients: ClientRow[] }) {
  const rows = clients.filter((c) => c.analysis?.tickets.items);
  const labeled = sumResults(clients.flatMap((c) => (c.results ? [c.results.tickets] : [])));
  return (
    <section aria-label="Tickets and support" className="pat-section">
      <h3>Tickets and support</h3>
      {!rows.length ? <p className="muted">No type in scope is Tickets and support.</p> : (
        <table className="adm-table pat-tickets">
          <thead><tr><th>Client</th><th>Types</th><th>Items</th><th>Open</th><th>Created to closed</th><th>Closed the day they were made</th><th>With description</th><th>Description length</th></tr></thead>
          <tbody>{rows.map((c) => {
            const t: Tickets = c.analysis!.tickets;
            return <tr key={c.key}><th scope="row">{c.key}</th><td>{t.types.join(", ")}</td><td>{t.items}</td><td>{t.open}</td><td>median {fig(t.createdToClosed.median, t.createdToClosed.n, " days")}</td><td>{shareWords(t.sameDay.of ? t.sameDay.count / t.sameDay.of : null, t.sameDay.of)}</td><td>{shareWords(t.writing.description, t.items, { base: false })}</td><td>{Object.entries(t.writing.descBands).map(([k, v]) => `${k} ${v}`).join(", ")}</td></tr>;
          })}</tbody>
        </table>
      )}
      {labeled.labeled > 0 && <p>{labeled.labeled} labeled: {sorted(labeled.requestTypes).slice(0, 5).map(([k, v]) => `${k} ${shareWords(v / labeled.labeled, labeled.labeled, { base: false })}`).join(", ")}.</p>}
    </section>
  );
}

// ---------- check by hand and downloads ----------

function CheckByHand({ clients }: { clients: ClientRow[] }) {
  const [picked, setK] = useState<string | null>(null);
  // The clients arrive (and gain results) after the first render: fall back to the first one offered.
  const k = picked && clients.some((c) => c.key === picked) ? picked : (clients[0]?.key ?? "");
  const [rows, setRows] = useState<CheckRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <section aria-label="Check by hand" className="pat-section">
      <h3>Check by hand</h3>
      {!clients.length ? (
        <p className="muted">Offered for clients you're on, once they are classified.</p>
      ) : (
        <>
          <span className="set-inline">
            <select aria-label="Client to check" value={k} onChange={(e) => (setK(e.target.value), setRows(null))}>
              {clients.map((c) => <option key={c.key} value={c.key}>{c.key}</option>)}
            </select>
            <button type="button" className="mini" onClick={() => void call<{ rows: CheckRow[] }>("patterns.check", { clientKey: k }).then((r) => (setRows(r.rows), setError(null)), (e: unknown) => setError(errText(e)))}>Show 30 items</button>
          </span>
          {error && <p className="error-line" role="alert">{error}</p>}
          {rows && (
            <table className="adm-table pat-check">
              <thead><tr><th>Item</th><th>Title</th><th>Type</th><th>Request type</th><th>Layers</th><th>Readiness</th><th>Missing</th><th>Confidence</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <th scope="row">{r.url ? <a href={r.url} target="_blank" rel="noreferrer">#{r.id}</a> : `#${r.id}`}</th>
                    <td>{r.title}</td>
                    <td>{r.type}</td>
                    <td>{r.labels.requestType}{r.labels.otherName ? ` (${r.labels.otherName})` : ""}</td>
                    <td>{r.labels.layers.join(", ")}</td>
                    <td>{r.labels.readiness}</td>
                    <td>{r.labels.missing.join(", ")}</td>
                    <td>{r.labels.confidence}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}

function Downloads() {
  const [error, setError] = useState<string | null>(null);
  const get = (kind: "summary" | "types") =>
    void call<{ filename: string; text: string }>("patterns.download", { kind }).then((r) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([r.text], { type: "text/markdown" }));
      a.download = r.filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }, (e: unknown) => setError(errText(e)));
  return (
    <section aria-label="Downloads" className="pat-section">
      <h3>Downloads</h3>
      <p className="set-hint">The summary opens with what was covered (each client's scope and kinds, items in scope and labeled, which list the labels are on, the agreement sample), then Build work, then Tickets and support, with a column per client beside all clients and without the largest. Counts, shares, shapes and meanings, as Markdown. No titles, item text or people; team and area names only in the scope line of clients you're on. The request types download lists the list in use first, then every earlier list.</p>
      <span className="set-inline">
        <button type="button" className="mini" onClick={() => get("summary")}>Download summary</button>
        <button type="button" className="mini" onClick={() => get("types")}>Download request types</button>
      </span>
      {error && <p className="error-line" role="alert">{error}</p>}
    </section>
  );
}
