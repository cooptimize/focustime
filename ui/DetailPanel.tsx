// U3 (D384): one detail panel on the right, shared by Week and Today. It opens from a block card's body, a card's
// features line, a due badge, or Enter on a focused card; Esc closes it. It replaces Week's centered Details dialog
// and Today's 3840 pick detail. Contents: client and time range with the risk reasons, the block's agenda with free
// gaps (as Plan the day's), the picks as full rows, the client's features this week with story counts and Needs
// stories actions, the client's follow-ups, DevOps items assigned to me there and not planned yet, and the ⋯ actions.
import { CloseButton, useReturnFocus } from "./CloseButton.tsx";
import { TypeIcon } from "./TypeIcon.tsx";
import { typeNeedsBreakdown } from "../plan/process.ts";
import { useCallback, useContext, useEffect, useRef, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode, type RefObject } from "react";
import type { WeekLoadData } from "../actions/types.ts";
import { rankRisks } from "../week/risks.ts";
import type { Day, Slot } from "../week/types.ts";
import type { Pick } from "../plan/types.ts";
import { mondayOf } from "../week/dates.ts";
import { captureClients } from "./Capture.tsx";
import { FollowUpRow } from "./FollowUps.tsx";
import { clientColor, longDate, slotRange } from "./labels.ts";
import { itemMenu, openCoopBrief, slotMenu } from "./menu.ts";
import { BreakDownButton } from "./BreakDownPanel.tsx";
import { MenuRow, useMenu } from "./Menus.tsx";
import { Agenda } from "./PlanDay.tsx";
import { PickRow } from "./PickRow.tsx";
import { checklistFor, clientFeatures, clientNames, PlanCtx, storiesUnder } from "./planview.ts";
import { HalfScope } from "./scope.ts";
import { DevOpsWork, workStatusLabel } from "./work.ts";
import { WorkLink } from "./WorkLink.tsx";
import { topOverlay } from "./keys.ts";
import type { PanelFocus } from "./WeekGrid.tsx";
import { userZone } from "../week/zone.ts";
import { usePhone } from "./viewport.ts";
import { MoveTo, pickDragged, useDragSource, YourStories } from "./WeekStories.tsx";
import { BlockCalls, chatsOf, useCoworkData } from "./cowork.tsx";

const live = (p: Pick) => p.status === "planned" || p.status === "done";

type Props = {
  data: WeekLoadData;
  day: Day;
  slot: Slot;
  focus: PanelFocus | null;
  now: string;
  onClose: () => void;
  /** Start focus on a pick (today's blocks only), the same as on Today's card. */
  onStart?: ((p: Pick) => void) | undefined;
  onChanged: () => void;
  onNotice?: ((m: string) => void) | undefined;
  /**
   * PV-1: "week" is Week's panel: the block's stories (only mine, grouped by feature, ranked) replace This week and
   * "Assigned to you, not planned", and stories drag onto the week's blocks. Today's panel keeps its sections.
   */
  variant?: "week" | undefined;
};

/** A click on a control inside a card (a button, link, checkbox, event or timebox) isn't a click on the card body. */
export function interactive(e: ReactMouseEvent): boolean {
  const t = e.target as HTMLElement;
  const card = e.currentTarget as HTMLElement;
  const hit = t.closest("button, a, input, label, select, textarea, [role='button'], [role='menuitem'], .tbox, .r-ev, .event");
  return !!hit && hit !== card && card.contains(hit);
}

