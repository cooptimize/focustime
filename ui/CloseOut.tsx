// Day's Close out (U2; its own file since WD-2, unchanged in what it does): a side panel over the dimmed day (the
// numbers, where you left off, DevOps updates owed, promises due, then Done), and behind it the day's blocks as
// close-out cards (what isn't done, with "→ <day>", and done, dropped and moved as counts).
import { DueBadge, FollowUpRow } from "./FollowUps.tsx";
import { useContext, useEffect, useRef, useState, type CSSProperties } from "react";
import type { CloseOutState, DoneOffer, WeekLoadData } from "../actions/types.ts";
import { PickRow } from "./PickRow.tsx";
import type { Pick } from "../plan/types.ts";
import type { IsoDate, Slot } from "../week/types.ts";
import { clientColor, halfName } from "./labels.ts";
import { PlanCtx } from "./planview.ts";
import { dayFocus } from "../plan/focus.ts";
import { formatDuration } from "../week/format.ts";
import { call } from "./api.ts";
import { captureClients } from "./Capture.tsx";
import { DevOpsAction, useDevOpsWrite } from "./DevOpsWrite.tsx";
import { DoneBatch } from "./DoneOffer.tsx";
import { ProgressOfferCard, TimeboxCheckin } from "./TimeboxCheckin.tsx";
import { DevOpsWork } from "./work.ts";
import { dayName } from "./PickReview.tsx";
import { userZone } from "../week/zone.ts";
import { MenuCtx } from "./Menus.tsx";
import { WorkLink } from "./WorkLink.tsx";
import { Icon } from "./icons.tsx";

const clock = (iso: string, tz: string) => {
  const z = Temporal.Instant.from(iso).toZonedDateTimeISO(tz);
  return `${z.hour % 12 || 12}:${String(z.minute).padStart(2, "0")} ${z.hour < 12 ? "AM" : "PM"}`;
};


/** One block behind the Close out panel: what isn't done with its carry chip; done, dropped and moved as counts. */
export function CloseOutBlock({ slot, data, picks, tickable, ended, carryTo, nameOf, act }: { slot: Slot; data: WeekLoadData; picks: Pick[]; tickable: boolean; ended: boolean; carryTo: IsoDate | null; nameOf: (k: string) => string; act: (a: string, i: Record<string, unknown>) => Promise<boolean> }) {
  const view = useContext(PlanCtx);
  const client = slot.focus[0]?.clientKey ?? null;
  const planned = picks.filter((p) => p.status === "planned");
  const done = picks.filter((p) => p.status === "done");
  const dropped = picks.filter((p) => p.status === "dropped");
  const moved = picks.filter((p) => p.status === "moved");
  const title = client ? nameOf(client) : slot.open ? "Open" : halfName(slot.half);
  const followUp = (p: Pick) => (p.followUpId !== null ? data.followUps.find((f) => f.id === p.followUpId) ?? null : null);
  const counts = [`${done.length} done`, ...(dropped.length ? [`${dropped.length} dropped`] : []), ...(moved.length ? [`${moved.length} moved`] : [])].join(" · ");
  const carry = carryTo ? Temporal.PlainDate.from(carryTo).toLocaleString("en-US", { weekday: "short" }) : null;
  return (
    <article className={`today-block${ended ? " ended" : ""} co`} style={{ "--c": clientColor(client ?? undefined, data.clients) } as CSSProperties} aria-label={title}>
      <header>
        <h2>{title}</h2>
        <span className="tb-when">{halfName(slot.half)}</span>
        <span className="tb-count">{counts}</span>
      </header>
      <ul className="today-picks">
        {planned.map((p) => (
          <PickRow
            key={p.id}
            pick={p}
            toggle={view.toggle}
            link
            density="today"
            canTick={tickable}
            timeEditable={!ended}
            badge={followUp(p) ? <DueBadge l={followUp(p)!} /> : undefined}
            actions={carry ? (
              <button type="button" className="carry-chip" onClick={() => void act("pick.move", { id: p.id, date: carryTo!, half: p.half === "EVE" ? "AM" : p.half })} title={`Carry over to ${dayName(carryTo!)} now`}>
                → {carry}
              </button>
            ) : undefined}
          />
        ))}
      </ul>
    </article>
  );
}

