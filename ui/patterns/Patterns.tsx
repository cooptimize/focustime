// WP-1: DevOps patterns (#/patterns), a hidden working page, only for people an admin turned it on for. Top to bottom:
// Runs (inventory, estimate, classification, each client's state, Resume), Platform, Inventory (one row per client with
// its change since the previous snapshot; opening a row shows the rest), Classification (feature shapes first, the main
// result), Request types, Check by hand (clients I'm on only) and two Markdown downloads. Existing classes only.
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { ActionRefusal, call } from "../api.ts";
import { useReturnFocus } from "../CloseButton.tsx";
import { fmtUsd } from "../../ai/cost.ts";
import type { Snapshot, Spread, Writing } from "../../plan/patterns/inventory.ts";
import { sumResults, type ClientResults } from "../../plan/patterns/results.ts";
import type { Labels, Platform, TypeList } from "../../plan/patterns/types.ts";

type ClientProgress = { state: "waiting" | "reading" | "done" | "stopped" | "skipped"; reason?: string | null; phase?: string; month?: number; next?: number; total?: number; done?: number; dropped?: number; capped?: boolean };
type RunView = { id: number; kind: "inventory" | "classify"; state: "running" | "stopped" | "done"; reason: string | null; startedAt: string; finishedAt: string | null; pass: 1 | 2 | null; estimateMicros: number; spentMicros: number; clients: Record<string, ClientProgress> };
type ClientRow = { key: string; mine: boolean; platform: Platform | null; platformHint: string | null; snapshot: Snapshot | null; snapshotAt: string | null; previous: Snapshot["headline"] | null; previousAt: string | null; results: ClientResults | null };
type Status = { clients: ClientRow[]; inventory: { last: RunView | null; lastDone: string | null }; classify: { last: RunView | null; lastDone: string | null }; lists: TypeList[]; shownVersion: string; ai: { ready: boolean; words: string | null } };
type Estimate = { clients: Record<string, { items: number; micros: number; skipped: string | null }>; totalItems: number; totalMicros: number };
type CheckRow = { id: number; url: string | null; title: string; type: string; level: string; labels: Labels };

const errText = (e: unknown) => (e instanceof ActionRefusal || e instanceof Error ? e.message : "Something went wrong");
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "never");
const pct = (v: number | null | undefined) => (v === null || v === undefined ? "n/a" : `${Math.round(v * 100)}%`);
const num = (v: number | null | undefined) => (v === null || v === undefined ? "n/a" : String(v));
const PLATFORM: Record<Platform, string> = { azure: "Azure", fabric: "Fabric", both: "Both" };
type Filter = "all" | Platform | "unset";
const FILTERS: [Filter, string][] = [["all", "All clients"], ["azure", "Azure"], ["fabric", "Fabric"], ["both", "Both"], ["unset", "Not set"]];
const STATE_WORDS: Record<ClientProgress["state"], string> = { waiting: "Waiting", reading: "Reading", done: "Done", stopped: "Stopped", skipped: "Skipped" };
const PHASE_WORDS: Record<string, string> = { first: "first item", months: "finding items", items: "reading items", parents: "reading parents", history: "reading history", numbers: "counting", pass1: "pass 1", pass2: "pass 2", done: "" };

