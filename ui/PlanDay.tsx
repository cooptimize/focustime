// Plan the day: the planned day's column becomes a short planning panel. Each half-day shows its real capacity,
// picks come from that client's DevOps items in board order (story level only) or a typed intention, and one
// key commits. Everything here is local: the actions only write Coopilot's plan store.
import { useContext, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { blockClient, capacityMinutes, fitOf, isPickable, pickableChildren, plannedMinutes } from "../plan/rules.ts";
import { dayLabel } from "../plan/days.ts";
import { SIZES, type DraftStory, type PlanDayState, type Pick, type Size } from "../plan/types.ts";
import type { Day, Half, Slot, WorkItem } from "../week/types.ts";
import { fitLabel, formatMinutes } from "./planday.ts";
import { clientColor, halfTag, longDate, shortDate, slotRange, startClock } from "./labels.ts";
import { cardHalves, slotOf } from "./halves.ts";
import { DevOpsWork, typeTag, workStatusLabel } from "./work.ts";
import { PlanCtx, useFocused } from "./planview.ts";
import { dayFocus, focusLabel, liveFocused } from "../plan/focus.ts";
import { formatDuration } from "../week/format.ts";
import { WorkLink } from "./WorkLink.tsx";
import { ITEM_ATTRS } from "./keys.ts";
import { itemMenu, pickMenu } from "./menu.ts";
import { MenuRow, useMenu } from "./Menus.tsx";

export type PlanDayAct = (action: string, input: Record<string, unknown>) => Promise<boolean>;

type Props = {
  day: Day;
  state: PlanDayState;
  /** "Today" or "Next workday" when it's one of those, so it's clear which day is planned. */
  which: string | null;
  /** Friday of the same week, when it is not this day (for "move to Friday"). */
  friday: string | null;
  now: string;
  tz: string;
  colors: Record<string, string>;
  /** Clients that can be picked from in an Open half-day (this week's DevOps clients, Cooptimize included). */
  clients: { clientKey: string; clientName: string }[];
  error: string | null;
  act: PlanDayAct;
  onCommit: () => void;
  onClose: () => void;
  /** ← → and the ‹ › buttons: the previous or next day that can be planned. */
  onStep: (dir: 1 | -1) => void;
};

const inPlay = (p: Pick) => p.status === "planned" || p.status === "done";

export function PlanDay({ day, state, which, friday, now, tz, colors, clients, error, act, onCommit, onClose, onStep }: Props) {
  const past = state.access === "past";
  const off = day.pto;
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);
  // Adding a candidate removes its button; keep keyboard focus in the panel instead of dropping it to the page.
  useEffect(() => {
    if (!document.activeElement || document.activeElement === document.body) ref.current?.focus({ preventScroll: true });
  }, [state]);
  const picked = new Set(state.picks.filter(inPlay).map((p) => (p.itemId !== null ? `i${p.clientKey}:${p.itemId}` : p.draftId !== null ? `d${p.draftId}` : "")));
  const committed = state.plan.committedAt;

  const onKey = (e: KeyboardEvent) => {
    const typing = (e.target instanceof HTMLInputElement && e.target.type !== "checkbox") || e.target instanceof HTMLSelectElement;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (typing) (e.target as HTMLElement).blur();
      else onClose();
      return;
    }
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    if ((e.key === "c" || e.key === "C") && !past) {
      e.preventDefault();
      onCommit();
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      onStep(e.key === "ArrowLeft" ? -1 : 1);
    }
  };
  const badge = past ? "Past" : which;

  // This day's focused time (step 6d): its own log, on top of the week's, live while a session runs.
  const view = useContext(PlanCtx);
  const inner = { ...view, focused: { ...view.focused, ...state.focused }, resumeNotes: state.resumeNotes };
  const totals = dayFocus(state.picks.filter((p) => p.date === day.date && p.status !== "moved"), (id) => liveFocused(id, inner.focused, inner.timer, inner.nowMs), inner.sizes);

  return (
    <PlanCtx.Provider value={inner}>
    <section ref={ref} className="planday" tabIndex={-1} aria-label={`Plan ${longDate(day.date)}`} onKeyDown={onKey}>
      <header className="pd-head">
        <div>
          <h2>
            {past ? "Review" : "Plan"} {longDate(day.date)}
            {badge && <span className={`pd-which ${badge === "Today" ? "today" : badge === "Past" ? "past" : "next"}`}>{badge}</span>}
          </h2>
          <p className="muted">
            {past
              ? `This day is past: tick picks done or drop them. Nothing else changes here.${state.carryTarget ? ` Unfinished picks are offered to carry over on ${dayLabel(state.carryTarget)}.` : ""}`
              : committed
                ? `Committed at ${startClock(committed.replace(/\[.*\]$/, ""), tz)}. Changes are saved as you go; commit again when done.`
                : "About two minutes: pick story-level work for each block, then commit."}
          </p>
          {totals.plannedMinutes > 0 && (
            <p className="pd-focus">
              <strong>{formatDuration(totals.focusedMinutes)}</strong> focused of {formatDuration(totals.plannedMinutes)} planned
            </p>
          )}
        </div>
        <div className="pd-actions">
          <span className="pd-step" role="group" aria-label="Day">
            <button type="button" onClick={() => onStep(-1)} aria-label="Previous day (←)" title="Previous day (←)">
              ‹
            </button>
            <button type="button" onClick={() => onStep(1)} aria-label="Next day (→)" title="Next day (→)">
              ›
            </button>
          </span>
          {!past && (
            <button type="button" className="commit" onClick={onCommit}>
              <kbd>c</kbd> {committed ? "Commit again" : "Commit"}
            </button>
          )}
          <button type="button" onClick={onClose} aria-label="Close planning">
            Esc
          </button>
        </div>
      </header>
      {error && (
        <p className="pd-error" role="alert">
          {error}
        </p>
      )}

      {off && (
        <p className="pd-pto full" role="note">
          <strong>PTO</strong> · {off.titles.join(", ")}. This day is off, so nothing can be planned on it.
        </p>
      )}

      {!off && !past && state.carryOver.length > 0 && <CarryOver picks={state.carryOver} date={day.date} act={act} />}
      {!off && !past && state.carryTarget && state.carryTarget < day.date && (
        <p className="muted pd-note">Unfinished picks from earlier days are offered on {dayLabel(state.carryTarget)}, the first day not committed yet.</p>
      )}

      {!off && past && <PastDay halves={[...new Set<Half>(["AM", "PM", ...state.picks.filter((p) => p.date === day.date && p.half === "EVE").map((p) => p.half)])]} picks={state.picks.filter((p) => p.date === day.date && p.status !== "moved")} act={act} />}

      {!off && !past && <div className="pd-blocks">
        {cardHalves(day)
          .filter((half) => !slotOf(day, half)!.off || day.kind === "overflow" || state.picks.some((p) => p.half === half && p.date === day.date && inPlay(p)))
          .map((half) => (
          <Block
            key={half}
            slot={slotOf(day, half)!}
            overflow={day.kind !== "work" && half !== "EVE"}
            picks={state.picks.filter((p) => p.half === half && p.date === day.date && inPlay(p))}
            drafts={state.drafts}
            picked={picked}
            other={half === "AM" ? "PM" : half === "PM" ? "AM" : day.pm.off ? "AM" : "PM"}
            friday={friday}
            now={now}
            tz={tz}
            colors={colors}
            clients={clients}
            act={act}
          />
        ))}
      </div>}
    </section>
    </PlanCtx.Provider>
  );
}

