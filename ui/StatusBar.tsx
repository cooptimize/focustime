import { useState } from "react";
import type { SourceSummary } from "../actions/types.ts";
import type { ClientWork } from "../week/types.ts";
import { hoursSummary, VIEW_RANGE_NAMES, VIEW_RANGES, type TimeModel, type ViewRange } from "../week/hours.ts";
import { devopsSummary, workStatusLabel } from "./work.ts";
import { causeLines, notConnected, SOURCE_NAMES, sourceActions, stateOf, type Calendar, type Fix } from "./status.ts";
import { shortDate } from "./labels.ts";
import { updatedAgo } from "./refresh.ts";

type Props = {
  sources: SourceSummary[];
  devops: ClientWork[] | null;
  sampleWeek: string;
  isSampleWeek: boolean;
  hours: TimeModel;
  /** The week's timeline range, and whether it was widened to show planned time outside it. */
  range: { mode: ViewRange; start: string; end: string; expanded: boolean };
  onRange: (r: ViewRange) => void;
  loading: boolean;
  busy: Calendar | null;
  notice: string | null;
  /** Wall clock, ticking every 30 s, for "updated N min ago". */
  clock: number;
  onRefresh: () => void;
  onConnect: (s: Calendar) => void;
  onDisconnect: (s: Calendar) => void;
};

function when(iso: string, tz: string): string {
  const z = Temporal.Instant.from(iso).toZonedDateTimeISO(tz);
  const today = Temporal.Now.plainDateISO(tz);
  const t = `${z.hour % 12 || 12}:${String(z.minute).padStart(2, "0")} ${z.hour < 12 ? "AM" : "PM"}`;
  return z.toPlainDate().equals(today) ? t : `${shortDate(z.toPlainDate().toString())} ${t}`;
}

