// KB-1: "Standards used: <titles> (commit abc1234)" under an AI draft, each title opening the article at the synced
// commit, then where the draft followed the client instead and what FocusTime reworded. Nothing when none were used.
import type { StandardsUsed } from "../plan/standards.ts";
import { shortCommit } from "../plan/standards.ts";

export function StandardsNote({ s }: { s: StandardsUsed | null | undefined }) {
  if (!s || !s.used.length) return null;
  return (
    <div className="standards-used">
      Standards used:{" "}
      {s.used.map((u, i) => (
        <span key={u.url}>
          {i > 0 && ", "}
          <a href={u.url} target="_blank" rel="noreferrer">{u.title}</a>
        </span>
      ))}{" "}
      (commit {shortCommit(s.commit)})
      {s.overrides.map((o) => <p key={o}>{o}</p>)}
      {s.notes.map((n) => <p key={n}>{n}</p>)}
      {s.leftOut.length > 0 && <p>Left out for size: {s.leftOut.join(", ")}</p>}
    </div>
  );
}
