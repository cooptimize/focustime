// WD-1: the Add work panel beside Week (a bottom sheet on the phone). It replaces Plan the day's right pane and Plan
// the week's Add pane: "Add to <client> · Tue AM", the block's room, then To place (unfinished, from last week, sent by
// a teammate), This week's features (the star makes one a must), Promises, More from DevOps (search) and the type box
// pinned at the bottom (Enter a draft story, Shift+Enter a plain to-do). Rows use "+" (the selected block) or a drag
// onto any block on the grid; both go through Week's drop rule (another client's block refuses). Placing work adds its
// feature to the week as nice to have (the server's pick.add does it). Everything here writes only FocusTime's plan
// store, through the existing actions.
import { useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ItemLookup, NO_ITEM, type ItemValue } from "./ItemLookup.tsx";
import { DraftTitle } from "./DraftEditor.tsx";
import { CreateInDevOps } from "./DevOpsWrite.tsx";
import { BreakDown } from "./DetailPanel.tsx";
import { blockClient, isPickable } from "../plan/rules.ts";
import { addSections, type PriorityRow } from "../plan/addpane.ts";
import { blockWord, placedWhere, removeRule, storiesUnder, roomWords, toPlaceLine, toPlaceShort, type ToPlace as ToPlaceCounts } from "../plan/addwork.ts";
import { FoldLine } from "./plan/FoldLine.tsx";
import { planMinutes } from "../plan/fit.ts";
import { freeMinutes } from "../week/free.ts";
import { weekList } from "../plan/weeklist.ts";
import { dueOrder } from "../plan/due.ts";
import { addKey, type Dragged } from "../plan/weekdrop.ts";
import type { PlanDayState, Pick } from "../plan/types.ts";
import type { Half, IsoDate, Week, WorkItem } from "../week/types.ts";
import { clientColor } from "./labels.ts";
import { slotOf } from "./halves.ts";
import { DevOpsWork } from "./work.ts";
import { TypeIcon } from "./TypeIcon.tsx";
import { PlanCtx } from "./planview.ts";
import { ItemTitleLink, WorkLink, NOTICE_EVENT } from "./WorkLink.tsx";
import { call, planAction } from "./api.ts";
import { DueBadge } from "./FollowUps.tsx";
import { itemMenu, openCoopBrief, weekItemMenu, type MenuStep, type WeekItemFacts, type WeekItemOps } from "./menu.ts";
import { MenuCtx, useMenu } from "./Menus.tsx";
import { useDevOpsWrite } from "./DevOpsWrite.tsx";
import { openSend } from "./send-event.ts";
import { DEFAULT_FEATURE_MINUTES } from "../plan/estimate.ts";
import { moveWithin } from "../plan/weeklist.ts";
import { AddSection, BoxHint } from "./plan/AddPane.tsx";
import { CloseButton } from "./CloseButton.tsx";
import { WeekDnd, useDragSource } from "./WeekStories.tsx";
import { FromYourTeam, useTeamCommit } from "./Team.tsx";
import { CarryCtx, CarrySummary } from "./Carry.tsx";
import { FromLastWeek } from "./FromLastWeek.tsx";
import { useProposal } from "./Watching.tsx";
import { isTypingTarget, topOverlay } from "./keys.ts";

const inPlay = (p: Pick) => p.status === "planned" || p.status === "done";
const pickedKey = (p: Pick) => (p.itemId !== null ? `i${p.clientKey}:${p.itemId}` : p.draftId !== null ? `d${p.draftId}` : p.followUpId !== null ? `f${p.followUpId}` : `t${p.clientKey}:${p.title}`);
const mondayOf = (d: IsoDate) => {
  const x = Temporal.PlainDate.from(d);
  return x.subtract({ days: x.dayOfWeek - 1 }).toString();
};
const say = (text: string) => window.dispatchEvent(new CustomEvent(NOTICE_EVENT, { detail: text }));
const errText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");