/**
 * Close out as a side panel (U2): the numbers, where you left off, DevOps updates owed and follow-ups due, then Done.
 * Done closes the day exactly as before (closeout.commit), then the reverse unroll. Dropped picks are a count only.
 */
export function CloseOutPanel({ date, st, data, nameOf, reload, onChanged, onError, onDate, onLeave, onClosedOut, onInbox, onCaptures, act, onShown }: {
  date: IsoDate;
  st: CloseOutState | null;
  data: WeekLoadData;
  nameOf: (k: string) => string;
  reload: () => Promise<void>;
  onChanged: () => void;
  onError: (m: string) => void;
  onDate: (d: IsoDate) => void;
  onLeave: (m?: string) => void;
  onClosedOut: (st: CloseOutState) => void;
  onInbox: () => void;
  onCaptures: () => void;
  act: (a: string, i: Record<string, unknown>) => Promise<boolean>;
  /** A past day: the cards behind show today, so the panel lists that day's open picks itself. */
  onShown: boolean;
}) {
  const head = useRef<HTMLHeadingElement>(null);
  const [extra, setExtra] = useState<string[]>([]);
  /** TX-1: bumped by a check-in answer, so the end of day DevOps offer reads again. */
  const [progressAt, setProgressAt] = useState(0);
  const { open: openMenu } = useContext(MenuCtx);
  const work = useContext(DevOpsWork);
  const devopsWrite = useDevOpsWrite();
  // PK-1: the day's done to-dos whose items could be set done in DevOps (one ask, one Confirm). Null while loading or
  // when "never ask" is set (then the per-item Mark done in DevOps rows stay, as before).
  const [doneOffers, setDoneOffers] = useState<DoneOffer[] | null>(null);
  const doneKey = st ? st.picks.filter((p) => p.status === "done" && p.itemId !== null && devopsWrite?.can(p.clientKey)).map((p) => p.id).slice(0, 30).join(",") : "";
  useEffect(() => {
    if (!doneKey) return void setDoneOffers([]);
    let live = true;
    call<{ offers: DoneOffer[]; off: boolean }>("devops.done_offer", { pickIds: doneKey.split(",").map(Number) })
      .then((r) => live && setDoneOffers(r.off ? null : r.offers))
      .catch(() => live && setDoneOffers(null));
    return () => void (live = false);
  }, [doneKey, devopsWrite?.version]);
  useEffect(() => setExtra([]), [date]);
  useEffect(() => head.current?.focus(), [date]);
  const tz = userZone(data);
  const prev = Temporal.PlainDate.from(date).subtract({ days: 1 }).toString();
  const next = Temporal.PlainDate.from(date).add({ days: 1 }).toString();
  const done = async () => {
    if (!st) return;
    // Step 15.1 (D275): once closed out, Done just goes back; nothing is saved again.
    if (st.closedOutAt) return onLeave();
    try {
      const after = await call<CloseOutState>("closeout.commit", { date });
      onClosedOut(after);
      onChanged();
      onLeave("Closed out. Nice work.");
    } catch (e) {
      onError(e instanceof Error ? e.message : "Couldn't save Close out");
    }
  };
  const body = () => {
    if (!st) return <p className="muted">Loading…</p>;
    const totals = dayFocus(st.picks, st.focused, data.planning.sizes);
    const n = (s: string) => st.picks.filter((p) => p.status === s).length;
    const day = data.week.days.find((d) => d.date === date);
    const blockClients = day ? [...day.am.focus, ...day.pm.focus].map((b) => b.clientKey) : [];
    const worked = [...new Set([...st.worked.map((w) => w.clientKey), ...blockClients, ...Object.keys(st.notes), ...extra])];
    const others = data.planClients.filter((c) => !worked.includes(c.clientKey));
    const stillOpen = (clientKey: string, id: number) => !!work.get(clientKey)?.items.some((i) => i.id === id);
    const followUpFor = (id: number) => st.followUps.find((f) => f.kind === "devops_update" && f.itemId === id && !f.closedAt)?.id ?? null;
    // PK-1: with the offer on, the batch below asks for these; "never ask" keeps the rows of Mark done in DevOps.
    const owedDone = doneOffers === null ? st.picks.filter((p) => p.status === "done" && p.itemId !== null && stillOpen(p.clientKey, p.itemId)) : [];
    const batch = doneOffers ?? [];
    const owedComment = st.picks.filter((p) => p.status === "planned" && p.itemId !== null && (st.focused[p.id] ?? 0) >= 60);
    const dueBy = st.followUps.filter((l) => l.due !== null && l.due <= date);
    const more = st.followUps.length - dueBy.length;
    const clients = captureClients(data);
    const rowDone = () => {
      void reload();
      onChanged();
    };
    return (
      <>
        <p className="cp-numbers">
          <span><strong>{n("done")}</strong> done</span>
          <span><strong>{n("planned")}</strong> carry over</span>
          <span><strong>{n("dropped")}</strong> dropped</span>
          <span><strong>{formatDuration(totals.focusedMinutes) || "0m"}</strong> focused</span>
        </p>
        {st.closedOutAt && <p className="co-done">Closed out {clock(st.closedOutAt, tz)}</p>}
        <TimeboxCheckin date={date} moment="end" color={(k) => clientColor(k, data.clients)} onChanged={() => { setProgressAt((n) => n + 1); rowDone(); }} onError={onError} />
        <ProgressOfferCard date={date} version={progressAt} onDone={rowDone} />
        {onShown && st.picks.some((p) => p.status === "planned") && (
          <section className="cp-section" aria-label="Not done">
            <h3>Not done</h3>
            <ul className="today-picks">
              {st.picks.filter((p) => p.status === "planned").map((p) => (
                <PickRow key={p.id} pick={p} toggle={(id, d) => void act("pick.mark_done", { id, done: d }).then(() => reload())} density="today" timeEditable={false} readOnly actions={st.carryTo ? <button type="button" className="carry-chip" onClick={() => void act("pick.move", { id: p.id, date: st.carryTo!, half: p.half === "EVE" ? "AM" : p.half }).then(() => reload())}>→ {Temporal.PlainDate.from(st.carryTo).toLocaleString("en-US", { weekday: "short" })}</button> : undefined} />
              ))}
            </ul>
          </section>
        )}
        <section className="cp-section" aria-label="Where you left off">
          <h3>Where you left off</h3>
          <ul className="cp-notes">
            {worked.map((k) => (
              <NoteRow key={`${date}:${k}`} clientKey={k} clientName={nameOf(k)} color={clientColor(k, data.clients)} date={date} saved={st.notes[k]?.note ?? ""} previous={st.previous[k]?.note ?? null} onSaved={() => void reload()} onError={onError} />
            ))}
          </ul>
          {others.length > 0 &&
            (
              // The app's own menu (no browser select): another client to leave a note for.
              <button
                type="button"
                className="link-btn"
                aria-haspopup="menu"
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  openMenu({ x: r.left, y: r.bottom + 4 }, { title: "Another client", items: others.map((c) => ({ id: c.clientKey, label: nameOf(c.clientKey), run: () => setExtra((x) => [...x, c.clientKey]) })) });
                }}
              >
                Add another client
              </button>
            )}
        </section>
        {(owedDone.length > 0 || owedComment.length > 0 || batch.length > 0) && (
          <section className="cp-section" aria-label="DevOps updates owed">
            <h3>DevOps updates owed</h3>
            {batch.length > 0 && <DoneBatch offers={batch} dayWords={date === st.today ? "today" : `on ${Temporal.PlainDate.from(date).toLocaleString("en-US", { weekday: "long" })}`} onDone={rowDone} />}
            <ul className="cp-owed">
              {owedDone.map((p) => (
                <li key={p.id}>
                  <span className="cp-owed-what">
                    <WorkLink clientKey={p.clientKey} url={p.itemUrl} className="co-title">#{p.itemId} {p.title}</WorkLink> <span className="muted">done here, still open in DevOps</span>
                  </span>
                  <DevOpsAction clientKey={p.clientKey} label="Mark done in DevOps" onRun={(w) => w.markDone({ clientKey: p.clientKey, itemId: p.itemId!, title: p.title, ...(followUpFor(p.itemId!) ? { followUpId: followUpFor(p.itemId!)! } : {}) })} />
                </li>
              ))}
              {owedComment.map((p) => (
                <li key={p.id}>
                  <span className="cp-owed-what">
                    <WorkLink clientKey={p.clientKey} url={p.itemUrl} className="co-title">#{p.itemId} {p.title}</WorkLink> <span className="muted">{formatDuration(Math.floor((st.focused[p.id] ?? 0) / 60))} focused, not done</span>
                  </span>
                  <CommentOwed clientKey={p.clientKey} itemId={p.itemId!} />
                </li>
              ))}
            </ul>
          </section>
        )}
        {dueBy.length > 0 && (
          <section className="cp-section" aria-label="Promises due">
            <h3>Promises due</h3>
            <ul className="follow-up-list compact">
              {dueBy.map((l) => (
                <FollowUpRow key={l.id} l={l} timeZone={tz} today={st.today} clients={clients} onChanged={rowDone} compact />
              ))}
            </ul>
          </section>
        )}
        {(more > 0 || st.captures > 0) && (
          <p className="cp-more">
            {more > 0 && (
              <button type="button" className="link-btn" onClick={onInbox}>
                {more} more in Inbox
              </button>
            )}
            {more > 0 && st.captures > 0 && " · "}
            {st.captures > 0 && (
              <button type="button" className="link-btn" onClick={onCaptures}>
                {st.captures} {st.captures === 1 ? "capture" : "captures"} to sort
              </button>
            )}
          </p>
        )}
      </>
    );
  };
  return (
    <aside className="closeout-panel" aria-label="Close out">
      <div className="cp-head">
        <h2 ref={head} tabIndex={-1}>
          Close out <span className="muted">{date === st?.today ? Temporal.PlainDate.from(date).toLocaleString("en-US", { weekday: "long" }) : dayName(date)}</span>
        </h2>
        <span className="co-step">
          <button type="button" className="mini quiet icon-btn small" onClick={() => onDate(prev)} aria-label="Previous day" title="Previous day"><Icon name="back" /></button>
          <button type="button" className="mini quiet icon-btn small" onClick={() => onDate(next)} disabled={!st || next > st.today} aria-label="Next day" title="Next day"><Icon name="next" /></button>
        </span>
        <button type="button" className="done-btn" disabled={!st} onClick={() => void done()} title={st?.closedOutAt ? "Back to Day (Esc)" : "Close out this day, then back to Day"}>
          Done
        </button>
      </div>
      <div className="cp-body">{body()}</div>
      <p className="cp-foot muted">Done closes the day and plays the week back into the ring.</p>
    </aside>
  );
}