/** "45m of M" when a pick has a minute or more of focused time (step 6d); the size alone otherwise. */
function SizeTag({ pick }: { pick: Pick }) {
  const label = focusLabel(useFocused()(pick.id), pick.size);
  return <span className={`size-tag${label ? " focused" : ""}`}>{label ?? pick.size}</span>;
}

/** Focused time beside the S/M/L buttons of a pick being planned; nothing until a minute is logged. */
function FocusNote({ pick }: { pick: Pick }) {
  const label = focusLabel(useFocused()(pick.id), pick.size);
  return label ? <span className="focus-note">{label}</span> : null;
}

/** A past day: its picks per block, tick done or drop. No sizes, moves, candidates or commit (server enforces it too). */
function PastDay({ halves, picks, act }: { halves: Half[]; picks: Pick[]; act: PlanDayAct }) {
  return (
    <div className="pd-blocks past">
      {halves.map((half) => {
        const mine = picks.filter((p) => p.half === half);
        return (
          <section key={half} className="pd-block past" aria-label={`${half} block`}>
            <header className="pd-block-head">
              <div className="pd-title">
                <span className="half-tag">{halfTag(half)}</span>
              </div>
            </header>
            {mine.length === 0 ? (
              <p className="muted pd-note">Nothing was planned.</p>
            ) : (
              <ol className="pd-picks">
                {mine.map((p) => (
                  <MenuRow key={p.id} build={(env) => pickMenu(env, p)} label={`Actions for ${p.title}`} item={{ clientKey: p.clientKey, url: p.itemUrl }} className={p.status === "dropped" ? "dropped" : ""}>
                    <label className="pd-tick">
                      <input type="checkbox" checked={p.status === "done"} disabled={p.status === "dropped"} onChange={(e) => act("pick.mark_done", { id: p.id, done: e.target.checked })} />
                      <span className="pick-title" title={p.title}>
                        {p.title}
                        <span className="muted"> · {p.clientKey}</span>
                      </span>
                    </label>
                    <SizeTag pick={p} />
                    {p.status === "dropped" ? (
                      <span className="muted">dropped</span>
                    ) : (
                      p.status === "planned" && (
                        <button type="button" className="mini quiet" onClick={() => act("pick.remove", { id: p.id })} aria-label={`Drop ${p.title}`}>
                          Drop
                        </button>
                      )
                    )}
                  </MenuRow>
                ))}
              </ol>
            )}
          </section>
        );
      })}
    </div>
  );
}

