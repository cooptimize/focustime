// RS-2: the header's one word while the asked week or day is being read ("Loading…", for screen readers too), or the
// failed line with Retry. Nothing once it is on screen.
import { failedWords, type WeekRead } from "./weekread.ts";

export function ReadLine({ read, what, onRetry }: { read: WeekRead; what: "week" | "day"; onRetry: () => void }) {
  if (read === "loading") return <span className="read-line muted" role="status">Loading…</span>;
  if (read === "failed")
    return (
      <span className="read-line failed" role="alert">
        {failedWords(what)}{" "}
        <button type="button" className="mini" onClick={onRetry}>
          Retry
        </button>
      </span>
    );
  return null;
}