type Ctx = {
  clientKey: string;
  at: { date: IsoDate; half: Half };
  /** Adds a row to the selected block (Week's drop rule, with its Undo toast). */
  place: (d: Dragged) => Promise<void>;
  here: ReadonlySet<string>;
  /** "Tue PM" when the row is already placed on another block this week. */
  where: (ref: { itemId?: number; draftId?: number; followUpId?: number }) => string | null;
  /** The client's blocks this week (a feature's ⋯ › Pin to a block). */
  places: { date: IsoDate; half: "AM" | "PM"; label: string }[];
  /** A past week is a review. */
  past: boolean;
};

type Props = {
  at: { date: IsoDate; half: Half };
  week: Week;
  /** Bumped after any change, so the panel reads its day again. */
  version: unknown;
  thisWeek: IsoDate;
  /** Today's date (the real one). */
  today: IsoDate;
  colors: Record<string, string>;
  /** Clients an Open half-day or catch-up can take. */
  clients: { clientKey: string; clientName: string }[];
  onClose: () => void;
  onChanged: () => void;
  /** Another block (a client in "Also this week", a teammate's send scheduled). */
  onSelect: (date: IsoDate, half: Half) => void;
  /** The phone's bottom sheet. */
  sheet?: boolean;
  /** Opened from the notice line's Review: To place starts open. */
  placeOpen?: boolean;
};