/** The change in a share since the previous snapshot, in points ("+4 pts"); nothing when either is missing. */
function delta(now: number | null | undefined, prev: number | null | undefined, share = true): string | null {
  if (now === null || now === undefined || prev === null || prev === undefined) return null;
  const d = share ? Math.round((now - prev) * 100) : now - prev;
  if (!d) return "no change";
  return `${d > 0 ? "+" : ""}${d}${share ? " pts" : ""}`;
}

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

  const act = async (name: string, input: Record<string, unknown>, done?: string) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await call<unknown>(name, input);
      if (done) setMsg(done);
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
  const total = useMemo(() => sumResults(shown.map((c) => c.results).filter((r): r is ClientResults => !!r)), [shown]);

  return (
    <main className="mtg-view pat-view" aria-label="DevOps patterns" tabIndex={-1}>
      <header className="page-head">
        <div className="ph-title">
          <h2>DevOps patterns</h2>
          <span className="muted">Preview · how work is entered and broken down in each client's DevOps, from the last 24 months. Read only.</span>
        </div>
        <button type="button" className="mini" onClick={onClose}>Close</button>
      </header>
      {error && <p className="error-line" role="alert">{error}</p>}
      {!data && !error && <p className="muted">Loading…</p>}
      {data && (
        <>
          <Runs data={data} busy={busy} estimate={estimate} msg={msg}
            onInventory={() => void act("patterns.run_inventory", {}, "Inventory started. It reads slowly on purpose; keep this page open.")}
            onResume={(id) => void act("patterns.resume", { runId: id }, "Resumed.")}
            onEstimate={async () => {
              const e = (await act("patterns.estimate", {})) as Estimate | null;
              if (e) setEstimate(e);
            }}
            onClassify={() => {
              const stopped = data.classify.last?.state === "stopped" ? data.classify.last.id : null;
              void act(stopped ? "patterns.resume" : "patterns.run_classification", { ...(stopped ? { runId: stopped } : {}), total: estimate!.totalMicros }, "Classification started.").then(() => setEstimate(null));
            }}
          />
          <section aria-label="Platform" className="pat-section">
            <h3>Platform</h3>
            <label className="set-inline">
              Show{" "}
              <select aria-label="Show clients on" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
                {FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <span className="set-hint"> Set each client's platform in the table below; every table on this page follows the choice.</span>
          </section>
          <Inventory clients={shown} onPlatform={(k, p) => void act("patterns.set_platform", { clientKey: k, platform: p })} />
          <Classification total={total} clientsShown={shown.length} />
          <TypesList lists={data.lists} shown={data.shownVersion} />
          <CheckByHand clients={data.clients.filter((c) => c.mine && c.results)} />
          <Downloads />
        </>
      )}
    </main>
  );
}

