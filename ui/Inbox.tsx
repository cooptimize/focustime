// The Inbox (step 10, step 13.5): open follow-ups and unsorted captures in one list, overdue first, then due soon, then
// the rest newest first, with the capture box on top. Snoozed and closed follow-ups are behind "Show closed".
import { DraftsToAdd } from "./DevOpsWrite.tsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CaptureState, FollowUpView, ReviewData, WeekLoadData } from "../actions/types.ts";
import { dueOrder } from "../plan/due.ts";
import type { Capture } from "../plan/types.ts";
import { call } from "./api.ts";
import { CaptureBox, captureClients, captureWhen, SortCapture } from "./Capture.tsx";
import { Fading, FollowUpRow } from "./FollowUps.tsx";

type Entry = { kind: "follow_up"; at: string; followUp: FollowUpView } | { kind: "capture"; at: string; capture: Capture };

/** Overdue follow-ups first, then due today and tomorrow, later due dates, then the rest newest first (plan/due.ts). */
export function inboxOrder(followUps: readonly FollowUpView[], captures: readonly Capture[], today: string): Entry[] {
  const all: Entry[] = [
    ...followUps.map((l): Entry => ({ kind: "follow_up", at: l.openedAt, followUp: l })),
    ...captures.map((c): Entry => ({ kind: "capture", at: c.createdAt, capture: c })),
  ];
  return dueOrder(all, today, (e) => (e.kind === "follow_up" ? e.followUp.due : null), (e) => e.at);
}

export function Inbox({ data, version, onClose, onChanged, defaultClient = null, highlight = null }: { data: WeekLoadData; version: number; onClose: () => void; onChanged: () => void; defaultClient?: string | null; highlight?: number | null }) {
  const clients = useMemo(() => captureClients(data), [data]);
  const [followUps, setFollowUps] = useState<FollowUpView[] | null>(null);
  const [caps, setCaps] = useState<CaptureState | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const [closed, setClosed] = useState<FollowUpView[]>([]);
  const [snoozed, setSnoozed] = useState(0);
  const [review, setReview] = useState<ReviewData["headsUps"]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const head = useRef<HTMLHeadingElement>(null);
  const tz = data.hours.timeZone;
  // Step 15.5: a follow-up's notification opens it here: scrolled to and outlined.
  const scrolledTo = useRef<number | null>(null);
  useEffect(() => {
    for (const x of document.querySelectorAll(".followup-highlight")) if (x.getAttribute("data-follow-up") !== String(highlight)) x.classList.remove("followup-highlight");
    if (highlight === null || !followUps) return;
    const el = document.querySelector<HTMLElement>(`.inbox [data-follow-up="${highlight}"]`);
    if (!el) return;
    el.classList.add("followup-highlight");
    if (scrolledTo.current !== highlight) el.scrollIntoView({ block: "center" });
    scrolledTo.current = highlight;
  });

  const load = useCallback(async () => {
    try {
      const [l, c] = await Promise.all([call<{ followUps: FollowUpView[]; snoozed: number }>("followups.list", { includeClosed: showClosed, includeSnoozed: showClosed }), call<CaptureState>("capture.load", {})]);
      const today = c.today;
      const asleep = (x: FollowUpView) => !!x.snoozedUntil && x.snoozedUntil > today;
      setFollowUps(l.followUps.filter((x) => !x.closedAt && !asleep(x)));
      setClosed(l.followUps.filter((x) => x.closedAt || asleep(x)));
      setSnoozed(l.snoozed);
      // Step 13.5: open heads-ups the new rule wouldn't open. Listed for me to decide; never closed for me.
      setReview(await call<ReviewData>("followups.review", {}).then((r) => r.headsUps, () => []));
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
  const clearNotice = useCallback(() => setNotice(null), []);
  const done = (m?: string) => {
    if (m) setNotice(m);
    changed();
  };

  const today = caps?.today ?? data.planDay.date;
  const entries = followUps && caps ? inboxOrder(followUps, caps.inbox, today) : [];
  const name = (k: string | null) => (k ? (clients.find((c) => c.clientKey === k)?.clientName ?? k) : null);

  return (
    <main className="inbox" aria-label="Inbox">
      <div className="follow-ups-head">
        <h2 ref={head} tabIndex={-1}>
          Inbox <span className="muted">{followUps && caps ? (entries.length ? `${entries.length} open` : "All clear") : ""}</span>
        </h2>
        <button type="button" className="top-btn" onClick={onClose} title="Back (Esc)">
          Back
        </button>
      </div>
      <section className="co-section inbox-capture" aria-label="Capture">
        <p className="inbox-explainer">Capture anything. Sort it now or later: follow-ups are what you owe people; drafts become DevOps items.</p>
        <CaptureBox data={data} onChanged={changed} defaultClient={defaultClient} large />
      </section>
      {error && <p className="set-problem" role="alert">{error}</p>}
      <Fading text={notice} onGone={clearNotice} />
      {review.length > 0 && (
        <section className="fu-review" aria-label="Heads-ups to review">
          <h3>Heads-ups to review</h3>
          <p className="muted">These were opened before the new heads-up rule and wouldn't open now. Close the loop or choose Not needed; nothing is closed for you.</p>
          <ul>
            {review.map((r) => (
              <li key={r.id}>
                <strong>{r.what}</strong> <span className="muted">· {r.reason}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {followUps && caps && !entries.length && <p className="follow-ups-empty">Nothing waiting. New captures and follow-ups show up here.</p>}
      <ul className="inbox-list">
        {entries.map((e) =>
          e.kind === "follow_up" ? (
            <FollowUpRow key={`l${e.followUp.id}`} l={e.followUp} timeZone={tz} today={today} clients={clients} onChanged={done} />
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
              <SortCapture capture={e.capture} clients={clients} today={today} onDone={done} />
            </li>
          ),
        )}
      </ul>
      {caps && <DraftsToAdd drafts={caps.drafts} clientName={(k) => name(k) ?? k} onChanged={() => void load()} />}
      <div className="inbox-tools">
        <label className="set-check">
          <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> Show closed{snoozed && !showClosed ? ` and ${snoozed} snoozed` : ""}
        </label>
      </div>
      {showClosed && closed.length > 0 && (
        <section className="co-section" aria-label="Closed and snoozed follow-ups">
          <h3>Closed and snoozed</h3>
          <ul className="follow-up-list">
            {closed.map((l) => (
              <FollowUpRow key={l.id} l={l} timeZone={tz} today={today} clients={clients} onChanged={done} />
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