export function AddWorkPanel({ at, week, version, thisWeek, today, colors, clients, onClose, onChanged, onSelect, sheet = false, placeOpen = false }: Props) {
  // To place is open when Review opened the panel; from a block it is one collapsed line (WD-1 review).
  const [placeShown, setPlaceShown] = useState(placeOpen);
  useEffect(() => setPlaceShown(placeOpen), [placeOpen, at.date, at.half]);
  const day = week.days.find((d) => d.date === at.date) ?? null;
  const slot = day ? slotOf(day, at.half) : null;
  const [state, setState] = useState<PlanDayState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    let live = true;
    setError(null);
    planAction("planday.start", { date: at.date }).then(
      (st) => live && setState(st),
      (e: unknown) => live && setError(errText(e)),
    );
    return () => {
      live = false;
    };
  }, [at.date, version]);
  // Esc closes the panel (not while typing in it: the first Esc leaves the box).
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || topOverlay(document) === "modal") return;
      const t = e.target as HTMLElement | null;
      if (t && isTypingTarget(t) && ref.current?.contains(t)) return (t as HTMLElement).blur();
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  const dnd = useContext(WeekDnd);
  const pv = useContext(PlanCtx);
  const allWork = useContext(DevOpsWork);
  const overflow = !!day && day.kind !== "work" && at.half !== "EVE";
  const block = overflow || !slot ? null : (slot.focus[0] ?? null);
  const dayPicks = (pv.week?.[at.date]?.picks ?? state?.picks ?? []).filter(inPlay);
  const blockPicks = dayPicks.filter((p) => p.half === at.half);
  const bc = blockClient(block?.clientKey ?? null, blockPicks);
  const [chosen, setChosen] = useState<string | null>(null);
  useEffect(() => setChosen(null), [at.date, at.half]);
  const clientKey = block?.clientKey ?? chosen ?? bc.clientKey ?? null;
  const name = (k: string | null) => clients.find((c) => c.clientKey === k)?.clientName ?? week.days.flatMap((d) => [...d.am.focus, ...d.pm.focus]).find((f) => f.clientKey === k)?.clientName ?? k ?? "";
  const word = blockWord(at.date, at.half, !!day && (day.kind !== "work" || !!day.pto));
  const room = slot && !slot.off && !day?.pto ? roomWords(freeMinutes(slot), planMinutes(blockPicks, pv.sizes, pv.timeboxes, slot)) : null;
  const weekPicks = Object.values(pv.week ?? {}).flatMap((d) => d.picks);
  const weekDays = week.days.map((d) => ({ date: d.date, whole: d.kind !== "work" || !!d.pto }));

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
        here: new Set(blockPicks.map(pickedKey)),
        where: (r) => placedWhere({ clientKey, ...r }, weekPicks, at, weekDays),
        places: week.days.flatMap((d) => (d.kind !== "work" || d.pto ? [] : (["AM", "PM"] as const).filter((h) => (h === "AM" ? d.am : d.pm).focus.some((f) => f.clientKey === clientKey)).map((h) => ({ date: d.date, half: h, label: blockWord(d.date, h) })))),
        past: week.weekStart < thisWeek,
      }
    : null;

  const title = (
    <h3 className="aw-title">
      Add to{" "}
      <span className="aw-client" style={{ "--c": clientColor(clientKey ?? undefined, colors) } as CSSProperties}>
        {clientKey ? name(clientKey) : "this block"}
      </span>{" "}
      · {word}
    </h3>
  );
  return (
    <aside ref={ref} className={`add-work-panel${sheet ? " sheet" : ""}`} aria-label={`Add work to ${word}`} data-add-panel={`${at.date}|${at.half}`} data-tour="aw-panel">
      <header className="aw-head">
        {title}
        <CloseButton onClose={onClose} />
      </header>
      {room && <p className={`aw-room${room.over ? " over" : ""}`}>{room.text}</p>}
      {!block && clients.length > 0 && (
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
        <ToPlace week={week} at={at} thisWeek={thisWeek} today={today} colors={colors} nameOf={(k) => name(k)} version={version} onChanged={onChanged} onSelect={onSelect} open={placeShown} onToggle={() => setPlaceShown((o) => !o)} />
        {!clientKey ? (
          <p className="muted aw-note">Choose a client for this block first.</p>
        ) : state && ctx ? (
          <ClientSections ctx={ctx} state={state} name={name} onChanged={onChanged} />
        ) : (
          !error && <p className="muted aw-note">Loading…</p>
        )}
        {state && <AlsoThisWeek state={state} clientKey={clientKey} week={week} name={name} colors={colors} onSelect={onSelect} at={at} />}
        {mondayOf(at.date) >= thisWeek && <YourSends weekStart={mondayOf(at.date)} thisWeek={thisWeek} version={version} colors={colors} onChanged={onChanged} />}
      </div>
      {ctx && <div className="aw-box" data-tour="aw-box"><StoryBox ctx={ctx} clientName={name(ctx.clientKey)} onChanged={onChanged} /></div>}
      {!allWork.size && <p className="muted aw-note">DevOps isn't loaded right now.</p>}
    </aside>
  );
}

/**
 * To place: the Board's banners moved into the panel (Unfinished to-dos and their suggested cards, From last week's
 * features and unfinished to-dos, and what teammates sent); nothing moves until it is placed. A later week shows its
 * own From last week proposal and sends (Plan the week's), never the unfinished to-dos; a past week shows none.
 */
function ToPlace({ week, at, thisWeek, today, colors, nameOf, version, onChanged, onSelect, open, onToggle }: { week: Week; at: { date: IsoDate; half: Half }; thisWeek: IsoDate; today: IsoDate; colors: Record<string, string>; nameOf: (k: string) => string; version: unknown; onChanged: () => void; onSelect: (date: IsoDate, half: Half) => void; open: boolean; onToggle: () => void }) {
  const monday = mondayOf(at.date);
  const t = useToPlaceCounts(monday, monday === thisWeek, version);
  const line = toPlaceLine(t);
  if (monday < thisWeek || !line) return null;
  // WD-1 review: one collapsed line at the top ("7 to place · 2 unfinished, …"), open only when Review opened the panel.
  return (
    <div className="aw-toplace" aria-label="To place">
      <FoldLine className="aw-toplace-line" open={open} onToggle={onToggle} label={line} title={line} />
      {open && (
        <>
          {monday === thisWeek && <CarrySummary colors={colors} nameOf={nameOf} />}
          <FromLastWeek version={version} colors={colors} nameOf={nameOf} weekStart={monday} week={week} today={today} onChanged={onChanged} />
          <FromYourTeam weekStart={monday} thisWeek={thisWeek} version={version} colors={colors} onChanged={onChanged} onSchedule={onSelect} part="answer" />
        </>
      )}
    </div>
  );
}

/** WD-1 review: what I sent and Ask a lead to look at my week, one collapsed group at the bottom of the panel. */
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
      <FoldLine open={open} onToggle={() => setOpen((o) => !o)} label="You sent and Ask a lead to look" count={count || undefined} />
      {open && <FromYourTeam weekStart={weekStart} thisWeek={thisWeek} version={version} colors={colors} onChanged={onChanged} part="mine" />}
    </div>
  );
}

