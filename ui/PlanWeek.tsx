import type React from "react";
// Plan the week (step 8, by client since step 11): each followed client's week list of DevOps features and stories,
// split into Must and Nice to have, in DevOps stack rank order unless reordered here. Pins to a block are optional
// (dependencies); the block grid on top previews pins and each client's must count. Fit per client counts musts
// against that client's free blocks. DevOps health sits on top, folded to a count. DevOps is read-only; the week
// plan lives only in the local plan store. A past week is a review.
import { DraftTitle } from "./DraftEditor.tsx";
import { CreateInDevOps, DevOpsAction, useDevOpsWrite } from "./DevOpsWrite.tsx";
import { blocksStep, blocksText, weekItemMenu, type MenuStep, type WeekItemFacts, type WeekItemOps } from "./menu.ts";
import { useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type ReactElement } from "react";
import type { WeekLoadData, WeekPlanState } from "../actions/types.ts";
import { borrowedSummary } from "../plan/borrow.ts";
import type { DraftStory, WeekFeature } from "../plan/types.ts";
import { borrowedForWeek, readiness, weekFit, type ClientFit, type ReadinessFlag } from "../plan/weekplan.ts";
import { moveWithin, pickDoneFrom, pinLabel, progressLabel, weekList, type DoneBy, type Listed, type Progress, type Tier } from "../plan/weeklist.ts";
import { formatDuration } from "../week/format.ts";
import { weekFitWords } from "../plan/fit.ts";
import type { ClientWork, IsoDate, PortfolioItem, Slot, WorkItem } from "../week/types.ts";
import { call } from "./api.ts";
import { clientColor } from "./labels.ts";
import { copy } from "./FollowUps.tsx";
import { MenuCtx } from "./Menus.tsx";
import { WorkLink } from "./WorkLink.tsx";

type Props = { /** Step 15 (D268): the ritual chips, in this view's header. */ rituals?: React.ReactNode; weekStart: IsoDate; data: WeekLoadData; version: number; now: string; onWeek: (w: IsoDate) => void; onClose: () => void; onChanged: () => void; onCaptures: () => void };
type Half = "AM" | "PM";
type Place = { date: IsoDate; half: Half; label: string };
type Item = Listed<WeekFeature>;
type HeadsUp = { weekStart: IsoDate; clientKey: string; itemId: number; title: string; trigger?: "dropped" | "demoted" };

const DRAG_TYPE = "application/x-coopilot-feature";
const HALF_WORD: Record<Half, string> = { AM: "morning", PM: "afternoon" };
const plainDate = (d: IsoDate) => Temporal.PlainDate.from(d);
const weekLabel = (w: IsoDate) => plainDate(w).toLocaleString("en-US", { month: "short", day: "numeric" });
const dateShort = (d: IsoDate) => plainDate(d).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" });
const dateShortIso = (d: IsoDate) => plainDate(d).toLocaleString("en-US", { month: "short", day: "numeric" });
const placeLabel = (date: IsoDate, half: Half) => pinLabel({ date, half });
const stamp = (s: string, tz: string) => {
  const z = Temporal.ZonedDateTime.from(s).withTimeZone(tz);
  return `${z.toPlainDate().toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" })}, ${z.toPlainTime().toLocaleString("en-US", { hour: "numeric", minute: "2-digit" })}`;
};
/** Fit per client in plain words (step 11): fits, tight, too much. */
const DONE_WORD: Record<DoneBy, string> = { devops: "Done in DevOps", resolved: "Resolved in DevOps", local: "Done", pick: "Done (picked and ticked)" };
/** "room for about 1.5 blocks", to the half block (step 10: no "0.8 blocks"). */
export function roomLabel(available: number): string {
  const r = Math.round(available * 2) / 2;
  return r <= 0 ? "no free blocks" : r === 0.5 ? "room for about half a block" : `room for about ${r} ${r === 1 ? "block" : "blocks"}`;
}

/** Where a client's item can be pinned: its own blocks, or an Open half-day. */
function placesFor(days: WeekLoadData["week"]["days"], clientKey: string): Place[] {
  return days.flatMap((d) =>
    ([["AM", d.am], ["PM", d.pm]] as [Half, Slot][])
      .filter(([, s]) => !s.pto && (s.focus[0] ? s.focus[0].clientKey === clientKey : s.open))
      .map(([half, s]) => ({ date: d.date, half, label: `${placeLabel(d.date, half)}${s.focus[0] ? "" : " (Open)"}` })),
  );
}

/** What DevOps says about an item now: a feature from the portfolio read, a story from the work read. */
type Info = { type: string; state: string; feature: PortfolioItem | null; story: WorkItem | null };
function infoFor(portfolios: WeekPlanState["portfolios"], work: readonly ClientWork[] | null) {
  return (k: string, id: number): Info | null => {
    const feature = portfolios.find((p) => p.clientKey === k)?.items.find((i) => i.id === id) ?? null;
    if (feature) return { type: feature.type, state: feature.state, feature, story: null };
    const w = work?.find((x) => x.clientKey === k);
    const story = w ? ([...w.items, ...w.children, ...(w.committed ?? []), ...(w.watched ?? [])].find((i) => i.id === id) ?? null) : null;
    if (story) return { type: story.type, state: story.state, feature: null, story };
    const kid = portfolios.find((p) => p.clientKey === k)?.items.flatMap((i) => i.children).find((c) => c.id === id);
    return kid ? { type: kid.type, state: kid.state, feature: null, story: null } : null;
  };
}