function NoteRow({ clientKey, clientName, color, date, saved, previous, onSaved, onError }: { clientKey: string; clientName: string; color: string; date: IsoDate; saved: string; previous: string | null; onSaved: () => void; onError: (m: string) => void }) {
  const [v, setV] = useState(saved);
  useEffect(() => setV(saved), [saved]);
  const save = async () => {
    if (v.trim() === saved) return;
    try {
      await call("note.set", { clientKey, date, note: v });
      onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not save the note");
    }
  };
  return (
    <li className="co-note" style={{ "--c": color } as CSSProperties}>
      <label>
        <span className="co-client">
          <span className="swatch" aria-hidden="true" />
          {clientName}
        </span>
        <input value={v} maxLength={200} placeholder={previous ? `Last: ${previous}` : `Next step for ${clientName}…`} onChange={(e) => setV(e.target.value)} onBlur={() => void save()} onKeyDown={(e) => e.key === "Enter" && void save()} />
      </label>
    </li>
  );
}

/** "Comment" on an item focused on but not done: one line, then the DevOps write preview (write framework). */
function CommentOwed({ clientKey, itemId }: { clientKey: string; itemId: number }) {
  const env = useDevOpsWrite();
  const [text, setText] = useState<string | null>(null);
  if (!env) return null;
  if (!env.can(clientKey)) return <DevOpsAction clientKey={clientKey} label="Comment" onRun={() => {}} />;
  if (text === null)
    return (
      <button type="button" className="mini" onClick={() => setText("Worked on this today; not done yet.")}>
        Comment
      </button>
    );
  return (
    <form
      className="cp-comment"
      onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim()) return;
        void env.begin(clientKey, [{ kind: "comment", itemId, text: text.trim() }]).then(() => setText(null));
      }}
    >
      <input autoFocus value={text} maxLength={500} onChange={(e) => setText(e.target.value)} aria-label={`Comment on #${itemId}`} />
      <button type="submit" className="mini primary">Preview</button>
      <button type="button" className="mini" onClick={() => setText(null)}>Cancel</button>
    </form>
  );
}