/**
 * E: the slim line over Week that replaces the banners: "3 to place: 1 unfinished, 2 from last week · Review". Review
 * opens the Add work panel. Nothing when nothing waits, and only on this week.
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

/** This week's features, Promises and More from DevOps for the block's client (Plan the day's pane rule, AddPaneDay). */
function ClientSections({ ctx, state, name, onChanged }: { ctx: Ctx; state: PlanDayState; name: (k: string | null) => string; onChanged: () => void }) {
  const { clientKey, at } = ctx;
  const allWork = useContext(DevOpsWork);
  const pv = useContext(PlanCtx);
  const work = allWork.get(clientKey);
  const [query, setQuery] = useState("");
  useEffect(() => setQuery(""), [clientKey]);
  const picked = new Set((pv.week?.[at.date]?.picks ?? state.picks).filter(inPlay).map(pickedKey));
  const doneBy = useMemo(() => weekList(state.weekFeatures, work ? [work] : null, pv.sizes).items, [state.weekFeatures, work, pv.sizes]);
  const listed = useMemo(() => doneBy.map((f) => ({ ...f, clientKey: f.clientKey, done: !!f.done })), [doneBy]);
  const fus = dueOrder((pv.followUps ?? []).filter((f) => f.clientKey === clientKey), at.date, (f) => f.due, (f) => f.openedAt);
  const s0 = addSections({ clientKey, date: at.date, half: at.half, work, week: listed, followUps: fus, drafts: state.drafts, picked, here: ctx.here, query });
  // A story under a listed parent shows there once, not again on its own.
  const grouped = new Set(s0.rest.flatMap((r) => r.kids.map((k) => k.id)));
  const seen = new Set<number>();
  const rest = s0.rest.flatMap((r) => {
    if (!r.kids.length) return grouped.has(r.item.id) ? [] : [r];
    const kids = r.kids.filter((k) => !seen.has(k.id) && (seen.add(k.id), true));
    return kids.length ? [{ ...r, kids }] : [];
  });
  const s = { ...s0, rest };
  const loose = state.drafts.filter((d) => d.clientKey === clientKey && d.parentItemId === null && d.level === "story" && d.devopsId == null && !picked.has(`d${d.id}`));
  // Musts first, the rest after (the star moves a feature between them).
  const features = [...s.priorities.filter((p) => p.tier === "must"), ...s.priorities.filter((p) => p.tier !== "must")];
  const weekRows = state.weekFeatures.filter((f) => f.clientKey === clientKey);
  const onWeek = new Set(weekRows.map((f) => f.itemId));
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
  const star = (p: PriorityRow) => {
    const row = weekRows.find((f) => f.itemId === p.ref.itemId);
    if (row?.id === undefined) return;
    void act("weekplan.set_tier", { id: row.id, tier: p.tier === "must" ? "nice" : "must" }, p.tier === "must" ? `${p.ref.title}: nice to have` : `${p.ref.title}: a must this week`);
  };
  const remove = (p: PriorityRow) => {
    const row = weekRows.find((f) => f.itemId === p.ref.itemId);
    if (row?.id === undefined) return;
    const kids = new Set(storiesUnder(work, p.ref.itemId));
    const r = removeRule({ clientKey, itemId: p.ref.itemId, slots: row.slots }, kids, weekPicks, state.drafts);
    if (!r.ok) {
      say(`${p.ref.title} is placed on ${r.where.join(", ")}. Take those off first.`);
      return;
    }
    void act("weekplan.remove", { id: row.id }, `${p.ref.title} is off this week`);
  };
  const addToWeek = (item: WorkItem) => void act("weekplan.add", { weekStart, clientKey, itemId: item.id, tier: "nice" }, `${item.title} added to this week`);
  // Plan the week's row ⋯ (Move, Estimate, Pin, Mark done, Ask to collaborate, Send to…, the target date, the Coop
  // brief, Remove), on the same actions.
  const { env } = useContext(MenuCtx);
  const dw = useDevOpsWrite();
  const menuFor = (p: PriorityRow): MenuStep | null => {
    const row = weekRows.find((f) => f.itemId === p.ref.itemId);
    const li = doneBy.find((f) => f.itemId === p.ref.itemId);
    if (row?.id === undefined || !li) return null;
    const id = row.id;
    const group = features.filter((f) => f.tier === p.tier).map((f) => f.ref.itemId);
    const at0 = group.indexOf(p.ref.itemId);
    const target = [...(work?.items ?? []), ...(work?.committed ?? [])].find((x) => x.id === p.ref.itemId)?.targetDate ?? null;
    const facts: WeekItemFacts = {
      itemId: p.ref.itemId, title: p.ref.title, clientName: name(clientKey), tier: p.tier === "must" ? "must" : "nice", level: "feature", first: at0 <= 0, last: at0 === group.length - 1, past: ctx.past,
      done: li.done ? (li.done === "local" ? "local" : "other") : null, minutes: row.estimate ?? DEFAULT_FEATURE_MINUTES, size: null, places: ctx.places, pinned: [...row.slots], openStories: p.total, targetDate: target, drafts: p.drafts.length, canWrite: !!dw?.can(clientKey),
    };
    const ops: WeekItemOps = {
      move: (by) => void act("weekplan.reorder", { weekStart, clientKey, tier: facts.tier, order: moveWithin(group, p.ref.itemId, at0 + by).map((x) => x.itemId) }, `Moved ${p.ref.title}`),
      tier: () => star(p),
      pin: (date, half, on) => void act("weekplan.place", { weekStart, clientKey, itemId: p.ref.itemId, date, half, on }, on ? `Pinned to ${blockWord(date, half)}` : "Unpinned"),
      hours: (n) => void act("weekplan.set_estimate", { id, hours: n }, `${p.ref.title}: about ${n}h`),
      done: (on) => void act("weekplan.mark_done", { id, on }, on ? `${p.ref.title} marked done` : `${p.ref.title} not done`),
      help: () => env?.openHelp({ clientKey, title: `#${p.ref.itemId} ${p.ref.title}`, url: p.ref.url, itemId: p.ref.itemId, pinned: row.slots[0]?.date ?? null }),
      ...(p.ref.itemId > 0 ? { send: () => openSend({ clientKey, clientName: name(clientKey), itemId: p.ref.itemId, level: "feature", title: p.ref.title, itemType: p.item?.type ?? null, url: p.ref.url, parentId: p.item?.parentId ?? null }) } : {}),
      targetDate: () => dw?.targetDate({ clientKey, itemId: p.ref.itemId, title: p.ref.title, current: target }),
      brief: () => openCoopBrief(clientKey, { id: p.ref.itemId, title: p.ref.title }, weekStart),
      createDrafts: () => dw?.create(clientKey, p.drafts.slice(0, 10)),
      enableWrites: () => dw?.enable(clientKey),
      remove: () => remove(p),
    };
    return weekItemMenu(facts, ops, pv.sizes);
  };
  return (
    <>
      {features.length > 0 ? (
        <AddSection className="aw-sec aw-features" label="This week's features" tour="aw-features">
          <ul className="aw-list">
            {features.map((p) => (
              <Feature key={p.ref.itemId} p={p} ctx={ctx} onStar={() => star(p)} onRemove={() => remove(p)} menuOf={() => menuFor(p)} />
            ))}
          </ul>
        </AddSection>
      ) : (
        !work && <p className="muted aw-note">DevOps isn't loaded for {name(clientKey)} right now.</p>
      )}
      {s.followUps.length > 0 && (
        <AddSection className="aw-sec" label="Promises">
          <ul className="aw-list">
            {s.followUps.map((f) => (
              <AddRow key={f.id} ctx={ctx} k={`f${f.id}`} where={ctx.where({ followUpId: f.id })} d={{ clientKey, itemId: addKey({ followUpId: f.id }), size: null, title: f.what, add: { followUpId: f.id } }}>
                <span className="aw-row-title">{f.hasWho ? `${f.who}: ` : ""}{f.what}</span>
                <DueBadge l={f} />
              </AddRow>
            ))}
          </ul>
        </AddSection>
      )}
      <AddSection className="aw-sec" label="More from DevOps">
        <input className="aw-search pl-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Escape" && query && (e.stopPropagation(), e.preventDefault(), setQuery(""))} placeholder="Search by title or #id" aria-label={`Search ${name(clientKey)}'s work`} />
        <ul className="aw-list">
          {loose.map((d) => (
            <AddRow key={`d${d.id}`} ctx={ctx} k={`d${d.id}`} where={ctx.where({ draftId: d.id })} d={{ clientKey, itemId: addKey({ draftId: d.id }), size: d.size, title: d.title, add: { draftId: d.id } }}>
              <span className="aw-type">Draft</span>
              <DraftTitle draft={d} className="aw-row-title" />
            </AddRow>
          ))}
          {s.rest.map((r) =>
            r.kids.length ? (
              <li key={r.item.id} className="aw-group">
                <span className="aw-group-title">
                  <TypeIcon clientKey={clientKey} type={r.item.type} /> <span className="aw-row-title">{r.item.title}</span>
                  {!onWeek.has(r.item.id) && (
                    <button type="button" className="link-btn aw-addweek" onClick={() => addToWeek(r.item)}>
                      Add to this week
                    </button>
                  )}
                </span>
                <ul>
                  {r.kids.map((k) => <ItemAdd key={k.id} item={k} ctx={ctx} />)}
                </ul>
              </li>
            ) : (
              <ItemAdd key={r.item.id} item={r.item} ctx={ctx} onAddToWeek={onWeek.has(r.item.id) ? undefined : () => addToWeek(r.item)} />
            ),
          )}
        </ul>
        {query && !s.rest.length && <p className="muted aw-note">Nothing matches "{query}".</p>}
        {!query && !s.rest.length && !loose.length && work && <p className="muted aw-note">Nothing else open for {name(clientKey)}.</p>}
      </AddSection>
    </>
  );
}