export function PlanWeek({ rituals, weekStart, data, version, onWeek, onClose, onChanged, onCaptures }: Props) {
  const [st, setSt] = useState<WeekPlanState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [offer, setOffer] = useState<HeadsUp | null>(null);
  const [brief, setBrief] = useState<{ id: number; text: string } | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [dragOver, setDragOver] = useState<string | null>(null);
  // A clicked block filters the lists to its client (an Open half-day shows every client) and is where "Pin to"
  // pins. Client chips and search narrow further.
  const [sel, setSel] = useState<{ date: IsoDate; half: Half } | null>(null);
  const [only, setOnly] = useState<string | null>(null);
  const [query, setQuery] = useState("");
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
    setSel(null);
    setOffer(null);
    head.current?.focus();
  }, [weekStart]);

  const act = useCallback(
    async <T,>(action: string, input: Record<string, unknown>, done?: string): Promise<T | null> => {
      try {
        const r = await call<T>(action, input);
        await load();
        onChanged();
        if (done) setNotice(done);
        return r;
      } catch (e) {
        setError(e instanceof Error ? e.message : "That didn't work");
        return null;
      }
    },
    [load, onChanged],
  );

  const raw: WeekFeature[] = st?.plan.features ?? [];
  const work = weekReady ? data.devops : null;
  const portfolios = st?.portfolios ?? [];
  const list = useMemo(() => weekList(raw, work, portfolios, pickDoneFrom(data.plan)), [raw, work, portfolios, data.plan]);
  const items = list.items;
  // Q48: only borrowed time paid back in this week counts against its fit.
  const borrowedMinutes = useMemo(() => borrowedForWeek(data.borrowed, weekStart), [data.borrowed, weekStart]);
  const fits = useMemo(() => (weekReady ? weekFit(data.week, raw, { borrowedMinutes }) : []), [weekReady, data.week, raw, borrowedMinutes]);
  const intentions = useMemo(
    () => Object.entries(data.plan ?? {}).flatMap(([date, d]) => d.picks.filter((p) => p.kind === "intention").map((p) => ({ id: p.id, clientKey: p.clientKey, title: p.title, date, size: p.size, status: p.status }))),
    [data.plan],
  );
  const flags = useMemo(
    () =>
      st && weekReady && st.access === "plan"
        ? readiness({ week: data.week, portfolios: st.portfolios, features: raw, work: data.devops, marks: st.marks, followUps: st.followUps.map((l) => ({ id: l.id, kind: l.kind, clientKey: l.clientKey, ruleKey: `priorities:${weekStart}:${l.clientKey}`, closedAt: l.closedAt })), drafts: st.drafts, captures: st.captures, intentions })
        : [],
    [st, weekReady, data.week, data.devops, raw, weekStart, intentions],
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
  const info = infoFor(st.portfolios, work);

  // Summary strip: open follow-ups, unpaid borrowed time, PTO days and flex sessions in the week.
  const unpaid = borrowedSummary(data.borrowed, days[0]!.date, days.at(-1)!.date);
  const ptoDays = data.week.days.filter((d) => d.pto).length;
  const flexCount = data.week.days.reduce((n, d) => n + d.am.flex.length + d.pm.flex.length + (d.eve?.flex.length ?? 0), 0);

  const mustCount = (k: string) => items.filter((i) => i.clientKey === k && i.tier === "must" && !i.done).length;
  const pin = (k: string, itemId: number, date: IsoDate, half: Half, on: boolean) => void act("weekplan.place", { weekStart, clientKey: k, itemId, date, half, on });
  const dropped = (r: { headsUp: HeadsUp | null } | null) => setOffer(r?.headsUp ?? null);
  const ops: Ops = {
    add: (k, itemId, tier) => {
      // Keep the client's Add list open while adding several.
      setOpen((s) => new Set(s).add(`add:${k}`));
      void act("weekplan.add", { weekStart, clientKey: k, itemId, tier }, `#${itemId} added as ${tier === "must" ? "a must" : "a nice to have"}`);
    },
    tier: (i, tier) => void act<{ headsUp: HeadsUp | null }>("weekplan.set_tier", { id: i.id, tier }, `#${i.itemId} is now ${tier === "must" ? "a must" : "a nice to have"}`).then(dropped),
    remove: (i) => void act<{ headsUp: HeadsUp | null }>("weekplan.remove", { id: i.id }, `Took #${i.itemId} off the week`).then(dropped),
    blocks: (i, n) => void act("weekplan.set_blocks", { id: i.id, blocks: n }),
    done: (i, on) => void act("weekplan.mark_done", { id: i.id, on }, on ? `#${i.itemId} marked done` : undefined),
    move: (i, by) => {
      const group = items.filter((x) => x.clientKey === i.clientKey && x.tier === i.tier).map((x) => x.itemId);
      const order = moveWithin(group, i.itemId, group.indexOf(i.itemId) + by).map((x) => x.itemId);
      void act("weekplan.reorder", { weekStart, clientKey: i.clientKey, tier: i.tier, order });
    },
    reorderTo: (k, tier, itemId, before) => {
      const group = items.filter((x) => x.clientKey === k && x.tier === tier).map((x) => x.itemId);
      const order = moveWithin(group, itemId, group.indexOf(before)).map((x) => x.itemId);
      void act("weekplan.reorder", { weekStart, clientKey: k, tier, order });
    },
    reset: (k) => void act("weekplan.reorder", { weekStart, clientKey: k, reset: true }, `${nameOf(k)} is back in DevOps order`),
    pin,
    brief: (k, id) => void copyBrief(k, id),
  };
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
      pin(f.clientKey, f.itemId, date, half, true);
    } catch {
      /* not a week item */
    }
  };

  const commitLabel = st.plan.committedAt ? (st.plan.changed ? "Done" : "Planned ✓") : "Done";
  const keys = [...new Set([...fits.map((f) => f.clientKey), ...st.portfolios.map((x) => x.clientKey), ...items.map((i) => i.clientKey)])];

  return (
    <main className="planweek" aria-label="Plan the week">
      {rituals}
      <div className="follow-ups-head">
        <h2 ref={head} tabIndex={-1}>
          Plan the week <span className="muted">of {weekLabel(weekStart)}{isThis ? " (this week)" : weekStart === plainDate(st.thisWeek).add({ days: 7 }).toString() ? " (next week)" : past ? " (review)" : ""}</span>
        </h2>
        <span className="co-step">
          <button type="button" className="mini" onClick={() => onWeek(prev)} aria-label="Previous week" title="Previous week">‹</button>
          <button type="button" className="mini" onClick={() => onWeek(next)} aria-label="Next week" title="Next week">›</button>
        </span>
        {st.plan.committedAt ? (
          <span className={st.plan.changed ? "pw-state changed" : "co-done"}>
            {st.plan.changed ? `Changed since planned (${stamp(st.plan.committedAt, tz)})` : `Planned ${stamp(st.plan.committedAt, tz)}`}
          </span>
        ) : (
          !past && <span className="pw-state">Not planned yet</span>
        )}
        {!past && (
          <button type="button" className="top-btn" onClick={() => void load(true)} title="Read features and stories from DevOps again">
            Refresh DevOps
          </button>
        )}
        {!past && (
          <button type="button" className="top-btn primary" disabled={!!st.plan.committedAt && !st.plan.changed} onClick={() => void act("weekplan.commit", { weekStart }, "Week committed")}>
            {commitLabel}
          </button>
        )}
        <button type="button" className="top-btn" onClick={onClose} title="Back (Esc)">
          Back
        </button>
      </div>
      {error && <p className="set-problem" role="alert">{error} <button type="button" className="mini" onClick={() => setError(null)}>Dismiss</button></p>}
      {offer ? (
        <p className="co-notice pw-offer" role="status">
          #{offer.itemId} is out of the musts. Let {nameOf(offer.clientKey)} know?{" "}
          <button type="button" className="mini" onClick={() => void act("weekplan.headsup", offer, `Follow-up opened: heads-up to ${nameOf(offer.clientKey)}`).then(() => setOffer(null))}>Open a heads-up follow-up</button>{" "}
          <button type="button" className="mini quiet" onClick={() => setOffer(null)}>Not needed</button>
        </p>
      ) : (
        notice && <p className="co-notice" role="status">{notice}</p>
      )}

      {/* Only what is there; nothing when the week has none of it. */}
      {(data.openFollowUps > 0 || unpaid.unpaidMinutes > 0 || ptoDays > 0 || flexCount > 0 || past) && (
        <ul className="pw-summary" aria-label="The week at a glance">
          {data.openFollowUps > 0 && <li>{data.openFollowUps} open follow-up{data.openFollowUps === 1 ? "" : "s"}</li>}
          {unpaid.unpaidMinutes > 0 && <li>{formatDuration(unpaid.unpaidMinutes)} borrowed time to make up</li>}
          {ptoDays > 0 && <li>{ptoDays} day{ptoDays === 1 ? "" : "s"} off</li>}
          {flexCount > 0 && <li>{flexCount} flex session{flexCount === 1 ? "" : "s"}</li>}
          {past && <li>Past week: a review, nothing changes</li>}
        </ul>
      )}

      {!past && (
        <details className="co-section pw-readiness" aria-label="DevOps health">
          <summary><h3>DevOps health <span className="muted">{flags.length ? `${flags.length} to look at` : "all good"}</span></h3></summary>
          {flags.length > 0 && (
            <ul className="pw-ready">
              {flags.map((f) => (
                <ReadyRow key={`${f.kind}:${f.clientKey}:${f.itemId ?? f.pickId ?? ""}`} f={f} clientName={nameOf(f.clientKey)} tz={tz} drafts={f.itemId ? st.drafts.filter((d) => d.clientKey === f.clientKey && d.parentItemId === f.itemId) : []}
                  onBrief={() => void copyBrief(f.clientKey, f.itemId!)}
                  onMark={(on) => void act("feature.mark_breakdown", { clientKey: f.clientKey, itemId: f.itemId, on }, on ? `#${f.itemId} marked as being broken down` : undefined)}
                  onAsk={() => void act("followup.ask_priorities", { weekStart, clientKey: f.clientKey }, `Follow-up opened: ask ${nameOf(f.clientKey)} about priorities`)}
                  onDraft={() => void act("draft.add_story", { clientKey: f.clientKey, parentItemId: null, title: f.title, size: f.size ?? "M" }, `Draft story saved: ${f.title}. Add it in DevOps when you can`)}
                  onDraftFeature={(title) => act("draft.add_feature", { clientKey: f.clientKey, parentItemId: f.itemId, title }, `Draft feature saved under #${f.itemId}: ${title}. Add it in DevOps when you can`).then((r) => r !== null)}
                  onCaptures={onCaptures} />
              ))}
            </ul>
          )}
        </details>
      )}
      {brief && (
        <section className="co-section pw-brief" aria-label="Coop brief">
          <h3>Coop brief <span className="muted">#{brief.id}</span> <button type="button" className="mini" onClick={() => setBrief(null)}>Hide</button></h3>
          <textarea ref={briefArea} readOnly value={brief.text} rows={10} />
        </section>
      )}

      <div className="pw-layout">
      <section className="co-section pw-board-wrap" aria-label="The week's blocks">
        <h3>Blocks <span className="muted">{past ? "What was pinned" : "Click a block to see its client's list. Drag an item onto a block to pin it there (optional)"}</span></h3>
        {keys.length > 0 && (
          <ul className="pw-musts" aria-label="Musts per client">
            {keys.map((k) => {
              const f = fits.find((x) => x.clientKey === k);
              const n = mustCount(k);
              return (
                <li key={k} style={{ "--c": clientColor(k, data.clients) } as CSSProperties}>
                  <span className="pw-swatch" aria-hidden="true" /> {nameOf(k)} <strong>{n}</strong> must{n === 1 ? "" : "s"} left
                  {f && f.verdict !== "none" && <span className={`pw-fit2 ${weekFitWords(f).kind}`}>{weekFitWords(f).text}</span>}
                </li>
              );
            })}
          </ul>
        )}
        <div className="pw-board" style={{ gridTemplateColumns: `auto repeat(${days.length}, minmax(0, 1fr))` }}>
          <span />
          {days.map((d) => <span key={d.date} className="pw-day">{dateShort(d.date)}</span>)}
          {(["AM", "PM"] as Half[]).map((half) => [
            <span key={half} className="pw-half">{half}</span>,
            ...days.map((d) => {
              const s = half === "AM" ? d.am : d.pm;
              const key = `${d.date}${half}`;
              const here = items.filter((f) => f.slots.some((x) => x.date === d.date && x.half === half));
              const target = !past && !s.pto && (!!s.focus[0] || s.open);
              const c = s.focus[0];
              const picked = sel?.date === d.date && sel.half === half;
              const choose = () => setSel(picked ? null : { date: d.date, half });
              const musts = c ? mustCount(c.clientKey) : 0;
              return (
                <div key={key} className={`pw-cell${c ? " block" : s.open ? " open" : " none"}${dragOver === key ? " over" : ""}${picked ? " picked" : ""}${target ? " can" : ""}`}
                  style={{ "--c": clientColor(c?.clientKey, data.clients) } as CSSProperties}
                  role={target ? "button" : undefined} tabIndex={target ? 0 : undefined} aria-pressed={target ? picked : undefined}
                  onClick={target ? (e) => { if (!(e.target as HTMLElement).closest("button")) choose(); } : undefined}
                  onKeyDown={target ? (e) => { if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) { e.preventDefault(); choose(); } } : undefined}
                  onDragOver={target ? (e) => { if (e.dataTransfer.types.includes(DRAG_TYPE)) { e.preventDefault(); setDragOver(key); } } : undefined}
                  onDragLeave={target ? () => setDragOver(null) : undefined}
                  onDrop={target ? (e) => onDrop(e, d.date, half, s) : undefined}
                  aria-label={`${dateShort(d.date)} ${HALF_WORD[half]}: ${s.pto ? "Day off" : c ? `${c.clientName}, ${musts} must${musts === 1 ? "" : "s"} left this week` : s.open ? "Open" : "no block"}${here.length ? `, pinned ${here.map((f) => `#${f.itemId}`).join(", ")}` : ""}`}>
                  <span className="pw-who">{s.pto ? "Day off" : c ? c.clientName : s.open ? "Open" : "No block"}</span>
                  {here.map((f) => (
                    <span key={f.id} className={`pw-chip${f.done ? " done" : ""}`} title={`Pinned: ${f.title}`}>
                      #{f.itemId} {f.title}
                      {!past && <button type="button" className="mini" aria-label={`Unpin #${f.itemId} from ${placeLabel(d.date, half)}`} onClick={() => pin(f.clientKey, f.itemId, d.date, half, false)}>×</button>}
                    </span>
                  ))}
                </div>
              );
            }),
          ])}
        </div>
      </section>

      <div className="pw-side">
        <ClientLists st={st} past={past} keys={keys} items={items} progress={list.progress} fits={fits} days={days} info={info} work={work} nameOf={nameOf} colors={data.clients}
          open={open} toggleOpen={toggleOpen} ops={ops} sel={sel} clearSel={() => setSel(null)} only={only} setOnly={setOnly} query={query} setQuery={setQuery}
          />
      </div>
      </div>
    </main>
  );
}

