// WD-2: the block panel, the one side panel for a block on Week and on Day (a bottom sheet on the phone). It replaces
// WD-1's Add work panel and U3's Details panel. From the top: "<client> · Wed AM" with the block's hours and room, a ⋯
// (Start a call, Timebox this day) and close; ON THIS BLOCK (the to-dos, each with its checkbox, title, size, + time
// and ⋯); the meetings line that opens the agenda in place; ADD, one box that searches the client's DevOps work and
// my promises and always ends with "New to-do" and "New draft story"; before typing, this week's features with their
// work Assigned to you grouped by feature, Promises, and More in <client> (collapsed); at the bottom, collapsed, To place and You sent.
// Rows use "+" (this block) or a drag onto any block; a to-do dragged from a block drops on the panel to come off the
// plan. Everything here writes only FocusTime's plan store, through named actions, with Undo.
import { useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { FollowUpView, WeekLoadData } from "../actions/types.ts";
import { DraftTitle } from "./DraftEditor.tsx";
import { CreateInDevOps, useDevOpsWrite } from "./DevOpsWrite.tsx";
import { BreakDownButton } from "./BreakDownPanel.tsx";
import { blockWord, removeRule, storiesUnder, toPlaceCount, toPlaceLine, toPlaceShort, type ToPlace as ToPlaceCounts } from "../plan/addwork.ts";
import { assignedList, draftParents, hoverWords, looseDrafts, meetingsWords, moreCount, moreList, moveHighlight, onBlock, panelClient, panelMode, panelTitle, panelWhen, placedMap, riskLine, searchPanel, takeOffRule, type AssignedGroup, type ListSort, type MoreGroup, type NewRow, type PanelMode, type Result } from "../plan/blockpanel.ts";
import { FoldLine } from "./plan/FoldLine.tsx";
import { planMinutes } from "../plan/fit.ts";
import { freeMinutes } from "../week/free.ts";
import { weekList } from "../plan/weeklist.ts";
import { dueOrder } from "../plan/due.ts";
import { rankRisks } from "../week/risks.ts";
import { addKey, type Dragged } from "../plan/weekdrop.ts";
import { isPickable } from "../plan/rules.ts";
import type { DraftStory, PlanDayState, Pick } from "../plan/types.ts";
import type { Half, IsoDate, Week, WorkItem } from "../week/types.ts";
import { clientColor, shortRange } from "./labels.ts";
import { slotOf } from "./halves.ts";
import { DevOpsWork, workStatusLabel } from "./work.ts";
import { TypeIcon } from "./TypeIcon.tsx";
import { PlanCtx } from "./planview.ts";
import { ItemTitleLink, WorkLink, NOTICE_EVENT } from "./WorkLink.tsx";
import { call, planAction } from "./api.ts";
import { DueBadge } from "./FollowUps.tsx";
import { callItems, itemMenu, openCoopBrief, weekItemMenu, type MenuItem, type MenuStep, type WeekItemFacts, type WeekItemOps } from "./menu.ts";
import { MenuCtx, useMenu } from "./Menus.tsx";
import { openSend } from "./send-event.ts";
import { DEFAULT_FEATURE_MINUTES } from "../plan/estimate.ts";
import { AddSection } from "./plan/AddPane.tsx";
import { CloseButton } from "./CloseButton.tsx";
import { WeekDnd, pickDragged, useDragSource } from "./WeekStories.tsx";
import { FromYourTeam, useTeamCommit } from "./Team.tsx";
import { CarryCtx, CarrySummary } from "./Carry.tsx";
import { FromLastWeek } from "./FromLastWeek.tsx";
import { useProposal } from "./Watching.tsx";
import { isTypingTarget, topOverlay } from "./keys.ts";
import { Agenda } from "./Agenda.tsx";
import { PickRow } from "./PickRow.tsx";
import { userZone } from "../week/zone.ts";
import { HalfScope } from "./scope.ts";
import type { PanelFocus } from "./weekctx.ts";
import type { AheadLoad } from "../actions/types.ts";
import { readPanelSort, writePanelSort } from "./daypanel.ts";
import { useDevOpsChanged } from "./DevOpsFresh.tsx";

const mondayOf = (d: IsoDate) => {
  const x = Temporal.PlainDate.from(d);
  return x.subtract({ days: x.dayOfWeek - 1 }).toString();
};
const say = (text: string) => window.dispatchEvent(new CustomEvent(NOTICE_EVENT, { detail: text }));
const errText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");

type WeekRows = ReturnType<typeof weekList<PlanDayState["weekFeatures"][number]>>["items"];

/**
 * "More in <client>": the rest of the client's open work, read once it is asked for (the fold opens, or the Add box is
 * typed in) from Ahead's read of the central store, by my own access. Kept a minute, so moving the panel doesn't reread.
 */
let moreCache: { at: number; load: AheadLoad } | null = null;
function useMore(clientKey: string | null, want: boolean, version: unknown): { items: WorkItem[] | null; error: string | null } {
  const [load, setLoad] = useState<AheadLoad | null>(() => (moreCache && Date.now() - moreCache.at < 60_000 ? moreCache.load : null));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!want || !clientKey) return;
    if (moreCache && Date.now() - moreCache.at < 60_000) return setLoad(moreCache.load);
    let live = true;
    call<AheadLoad>("ahead.load", {}).then(
      (r) => ((moreCache = { at: Date.now(), load: r }), live && (setLoad(r), setError(null))),
      (e: unknown) => live && setError(errText(e)),
    );
    return () => {
      live = false;
    };
  }, [want, clientKey, version]);
  const items = useMemo(() => {
    const c = clientKey ? load?.clients.find((x) => x.clientKey === clientKey) : undefined;
    if (!c) return load ? [] : null;
    const me = new Set((c.mine ?? []).map((m) => m.toLowerCase()));
    return c.items.filter((x) => x.inScope && x.level !== "task").map((x): WorkItem => ({
      id: x.id, title: x.title, type: x.type, state: x.state, stateCategory: x.stateCategory, level: x.level === "child" ? "story" : "portfolio", ...(x.level === "top" ? { tier: "epic" as const } : x.level === "parent" ? { tier: "feature" as const } : {}),
      order: x.order ?? null, parentId: x.parentId, changedAt: x.changedAt, url: x.url, assignedTo: x.assignee?.name ?? null, assignedToMe: !!x.assignee?.email && me.has(x.assignee.email.toLowerCase()), targetDate: x.target, size: x.size,
    }));
  }, [load, clientKey]);
  return { items, error };
}

type Ctx = {
  clientKey: string;
  at: { date: IsoDate; half: Half };
  /** Adds a row to the selected block, or moves it there when it is on another one (Week's drop rule, with Undo). */
  place: (d: Dragged) => Promise<void>;
  /** Where a row's thing is this week: here, or on another block (with its to-do's id), or nowhere. */
  where: (key: string) => { here: boolean; label: string; pickId: number; done: boolean } | null;
  /** The client's blocks this week (a feature's ⋯ › Pin to a block). */
  places: { date: IsoDate; half: "AM" | "PM"; label: string }[];
  /** A past week is a review. */
  past: boolean;
};

