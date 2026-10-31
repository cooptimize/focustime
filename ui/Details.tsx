import { useContext, useEffect, useRef, type CSSProperties } from "react";
import { formatDuration } from "../week/format.ts";
import { rankRisks } from "../week/risks.ts";
import type { Day, Slot } from "../week/types.ts";
import { DevOpsWork, workStatusLabel } from "./work.ts";
import { WorkLink } from "./WorkLink.tsx";
import { freeMinutes, longestFree, nowIfUnderway } from "../week/free.ts";
import { itemMenu } from "./menu.ts";
import { MenuRow } from "./Menus.tsx";
import { updatedAgo } from "./refresh.ts";
import { clientColor, eventRange, halfName, longDate, ruleLabel, SampleSources, severityLabel, showAsLabel, slotRange, sourceName, startClock } from "./labels.ts";

type Props = { open: boolean; day: Day; slot: Slot; timeZone: string; colors: Record<string, string>; now: string; onClose: () => void };

export function Details({ open, day, slot, timeZone, colors, now, onClose }: Props) {
  const at = nowIfUnderway(slot, now);
  const ref = useRef<HTMLDialogElement>(null);
  const samples = useContext(SampleSources);
  const allWork = useContext(DevOpsWork);
  // One list per client booked in this half-day, each with only that client's items.
  const works = day.kind === "overflow" ? [] : slot.focus.map((b) => allWork.get(b.clientKey)).filter((w) => w !== undefined);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const tz = timeZone;
  return (
    <dialog ref={ref} className="details" onClose={onClose} onClick={(e) => e.target === ref.current && onClose()} aria-labelledby="details-title">
      <header>
        <div>
          <h2 id="details-title">
            {longDate(day.date)} · {halfName(slot.half)}
          </h2>
          <p className="muted">
            {slot.half} {slotRange(slot, tz)} · {day.kind === "overflow" ? "Overflow day, no focus blocks" : `Times in ${timeZone}`}
          </p>
        </div>
        <button type="button" className="close" onClick={onClose} aria-label="Close details">
          Esc
        </button>
      </header>

      {day.pto && (
        <section className="pto-note full">
          <h3>PTO</h3>
          <p>Whole day off · {day.pto.titles.join(", ")}. No risks are raised and nothing can be planned.</p>
        </section>
      )}

      {day.kind === "work" && (
        <section>
          <h3>Focus</h3>
          {slot.focus.length === 0 && <p className="open-note">Open. Free for client or internal work.</p>}
          {slot.focus.map((b, i) => (
            <div key={b.id} className="focus-row" style={{ "--c": clientColor(b.clientKey, colors) } as CSSProperties}>
              <span className="swatch" />
              <strong>{b.clientName}</strong>
              <span className="muted">
                {b.source === "dataverse" ? `${b.clientFullName ? `${b.clientFullName} · ` : ""}Dataverse Focus Time` : "Standing block from Coopilot config"}
                {i === 0 && slot.focus.length > 1 ? " · shown" : ""}
              </span>
            </div>
          ))}
        </section>
      )}

      {slot.risks.length > 0 && (
        <section>
          <h3>Risks</h3>
          <ul className="risk-list">
            {rankRisks(slot.risks).map((r, i) => (
              <li key={i} className={r.severity}>
                <span className="badge-text">
                  <span className="dot" aria-hidden="true" />
                  {severityLabel(r)}: {ruleLabel[r.rule]}
                </span>
                <span>{r.reason}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {works.map((w) => (
        <section key={w.clientKey} className="work-section">
          <h3>
            Assigned to you in DevOps · {w.clientName}
            <span className="muted"> · {w.items.length} open{w.status === "ok" ? "" : ` · ${workStatusLabel(w)}`}{w.fetchedAt ? ` · ${updatedAgo(w.fetchedAt, Date.now(), tz)}` : ""}</span>
          </h3>
          {w.message && <p className="muted">{w.message}</p>}
          {w.items.length > 0 && (
            <ol className="work-list">
              {w.items.map((i) => (
                <MenuRow key={i.id} build={(env) => itemMenu(env, w.clientKey, i)} label={`Actions for ${i.type} ${i.id}`} item={{ clientKey: w.clientKey, url: i.url }}>
                  <WorkLink clientKey={w.clientKey} url={i.url} className="wi-link">
                    <span className="wi-type">{i.type}</span>
                    <span className="wi-id">{i.id}</span>
                    <span className="wi-title">{i.title}</span>
                    <span className="wi-state">{i.state}</span>
                  </WorkLink>
                </MenuRow>
              ))}
            </ol>
          )}
        </section>
      ))}

      <section>
        <h3>Time</h3>
        <p>
          {formatDuration(slot.busyMeetingMinutes)} meetings · {formatDuration(freeMinutes(slot, at))} free{at ? " from now" : ""} · longest {formatDuration(longestFree(slot, at))}
        </p>
        {slot.freeGaps.length > 0 && (
          <p className="muted">
            Free: {slot.freeGaps.map((g) => `${startClock(g.start, tz)}–${startClock(g.end, tz)} (${formatDuration(g.minutes)})`).join(", ")}
          </p>
        )}
      </section>

      <section>
        <h3>Events in this half-day</h3>
        {slot.events.length === 0 && <p className="muted">None.</p>}
        <ShowAsLegend />
        <ul className="event-list">
          {slot.events.map((p) => (
            <li key={p.event.id} className={`${p.event.isPersonal ? "personal" : "meeting"} show-${p.event.showAs ?? "busy"}`}>
              <span className="when">{eventRange(p.event, tz)}</span>
              <span className="what">{p.event.title}</span>
              <span className="muted">
                {sourceName(p.event, samples)} · {p.event.isPersonal ? "personal" : "meeting"} · {showAsLabel(p.event)} · {formatDuration(p.minutesInside)} inside
              </span>
            </li>
          ))}
        </ul>
      </section>

      {(day.allDay.length > 0 || day.early.length > 0 || day.evening.length > 0) && (
        <section>
          <h3>Same day, outside this half-day</h3>
          <ul className="event-list">
            {[...day.allDay.map((e) => ({ e, id: e.id })), ...day.early.map((p) => ({ e: p.event, id: p.event.id })), ...day.evening.map((p) => ({ e: p.event, id: p.event.id }))].map(({ e, id }) => (
              <li key={id} className={e.isPersonal ? "personal" : "meeting"}>
                <span className="when">{eventRange(e, tz)}</span>
                <span className="what">{e.title}</span>
                <span className="muted">{sourceName(e, samples)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </dialog>
  );
}

/** How calendar events are drawn by their Outlook "show as" status (D103): not by color alone. */
function ShowAsLegend() {
  const rows: [string, string][] = [
    ["busy", "Busy"],
    ["tentative", "Tentative"],
    ["free", "Free"],
    ["oof", "Out of office"],
    ["workingElsewhere", "Working elsewhere"],
  ];
  return (
    <ul className="showas-legend" aria-label="How events are shown">
      {rows.map(([k, label]) => (
        <li key={k}>
          <span className={`legend-swatch show-${k}`} aria-hidden="true" />
          {label}
        </li>
      ))}
    </ul>
  );
}
