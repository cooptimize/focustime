// Plan the week (step 8, by client since step 11): each followed client's week list of DevOps features and stories,
// split into Must and Nice to have, in DevOps stack rank order unless reordered here. Pins to a block are optional
// (dependencies). U6 (D409 to D415): one client at a time on the planning layout shared with Plan the day. At the top
// a small week grid (Mon to Fri, AM over PM) is the client filter: each half-day names its client, a pinned must shows
// its title, the open client's cells read "Planning"; click a cell to open that client, drag a must onto one of its
// cells to pin it. Below, one line per client with blocks this week; one is open as a card with its musts, the amber
// over line, nice to haves folded and Next client. On the right, "Add to <client>": DevOps items not on a list with
// + Must and Nice, everything else folded, and the type box (Enter a draft feature as a must, Shift+Enter a nice to
// have). DevOps health, a feature and a client's budget open in the shared detail panel. DevOps is read-only; the
// week plan lives only in the local plan store. A past week is a review.
import { ResolvedMark, TypeIcon } from "./TypeIcon.tsx";
import { ModeArea } from "./ModeSwitch.tsx";
import { planWeekParts } from "./nav.ts";
import { mondayOf } from "../week/dates.ts";
import type React from "react";
import { DraftEditorCtx, DraftTitle } from "./DraftEditor.tsx";
import { CreateInDevOps, DevOpsAction, useDevOpsWrite } from "./DevOpsWrite.tsx";
import { openCoopBrief, weekItemMenu, type MenuStep, type WeekItemFacts, type WeekItemOps } from "./menu.ts";
import { HoursStepper, SizeChip } from "./plan/Estimate.tsx";
import { useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent } from "react";
import type { WeekLoadData, WeekPlanState } from "../actions/types.ts";
import type { DraftStory, WeekFeature } from "../plan/types.ts";
import { addPaneRows, type AddRowInfo } from "../plan/weekadd.ts";
import { needsBreakdown, PINNED_TO_PTO, pinnedToPto, readiness, type ClientBudget, type ReadinessFlag } from "../plan/weekplan.ts";
import { resolvedOf } from "../plan/carry.ts";
import { commitFits } from "./WeekMusts.tsx";
import { checkinDays, ProposalSection, useProposal, WatchingList } from "./Watching.tsx";
import { FromYourTeam } from "./Team.tsx";
import { openSend } from "./send-event.ts";
import { aboutText, DEFAULT_FEATURE_MINUTES, estimate, hoursText, loadText, overLine, progressWords, sourceWords, type Envelope } from "../plan/estimate.ts";
import { moveWithin, otherStoriesLine, pickDoneFrom, pinLabel, progressLabel, weekList, type DoneBy, type Listed, type Progress, type Tier } from "../plan/weeklist.ts";
import type { ClientWork, IsoDate, PortfolioItem, Slot, WorkItem } from "../week/types.ts";
import { call } from "./api.ts";
import { clientColor } from "./labels.ts";
import { MenuCtx } from "./Menus.tsx";
import { WorkLink } from "./WorkLink.tsx";
import { BreakDown, PanelShell } from "./DetailPanel.tsx";
import { BreakDownButton } from "./BreakDownPanel.tsx";
import { isTypingTarget, topOverlay } from "./keys.ts";
import { PlanFrame } from "./plan/PlanFrame.tsx";
import { PlanHeader } from "./plan/PlanHeader.tsx";
import { PlanLabel, UnitCard, UnitLine, type FitTone } from "./plan/UnitCard.tsx";
import { PlanRow } from "./plan/PlanRow.tsx";
import { AddPane, AddSection, BoxHint } from "./plan/AddPane.tsx";
import { FoldLine } from "./plan/FoldLine.tsx";
import { countedLines, planOpenClient, plannedCount, weekLines, type WeekLine } from "../plan/weekclients.ts";
import { userZone } from "../week/zone.ts";
import { dateInWeekWords, otherOwners, rowDue } from "../plan/rowdates.ts";
import { usePhotos } from "./Presence.tsx";
import { OwnerName, OwnerPhotos, OwnerStack } from "./Owners.tsx";
import { createContext } from "react";

/** D461: what rows need for their dates: the week being planned and today. */
const WeekDates = createContext<{ weekStart: IsoDate; today: IsoDate }>({ weekStart: "", today: "" });

type Props = { /** Step 16.2: the Week tab's mode switch, at the right of this view's header. */ switcher?: React.ReactNode; weekStart: IsoDate; data: WeekLoadData; version: number; now: string; onWeek: (w: IsoDate) => void; onClose: () => void; onChanged: () => void; onCaptures: () => void; /** fix/planday-pane: the client to open first (from Plan the day's "plan the week"), once. */ openClient?: string | null; onOpenClientSeen?: () => void; /** SW-1: Accept and schedule opens the Board on that block. */ onOpenDay?: (date: IsoDate, half: Half) => void };
type Half = "AM" | "PM";
type Place = { date: IsoDate; half: Half; label: string };
type Item = Listed<WeekFeature>;
type HeadsUp = { weekStart: IsoDate; clientKey: string; itemId: number; title: string; trigger?: "dropped" | "demoted" };
type Drag = { clientKey: string; itemId: number; tier: Tier };

const DRAG_TYPE = "application/x-focustime-feature";
const HALF_WORD: Record<Half, string> = { AM: "morning", PM: "afternoon" };
const plainDate = (d: IsoDate) => Temporal.PlainDate.from(d);
const dateShort = (d: IsoDate) => plainDate(d).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" });
const dateShortIso = (d: IsoDate) => plainDate(d).toLocaleString("en-US", { month: "short", day: "numeric" });
const placeLabel = (date: IsoDate, half: Half) => pinLabel({ date, half });
const stamp = (s: string, tz: string) => {
  const z = Temporal.ZonedDateTime.from(s).withTimeZone(tz);
  return `${z.toPlainDate().toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" })}, ${z.toPlainTime().toLocaleString("en-US", { hour: "numeric", minute: "2-digit" })}`;
};
const DONE_WORD: Record<DoneBy, string> = { devops: "Done in DevOps", resolved: "Resolved in DevOps", local: "Done", pick: "Done (picked and ticked)" };
const TONE: Record<ClientBudget["status"], FitTone> = { over: "over", all: "all", free: "fits", none: "fits" };

/** Where a client's item can be pinned: its own blocks, or an Open half-day. */
function placesFor(days: WeekLoadData["week"]["days"], clientKey: string): Place[] {
  return days.flatMap((d) =>
    ([["AM", d.am], ["PM", d.pm]] as [Half, Slot][])
      .filter(([, s]) => !s.pto && (s.focus[0] ? s.focus[0].clientKey === clientKey : s.open))
      .map(([half, s]) => ({ date: d.date, half, label: `${placeLabel(d.date, half)}${s.focus[0] ? "" : " (Open)"}` })),
  );
}

/** What DevOps says about an item now: a feature from the portfolio read, a story from the work read. */
type Info = { type: string; state: string; feature: PortfolioItem | null; story: WorkItem | null; /** D461: its DevOps target date, when read. */ target: IsoDate | null };
function infoFor(portfolios: WeekPlanState["portfolios"], work: readonly ClientWork[] | null) {
  return (k: string, id: number): Info | null => {
    const feature = portfolios.find((p) => p.clientKey === k)?.items.find((i) => i.id === id) ?? null;
    if (feature) return { type: feature.type, state: feature.state, feature, story: null, target: feature.targetDate };
    const w = work?.find((x) => x.clientKey === k);
    const story = w ? ([...w.items, ...w.children, ...(w.committed ?? []), ...(w.watched ?? [])].find((i) => i.id === id) ?? null) : null;
    const kid = portfolios.find((p) => p.clientKey === k)?.items.flatMap((i) => i.children).find((c) => c.id === id);
    if (story) return { type: story.type, state: story.state, feature: null, story, target: story.targetDate ?? kid?.targetDate ?? null };
    return kid ? { type: kid.type, state: kid.state, feature: null, story: null, target: kid.targetDate ?? null } : null;
  };
}
/** U4 (Today's rule): a feature on the list with no open DevOps stories needs stories. */
const needsStories = (i: Item, info: Info | null) => i.level === "feature" && !!info?.feature && needsBreakdown(info.feature) && !i.done;