export function DetailPanel({ data, day, slot, focus, now, onClose, onStart, onChanged, onNotice, variant }: Props) {
  const weekPanel = variant === "week";
  const ref = useRef<HTMLElement>(null);
  useReturnFocus();
  const phone = usePhone();
  const plan = useContext(PlanCtx);
  const allWork = useContext(DevOpsWork);
  const tz = userZone(data);
  const nameOf = clientNames(data);
  const primary = slot.focus[0] ?? null;
  const client = primary?.clientKey ?? null;
  const work = client ? allWork.get(client) : undefined;
  const weekStart = mondayOf(slot.date);
  const title = day.pto ? "PTO" : primary ? nameOf(primary.clientKey) : slot.off ? (day.kind === "work" ? "No working hours" : "Catch-up") : "Open";
  const picks = day.pto ? [] : checklistFor(plan.week, slot.date, slot.half).length ? checklistFor(plan.week, slot.date, slot.half) : (plan.week?.[slot.date]?.picks ?? []).filter((p) => p.half === slot.half && live(p));
  const committed = !!plan.week?.[slot.date]?.committedAt;
  // Start focus on the first pick still to do, like the next pick on Today's card.
  const firstPlanned = picks.find((p) => p.status === "planned")?.id ?? null;
  const isToday = slot.date === data.planDay.date;
  const timer = data.timer;
  const menu = useMenu((env) => slotMenu(env, slot.date, slot.half, client, primary?.clientName ?? null));
  const feats = clientFeatures(data.weekFeatures, weekStart, client);
  const weekPicks = Object.values(data.plan ?? {}).flatMap((d) => d.picks).filter(live);
  const followUps = client ? data.followUps.filter((f) => f.clientKey === client) : [];
  const planned = new Set(weekPicks.filter((p) => p.clientKey === client && p.itemId !== null).map((p) => p.itemId));
  const unplanned = (work?.items ?? []).filter((i) => !planned.has(i.id));
  const note = client ? data.resumeNotes[client] : undefined;
  const area = useRef<HTMLTextAreaElement>(null);
  const cowork = useCoworkData();

  usePanelEsc(ref, onClose);

  // Opened on a section: bring it into view.
  const focusSel = !focus ? null : focus.kind === "features" ? '[data-panel-focus="features"]' : focus.kind === "pick" ? `[data-pick="${focus.id}"]` : `[data-follow-up="${focus.id}"]`;
  useEffect(() => {
    if (!focusSel) return;
    const el = ref.current?.querySelector(focusSel);
    el?.scrollIntoView({ block: "nearest" });
    ref.current?.querySelectorAll(".dp-focused").forEach((x) => x.classList.remove("dp-focused"));
    el?.classList.add("dp-focused");
  }, [focusSel, slot.date, slot.half]);

  // NV-1: the Coop brief opens Break down's side panel (it copies there).
  const brief = (itemId: number, title: string, type?: string) => client && openCoopBrief(client, { id: itemId, title, ...(type ? { type } : {}) }, weekStart);

  return (
    <aside ref={ref} className="detail-panel" aria-label={`Details: ${title}, ${longDate(slot.date)}`} style={{ "--c": clientColor(client ?? undefined, data.clients) } as CSSProperties}>
      <header className="dp-head">
        {phone && <PanelBack onClose={onClose} />}
        <div className="dp-title">
          <h2>
            {client && <span className="swatch" aria-hidden="true" />}
            {title}
          </h2>
          <span className="dp-when">
            {longDate(slot.date).replace(/,\s*\d{4}$/, "")} · {slotRange(slot, tz)}
          </span>
        </div>
        <HalfScope.Provider value={true}>{menu.button(`Actions for ${title}`)}</HalfScope.Provider>
        {!phone && (
          <CloseButton onClose={onClose} />
        )}
      </header>

      <div className="dp-body">
        {day.pto && <p className="dp-line">Whole day off · {day.pto.titles.join(", ")}</p>}
        {slot.risks.length > 0 && (
          <ul className="dp-risks">
            {rankRisks(slot.risks).map((r, i) => (
              <li key={i} className={r.severity}>
                <span className={`status-pill ${r.severity}`}>{r.severity === "at_risk" ? "At risk" : "Watch"}</span> {r.reason}
              </li>
            ))}
          </ul>
        )}
        {slot.focus.slice(1).map((b) => (
          <p key={b.id} className="dp-line">
            Also booked: {b.clientName}
          </p>
        ))}
        {/* CW-1: the client's delivery chats: a live call with Join, else Start a call (both open Teams). */}
        {!day.pto && slot.date >= data.planDay.date && <BlockCalls chats={chatsOf(cowork, client)} zone={tz} today={isToday} />}

        {!day.pto && (
          <section className="dp-section" aria-label="Agenda">
            <h3>Agenda</h3>
            <Agenda slot={slot} now={now} tz={tz} clientName={(k) => (k ? nameOf(k) : "")} pickRow={() => null} />
            {!slot.events.length && !slot.freeGaps.length && <p className="dp-empty">Nothing on the calendar.</p>}
          </section>
        )}

        {picks.length > 0 && (
          <section className="dp-section" aria-label="Plan">
            <h3>Plan</h3>
            <ul className="dp-picks">
              {picks.map((p) => (
                  <PanelPick
                    key={p.id}
                    week={weekPanel}
                    className={focus?.kind === "pick" && focus.id === p.id ? "dp-focused" : ""}
                    pick={p}
                    toggle={plan.toggle}
                    link
                    canTick={committed || slot.date < data.planDay.date}
                    extra={
                      onStart && isToday && committed && p.id === firstPlanned && !timer ? (
                        <button type="button" className="mini dp-start" onClick={() => onStart(p)} title="Start focus on this to-do">
                          Start focus
                        </button>
                      ) : undefined
                    }
                  />
              ))}
            </ul>
          </section>
        )}
        {note && (
          <p className="dp-line dp-note" title="Where you left off last time">
            Left off: {note.note}
          </p>
        )}

        {weekPanel && work && !day.pto && (
          <>
            {work.status !== "ok" && <p className="dp-empty">DevOps {workStatusLabel(work)}{work.message ? `: ${work.message}` : ""}</p>}
            <YourStories data={data} work={work} clientName={title} slot={slot} onChanged={onChanged} />
          </>
        )}

        {!weekPanel && feats.length > 0 && (
          <section className="dp-section" aria-label="This week's features" data-panel-focus="features">
            <h3>This week</h3>
            <ul className="dp-feats">
              {feats.map((f) => {
                const stories = storiesUnder(work, f.itemId);
                const done = stories.filter((s) => weekPicks.some((p) => p.clientKey === f.clientKey && p.itemId === s.id)).length;
                const item = work ? [...work.items, ...work.children].find((i) => i.id === f.itemId) ?? null : null;
                const type = item?.type ?? f.itemType;
                // WT-1: only a type that needs breakdown in the project's process asks for stories.
                const needs = !stories.length && (!type || typeNeedsBreakdown(work?.types, type));
                return (
                  <li key={f.itemId} className={needs ? "needs" : undefined}>
                    <WorkLink clientKey={f.clientKey} url={f.url} className="feat-link">
                      {type && <TypeIcon clientKey={f.clientKey} type={type} />}
                      {f.title}
                    </WorkLink>
                    {!needs ? (
                      stories.length > 0 && (
                      <span className="dp-count">
                        {done} of {stories.length} {stories.length === 1 ? "story" : "stories"} planned
                      </span>
                      )
                    ) : (
                      <span className="dp-needs">
                        <span className="tw-needs">Needs stories</span>
                        {item && <BreakDown clientKey={f.clientKey} item={item} />}
                        <button type="button" className="link-btn" onClick={() => brief(f.itemId, f.title, item?.type)}>
                          Coop brief
                        </button>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
            <textarea ref={area} className="sr-only" aria-hidden="true" tabIndex={-1} readOnly />
          </section>
        )}

        {followUps.length > 0 && (
          <section className="dp-section" aria-label="Promises">
            <h3>Promises</h3>
            <ul className="dp-fus">
              {followUps.map((f) => (
                <FollowUpRow key={f.id} l={f} timeZone={tz} today={data.planDay.date} clients={captureClients(data)} onChanged={(m) => (m && onNotice?.(m), onChanged())} compact />
              ))}
            </ul>
          </section>
        )}

        {!weekPanel && work && !day.pto && (
          <section className="dp-section" aria-label="Assigned to you in DevOps">
            <h3>
              Assigned to you, not planned{work.status !== "ok" && <span className="dp-src"> · {workStatusLabel(work)}</span>}
            </h3>
            {work.message && <p className="dp-empty">{work.message}</p>}
            {unplanned.length > 0 ? (
              <ol className="work-list">
                {unplanned.map((i) => (
                  <MenuRow key={i.id} build={(env) => itemMenu(env, work.clientKey, i)} label={`Actions for ${i.type} ${i.id}`} item={{ clientKey: work.clientKey, url: i.url }}>
                    <WorkLink clientKey={work.clientKey} url={i.url} className="wi-link">
                      <TypeIcon clientKey={work.clientKey} type={i.type} />
                      <span className="wi-id">#{i.id}</span>
                      <span className="wi-title">{i.title}</span>
                      <span className="wi-state">{i.state}</span>
                    </WorkLink>
                  </MenuRow>
                ))}
              </ol>
            ) : (
              !work.message && <p className="dp-empty">All planned.</p>
            )}
          </section>
        )}
      </div>
    </aside>
  );
}

/** Esc closes a panel (not while a menu or dialog sits above it, and not while typing in it). */
/** A pick in the panel's Plan list; on Week (PV-1) with its type icon, draggable to another block, and Move to…. */
function PanelPick({ week, ...p }: Parameters<typeof PickRow>[0] & { week: boolean }) {
  const drag = useDragSource(week ? pickDragged(p.pick) : null);
  if (!week) return <PickRow {...p} />;
  return <PickRow {...p} typeIcon dragProps={drag} extra={<>{p.extra}<MoveTo pick={p.pick} /></>} />;
}

function usePanelEsc(ref: RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || topOverlay(document) !== "none") return;
      const t = e.target as HTMLElement | null;
      if (t && ref.current?.contains(t) && t.matches("input:not([type=checkbox]), textarea, select")) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [ref, onClose]);
}

/**
 * U4: the same panel for other subjects (Plan the week's feature, client budget and DevOps health): the title with an
 * optional swatch, a muted line, an optional ⋯, the close button and Esc; the body scrolls on its own.
 */
/** P1: on the phone a panel is full screen and starts with Back instead of ×. */
function PanelBack({ onClose }: { onClose: () => void }) {
  return (
    <button type="button" className="dp-back" onClick={onClose}>
      ‹ Back
    </button>
  );
}

export function PanelShell({ title, sub, color, menu, label, onClose, children }: { title: ReactNode; sub?: ReactNode; color?: string | undefined; menu?: ReactNode; label: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const phone = usePhone();
  // D462: Esc or × puts focus back where the panel was opened from (the row), when it is still there.
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const a = document.activeElement as HTMLElement | null;
    if (a && a !== document.body && !ref.current?.contains(a)) opener.current = a;
  }, [label]);
  const close = useCallback(() => {
    const back = opener.current;
    onClose();
    if (back?.isConnected) requestAnimationFrame(() => back.focus({ preventScroll: true }));
  }, [onClose]);
  usePanelEsc(ref, close);
  return (
    <aside ref={ref} className="detail-panel" aria-label={label} style={color ? ({ "--c": color } as CSSProperties) : undefined}>
      <header className="dp-head">
        {phone && <PanelBack onClose={close} />}
        <div className="dp-title">
          <h2>
            {color && <span className="swatch" aria-hidden="true" />}
            {title}
          </h2>
          {sub && <span className="dp-when">{sub}</span>}
        </div>
        {menu}
        {!phone && (
          <CloseButton onClose={close} />
        )}
      </header>
      <div className="dp-body">{children}</div>
    </aside>
  );
}

/**
 * Break down on a Needs stories row (Today's This week chips, the panel, Plan the day, Plan the week): BD-1's side panel,
 * labelled with the parent's type. A single draft story by hand stays in the item's ⋯ menu.
 */
export function BreakDown({ clientKey, item }: { clientKey: string; item: { id: number; title: string; type?: string } }) {
  return <BreakDownButton clientKey={clientKey} item={item} />;
}

/** The panel's block for a selection: the day and its slot (AM for a whole-day cell). */
export function panelSlot(day: Day, half: "AM" | "PM" | "EVE"): Slot {
  return (half === "AM" ? day.am : half === "PM" ? day.pm : day.eve) ?? day.am;
}