/** Other clients with features this week: one line each, a click moves the panel to that client's next block. */
function AlsoThisWeek({ state, clientKey, week, name, colors, onSelect, at }: { state: PlanDayState; clientKey: string | null; week: Week; name: (k: string | null) => string; colors: Record<string, string>; onSelect: (date: IsoDate, half: Half) => void; at: { date: IsoDate } }) {
  const others = [...new Set(state.weekFeatures.filter((f) => f.clientKey !== clientKey && !f.doneAt).map((f) => f.clientKey))];
  if (!others.length) return null;
  const blockOf = (k: string) => {
    for (const d of week.days)
      for (const h of ["AM", "PM"] as const) {
        const s = h === "AM" ? d.am : d.pm;
        if (d.date >= at.date && s.focus[0]?.clientKey === k) return { date: d.date, half: h };
      }
    return null;
  };
  return (
    <AddSection className="aw-sec aw-also" label="Also this week">
      <ul className="aw-also-list">
        {others.map((k) => {
          const b = blockOf(k);
          const n = state.weekFeatures.filter((f) => f.clientKey === k && !f.doneAt).length;
          return (
            <li key={k}>
              <button type="button" className="chip-btn" disabled={!b} style={{ "--c": clientColor(k, colors) } as CSSProperties} onClick={() => b && onSelect(b.date, b.half)} title={b ? `Add to ${name(k)} · ${blockWord(b.date, b.half)}` : `No ${name(k)} block left this week`}>
                <span className="swatch" />
                {name(k)} · {n} {n === 1 ? "feature" : "features"}
              </button>
            </li>
          );
        })}
      </ul>
    </AddSection>
  );
}