function CarryOver({ picks, date, act }: { picks: Pick[]; date: string; act: PlanDayAct }) {
  return (
    <section className="pd-carry" aria-label="Unfinished from earlier days">
      <h3>Carry over · unfinished from earlier</h3>
      <ul>
        {picks.map((p) => (
          <MenuRow key={p.id} build={(env) => pickMenu(env, p)} label={`Actions for ${p.title}`} item={{ clientKey: p.clientKey, url: p.itemUrl }}>
            <span className="carry-when">{shortDate(p.date)} {p.half}</span>
            <span className="carry-client">{p.clientKey}</span>
            <span className="pick-title">{p.title}</span>
            <SizeTag pick={p} />
            <span className="row-actions">
              <button type="button" className="mini" onClick={() => act("pick.move", { id: p.id, date, half: "AM" })}>
                To AM
              </button>
              <button type="button" className="mini" onClick={() => act("pick.move", { id: p.id, date, half: "PM" })}>
                To PM
              </button>
              <button type="button" className="mini quiet" onClick={() => act("pick.remove", { id: p.id })}>
                Drop
              </button>
            </span>
          </MenuRow>
        ))}
      </ul>
    </section>
  );
}

type BlockProps = {
  slot: Slot;
  overflow: boolean;
  picks: Pick[];
  drafts: DraftStory[];
  picked: Set<string>;
  other: Half;
  friday: string | null;
  now: string;
  tz: string;
  colors: Record<string, string>;
  clients: { clientKey: string; clientName: string }[];
  act: PlanDayAct;
};