export function StatusBar({ sources, devops, sampleWeek, isSampleWeek, hours, range, onRange, loading, busy, notice, clock, onRefresh, onConnect, onDisconnect }: Props) {
  const samples = sources.filter((s) => s.sample);
  const shape = { timeZone: hours.timeZone };
  const nextRange = VIEW_RANGES[(VIEW_RANGES.indexOf(range.mode) + 1) % VIEW_RANGES.length]!;
  const lines = causeLines(sources, devops);
  // Step 10: one quiet line when everything is live; it opens on a click and on its own when something needs attention.
  const [open, setOpen] = useState(false);
  const fine = !lines.length && !samples.length && sources.every((s) => stateOf(s).cls === "live") && (devops ?? []).every((c) => c.status === "ok");
  const oldest = sources.map((s) => s.fetchedAt).filter((x): x is string => !!x).sort()[0] ?? null;
  const fixButton = (f: Fix, key: string) =>
    f.kind === "retry" ? (
      <button key={key} type="button" className="mini primary" disabled={loading} onClick={onRefresh}>
        {loading ? "Retrying…" : "Retry"}
      </button>
    ) : (
      <button key={key} type="button" className="mini primary" disabled={busy !== null} onClick={() => onConnect(f.calendar)}>
        {busy === f.calendar ? "Waiting for sign-in…" : `${f.kind === "connect" ? "Connect" : "Reconnect"} ${SOURCE_NAMES[f.calendar]}`}
      </button>
    );
  if (fine && !open)
    return (
      <footer className="statusbar quiet" aria-label="Source status">
        <div className="status-row">
          <button type="button" className="status-quiet" onClick={() => setOpen(true)} title="Every source is live. Click for each source's status">
            <span className="dot" aria-hidden="true" />
            All sources live{oldest ? ` · ${updatedAgo(oldest, clock, shape.timeZone)}` : ""}
          </button>
          <button type="button" className="refresh mini quiet" onClick={onRefresh} disabled={loading} aria-label="Refresh all sources" title="Refresh all sources (R)">
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
        {notice && <div className="status-line notice" role="status">{notice}</div>}
      </footer>
    );
  return (
    <footer className="statusbar" aria-label="Source status">
      <div className="status-row">
        {fine && (
          <button type="button" className="mini quiet" onClick={() => setOpen(false)} aria-label="Fold the source status">
            Hide
          </button>
        )}
        {sources.map((s) => {
          const st = stateOf(s);
          const detail = s.source === "dataverse" ? `${s.itemCount} ${s.itemCount === 1 ? "pattern" : "patterns"}` : s.source === "pto" ? `${s.itemCount} ${s.itemCount === 1 ? "day" : "days"}` : s.sample || notConnected(s) ? "" : `${s.itemCount} events`;
          const actions = sourceActions(s);
          const cal = s.source === "outlook" || s.source === "google" ? s.source : null;
          return (
            <span key={s.source} className={`source ${st.cls}`} title={s.message ?? ""}>
              <span className="dot" aria-hidden="true" />
              {SOURCE_NAMES[s.source]}
              <span className={`state ${st.cls}`}>{st.label}</span>
              {s.fetchedAt && (
                <span className="muted" title={`${s.fromCache ? "Snapshot from" : "Fetched"} ${when(s.fetchedAt, shape.timeZone)}`}>
                  {updatedAgo(s.fetchedAt, clock, shape.timeZone)}
                </span>
              )}
              {detail && <span className="muted">{detail}</span>}
              {cal && (actions.includes("connect") || actions.includes("reconnect")) && (
                <button type="button" className="mini primary" disabled={busy !== null} onClick={() => onConnect(cal)}>
                  {busy === cal ? "Waiting for sign-in…" : actions.includes("connect") ? "Connect" : "Reconnect"}
                </button>
              )}
              {cal && actions.includes("disconnect") && (
                <button type="button" className="mini quiet" disabled={busy !== null} onClick={() => onDisconnect(cal)} aria-label={`Disconnect ${SOURCE_NAMES[s.source]}`}>
                  Disconnect
                </button>
              )}
            </span>
          );
        })}
        <DevOpsEntry devops={devops} clock={clock} timeZone={shape.timeZone} />
        {samples.length > 0 && (
          <span className="sample-note">
            <span className="sample-pill">Sample meetings</span>
            <span className="muted">
              {samples.map((s) => SOURCE_NAMES[s.source]).join(" and ")} not set up yet{isSampleWeek ? "" : `; sample meetings exist only for the week of ${shortDate(sampleWeek)}`}
            </span>
          </span>
        )}
        <span className="muted shape" title={`Working hours. Change them in Settings or a day's menu. Times in ${hours.timeZone}`}>
          {hoursSummary(hours)}
        </span>
        <button
          type="button"
          className="mini quiet range-toggle"
          onClick={() => onRange(nextRange)}
          title={`Timelines show ${range.start}–${range.end}${range.expanded ? ", widened to show planned time" : ""}. Click for ${VIEW_RANGE_NAMES[nextRange]} (H)`}
          aria-label={`View range: ${VIEW_RANGE_NAMES[range.mode]}. Change to ${VIEW_RANGE_NAMES[nextRange]}`}
        >
          {VIEW_RANGE_NAMES[range.mode]}
          {range.expanded && <span className="muted"> +</span>}
        </button>
        <button type="button" className="refresh" onClick={onRefresh} disabled={loading} aria-label="Refresh all sources">
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>
      {notice && <div className="status-line notice" role="status">{notice}</div>}
      {lines.map((l) => (
        <div key={l.key} className={`status-line problem ${l.cause ?? "own"}`} role="status">
          <span className="dot" aria-hidden="true" />
          <span className="line-text">
            {l.text}.
            {l.since && <> Showing data saved {when(l.since, shape.timeZone)}.</>}
            {l.missing && (l.since ? " Some have nothing saved yet." : " Nothing saved to show yet.")}
            {l.step && <> {l.step}, then</>}
          </span>
          {l.fixes.map((f, i) => fixButton(f, `${l.key}-${i}`))}
        </div>
      ))}
    </footer>
  );
}

/** One entry for all clients: "DevOps 4 of 5 live". Hover for a summary, click for each client's status. */
function DevOpsEntry({ devops, clock, timeZone }: { devops: ClientWork[] | null; clock: number; timeZone: string }) {
  const [open, setOpen] = useState(false);
  const sum = devopsSummary(devops);
  if (!sum || !devops) return null;
  const cls = sum.level === "live" ? "live" : sum.level === "partial" ? "cached" : "error";
  const lines = devops.map((c) => `${c.clientName}: ${c.message ?? workStatusLabel(c)}`).join("\n");
  return (
    <span className={`source devops ${cls}`}>
      <button type="button" className="devops-toggle" aria-expanded={open} aria-controls="devops-status" title={lines} onClick={() => setOpen((o) => !o)}>
        <span className="dot" aria-hidden="true" />
        DevOps
        <span className={`state ${cls}`}>{sum.label}</span>
      </button>
      {open && (
        <div className="devops-pop" id="devops-status" role="region" aria-label="DevOps status per client">
          <ul>
            {devops.map((c) => (
              <li key={c.clientKey} className={c.status === "ok" ? "ok" : "problem"}>
                <strong>{c.clientName}</strong>
                <span className="muted"> · {workStatusLabel(c)} · {c.items.length} open{c.fetchedAt ? ` · ${updatedAgo(c.fetchedAt, clock, timeZone)}` : ""}</span>
                {c.message && <div className="msg">{c.message}</div>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </span>
  );
}