function FitChip({ fit }: { fit: ClientFit | undefined }) {
  if (!fit) return null;
  const w = weekFitWords(fit);
  const borrowed = fit.borrowedMinutes ? `, after ${formatDuration(fit.borrowedMinutes)} borrowed` : "";
  return (
    <span className={`pw-fit2 ${w.kind}`} title={`Musts need ${fit.committedBlocks} of about ${fit.availableBlocks} free blocks (free time after time off, meetings and unavailable time${borrowed}). Nice to haves don't count.`}>
      {w.text}
    </span>
  );
}

const KIND: Record<ReadinessFlag["kind"], string> = {
  block_needs_work: "Block with no work",
  needs_breakdown: "Feature with no stories",
  no_target_date: "Must with no target date",
  intention_not_in_devops: "Not in DevOps yet",
  needs_features: "Epic needs features",
  captures_to_sort: "Captures to sort",
};

function ReadyRow({ f, clientName, tz, drafts, onBrief, onMark, onAsk, onDraft, onDraftFeature, onCaptures }: { f: ReadinessFlag; clientName: string; tz: string; drafts: DraftStory[]; onBrief: () => void; onMark: (on: boolean) => void; onAsk: () => void; onDraft: () => void; onDraftFeature: (title: string) => Promise<boolean>; onCaptures: () => void }) {
  const [drafting, setDrafting] = useState(false);
  const [title, setTitle] = useState("");
  return (
    <li className={`pw-flag${f.soft ? " soft" : ""}`}>
      <span className="pw-kind">{KIND[f.kind]}</span>
      <span className="pw-flag-what">
        {f.kind !== "captures_to_sort" && <><span className="muted">{clientName}</span>{" "}</>}
        {f.kind === "captures_to_sort" ? (
          `${f.title}: some may be draft stories for these features`
        ) : f.kind === "block_needs_work" ? (
          `${f.blocks} block${f.blocks === 1 ? "" : "s"}, nothing open is assigned to you`
        ) : f.kind === "intention_not_in_devops" ? (
          <>{f.title}{f.date && <span className="muted"> · typed for {dateShort(f.date)}</span>}</>
        ) : (
          <>
            <WorkLink clientKey={f.clientKey} url={f.url}>#{f.itemId} {f.title}</WorkLink>
            {!!f.drafts && f.kind === "needs_features" && <span className="muted"> · {f.drafts} local draft feature{f.drafts === 1 ? "" : "s"} to add in DevOps</span>}
            {!!f.drafts && f.kind !== "needs_features" && <span className="muted"> · {f.drafts} local draft stor{f.drafts === 1 ? "y" : "ies"} to add in DevOps</span>}
          </>
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
        {f.kind === "intention_not_in_devops" && <button type="button" className="mini" onClick={onDraft}>Make it a draft story</button>}
        {f.kind === "captures_to_sort" && <button type="button" className="mini" onClick={onCaptures}>Sort captures</button>}
        {f.kind === "block_needs_work" && (f.followUpId ? <span className="muted">Follow-up open: ask about priorities (L)</span> : <button type="button" className="mini" onClick={onAsk}>Create follow-up: ask about priorities</button>)}
        {f.kind === "needs_features" &&
          (drafting ? (
            <form className="pw-draft-feature" onSubmit={(e) => { e.preventDefault(); if (title.trim()) void onDraftFeature(title.trim()).then((ok) => ok && (setDrafting(false), setTitle(""))); }}>
              <input autoFocus value={title} maxLength={200} placeholder="Feature title" aria-label={`Draft feature under #${f.itemId}`} onChange={(e) => setTitle(e.target.value)} />
              <button type="submit" className="mini primary" disabled={!title.trim()}>Save draft</button>
              <button type="button" className="mini" onClick={() => setDrafting(false)}>Cancel</button>
            </form>
          ) : (
            <button type="button" className="mini" onClick={() => setDrafting(true)}>Draft a feature</button>
          ))}
        {/* Step 14: drafted stories (or features) under it go to DevOps in one combined preview; a target date is set there. */}
        {(f.kind === "needs_breakdown" || f.kind === "needs_features") && drafts.length > 0 && (
          <CreateInDevOps drafts={drafts.slice(0, 10)} label={`Create ${drafts.length === 1 ? "the drafted" : `${Math.min(10, drafts.length)} drafted`} ${f.kind === "needs_features" ? (drafts.length === 1 ? "feature" : "features") : drafts.length === 1 ? "story" : "stories"} in DevOps`} />
        )}
        {f.kind === "no_target_date" && f.itemId && <DevOpsAction clientKey={f.clientKey} label="Set target date" onRun={(w) => w.targetDate({ clientKey: f.clientKey, itemId: f.itemId!, title: f.title, current: null })} />}
        {(f.kind === "needs_features" || f.kind === "no_target_date") && <WorkLink clientKey={f.clientKey} url={f.url} className="mini">Open in DevOps</WorkLink>}
      </span>
    </li>
  );
}

type Ops = {
  add: (k: string, itemId: number, tier: Tier) => void;
  tier: (i: Item, tier: Tier) => void;
  remove: (i: Item) => void;
  blocks: (i: Item, n: number) => void;
  done: (i: Item, on: boolean) => void;
  move: (i: Item, by: -1 | 1) => void;
  /** Drag within a list: put `itemId` where `before` is. */
  reorderTo: (k: string, tier: Tier, itemId: number, before: number) => void;
  reset: (k: string) => void;
  pin: (k: string, itemId: number, date: IsoDate, half: Half, on: boolean) => void;
  brief: (k: string, id: number) => void;
};
type ListsProps = {
  st: WeekPlanState;
  past: boolean;
  keys: string[];
  items: Item[];
  progress: Progress[];
  fits: ClientFit[];
  days: WeekLoadData["week"]["days"];
  info: (k: string, id: number) => Info | null;
  work: readonly ClientWork[] | null;
  nameOf: (k: string) => string;
  colors: Record<string, string>;
  open: Set<string>;
  toggleOpen: (key: string) => void;
  ops: Ops;
  sel: { date: IsoDate; half: Half } | null;
  clearSel: () => void;
  only: string | null;
  setOnly: (k: string | null) => void;
  query: string;
  setQuery: (q: string) => void;
};

/** Each client's week list with its filters (clicked block, client chips, search). */
function ClientLists(p: ListsProps) {
  const slot = p.sel ? p.days.find((d) => d.date === p.sel!.date)?.[p.sel.half === "AM" ? "am" : "pm"] : undefined;
  const blockClient = slot?.focus[0]?.clientKey ?? null;
  const keys = p.keys.filter((k) => (blockClient ? k === blockClient : true) && (p.only && !blockClient ? k === p.only : true));
  if (p.past && !p.items.length) return <p className="muted pw-empty">Nothing was planned for this week.</p>;
  return (
    <>
      <div className="pw-filter" role="group" aria-label="Filter the lists">
        {p.sel && (
          <span className="pw-target">
            {slot?.focus[0] ? `${placeLabel(p.sel.date, p.sel.half)}: ${slot.focus[0].clientName}` : `${placeLabel(p.sel.date, p.sel.half)}: Open, any client`}
            <button type="button" className="mini" onClick={p.clearSel} aria-label="Show every client">×</button>
          </span>
        )}
        {!blockClient && p.keys.length > 1 && (
          <span className="pw-chips">
            <button type="button" className="chip-btn" aria-pressed={!p.only} onClick={() => p.setOnly(null)}>All</button>
            {p.keys.map((k) => (
              <button key={k} type="button" className="chip-btn" aria-pressed={p.only === k} style={{ "--c": clientColor(k, p.colors) } as CSSProperties} onClick={() => p.setOnly(p.only === k ? null : k)}>
                <span className="swatch" />{p.nameOf(k)}
              </button>
            ))}
          </span>
        )}
        <input type="search" className="pw-search" value={p.query} onChange={(e) => p.setQuery(e.target.value)} placeholder="Search" aria-label="Search the lists by title or number" />
      </div>
      {keys.map((k) => <ClientList key={k} k={k} {...p} />)}
    </>
  );
}

/** The block a pin would go on, when the clicked block can take this client's work. */
function targetFor(p: Pick<ListsProps, "sel" | "days">, clientKey: string): Place | null {
  if (!p.sel) return null;
  return placesFor(p.days, clientKey).find((pl) => pl.date === p.sel!.date && pl.half === p.sel!.half) ?? null;
}

function ClientList(p: ListsProps & { k: string }) {
  const { k } = p;
  const q = p.query.trim().toLowerCase();
  const match = (i: { id: number; title: string }) => !q || i.title.toLowerCase().includes(q) || String(i.id).includes(q.replace(/^#/, ""));
  const port = p.st.portfolios.find((x) => x.clientKey === k);
  const w = p.work?.find((x) => x.clientKey === k);
  const fit = p.fits.find((f) => f.clientKey === k);
  const prog = p.progress.find((x) => x.clientKey === k);
  const mine = p.items.filter((i) => i.clientKey === k && match({ id: i.itemId, title: i.title }));
  const musts = mine.filter((i) => i.tier === "must");
  const nice = mine.filter((i) => i.tier === "nice");
  const places = placesFor(p.days, k);
  const target = targetFor(p, k);
  const listed = new Set(p.items.filter((i) => i.clientKey === k).map((i) => i.itemId));
  // What can go on the list, in DevOps order: features (portfolio read), then my stories (work read).
  const features = (port?.items ?? []).filter((i) => i.tier === "feature" && !listed.has(i.id) && match(i));
  const stories = (w?.items ?? []).filter((i) => i.level === "story" && !listed.has(i.id) && match(i));
  // Q64: open stories under the client's features (any assignee), not already offered above, grouped by feature.
  const offered = new Set(stories.map((x) => x.id));
  const under = (port?.items ?? [])
    .filter((f) => f.tier === "feature")
    .map((f) => ({ f, kids: f.children.filter((c) => c.level === "story" && c.open && !listed.has(c.id) && !offered.has(c.id) && match(c)) }))
    .filter((g) => g.kids.length);
  // Q66: draft stories with no feature yet, listed under their client.
  const loose = p.st.drafts.filter((d) => d.clientKey === k && d.parentItemId === null && (!q || d.title.toLowerCase().includes(q)));
  const epics = (port?.items ?? []).filter((i) => i.tier === "epic" && match(i));
  const reordered = p.items.some((i) => i.clientKey === k && i.position !== null);
  // Open when the client's list is empty, or when opened.
  const emptyList = !p.items.some((i) => i.clientKey === k);
  const addOpen = emptyList || p.open.has(`add:${k}`);
  const row = (i: Item, n: number, group: Item[]) => (
    <ItemRow key={i.id} i={i} first={n === 0} last={n === group.length - 1} past={p.past} info={p.info(k, i.itemId)} drafts={p.st.drafts.filter((d) => d.clientKey === k && d.parentItemId === i.itemId)}
      places={places} target={target} open={p.open.has(`${k}:${i.itemId}`)} toggle={() => p.toggleOpen(`${k}:${i.itemId}`)} ops={p.ops} />
  );
  return (
    <section className="co-section pw-client" style={{ "--c": clientColor(k, p.colors) } as CSSProperties} aria-label={p.nameOf(k)}>
      <h3>
        <span className="pw-swatch" aria-hidden="true" />
        {p.nameOf(k)} <FitChip fit={fit} />
        {prog && prog.musts > 0 && <span className="pw-progress">{progressLabel(prog)}</span>}
        {port && port.status !== "ok" && <span className="muted">DevOps: {port.message ?? port.status}</span>}
        {port?.fromCache && <span className="muted">from cache</span>}
      </h3>
      <TierList title="Must" hint="Finish this week, or at least start" list={musts} row={row} empty={p.past ? "No musts" : "No musts yet. Add from DevOps below, or make a nice to have a must."} />
      <TierList title="Nice to have" hint="If there's room" list={nice} row={row} empty={null} />
      {loose.length > 0 && (
        <div className="pw-tier pw-loose">
          <h4>Draft stories <span className="muted">Not in DevOps yet; add them there to plan them</span></h4>
          <ul className="pw-drafts">
            {loose.map((d) => (
              <li key={d.id}><span className="pw-draft-tag">Draft</span> <DraftTitle draft={d} /> <span className="muted">{d.size}</span> <CreateInDevOps drafts={[d]} /></li>
            ))}
          </ul>
        </div>
      )}
      {!p.past && reordered && (
        <button type="button" className="mini quiet pw-reset" onClick={() => p.ops.reset(k)} title="Your order here is local; DevOps isn't changed">Back to DevOps order</button>
      )}
      {!p.past && (
        <div className="pw-add">
          {emptyList ? (
            <h4>Add from DevOps <span className="muted">{features.length + stories.length} of yours</span></h4>
          ) : (
            <button type="button" className="mini quiet pw-add-toggle" aria-expanded={addOpen} onClick={() => p.toggleOpen(`add:${k}`)}>
              {addOpen ? "▾" : "▸"} Add from DevOps <span className="muted">{features.length + stories.length + under.reduce((n, g) => n + g.kids.length, 0)} not on the list</span>
            </button>
          )}
          {addOpen && (
          <>
          {!port && !w && <p className="muted">No DevOps for this client.</p>}
          {(port?.status === "ok" || w?.status === "ok") && !features.length && !stories.length && (
            <p className="muted">{emptyList && !q ? `Nothing in DevOps is assigned to you for ${p.nameOf(k)}.` : q ? "Nothing matches." : "Everything assigned to you is on the list."}</p>
          )}
          <ul className="pw-features">
            {features.map((f) => <AddRow key={f.id} k={k} id={f.id} title={f.title} url={f.url} what={`${f.type} · ${f.state}${f.targetDate ? ` · target ${dateShortIso(f.targetDate)}` : ""}`} ops={p.ops} />)}
            {stories.map((s) => <AddRow key={s.id} k={k} id={s.id} title={s.title} url={s.url} what={`${s.type} · ${s.state}`} ops={p.ops} />)}
          </ul>
          {under.map((g) => (
            <div key={g.f.id} className="pw-under">
              <h4>Stories under #{g.f.id} {g.f.title}</h4>
              <ul className="pw-features">
                {g.kids.map((c) => <AddRow key={c.id} k={k} id={c.id} title={c.title} url={c.url} what={`${c.type} · ${c.state} · ${c.mine ? "you" : c.assignedTo ?? "unassigned"}`} ops={p.ops} />)}
              </ul>
            </div>
          ))}
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
          </>
          )}
        </div>
      )}
    </section>
  );
}

function TierList({ title, hint, list, row, empty }: { title: string; hint: string; list: Item[]; row: (i: Item, n: number, group: Item[]) => ReactElement; empty: string | null }) {
  if (!list.length && !empty) return null;
  return (
    <div className="pw-tier">
      <h4>{title} <span className="muted">{hint}</span></h4>
      {list.length ? <ul className="pw-features">{list.map((i, n) => row(i, n, list))}</ul> : <p className="muted">{empty}</p>}
    </div>
  );
}

function AddRow({ k, id, title, url, what, ops }: { k: string; id: number; title: string; url: string; what: string; ops: Ops }) {
  return (
    <li className="pw-feature pw-addrow">
      <span className="pw-title"><WorkLink clientKey={k} url={url}>#{id} {title}</WorkLink> <span className="muted">{what}</span></span>
      <span className="pw-acts">
        <button type="button" className="mini" onClick={() => ops.add(k, id, "must")}>+ Must</button>
        <button type="button" className="mini quiet" onClick={() => ops.add(k, id, "nice")}>+ Nice to have</button>
      </span>
    </li>
  );
}

function ItemRow({ i, first, last, past, info, drafts, places, open, toggle, ops }: {
  i: Item; first: boolean; last: boolean; past: boolean; info: Info | null; drafts: DraftStory[]; places: Place[]; target: Place | null; open: boolean; toggle: () => void; ops: Ops;
}) {
  const k = i.clientKey;
  const feature = info?.feature ?? null;
  const stories = feature ? feature.children.filter((c) => c.level === "story") : [];
  const openStories = stories.filter((c) => c.open).length;
  const other: Tier = i.tier === "must" ? "nice" : "must";
  const { env, open: openMenu } = useContext(MenuCtx);
  const dw = useDevOpsWrite();
  const facts: WeekItemFacts = {
    itemId: i.itemId, title: i.title, tier: i.tier, level: i.level, first, last, past, done: i.done ? (i.done === "local" ? "local" : "other") : null, blocks: i.blocks,
    places: places.map((pl) => ({ date: pl.date, half: pl.half, label: pl.label })), pinned: i.slots, openStories, targetDate: feature?.targetDate ?? null, drafts: drafts.length, canWrite: !!dw?.can(k),
  };
  const wops: WeekItemOps = {
    move: (by) => ops.move(i, by),
    tier: () => ops.tier(i, other),
    pin: (date, half, on) => ops.pin(k, i.itemId, date, half, on),
    blocks: (n) => ops.blocks(i, n),
    done: (on) => ops.done(i, on),
    help: () => env?.openHelp({ clientKey: k, title: `#${i.itemId} ${i.title}`, url: i.url, itemId: i.itemId, pinned: i.slots[0]?.date ?? null }),
    targetDate: () => dw?.targetDate({ clientKey: k, itemId: i.itemId, title: i.title, current: feature?.targetDate ?? null }),
    brief: () => ops.brief(k, i.itemId),
    createDrafts: () => dw?.create(k, drafts.slice(0, 10)),
    enableWrites: () => dw?.enable(k),
    remove: () => ops.remove(i),
  };
  const show = (e: React.MouseEvent, step: MenuStep) => {
    e.preventDefault();
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    openMenu(e.type === "click" ? { x: r.right, y: r.bottom + 4 } : { x: e.clientX, y: e.clientY }, step);
  };
  return (
    <li
      className={`pw-feature pw-item pw-row${i.done ? " done" : ""}`}
      draggable={!past}
      onContextMenu={(e) => show(e, weekItemMenu(facts, wops))}
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ clientKey: k, itemId: i.itemId, tier: i.tier }));
        e.dataTransfer.effectAllowed = "copyMove";
      }}
      onDragOver={(e) => !past && e.dataTransfer.types.includes(DRAG_TYPE) && e.preventDefault()}
      onDrop={(e) => {
        try {
          const f = JSON.parse(e.dataTransfer.getData(DRAG_TYPE)) as { clientKey: string; itemId: number; tier: Tier };
          if (f.clientKey !== k || f.tier !== i.tier || f.itemId === i.itemId) return;
          e.preventDefault();
          e.stopPropagation();
          ops.reorderTo(k, i.tier, f.itemId, i.itemId);
        } catch {
          /* not a week item */
        }
      }}
    >
      <span className="pw-title">
        <WorkLink clientKey={k} url={i.url}>{i.title}</WorkLink>
        <span className="pw-state">{info ? info.state : "not in this DevOps read"}</span>
        {i.done && <span className="pw-done">{DONE_WORD[i.done]}</span>}
      </span>
      {i.level === "feature" ? (
        <button type="button" className="pw-chip-btn" aria-expanded={open} onClick={toggle} disabled={!stories.length && !drafts.length} title={stories.length || drafts.length ? "Show its stories and drafts" : "No stories yet: Copy Coop brief is in ⋯"}>
          {stories.length ? `${openStories} of ${stories.length} stor${stories.length === 1 ? "y" : "ies"} open` : "No stories yet"}
          {drafts.length > 0 && ` · ${drafts.length} draft${drafts.length === 1 ? "" : "s"}`}
        </button>
      ) : (
        <span className="pw-chip-static">Story</span>
      )}
      <button type="button" className="pw-chip-btn" disabled={past} onClick={(e) => show(e, blocksStep(facts, wops))} title="How many of this client's blocks it needs">
        {blocksText(i.blocks)}
      </button>
      {i.slots.length > 0 && <span className="pw-pin" title="Pinned to this block">{i.slots.map(pinLabel).join(", ")}</span>}
      {env && (
        <button type="button" className="more" aria-label={`More for ${i.title}`} onClick={(e) => show(e, weekItemMenu(facts, wops))}>
          ⋯
        </button>
      )}
      {open && (feature || drafts.length > 0) && (
        <ul className="pw-children">
          {(feature?.children ?? []).map((c) => (
            <li key={c.id} className={c.open ? "" : "closed"}>
              <WorkLink clientKey={k} url={c.url}>{c.title}</WorkLink> <span className="muted">{c.state} · {c.mine ? "you" : c.assignedTo ?? "unassigned"}</span>
            </li>
          ))}
          {drafts.map((d) => (
            <li key={`d${d.id}`} className="pw-draft-child">
              <span className="pw-draft-tag">Draft</span> <DraftTitle draft={d} /> <span className="muted">{d.size} · not in DevOps yet</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