function Block({ slot, overflow, picks, drafts, picked, other, friday, now, tz, colors, clients, act }: BlockProps) {
  const focus = overflow ? null : slot.focus[0] ?? null;
  const bc = blockClient(focus?.clientKey ?? null, picks);
  const [chosen, setChosen] = useState<string | null>(null);
  const source = focus?.clientKey ?? chosen ?? bc.clientKey ?? clients[0]?.clientKey ?? null;
  const capacity = capacityMinutes(slot, now);
  const fit = fitOf(plannedMinutes(picks, useContext(PlanCtx).sizes), capacity);
  const started = Temporal.Instant.compare(Temporal.Instant.from(now), Temporal.Instant.from(slot.start)) > 0;
  const name = (k: string | null) => clients.find((c) => c.clientKey === k)?.clientName ?? k ?? "";
  const style = { "--c": clientColor(bc.clientKey ?? undefined, colors) } as CSSProperties;
  // Where I left off with this block's client (step 7): the latest resume note up to this day.
  const notes = useContext(PlanCtx).resumeNotes;
  const note = (focus?.clientKey ?? bc.clientKey) ? notes?.[(focus?.clientKey ?? bc.clientKey)!] : undefined;

  return (
    <section className={`pd-block fit-${fit.kind} ${focus ? "focus" : "open"}`} style={style} aria-label={`${slot.half} block`}>
      <header className="pd-block-head">
        <div className="pd-title">
          <span className="half-tag">{halfTag(slot.half)}</span>
          <span className="muted">{slotRange(slot, tz)}</span>
          <span className="pd-client">
            <span className="swatch" />
            {focus ? focus.clientName : overflow ? "Overflow" : slot.half === "EVE" ? (slot.flex.length ? `Flex · ${slot.flex.map((f) => name(f.clientKey)).join(", ")}` : bc.clientKey ? `Evening · ${name(bc.clientKey)}` : "Evening") : bc.clientKey ? `Open · ${name(bc.clientKey)}` : "Open"}
          </span>
        </div>
        {note && (
          <p className="resume-note" title={`Resume note from ${shortDate(note.date)}`}>
            <span className="resume-tag">Left off {shortDate(note.date)}</span> {note.note}
          </p>
        )}
        <div className="pd-capacity">
          <span>
            <strong>{formatMinutes(capacity)}</strong> free{started ? " from now" : ""}
          </span>
          <span className={`fit ${fit.kind}`}>{fitLabel(fit)}</span>
        </div>
      </header>
      {bc.mixed && <p className="pd-flag">Mixed clients in one block: {bc.clients.map(name).join(", ")}</p>}
      {fit.kind === "over" && (
        <p className="pd-flag over">
          Over by {formatMinutes(fit.by)}. Drop a pick, make one smaller, or move one to {halfTag(other)}
          {friday ? " or to Friday" : ""}.
        </p>
      )}

      {picks.length > 0 && (
        <ol className="pd-picks">
          {picks.map((p) => (
            <MenuRow key={p.id} build={(env) => pickMenu(env, p)} label={`Actions for ${p.title}`} item={{ clientKey: p.clientKey, url: p.itemUrl }} className={p.clientKey !== bc.clientKey ? "other-client" : ""}>
              <span className="wi-type">{p.kind === "intention" ? "Note" : typeTag(p.itemType ?? "")}</span>
              <span className="pick-title" title={p.title}>
                {p.kind === "item" && p.itemUrl ? (
                  <WorkLink clientKey={p.clientKey} url={p.itemUrl} className="pick-link">
                    {p.title}
                  </WorkLink>
                ) : (
                  p.title
                )}
                {p.clientKey !== bc.clientKey && <span className="muted"> · {name(p.clientKey)}</span>}
                {p.carriedFromDate && <span className="muted"> · from {shortDate(p.carriedFromDate)}</span>}
              </span>
              <FocusNote pick={p} />
              <span className="sizes" role="group" aria-label="Size">
                {SIZES.map((s) => (
                  <button key={s} type="button" className="size" aria-pressed={p.size === s} onClick={() => p.size !== s && act("pick.set_size", { id: p.id, size: s })}>
                    {s}
                  </button>
                ))}
              </span>
              <span className="row-actions">
                <button type="button" className="mini" onClick={() => act("pick.move", { id: p.id, date: p.date, half: other })} aria-label={`Move to ${halfTag(other)}`}>
                  To {halfTag(other)}
                </button>
                {friday && (
                  <button type="button" className="mini" onClick={() => act("pick.move", { id: p.id, date: friday, half: "AM" })} aria-label="Move to Friday">
                    To Fri
                  </button>
                )}
                <button type="button" className="mini quiet" onClick={() => act("pick.remove", { id: p.id })} aria-label={`Drop ${p.title}`}>
                  Drop
                </button>
              </span>
            </MenuRow>
          ))}
        </ol>
      )}

      {!focus && clients.length > 0 && (
        <div className="client-chooser" role="group" aria-label="Pick from client">
          {clients.map((c) => (
            <button key={c.clientKey} type="button" className="chip-btn" aria-pressed={source === c.clientKey} style={{ "--c": clientColor(c.clientKey, colors) } as CSSProperties} onClick={() => setChosen(c.clientKey)}>
              <span className="swatch" />
              {c.clientName}
            </button>
          ))}
        </div>
      )}

      {source && <Candidates clientKey={source} half={slot.half} date={slot.date} drafts={drafts} picked={picked} act={act} />}
      {source && <Intention clientKey={source} clientName={name(source)} half={slot.half} date={slot.date} act={act} />}
    </section>
  );
}

