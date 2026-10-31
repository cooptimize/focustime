import type { SourceSummary } from "../actions/types.ts";
import type { DayShape } from "../week/types.ts";
import { shortDate } from "./labels.ts";

type Props = {
  sources: SourceSummary[];
  sampleWeek: string;
  isSampleWeek: boolean;
  shape: DayShape;
  loading: boolean;
  onRefresh: () => void;
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
  if (s.fromCache) return { cls: "cached", label: "cached" };
  return { cls: "error", label: s.status.replace("_", " ") };
}

export function StatusBar({ sources, sampleWeek, isSampleWeek, shape, loading, onRefresh }: Props) {
  const dv = sources.find((s) => s.source === "dataverse");
  const samples = sources.filter((s) => s.sample);
  return (
    <footer className="statusbar" aria-label="Source status">
      {sources.map((s) => {
        const st = stateOf(s);
        const detail =
          s.source === "dataverse"
            ? `${s.itemCount} ${s.itemCount === 1 ? "pattern" : "patterns"}`
            : "";
        return (
          <span key={s.source} className={`source ${st.cls}`} title={s.message ?? ""}>
            <span className="dot" aria-hidden="true" />
            {names[s.source]}
            <span className={`state ${st.cls}`}>{st.label}</span>
            {s.fetchedAt && <span className="muted">{s.fromCache ? "from" : "fetched"} {when(s.fetchedAt, shape.timeZone)}</span>}
            {detail && <span className="muted">{detail}</span>}
          </span>
        );
      })}
      {dv?.message && <span className={`dv-message ${dv.status === "ok" ? "" : "problem"}`}>{dv.message}</span>}
      {samples.length > 0 && (
        <span className="sample-note">
          <span className="sample-pill">Sample meetings</span>
          <span className="muted">
            Outlook and Google are not connected yet{isSampleWeek ? "" : `; sample meetings exist only for the week of ${shortDate(sampleWeek)}`}
          </span>
        </span>
      )}
      <span className="muted shape">
        {shape.start} · split {shape.split} · usual end {shape.end} · {shape.timeZone}
      </span>
      <button type="button" className="refresh" onClick={onRefresh} disabled={loading} aria-label="Refresh Dataverse">
        {loading ? "Loading…" : "Refresh"}
      </button>
    </footer>
  );
}
