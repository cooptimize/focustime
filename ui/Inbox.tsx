// The Inbox (step 10, step 13.5): open follow-ups and unsorted captures in one list, overdue first, then due soon, then
// the rest newest first, with the capture box on top. Snoozed and closed follow-ups are behind "Show closed".
import { DraftsToAdd } from "./DevOpsWrite.tsx";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ModeArea } from "./ModeSwitch.tsx";
import type { CaptureState, FollowUpView, ReviewData, WeekLoadData } from "../actions/types.ts";
import { dueOrder } from "../plan/due.ts";
import type { Capture } from "../plan/types.ts";
import { call } from "./api.ts";
import { CaptureBox, captureClients, captureWhen, SortCapture } from "./Capture.tsx";
import type { CaptureClient } from "../plan/capture.ts";
import type { IsoDate } from "../week/types.ts";
import { Fading, FollowUpRow } from "./FollowUps.tsx";
import { EmptyState } from "./brand/Opening.tsx";
import { markSeen } from "./inboxcount.ts";
import { userZone } from "../week/zone.ts";

type Entry = { kind: "follow_up"; at: string; followUp: FollowUpView } | { kind: "capture"; at: string; capture: Capture };

/** Overdue follow-ups first, then due today and tomorrow, later due dates, then the rest newest first (plan/due.ts). */
export function inboxOrder(followUps: readonly FollowUpView[], captures: readonly Capture[], today: string): Entry[] {
  const all: Entry[] = [
    ...followUps.map((l): Entry => ({ kind: "follow_up", at: l.openedAt, followUp: l })),
    ...captures.map((c): Entry => ({ kind: "capture", at: c.createdAt, capture: c })),
  ];
  return dueOrder(all, today, (e) => (e.kind === "follow_up" ? e.followUp.due : null), (e) => e.at);
}

export function Inbox({ data, version, onChanged, defaultClient = null, highlight = null, switcher = null }: { switcher?: ReactNode; data: WeekLoadData; version: number; onChanged: () => void; defaultClient?: string | null; highlight?: number | null }) {
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
  const tz = userZone(data);
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
  // IB-1: the promises (former follow-ups) listed here are seen; a new one stops counting in Needs you.
  const changedRef = useRef(onChanged);
  changedRef.current = onChanged;
  useEffect(() => {
    if (followUps) void markSeen(followUps.map((f) => `f${f.id}`), () => changedRef.current());
  }, [followUps]);
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
    <main className="inbox" aria-label="Captures">
      <div className="follow-ups-head">
        <h2 ref={head} tabIndex={-1}>
          Captures <span className="muted">{followUps && caps ? (entries.length ? `${entries.length} open` : "All clear") : ""}</span>
        </h2>
        {switcher && <ModeArea>{switcher}</ModeArea>}
      </div>
      <section className="co-section inbox-capture" aria-label="Capture">
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
      {followUps && caps && !entries.length && (
        <EmptyState line="Nothing waiting. New captures and follow-ups show up here.">
          <button type="button" className="mini" onClick={() => document.querySelector<HTMLElement>(".inbox-capture input, .inbox-capture textarea")?.focus()}>Capture something</button>
        </EmptyState>
      )}
      <ul className="inbox-list">
        {entries.map((e) =>
          e.kind === "follow_up" ? (
            <FollowUpRow key={`l${e.followUp.id}`} l={e.followUp} timeZone={tz} today={today} clients={clients} onChanged={done} />
          ) : (
            <CaptureRow key={`c${e.capture.id}`} capture={e.capture} when={captureWhen(e.capture.createdAt, tz)} client={e.capture.clientKey ? name(e.capture.clientKey) ?? e.capture.clientKey : null} clients={clients} today={today} onDone={done} onError={setError} />
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

/** One capture not sorted yet (U5): its text, Sort (opens the kind chips and fields) and ⋯ with Dismiss. */
function CaptureRow({ capture, when, client, clients, today, onDone, onError }: { capture: Capture; when: string; client: string | null; clients: CaptureClient[]; today: IsoDate; onDone: (msg: string) => void; onError: (e: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const dismiss = async () => {
    setMenu(false);
    try {
      await call("capture.route", { id: capture.id, as: "dismissed" });
      onDone("Dismissed");
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not dismiss");
    }
  };
  return (
    <li className="cap-item" title={`Captured ${when}`}>
      <div className="cap-row">
        <p className="cap-text">
          <span className="cap-tag">To sort</span>
          {capture.text}
          {client && <span className="muted"> · {client}</span>}
        </p>
        {!open && (
          <span className="follow-up-actions">
            <button type="button" className="mini primary" onClick={() => setOpen(true)}>Sort</button>
            <span className="fu-more">
              <button type="button" className="mini quiet" aria-haspopup="menu" aria-expanded={menu} aria-label={`More for: ${capture.text}`} onClick={() => setMenu((v) => !v)}>⋯</button>
              {menu && (
                <span className="fu-menu" role="menu" onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), setMenu(false))}>
                  <button type="button" role="menuitem" autoFocus onClick={() => void dismiss()}>Dismiss</button>
                </span>
              )}
            </span>
          </span>
        )}
      </div>
      {open && <SortCapture capture={capture} clients={clients} today={today} onDone={onDone} onCancel={() => setOpen(false)} />}
    </li>
  );
}
