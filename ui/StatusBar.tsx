import { useState, type ReactNode } from "react";
import type { SourceSummary } from "../actions/types.ts";
import type { ClientWork } from "../week/types.ts";
import { hoursSummary, type TimeModel } from "../week/hours.ts";
import { devopsSummary, workStatusLabel } from "./work.ts";
import { causeLines, notConnected, SOURCE_NAMES, sourceActions, sourceKey, sourceLabel, stateOf, type Calendar, type Fix } from "./status.ts";
import { stampText } from "./stamp.ts";
import { updatedAgo } from "./refresh.ts";
import { userZone } from "../week/zone.ts";

type Props = {
  sources: SourceSummary[];
  devops: ClientWork[] | null;
  hours: TimeModel;
  loading: boolean;
  busy: Calendar | null;
  notice: string | null;
  /** U5.1: more chips for the bar's row (the "2 personal hidden" switch). */
  extra?: ReactNode;
  /** Wall clock, ticking every 30 s, for "updated N min ago". */
  clock: number;
  onRefresh: () => void;
  onConnect: (s: Calendar) => void;
  onDisconnect: (s: Calendar) => void;
  /** CAL-1: open Settings at a calendar link to replace it. */
  onReplaceLink?: (id: string) => void;
};

const when = (iso: string, tz: string): string => stampText(iso, tz);

export function StatusBar({ sources, devops, hours, loading, busy, notice, extra, clock, onRefresh, onConnect, onDisconnect, onReplaceLink }: Props) {
  const shape = { timeZone: userZone({ hours }) };
  const lines = causeLines(sources, devops);
  // Step 10: one quiet line when everything is live; it opens on a click and on its own when something needs attention.
  const [open, setOpen] = useState(false);
  const fine = !lines.length && sources.every((s) => stateOf(s).cls === "live") && (devops ?? []).every((c) => c.status === "ok");
  const oldest = sources.map((s) => s.fetchedAt).filter((x): x is string => !!x).sort()[0] ?? null;
  // U5.1: notices are chips inside the bar's one row, never lines under it.
  const chips = (
    <span className="status-chips">
      {extra}
      {notice && (
        <span className="status-chip notice" role="status" title={notice}>
          {notice}
        </span>
      )}
    </span>
  );
  const fixButton = (f: Fix, key: string) =>
    f.kind === "replace_link" ? (
      <button key={key} type="button" className="mini primary" onClick={() => onReplaceLink?.(f.id)}>
        Replace link
      </button>
    ) : f.kind === "retry" ? (
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
          {/* U3: all live is a green dot and Refresh; the time shows only beside a stale or failed source. */}
          <button type="button" className="status-quiet" onClick={() => setOpen(true)} aria-label="All sources live. Show each source's status" title={`All sources live${oldest ? `, oldest data ${updatedAgo(oldest, clock, shape.timeZone)}` : ""}. Click for each source's status`}>
            <span className="dot" aria-hidden="true" />
          </button>
          {chips}
          <button type="button" className="refresh mini quiet" onClick={onRefresh} disabled={loading} aria-label="Refresh all sources" title="Refresh all sources (R)">
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
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
          const detail = s.source === "dataverse" ? `${s.itemCount} ${s.itemCount === 1 ? "pattern" : "patterns"}` : s.source === "pto" ? `${s.itemCount} ${s.itemCount === 1 ? "day" : "days"}` : s.sample || notConnected(s) ? "" : `${s.itemCount} ${s.itemCount === 1 ? "event" : "events"}`;
          const actions = sourceActions(s);
          const cal = s.source === "outlook" || s.source === "google" ? s.source : null;
          return (
            <span key={sourceKey(s)} className={`source ${st.cls}`} title={s.message ?? (s.link ? `Calendar link: ${s.link.name} (${s.link.mode === "busy" ? "busy only" : "with titles"}, ${s.link.kind})` : "")}>
              <span className="dot" aria-hidden="true" style={s.link && st.cls === "live" ? { background: s.link.color } : undefined} />
              {sourceLabel(s)}
              {/* A2: "needs sign-in" is the link that signs in again, inside the one-line chip. */}
              {cal && st.cls === "signin" && actions.includes("reconnect") ? (
                <button type="button" className="state signin state-link" disabled={busy !== null} onClick={() => onConnect(cal)} title={s.message ?? "Sign in again"}>
                  {busy === cal ? "Waiting for sign-in…" : st.label}
                </button>
              ) : (
                <span className={`state ${st.cls}`}>{st.label}</span>
              )}
              {/* CAL-1: a calendar link reads "Family · live · 12 events · updated 6 min ago". */}
              {s.link && detail && <span className="muted">{detail}</span>}
              {s.fetchedAt && (st.cls !== "live" || s.source === "ics") && (
                <span className="muted" title={`${s.fromCache ? "Snapshot from" : "Fetched"} ${when(s.fetchedAt, shape.timeZone)}`}>
                  {updatedAgo(s.fetchedAt, clock, shape.timeZone)}
                </span>
              )}
              {!s.link && detail && <span className="muted">{detail}</span>}
              {s.link?.broken && onReplaceLink && (
                <button type="button" className="mini primary" onClick={() => onReplaceLink(s.link!.id)}>
                  Replace link
                </button>
              )}
              {cal && (actions.includes("connect") || (actions.includes("reconnect") && st.cls !== "signin")) && (
                <button type="button" className="mini primary" disabled={busy !== null} onClick={() => onConnect(cal)}>
                  {busy === cal ? "Waiting for sign-in…" : actions.includes("connect") ? "Connect" : "Reconnect"}
                </button>
              )}
              {cal && actions.includes("disconnect") && (
                <button type="button" className="mini quiet" disabled={busy !== null} onClick={() => onDisconnect(cal)} aria-label={`Disconnect ${sourceLabel(s)}`}>
                  Disconnect
                </button>
              )}
            </span>
          );
        })}
        <DevOpsEntry devops={devops} clock={clock} timeZone={shape.timeZone} />
        {chips}
        <span className="muted shape" title={`Working hours. Change them in Settings or a day's menu. Times in ${userZone({ hours })}`}>
          {hoursSummary(hours)}
        </span>
        <button type="button" className="refresh" onClick={onRefresh} disabled={loading} aria-label="Refresh all sources">
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>
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