const SHOWN = 6;

function Candidates({ clientKey, half, date, drafts, picked, act }: { clientKey: string; half: Half; date: string; drafts: DraftStory[]; picked: Set<string>; act: PlanDayAct }) {
  const work = useContext(DevOpsWork).get(clientKey);
  const [all, setAll] = useState(false);
  if (!work) return <p className="muted pd-note">No DevOps items for {clientKey} this week. Type an intention instead.</p>;
  const free = (i: WorkItem) => !picked.has(`i${clientKey}:${i.id}`);
  // Board order: my story-level items, and my epics and features (which open into their children).
  const rows = work.items.filter((i) => (isPickable(i) && free(i)) || i.level === "portfolio");
  const shown = all ? rows : rows.slice(0, SHOWN);
  const add = (input: Record<string, unknown>) => act("pick.add", { date, half, clientKey, ...input });
  return (
    <div className="candidates">
      <h4>
        {work.clientName} in board order
        {work.status !== "ok" && <span className="muted"> · {workStatusLabel(work)}</span>}
      </h4>
      {rows.length === 0 && <p className="muted pd-note">Nothing left to pick for {work.clientName}. Type an intention instead.</p>}
      <ul>
        {shown.map((i) =>
          i.level === "portfolio" ? (
            <Portfolio key={i.id} item={i} clientKey={clientKey} kids={pickableChildren(i.id, work.children).filter(free)} drafts={drafts.filter((d) => d.clientKey === clientKey && d.parentItemId === i.id && !picked.has(`d${d.id}`))} add={add} act={act} />
          ) : (
            <MenuRow key={i.id} build={(env) => itemMenu(env, clientKey, i)} label={`Actions for ${i.type} ${i.id}`} item={{ clientKey, url: i.url }}>
              <button type="button" className="cand" onClick={() => add({ itemId: i.id })} title={`${i.type} ${i.id}: ${i.title} (${i.state})`}>
                <span className="plus" aria-hidden="true">+</span>
                <span className="wi-type">{typeTag(i.type)}</span>
                <span className="wi-title">{i.title}</span>
              </button>
              <OpenItem clientKey={clientKey} item={i} />
            </MenuRow>
          ),
        )}
      </ul>
      {rows.length > SHOWN && (
        <button type="button" className="mini quiet" onClick={() => setAll((a) => !a)}>
          {all ? "Show fewer" : `Show all ${rows.length}`}
        </button>
      )}
    </div>
  );
}

