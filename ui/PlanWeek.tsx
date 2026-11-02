import { ModeArea } from "./ModeSwitch.tsx";
import { planWeekParts } from "./nav.ts";
import { mondayOf } from "../week/dates.ts";
import type React from "react";
// Plan the week (step 8, by client since step 11): each followed client's week list of DevOps features and stories,
// split into Must and Nice to have, in DevOps stack rank order unless reordered here. Pins to a block are optional
// (dependencies). U4 (D391 to D395): one strip of block chips replaces the block grid (drag a row onto a chip to pin
// it); one card per client with its blocks and fit said once, musts with a visible drag handle and their story count
// or "Needs stories", one amber line when musts need more blocks than there are, nice to haves folded to a count, and
// Add from DevOps open with its first rows. DevOps health, a feature and a client's budget open in the shared detail
// panel. DevOps is read-only; the week plan lives only in the local plan store. A past week is a review.
import { DraftTitle } from "./DraftEditor.tsx";
import { CreateInDevOps, DevOpsAction, useDevOpsWrite } from "./DevOpsWrite.tsx";
import { blocksStep, blocksText, storySizeStep, weekItemMenu, type MenuStep, type WeekItemFacts, type WeekItemOps } from "./menu.ts";
import { useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from "react";
import type { WeekLoadData, WeekPlanState } from "../actions/types.ts";
import type { DraftStory, WeekFeature } from "../plan/types.ts";
import { borrowedForWeek, readiness, weekBudget, type ClientBudget, type ReadinessFlag } from "../plan/weekplan.ts";
import { estimate, fillWords, overLine, progressWords, type Envelope } from "../plan/estimate.ts";
import { moveWithin, pickDoneFrom, pinLabel, progressLabel, weekList, type DoneBy, type Listed, type Progress, type Tier } from "../plan/weeklist.ts";
import type { ClientWork, IsoDate, PortfolioItem, Slot, WorkItem } from "../week/types.ts";
import { call } from "./api.ts";
import { clientColor } from "./labels.ts";
import { copy } from "./FollowUps.tsx";
import { MenuCtx } from "./Menus.tsx";
import { WorkLink } from "./WorkLink.tsx";
import { DraftStories, PanelShell } from "./DetailPanel.tsx";

type Props = { /** Step 16.2: the Week tab's mode switch, at the right of this view's header. */ switcher?: React.ReactNode; weekStart: IsoDate; data: WeekLoadData; version: number; now: string; onWeek: (w: IsoDate) => void; onClose: () => void; onChanged: () => void; onCaptures: () => void };
type Half = "AM" | "PM";
type Place = { date: IsoDate; half: Half; label: string };
type Item = Listed<WeekFeature>;
type HeadsUp = { weekStart: IsoDate; clientKey: string; itemId: number; title: string; trigger?: "dropped" | "demoted" };

const DRAG_TYPE = "application/x-coopilot-feature";
const HALF_WORD: Record<Half, string> = { AM: "morning", PM: "afternoon" };
const plainDate = (d: IsoDate) => Temporal.PlainDate.from(d);
const dateShort = (d: IsoDate) => plainDate(d).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" });
const dateShortIso = (d: IsoDate) => plainDate(d).toLocaleString("en-US", { month: "short", day: "numeric" });
const placeLabel = (date: IsoDate, half: Half) => pinLabel({ date, half });
const stamp = (s: string, tz: string) => {
  const z = Temporal.ZonedDateTime.from(s).withTimeZone(tz);
  return `${z.toPlainDate().toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" })}, ${z.toPlainTime().toLocaleString("en-US", { hour: "numeric", minute: "2-digit" })}`;
};
/** Fit per client in plain words (step 11): fits, tight, too much. */
const DONE_WORD: Record<DoneBy, string> = { devops: "Done in DevOps", resolved: "Resolved in DevOps", local: "Done", pick: "Done (picked and ticked)" };

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

type PanelSel = { kind: "feature"; k: string; itemId: number } | { kind: "client"; k: string } | { kind: "health" } | null;

export function PlanWeek({ switcher, weekStart, data, version, onWeek, onClose, onChanged, onCaptures }: Props) {
  const [st, setSt] = useState<WeekPlanState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [offer, setOffer] = useState<HeadsUp | null>(null);
  const [brief, setBrief] = useState<{ id: number; text: string } | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [dragOver, setDragOver] = useState<string | null>(null);
  // U4: while a row is dragged, the blocks strip grows so a chip is an easy target.
  const [dragging, setDragging] = useState(false);
  const [panel, setPanel] = useState<PanelSel>(null);
  const [only, setOnly] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const head = useRef<HTMLHeadingElement>(null);
  const briefArea = useRef<HTMLTextAreaElement>(null);
  const { open: openMenu } = useContext(MenuCtx);
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
    setPanel(null);
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
  const fits = useMemo(() => (weekReady ? weekBudget(data.week, raw, { borrowedMinutes }) : []), [weekReady, data.week, raw, borrowedMinutes]);
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

  const parts = planWeekParts(weekStart, st?.thisWeek ?? mondayOf(data.planDay.date));
  if (!st || !weekReady)
    return (
      <main className="planweek" aria-label="Plan the week">
        <div className="follow-ups-head pw-head">
          <h2 tabIndex={-1}>{parts.title}</h2>
          <ModeArea>{switcher}</ModeArea>
        </div>
        {error ? <p className="set-problem">{error}</p> : <p className="muted">Loading…</p>}
      </main>
    );

  const past = st.access === "past";
  const names = new Map<string, string>([...data.planClients.map((c) => [c.clientKey, c.clientName] as const), ...st.portfolios.map((p) => [p.clientKey, p.clientName] as const), ...fits.map((f) => [f.clientKey, f.clientName] as const)]);
  const nameOf = (k: string) => names.get(k) ?? k;
  const prev = plainDate(weekStart).subtract({ days: 7 }).toString();
  const next = plainDate(weekStart).add({ days: 7 }).toString();
  const days = data.week.days.filter((d) => d.kind !== "weekend");
  const info = infoFor(st.portfolios, work);
  const friday = days.some((d) => d.kind === "overflow" && !d.pto);

  const pin = (k: string, itemId: number, date: IsoDate, half: Half, on: boolean) => void act("weekplan.place", { weekStart, clientKey: k, itemId, date, half, on });
  const dropped = (r: { headsUp: HeadsUp | null } | null) => setOffer(r?.headsUp ?? null);
  const ops: Ops = {
    add: (k, itemId, tier) => void act("weekplan.add", { weekStart, clientKey: k, itemId, tier }, `#${itemId} added as ${tier === "must" ? "a must" : "a nice to have"}`),
    tier: (i, tier) => void act<{ headsUp: HeadsUp | null }>("weekplan.set_tier", { id: i.id, tier }, `#${i.itemId} is now ${tier === "must" ? "a must" : "a nice to have"}`).then(dropped),
    remove: (i) => void act<{ headsUp: HeadsUp | null }>("weekplan.remove", { id: i.id }, `Took #${i.itemId} off the week`).then(dropped),
    blocks: (i, n) => void act("weekplan.set_blocks", { id: i.id, blocks: n }),
    size: (i, z) => void act("weekplan.set_size", { id: i.id, size: z }),
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
    dragging: setDragging,
    feature: (k, itemId) => setPanel({ kind: "feature", k, itemId }),
    client: (k) => setPanel({ kind: "client", k }),
  };
  const copyBrief = async (k: string, id: number) => {
    try {
      const r = await call<{ markdown: string; descriptionRead: boolean }>("feature.brief", { weekStart, clientKey: k, itemId: id });
      setBrief({ id, text: r.markdown });
      // The text box renders first so the fallback can select it.
      await new Promise((res) => setTimeout(res, 0));
      const ok = await copy(r.markdown, briefArea.current);
      setNotice(ok ? `Coop brief for #${id} copied${r.descriptionRead ? "" : " (the description couldn't be read)"}` : "Copy didn't work: the brief is selected below, press Ctrl+C");
      if (ok) setBrief(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not build the brief");
    }
  };
  const toggleOpen = (key: string) => setOpen((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  const onDrop = (e: DragEvent, date: IsoDate, half: Half, slot: Slot) => {
    e.preventDefault();
    setDragOver(null);
    setDragging(false);
    try {
      const f = JSON.parse(e.dataTransfer.getData(DRAG_TYPE)) as { clientKey: string; itemId: number };
      if (slot.focus[0] && slot.focus[0].clientKey !== f.clientKey) return setError(`That block is ${slot.focus[0].clientName}'s`);
      pin(f.clientKey, f.itemId, date, half, true);
    } catch {
      /* not a week item */
    }
  };

  const keys = [...new Set([...fits.map((f) => f.clientKey), ...st.portfolios.map((x) => x.clientKey), ...items.map((i) => i.clientKey)])];
  const reordered = keys.filter((k) => items.some((i) => i.clientKey === k && i.position !== null));
  const state = past ? "a review" : !st.plan.committedAt ? "not planned yet" : st.plan.changed ? "changed since planned" : "planned";
  const moreMenu = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    openMenu({ x: r.right, y: r.bottom + 4 }, {
      title: "Plan the week",
      items: [
        ...(past ? [] : [{ id: "refresh", label: "Refresh DevOps", hint: "R", run: () => void load(true) }]),
        ...(st.plan.committedAt ? [{ id: "when", label: `Planned ${stamp(st.plan.committedAt, tz)}`, disabled: "When this week was last planned", expected: true }] : []),
        ...reordered.map((k) => ({ id: `reset:${k}`, label: `${nameOf(k)}: back to DevOps order`, run: () => ops.reset(k) })),
      ],
    });
  };

  return (
    <main className={`planweek${panel ? " with-panel" : ""}`} aria-label="Plan the week">
      <div className="follow-ups-head pw-head">
        <span className="co-step">
          <button type="button" className="mini" onClick={() => onWeek(prev)} aria-label="Previous week" title="Previous week">‹</button>
          <button type="button" className="mini" onClick={() => onWeek(next)} aria-label="Next week" title="Next week">›</button>
        </span>
        <h2 ref={head} tabIndex={-1}>{parts.title}</h2>
        <span className={`pw-when${st.plan.changed && !past ? " changed" : ""}`}>{parts.when} · {state}</span>
        {!past && (
          <button type="button" className={`link-btn pw-health-link${flags.length ? " some" : ""}`} aria-expanded={panel?.kind === "health"} onClick={() => setPanel(panel?.kind === "health" ? null : { kind: "health" })}>
            DevOps health · {flags.length ? `${flags.length} to look at` : "all good"}
          </button>
        )}
        <button type="button" className="more pw-more" aria-label="More for Plan the week" onClick={moreMenu}>⋯</button>
        <ModeArea
          done={{
            title: past || (st.plan.committedAt && !st.plan.changed) ? "Back to the week (Esc)" : "Commit this week's lists, then back to the week",
            onClick: async () => {
              // Step 16.2: Done commits (or commits the changes again), then goes back to Week.
              if (!past && (!st.plan.committedAt || st.plan.changed) && (await act("weekplan.commit", { weekStart }, "Week committed")) === null) return;
              onClose();
            },
          }}
        >
          {switcher}
        </ModeArea>
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
      {brief && (
        <section className="co-section pw-brief" aria-label="Coop brief">
          <h3>Coop brief <span className="muted">#{brief.id}</span> <button type="button" className="mini" onClick={() => setBrief(null)}>Hide</button></h3>
          <textarea ref={briefArea} readOnly value={brief.text} rows={10} />
        </section>
      )}

      {/* U4: one strip of chips, one per half-day; drag a row onto a chip to pin it there. */}
      <div className={`pw-strip${dragging ? " dragging" : ""}`} role="group" aria-label="The week's blocks" title={past ? "What was pinned" : "Drag a must onto a block to pin it there"}>
        <span className="pw-strip-label">Blocks</span>
        {days.flatMap((d) => {
          const dow = plainDate(d.date).toLocaleString("en-US", { weekday: "short" });
          if (d.pto) return [<span key={d.date} className="pw-blk dashed" title={d.pto.titles.join(", ")}>{dow} · PTO</span>];
          if (d.kind === "overflow" || (d.am.off && d.pm.off)) return [<span key={d.date} className="pw-blk dashed">{dow} · Catch-up</span>];
          return (["AM", "PM"] as Half[]).map((half) => {
            const s = half === "AM" ? d.am : d.pm;
            const key = `${d.date}${half}`;
            const c = s.focus[0];
            const here = items.filter((f) => f.slots.some((x) => x.date === d.date && x.half === half));
            const target = !past && (!!c || s.open);
            const fb = c ? fits.find((f) => f.clientKey === c.clientKey)?.blocks.find((b) => b.date === d.date && b.half === half) : undefined;
            const off = fb && !fb.counts;
            const label = c ? c.clientName : s.open ? "Open" : "No block";
            return (
              <button key={key} type="button" className={`pw-blk${c ? "" : " dashed"}${dragOver === key ? " over" : ""}${only && c?.clientKey === only ? " on" : ""}`}
                style={{ "--c": clientColor(c?.clientKey, data.clients) } as CSSProperties}
                aria-label={`${dateShort(d.date)} ${HALF_WORD[half]}: ${label}${off ? `, not counted: ${fb.reason ?? ""}` : ""}${here.length ? `, pinned ${here.map((f) => `#${f.itemId}`).join(", ")}` : ""}`}
                title={here.length ? `Pinned: ${here.map((f) => f.title).join(", ")}` : off ? `Not counted: ${fb.reason ?? ""}` : undefined}
                onClick={() => c && setOnly(only === c.clientKey ? null : c.clientKey)}
                onDragOver={target ? (e) => { if (e.dataTransfer.types.includes(DRAG_TYPE)) { e.preventDefault(); setDragOver(key); } } : undefined}
                onDragLeave={target ? () => setDragOver(null) : undefined}
                onDrop={target ? (e) => onDrop(e, d.date, half, s) : undefined}>
                {dow} {half} · {label}
                {off && <span className="pw-blk-off"> {reasonWord(fb.reason)}</span>}
                {here.length > 0 && <span className="pw-blk-pins" aria-hidden="true"> · {here.length} pinned</span>}
              </button>
            );
          });
        })}
      </div>

      <ClientLists st={st} past={past} keys={keys} items={items} progress={list.progress} fits={fits} days={days} info={info} work={work} nameOf={nameOf} colors={data.clients} friday={friday}
        open={open} toggleOpen={toggleOpen} ops={ops} only={only} setOnly={setOnly} query={query} setQuery={setQuery} />

      {panel?.kind === "health" && (
        <PanelShell title="DevOps health" sub={flags.length ? `${flags.length} to look at` : "All good"} label="DevOps health" onClose={() => setPanel(null)}>
          {flags.length > 0 ? (
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
          ) : (
            <p className="dp-empty">Every must has stories and a target date.</p>
          )}
        </PanelShell>
      )}
      {panel?.kind === "client" && (
        <ClientPanel k={panel.k} name={nameOf(panel.k)} color={clientColor(panel.k, data.clients)} fit={fits.find((f) => f.clientKey === panel.k)} progress={list.progress.find((x) => x.clientKey === panel.k)}
          items={items.filter((i) => i.clientKey === panel.k)} reordered={reordered.includes(panel.k)} past={past} onReset={() => ops.reset(panel.k)} onClose={() => setPanel(null)} />
      )}
      {panel?.kind === "feature" && (
        <FeaturePanel k={panel.k} itemId={panel.itemId} info={info(panel.k, panel.itemId)} item={items.find((i) => i.clientKey === panel.k && i.itemId === panel.itemId) ?? null} color={clientColor(panel.k, data.clients)} name={nameOf(panel.k)}
          drafts={st.drafts.filter((d) => d.clientKey === panel.k && d.parentItemId === panel.itemId)} listed={new Set(items.filter((i) => i.clientKey === panel.k).map((i) => i.itemId))} past={past} ops={ops} tz={tz} onClose={() => setPanel(null)} />
      )}
    </main>
  );
}

/** U4: a client's budget in the panel: each half-day and whether it counts, borrowed time, musts done, and DevOps order. */
function ClientPanel({ k, name, color, fit, progress, items, reordered, past, onReset, onClose }: { k: string; name: string; color: string; fit: ClientBudget | undefined; progress: Progress | undefined; items: Item[]; reordered: boolean; past: boolean; onReset: () => void; onClose: () => void }) {
  const done = items.filter((i) => i.done);
  return (
    <PanelShell title={name} sub={fit ? `${blocksText(fit.budget)} · ${fit.text}` : undefined} color={color} label={`${name}: blocks this week`} onClose={onClose}>
      {fit && (
        <section className="dp-section" aria-label="Blocks">
          <h3>Blocks</h3>
          <ul className="pw-pblocks">
            {fit.blocks.map((b) => (
              <li key={`${b.date}${b.half}`} className={b.counts ? "" : "off"}>
                <span>{pinLabel(b)}</span>
                <span className="muted">{b.counts ? (b.open ? "Open, pinned" : "counts") : `not counted · ${reasonWord(b.reason)}`}</span>
              </li>
            ))}
          </ul>
          {fit.borrowedBlocks > 0 && <p className="dp-line">{blocksText(fit.borrowedBlocks)} of borrowed time to make up</p>}
          <p className="dp-line">Musts take {blocksText(fit.planned)}{fit.nicePlanned ? `, nice to haves ${blocksText(fit.nicePlanned)} (not counted)` : ""}.</p>
        </section>
      )}
      {progress && progress.musts > 0 && (
        <section className="dp-section" aria-label="Done">
          <h3>Done</h3>
          <p className="dp-line">{progressLabel(progress)}</p>
          {done.length > 0 && (
            <ul className="pw-pdone">
              {done.map((i) => (
                <li key={i.id}>
                  <WorkLink clientKey={k} url={i.url}>{i.title}</WorkLink> <span className="muted">{DONE_WORD[i.done!]}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {!past && reordered && (
        <button type="button" className="mini quiet" onClick={onReset} title="Your order here is local; DevOps isn't changed">
          Back to DevOps order
        </button>
      )}
    </PanelShell>
  );
}

/** U4: a feature in the panel: dates, its stories in DevOps, drafts, Draft stories and the Coop brief. */
function FeaturePanel({ k, itemId, info, item, color, name, drafts, listed, past, ops, tz, onClose }: { k: string; itemId: number; info: Info | null; item: Item | null; color: string; name: string; drafts: DraftStory[]; listed: ReadonlySet<number>; past: boolean; ops: Ops; tz: string; onClose: () => void }) {
  const f = info?.feature ?? null;
  const title = item?.title ?? f?.title ?? `#${itemId}`;
  const stories = (f?.children ?? []).filter((c) => c.level === "story");
  void tz;
  return (
    <PanelShell title={title} sub={`${name} · #${itemId}${info ? ` · ${info.type} · ${info.state}` : ""}`} color={color} label={`Feature: ${title}`} onClose={onClose}>
      <section className="dp-section" aria-label="Dates">
        <h3>Dates</h3>
        <p className="dp-line">
          {f?.startDate ? `Starts ${dateShortIso(f.startDate)}` : "No start date"} · {f?.targetDate ? `target ${dateShortIso(f.targetDate)}` : "no target date"}
        </p>
        {!past && <DevOpsAction clientKey={k} label="Set target date" onRun={(w) => w.targetDate({ clientKey: k, itemId, title, current: f?.targetDate ?? null })} />}
      </section>
      <section className="dp-section" aria-label="Stories">
        <h3>Stories</h3>
        {stories.length ? (
          <ul className="pw-pstories">
            {stories.map((c) => (
              <li key={c.id} className={c.open ? "" : "closed"}>
                <WorkLink clientKey={k} url={c.url}>{c.title}</WorkLink> <span className="muted">{c.state} · {c.mine ? "you" : c.assignedTo ?? "unassigned"}{listed.has(c.id) ? " · on the list" : ""}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="dp-empty">No stories in DevOps yet.</p>
        )}
        {drafts.length > 0 && (
          <ul className="pw-pstories">
            {drafts.map((d) => (
              <li key={`d${d.id}`}>
                <span className="pw-draft-tag">Draft</span> <DraftTitle draft={d} /> <span className="muted">{d.size}</span>
              </li>
            ))}
          </ul>
        )}
        {!past && (
          <span className="pw-pacts">
            <DraftStories clientKey={k} item={{ id: itemId, title }} />
            <button type="button" className="link-btn" onClick={() => ops.brief(k, itemId)}>Coop brief</button>
            {drafts.length > 0 && <CreateInDevOps drafts={drafts.slice(0, 10)} label={`Create ${drafts.length === 1 ? "the draft" : `${Math.min(10, drafts.length)} drafts`} in DevOps`} />}
            {f && <WorkLink clientKey={k} url={f.url} className="mini">Open in DevOps</WorkLink>}
          </span>
        )}
      </section>
    </PanelShell>
  );
}

/** "Wed AM: mostly meetings" without the half-day it names: "mostly meetings". */
const reasonWord = (r: string | null) => (r ?? "").replace(/^[^:]*:\s*/, "");
const budgetWhy = (fit: ClientBudget) => [...fit.blocks.filter((b) => !b.counts).map((b) => b.reason ?? pinLabel(b)), ...(fit.borrowedBlocks ? [`${blocksText(fit.borrowedBlocks)} of borrowed time to make up`] : [])];

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
  size: (i: Item, z: "S" | "M" | "L") => void;
  done: (i: Item, on: boolean) => void;
  move: (i: Item, by: -1 | 1) => void;
  /** Drag within a list: put `itemId` where `before` is. */
  reorderTo: (k: string, tier: Tier, itemId: number, before: number) => void;
  reset: (k: string) => void;
  pin: (k: string, itemId: number, date: IsoDate, half: Half, on: boolean) => void;
  brief: (k: string, id: number) => void;
  /** U4: a row is being dragged (the blocks strip grows). */
  dragging: (on: boolean) => void;
  /** U4: open the detail panel on a feature, or on a client's budget. */
  feature: (k: string, itemId: number) => void;
  client: (k: string) => void;
};
type ListsProps = {
  st: WeekPlanState;
  past: boolean;
  keys: string[];
  items: Item[];
  progress: Progress[];
  fits: ClientBudget[];
  days: WeekLoadData["week"]["days"];
  info: (k: string, id: number) => Info | null;
  work: readonly ClientWork[] | null;
  nameOf: (k: string) => string;
  colors: Record<string, string>;
  friday: boolean;
  open: Set<string>;
  toggleOpen: (key: string) => void;
  ops: Ops;
  only: string | null;
  setOnly: (k: string | null) => void;
  query: string;
  setQuery: (q: string) => void;
};

/** The client filter chips and search, then one card per client (two columns at 1920, one when narrow, three at 3840). */
function ClientLists(p: ListsProps) {
  const keys = p.keys.filter((k) => (p.only ? k === p.only : true));
  if (p.past && !p.items.length) return <p className="muted pw-empty">Nothing was planned for this week.</p>;
  return (
    <>
      <div className="pw-filter" role="group" aria-label="Filter the lists">
        {p.keys.length > 1 && (
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
      <div className="pw-cards">{keys.map((k) => <ClientList key={k} k={k} {...p} />)}</div>
    </>
  );
}

/** Rows shown in Add from DevOps before "Show N more". */
const ADD_FIRST = 3;

function ClientList(p: ListsProps & { k: string }) {
  const { k } = p;
  const q = p.query.trim().toLowerCase();
  const match = (i: { id: number; title: string }) => !q || i.title.toLowerCase().includes(q) || String(i.id).includes(q.replace(/^#/, ""));
  const port = p.st.portfolios.find((x) => x.clientKey === k);
  const w = p.work?.find((x) => x.clientKey === k);
  const fit = p.fits.find((f) => f.clientKey === k);
  // Step 16.4: features are envelopes; a story under a listed feature shows inside its row and takes its tier.
  const est = estimate(p.items.filter((i) => i.clientKey === k));
  const envOf = new Map(est.envelopes.map((e) => [e.feature.id, e] as const));
  const nested = new Set(est.envelopes.flatMap((e) => e.stories.map((x) => x.id)));
  const listedFeatures = new Set(est.envelopes.map((e) => e.feature.itemId));
  const mine = p.items.filter((i) => i.clientKey === k && !nested.has(i.id) && (match({ id: i.itemId, title: i.title }) || (envOf.get(i.id)?.stories ?? []).some((x) => match({ id: x.itemId, title: x.title }))));
  const musts = mine.filter((i) => i.tier === "must");
  const nice = mine.filter((i) => i.tier === "nice");
  const places = placesFor(p.days, k);
  const listed = new Set(p.items.filter((i) => i.clientKey === k).map((i) => i.itemId));
  // A story whose feature is on the list belongs to that feature's row, not to Add (U4).
  const underListed = (parentId: number | null | undefined) => parentId != null && listed.has(parentId);
  // What can go on the list, in DevOps order: features (portfolio read), then my stories (work read).
  const features = (port?.items ?? []).filter((i) => i.tier === "feature" && !listed.has(i.id) && match(i));
  const stories = (w?.items ?? []).filter((i) => i.level === "story" && !listed.has(i.id) && !underListed(i.parentId) && match(i));
  // Q64: open stories under the client's features (any assignee), not already offered above, grouped by feature.
  const offered = new Set(stories.map((x) => x.id));
  const under = (port?.items ?? [])
    .filter((f) => f.tier === "feature" && !listed.has(f.id))
    .map((f) => ({ f, kids: f.children.filter((c) => c.level === "story" && c.open && !listed.has(c.id) && !offered.has(c.id) && match(c)) }))
    .filter((g) => g.kids.length);
  // Q66: draft stories with no feature yet, listed under their client.
  const loose = p.st.drafts.filter((d) => d.clientKey === k && d.parentItemId === null && (!q || d.title.toLowerCase().includes(q)));
  const epics = (port?.items ?? []).filter((i) => i.tier === "epic" && match(i));
  const niceOpen = p.open.has(`nice:${k}`) || !!q;
  const more = p.open.has(`more:${k}`) || !!q;
  const flat = [
    ...features.map((f) => ({ id: f.id, title: f.title, url: f.url, what: `${f.type.toLowerCase()} · ${f.state}${f.targetDate ? ` · target ${dateShortIso(f.targetDate)}` : ""}`, flag: f.children.some((c) => c.level === "story") ? null : "no stories" })),
    ...stories.map((s) => ({ id: s.id, title: s.title, url: s.url, what: `${s.type === "User Story" ? "story" : s.type.toLowerCase()} · ${s.state}`, flag: null })),
  ];
  const underCount = under.reduce((n, g) => n + g.kids.length, 0);
  const hidden = Math.max(0, flat.length - ADD_FIRST) + underCount;
  const over = fit ? overLine(fit.budget, fit.planned, p.friday) : null;
  const row = (i: Item, n: number, group: Item[]) => (
    <ItemRow key={i.id} i={i} first={n === 0} last={n === group.length - 1} past={p.past} info={p.info(k, i.itemId)} drafts={p.st.drafts.filter((d) => d.clientKey === k && d.parentItemId === i.itemId)}
      places={places} ops={p.ops} env={envOf.get(i.id) ?? null} parentListed={i.parentId != null && listedFeatures.has(i.parentId)} infoOf={(id) => p.info(k, id)} listed={listed} />
  );
  const why = fit ? budgetWhy(fit) : [];
  return (
    <section className="pw-client" style={{ "--c": clientColor(k, p.colors) } as CSSProperties} aria-label={p.nameOf(k)}>
      <h3 className="pw-card-head">
        <button type="button" className="pw-name" onClick={() => p.ops.client(k)} title="Blocks, what counts and what's done">
          <span className="pw-swatch" aria-hidden="true" />
          {p.nameOf(k)}
        </button>
        {fit && (
          <>
            <span className="pw-budget" title={why.length ? `Not counted: ${why.join("; ")}` : "Nice to haves don't count against the blocks"}>{blocksText(fit.budget)}</span>
            <span className={`pw-fit2 ${fit.status}`}>{fit.text}</span>
          </>
        )}
        {port && port.status !== "ok" && <span className="pw-src">DevOps: {port.message ?? port.status}</span>}
        {port?.fromCache && <span className="pw-src">from cache</span>}
      </h3>
      {musts.length > 0 && (
        <div className="pw-tier">
          <h4>Must</h4>
          <ul className="pw-features">{musts.map((i, n) => row(i, n, musts))}</ul>
          {over && !p.past && <p className="pw-over" role="status">{over}</p>}
        </div>
      )}
      {nice.length > 0 && (
        <div className="pw-tier pw-nice">
          <button type="button" className="pw-fold" aria-expanded={niceOpen} onClick={() => p.toggleOpen(`nice:${k}`)}>
            <span aria-hidden="true">{niceOpen ? "▾" : "▸"}</span> Nice to have · {nice.length}
          </button>
          {niceOpen && <ul className="pw-features">{nice.map((i, n) => row(i, n, nice))}</ul>}
        </div>
      )}
      {loose.length > 0 && (
        <div className="pw-tier pw-loose">
          <h4>Draft stories</h4>
          <ul className="pw-drafts">
            {loose.map((d) => (
              <li key={d.id}><span className="pw-draft-tag">Draft</span> <DraftTitle draft={d} /> <span className="muted">{d.size}</span> <CreateInDevOps drafts={[d]} /></li>
            ))}
          </ul>
        </div>
      )}
      {!p.past && (
        <div className="pw-add">
          <h4>Add from DevOps <span className="pw-add-n">{flat.length ? `${flat.length} more of yours` : ""}</span></h4>
          {!port && !w && <p className="pw-empty-line">No DevOps for this client.</p>}
          {(port?.status === "ok" || w?.status === "ok") && !flat.length && !underCount && (
            <p className="pw-empty-line">{q ? "Nothing matches." : listed.size ? "Everything assigned to you is on the list." : `Nothing in DevOps is assigned to you for ${p.nameOf(k)}.`}</p>
          )}
          <ul className="pw-features">
            {(more ? flat : flat.slice(0, ADD_FIRST)).map((f) => <AddRow key={f.id} k={k} id={f.id} title={f.title} url={f.url} what={f.what} flag={f.flag} ops={p.ops} />)}
          </ul>
          {more &&
            under.map((g) => (
              <div key={g.f.id} className="pw-under">
                <h4>Stories under #{g.f.id} {g.f.title}</h4>
                <ul className="pw-features">
                  {g.kids.map((c) => <AddRow key={c.id} k={k} id={c.id} title={c.title} url={c.url} what={`story · ${c.state} · ${c.mine ? "you" : c.assignedTo ?? "unassigned"}`} flag={null} ops={p.ops} />)}
                </ul>
              </div>
            ))}
          {more && epics.length > 0 && (
            <div className="pw-under">
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
            </div>
          )}
          {!q && (hidden > 0 || (epics.length > 0 && !more)) && (
            <button type="button" className="link-btn pw-show-more" aria-expanded={more} onClick={() => p.toggleOpen(`more:${k}`)}>
              {more ? "Show less" : hidden > 0 ? `Show ${hidden} more` : "Show epics"}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function AddRow({ k, id, title, url, what, flag, ops }: { k: string; id: number; title: string; url: string; what: string; flag: string | null; ops: Ops }) {
  return (
    <li className="pw-feature pw-addrow">
      <span className="pw-title">
        <WorkLink clientKey={k} url={url}>#{id} {title}</WorkLink> <span className="pw-meta">{what}</span>
        {flag && <span className="pw-flagword"> · {flag}</span>}
      </span>
      <span className="pw-acts">
        <button type="button" className="mini pw-must" onClick={() => ops.add(k, id, "must")}>+ Must</button>
        <button type="button" className="mini quiet pw-nice-btn" onClick={() => ops.add(k, id, "nice")} aria-label={`Add #${id} as a nice to have`}>Nice</button>
      </span>
    </li>
  );
}

function ItemRow({ i, first, last, past, info, drafts, places, ops, env: envl, parentListed, nestedIn, infoOf, listed }: {
  i: Item; first: boolean; last: boolean; past: boolean; info: Info | null; drafts: DraftStory[]; places: Place[]; ops: Ops;
  /** Step 16.4: a feature's envelope (its blocks and the stories under it); a story nested in a feature's row. */
  env?: Envelope<Item> | null; parentListed?: boolean; nestedIn?: Item; infoOf?: (itemId: number) => Info | null; listed?: ReadonlySet<number>;
}) {
  const k = i.clientKey;
  const feature = info?.feature ?? null;
  const stories = feature ? feature.children.filter((c) => c.level === "story") : [];
  const openStories = stories.filter((c) => c.open).length;
  // U4 (Today's rule): a feature with no open DevOps stories needs stories.
  const needs = i.level === "feature" && !!feature && openStories === 0 && !i.done;
  // Its open DevOps stories not on the list: one muted line under the row.
  const rest = i.level === "feature" && !nestedIn ? stories.filter((c) => c.open && !listed?.has(c.id)) : [];
  const other: Tier = i.tier === "must" ? "nice" : "must";
  const { env, open: openMenu } = useContext(MenuCtx);
  const dw = useDevOpsWrite();
  const facts: WeekItemFacts = {
    itemId: i.itemId, title: i.title, tier: i.tier, level: i.level, first, last, past, done: i.done ? (i.done === "local" ? "local" : "other") : null, blocks: envl?.blocks ?? i.blocks ?? 1, size: i.size, nested: !!nestedIn,
    places: places.map((pl) => ({ date: pl.date, half: pl.half, label: pl.label })), pinned: i.slots, openStories, targetDate: feature?.targetDate ?? null, drafts: drafts.length, canWrite: !!dw?.can(k),
  };
  const wops: WeekItemOps = {
    move: (by) => ops.move(i, by),
    tier: () => ops.tier(i, other),
    pin: (date, half, on) => ops.pin(k, i.itemId, date, half, on),
    blocks: (n) => ops.blocks(i, n),
    size: (z) => ops.size(i, z),
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
  const stateWord = info ? info.state : "not in this DevOps read";
  return (
    <li
      className={`pw-feature pw-item pw-row${i.done ? " done" : ""}${needs ? " needs" : ""}${nestedIn ? " nested" : ""}`}
      draggable={!past}
      onContextMenu={(e) => show(e, weekItemMenu(facts, wops))}
      onDragStart={(e) => {
        e.stopPropagation();
        e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ clientKey: k, itemId: i.itemId, tier: i.tier }));
        e.dataTransfer.effectAllowed = "copyMove";
        setTimeout(() => ops.dragging(true), 0);
      }}
      onDragEnd={() => ops.dragging(false)}
      onDragOver={(e) => !past && e.dataTransfer.types.includes(DRAG_TYPE) && e.preventDefault()}
      onDrop={(e) => {
        ops.dragging(false);
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
      {!nestedIn && !past && <span className="pw-handle" aria-hidden="true" title="Drag to reorder, or onto a block to pin it">⋮⋮</span>}
      <span className="pw-title">
        {i.level === "feature" ? (
          <button type="button" className="pw-open" onClick={() => ops.feature(k, i.itemId)} title={`${stateWord}. Stories, dates and the Coop brief`}>{i.title}</button>
        ) : (
          <WorkLink clientKey={k} url={i.url} title={stateWord}>{i.title}</WorkLink>
        )}
        {i.done && <span className="pw-done" title={DONE_WORD[i.done]}>✓</span>}
      </span>
      {i.level === "feature" &&
        (needs ? (
          <span className="pw-needs">
            <span className="pw-needs-word">Needs stories</span>
            {!past && <DraftStories clientKey={k} item={{ id: i.itemId, title: i.title }} />}
            {!past && <button type="button" className="link-btn pw-brief-btn" onClick={() => ops.brief(k, i.itemId)}>Coop brief</button>}
          </span>
        ) : (
          feature && (
            <button type="button" className="pw-count" onClick={() => ops.feature(k, i.itemId)}>
              {openStories} stor{openStories === 1 ? "y" : "ies"}
            </button>
          )
        ))}
      {i.slots.length > 0 && <span className="pw-pin" title="Pinned to this block">{i.slots.map(pinLabel).join(", ")}</span>}
      {i.level === "feature" ? (
        <span className="pw-stepper" role="group" aria-label={`Blocks for ${i.title}`}>
          <button type="button" className="mini pw-step" disabled={past || facts.blocks <= 1} aria-label="One block less" onClick={() => ops.blocks(i, facts.blocks - 1)}>−</button>
          <button type="button" className="pw-chip-btn" disabled={past} onClick={(e) => show(e, blocksStep(facts, wops))} title={envl?.auto ? "What its stories add up to. Choose to set it" : "How many of this client's blocks it needs"}>
            {blocksText(facts.blocks)}
          </button>
          <button type="button" className="mini pw-step" disabled={past || facts.blocks >= 20} aria-label="One block more" onClick={() => ops.blocks(i, facts.blocks + 1)}>+</button>
        </span>
      ) : (
        <button type="button" className="pw-chip-btn pw-size" disabled={past} onClick={(e) => show(e, storySizeStep(facts, wops))} title="S about an hour, M a couple of hours, L about a whole block">
          {i.size ?? "M"}
        </button>
      )}
      {env && (
        <button type="button" className="more" aria-label={`More for ${i.title}`} onClick={(e) => show(e, weekItemMenu(facts, wops))}>
          ⋯
        </button>
      )}
      {i.level === "story" && !nestedIn && i.parentId != null && !parentListed && (
        <span className="pw-parent">
          Under {infoOf?.(i.parentId)?.feature?.title ?? `#${i.parentId}`}
          {!past && <button type="button" className="link-btn" onClick={() => ops.add(i.clientKey, i.parentId!, i.tier)} title="Put its feature on the list; this story moves under it">Add the feature</button>}
        </span>
      )}
      {envl && (envl.doneBlocks > 0 || (envl.fill !== "filled" && envl.stories.length > 0)) && (
        <span className="pw-fill">
          {envl.doneBlocks > 0 && <span className="pw-progress-blocks">{progressWords(envl)}</span>}
          {envl.fill === "needs_stories" && !i.done && <span>{fillWords(envl)}</span>}
          {envl.fill === "over" && (
            <span className="pw-raise" role="status">
              {fillWords(envl)}{" "}
              {!past && <button type="button" className="mini primary" onClick={() => ops.blocks(i, envl.raiseTo!)}>Raise to {envl.raiseTo}</button>}
            </span>
          )}
        </span>
      )}
      {envl && envl.stories.length > 0 && (
        <ul className="pw-nested" aria-label={`Stories in ${i.title}`}>
          {envl.stories.map((x) => (
            <ItemRow key={x.id} i={x} first last past={past} info={infoOf?.(x.itemId) ?? null} drafts={[]} places={places} ops={ops} nestedIn={i} />
          ))}
        </ul>
      )}
      {rest.length > 0 && <span className="pw-kids" title="Its open stories in DevOps, not on the list">{rest.map((c) => c.title).join(" · ")}</span>}
    </li>
  );
}