type PanelSel = { kind: "feature"; k: string; itemId: number } | { kind: "client"; k: string } | { kind: "health" } | null;

/** U6: a draft feature on the week list, as a week item for the budget (4h, like a new feature). */
const draftAsItem = (weekStart: IsoDate, d: DraftStory, tier: Tier): WeekFeature => ({
  id: -d.id, weekStart, clientKey: d.clientKey, itemId: -d.id, title: d.title, itemType: null, url: null, level: "feature", tier, estimate: null, size: null, parentId: null, slots: [], doneAt: null, position: null, createdAt: d.createdAt, updatedAt: d.createdAt,
});

/** UI-7: the week's state beside Done: Draft until confirmed, then Confirmed, or changed since you confirmed. */
export const weekState = (p: { committedAt?: string | null; changed?: boolean }, past: boolean): string | null =>
  past ? null : !p.committedAt ? "Draft" : p.changed ? "changed since you confirmed" : "Confirmed";
/** UI-7: Confirm week while there is something to confirm; otherwise Done. */
export const finishLabel = (p: { committedAt?: string | null; changed?: boolean }, past: boolean): string =>
  past || (p.committedAt && !p.changed) ? "Done" : "Confirm week";

export function PlanWeek({ switcher, weekStart, data, version, onWeek, onClose, onChanged, onCaptures, openClient = null, onOpenClientSeen, onOpenDay }: Props) {
  const [st, setSt] = useState<WeekPlanState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [offer, setOffer] = useState<HeadsUp | null>(null);
  const [folds, setFolds] = useState<Set<string>>(new Set());
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [dragging, setDragging] = useState<Drag | null>(null);
  const [panel, setPanel] = useState<PanelSel>(null);
  const [openK, setOpenK] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const head = useRef<HTMLHeadingElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const { open: openMenu } = useContext(MenuCtx);
  const openDraft = useContext(DraftEditorCtx);
  const tz = userZone(data);
  // D460: one batched photo read for everyone who owns a story here (the per-user cache; no read per row or render).
  const ownerEmails = useMemo(() => [...new Set((st?.portfolios ?? []).flatMap((p) => p.items.flatMap((i) => i.children.filter((c) => !c.mine && c.assignedToEmail).map((c) => c.assignedToEmail!))))], [st]);
  const photos = usePhotos({ emails: ownerEmails });
  const weekDates = useMemo(() => ({ weekStart, today: data.planDay.date }), [weekStart, data.planDay.date]);
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
  // PL-1: this week's From last week proposal and Watching rows; a decision reloads the list and the week.
  const proposalChanged = useCallback(() => {
    void load();
    onChanged();
  }, [load, onChanged]);
  const proposal = useProposal(weekStart, version, proposalChanged);
  useEffect(() => {
    setPanel(null);
    setOffer(null);
    setOpenK(null);
    setQuery("");
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
  const bits = weekReady ? (data.planBits ?? null) : null;
  const list = useMemo(() => weekList(raw, work, portfolios, pickDoneFrom(data.plan), resolvedOf(bits)), [raw, work, portfolios, data.plan, bits]);
  const items = list.items;
  const drafts = st?.drafts ?? [];
  // U6: draft features on the list (typed in the right pane), with their tier.
  const weekDrafts = useMemo(() => (st?.weekDrafts ?? []).flatMap((w) => {
    const d = drafts.find((x) => x.id === w.draftId);
    return d ? [{ draft: d, tier: w.tier }] : [];
  }), [st?.weekDrafts, drafts]);
  // Q48: only borrowed time paid back in this week counts against its fit.
  // PL-1: the same budget as the Board (planBudget): Keep open, resolved musts at zero, the Watching check-ins.
  const fits = useMemo(
    () => (weekReady ? commitFits(data, raw, weekDrafts.map((w) => draftAsItem(weekStart, w.draft, w.tier))) : []),
    [weekReady, data, raw, weekDrafts, weekStart],
  );
  const intentions = useMemo(
    () => Object.entries(data.plan ?? {}).flatMap(([date, d]) => d.picks.filter((p) => p.kind === "intention").map((p) => ({ id: p.id, clientKey: p.clientKey, title: p.title, date, size: p.size ?? "M", status: p.status }))),
    [data.plan],
  );
  const flags = useMemo(
    () =>
      st && weekReady && st.access === "plan"
        ? readiness({ week: data.week, portfolios: st.portfolios, features: raw, work: data.devops, marks: st.marks, followUps: st.followUps.map((l) => ({ id: l.id, kind: l.kind, clientKey: l.clientKey, ruleKey: `priorities:${weekStart}:${l.clientKey}`, closedAt: l.closedAt })), drafts: st.drafts, captures: st.captures, intentions })
        : [],
    [st, weekReady, data.week, data.devops, raw, weekStart, intentions],
  );
  const days = data.week.days.filter((d) => d.kind !== "weekend");
  const info = useMemo(() => infoFor(portfolios, work), [portfolios, work]);
  // U6: one line per client with blocks this week, in the order of their first block (and a client with a must pinned
  // to Friday); the view opens on the first one with trouble.
  const lines: WeekLine[] = useMemo(
    () => (st && weekReady ? weekLines({ fits, items, days, drafts: weekDrafts.map((w) => ({ clientKey: w.draft.clientKey, tier: w.tier })), quiet: st.quiet, needs: (i) => needsStories(i as Item, info(i.clientKey, i.itemId)) }) : []),
    [st, weekReady, fits, items, days, weekDrafts, info],
  );
  useEffect(() => {
    if (!lines.length) return;
    if (openK === null || !lines.some((l) => l.clientKey === openK)) setOpenK(planOpenClient(lines));
  }, [lines, openK]);
  // fix/planday-pane: opened from Plan the day's "plan the week" on a client: that client's card first, once.
  useEffect(() => {
    if (!openClient || !lines.some((l) => l.clientKey === openClient)) return;
    setOpenK(openClient);
    onOpenClientSeen?.();
  }, [lines, openClient, onOpenClientSeen]);

  const parts = planWeekParts(weekStart, st?.thisWeek ?? mondayOf(data.planDay.date));
  const past = st?.access === "past";
  const keyRef = useRef<(e: globalThis.KeyboardEvent) => void>(() => {});
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => keyRef.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  if (!st || !weekReady)
    return (
      <main className="planweek pl-frame" aria-label="Plan the week">
        <PlanHeader className="pw-head" title={parts.title} titleRef={head} mode={<ModeArea>{switcher}</ModeArea>} />
        <div className="pl-panes single">
          <div className="pl-left">{error ? <p className="set-problem">{error}</p> : <p className="muted">Loading…</p>}</div>
        </div>
      </main>
    );

  const names = new Map<string, string>([...data.planClients.map((c) => [c.clientKey, c.clientName] as const), ...st.portfolios.map((p) => [p.clientKey, p.clientName] as const), ...fits.map((f) => [f.clientKey, f.clientName] as const)]);
  const nameOf = (k: string) => names.get(k) ?? k;
  const prev = plainDate(weekStart).subtract({ days: 7 }).toString();
  const next = plainDate(weekStart).add({ days: 7 }).toString();
  const friday = days.some((d) => d.kind === "overflow" && !d.pto);
  const open = lines.find((l) => l.clientKey === openK) ?? null;
  const openIndex = open ? lines.indexOf(open) : -1;
  const go = (by: 1 | -1) => {
    const to = lines[Math.max(0, Math.min(lines.length - 1, openIndex + by))];
    if (to) setOpenK(to.clientKey);
  };

  const pin = (k: string, itemId: number, date: IsoDate, half: Half, on: boolean) => void act("weekplan.place", { weekStart, clientKey: k, itemId, date, half, on });
  const dropped = (r: { headsUp: HeadsUp | null } | null) => setOffer(r?.headsUp ?? null);
  const ops: Ops = {
    nameOf,
    // D437: an epic with no features: a local draft feature under it, opened in the draft editor to name and fill in.
    draftFeature: (k, epicId) =>
      void act<{ draft: DraftStory }>("draft.add_feature", { clientKey: k, parentItemId: epicId, title: "New feature" }).then((r) => {
        if (r?.draft) openDraft?.(r.draft);
      }),
    add: (k, itemId, tier) => void act("weekplan.add", { weekStart, clientKey: k, itemId, tier }, `#${itemId} added as ${tier === "must" ? "a must" : "a nice to have"}`),
    tier: (i, tier) => void act<{ headsUp: HeadsUp | null }>("weekplan.set_tier", { id: i.id, tier }, `#${i.itemId} is now ${tier === "must" ? "a must" : "a nice to have"}`).then(dropped),
    remove: (i) => void act<{ headsUp: HeadsUp | null }>("weekplan.remove", { id: i.id }, `Took #${i.itemId} off the week`).then(dropped),
    hours: (i, n) => void act("weekplan.set_estimate", { id: i.id, hours: n }),
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
    draftTier: (d, tier) => void act("weekplan.draft_tier", { weekStart, draftId: d.id, tier }, tier === "off" ? `Took the draft ${d.title} off the week` : undefined),
    typed: (k, title, tier) => act("weekplan.add_draft", { weekStart, clientKey: k, title, tier }, `Draft feature saved as ${tier === "must" ? "a must" : "a nice to have"}: ${title}. Add it in DevOps when you can`).then((r) => r !== null),
    quiet: (k, on) => void act("weekplan.nothing", { weekStart, clientKey: k, on }),
    keepOpen: (k, pct) => void act("settings.save", { section: "keep_open", values: { key: k, percent: pct } }, pct ? `Keeping ${pct}% of ${nameOf(k)}'s hours open for walk-ins` : `Planning all of ${nameOf(k)}'s hours`),
  };
  // NV-1: the Coop brief opens Break down's side panel (it copies there).
  const copyBrief = (k: string, id: number) => openCoopBrief(k, { id, title: "" }, weekStart);
  const toggleFold = (key: string) => setFolds((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  // Step 16.2: Done commits (or commits the changes again), then goes back to Week.
  const finish = async () => {
    if (!past && (!st.plan.committedAt || st.plan.changed) && (await act("weekplan.commit", { weekStart }, "Week confirmed")) === null) return;
    onClose();
  };
  // U6: J and K (or ↓ ↑ with nothing focused) move between clients; / goes to Search.
  keyRef.current = (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || topOverlay(document) !== "none" || isTypingTarget(e.target as HTMLElement | null)) return;
    const idle = !document.activeElement || document.activeElement === document.body || document.activeElement === head.current;
    if (e.key === "j" || e.key === "J" || (idle && e.key === "ArrowDown")) (e.preventDefault(), go(1));
    else if (e.key === "k" || e.key === "K" || (idle && e.key === "ArrowUp")) (e.preventDefault(), go(-1));
    else if (e.key === "/" && !past) (e.preventDefault(), search.current?.focus());
  };

  const keys = lines.map((l) => l.clientKey);
  const reordered = [...new Set(items.map((i) => i.clientKey))].filter((k) => items.some((i) => i.clientKey === k && i.position !== null));
  const counted = countedLines(lines);
  const planned = plannedCount(counted);
  const summary = past ? `${parts.when} · a review` : `${parts.when} · ${planned} of ${counted.length} client${counted.length === 1 ? "" : "s"} planned`;
  const moreMenu = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    openMenu({ x: r.right, y: r.bottom + 4 }, {
      title: "Plan the week",
      items: [
        ...(past ? [] : [{ id: "refresh", label: "Refresh DevOps", hint: "R", run: () => void load(true) }]),
        ...(st.plan.committedAt ? [{ id: "when", label: `Planned ${stamp(st.plan.committedAt, tz)}${st.plan.changed ? ", changed since" : ""}`, disabled: "When this week was last planned", expected: true }] : []),
        ...reordered.map((k) => ({ id: `reset:${k}`, label: `${nameOf(k)}: back to DevOps order`, run: () => ops.reset(k) })),
      ],
    });
  };

  const header = (
    <PlanHeader
      className="pw-head"
      step={{ prev: () => onWeek(prev), next: () => onWeek(next), prevLabel: "Previous week", nextLabel: "Next week", label: "Week", className: "co-step" }}
      title={parts.title}
      titleRef={head}
      summary={summary}
      summaryClass={`pw-when${st.plan.changed && !past ? " changed" : ""}`}
      secondary={
        past ? null : (
          <button type="button" className={`link-btn pw-health-link${flags.length ? " some" : ""}`} aria-expanded={panel?.kind === "health"} onClick={() => setPanel(panel?.kind === "health" ? null : { kind: "health" })}>
            DevOps health · {flags.length ? flags.length : "all good"}
          </button>
        )
      }
      more={{ label: "More for Plan the week", onClick: moreMenu }}
      mode={
        <ModeArea note={weekState(st.plan, past)} done={{ label: finishLabel(st.plan, past), title: past || (st.plan.committedAt && !st.plan.changed) ? "Back to the week (Esc)" : "Confirm this week's lists, then back to the week", onClick: () => void finish() }}>
          {switcher}
        </ModeArea>
      }
    />
  );

  const notices = (
    <>
      {error && <p className="set-problem" role="alert">{error} <button type="button" className="mini" onClick={() => setError(null)}>Dismiss</button></p>}
      {offer ? (
        <p className="co-notice pw-offer" role="status">
          #{offer.itemId} is out of the musts. Let {nameOf(offer.clientKey)} know?{" "}
          <button type="button" className="mini" onClick={() => void act("weekplan.headsup", offer, `Promise opened: heads-up to ${nameOf(offer.clientKey)}`).then(() => setOffer(null))}>Open a heads-up promise</button>{" "}
          <button type="button" className="mini quiet" onClick={() => setOffer(null)}>Not needed</button>
        </p>
      ) : (
        notice && <p className="co-notice" role="status">{notice}</p>
      )}

      <WeekCells days={days} fits={fits} items={items} open={openK} past={past} colors={data.clients} dragging={dragging} dragOver={dragOver} setDragOver={setDragOver}
        onOpen={setOpenK}
        onPin={(d, date, half) => {
          setDragOver(null);
          setDragging(null);
          pin(d.clientKey, d.itemId, date, half, true);
        }} />
    </>
  );

  // PL-1: "From last week" at the top of Commit (rows to accept, Watching with check-ins), the same as the Board's.
  // SW-1: "From your team" beside it (sent to me, client priorities, what I sent, Ask <lead> to look).
  const carryTop0 = !past && proposal.data && (
    <div className="pw-carry">
      <ProposalSection data={proposal.data} act={proposal.act} onRefresh={onChanged} colors={data.clients}>
        {proposal.error && <p className="error-line" role="alert">{proposal.error}</p>}
        <WatchingList watching={proposal.data.watching} act={proposal.act} colors={data.clients} nameOf={nameOf} days={checkinDays(data.week, data.planDay.date)} />
      </ProposalSection>
    </div>
  );
  const carryTop = (
    <>
      <FromYourTeam weekStart={weekStart} thisWeek={mondayOf(data.planDay.date)} version={version} colors={data.clients} onChanged={() => (void load(), onChanged())} {...(onOpenDay ? { onSchedule: onOpenDay } : {})} />
      {carryTop0}
    </>
  );
  const left0 =
    past && !items.length ? (
      <p className="muted pw-empty">Nothing was planned for this week.</p>
    ) : !lines.length ? (
      <p className="muted pw-empty">No client has blocks this week.</p>
    ) : (
      <ul className="pl-lines pw-lines" aria-label="Clients this week">
        {lines.map((l, n) =>
          l.clientKey === openK ? (
            <li key={l.clientKey} className="pw-open-card">
              <ClientCard k={l.clientKey} line={l} st={st} past={past} items={items} fit={fits.find((f) => f.clientKey === l.clientKey)} days={days} info={info} nameOf={nameOf} colors={data.clients} friday={friday}
                folds={folds} toggleFold={toggleFold} ops={ops} weekDrafts={weekDrafts.filter((w) => w.draft.clientKey === l.clientKey)} epics={flags.filter((f) => f.kind === "needs_features" && f.clientKey === l.clientKey && f.itemId !== null)}
                prevName={n > 0 ? nameOf(keys[n - 1]!) : null} nextName={n < keys.length - 1 ? nameOf(keys[n + 1]!) : null} onPrev={() => go(-1)} onNext={() => go(1)} onFinish={() => void finish()} />
            </li>
          ) : (
            <UnitLine key={l.clientKey} className="pw-line" color={clientColor(l.clientKey, data.clients)} name={nameOf(l.clientKey)} detail={lineDetail(l)} fit={l.fit ? fitWords(l.fit) : ""} tone={l.fit ? TONE[l.fit.status] : "fits"} onOpen={() => setOpenK(l.clientKey)} />
          ),
        )}
      </ul>
    );
  const left = (
    <>
      {carryTop}
      {left0}
    </>
  );

  const right =
    !past && open ? (
      <AddWeek key={`${weekStart}:${open.clientKey}`} k={open.clientKey} st={st} items={items} work={work} nameOf={nameOf} colors={data.clients} ops={ops} query={query} setQuery={setQuery} search={search} folds={folds} toggleFold={toggleFold} />
    ) : undefined;

  return (
    <WeekDates.Provider value={weekDates}>
    <OwnerPhotos.Provider value={photos.photoFor}>
    <PlanFrame
      as="main"
      className={`planweek${panel ? " with-panel" : ""}`}
      label="Plan the week"
      header={header}
      notices={notices}
      leftClass="pw-left"
      left={left}
      right={right}
      panel={
        panel && (
        <>
          {panel?.kind === "health" && (
            <PanelShell title="DevOps health" sub={flags.length ? `${flags.length} to look at` : "All good"} label="DevOps health" onClose={() => setPanel(null)}>
              {flags.length > 0 ? (
                <ul className="pw-ready">
                  {flags.map((f) => (
                    <ReadyRow key={`${f.kind}:${f.clientKey}:${f.itemId ?? f.pickId ?? ""}`} f={f} clientName={nameOf(f.clientKey)} tz={tz} drafts={f.itemId ? st.drafts.filter((d) => d.clientKey === f.clientKey && d.parentItemId === f.itemId) : []}
                      onBrief={() => void copyBrief(f.clientKey, f.itemId!)}
                      onMark={(on) => void act("feature.mark_breakdown", { clientKey: f.clientKey, itemId: f.itemId, on }, on ? `#${f.itemId} marked as being broken down` : undefined)}
                      onAsk={() => void act("followup.ask_priorities", { weekStart, clientKey: f.clientKey }, `Promise opened: ask ${nameOf(f.clientKey)} about priorities`)}
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
              drafts={st.drafts.filter((d) => d.clientKey === panel.k && d.parentItemId === panel.itemId)} listed={new Set(items.filter((i) => i.clientKey === panel.k).map((i) => i.itemId))} clientItems={items.filter((i) => i.clientKey === panel.k)} past={past} ops={ops} tz={tz} onClose={() => setPanel(null)} />
          )}
        </>
        )
      }
    />
    </OwnerPhotos.Provider>
    </WeekDates.Provider>
  );
}

/** "2 musts · 1 needs stories", "No musts yet" or "Nothing this week". */
function lineDetail(l: WeekLine): React.ReactNode {
  if (!l.musts) return l.quiet ? "Nothing this week" : "No musts yet";
  return (
    <>
      {l.musts} must{l.musts === 1 ? "" : "s"}
      {l.needs > 0 && <span className="pw-line-needs"> · {l.needs} need{l.needs === 1 ? "s" : ""} stories</span>}
    </>
  );
}

/**
 * U6: the week's half-days as a small grid, Mon to Fri, AM over PM. Each cell names its client on a colored edge;
 * a pinned must shows its title; PTO is hatched, Friday is
 * dashed Catch-up; the open client's cells read "Planning". Click a cell to open its client; drag a must onto one
 * of its client's cells (or an Open half-day) to pin it. PTO and other clients' cells don't take the drop.
 */
function WeekCells({ days, fits, items, open, past, colors, dragging, dragOver, setDragOver, onOpen, onPin }: {
  days: WeekLoadData["week"]["days"]; fits: ClientBudget[]; items: Item[]; open: string | null; past: boolean; colors: Record<string, string>;
  dragging: Drag | null; dragOver: string | null; setDragOver: (k: string | null) => void; onOpen: (k: string) => void; onPin: (d: Drag, date: IsoDate, half: Half) => void;
}) {
  const read = (e: DragEvent): Drag | null => {
    try {
      return JSON.parse(e.dataTransfer.getData(DRAG_TYPE)) as Drag;
    } catch {
      return null;
    }
  };
  return (
    <div className="pw-grid-wrap">
      <div className={`pw-grid${dragging ? " dragging" : ""}`} role="group" aria-label="The week's half-days">
        <span className="pw-grid-corner" aria-hidden="true" style={{ gridRow: 1, gridColumn: 1 }} />
        {days.map((d, col) => (
          <span key={d.date} style={{ gridRow: 1, gridColumn: col + 2 }} className="pw-grid-day" title={dateShort(d.date)}>{plainDate(d.date).toLocaleString("en-US", { weekday: "short" })} <span className="pw-grid-date">{plainDate(d.date).day}</span></span>
        ))}
        {(["AM", "PM"] as Half[]).map((half, row) => [
          <span key={`l${half}`} className="pw-grid-half" style={{ gridRow: row + 2, gridColumn: 1 }}>{half}</span>,
          ...days.map((d, col) => {
            const s = half === "AM" ? d.am : d.pm;
            const key = `${d.date}${half}`;
            const c = s.focus[0];
            const here = items.filter((f) => f.slots.some((x) => x.date === d.date && x.half === half));
            const pinText = here.length ? `${here[0]!.title}${here.length > 1 ? ` +${here.length - 1}` : ""}` : "";
            const at = { gridRow: row + 2, gridColumn: col + 2 } as CSSProperties;
            // PTO and a whole catch-up day are one cell over both halves, as on Week (U3).
            const whole = !!d.pto || d.kind === "overflow" || (d.am.off && d.pm.off);
            const allPins = items.filter((f) => f.slots.some((x) => x.date === d.date));
            if (whole && half === "PM") return null;
            // S1 (D453): PTO reads PTO, styled as on Week, and takes nothing; a must already pinned there stays, flagged.
            const ptoPins = (list: Item[]) => list.length > 0 && <span className="pw-cell-right pin warn">{`${list[0]!.title}${list.length > 1 ? ` +${list.length - 1}` : ""}`}</span>;
            const ptoLabel = (when: string, list: Item[]) => `${when}: PTO${list.length ? `, pinned ${list.map((f) => f.title).join(", ")}: move it` : ""}`;
            if (d.pto)
              return (
                <span key={key} className="pw-cell pto" style={{ gridRow: "2 / span 2", gridColumn: col + 2 }} title={d.pto.titles.join(", ")} aria-label={ptoLabel(dateShort(d.date), allPins)}>
                  PTO{ptoPins(allPins)}
                </span>
              );
            if (s.pto)
              return (
                <span key={key} className="pw-cell pto" style={at} title={d.ptoHalf?.titles.join(", ")} aria-label={ptoLabel(`${dateShort(d.date)} ${HALF_WORD[half]}`, here)}>
                  PTO{ptoPins(here)}
                </span>
              );
            if (whole)
              return (
                <span key={key} className="pw-cell catchup" style={{ gridRow: "2 / span 2", gridColumn: col + 2 }} aria-label={`${dateShort(d.date)}: Catch-up${allPins.length ? `, pinned ${allPins.map((f) => f.title).join(", ")}` : ""}`}>
                  Catch-up
                  {allPins.length > 0 && <span className="pw-cell-right pin">{`${allPins[0]!.title}${allPins.length > 1 ? ` +${allPins.length - 1}` : ""}`}</span>}
                </span>
              );
            if (!c && !s.open) return <span key={key} className="pw-cell catchup" style={at} aria-label={`${dateShort(d.date)} ${HALF_WORD[half]}: No block`}>No block</span>;
            const fb = c ? fits.find((f) => f.clientKey === c.clientKey)?.blocks.find((b) => b.date === d.date && b.half === half) : undefined;
            const free = fb ? `${hoursText(fb.freeMinutes)} free` : "";
            const mine = !!c && c.clientKey === open;
            const takes = !past && !!dragging && (c ? c.clientKey === dragging.clientKey : s.open);
            const refuses = !!dragging && !takes;
            const label = c ? c.clientName : "Open";
            const right = pinText || (mine ? "Planning" : "");
            return (
              <button key={key} type="button" style={{ ...at, "--c": clientColor(c?.clientKey, colors) } as CSSProperties}
                className={`pw-cell${c ? "" : " open-half"}${mine ? " on" : ""}${dragOver === key ? " over" : ""}${takes ? " takes" : ""}${refuses ? " refuses" : ""}`}
                aria-label={`${dateShort(d.date)} ${HALF_WORD[half]}: ${label}${free ? `, ${free}` : ""}${here.length ? `, pinned ${here.map((f) => f.title).join(", ")}` : ""}${mine ? ", planning" : ""}`}
                aria-pressed={mine}
                title={here.length ? `Pinned: ${here.map((f) => f.title).join(", ")}` : c ? `Plan ${c.clientName}${free ? ` · ${free}` : ""}` : "Open half-day: drag a must here to pin it"}
                onClick={() => c && onOpen(c.clientKey)}
                onDragOver={(e) => {
                  if (!takes || !e.dataTransfer.types.includes(DRAG_TYPE)) return;
                  e.preventDefault();
                  setDragOver(key);
                }}
                onDragLeave={() => setDragOver(null)}
                onDrop={(e) => {
                  const f = read(e);
                  if (!f || !takes) return;
                  e.preventDefault();
                  onPin(f, d.date, half);
                }}>
                <span className="pw-cell-name">{label}</span>
                {right && <span className={`pw-cell-right${pinText ? " pin" : mine ? " planning" : ""}`}>{right}</span>}
              </button>
            );
          }),
        ])}
      </div>
      <p className="pw-grid-hint">{past ? "What was pinned that week." : "Click to plan; drag a must here to pin."}</p>
    </div>
  );
}

/** U4: a client's budget in the panel: each block's free time, borrowed time, musts done, and DevOps order. */
function ClientPanel({ k, name, color, fit, progress, items, reordered, past, onReset, onClose }: { k: string; name: string; color: string; fit: ClientBudget | undefined; progress: Progress | undefined; items: Item[]; reordered: boolean; past: boolean; onReset: () => void; onClose: () => void }) {
  const done = items.filter((i) => i.done);
  return (
    <PanelShell title={name} sub={fit ? fit.text : undefined} color={color} label={`${name}: free time this week`} onClose={onClose}>
      {fit && (
        <section className="dp-section" aria-label="Blocks">
          <h3>Blocks</h3>
          <ul className="pw-pblocks">
            {fit.blocks.map((b) => (
              <li key={`${b.date}${b.half}`}>
                <span>{pinLabel(b)}</span>
                <span className="muted">{b.pto ? "PTO" : `${hoursText(b.freeMinutes)} free${b.open ? " · Open, pinned" : ""}`}</span>
              </li>
            ))}
          </ul>
          {fit.borrowedMinutes > 0 && <p className="dp-line">{hoursText(fit.borrowedMinutes)} of borrowed time to make up</p>}
          <p className="dp-line">Musts take {fit.plannedMinutes ? aboutText(fit.plannedMinutes) : "0h"}{fit.nicePlannedMinutes ? `, nice to haves ${aboutText(fit.nicePlannedMinutes)}` : ""}.</p>
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
function FeaturePanel({ k, itemId, info, item, color, name, drafts, listed, clientItems, past, ops, tz, onClose }: { k: string; itemId: number; info: Info | null; item: Item | null; color: string; name: string; drafts: DraftStory[]; listed: ReadonlySet<number>; clientItems: Item[]; past: boolean; ops: Ops; tz: string; onClose: () => void }) {
  const f = info?.feature ?? null;
  // E2: on the list, its load in hours: the stepper, or its stories' sizes (each with its chip).
  const envl = item ? (estimate(clientItems).envelopes.find((e) => e.feature.id === item.id) ?? null) : null;
  const title = item?.title ?? f?.title ?? `#${itemId}`;
  const stories = (f?.children ?? []).filter((c) => c.level === "story");
  const { weekStart } = useContext(WeekDates);
  void tz;
  return (
    <PanelShell title={title} sub={<>{info && <TypeIcon clientKey={k} type={info.type} />} {name} · #{itemId}{info ? ` · ${info.state}` : ""}</>} color={color} label={`Feature: ${title}`} onClose={onClose}>
      <section className="dp-section" aria-label="Dates">
        <h3>Dates</h3>
        {/* D461: one line; Set (or Change) is an inline link, not a full-width button. */}
        <p className="dp-line pw-dates">
          {f?.startDate ? `Starts ${dateShortIso(f.startDate)}` : "No start date"} · {f?.targetDate ? `target ${dateShortIso(f.targetDate)}` : "no target date"}
          {!past && (
            <>
              {" · "}
              <DevOpsAction clientKey={k} className="link-btn" label={f?.targetDate ? "Change" : "Set"} onRun={(w) => w.targetDate({ clientKey: k, itemId, title, current: f?.targetDate ?? null })} />
            </>
          )}
        </p>
      </section>
      {item && envl && (
        <section className="dp-section" aria-label="Estimate">
          <h3>Estimate</h3>
          <p className="dp-line dp-estimate">
            <HoursStepper label={title} minutes={envl.minutes} derived={envl.derived} about={loadText(envl).startsWith("about")} disabled={past} onSet={(h) => ops.hours(item, h)} />
            <span className="muted">{sourceWords(envl) ?? "your estimate this week"}</span>
          </p>
          {envl.stories.length > 0 && (
            <ul className="pw-pstories">
              {envl.stories.map((x) => (
                <li key={x.id}>
                  <SizeChip size={x.size} title={x.title} wide disabled={past} onSet={(z) => ops.size(x, z)} /> {x.title}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      <section className="dp-section" aria-label="Stories">
        <h3>Stories</h3>
        {stories.length ? (
          <ul className="pw-pstories">
            {stories.map((c) => (
              <li key={c.id} className={c.open ? "" : "closed"}>
                <WorkLink clientKey={k} url={c.url}>{c.title}</WorkLink>{" "}
                <span className="muted pw-story-meta">
                  {c.state} · <OwnerName name={c.assignedTo} email={c.assignedToEmail ?? null} mine={c.mine} />
                  {c.targetDate ? ` · ${dateInWeekWords(c.targetDate, weekStart)}` : ""}
                  {listed.has(c.id) ? " · on the list" : ""}
                </span>
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
            <BreakDown clientKey={k} item={{ id: itemId, title }} />
            <button type="button" className="link-btn" onClick={() => ops.brief(k, itemId)}>Coop brief</button>
            {drafts.length > 0 && <CreateInDevOps drafts={drafts.slice(0, 10)} label={`Create ${drafts.length === 1 ? "the draft" : `${Math.min(10, drafts.length)} drafts`} in DevOps`} />}
            {f && <WorkLink clientKey={k} url={f.url} className="mini">Open in DevOps</WorkLink>}
          </span>
        )}
      </section>
    </PanelShell>
  );
}

/** PL-1: Keep open on a client's card: "Keeping 30% open for walk-ins", or a quiet way to set it. */
const KEEP_STEPS = [0, 10, 20, 30, 40, 50] as const;
function KeepOpen({ k, name, pct, onSet }: { k: string; name: string; pct: number; onSet: (v: number | null) => void }) {
  const id = `keep-${k.replace(/[^A-Za-z0-9_-]/g, "_")}`;
  return (
    <p className={`pw-keep${pct ? " on" : ""}`}>
      {pct > 0 && <span className="pw-keep-text">Keeping {pct}% open for walk-ins</span>}
      <label className="pw-keep-set" htmlFor={id} title={`The share of ${name}'s block hours left unplanned, for work that walks in. Fit and the over line use what's left`}>
        {pct > 0 ? "Change" : "Keep open"}
      </label>
      <select id={id} className="pw-keep-select" value={KEEP_STEPS.includes(pct as (typeof KEEP_STEPS)[number]) ? pct : ""} aria-label={`Keep open for walk-ins, ${name}`} onChange={(e) => onSet(Number(e.target.value))}>
        {!KEEP_STEPS.includes(pct as (typeof KEEP_STEPS)[number]) && <option value="">{pct}%</option>}
        {KEEP_STEPS.map((v) => (
          <option key={v} value={v}>
            {v ? `${v}%` : "None"}
          </option>
        ))}
      </select>
    </p>
  );
}

/** A client's fit: "7h free · 9h planned", with the amber "about 2h over" when over. */
const fitWords = (fit: ClientBudget) => (
  <>
    {fit.text}
    {fit.over && <span className="over-word"> · {fit.over}</span>}
  </>
);

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
            {/* UI-8: Break down, the same panel as Ahead's Fix next (its AI switches and GD-1 guard), beside the Coop brief. */}
            {f.itemId !== null && <BreakDownButton clientKey={f.clientKey} item={{ id: f.itemId, title: f.title }} />}
            <button type="button" className="mini" onClick={onBrief}>Coop brief</button>
            {f.markedAt ? (
              <span className="muted">Being broken down since {stamp(f.markedAt, tz)} <button type="button" className="mini" onClick={() => onMark(false)}>Unmark</button></span>
            ) : (
              <button type="button" className="mini" onClick={() => onMark(true)}>Mark as being broken down</button>
            )}
          </>
        )}
        {f.kind === "intention_not_in_devops" && <button type="button" className="mini" onClick={onDraft}>Make it a draft story</button>}
        {f.kind === "captures_to_sort" && <button type="button" className="mini" onClick={onCaptures}>Sort captures</button>}
        {f.kind === "block_needs_work" && (f.followUpId ? <span className="muted">Promise open: ask about priorities (L)</span> : <button type="button" className="mini" onClick={onAsk}>Create a promise: ask about priorities</button>)}
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
  nameOf: (k: string) => string;
  add: (k: string, itemId: number, tier: Tier) => void;
  tier: (i: Item, tier: Tier) => void;
  remove: (i: Item) => void;
  hours: (i: Item, n: number) => void;
  size: (i: Item, z: "S" | "M" | "L" | null) => void;
  done: (i: Item, on: boolean) => void;
  move: (i: Item, by: -1 | 1) => void;
  /** Drag within a list: put `itemId` where `before` is. */
  reorderTo: (k: string, tier: Tier, itemId: number, before: number) => void;
  reset: (k: string) => void;
  pin: (k: string, itemId: number, date: IsoDate, half: Half, on: boolean) => void;
  brief: (k: string, id: number) => void;
  /** A row is being dragged: the grid shows which cells take it. */
  dragging: (d: Drag | null) => void;
  /** U4: open the detail panel on a feature, or on a client's budget. */
  feature: (k: string, itemId: number) => void;
  client: (k: string) => void;
  /** U6: a draft feature on the list: must, nice or off. */
  draftTier: (d: DraftStory, tier: Tier | "off") => void;
  /** D437: "Epic needs features · Draft feature" on the card: a draft feature under the epic, in the draft editor. */
  draftFeature: (k: string, epicId: number) => void;
  /** U6: the type box: a draft feature as a must (Enter) or a nice to have (Shift+Enter). Never a story. */
  typed: (k: string, title: string, tier: Tier) => Promise<boolean>;
  /** U6: Nothing this week for a client. */
  quiet: (k: string, on: boolean) => void;
  /** PL-1: this client's Keep open share (null: back to the level's default). */
  keepOpen: (k: string, pct: number | null) => void;
};

type CardProps = {
  k: string;
  line: WeekLine;
  st: WeekPlanState;
  past: boolean;
  items: Item[];
  fit: ClientBudget | undefined;
  days: WeekLoadData["week"]["days"];
  info: (k: string, id: number) => Info | null;
  nameOf: (k: string) => string;
  colors: Record<string, string>;
  friday: boolean;
  folds: Set<string>;
  toggleFold: (key: string) => void;
  ops: Ops;
  weekDrafts: { draft: DraftStory; tier: Tier }[];
  /** D437: its epics with no features (readiness), each one line at the top of the card. */
  epics: ReadinessFlag[];
  prevName: string | null;
  nextName: string | null;
  onPrev: () => void;
  onNext: () => void;
  onFinish: () => void;
};

/**
 * U6: the open client. Its name, blocks and fit once; MUST rows (a feature with its stories nested, or Needs stories
 * with Draft stories and Coop brief, and its blocks); the amber over line; Nice to have folded; Previous and Next
 * client (Done on the last).
 */
function ClientCard(p: CardProps) {
  const { k, fit } = p;
  const port = p.st.portfolios.find((x) => x.clientKey === k);
  // Step 16.4: features are envelopes; a story under a listed feature shows inside its row and takes its tier.
  const mineAll = p.items.filter((i) => i.clientKey === k);
  const est = estimate(mineAll);
  const envOf = new Map(est.envelopes.map((e) => [e.feature.id, e] as const));
  const nested = new Set(est.envelopes.flatMap((e) => e.stories.map((x) => x.id)));
  const listedFeatures = new Set(est.envelopes.map((e) => e.feature.itemId));
  const mine = mineAll.filter((i) => !nested.has(i.id));
  const musts = mine.filter((i) => i.tier === "must");
  const nice = mine.filter((i) => i.tier === "nice");
  const draftMusts = p.weekDrafts.filter((w) => w.tier === "must");
  const draftNice = p.weekDrafts.filter((w) => w.tier === "nice");
  const places = placesFor(p.days, k);
  const listed = new Set(mineAll.map((i) => i.itemId));
  const niceOpen = p.folds.has(`nice:${k}`);
  // PL-1: over against what it plans up to (Keep open and the plan share taken off), not the whole free time.
  const over = fit ? overLine(p.nameOf(k), fit.planUpTo ?? fit.freeMinutes, fit.plannedMinutes, p.friday) : null;
  const row = (i: Item, n: number, group: Item[]) => (
    <ItemRow key={i.id} i={i} ptoPinned={!p.past && i.tier === "must" && pinnedToPto({ days: p.days }, i.slots).length > 0} first={n === 0} last={n === group.length - 1} past={p.past} info={p.info(k, i.itemId)} drafts={p.st.drafts.filter((d) => d.clientKey === k && d.parentItemId === i.itemId)}
      places={places} ops={p.ops} env={envOf.get(i.id) ?? null} parentListed={i.parentId != null && listedFeatures.has(i.parentId)} infoOf={(id) => p.info(k, id)} listed={listed} />
  );
  const empty = !musts.length && !draftMusts.length;
  return (
    <UnitCard
      className="pw-client"
      color={clientColor(k, p.colors)}
      label={p.nameOf(k)}
      headClass="pw-card-head"
      name={
        <button type="button" className="pw-name" onClick={() => p.ops.client(k)} title="Its blocks, free time and what's done">
          {p.nameOf(k)}
        </button>
      }
      detail={lineDetail(p.line)}
      fit={fit && <span className={`pw-fit2 pw-budget ${fit.status}`} title={`Free focus time in ${p.nameOf(k)}'s blocks this week, after meetings${fit.borrowedMinutes ? " and borrowed time" : ""}. Nice to haves don't count against it`}>{fitWords(fit)}</span>}
      tone={fit ? TONE[fit.status] : "fits"}
      sub={port && (port.status !== "ok" || port.fromCache) ? `DevOps: ${port.status !== "ok" ? (port.message ?? port.status) : "from cache"}` : undefined}
    >
      {p.epics.map((f) => (
        <p key={f.itemId} className="pw-epic-line">
          <span className="pw-kind">Epic needs features</span> <WorkLink clientKey={k} url={f.url}>#{f.itemId} {f.title}</WorkLink>
          {!p.past && (
            <>
              {" · "}
              <button type="button" className="link-btn pw-draft-feature-btn" onClick={() => p.ops.draftFeature(k, f.itemId!)} title={`A draft feature under #${f.itemId}, in the draft editor`}>
                Draft feature
              </button>
            </>
          )}
        </p>
      ))}
      <div className="pw-tier">
        {!empty && <PlanLabel>Must</PlanLabel>}
        {empty ? (
          !p.past && (
            <p className="pw-empty-line">
              <button type="button" className="link-btn pw-quiet" aria-pressed={p.line.quiet} onClick={() => p.ops.quiet(k, !p.line.quiet)} title={p.line.quiet ? "Count it as not planned again" : "Nothing for this client this week: count it as planned"}>
                {p.line.quiet ? "Undo Nothing this week" : "Nothing this week"}
              </button>
            </p>
          )
        ) : (
          <ul className="pw-features">
            {musts.map((i, n) => row(i, n, musts))}
            {draftMusts.map((w) => <DraftRow key={`d${w.draft.id}`} d={w.draft} tier="must" past={p.past} ops={p.ops} />)}
          </ul>
        )}
        {over && !p.past && <p className="pw-over" role="status">{over}</p>}
        {fit && !p.past && <KeepOpen k={k} name={p.nameOf(k)} pct={fit.keepOpen ?? 0} onSet={(v) => p.ops.keepOpen(k, v)} />}
      </div>
      {nice.length + draftNice.length > 0 && (
        <div className="pw-tier pw-nice">
          <FoldLine className="pw-fold" open={niceOpen} onToggle={() => p.toggleFold(`nice:${k}`)} label="Nice to have" count={nice.length + draftNice.length} />
          {niceOpen && (
            <ul className="pw-features">
              {nice.map((i, n) => row(i, n, nice))}
              {draftNice.map((w) => <DraftRow key={`d${w.draft.id}`} d={w.draft} tier="nice" past={p.past} ops={p.ops} />)}
            </ul>
          )}
        </div>
      )}
      <div className="pw-card-foot">
        {p.prevName !== null && (
          <button type="button" className="link-btn pw-prev" onClick={p.onPrev} title={`${p.prevName} (K)`}>
            ‹ Previous
          </button>
        )}
        <span className="pl-spacer" />
        {p.nextName !== null ? (
          <button type="button" className="pw-next" onClick={p.onNext} title="Next client (J)">
            Next client: <span className="pw-next-name">{p.nextName}</span> ›
          </button>
        ) : (
          <button type="button" className="pw-next done-btn" onClick={p.onFinish} title={p.past ? "Back to the week" : "Confirm this week's lists, then back to the week"}>
            {finishLabel(p.st.plan, p.past)}
          </button>
        )}
      </div>
    </UnitCard>
  );
}

/** U6: a draft feature on the list: its Draft marker, the title (opens the draft editor), its one block and ⋯. */
function DraftRow({ d, tier, past, ops }: { d: DraftStory; tier: Tier; past: boolean; ops: Ops }) {
  const { open: openMenu } = useContext(MenuCtx);
  const other: Tier = tier === "must" ? "nice" : "must";
  const more = (e: React.MouseEvent) => {
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    openMenu({ x: r.right, y: r.bottom + 4 }, {
      title: d.title,
      items: [
        { id: "tier", label: other === "must" ? "Make it a must" : "Make it a nice to have", action: "weekplan.draft_tier", run: () => ops.draftTier(d, other) },
        { id: "off", label: "Take off the week", action: "weekplan.draft_tier", danger: true, run: () => ops.draftTier(d, "off") },
      ],
    });
  };
  return (
    <PlanRow className="pw-row pw-draft-row" handle={past ? null : "⋮⋮"} title={<DraftTitle draft={d} />} titleText={`${d.title} (draft feature, not in DevOps yet)`}
      badges={<span className="pw-draft-tag">Draft</span>}
      right={<span className="pw-chip-static">1 block</span>}
      hover={past ? undefined : <><CreateInDevOps drafts={[d]} label="Create in DevOps" /><button type="button" className="more" aria-label={`More for ${d.title}`} onClick={more}>⋯</button></>} />
  );
}

type AddProps = {
  k: string;
  st: WeekPlanState;
  items: Item[];
  work: readonly ClientWork[] | null;
  nameOf: (k: string) => string;
  colors: Record<string, string>;
  ops: Ops;
  query: string;
  setQuery: (q: string) => void;
  search: React.RefObject<HTMLInputElement | null>;
  folds: Set<string>;
  toggleFold: (key: string) => void;
};

/**
 * U6: "Add to <client>", following the open client. FROM DEVOPS (plan/weekadd.ts, D437): its features not on the list,
 * each with its open stories nested under it, and stories with no parent feature; each with + Must and Nice and its
 * type word. Never an epic (an epic with no features is a line on the card) and never a story on its own when it has
 * a feature. Search (Enter adds the first match as a must, Esc clears); the type box at the foot.
 */
function AddWeek({ k, st, items, work, nameOf, colors, ops, query, setQuery, search }: AddProps) {
  const q = query.trim().toLowerCase();
  const match = (i: { id: number; title: string }) => !q || i.title.toLowerCase().includes(q) || String(i.id).includes(q.replace(/^#/, ""));
  const port = st.portfolios.find((x) => x.clientKey === k);
  const w = work?.find((x) => x.clientKey === k);
  const listed = new Set(items.filter((i) => i.clientKey === k).map((i) => i.itemId));
  const rows = addPaneRows({ portfolio: port?.items ?? [], work: w?.items ?? [], listed });
  const shown = rows.filter((r) => match(r) || r.nested.some(match));
  const firstMatch = shown[0]?.id ?? null;
  const name = nameOf(k);
  return (
    <AddPane
      className="pw-addpane"
      color={clientColor(k, colors)}
      client={name}
      count={`${rows.length} of yours not on the list`}
      top={
        <input ref={search} type="search" className="pw-search pl-search" value={query} placeholder="Search" aria-label={`Search ${name}'s DevOps by title or number`}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
            if (e.key === "Escape" && query) {
              e.preventDefault();
              e.stopPropagation();
              setQuery("");
            } else if (e.key === "Enter" && q && firstMatch !== null) {
              e.preventDefault();
              ops.add(k, firstMatch, "must");
              setQuery("");
            }
          }} />
      }
      box={<TypeBox k={k} name={name} ops={ops} />}
    >
      <AddSection className="pw-add" label="From DevOps">
        {!port && !w && <p className="pw-empty-line">No DevOps for this client.</p>}
        {(port?.status === "ok" || w?.status === "ok") && !shown.length && (
          <p className="pw-empty-line">{q ? "Nothing matches." : listed.size ? "Everything of yours is on the list." : `Nothing in DevOps is assigned to you for ${name}.`}</p>
        )}
        <ul className="pw-features">
          {shown.map((r) => <AddRow key={r.id} k={k} row={r} ops={ops} />)}
        </ul>
      </AddSection>
    </AddPane>
  );
}

/** U6 (D414): "Type a feature for <client>, then Enter": a draft feature as a must; Shift+Enter a nice to have. */
function TypeBox({ k, name, ops }: { k: string; name: string; ops: Ops }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="pw-type">
      <input type="text" className="pw-type-input" value={text} maxLength={200} placeholder={`Type a feature for ${name}, then Enter`} aria-label={`A draft feature for ${name}`} disabled={busy}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && text) {
            e.preventDefault();
            e.stopPropagation();
            setText("");
            return;
          }
          if (e.key !== "Enter" || !text.trim()) return;
          e.preventDefault();
          setBusy(true);
          void ops.typed(k, text.trim(), e.shiftKey ? "nice" : "must").then((ok) => {
            setBusy(false);
            if (ok) setText("");
          });
        }} />
      <BoxHint>Enter saves a draft feature as a must. Shift+Enter: nice to have.</BoxHint>
    </div>
  );
}

function AddRow({ k, row, ops }: { k: string; row: AddRowInfo; ops: Ops }) {
  const { id, title, url } = row;
  return (
    <li className="pw-addrow" data-item={id}>
      <span className="pw-title" title={`#${id} ${title}`}>
        <TypeIcon clientKey={k} type={row.type} /> <WorkLink clientKey={k} url={url}>#{id} {title}</WorkLink>
        {row.targetDate && <span className="pw-meta"> · target {dateShortIso(row.targetDate)}</span>}
        {row.flag && <span className="pw-flagword"> · {row.flag}</span>}
      </span>
      <span className="pw-acts">
        <button type="button" className="mini pw-must" onClick={() => ops.add(k, id, "must")} aria-label={`Add #${id} as a must`}>+ Must</button>
        <button type="button" className="mini quiet pw-nice-btn" onClick={() => ops.add(k, id, "nice")} aria-label={`Add #${id} as a nice to have`}>Nice</button>
      </span>
      {row.nested.length > 0 && (
        <ul className="pw-add-kids" aria-label={`Stories under #${id}`}>
          {row.nested.map((c) => (
            <li key={c.id} className="pw-add-kid">
              <TypeIcon clientKey={k} type={c.type} /> <WorkLink clientKey={k} url={c.url}>#{c.id} {c.title}</WorkLink>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function ItemRow({ i, ptoPinned = false, first, last, past, info, drafts, places, ops, env: envl, parentListed, nestedIn, infoOf, listed }: {
  i: Item; /** S1 (D453): a must pinned to PTO: the amber line, never moved for the person. */ ptoPinned?: boolean; first: boolean; last: boolean; past: boolean; info: Info | null; drafts: DraftStory[]; places: Place[]; ops: Ops;
  /** A feature's envelope (its load in hours and the stories under it); a story nested in a feature's row. */
  env?: Envelope<Item> | null; parentListed?: boolean; nestedIn?: Item; infoOf?: (itemId: number) => Info | null; listed?: ReadonlySet<number>;
}) {
  const k = i.clientKey;
  const feature = info?.feature ?? null;
  const stories = feature ? feature.children.filter((c) => c.level === "story") : [];
  const openStories = stories.filter((c) => c.open).length;
  const needs = needsStories(i, info);
  // E1: its other open DevOps stories (not on the list) as one muted count line; the detail panel lists them.
  const rest = i.level === "feature" && !nestedIn ? otherStoriesLine(stories, listed ?? new Set()) : null;
  // D460: the other people behind "N assigned to others", as avatars; D461: the target date only when it matters this week.
  const owners = rest ? otherOwners(stories, listed ?? new Set()) : [];
  const dates = useContext(WeekDates);
  const lastBlock = places.reduce<IsoDate | null>((m, p) => (m === null || p.date > m ? p.date : m), null);
  const due = past || i.done ? null : rowDue(info?.target, { weekStart: dates.weekStart, today: dates.today, pinned: i.slots.map((x) => x.date), lastBlock });
  const derived = !!envl?.derived;
  const other: Tier = i.tier === "must" ? "nice" : "must";
  const { env, open: openMenu } = useContext(MenuCtx);
  const dw = useDevOpsWrite();
  const facts: WeekItemFacts = {
    itemId: i.itemId, title: i.title, clientName: ops.nameOf(k), tier: i.tier, level: i.level, first, last, past, done: i.done ? (i.done === "local" ? "local" : "other") : null, minutes: envl ? envl.minutes : (i.estimate ?? DEFAULT_FEATURE_MINUTES), derived, size: i.size, nested: !!nestedIn,
    places: places.map((pl) => ({ date: pl.date, half: pl.half, label: pl.label })), pinned: i.slots, openStories, targetDate: feature?.targetDate ?? null, drafts: drafts.length, canWrite: !!dw?.can(k),
  };
  const wops: WeekItemOps = {
    move: (by) => ops.move(i, by),
    tier: () => ops.tier(i, other),
    pin: (date, half, on) => ops.pin(k, i.itemId, date, half, on),
    hours: (n) => ops.hours(i, n),
    size: (z) => ops.size(i, z),
    done: (on) => ops.done(i, on),
    help: () => env?.openHelp({ clientKey: k, title: `#${i.itemId} ${i.title}`, url: i.url, itemId: i.itemId, pinned: i.slots[0]?.date ?? null }),
    ...(i.itemId > 0 ? { send: () => openSend({ clientKey: k, clientName: ops.nameOf(k), itemId: i.itemId, level: i.level === "story" ? "story" : "feature", title: i.title, itemType: i.itemType, url: i.url, parentId: i.parentId }) } : {}),
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
    <PlanRow
      className={`pw-row${i.done ? " done" : ""}${needs ? " needs" : ""}${nestedIn ? " nested" : ""}`}
      draggable={!past}
      onContextMenu={(e) => show(e, weekItemMenu(facts, wops))}
      onDragStart={(e) => {
        e.stopPropagation();
        const d: Drag = { clientKey: k, itemId: i.itemId, tier: i.tier };
        e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(d));
        e.dataTransfer.effectAllowed = "copyMove";
        setTimeout(() => ops.dragging(d), 0);
      }}
      onDragEnd={() => ops.dragging(null)}
      onDragOver={(e) => !past && e.dataTransfer.types.includes(DRAG_TYPE) && e.preventDefault()}
      onDrop={(e) => {
        ops.dragging(null);
        try {
          const f = JSON.parse(e.dataTransfer.getData(DRAG_TYPE)) as Drag;
          if (f.clientKey !== k || f.tier !== i.tier || f.itemId === i.itemId) return;
          e.preventDefault();
          e.stopPropagation();
          ops.reorderTo(k, i.tier, f.itemId, i.itemId);
        } catch {
          /* not a week item */
        }
      }}
      handle={nestedIn || past ? null : i.done ? "✓" : "⋮⋮"}
      handleTitle="Drag to reorder, or onto a block to pin it"
      titleText={`${i.title} · ${stateWord}`}
      icon={info?.type ?? i.itemType ? <TypeIcon clientKey={k} type={(info?.type ?? i.itemType)!} /> : undefined}
      title={i.level === "feature" ? (
        <button type="button" className="pw-open" onClick={() => ops.feature(k, i.itemId)} title={`${stateWord}. Stories, dates and the Coop brief`}>{i.title}</button>
      ) : (
        <WorkLink clientKey={k} url={i.url} title={stateWord}>{i.title}</WorkLink>
      )}
      badges={
        <>
          {i.done === "resolved" ? <ResolvedMark state={info?.state ?? null} /> : i.done && <span className="pw-done" title={DONE_WORD[i.done]}>✓</span>}
          {i.level === "feature" &&
            (needs ? (
              <span className="pw-needs">
                <span className="pw-needs-word">Needs stories</span>
                {!past && <BreakDown clientKey={k} item={{ id: i.itemId, title: i.title }} />}
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

          {ptoPinned && <span className="pw-pin-pto" role="note">{PINNED_TO_PTO}</span>}
          {due && <span className={`pw-due${due.late ? " late" : ""}`} title={due.title}>{due.text}</span>}
        </>
      }
      right={
        i.level === "feature" ? (
          derived ? (
            <HoursStepper className="pw-stepper" label={i.title} minutes={facts.minutes} derived about={envl ? loadText(envl).startsWith("about") : true} />
          ) : (
            <HoursStepper className="pw-stepper" label={i.title} minutes={facts.minutes} disabled={past} onSet={(h) => ops.hours(i, h)} />
          )
        ) : (
          <SizeChip className="pw-size" size={i.size} title={i.title} wide disabled={past} onSet={(z) => ops.size(i, z)} />
        )
      }
      hover={
        env ? (
          <button type="button" className="more" aria-label={`More for ${i.title}`} onClick={(e) => show(e, weekItemMenu(facts, wops))}>
            ⋯
          </button>
        ) : undefined
      }
    >
      {i.level === "story" && !nestedIn && i.parentId != null && !parentListed && (
        <span className="pw-parent">
          Under {infoOf?.(i.parentId)?.feature?.title ?? `#${i.parentId}`}
          {!past && <button type="button" className="link-btn" onClick={() => ops.add(i.clientKey, i.parentId!, i.tier)} title="Put its feature on the list; this story moves under it">Add the feature</button>}
        </span>
      )}
      {envl && (envl.doneMinutes > 0 || (sourceWords(envl) && !i.done)) && (
        <span className="pw-fill">
          {envl.doneMinutes > 0 && <span className="pw-progress-hours">{progressWords(envl)}</span>}
          {!i.done && sourceWords(envl) && <span>{sourceWords(envl)}</span>}
        </span>
      )}
      {envl && envl.stories.length > 0 && (
        <ul className="pw-nested" aria-label={`Stories in ${i.title}`}>
          {envl.stories.map((x) => (
            <ItemRow key={x.id} i={x} first last past={past} info={infoOf?.(x.itemId) ?? null} drafts={[]} places={places} ops={ops} nestedIn={i} />
          ))}
        </ul>
      )}
      {rest && (
        <button type="button" className="link-btn pw-kids" onClick={() => ops.feature(k, i.itemId)} title="Its other open stories in DevOps, not on the list: open the feature to see them">
          {rest}
          <OwnerStack owners={owners} />
        </button>
      )}
    </PlanRow>
  );
}
