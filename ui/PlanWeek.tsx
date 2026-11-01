// Plan the week (step 8): commit features per client to a week by giving each a number of my blocks or dropping it
// on specific blocks, with a fit check per client, a short readiness list with one action each, and a Coop brief
// per feature. DevOps is read-only; the week plan lives only in the local plan store. A past week is a review.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from "react";
import type { WeekLoadData, WeekPlanState } from "../actions/types.ts";
import { borrowedSummary } from "../plan/borrow.ts";
import type { WeekFeature } from "../plan/types.ts";
import { readiness, weekFit, type ClientFit, type ReadinessFlag } from "../plan/weekplan.ts";
import { formatDuration } from "../week/format.ts";
import type { IsoDate, PortfolioItem, Slot } from "../week/types.ts";
import { call } from "./api.ts";
import { clientColor } from "./labels.ts";
import { copy } from "./Loops.tsx";
import { WorkLink } from "./WorkLink.tsx";

type Props = { weekStart: IsoDate; data: WeekLoadData; version: number; onWeek: (w: IsoDate) => void; onClose: () => void; onChanged: () => void };
type Half = "AM" | "PM";
type Place = { date: IsoDate; half: Half; label: string };

const DRAG_TYPE = "application/x-coopilot-feature";
const HALF_WORD: Record<Half, string> = { AM: "morning", PM: "afternoon" };
const plainDate = (d: IsoDate) => Temporal.PlainDate.from(d);
const weekLabel = (w: IsoDate) => plainDate(w).toLocaleString("en-US", { month: "short", day: "numeric" });
const dayShort = (d: IsoDate) => plainDate(d).toLocaleString("en-US", { weekday: "short" });
const dateShort = (d: IsoDate) => plainDate(d).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" });
const placeLabel = (date: IsoDate, half: Half) => `${dayShort(date)} ${half}`;
const stamp = (s: string, tz: string) => {
  const z = Temporal.ZonedDateTime.from(s).withTimeZone(tz);
  return `${z.toPlainDate().toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" })}, ${z.toPlainTime().toLocaleString("en-US", { hour: "numeric", minute: "2-digit" })}`;
};
const VERDICT: Record<ClientFit["verdict"], string> = { none: "Nothing committed", fits: "Fits", tight: "Tight", over: "Over" };

/** Where a client's feature can go: its own blocks, or an Open half-day. */
function placesFor(days: WeekLoadData["week"]["days"], clientKey: string): Place[] {
  return days.flatMap((d) =>
    ([["AM", d.am], ["PM", d.pm]] as [Half, Slot][])
      .filter(([, s]) => !s.pto && (s.focus[0] ? s.focus[0].clientKey === clientKey : s.open))
      .map(([half, s]) => ({ date: d.date, half, label: `${placeLabel(d.date, half)}${s.focus[0] ? "" : " (Open)"}` })),
  );
}