/** A row with "+" for the selected block; drag it onto any block on the grid instead. Placed here: a check. */
function AddRow({ ctx, k, d, where, children, menu }: { ctx: Ctx; k: string; d: Dragged; where: string | null; children: ReactNode; menu?: ReturnType<typeof useMenu> | undefined }) {
  const here = ctx.here.has(k);
  const drag = useDragSource(here ? null : d);
  return (
    <li className={`aw-row${here ? " placed" : ""}`} onContextMenu={menu?.onContextMenu} {...drag} title={here ? undefined : "Drag onto a block to place it there"}>
      {here ? (
        <span className="aw-plus done" role="img" aria-label="On this block" title="On this block">✓</span>
      ) : (
        <button type="button" className="aw-plus" onClick={() => void ctx.place(d)} aria-label={`Add ${d.title}`} title="Add to this block">+</button>
      )}
      {children}
      {where && where !== "On this block" && <span className="aw-where">{where}</span>}
      {menu?.button(`More for ${d.title}`)}
    </li>
  );
}

/** A DevOps item to add, with its type's icon and, outside this week's features, "Add to this week" in its ⋯. */
function ItemAdd({ item, ctx, after, onAddToWeek }: { item: WorkItem; ctx: Ctx; after?: ReactNode; onAddToWeek?: (() => void) | undefined }) {
  const menu = useMenu((env) => {
    const base = itemMenu(env, ctx.clientKey, item);
    return onAddToWeek && "items" in base ? { ...base, items: [{ id: "add-week", label: "Add to this week", hint: "Nice to have", action: "weekplan.add", run: onAddToWeek }, ...base.items] } : base;
  });
  return (
    <AddRow ctx={ctx} k={`i${ctx.clientKey}:${item.id}`} where={ctx.where({ itemId: item.id })} d={{ clientKey: ctx.clientKey, itemId: item.id, size: null, title: item.title }} menu={menu}>
      <TypeIcon clientKey={ctx.clientKey} type={item.type} />
      <span className="aw-row-title" title={`${item.type} ${item.id} · ${item.state}`}>
        <WorkLink clientKey={ctx.clientKey} url={item.url}>{item.title}</WorkLink>
      </span>
      {after}
    </AddRow>
  );
}

