import type { SourceSummary } from "../actions/types.ts";
import type { DayShape } from "../week/types.ts";
import { shortDate } from "./labels.ts";
import { updatedAgo } from "./refresh.ts";

type Calendar = "outlook" | "google";
type Props = {
  sources: SourceSummary[];
  sampleWeek: string;
  isSampleWeek: boolean;
  shape: DayShape;
  loading: boolean;
  busy: Calendar | null;
  notice: string | null;
  /** Wall clock, ticking every 30 s, for "updated N min ago". */
  clock: number;
  onRefresh: () => void;
  onConnect: (s: Calendar) => void;
  onDisconnect: (s: Calendar) => void;
};

const names = { dataverse: "Dataverse", outlook: "Outlook", google: "Google" } as const;

function when(iso: string, tz: string): string {
  const z = Temporal.Instant.from(iso).toZonedDateTimeISO(tz);
  const today = Temporal.Now.plainDateISO(tz);
  const t = `${z.hour % 12 || 12}:${String(z.minute).padStart(2, "0")} ${z.hour < 12 ? "AM" : "PM"}`;
  return z.toPlainDate().equals(today) ? t : `${shortDate(z.toPlainDate().toString())} ${t}`;
}

function stateOf(s: SourceSummary): { cls: string; label: string } {
  if (s.sample) return { cls: "sample", label: "sample" };
  if (s.status === "ok") return { cls: "live", label: "live" };
  if (s.status === "auth_required") return { cls: "signin", label: "needs sign-in" };
  if (s.fromCache) return { cls: "cached", label: "cached" };
  return { cls: "error", label: s.status.replace("_", " ") };
}

export function StatusBar({ sources, sampleWeek, isSampleWeek, shape, loading, busy, notice, clock, onRefresh, onConnect, onDisconnect }: Props) {
  const samples = sources.filter((s) => s.sample);
  const notConnected = (s: SourceSummary) => s.status === "auth_required" && !s.fromCache && !!s.message?.includes("not connected");
  const problems = sources.filter((s) => s.message && !s.sample && s.status !== "ok" && !notConnected(s));
  return (
    <footer className="statusbar" aria-label="Source status">
      {sources.map((s) => {
        const st = stateOf(s);
        const cal = s.source === "outlook" || s.source === "google" ? (s.source as Calendar) : null;
        const detail = s.source === "dataverse" ? `${s.itemCount} ${s.itemCount === 1 ? "pattern" : "patterns"}` : s.sample || notConnected(s) ? "" : `${s.itemCount} events`;
        const canConnect = cal && (s.fixAction === "connect_microsoft" || s.fixAction === "connect_google");
        const connected = cal && !s.sample && !canConnect && (s.status === "ok" || s.fromCache);
        return (
          <span key={s.source} className={`source ${st.cls}`} title={s.message ?? ""}>
            <span className="dot" aria-hidden="true" />
            {names[s.source]}
            <span className={`state ${st.cls}`}>{st.label}</span>
            {s.fetchedAt && (
              <span className="muted" title={`${s.fromCache ? "Snapshot from" : "Fetched"} ${when(s.fetchedAt, shape.timeZone)}`}>
                {updatedAgo(s.fetchedAt, clock, shape.timeZone)}
              </span>
            )}
            {detail && <span className="muted">{detail}</span>}
            {canConnect && (
              <button type="button" className="mini primary" disabled={busy !== null} onClick={() => onConnect(cal)}>
                {busy === cal ? "Waiting for sign-in…" : notConnected(s) ? "Connect" : "Reconnect"}
              </button>
            )}
            {connected && (
              <button type="button" className="mini quiet" disabled={busy !== null} onClick={() => onDisconnect(cal)} aria-label={`Disconnect ${names[s.source]}`}>
                Disconnect
              </button>
            )}
          </span>
        );
      })}
      {notice && <span className="dv-message">{notice}</span>}
      {!notice && problems.map((s) => (
        <span key={s.source} className="dv-message problem">{s.message}</span>
      ))}
      {samples.length > 0 && (
        <span className="sample-note">
          <span className="sample-pill">Sample meetings</span>
          <span className="muted">
            {samples.map((s) => names[s.source]).join(" and ")} not set up yet{isSampleWeek ? "" : `; sample meetings exist only for the week of ${shortDate(sampleWeek)}`}
          </span>
        </span>
      )}
      <span className="muted shape">
        {shape.start} · split {shape.split} · usual end {shape.end} · {shape.timeZone}
      </span>
      <button type="button" className="refresh" onClick={onRefresh} disabled={loading} aria-label="Refresh all sources">
        {loading ? "Loading…" : "Refresh"}
      </button>
    </footer>
  );
}
