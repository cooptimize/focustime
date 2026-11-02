// U3 (D384): one detail panel on the right, shared by Week and Today. It opens from a block card's body, a card's
// features line, a due badge, or Enter on a focused card; Esc closes it. It replaces Week's centered Details dialog
// and Today's 3840 pick detail. Contents: client and time range with the risk reasons, the block's agenda with free
// gaps (as Plan the day's), the picks as full rows, the client's features this week with story counts and Needs
// stories actions, the client's follow-ups, DevOps items assigned to me there and not planned yet, and the ⋯ actions.
import { useContext, useEffect, useRef, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import type { WeekLoadData } from "../actions/types.ts";
import { rankRisks } from "../week/risks.ts";
import type { Day, IsoDate, Slot, WorkItem } from "../week/types.ts";
import type { Pick } from "../plan/types.ts";
import { mondayOf } from "../week/dates.ts";
import { captureClients } from "./Capture.tsx";
import { FollowUpRow, copy } from "./FollowUps.tsx";
import { clientColor, longDate, slotRange } from "./labels.ts";
import { draftPrompt, itemMenu, slotMenu } from "./menu.ts";
import { MenuRow, useMenu } from "./Menus.tsx";
import { Agenda } from "./PlanDay.tsx";
import { PickRow } from "./PickRow.tsx";
import { checklistFor, clientFeatures, clientNames, PlanCtx, storiesUnder } from "./planview.ts";
import { HalfScope } from "./scope.ts";
import { call } from "./api.ts";
import { DevOpsWork, workStatusLabel } from "./work.ts";
import { WorkLink } from "./WorkLink.tsx";
import { topOverlay } from "./keys.ts";
import type { PanelFocus } from "./WeekGrid.tsx";

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
};

/** A click on a control inside a card (a button, link, checkbox, event or timebox) isn't a click on the card body. */
export function interactive(e: ReactMouseEvent): boolean {
  const t = e.target as HTMLElement;
  const card = e.currentTarget as HTMLElement;
  const hit = t.closest("button, a, input, label, select, textarea, [role='button'], [role='menuitem'], .tbox, .r-ev, .event");
  return !!hit && hit !== card && card.contains(hit);
}

export function DetailPanel({ data, day, slot, focus, now, onClose, onStart, onChanged, onNotice }: Props) {
  const ref = useRef<HTMLElement>(null);
  const plan = useContext(PlanCtx);
  const allWork = useContext(DevOpsWork);
  const tz = data.hours.timeZone;
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

  // Esc closes the panel (not while a menu or dialog sits above it, and not while typing in it).
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
  }, [onClose]);

  // Opened on a section: bring it into view.
  const focusSel = !focus ? null : focus.kind === "features" ? '[data-panel-focus="features"]' : focus.kind === "pick" ? `[data-pick="${focus.id}"]` : `[data-follow-up="${focus.id}"]`;
  useEffect(() => {
    if (!focusSel) return;
    const el = ref.current?.querySelector(focusSel);
    el?.scrollIntoView({ block: "nearest" });
    ref.current?.querySelectorAll(".dp-focused").forEach((x) => x.classList.remove("dp-focused"));
    el?.classList.add("dp-focused");
  }, [focusSel, slot.date, slot.half]);

  const brief = async (itemId: number) => {
    if (!client) return;
    try {
      const r = await call<{ markdown: string }>("feature.brief", { weekStart, clientKey: client, itemId });
      const ok = await copy(r.markdown, area.current);
      onNotice?.(ok ? `Coop brief for #${itemId} copied` : "Copy didn't work. Open Plan the week to copy it");
    } catch (e) {
      onNotice?.(e instanceof Error ? e.message : "Could not build the brief");
    }
  };

  return (
    <aside ref={ref} className="detail-panel" aria-label={`Details: ${title}, ${longDate(slot.date)}`} style={{ "--c": clientColor(client ?? undefined, data.clients) } as CSSProperties}>
      <header className="dp-head">
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
        <button type="button" className="dp-close" onClick={onClose} aria-label="Close details (Esc)" title="Close (Esc)">
          ×
        </button>
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
                  <PickRow
                    key={p.id}
                    className={focus?.kind === "pick" && focus.id === p.id ? "dp-focused" : ""}
                    pick={p}
                    toggle={plan.toggle}
                    link
                    canTick={committed || slot.date < data.planDay.date}
                    extra={
                      onStart && isToday && committed && p.id === firstPlanned && !timer ? (
                        <button type="button" className="mini dp-start" onClick={() => onStart(p)} title="Start focus on this pick">
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

        {feats.length > 0 && (
          <section className="dp-section" aria-label="This week's features" data-panel-focus="features">
            <h3>This week</h3>
            <ul className="dp-feats">
              {feats.map((f) => {
                const stories = storiesUnder(work, f.itemId);
                const done = stories.filter((s) => weekPicks.some((p) => p.clientKey === f.clientKey && p.itemId === s.id)).length;
                const item = work ? [...work.items, ...work.children].find((i) => i.id === f.itemId) ?? null : null;
                return (
                  <li key={f.itemId} className={stories.length ? undefined : "needs"}>
                    <WorkLink clientKey={f.clientKey} url={f.url} className="feat-link">
                      {f.title}
                    </WorkLink>
                    {stories.length ? (
                      <span className="dp-count">
                        {done} of {stories.length} {stories.length === 1 ? "story" : "stories"} planned
                      </span>
                    ) : (
                      <span className="dp-needs">
                        <span className="tw-needs">Needs stories</span>
                        {item && <DraftStories clientKey={f.clientKey} item={item} />}
                        <button type="button" className="link-btn" onClick={() => void brief(f.itemId)}>
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
          <section className="dp-section" aria-label="Follow-ups">
            <h3>Follow-ups</h3>
            <ul className="dp-fus">
              {followUps.map((f) => (
                <FollowUpRow key={f.id} l={f} timeZone={tz} today={data.planDay.date} clients={captureClients(data)} onChanged={(m) => (m && onNotice?.(m), onChanged())} compact />
              ))}
            </ul>
          </section>
        )}

        {work && !day.pto && (
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

/** Draft stories under a feature (the draft story prompt), from Today's This week chips and the panel. */
export function DraftStories({ clientKey, item }: { clientKey: string; item: WorkItem }) {
  const menu = useMenu((env) => draftPrompt(env, clientKey, item));
  return (
    <button type="button" className="link-btn tw-draft" onClick={menu.onContextMenu}>
      Draft stories
    </button>
  );
}

/** The panel's block for a selection: the day and its slot (AM for a whole-day cell). */
export function panelSlot(day: Day, half: "AM" | "PM" | "EVE"): Slot {
  return (half === "AM" ? day.am : half === "PM" ? day.pm : day.eve) ?? day.am;
}

export type PanelAt = { date: IsoDate; half: "AM" | "PM" | "EVE"; focus: PanelFocus | null };