/**
 * A feature on this week: the star (must), its title, then its stories and drafts with "+". One with no stories is a
 * "Needs stories · Break down" row. A feature isn't a to-do, so it has no "+"; ⋯ has Remove from this week.
 */
function Feature({ p, ctx, onStar, onRemove, menuOf }: { p: PriorityRow; ctx: Ctx; onStar: () => void; onRemove: () => void; menuOf: () => MenuStep | null }) {
  const must = p.tier === "must";
  // A feature can go on a block as a placeholder (its pin there), by + or a drag.
  const pinnedHere = p.level === "story" ? ctx.here.has(`i${ctx.clientKey}:${p.ref.itemId}`) : p.ref.slots.some((s) => s.date === ctx.at.date && s.half === ctx.at.half);
  // A story on the week list (not a feature) goes on the block as a to-do, like any story row.
  const story = p.level === "story";
  const fd: Dragged = { clientKey: ctx.clientKey, itemId: p.ref.itemId, size: null, title: p.ref.title, ...(story ? {} : { feature: true as const }) };
  const drag = useDragSource(pinnedHere || ctx.past ? null : fd);
  const menu = useMenu(() => menuOf() ?? { title: p.ref.title, items: [{ id: "remove-week", label: "Remove from this week", action: "weekplan.remove", run: onRemove }] });
  return (
    <li className={`aw-feature${p.breakDown ? " aw-not-ready" : ""}`} data-feature={p.ref.itemId} onContextMenu={menu.onContextMenu}>
      <div className="aw-feat-head" {...drag}>
        {pinnedHere ? (
          <span className="aw-plus done" role="img" aria-label={story ? "On this block" : "On this block as a placeholder"} title={story ? "On this block" : "On this block as a placeholder"}>✓</span>
        ) : (
          <button type="button" className="aw-plus" disabled={ctx.past} onClick={() => void ctx.place(fd)} aria-label={story ? `Add ${p.ref.title}` : `Place ${p.ref.title} on this block`} title={story ? "Add to this block" : "Place it on this block as a placeholder (or drag it onto a block)"}>+</button>
        )}
        <button type="button" className={`aw-star${must ? " on" : ""}`} aria-pressed={must} onClick={onStar} aria-label={must ? `${p.ref.title} is a must. Make it nice to have` : `Make ${p.ref.title} a must`} title={must ? "A must this week (click for nice to have)" : "Nice to have (click to make it a must)"}>
          {must ? "★" : "☆"}
        </button>
        {p.item && <TypeIcon clientKey={ctx.clientKey} type={p.item.type} />}
        {p.ref.itemId > 0 ? (
          <ItemTitleLink clientKey={ctx.clientKey} id={p.ref.itemId} url={p.ref.url} className="aw-feat-name">{p.ref.title}</ItemTitleLink>
        ) : (
          <span className="aw-feat-name">{p.ref.title}</span>
        )}
        {p.breakDown ? (
          <span className="aw-needs">
            <span className="aw-needs-word">Needs stories</span>
            <BreakDown clientKey={ctx.clientKey} item={{ id: p.ref.itemId, title: p.ref.title, ...(p.item ? { type: p.item.type } : {}) }} short />
          </span>
        ) : (
          p.level !== "story" && p.total > 0 && <span className="aw-count">{p.stories.filter((k) => ctx.here.has(`i${ctx.clientKey}:${k.id}`) || ctx.where({ itemId: k.id })).length} of {p.total} placed</span>
        )}
        {menu.button(`More for ${p.ref.title}`)}
      </div>
      {(p.stories.length > 0 || p.drafts.length > 0) && (
        <ul>
          {p.stories.map((k) => <ItemAdd key={k.id} item={k} ctx={ctx} />)}
          {p.drafts.map((d) => (
            <AddRow key={`d${d.id}`} ctx={ctx} k={`d${d.id}`} where={ctx.where({ draftId: d.id })} d={{ clientKey: ctx.clientKey, itemId: addKey({ draftId: d.id }), size: d.size, title: d.title, add: { draftId: d.id } }}>
              <DraftTitle draft={d} className="aw-row-title" />
              <span className="aw-size">{d.size ? `${d.size} · ` : ""}draft</span>
              <CreateInDevOps drafts={[d]} label="Create in DevOps" />
            </AddRow>
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * The type box, pinned at the bottom: Enter makes a draft story and places it here; Shift+Enter a plain to-do ("not
 * in DevOps"). Choosing a search result adds that DevOps item.
 */
function StoryBox({ ctx, clientName, onChanged }: { ctx: Ctx; clientName: string; onChanged: () => void }) {
  const [value, setValue] = useState<ItemValue>(NO_ITEM);
  const { clientKey, at } = ctx;
  const only = useCallback((i: WorkItem) => isPickable(i) && !ctx.here.has(`i${clientKey}:${i.id}`), [ctx.here, clientKey]);
  const add = async (input: Record<string, unknown>) => {
    try {
      await planAction("pick.add", { date: at.date, half: at.half, clientKey, ...input });
      onChanged();
      return true;
    } catch (e) {
      say(errText(e));
      return false;
    }
  };
  const story = async (title: string) => {
    try {
      const r = await call<{ draft: { id: number } }>("draft.add_story", { clientKey, parentItemId: null, title });
      return add({ draftId: r.draft.id });
    } catch (e) {
      say(errText(e));
      return false;
    }
  };
  return (
    <div className="intention aw-typebox">
      <ItemLookup
        clientKey={clientKey}
        value={value}
        label={`Add to ${blockWord(at.date, at.half)}`}
        placeholder={`Type a story for ${clientName}, then Enter`}
        only={only}
        onChange={(v) => {
          if (v.itemId !== null) {
            setValue(NO_ITEM);
            void add({ itemId: v.itemId });
          } else setValue(v);
        }}
        onEnterText={async (text, how) => {
          const ok = how.shift ? await add({ intention: text }) : await story(text);
          if (ok) setValue(NO_ITEM);
        }}
      />
      <BoxHint className="aw-hint">Enter adds a draft story. Shift+Enter adds a plain to-do.</BoxHint>
    </div>
  );
}

/**
 * On a block card: the features placed on this block (Plan the week's pins) that have no stories yet, as "Needs
 * stories · Break down". Features with stories show through their stories.
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