/** A small open link next to a candidate, so the row itself still adds the pick. */
function OpenItem({ clientKey, item }: { clientKey: string; item: WorkItem }) {
  return (
    <WorkLink clientKey={clientKey} url={item.url} className="open-item" title={`Open ${item.type} ${item.id} in DevOps`}>
      <span aria-hidden="true">↗</span>
      <span className="sr-only">Open {item.id} in DevOps</span>
    </WorkLink>
  );
}

function Portfolio({ item, clientKey, kids: children, drafts, add, act }: { item: WorkItem; clientKey: string; kids: WorkItem[]; drafts: DraftStory[]; add: (i: Record<string, unknown>) => Promise<boolean>; act: PlanDayAct }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [size, setSize] = useState<Size>("M");
  const needs = children.length === 0 && drafts.length === 0;
  const menu = useMenu((env) => itemMenu(env, clientKey, item));
  return (
    <li className="portfolio" onContextMenu={menu.onContextMenu}>
      <div className="portfolio-row" {...ITEM_ATTRS(clientKey, item.url)}>
        <button type="button" className="cand parent" aria-expanded={open} onClick={() => setOpen((o) => !o)} title={`${item.type} ${item.id}: ${item.title}`}>
          <span className="plus" aria-hidden="true">{open ? "▾" : "▸"}</span>
          <span className="wi-type">{typeTag(item.type)}</span>
          <span className="wi-title">{item.title}</span>
          <span className={needs ? "needs" : "muted kids"}>{needs ? "Needs breakdown" : `${children.length + drafts.length} to pick`}</span>
        </button>
        <OpenItem clientKey={clientKey} item={item} />
        {menu.button(`Actions for ${item.type} ${item.id}`)}
      </div>
      {open && (
        <ul className="kids-list">
          {children.map((c) => (
            <MenuRow key={c.id} build={(env) => itemMenu(env, clientKey, c)} label={`Actions for ${c.type} ${c.id}`} item={{ clientKey, url: c.url }}>
              <button type="button" className="cand" onClick={() => add({ itemId: c.id })} title={`${c.type} ${c.id}: ${c.title} (${c.state})`}>
                <span className="plus" aria-hidden="true">+</span>
                <span className="wi-type">{typeTag(c.type)}</span>
                <span className="wi-title">{c.title}</span>
              </button>
              <OpenItem clientKey={clientKey} item={c} />
            </MenuRow>
          ))}
          {drafts.map((d) => (
            <li key={`d${d.id}`}>
              <button type="button" className="cand" onClick={() => add({ draftId: d.id, size: d.size })}>
                <span className="plus" aria-hidden="true">+</span>
                <span className="wi-type">Draft</span>
                <span className="wi-title">{d.title}</span>
              </button>
            </li>
          ))}
          <li>
            <form
              className="draft-form"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!title.trim()) return;
                if (await act("draft.add_story", { clientKey, parentItemId: item.id, title, size })) setTitle("");
              }}
            >
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Draft story (local only)" aria-label={`Draft story under ${item.title}`} maxLength={200} />
              <span className="sizes" role="group" aria-label="Draft size">
                {SIZES.map((s) => (
                  <button key={s} type="button" className="size" aria-pressed={size === s} onClick={() => setSize(s)}>
                    {s}
                  </button>
                ))}
              </span>
              <button type="submit" className="mini">Add draft</button>
            </form>
          </li>
        </ul>
      )}
    </li>
  );
}

function Intention({ clientKey, clientName, half, date, act }: { clientKey: string; clientName: string; half: Half; date: string; act: PlanDayAct }) {
  const [text, setText] = useState("");
  return (
    <form
      className="intention"
      onSubmit={async (e) => {
        e.preventDefault();
        if (text.trim() && (await act("pick.add", { date, half, clientKey, intention: text }))) setText("");
      }}
    >
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder={`Or type an intention for ${clientName}, Enter to add`} aria-label={`Intention for ${half}`} maxLength={200} />
    </form>
  );
}