export function PlanWeek({ weekStart, data, version, onWeek, onClose, onChanged }: Props) {
  const [st, setSt] = useState<WeekPlanState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [brief, setBrief] = useState<{ id: number; text: string } | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [dragOver, setDragOver] = useState<string | null>(null);
  const head = useRef<HTMLHeadingElement>(null);
  const briefArea = useRef<HTMLTextAreaElement>(null);
  const tz = data.hours.timeZone;
  const weekReady = data.weekStart === weekStart;

  const load = useCallback(
    async (refresh = false) => {
      try {
        setSt(await call<WeekPlanState>("weekplan.load", { weekStart, ...(refresh ? { refresh } : {}) }));
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load Plan the week");
      }
    },
    [weekStart],
  );
  useEffect(() => {
    void load();
  }, [load, version]);
  useEffect(() => {
    setBrief(null);
    head.current?.focus();
  }, [weekStart]);

  const act = useCallback(
    async (action: string, input: Record<string, unknown>, done?: string) => {
      try {
        await call(action, input);
        await load();
        onChanged();
        if (done) setNotice(done);
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : "That didn't work");
        return false;
      }
    },
    [load, onChanged],
  );

  const features: WeekFeature[] = st?.plan.features ?? [];
  const borrowedMinutes = useMemo(() => {
    const m: Record<string, number> = {};
    for (const b of data.borrowed) if (!b.paidAt) m[b.clientKey] = (m[b.clientKey] ?? 0) + b.minutes;
    return m;
  }, [data.borrowed]);
  const fits = useMemo(() => (weekReady ? weekFit(data.week, features, { borrowedMinutes }) : []), [weekReady, data.week, features, borrowedMinutes]);
  const flags = useMemo(
    () =>
      st && weekReady && st.access === "plan"
        ? readiness({ week: data.week, portfolios: st.portfolios, features, work: data.devops, marks: st.marks, loops: st.loops.map((l) => ({ id: l.id, kind: l.kind, clientKey: l.clientKey, ruleKey: `priorities:${weekStart}:${l.clientKey}`, closedAt: l.closedAt })) })
        : [],
    [st, weekReady, data.week, data.devops, features, weekStart],
  );

  if (!st || !weekReady)
    return <main className="planweek" aria-label="Plan the week">{error ? <p className="set-problem">{error}</p> : <p className="muted">Loading…</p>}</main>;

  const past = st.access === "past";
  const names = new Map<string, string>([...data.planClients.map((c) => [c.clientKey, c.clientName] as const), ...st.portfolios.map((p) => [p.clientKey, p.clientName] as const), ...fits.map((f) => [f.clientKey, f.clientName] as const)]);
  const nameOf = (k: string) => names.get(k) ?? k;
  const prev = plainDate(weekStart).subtract({ days: 7 }).toString();
  const next = plainDate(weekStart).add({ days: 7 }).toString();
  const isThis = weekStart === st.thisWeek;
  const days = data.week.days.filter((d) => d.kind !== "weekend");

  // Summary strip: open loops, unpaid borrowed time, PTO days and flex sessions in the week.
  const unpaid = borrowedSummary(data.borrowed, days[0]!.date, days.at(-1)!.date);
  const ptoDays = data.week.days.filter((d) => d.pto).length;
  const flexCount = data.week.days.reduce((n, d) => n + d.am.flex.length + d.pm.flex.length + (d.eve?.flex.length ?? 0), 0);

  const committed = (k: string, id: number) => features.find((f) => f.clientKey === k && f.itemId === id);
  const setBlocks = (k: string, item: { id: number; title: string }, blocks: number) =>
    void act("weekplan.set_feature", { weekStart, clientKey: k, itemId: item.id, blocks }, blocks === 0 ? `Took #${item.id} off the week` : undefined);
  const place = (k: string, itemId: number, date: IsoDate, half: Half, on: boolean) => void act("weekplan.place", { weekStart, clientKey: k, itemId, date, half, on });
  const copyBrief = async (k: string, id: number) => {
    try {
      const r = await call<{ markdown: string; descriptionRead: boolean }>("feature.brief", { weekStart, clientKey: k, itemId: id });
      setBrief({ id, text: r.markdown });
      // The text box renders first so the fallback can select it.
      await new Promise((res) => setTimeout(res, 0));
      const ok = await copy(r.markdown, briefArea.current);
      setNotice(ok ? `Coop brief for #${id} copied${r.descriptionRead ? "" : " (the description couldn't be read)"}` : "Copy didn't work: the brief is selected below, press Ctrl+C");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not build the brief");
    }
  };
  const toggleOpen = (key: string) => setOpen((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  const onDrop = (e: DragEvent, date: IsoDate, half: Half, slot: Slot) => {
    e.preventDefault();
    setDragOver(null);
    try {
      const f = JSON.parse(e.dataTransfer.getData(DRAG_TYPE)) as { clientKey: string; itemId: number };
      if (slot.focus[0] && slot.focus[0].clientKey !== f.clientKey) return setError(`That block is ${slot.focus[0].clientName}'s`);
      place(f.clientKey, f.itemId, date, half, true);
    } catch {
      /* not a feature */
    }
  };

  const commitLabel = st.plan.committedAt ? (st.plan.changed ? "Commit again" : "Committed") : "Commit week";

  return (
    <main className="planweek" aria-label="Plan the week">
      <div className="loops-head">
        <h2 ref={head} tabIndex={-1}>
          Plan the week <span className="muted">of {weekLabel(weekStart)}{isThis ? " (this week)" : weekStart === plainDate(st.thisWeek).add({ days: 7 }).toString() ? " (next week)" : past ? " (review)" : ""}</span>
        </h2>
        <span className="co-step">
          <button type="button" className="mini" onClick={() => onWeek(prev)} aria-label="Previous week" title="Previous week">‹</button>
          <button type="button" className="mini" onClick={() => onWeek(next)} aria-label="Next week" title="Next week">›</button>
        </span>
        {st.plan.committedAt ? (
          <span className={st.plan.changed ? "pw-state changed" : "co-done"}>
            {st.plan.changed ? `Changed since commit (${stamp(st.plan.committedAt, tz)})` : `Committed ${stamp(st.plan.committedAt, tz)}`}
          </span>
        ) : (
          !past && <span className="pw-state">Not committed</span>
        )}
        {!past && (
          <button type="button" className="top-btn" onClick={() => void load(true)} title="Read features and epics from DevOps again">
            Refresh DevOps
          </button>
        )}
        {!past && (
          <button type="button" className="top-btn primary" disabled={!!st.plan.committedAt && !st.plan.changed} onClick={() => void act("weekplan.commit", { weekStart }, "Week committed")}>
            {commitLabel}
          </button>
        )}
        <button type="button" className="top-btn" onClick={onClose} title="Back to the week (Esc)">
          Back
        </button>
      </div>
      {error && <p className="set-problem" role="alert">{error} <button type="button" className="mini" onClick={() => setError(null)}>Dismiss</button></p>}
      {notice && <p className="co-notice" role="status">{notice}</p>}

      <ul className="pw-summary" aria-label="The week at a glance">
        <li><strong>{data.openLoops}</strong> open loop{data.openLoops === 1 ? "" : "s"}</li>
        <li><strong>{unpaid.unpaidMinutes ? formatDuration(unpaid.unpaidMinutes) : "0"}</strong> unpaid borrowed time</li>
        <li><strong>{ptoDays}</strong> PTO day{ptoDays === 1 ? "" : "s"}</li>
        <li><strong>{flexCount}</strong> flex session{flexCount === 1 ? "" : "s"}</li>
        {past && <li className="muted">Past week: a review, nothing changes</li>}
      </ul>

      {!past && (
        <section className="co-section" aria-label="Readiness">
          <h3>Readiness <span className="muted">{flags.length ? `${flags.length} to look at` : "Nothing to fix"}</span></h3>
          {flags.length > 0 && (
            <ul className="pw-ready">
              {flags.map((f) => (
                <ReadyRow key={`${f.kind}:${f.clientKey}:${f.itemId ?? ""}`} f={f} clientName={nameOf(f.clientKey)} tz={tz}
                  onBrief={() => void copyBrief(f.clientKey, f.itemId!)}
                  onMark={(on) => void act("feature.mark_breakdown", { clientKey: f.clientKey, itemId: f.itemId, on }, on ? `#${f.itemId} marked as being broken down` : undefined)}
                  onAsk={() => void act("loop.ask_priorities", { weekStart, clientKey: f.clientKey }, `Loop opened: ask ${nameOf(f.clientKey)} about priorities`)} />
              ))}
            </ul>
          )}
        </section>
      )}
      {brief && (
        <section className="co-section pw-brief" aria-label="Coop brief">
          <h3>Coop brief <span className="muted">#{brief.id}</span> <button type="button" className="mini" onClick={() => setBrief(null)}>Hide</button></h3>
          <textarea ref={briefArea} readOnly value={brief.text} rows={10} />
        </section>
      )}

      <section className="co-section pw-board-wrap" aria-label="The week's blocks">
        <h3>Blocks <span className="muted">{past ? "What was committed" : "Drop a feature on its client's block or an Open half-day"}</span></h3>
        <div className="pw-board" style={{ gridTemplateColumns: `auto repeat(${days.length}, minmax(0, 1fr))` }}>
          <span />
          {days.map((d) => <span key={d.date} className="pw-day">{dateShort(d.date)}</span>)}
          {(["AM", "PM"] as Half[]).map((half) => [
            <span key={half} className="pw-half">{half}</span>,
            ...days.map((d) => {
              const s = half === "AM" ? d.am : d.pm;
              const key = `${d.date}${half}`;
              const here = features.filter((f) => f.slots.some((x) => x.date === d.date && x.half === half));
              const target = !past && !s.pto && (!!s.focus[0] || s.open);
              const c = s.focus[0];
              return (
                <div key={key} className={`pw-cell${c ? " block" : s.open ? " open" : " none"}${dragOver === key ? " over" : ""}`}
                  style={{ "--c": clientColor(c?.clientKey, data.clients) } as CSSProperties}
                  onDragOver={target ? (e) => { if (e.dataTransfer.types.includes(DRAG_TYPE)) { e.preventDefault(); setDragOver(key); } } : undefined}
                  onDragLeave={target ? () => setDragOver(null) : undefined}
                  onDrop={target ? (e) => onDrop(e, d.date, half, s) : undefined}
                  aria-label={`${dateShort(d.date)} ${HALF_WORD[half]}: ${s.pto ? "PTO" : c ? c.clientName : s.open ? "Open" : "no block"}`}>
                  <span className="pw-who">{s.pto ? "PTO" : c ? c.clientName : s.open ? "Open" : "None"}</span>
                  {here.map((f) => (
                    <span key={f.id} className="pw-chip" title={f.title}>
                      #{f.itemId} {f.title}
                      {!past && <button type="button" className="mini" aria-label={`Take #${f.itemId} off ${placeLabel(d.date, half)}`} onClick={() => place(f.clientKey, f.itemId, d.date, half, false)}>×</button>}
                    </span>
                  ))}
                </div>
              );
            }),
          ])}
        </div>
      </section>

      {past ? (
        <PastList features={features} fits={fits} nameOf={nameOf} />
      ) : (
        <ClientSections st={st} fits={fits} features={features} days={days} nameOf={nameOf} colors={data.clients} open={open} toggleOpen={toggleOpen}
          committed={committed} setBlocks={setBlocks} place={place} onBrief={(k, id) => void copyBrief(k, id)} />
      )}
    </main>
  );
}

function FitChip({ fit }: { fit: ClientFit | undefined }) {
  if (!fit) return null;
  const borrowed = fit.borrowedMinutes ? `, after ${formatDuration(fit.borrowedMinutes)} borrowed` : "";
  return (
    <span className={`pw-fit ${fit.verdict}`} title={`Committed ${fit.committedBlocks} of about ${fit.availableBlocks} available blocks (free time after PTO, meetings and unavailable time${borrowed})`}>
      {VERDICT[fit.verdict]} <span className="muted">{fit.committedBlocks} of {fit.availableBlocks} blocks</span>
    </span>
  );
}

const KIND: Record<ReadinessFlag["kind"], string> = { block_needs_work: "Block needs work", needs_breakdown: "Needs breakdown", needs_features: "Needs features", no_target_date: "No target date" };

function ReadyRow({ f, clientName, tz, onBrief, onMark, onAsk }: { f: ReadinessFlag; clientName: string; tz: string; onBrief: () => void; onMark: (on: boolean) => void; onAsk: () => void }) {
  return (
    <li className={`pw-flag${f.soft ? " soft" : ""}`}>
      <span className="pw-kind">{KIND[f.kind]}</span>
      <span className="pw-flag-what">
        <span className="muted">{clientName}</span>{" "}
        {f.kind === "block_needs_work" ? (
          `${f.blocks} block${f.blocks === 1 ? "" : "s"}, nothing open is assigned to you`
        ) : (
          <WorkLink clientKey={f.clientKey} url={f.url}>#{f.itemId} {f.title}</WorkLink>
        )}
      </span>
      <span className="pw-acts">
        {f.kind === "needs_breakdown" && (
          <>
            <button type="button" className="mini" onClick={onBrief}>Copy Coop brief</button>
            {f.markedAt ? (
              <span className="muted">Being broken down since {stamp(f.markedAt, tz)} <button type="button" className="mini" onClick={() => onMark(false)}>Unmark</button></span>
            ) : (
              <button type="button" className="mini" onClick={() => onMark(true)}>Mark as being broken down</button>
            )}
          </>
        )}
        {f.kind === "block_needs_work" && (f.loopId ? <span className="muted">Loop open: ask about priorities (L)</span> : <button type="button" className="mini" onClick={onAsk}>Create loop: ask about priorities</button>)}
        {(f.kind === "needs_features" || f.kind === "no_target_date") && <WorkLink clientKey={f.clientKey} url={f.url} className="mini">Open in DevOps</WorkLink>}
      </span>
    </li>
  );
}

type SectionProps = {
  st: WeekPlanState;
  fits: ClientFit[];
  features: WeekFeature[];
  days: WeekLoadData["week"]["days"];
  nameOf: (k: string) => string;
  colors: Record<string, string>;
  open: Set<string>;
  toggleOpen: (key: string) => void;
  committed: (k: string, id: number) => WeekFeature | undefined;
  setBlocks: (k: string, item: { id: number; title: string }, blocks: number) => void;
  place: (k: string, itemId: number, date: IsoDate, half: Half, on: boolean) => void;
  onBrief: (k: string, id: number) => void;
};

function ClientSections(p: SectionProps) {
  const keys = [...new Set([...p.fits.map((f) => f.clientKey), ...p.st.portfolios.map((x) => x.clientKey)])];
  return (
    <>
      {keys.map((k) => {
        const port = p.st.portfolios.find((x) => x.clientKey === k);
        const fit = p.fits.find((f) => f.clientKey === k);
        const feats = port?.items.filter((i) => i.tier === "feature") ?? [];
        const epics = port?.items.filter((i) => i.tier === "epic") ?? [];
        // Committed features DevOps no longer lists (closed, reassigned): kept as stored so they can be taken off.
        const gone = p.features.filter((f) => f.clientKey === k && !feats.some((i) => i.id === f.itemId));
        const places = placesFor(p.days, k);
        return (
          <section key={k} className="co-section pw-client" style={{ "--c": clientColor(k, p.colors) } as CSSProperties} aria-label={p.nameOf(k)}>
            <h3>
              <span className="pw-swatch" aria-hidden="true" />
              {p.nameOf(k)} <FitChip fit={fit} />
              {port && port.status !== "ok" && <span className="muted">DevOps: {port.message ?? port.status}</span>}
              {port?.fromCache && <span className="muted">from cache</span>}
            </h3>
            {!port && <p className="muted">No DevOps for this client.</p>}
            {port && port.status === "ok" && !feats.length && !epics.length && <p className="muted">No features assigned to you or above your stories.</p>}
            {feats.length > 0 && (
              <ul className="pw-features">
                {feats.map((item) => (
                  <FeatureRow key={item.id} k={k} item={item} wf={p.committed(k, item.id)} places={places} open={p.open.has(`${k}:${item.id}`)} toggle={() => p.toggleOpen(`${k}:${item.id}`)}
                    setBlocks={(n) => p.setBlocks(k, item, n)} place={(d, h, on) => p.place(k, item.id, d, h, on)} onBrief={() => p.onBrief(k, item.id)} />
                ))}
              </ul>
            )}
            {gone.length > 0 && (
              <ul className="pw-features">
                {gone.map((f) => (
                  <li key={f.id} className="pw-feature gone">
                    <span className="pw-title"><WorkLink clientKey={k} url={f.url}>#{f.itemId} {f.title}</WorkLink> <span className="muted">no longer listed in DevOps (closed or reassigned)</span></span>
                    <span className="pw-acts"><span className="muted">{f.blocks} block{f.blocks === 1 ? "" : "s"}</span> <button type="button" className="mini" onClick={() => p.setBlocks(k, { id: f.itemId, title: f.title }, 0)}>Take off</button></span>
                  </li>
                ))}
              </ul>
            )}
            {epics.length > 0 && (
              <>
                <h4>Epics</h4>
                <ul className="pw-epics">
                  {epics.map((e) => {
                    const openKids = e.children.filter((c) => c.open).length;
                    return (
                      <li key={e.id}>
                        <WorkLink clientKey={k} url={e.url}>#{e.id} {e.title}</WorkLink> <span className="muted">{e.state} · {openKids} open of {e.children.length} feature{e.children.length === 1 ? "" : "s"}{e.targetDate ? ` · target ${dateShortIso(e.targetDate)}` : ""}</span>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </section>
        );
      })}
    </>
  );
}

const dateShortIso = (d: IsoDate) => plainDate(d).toLocaleString("en-US", { month: "short", day: "numeric" });

function FeatureRow({ k, item, wf, places, open, toggle, setBlocks, place, onBrief }: {
  k: string; item: PortfolioItem; wf: WeekFeature | undefined; places: Place[]; open: boolean; toggle: () => void;
  setBlocks: (n: number) => void; place: (d: IsoDate, h: Half, on: boolean) => void; onBrief: () => void;
}) {
  const stories = item.children.filter((c) => c.level === "story");
  const openStories = stories.filter((c) => c.open).length;
  const blocks = wf?.blocks ?? 0;
  const free = places.filter((pl) => !wf?.slots.some((s) => s.date === pl.date && s.half === pl.half));
  const why = item.why.includes("assigned") ? "assigned to you" : "parent of your story";
  return (
    <li className={`pw-feature${wf ? " committed" : ""}`} draggable onDragStart={(e) => { e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ clientKey: k, itemId: item.id })); e.dataTransfer.effectAllowed = "copy"; }}>
      <span className="pw-title">
        <WorkLink clientKey={k} url={item.url}>#{item.id} {item.title}</WorkLink>
        <span className="muted"> {item.type} · {item.state} · {why}</span>
        {item.targetDate ? <span className="muted"> · target {dateShortIso(item.targetDate)}</span> : <span className="pw-soft"> No target date</span>}
      </span>
      <button type="button" className="mini pw-kids" aria-expanded={open} onClick={toggle} disabled={!item.children.length}>
        {item.children.length ? `${openStories} open, ${stories.length - openStories} closed stor${stories.length === 1 ? "y" : "ies"}` : "No stories yet"}
      </button>
      <span className="pw-blocks" aria-label={`My blocks for #${item.id}`}>
        <button type="button" className="mini" disabled={blocks === 0} onClick={() => setBlocks(blocks - 1)} aria-label="One block fewer">−</button>
        <span className="pw-n">{blocks}</span>
        <button type="button" className="mini" disabled={blocks >= 20} onClick={() => setBlocks(blocks + 1)} aria-label="One block more">+</button>
        <span className="muted">block{blocks === 1 ? "" : "s"}</span>
      </span>
      <span className="pw-placed">
        {wf?.slots.map((s) => (
          <span key={`${s.date}${s.half}`} className="pw-chip">{placeLabel(s.date, s.half)} <button type="button" className="mini" aria-label={`Take off ${placeLabel(s.date, s.half)}`} onClick={() => place(s.date, s.half, false)}>×</button></span>
        ))}
        {free.length > 0 && (
          <select aria-label={`Place #${item.id} on a block`} value="" onChange={(e) => { const pl = free[Number(e.target.value)]; if (pl) place(pl.date, pl.half, true); }}>
            <option value="">Place on…</option>
            {free.map((pl, i) => <option key={`${pl.date}${pl.half}`} value={i}>{pl.label}</option>)}
          </select>
        )}
        {!openStories && wf && <button type="button" className="mini" onClick={onBrief}>Copy Coop brief</button>}
      </span>
      {open && (
        <ul className="pw-children">
          {item.children.map((c) => (
            <li key={c.id} className={c.open ? "" : "closed"}>
              <WorkLink clientKey={k} url={c.url}>#{c.id} {c.title}</WorkLink> <span className="muted">{c.type} · {c.state} · {c.mine ? "you" : c.assignedTo ?? "unassigned"}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function PastList({ features, fits, nameOf }: { features: WeekFeature[]; fits: ClientFit[]; nameOf: (k: string) => string }) {
  if (!features.length) return <p className="muted pw-empty">Nothing was committed for this week.</p>;
  const keys = [...new Set(features.map((f) => f.clientKey))];
  return (
    <>
      {keys.map((k) => (
        <section key={k} className="co-section pw-client" aria-label={nameOf(k)}>
          <h3>{nameOf(k)} <FitChip fit={fits.find((f) => f.clientKey === k)} /></h3>
          <ul className="pw-features">
            {features.filter((f) => f.clientKey === k).map((f) => (
              <li key={f.id} className="pw-feature committed">
                <span className="pw-title"><WorkLink clientKey={k} url={f.url}>#{f.itemId} {f.title}</WorkLink></span>
                <span className="muted">{f.blocks} block{f.blocks === 1 ? "" : "s"}{f.slots.length ? `: ${f.slots.map((s) => placeLabel(s.date, s.half)).join(", ")}` : ""}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
