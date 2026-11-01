// The Inbox (step 10): open loops and unsorted captures in one list, with the capture box on top and notes folded
// below. It replaces the separate Loops and Capture views; every action they had is here.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CaptureState, LoopView, WeekLoadData } from "../actions/types.ts";
import { urgentLoops } from "../plan/today.ts";
import type { Capture } from "../plan/types.ts";
import { call } from "./api.ts";
import { CaptureBox, captureClients, captureWhen, NotesSection, SortCapture } from "./Capture.tsx";
import { AddLoop, LoopRow } from "./Loops.tsx";

type Entry = { kind: "loop"; at: string; loop: LoopView } | { kind: "capture"; at: string; capture: Capture };

/** Overdue and due-today loops first, then everything newest first. */
export function inboxOrder(loops: readonly LoopView[], captures: readonly Capture[], today: string): Entry[] {
  const urgent = urgentLoops(loops, today);
  const rest: Entry[] = [
    ...loops.filter((l) => !urgent.includes(l)).map((l): Entry => ({ kind: "loop", at: l.openedAt, loop: l })),
    ...captures.map((c): Entry => ({ kind: "capture", at: c.createdAt, capture: c })),
  ].sort((a, b) => Temporal.Instant.compare(instant(b.at), instant(a.at)));
  return [...urgent.map((l): Entry => ({ kind: "loop", at: l.openedAt, loop: l })), ...rest];
}
const instant = (z: string) => Temporal.Instant.from(z.replace(/\[.*\]$/, ""));

export function Inbox({ data, version, onClose, onChanged }: { data: WeekLoadData; version: number; onClose: () => void; onChanged: () => void }) {
  const clients = useMemo(() => captureClients(data), [data]);
  const [loops, setLoops] = useState<LoopView[] | null>(null);
  const [caps, setCaps] = useState<CaptureState | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const [closed, setClosed] = useState<LoopView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const head = useRef<HTMLHeadingElement>(null);
  const tz = data.hours.timeZone;

  const load = useCallback(async () => {
    try {
      const [l, c] = await Promise.all([call<{ loops: LoopView[] }>("loops.list", { includeClosed: showClosed }), call<CaptureState>("capture.load", {})]);
      setLoops(l.loops.filter((x) => !x.closedAt));
      setClosed(l.loops.filter((x) => x.closedAt));
      setCaps(c);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the inbox");
    }
  }, [showClosed]);
  useEffect(() => void load(), [load, version]);
  useEffect(() => head.current?.focus(), []);
  const changed = useCallback(() => {
    void load();
    onChanged();
  }, [load, onChanged]);
  const close = async (id: number, note: string | null) => {
    try {
      await call("loop.close", { id, note });
      changed();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not close it");
      return false;
    }
  };

  const today = caps?.today ?? data.planDay.date;
  const entries = loops && caps ? inboxOrder(loops, caps.inbox, today) : [];
  const name = (k: string | null) => (k ? (clients.find((c) => c.clientKey === k)?.clientName ?? k) : null);

  return (
    <main className="inbox" aria-label="Inbox">
      <div className="loops-head">
        <h2 ref={head} tabIndex={-1}>
          Inbox <span className="muted">{loops && caps ? (entries.length ? `${entries.length} open` : "All clear") : ""}</span>
        </h2>
        <button type="button" className="top-btn" onClick={onClose} title="Back (Esc)">
          Back
        </button>
      </div>
      <p className="muted loops-note">What you owe people (loops) and what you captured but haven't sorted. Nothing is posted anywhere.</p>
      <section className="co-section">
        <CaptureBox data={data} onChanged={changed} />
      </section>
      {error && <p className="set-problem" role="alert">{error}</p>}
      {notice && <p className="co-notice" role="status">{notice}</p>}
      {loops && caps && !entries.length && <p className="loops-empty">Nothing waiting. New captures and loops show up here.</p>}
      <ul className="inbox-list">
        {entries.map((e) =>
          e.kind === "loop" ? (
            <LoopRow key={`l${e.loop.id}`} l={e.loop} timeZone={tz} onClosed={(n) => close(e.loop.id, n)} />
          ) : (
            <li key={`c${e.capture.id}`} className="cap-item">
              <p className="cap-text">
                <span className="cap-tag">To sort</span>
                {e.capture.text}
                <span className="muted">
                  {" "}
                  · {captureWhen(e.capture.createdAt, tz)}
                  {e.capture.clientKey ? ` · ${name(e.capture.clientKey)}` : ""}
                </span>
              </p>
              <SortCapture capture={e.capture} clients={clients} today={today} onDone={(m) => { setNotice(m); changed(); }} />
            </li>
          ),
        )}
      </ul>
      <div className="inbox-tools">
        <AddLoop onAdded={changed} />
        <label className="set-check">
          <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> Show closed loops
        </label>
      </div>
      {showClosed && closed.length > 0 && (
        <section className="co-section" aria-label="Closed loops">
          <h3>Closed</h3>
          <ul className="loop-list">
            {closed.map((l) => (
              <LoopRow key={l.id} l={l} timeZone={tz} onClosed={(n) => close(l.id, n)} />
            ))}
          </ul>
        </section>
      )}
      <details className="co-section inbox-notes">
        <summary>
          <h3>Notes</h3> <span className="muted">per client, searchable</span>
        </summary>
        <NotesSection data={data} version={version} />
      </details>
    </main>
  );
}