function RunTable({ run }: { run: RunView }) {
  return (
    <table className="adm-table pat-run">
      <thead><tr><th>Client</th><th>State</th><th>Where</th></tr></thead>
      <tbody>
        {Object.entries(run.clients).map(([k, c]) => (
          <tr key={k}>
            <th scope="row">{k}</th>
            <td className={c.state === "stopped" ? "field-problem" : undefined}>{STATE_WORDS[c.state]}</td>
            <td>
              {[c.phase && c.state !== "done" ? PHASE_WORDS[c.phase] : null, c.phase === "months" && c.state === "reading" ? `month ${c.month ?? 0} of 24` : null, run.kind === "classify" && c.total ? `${c.done ?? 0} of ${c.total} labeled` : null, c.dropped ? `${c.dropped} the AI couldn't label` : null, c.capped ? "a month hit DevOps's 20,000 limit" : null, c.reason ?? null].filter(Boolean).join(" · ") || ""}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Runs({ data, busy, estimate, msg, onInventory, onResume, onEstimate, onClassify }: { data: Status; busy: boolean; estimate: Estimate | null; msg: string | null; onInventory: () => void; onResume: (id: number) => void; onEstimate: () => void; onClassify: () => void }) {
  const inv = data.inventory.last;
  const cls = data.classify.last;
  const running = inv?.state === "running" || cls?.state === "running";
  const current = [inv, cls].filter((r): r is RunView => !!r).sort((a, b) => b.id - a.id)[0] ?? null;
  return (
    <section aria-label="Runs" className="pat-section">
      <h3>Runs</h3>
      <p className="muted">Last inventory: {when(data.inventory.lastDone)} · Last classification: {when(data.classify.lastDone)}</p>
      <div className="set-inline pat-buttons">
        <button type="button" className="mini" disabled={busy || running} onClick={onInventory}>Run inventory</button>
        {inv?.state === "stopped" && <button type="button" className="mini" disabled={busy || running} onClick={() => onResume(inv.id)}>Resume inventory</button>}
        <button type="button" className="mini" disabled={busy || running || !data.ai.ready} onClick={onEstimate}>Estimate</button>
        {estimate && (
          <button type="button" className="mini" disabled={busy || running || !estimate.totalItems} onClick={onClassify}>
            {cls?.state === "stopped" ? "Resume classification" : "Run classification"} ({estimate.totalItems} items, about {fmtUsd(estimate.totalMicros)})
          </button>
        )}
      </div>
      {!data.ai.ready && <p className="set-hint">{data.ai.words} The inventory works without it.</p>}
      {cls?.state === "stopped" && !estimate && <p className="set-hint">Classification stopped. Estimate again to resume it.</p>}
      {msg && <p className="set-hint" role="status">{msg}</p>}
      {estimate && (
        <table className="adm-table pat-estimate">
          <thead><tr><th>Client</th><th>Items to classify</th><th>Expected cost</th></tr></thead>
          <tbody>
            {Object.entries(estimate.clients).map(([k, e]) => (
              <tr key={k}><th scope="row">{k}</th><td>{e.skipped ? <span className="muted">{e.skipped}</span> : e.items}</td><td>{e.skipped ? "" : fmtUsd(e.micros)}</td></tr>
            ))}
            <tr><th scope="row">Total</th><td>{estimate.totalItems}</td><td>{fmtUsd(estimate.totalMicros)}</td></tr>
          </tbody>
        </table>
      )}
      {current && (
        <>
          <p className={current.state === "stopped" ? "field-problem" : "muted"}>
            {current.kind === "inventory" ? "Inventory" : `Classification${current.pass ? `, pass ${current.pass}` : ""}`}: {current.state === "running" ? "running" : current.state === "done" ? `done ${when(current.finishedAt)}` : (current.reason ?? "Stopped")}
            {current.kind === "classify" && current.estimateMicros ? ` · spent ${fmtUsd(current.spentMicros)} of about ${fmtUsd(current.estimateMicros)}` : ""}
          </p>
          {current.state !== "done" && <RunTable run={current} />}
        </>
      )}
    </section>
  );
}

function Delta({ now, prev, share = true }: { now: number | null | undefined; prev: number | null | undefined; share?: boolean }) {
  const d = delta(now, prev, share);
  return d ? <span className="set-hint adm-block">{d}</span> : null;
}

function Inventory({ clients, onPlatform }: { clients: ClientRow[]; onPlatform: (k: string, p: Platform | null) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section aria-label="Inventory" className="pat-section">
      <h3>Inventory</h3>
      {!clients.some((c) => c.snapshot) && <p className="muted">No inventory yet. Run inventory reads each client's DevOps and counts how work is written.</p>}
      <table className="adm-table pat-inventory">
        <thead>
          <tr><th>Client</th><th>Platform</th><th>First item</th><th>Items</th><th>With description</th><th>With acceptance</th><th>Typical children</th><th>Parents with no children</th><th>Changed after work started</th></tr>
        </thead>
        <tbody>
          {clients.map((c) => {
            const h = c.snapshot?.headline;
            const p = c.previous;
            return (
              <Fragment key={c.key}>
                <tr>
                  <th scope="row">
                    {c.snapshot ? <button type="button" className="pl-fold" aria-expanded={open === c.key} onClick={() => setOpen(open === c.key ? null : c.key)}>{open === c.key ? "▾" : "▸"} {c.key}</button> : c.key}
                    {c.snapshotAt && <span className="set-hint adm-block">{when(c.snapshotAt)}</span>}
                  </th>
                  <td>
                    <select aria-label={`${c.key}: platform`} value={c.platform ?? ""} onChange={(e) => onPlatform(c.key, (e.target.value || null) as Platform | null)}>
                      <option value="">Not set</option>
                      {(Object.keys(PLATFORM) as Platform[]).map((k) => <option key={k} value={k}>{PLATFORM[k]}</option>)}
                    </select>
                    {!c.platform && c.platformHint && <span className="set-hint adm-block">Admin › Clients says {c.platformHint}</span>}
                  </td>
                  <td>{c.snapshot?.firstItemAt?.slice(0, 10) ?? <span className="muted">n/a</span>}</td>
                  <td>{num(h?.items)}<Delta now={h?.items} prev={p?.items} share={false} /></td>
                  <td>{pct(h?.description)}<Delta now={h?.description} prev={p?.description} /></td>
                  <td>{pct(h?.acceptance)}<Delta now={h?.acceptance} prev={p?.acceptance} /></td>
                  <td>{num(h?.typicalChildren)}<Delta now={h?.typicalChildren} prev={p?.typicalChildren} share={false} /></td>
                  <td>{pct(h?.parentsNoChildren)}<Delta now={h?.parentsNoChildren} prev={p?.parentsNoChildren} /></td>
                  <td>{pct(h?.changedAfterStart)}<Delta now={h?.changedAfterStart} prev={p?.changedAfterStart} /></td>
                </tr>
                {open === c.key && c.snapshot && (
                  <tr className="pat-detail-row"><td colSpan={9}><Detail s={c.snapshot} /></td></tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

const spread = (s: Spread) => (s.n ? `${s.n} items · median ${num(s.median)}, 75% at most ${num(s.p75)}, 90% at most ${num(s.p90)}, most ${num(s.max)} · ${Object.entries(s.bands).map(([k, v]) => `${k}: ${v}`).join(", ")}` : "none");
const writingRow = (label: string, w: Writing) => (
  <tr key={label}><th scope="row">{label}</th><td>{w.n}</td><td>{pct(w.description)}</td><td>{pct(w.acceptance)}</td><td>{pct(w.tags)}</td><td>{pct(w.estimate)}</td><td>{Object.entries(w.descBands).map(([k, v]) => `${k} ${v}`).join(", ")}</td><td>{Object.entries(w.commentBands).map(([k, v]) => `${k} ${v}`).join(", ")}</td></tr>
);

function Detail({ s }: { s: Snapshot }) {
  return (
    <div className="pat-detail">
      <h4>Shape</h4>
      <table className="adm-table">
        <thead><tr><th>Type</th><th>Level</th><th>Items</th><th>States</th></tr></thead>
        <tbody>{s.types.map((t) => <tr key={t.type}><th scope="row">{t.type}</th><td>{t.level}</td><td>{t.count}</td><td>{Object.entries(t.states).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ")}</td></tr>)}</tbody>
      </table>
      <p>How they nest (from the links): {s.nesting.length ? s.nesting.map((n) => `${n.parent} › ${n.child} (${n.count})`).join(", ") : "no parent links"}. Parents read from before the window: {s.olderParents}.</p>
      <h4>Breakdown</h4>
      <p>Children per top item: {spread(s.breakdown.children.top)}</p>
      <p>Children per middle item: {spread(s.breakdown.children.middle)}</p>
      <p>Middle items with no children: {s.breakdown.middleNoChildren.count} of {s.breakdown.middleNoChildren.of}. Leaf items with no parent: {s.breakdown.leafNoParent.count} of {s.breakdown.leafNoParent.of}. Depth: {Object.entries(s.breakdown.depth).map(([k, v]) => `${k} level${k === "1" ? "" : "s"} ${v}`).join(", ")}.</p>
      <h4>How much is written</h4>
      <table className="adm-table">
        <thead><tr><th></th><th>Items</th><th>Description</th><th>Acceptance</th><th>Tags</th><th>Estimate</th><th>Description length</th><th>Comments</th></tr></thead>
        <tbody>
          {writingRow("All", s.writing.all)}
          {(["top", "middle", "leaf", "other"] as const).filter((l) => s.writing.byLevel[l].n).map((l) => writingRow(`Level: ${l}`, s.writing.byLevel[l]))}
          {Object.entries(s.writing.byType).map(([t, w]) => writingRow(t, w))}
        </tbody>
      </table>
      <h4>Titles</h4>
      <p>{Object.entries(s.titles.lengthBands).map(([k, v]) => `${k} ${v}`).join(", ")}. Starts with a verb {s.titles.patterns.verb}, "As a ..." {s.titles.patterns.as_a}, a question {s.titles.patterns.question}, a bare noun {s.titles.patterns.bare_noun}, other {s.titles.patterns.other}.</p>
      <h4>Timing</h4>
      <p>Created to started: median {num(s.timing.createdToStarted.median)} days, 90% within {num(s.timing.createdToStarted.p90)} ({s.timing.createdToStarted.n} items). Started to closed: median {num(s.timing.startedToClosed.median)} days, 90% within {num(s.timing.startedToClosed.p90)} ({s.timing.startedToClosed.n}). Created and closed the same day: {s.timing.sameDay.count} of {s.timing.sameDay.of} closed.</p>
      <h4>Written after the fact</h4>
      <p>Of {s.afterFact.sampled} closed items sampled: the description or acceptance changed after work started on {s.afterFact.changedAfterStart}; both were still empty at close on {s.afterFact.emptyAtClose}.</p>
      <h4>Created per month</h4>
      <p>{Object.entries(s.months).sort().map(([k, v]) => `${k}: ${v}`).join(" · ") || "none"}</p>
    </div>
  );
}

const sorted = (m: Record<string, number>) => Object.entries(m).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

function Classification({ total, clientsShown }: { total: ClientResults; clientsShown: number }) {
  if (!total.labeled) return (
    <section aria-label="Classification" className="pat-section">
      <h3>Classification</h3>
      <p className="muted">No classification yet. Estimate, then Run classification.</p>
    </section>
  );
  const share = (v: number) => pct(v / total.labeled);
  const a = total.agreement;
  return (
    <section aria-label="Classification" className="pat-section">
      <h3>Classification</h3>
      <p className="muted">{total.labeled} of {total.eligible} items labeled, across {clientsShown} client{clientsShown === 1 ? "" : "s"}.</p>
      <h4>Common feature shapes</h4>
      <p className="set-hint">For each classified parent, the layers its children touch, in order. The most common per request type.</p>
      <table className="adm-table pat-shapes">
        <thead><tr><th>Request type</th><th>Shape</th><th>Parents</th></tr></thead>
        <tbody>{total.shapes.length ? total.shapes.map((s) => <tr key={`${s.requestType}|${s.shape.join("|")}`}><th scope="row">{s.requestType}</th><td>{s.shape.join(" › ")}</td><td>{s.count}</td></tr>) : <tr><td colSpan={3} className="muted">No classified parent has classified children yet.</td></tr>}</tbody>
      </table>
      <div className="pat-grid">
        <table className="adm-table">
          <thead><tr><th>Request type</th><th>Items</th><th>Share</th></tr></thead>
          <tbody>{sorted(total.requestTypes).map(([k, v]) => <tr key={k}><th scope="row">{k}</th><td>{v}</td><td>{share(v)}</td></tr>)}</tbody>
        </table>
        <table className="adm-table">
          <thead><tr><th>Layer</th><th>Items</th></tr></thead>
          <tbody>{sorted(total.layers).map(([k, v]) => <tr key={k}><th scope="row">{k}</th><td>{v}</td></tr>)}</tbody>
        </table>
        <table className="adm-table">
          <thead><tr><th>Readiness as written</th><th>Items</th></tr></thead>
          <tbody>{sorted(total.readiness).map(([k, v]) => <tr key={k}><th scope="row">{k}</th><td>{share(v)}</td></tr>)}</tbody>
        </table>
        <table className="adm-table">
          <thead><tr><th>Confidence</th><th>Items</th></tr></thead>
          <tbody>{sorted(total.confidence).map(([k, v]) => <tr key={k}><th scope="row">{k}</th><td>{share(v)}</td></tr>)}</tbody>
        </table>
      </div>
      <h4>What is missing most, by request type</h4>
      <table className="adm-table">
        <thead><tr><th>Request type</th><th>Missing most</th></tr></thead>
        <tbody>{Object.entries(total.missing).sort(([x], [y]) => x.localeCompare(y)).map(([t, m]) => <tr key={t}><th scope="row">{t}</th><td>{sorted(m).filter(([k]) => k !== "none").slice(0, 3).map(([k, v]) => `${k} (${v})`).join(", ") || <span className="muted">nothing</span>}</td></tr>)}</tbody>
      </table>
      <h4>Agreement</h4>
      <p>{a.pairs ? `On ${a.pairs} items classified twice, the answers matched: request type ${pct(a.requestType)}, layers ${pct(a.layers)}, readiness ${pct(a.readiness)}, missing ${pct(a.missing)}, confidence ${pct(a.confidence)}.` : "No item has been classified twice yet."}</p>
    </section>
  );
}

function TypesList({ lists, shown }: { lists: TypeList[]; shown: string }) {
  const list = lists.find((l) => l.version === shown) ?? lists[0];
  if (!list) return null;
  return (
    <section aria-label="Request types" className="pat-section">
      <h3>Request types</h3>
      <p className="muted">{list.version === "v1" ? "The starting list, a hypothesis." : `Version 2, made ${when(list.createdAt)} from the first pass's suggestions.`}</p>
      <table className="adm-table">
        <thead><tr><th>Request type</th><th>Meaning</th><th>Made-up example</th></tr></thead>
        <tbody>{list.types.map((t) => <tr key={t.name}><th scope="row">{t.name}</th><td>{t.meaning}</td><td>{t.example}</td></tr>)}</tbody>
      </table>
      {list.version !== "v1" && (
        <>
          <h4>What changed from the starting list</h4>
          {list.changes.length ? <ul>{list.changes.map((c, n) => <li key={n}>{c.kind}: {c.from.join(", ") || "new"} › {c.to.join(", ")} ({c.count} items in pass 1). {c.reason}</li>)}</ul> : <p className="muted">Nothing changed.</p>}
        </>
      )}
    </section>
  );
}

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
      <p className="set-hint">Counts, shares, shapes and meanings across clients, as Markdown. No titles, no item text, no people.</p>
      <span className="set-inline">
        <button type="button" className="mini" onClick={() => get("summary")}>Download summary</button>
        <button type="button" className="mini" onClick={() => get("types")}>Download request types</button>
      </span>
      {error && <p className="error-line" role="alert">{error}</p>}
    </section>
  );
}