type Props = {
  at: { date: IsoDate; half: Half };
  /** The loaded week with its plan (the block's day is in it). */
  data: WeekLoadData;
  now: string;
  onClose: () => void;
  onChanged: () => void;
  /** Another block (a teammate's send scheduled). */
  onSelect: (date: IsoDate, half: Half) => void;
  /** The phone's bottom sheet. */
  sheet?: boolean;
  /** Opened from the notice line's Review: To place starts open. */
  placeOpen?: boolean;
  /** Bumped by "+ Add" and the A key: the cursor goes into the Add box. */
  focusAdd?: number;
  /** Opened on a to-do or a promise (a due badge): it is brought into view. */
  focus?: PanelFocus | null;
  /** Start focus on a to-do (today's blocks). */
  onStart?: ((p: Pick) => void) | undefined;
  /** The ⋯'s Timebox this day. */
  onTimebox?: ((date: IsoDate) => void) | undefined;
};

/** Break down on a Needs stories row: BD-1's side panel, labelled with the parent's type. */
export function BreakDown({ clientKey, item, short = false }: { clientKey: string; item: { id: number; title: string; type?: string }; short?: boolean }) {
  return <BreakDownButton clientKey={clientKey} item={item} short={short} />;
}

export function BlockPanel({ at, data, now, onClose, onChanged, onSelect, sheet = false, placeOpen = false, focusAdd = 0, focus = null, onStart, onTimebox }: Props) {
  const week: Week = data.week;
  const tz = userZone(data);
  const today = data.planDay.date;
  const thisWeek = data.today.weekStart;
  const colors = data.clients;
  const clients = data.planClients;
  const day = week.days.find((d) => d.date === at.date) ?? null;
  const slot = day ? slotOf(day, at.half) : null;
  const overflow = !!day && day.kind !== "work" && at.half !== "EVE";
  const block = overflow || !slot ? null : (slot.focus[0] ?? null);
  const mode: PanelMode = panelMode({ date: at.date, today, pto: !!day?.pto || !!slot?.pto, off: !day || (!!slot?.off && !overflow) });
  const ref = useRef<HTMLElement>(null);
  const dnd = useContext(WeekDnd);
  const pv = useContext(PlanCtx);
  const allWork = useContext(DevOpsWork);

  // The day's drafts and the week's list, for the Add list (not read on a past day or a day off: nothing is added there).
  const [state, setState] = useState<PlanDayState | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** DV-2: bumped when the block's client moves in DevOps, so the panel reads its lists again (quietly, in place). */
  const [moved, setMoved] = useState(0);
  useEffect(() => {
    if (mode !== "add") return setState(null);
    let live = true;
    setError(null);
    planAction("planday.start", { date: at.date }).then(
      (st) => live && setState(st),
      (e: unknown) => live && setError(errText(e)),
    );
    return () => {
      live = false;
    };
  }, [at.date, data, mode, moved]);

  // Esc closes the panel (not behind a menu or a dialog). In a text box it leaves the box first; the Add box has its own.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || topOverlay(document) !== "none") return;
      const t = e.target as HTMLElement | null;
      if (t && isTypingTarget(t) && ref.current?.contains(t)) return t.blur();
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  const dayPicks = pv.week?.[at.date]?.picks ?? state?.picks ?? [];
  const blockPicks = onBlock(dayPicks, at);
  const [chosen, setChosen] = useState<string | null>(null);
  useEffect(() => setChosen(null), [at.date, at.half]);
  const { clientKey, choose } = panelClient(block?.clientKey ?? null, chosen, blockPicks);
  // DV-2: like every other screen, through the shared hook: a change in this client's DevOps rereads the panel's own
  // lists. Its DevOps items come with the week load, which follows the same signal.
  useDevOpsChanged(clientKey ? [clientKey] : [], () => setMoved((n) => n + 1));
  const name = (k: string | null) => clients.find((c) => c.clientKey === k)?.clientName ?? week.days.flatMap((d) => [...d.am.focus, ...d.pm.focus]).find((f) => f.clientKey === k)?.clientName ?? k ?? "";
  const whole = !!day && (day.kind !== "work" || !!day.pto);
  // A PTO day reads PTO (its block, if any, stays in the data, read only).
  const title = panelTitle(clientKey && !day?.pto ? name(clientKey) : null, at.date, at.half, { wholeDay: whole, open: day?.pto ? "PTO" : overflow ? "Catch-up" : slot?.off ? "No working hours" : "Open" });
  const when = slot ? panelWhen(shortRange(slot, tz), mode, freeMinutes(slot), planMinutes(blockPicks, pv.sizes, pv.timeboxes, slot)) : null;
  const weekPicks = useMemo(() => Object.values(pv.week ?? {}).flatMap((d) => d.picks), [pv.week]);
  const placed = useMemo(() => placedMap(weekPicks, at), [weekPicks, at.date, at.half]); // eslint-disable-line react-hooks/exhaustive-deps
  const wholeOf = (d: IsoDate) => !!week.days.find((x) => x.date === d && (x.kind !== "work" || !!x.pto));

  const place = useCallback(
    async (d: Dragged) => {
      const b = dnd?.blocks.find((x) => x.date === at.date && x.half === at.half);
      if (dnd && b) return dnd.place(d, b);
      try {
        await planAction("pick.add", { date: at.date, half: at.half, clientKey: d.clientKey, ...(d.add ?? { itemId: d.itemId }), ...(d.size ? { size: d.size } : {}) });
        onChanged();
      } catch (e) {
        say(errText(e));
      }
    },
    [dnd, at.date, at.half, onChanged],
  );
  const ctx: Ctx | null = clientKey
    ? {
        clientKey,
        at,
        place,
        where: (key) => {
          const p = placed.get(key);
          return p ? { here: p.here, label: p.here ? "On this block" : blockWord(p.date, p.half, wholeOf(p.date)), pickId: p.pickId, done: p.done } : null;
        },
        places: week.days.flatMap((d) => (d.kind !== "work" || d.pto ? [] : (["AM", "PM"] as const).filter((h) => (h === "AM" ? d.am : d.pm).focus.some((f) => f.clientKey === clientKey)).map((h) => ({ date: d.date, half: h, label: blockWord(d.date, h) })))),
        past: week.weekStart < thisWeek,
      }
    : null;

  // The Add list and the search read one client's work only (GD-2).
  const work = clientKey ? allWork.get(clientKey) : undefined;
  const doneBy: WeekRows = useMemo(() => weekList(state?.weekFeatures ?? [], work ? [work] : null, pv.sizes).items, [state?.weekFeatures, work, pv.sizes]);
  const fus = clientKey ? dueOrder((pv.followUps ?? []).filter((f) => f.clientKey === clientKey), at.date, (f) => f.due, (f) => f.openedAt) : [];
  // WD-2 follow-up: backlog order or target date, remembered on this device.
  const [sort, setSort] = useState<ListSort>(() => readPanelSort());
  const onWeek = useMemo(() => new Set((state?.weekFeatures ?? []).filter((f) => f.clientKey === clientKey).map((f) => f.itemId)), [state?.weekFeatures, clientKey]);
  const groups = useMemo(() => (clientKey && state ? assignedList({ clientKey, work, drafts: state.drafts, weekPicks, onWeek, sort }) : null), [clientKey, state, work, weekPicks, onWeek, sort]);
  const loose = clientKey && state ? looseDrafts(clientKey, state.drafts, weekPicks) : [];
  // "More in <client>" is read when its fold opens or the Add box is typed in.
  const [wantMore, setWantMore] = useState(false);
  useEffect(() => setWantMore(false), [clientKey]);
  const more = useMore(clientKey, wantMore && mode === "add", data);

  // ⋯: what isn't about adding. Start (or Join) a call in the client's chats, and Timebox this day.
  const menu = useMenu((env): MenuStep => {
    const boxOff = mode !== "add" ? (mode === "past" ? "A past day keeps its record" : "Nothing to timebox on a day off") : data.timeboxSettings.enabled === false ? "Timeboxing is off in Settings › Planning" : null;
    const timebox: MenuItem = { id: "timebox-day", label: "Timebox this day", hint: "a time for each to-do", ...(boxOff ? { disabled: boxOff } : {}), run: () => onTimebox?.(at.date) };
    const order: MenuItem = { id: "sort", label: sort === "backlog" ? "Sort by target date" : "Sort by backlog order", hint: sort === "backlog" ? "now: backlog order" : "now: target date", run: () => { const next: ListSort = sort === "backlog" ? "target" : "backlog"; setSort(next); writePanelSort(next); } };
    return { title, items: [...callItems(env, clientKey), timebox, ...(mode === "add" ? [order] : [])] };
  });
  const risk = slot && mode === "add" ? riskLine(rankRisks(slot.risks)) : null;
  const [riskOpen, setRiskOpen] = useState(false);
  useEffect(() => setRiskOpen(false), [at.date, at.half]);

  // Opened on a to-do or a promise: bring it into view.
  const focusSel = !focus ? null : focus.kind === "pick" ? `[data-pick="${focus.id}"]` : focus.kind === "followup" ? `[data-promise="${focus.id}"]` : null;
  const listed1 = !!groups;
  useEffect(() => {
    if (!focusSel) return;
    const el = ref.current?.querySelector(focusSel);
    el?.scrollIntoView({ block: "nearest" });
    ref.current?.querySelectorAll(".dp-focused").forEach((x) => x.classList.remove("dp-focused"));
    el?.classList.add("dp-focused");
  }, [focusSel, at.date, at.half, listed1]);

  const meetings = slot && !day?.pto ? meetingsWords(slot.events.map((e) => ({ minutes: Math.round((Date.parse(e.clipEnd) - Date.parse(e.clipStart)) / 60000), free: e.event.showAs === "free" }))) : null;
  const [agendaOpen, setAgendaOpen] = useState(false);
  const firstPlanned = blockPicks.find((p) => p.status === "planned")?.id ?? null;
  const note = clientKey ? data.resumeNotes[clientKey] : undefined;
  const monday = mondayOf(at.date);

  return (
    <aside ref={ref} className={`block-panel${sheet ? " sheet" : ""}`} aria-label={`${title}: this block`} data-block-panel={`${at.date}|${at.half}`} data-tour="aw-panel" style={{ "--c": clientColor(clientKey ?? undefined, colors) } as CSSProperties}>
      <header className="bp-head">
        <div className="bp-title">
          <h2>
            {clientKey && !day?.pto && <span className="swatch" aria-hidden="true" />}
            {title}
          </h2>
          {when && <p className={`bp-when${when.over ? " over" : ""}`}>{when.text}</p>}
          {/* One status line at most: the reasons show on hover and open in place on a click. */}
          {risk && (
            <button type="button" className={`bp-risk ${risk.severity}`} aria-expanded={riskOpen} title={risk.reasons.join("\n")} onClick={() => setRiskOpen((o) => !o)}>
              {risk.text}
            </button>
          )}
          {risk && riskOpen && (
            <ul className="bp-risks">
              {risk.reasons.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          )}
        </div>
        <HalfScope.Provider value={true}>{menu.button(`More for ${title}`)}</HalfScope.Provider>
        <CloseButton onClose={onClose} />
      </header>
      {choose && mode === "add" && clients.length > 0 && (
        <div className="client-chooser aw-chooser" role="group" aria-label="Which client">
          {clients.map((c) => (
            <button key={c.clientKey} type="button" className="chip-btn" aria-pressed={clientKey === c.clientKey} style={{ "--c": clientColor(c.clientKey, colors) } as CSSProperties} onClick={() => setChosen(c.clientKey)}>
              <span className="swatch" />
              {c.clientName}
            </button>
          ))}
        </div>
      )}
      <div className="aw-scroll">
        {error && <p className="pd-error" role="alert">{error}</p>}
        {day?.pto && <p className="bp-line">Whole day off · {day.pto.titles.join(", ")}</p>}
        {slot?.focus.slice(1).map((b) => (
          <p key={b.id} className="bp-line">Also booked: {b.clientName}</p>
        ))}

        <section className="bp-sec bp-on" aria-label="On this block">
          <h3 className="pl-label">On this block</h3>
          {blockPicks.length > 0 ? (
            <ul className="bp-todos checklist">
              {blockPicks.map((p) => (
                <PanelTodo
                  key={p.id}
                  pick={p}
                  mode={mode}
                  today={today}
                  focused={focus?.kind === "pick" && focus.id === p.id}
                  extra={onStart && at.date === today && p.id === firstPlanned && !data.timer ? (
                    <button type="button" className="mini dp-start" onClick={() => onStart(p)} title="Start focus on this to-do">
                      Start focus
                    </button>
                  ) : undefined}
                />
              ))}
            </ul>
          ) : (
            <p className="bp-empty">Nothing here yet.</p>
          )}
          {note && mode !== "off" && <p className="bp-line bp-note" title="Where you left off last time">Left off: {note.note}</p>}
        </section>

        {meetings && slot && (
          <section className="bp-sec bp-meetings" aria-label="Meetings">
            <FoldLine className="bp-meet-line" open={agendaOpen} onToggle={() => setAgendaOpen((o) => !o)} label={meetings} />
            {agendaOpen && <Agenda slot={slot} now={now} tz={tz} clientName={(k) => (k ? name(k) : "")} pickRow={() => null} />}
          </section>
        )}

        {mode === "add" && (
          <section className="bp-sec bp-add" aria-label="Add" data-tour="aw-box">
            <h3 className="pl-label">Add</h3>
            {!clientKey ? (
              <p className="muted aw-note">Choose a client for this block first.</p>
            ) : !state || !ctx || !groups ? (
              !error && <p className="muted aw-note">Loading…</p>
            ) : (
              <AddBox ctx={ctx} groups={groups} drafts={state.drafts} followUps={fus} work={work} more={more.items} onTyping={() => setWantMore(true)} clientName={name(clientKey)} focusAdd={focusAdd} onClose={onClose} onChanged={onChanged}>
                <AddListView ctx={ctx} groups={groups} promises={fus} more={more} sort={sort} onWantMore={() => setWantMore(true)} state={state} doneBy={doneBy} name={name} focus={focus} onChanged={onChanged} />
              </AddBox>
            )}
            {clientKey && work && work.status !== "ok" && <p className="muted aw-note">DevOps {workStatusLabel(work)}{work.message ? `: ${work.message}` : ""}</p>}
            {clientKey && !work && <p className="muted aw-note">DevOps isn't loaded for {name(clientKey)} right now.</p>}
          </section>
        )}
        {mode === "past" && <p className="muted aw-note bp-past">A past day: tick what got done, or move what didn't to today.</p>}

        {mode === "add" && (
          <div className="bp-foot">
            <ToPlace data={data} at={at} ctx={ctx} loose={loose} nameOf={(k) => name(k)} onChanged={onChanged} onSelect={onSelect} startOpen={placeOpen} />
            {monday >= thisWeek && <YourSends weekStart={monday} thisWeek={thisWeek} version={data} colors={colors} onChanged={onChanged} />}
          </div>
        )}
      </div>
      <TakeOffZone />
    </aside>
  );
}

/** One of the block's to-dos: checkbox, type icon, title (opens the story card), size, + time and ⋯. Drags to another block, or onto the panel to come off. */
function PanelTodo({ pick, mode, today, focused, extra }: { pick: Pick; mode: PanelMode; today: IsoDate; focused: boolean; extra?: ReactNode }) {
  const pv = useContext(PlanCtx);
  const dnd = useContext(WeekDnd);
  const drag = useDragSource(mode === "off" ? null : pickDragged(pick));
  // A past day: one button moves what isn't done to the client's next block (today when it has one).
  const d = mode === "past" ? pickDragged(pick) : null;
  const to = d && dnd ? (dnd.blocks.find((b) => b.date >= today && b.slot.focus[0]?.clientKey === pick.clientKey && dnd.check(d, b).ok) ?? dnd.blocks.find((b) => b.date >= today && dnd.check(d, b).ok) ?? null) : null;
  return (
    <PickRow
      pick={pick}
      toggle={pv.toggle}
      link
      typeIcon
      canTick={pick.date <= today}
      timeEditable={mode === "add"}
      readOnly={mode !== "add"}
      className={focused ? "dp-focused" : ""}
      dragProps={drag}
      extra={
        <>
          {extra}
          {d && to && dnd && (
            <button type="button" className="mini bp-forward" onClick={() => void dnd.place(d, to)} title={`Move it to ${to.label}`}>
              {to.date === today ? "Move to today" : `Move to ${to.label}`}
            </button>
          )}
        </>
      }
    />
  );
}

/** While a to-do is dragged from a block: the panel's one drop area. Dropping takes it off the plan (never Drop). */
function TakeOffZone() {
  const dnd = useContext(WeekDnd);
  const [over, setOver] = useState(false);
  const d = dnd?.dragging;
  useEffect(() => {
    if (!d) setOver(false);
  }, [d]);
  const pv = useContext(PlanCtx);
  if (!dnd || !d || d.pickId === undefined) return null;
  const pickId = d.pickId;
  // Only for a to-do that can come off (not a past day's, a done one or a deployment).
  const p = Object.values(pv.week ?? {}).flatMap((x) => x.picks).find((x) => x.id === pickId);
  if (!p || !takeOffRule(p, pv.today ?? "").ok) return null;
  return (
    <div
      className={`bp-takeoff${over || dnd.hover === "takeoff" ? " over" : ""}`}
      data-takeoff=""
      role="region"
      aria-label="Take off the plan"
      onDragEnter={(e) => (e.preventDefault(), setOver(true))}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (!over) setOver(true);
      }}
      onDragLeave={(e) => {
        if (!(e.currentTarget as Node).contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        dnd.end();
        void dnd.takeOff(pickId);
      }}
    >
      <strong>Take off the plan</strong>
      <span>Drop it here. It leaves this block and goes back to not placed.</span>
    </div>
  );
}

/**
 * The one Add box. Typing searches this client's DevOps work, drafts and my promises; the last rows are always
 * "New to-do: <text>" and "New draft story: <text>" (under a chosen feature). Up and Down move, Enter takes the
 * highlighted row; with no match the highlight starts on "New to-do". Before typing, its children (the Add list) show.
 */
function AddBox({ ctx, groups, drafts, followUps, work, more, onTyping, clientName, focusAdd, onClose, onChanged, children }: { ctx: Ctx; groups: readonly AssignedGroup[]; more: readonly WorkItem[] | null; onTyping: () => void; drafts: readonly DraftStory[]; followUps: readonly FollowUpView[]; work: Parameters<typeof searchPanel>[0]["work"]; clientName: string; focusAdd: number; onClose: () => void; onChanged: () => void; children: ReactNode }) {
  const { clientKey, at } = ctx;
  const [query, setQuery] = useState("");
  const [hl, setHl] = useState(0);
  const [parent, setParent] = useState<number | null>(null);
  const busy = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => (setQuery(""), setHl(0), setParent(null)), [clientKey, at.date, at.half]);
  // "+ Add" and A put the cursor in the box (each press; opening by a click on the block doesn't).
  useEffect(() => {
    if (focusAdd) input.current?.focus({ preventScroll: true });
  }, [focusAdd, at.date, at.half]);
  const model = useMemo(() => searchPanel({ clientKey, work, followUps, drafts, ...(more ? { more } : {}) }, query), [clientKey, work, followUps, drafts, more, query]);
  const { open: openMenu } = useContext(MenuCtx);
  const rows: (Result<FollowUpView> | NewRow)[] = model ? [...model.results, ...model.news] : [];
  useEffect(() => setHl(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector(".hl")?.scrollIntoView({ block: "nearest" });
  }, [hl]);
  const parents = draftParents(groups);
  // Only a feature the select shows now (the week's list can change under it).
  const under = parents.some((p) => p.id === parent) ? parent : null;

  const add = async (key: string, d: Dragged) => {
    const w = ctx.where(key);
    if (w?.here || w?.done) say(w.here ? `${d.title} is already on this block` : `${d.title} is done on ${w.label}`);
    else await ctx.place(w ? { ...d, pickId: w.pickId } : d);
  };
  const take = async (r: Result<FollowUpView> | NewRow) => {
    if (busy.current) return;
    busy.current = true;
    // The box clears at once, so what is typed next while this one saves isn't wiped; a failure puts the words back.
    const typed = query;
    setQuery("");
    try {
      if (r.kind === "story") await add(r.key, { clientKey, itemId: r.item.id, size: null, title: r.item.title });
      else if (r.kind === "promise") await add(r.key, { clientKey, itemId: addKey({ followUpId: r.followUp.id }), size: null, title: r.followUp.what, add: { followUpId: r.followUp.id } });
      else if (r.kind === "todo") await ctx.place({ clientKey, itemId: addKey({ intention: r.text }), size: null, title: r.text, add: { intention: r.text } });
      else if ("draft" in r) await add(r.key, { clientKey, itemId: addKey({ draftId: r.draft.id }), size: r.draft.size, title: r.draft.title, add: { draftId: r.draft.id } });
      else {
        const made = await call<{ draft: { id: number } }>("draft.add_story", { clientKey, parentItemId: under, title: r.text });
        await ctx.place({ clientKey, itemId: addKey({ draftId: made.draft.id }), size: null, title: r.text, add: { draftId: made.draft.id } });
        onChanged();
      }
      input.current?.focus({ preventScroll: true });
    } catch (e) {
      say(errText(e));
      setQuery((q) => q || typed);
    } finally {
      busy.current = false;
    }
  };
  return (
    <div className="bp-addbox">
      <input
        ref={input}
        className="bp-box pl-search"
        type="text"
        role="combobox"
        aria-expanded={!!model}
        aria-controls={model ? "bp-results" : undefined}
        aria-autocomplete="list"
        aria-activedescendant={model && rows[hl] ? `bp-row-${hl}` : undefined}
        value={query}
        maxLength={200}
        placeholder={`Search ${clientName}'s work, or type a new to-do`}
        aria-label={`Add to ${blockWord(at.date, at.half)}: search ${clientName}'s work or type a new to-do`}
        onChange={(e) => (setQuery(e.target.value), e.target.value && onTyping())}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            e.nativeEvent.stopImmediatePropagation();
            if (query) setQuery("");
            else onClose();
          } else if (!model) return;
          else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            e.stopPropagation();
            setHl((h) => moveHighlight(h, e.key === "ArrowDown" ? 1 : -1, rows.length));
          } else if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            const r = rows[Math.min(hl, rows.length - 1)];
            if (r) void take(r);
          }
        }}
      />
      {!model ? (
        children
      ) : (
        <ul ref={listRef} id="bp-results" className="bp-results aw-list" role="listbox" aria-label="Matches and new">
          {model.results.map((r, i) => {
            const w = ctx.where(r.key);
            return (
              <li key={r.key} id={`bp-row-${i}`} role="option" aria-selected={hl === i} className={`aw-row bp-result${hl === i ? " hl" : ""}${w?.here ? " placed" : ""}`} onMouseEnter={() => setHl(i)} onClick={() => void take(r)}>
                {r.kind === "story" ? <TypeIcon clientKey={clientKey} type={r.item.type} decorative /> : <span className="aw-type">{r.kind === "draft" ? "Draft" : "Promise"}</span>}
                <span className="aw-row-title" title={r.kind === "story" ? `${r.item.type} ${r.item.id} · ${r.item.state}${r.under ? ` · ${r.under}` : ""}` : undefined}>
                  {r.kind === "story" ? r.item.title : r.kind === "draft" ? r.draft.title : `${r.followUp.hasWho ? `${r.followUp.who}: ` : ""}${r.followUp.what}`}
                </span>
                {w && <span className="aw-where">{w.label}</span>}
              </li>
            );
          })}
          {model.more > 0 && <li className="muted aw-note bp-more" role="presentation">{model.more} more. Keep typing.</li>}
          {model.news.map((n, k) => {
            const i = model.results.length + k;
            return (
              <li key={n.key} id={`bp-row-${i}`} role="option" aria-selected={hl === i} className={`aw-row bp-result bp-new${hl === i ? " hl" : ""}`} onMouseEnter={() => setHl(i)} onClick={() => void take(n)}>
                <span className="aw-plus" aria-hidden="true">+</span>
                <span className="aw-row-title">{n.label}</span>
                {n.kind === "draft" && parents.length > 1 && (
                  // The app's own menu (no browser select): which feature the draft story goes under.
                  <button
                    type="button"
                    className="link-btn bp-parent"
                    aria-haspopup="menu"
                    aria-label={`Under which feature: ${parents.find((p) => p.id === under)?.title ?? "No feature yet"}`}
                    title="The feature the draft story goes under"
                    onClick={(e) => {
                      e.stopPropagation();
                      const r = e.currentTarget.getBoundingClientRect();
                      openMenu({ x: r.left, y: r.bottom + 4 }, { title: "Under which feature", items: parents.map((p) => ({ id: `p${p.id ?? "none"}`, label: p.title, checked: p.id === under, run: () => setParent(p.id) })) });
                    }}
                  >
                    {under === null ? "No feature yet" : `under ${parents.find((p) => p.id === under)!.title}`} ▾
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * Before typing: "Assigned to you" (my features and my stories, grouped by feature), Promises, and "More in <client>"
 * (the rest of the client's open work, collapsed).
 */
function AddListView({ ctx, groups, promises, more, sort, onWantMore, state, doneBy, name, focus, onChanged }: { ctx: Ctx; groups: readonly AssignedGroup[]; promises: readonly FollowUpView[]; more: { items: WorkItem[] | null; error: string | null }; sort: ListSort; onWantMore: () => void; state: PlanDayState; doneBy: WeekRows; name: (k: string | null) => string; focus: PanelFocus | null; onChanged: () => void }) {
  const { clientKey, at } = ctx;
  const pv = useContext(PlanCtx);
  const work = useContext(DevOpsWork).get(clientKey);
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => setMoreOpen(false), [clientKey]);
  const weekRows = state.weekFeatures.filter((f) => f.clientKey === clientKey);
  const weekPicks = Object.values(pv.week ?? {}).flatMap((d) => d.picks);
  const weekStart = mondayOf(at.date);
  const act = async (action: string, input: Record<string, unknown>, done: string) => {
    try {
      await call(action, input);
      say(done);
      onChanged();
    } catch (e) {
      say(errText(e));
    }
  };
  const remove = (f: WorkItem) => {
    const row = weekRows.find((x) => x.itemId === f.id);
    if (row?.id === undefined) return;
    const kids = new Set(storiesUnder(work, f.id));
    const r = removeRule({ clientKey, itemId: f.id, slots: row.slots }, kids, weekPicks, state.drafts);
    if (!r.ok) {
      say(`${f.title} is placed on ${r.where.join(", ")}. Take those off first.`);
      return;
    }
    void act("weekplan.remove", { id: row.id }, `${f.title} is off this week`);
  };
  const addToWeek = (item: WorkItem) => void act("weekplan.add", { weekStart, clientKey, itemId: item.id }, `${item.title} added to this week`);
  // A feature on this week's list keeps its ⋯ (Move, Estimate, Pin, Mark done, Ask to collaborate, Send to…, the
  // target date, the Coop brief, Remove); one that isn't offers Add to this week and the item's own menu.
  const { env } = useContext(MenuCtx);
  const dw = useDevOpsWrite();
  const menuFor = (g: AssignedGroup): MenuStep | null => {
    const f = g.feature!;
    const row = weekRows.find((x) => x.itemId === f.id);
    const li = doneBy.find((x) => x.itemId === f.id);
    if (row?.id === undefined || !li) return null;
    const id = row.id;
    const facts: WeekItemFacts = {
      itemId: f.id, title: f.title, clientName: name(clientKey), level: "feature", past: ctx.past,
      done: li.done ? (li.done === "local" ? "local" : "other") : null, minutes: row.estimate ?? DEFAULT_FEATURE_MINUTES, size: null, places: ctx.places, pinned: [...row.slots], openStories: g.total, targetDate: f.targetDate ?? null, drafts: g.drafts.length, canWrite: !!dw?.can(clientKey),
    };
    const ops: WeekItemOps = {
      pin: (date, half, on) => void act("weekplan.place", { weekStart, clientKey, itemId: f.id, date, half, on }, on ? `Pinned to ${blockWord(date, half)}` : "Unpinned"),
      hours: (n) => void act("weekplan.set_estimate", { id, hours: n }, `${f.title}: about ${n}h`),
      done: (on) => void act("weekplan.mark_done", { id, on }, on ? `${f.title} marked done` : `${f.title} not done`),
      help: () => env?.openHelp({ clientKey, title: `#${f.id} ${f.title}`, url: f.url, itemId: f.id, pinned: row.slots[0]?.date ?? null }),
      send: () => openSend({ clientKey, clientName: name(clientKey), itemId: f.id, level: "feature", title: f.title, itemType: f.type, url: f.url, parentId: f.parentId }),
      targetDate: () => dw?.targetDate({ clientKey, itemId: f.id, title: f.title, current: f.targetDate ?? null }),
      brief: () => openCoopBrief(clientKey, { id: f.id, title: f.title }, weekStart),
      createDrafts: () => dw?.create(clientKey, g.drafts.slice(0, 10)),
      enableWrites: () => dw?.enable(clientKey),
      remove: () => remove(f),
    };
    return weekItemMenu(facts, ops, pv.sizes);
  };
  const pinnedHere = (id: number) => !!weekRows.find((x) => x.itemId === id)?.slots.some((sl) => sl.date === at.date && sl.half === at.half);
  const shown = useMemo(() => new Set(groups.flatMap((g) => [...(g.feature ? [g.feature.id] : []), ...g.stories.map((x) => x.id), ...g.others.map((x) => x.id)])), [groups]);
  const rest: MoreGroup[] | null = useMemo(() => (more.items ? moreList(more.items, shown, sort) : null), [more.items, shown, sort]);
  return (
    <>
      <AddSection className="aw-sec aw-features bp-assigned" label="Assigned to you" tour="aw-features">
        {groups.length > 0 ? (
          <ul className="aw-list">
            {groups.map((g) => (
              <Group key={g.feature?.id ?? "none"} g={g} ctx={ctx} pinnedHere={g.feature ? pinnedHere(g.feature.id) : false} onWeek={!!g.feature && weekRows.some((x) => x.itemId === g.feature!.id)} onAddToWeek={g.feature ? () => addToWeek(g.feature!) : undefined} menuOf={() => (g.feature ? menuFor(g) : null)} />
            ))}
          </ul>
        ) : (
          work && <p className="muted aw-note">Nothing open is assigned to you for {name(clientKey)}. Type to add a to-do.</p>
        )}
      </AddSection>
      {promises.length > 0 && (
        <AddSection className="aw-sec" label="Promises">
          <ul className="aw-list">
            {promises.map((f) => (
              <AddRow key={f.id} ctx={ctx} k={`f${f.id}`} promise={f.id} focused={focus?.kind === "followup" && focus.id === f.id} d={{ clientKey, itemId: addKey({ followUpId: f.id }), size: null, title: f.what, add: { followUpId: f.id } }}>
                <a className="aw-row-title bp-promise" href={`#/inbox/item/f${f.id}`} title="Open it in the Inbox">{f.hasWho ? `${f.who}: ` : ""}{f.what}</a>
                <DueBadge l={f} />
              </AddRow>
            ))}
          </ul>
        </AddSection>
      )}
      <section className="pl-sec aw-sec bp-other" aria-label={`More in ${name(clientKey)}`}>
        <FoldLine open={moreOpen} onToggle={() => (setMoreOpen((o) => !o), onWantMore())} label={`More in ${name(clientKey)}`} count={rest ? moreCount(rest) : undefined} title={`Everything else open in ${name(clientKey)}'s DevOps: other people's features and stories`} />
        {moreOpen && (rest ? (
          rest.length > 0 ? (
            <ul className="aw-list">
              {rest.map((g) => (
                <li key={g.feature?.id ?? "none"} className="aw-group">
                  <span className="aw-group-title" title={g.feature ? hoverWords(g.feature) : undefined}>
                    {g.feature ? <TypeIcon clientKey={clientKey} type={g.feature.type} /> : null} <span className="aw-row-title">{g.feature?.title ?? "No feature"}</span>
                    {g.feature && <span className="aw-who">{g.feature.assignedTo ?? "Unassigned"}</span>}
                  </span>
                  {g.stories.length > 0 && (
                    <ul>
                      {g.stories.map((k) => <ItemAdd key={k.id} item={k} ctx={ctx} take />)}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted aw-note">Nothing else open in {name(clientKey)}.</p>
          )
        ) : (
          <p className="muted aw-note">{more.error ?? "Loading…"}</p>
        ))}
      </section>
    </>
  );
}

/**
 * To place, collapsed at the bottom: what waits for a block. The client's drafts with no feature that aren't on a
 * block (a plain to-do taken off the plan is one), the unfinished to-dos and their suggested cards, From last week,
 * and what teammates sent. It opens when the notice line's Review opened the panel. A past week shows none.
 */
function ToPlace({ data, at, ctx, loose, nameOf, onChanged, onSelect, startOpen }: { data: WeekLoadData; at: { date: IsoDate; half: Half }; ctx: Ctx | null; loose: readonly DraftStory[]; nameOf: (k: string) => string; onChanged: () => void; onSelect: (date: IsoDate, half: Half) => void; startOpen: boolean }) {
  const [open, setOpen] = useState(startOpen);
  useEffect(() => setOpen(startOpen), [startOpen, at.date, at.half]);
  const monday = mondayOf(at.date);
  const thisWeek = data.today.weekStart;
  const t = useToPlaceCounts(monday, monday === thisWeek, data);
  const n = (monday < thisWeek ? 0 : toPlaceCount(t)) + loose.length;
  if (!n) return null;
  const detail = [toPlaceLine(t)?.split(" · ")[1], loose.length ? `${loose.length} not on a block` : ""].filter(Boolean).join(", ");
  return (
    <div className="aw-toplace" aria-label="To place">
      <FoldLine className="aw-toplace-line" open={open} onToggle={() => setOpen((o) => !o)} label={`${n} to place`} title={detail} />
      {open && (
        <>
          {loose.length > 0 && ctx && (
            <ul className="aw-list bp-loose" aria-label="Not on a block">
              {loose.map((d) => (
                <AddRow key={`d${d.id}`} ctx={ctx} k={`d${d.id}`} d={{ clientKey: ctx.clientKey, itemId: addKey({ draftId: d.id }), size: d.size, title: d.title, add: { draftId: d.id } }}>
                  <span className="aw-type">Not in DevOps</span>
                  <DraftTitle draft={d} className="aw-row-title" />
                </AddRow>
              ))}
            </ul>
          )}
          {monday >= thisWeek && (
            <>
              {monday === thisWeek && <CarrySummary colors={data.clients} nameOf={nameOf} />}
              <FromLastWeek version={data} colors={data.clients} nameOf={nameOf} weekStart={monday} week={data.week} today={data.planDay.date} onChanged={onChanged} />
              <FromYourTeam weekStart={monday} thisWeek={thisWeek} version={data} colors={data.clients} onChanged={onChanged} onSchedule={onSelect} part="answer" />
            </>
          )}
        </>
      )}
    </div>
  );
}

/** What I sent and Ask a lead to look at my week, one collapsed group at the bottom of the panel. */
function YourSends({ weekStart, thisWeek, version, colors, onChanged }: { weekStart: IsoDate; thisWeek: IsoDate; version: unknown; colors: Record<string, string>; onChanged: () => void }) {
  const team = useTeamCommit(weekStart, version);
  const [open, setOpen] = useState(false);
  const clients = team.data?.clients ?? [];
  const sent = clients.reduce((n, c) => n + c.sent.length, 0);
  const replies = clients.reduce((n, c) => n + c.looks.filter((l) => l.reply).length, 0);
  const canAsk = weekStart >= thisWeek && clients.some((c) => c.leads.length);
  if (!sent && !replies && !canAsk) return null;
  const count = [sent ? `${sent} sent` : "", replies ? `${replies} ${replies === 1 ? "reply" : "replies"}` : ""].filter(Boolean).join(", ");
  return (
    <div className="aw-sec aw-sends">
      <FoldLine open={open} onToggle={() => setOpen((o) => !o)} label="You sent" count={count || undefined} title="What you sent teammates, and Ask a lead to look at your week" />
      {open && <FromYourTeam weekStart={weekStart} thisWeek={thisWeek} version={version} colors={colors} onChanged={onChanged} part="mine" />}
    </div>
  );
}

/**
 * The slim line over Week: "3 to place: 1 unfinished, 2 from last week · Review". Review opens the block panel with
 * To place open. Nothing when nothing waits, and only on this week.
 */
export function ToPlaceNotice({ weekStart, version, onReview, short = false }: { weekStart: IsoDate; version: unknown; onReview: () => void; /** The phone: "7 to place · Review". */ short?: boolean }) {
  const t = useToPlaceCounts(weekStart, true, version);
  const line = short ? toPlaceShort(t) : toPlaceLine(t);
  if (!line) return null;
  return (
    <p className="to-place-line" role="status" data-tour="wk-carry">
      <span>{line}</span>
      <span aria-hidden="true"> · </span>
      <button type="button" className="link-btn" onClick={onReview}>
        Review
      </button>
    </p>
  );
}

/** What waits to be placed in a week: unfinished to-dos (this week only), last week's rows, and sends to answer. */
function useToPlaceCounts(weekStart: IsoDate, thisWeek: boolean, version: unknown): ToPlaceCounts {
  const carry = useContext(CarryCtx);
  const team = useTeamCommit(weekStart, version);
  const proposal = useProposal(weekStart, version, () => {});
  const sent = (team.data?.clients ?? []).reduce((n, c) => n + c.incoming.filter((x) => !x.conflict).length, 0);
  const lastWeekRows = proposal.data ? proposal.data.clients.flatMap((c) => c.rows).length : 0;
  const mine = thisWeek ? carry : null;
  return { unfinished: (mine?.plan.cards.length ?? 0) + (mine?.plan.earlierDays.length ?? 0), lastWeek: (mine?.plan.earlierWeeks.length ?? 0) + lastWeekRows, sent };
}

/**
 * A row with "+": it adds the thing to this block, or moves it here when it is on another one ("Thu PM"). On this
 * block already: a check. Drag it onto any block on the grid instead.
 */
function AddRow({ ctx, k, d, children, menu, promise, focused = false }: { ctx: Ctx; k: string; d: Dragged; children: ReactNode; menu?: ReturnType<typeof useMenu> | undefined; promise?: number; focused?: boolean }) {
  const w = ctx.where(k);
  // On this block, or done on another one: a check, nothing to add or move.
  const here = !!w && (w.here || w.done);
  const dd = w && !here ? { ...d, pickId: w.pickId } : d;
  const drag = useDragSource(here ? null : dd);
  return (
    <li className={`aw-row${here ? " placed" : ""}${focused ? " dp-focused" : ""}`} data-promise={promise} onContextMenu={menu?.onContextMenu} {...drag} title={here ? undefined : "Drag onto a block to place it there"}>
      {here ? (
        <span className="aw-plus done" role="img" aria-label={w!.here ? "On this block" : `Done on ${w!.label}`} title={w!.here ? "On this block" : `Done on ${w!.label}`}>✓</span>
      ) : (
        <button type="button" className="aw-plus" onClick={() => void ctx.place(dd)} aria-label={w ? `Move ${d.title} here from ${w.label}` : `Add ${d.title}`} title={w ? `Move it here from ${w.label}` : "Add to this block"}>+</button>
      )}
      {children}
      {w && <span className="aw-where">{w.label}</span>}
      {menu?.button(`More for ${d.title}`)}
    </li>
  );
}

/**
 * A DevOps story to add, with its type's icon; its state, target date and size are on hover. A story that isn't mine
 * says whose it is and offers Take one (PV-1: assign it to me in DevOps, after its preview, with Undo), when I can
 * write to that client's DevOps.
 */
function ItemAdd({ item, ctx, take = false }: { item: WorkItem; ctx: Ctx; take?: boolean }) {
  const dw = useDevOpsWrite();
  const dnd = useContext(WeekDnd);
  const menu = useMenu((env) => itemMenu(env, ctx.clientKey, item));
  const theirs = take && item.assignedToMe !== true;
  return (
    <AddRow ctx={ctx} k={`i${ctx.clientKey}:${item.id}`} d={{ clientKey: ctx.clientKey, itemId: item.id, size: null, title: item.title }} menu={menu}>
      <TypeIcon clientKey={ctx.clientKey} type={item.type} />
      <span className="aw-row-title" title={hoverWords(item)}>
        <WorkLink clientKey={ctx.clientKey} url={item.url}>{item.title}</WorkLink>
      </span>
      {theirs && <span className="aw-who" title="Who it is assigned to in DevOps">{item.assignedTo ?? "Unassigned"}</span>}
      {theirs && dw?.can(ctx.clientKey) && (
        <button type="button" className="mini ps-take" title="Assign it to me in DevOps (after its preview)" onClick={() => void dw.begin(ctx.clientKey, [{ kind: "assign", itemId: item.id }], ({ confirmed }) => (confirmed ? dnd?.refresh() : undefined))}>
          Take one
        </button>
      )}
    </AddRow>
  );
}

/**
 * One group of Assigned to you: a feature with my stories under it. Its "+" places it on the block as a placeholder
 * (its pin); "2 of 4 on" when it has work on this week; "Needs stories · Break down" when it has none; whose it is
 * when it isn't mine; its other stories behind "2 more in this feature"; its drafts with Create in DevOps.
 */
function Group({ g, ctx, pinnedHere, onWeek, onAddToWeek, menuOf }: { g: AssignedGroup; ctx: Ctx; pinnedHere: boolean; onWeek: boolean; onAddToWeek?: (() => void) | undefined; menuOf: () => MenuStep | null }) {
  const f = g.feature;
  const [othersOpen, setOthersOpen] = useState(false);
  const fd: Dragged | null = f ? { clientKey: ctx.clientKey, itemId: f.id, size: null, title: f.title, feature: true } : null;
  const drag = useDragSource(!fd || pinnedHere || ctx.past ? null : fd);
  const menu = useMenu((env) => {
    const own = menuOf();
    if (own || !f) return own ?? { title: "No feature", items: [] };
    const base = itemMenu(env, ctx.clientKey, f);
    return "items" in base && onAddToWeek ? { ...base, items: [{ id: "add-week", label: "Add to this week", action: "weekplan.add", run: onAddToWeek }, ...base.items] } : base;
  });
  return (
    <li className={`aw-feature${g.breakDown ? " aw-not-ready" : ""}`} data-feature={f?.id ?? "none"} onContextMenu={f ? menu.onContextMenu : undefined}>
      <div className="aw-feat-head" {...drag}>
        {!f ? null : pinnedHere ? (
          <span className="aw-plus done" role="img" aria-label="On this block as a placeholder" title="On this block as a placeholder">✓</span>
        ) : (
          <button type="button" className="aw-plus" disabled={ctx.past} onClick={() => void ctx.place(fd!)} aria-label={`Place ${f.title} on this block`} title="Place it on this block as a placeholder (or drag it onto a block)">+</button>
        )}
        {f && <TypeIcon clientKey={ctx.clientKey} type={f.type} />}
        {f ? (
          <span className="aw-feat-name" title={hoverWords(f)}>
            <ItemTitleLink clientKey={ctx.clientKey} id={f.id} url={f.url}>{f.title}</ItemTitleLink>
          </span>
        ) : (
          <span className="aw-feat-name bp-nofeature">No feature</span>
        )}
        {f && !g.mine && <span className="aw-who" title="Who the feature is assigned to in DevOps">{f.assignedTo ?? "Unassigned"}</span>}
        {g.breakDown && f ? (
          <span className="aw-needs">
            <span className="aw-needs-word">Needs stories</span>
            <BreakDown clientKey={ctx.clientKey} item={{ id: f.id, title: f.title, type: f.type }} short />
          </span>
        ) : (
          g.label && <span className="aw-count" title={onWeek ? "Its stories on a block this week" : undefined}>{g.label}</span>
        )}
        {f && menu.button(`More for ${f.title}`)}
      </div>
      {(g.stories.length > 0 || g.drafts.length > 0) && (
        <ul>
          {g.stories.map((k) => <ItemAdd key={k.id} item={k} ctx={ctx} />)}
          {g.drafts.map((d) => (
            <AddRow key={`d${d.id}`} ctx={ctx} k={`d${d.id}`} d={{ clientKey: ctx.clientKey, itemId: addKey({ draftId: d.id }), size: d.size, title: d.title, add: { draftId: d.id } }}>
              <DraftTitle draft={d} className="aw-row-title" />
              <span className="aw-size">{d.size ? `${d.size} · ` : ""}draft</span>
              <CreateInDevOps drafts={[d]} label="Create in DevOps" />
            </AddRow>
          ))}
        </ul>
      )}
      {g.others.length > 0 && (
        <div className="bp-others">
          <FoldLine className="bp-others-line" open={othersOpen} onToggle={() => setOthersOpen((o) => !o)} label={`${g.others.length} more in this feature`} />
          {othersOpen && (
            <ul>
              {g.others.map((k) => <ItemAdd key={k.id} item={k} ctx={ctx} take />)}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * On a block card: the features placed on this block (their pins) that have no stories yet, as "Needs stories ·
 * Break down". Features with stories show through their stories.
 */
export function PlacedFeatures({ clientKey, date, half, tabIndex }: { clientKey: string; date: IsoDate; half: Half; tabIndex: number }) {
  const pv = useContext(PlanCtx);
  const work = useContext(DevOpsWork).get(clientKey);
  const placed = (pv.weekFeatures ?? []).filter((f) => f.clientKey === clientKey && f.level === "feature" && !f.doneAt && f.slots.some((s) => s.date === date && s.half === half));
  if (!placed.length || !work) return null;
  const storiesOf = (id: number) => [...new Map([...work.items, ...work.children].filter((c) => c.parentId === id && isPickable(c)).map((c) => [c.id, c])).values()];
  return (
    <ul className="placed-features">
      {placed.map((f) => {
        const n = storiesOf(f.itemId).length;
        const bare = storiesUnder(work, f.itemId).length === 0;
        return (
          <li key={f.itemId} className={`placed-feature${bare ? " pf-not-ready" : ""}`}>
            <span className="pf-title" title={f.title}>{f.title}</span>
            {bare ? (
              <span className="aw-needs">
                <span className="aw-needs-word">Needs stories</span>
                <span tabIndex={tabIndex}>
                  <BreakDown clientKey={clientKey} item={{ id: f.itemId, title: f.title }} short />
                </span>
              </span>
            ) : (
              <span className="aw-count">{n === 1 ? "1 story" : `${n} stories`}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
