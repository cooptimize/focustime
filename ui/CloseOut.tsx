import type React from "react";
// Close out (step 7): the end of the day in about three minutes. Picks done or not (focused time against size, and
// what to do with the rest), a one-line resume note per client worked, and the follow-ups to close. Commit at the end.
// Any earlier day can be closed out later; nothing here blocks anything else. Local only.
import { DevOpsAction } from "./DevOpsWrite.tsx";
import { DevOpsWork } from "./work.ts";
import { useContext, useCallback, useEffect, useRef, useState } from "react";
import type { CloseOutState, WeekLoadData } from "../actions/types.ts";
import { dayFocus } from "../plan/focus.ts";
import type { Pick } from "../plan/types.ts";
import type { Half, IsoDate } from "../week/types.ts";
import { formatDuration } from "../week/format.ts";
import { call, planAction } from "./api.ts";
import { captureClients } from "./Capture.tsx";
import { AddFollowUp, Fading, FollowUpRow } from "./FollowUps.tsx";
import { dayName, FlexOfferBar, FocusVsSize, HALF_NAMES, SlipActions, type FlexOffer, type MakeUpResult } from "./PickReview.tsx";

type Props = { /** Step 15 (D268): the ritual chips, in this view's header. */ rituals?: React.ReactNode; date: IsoDate; data: WeekLoadData; onDate: (d: IsoDate) => void; onClose: () => void; onChanged: () => void; onCaptures: () => void };

const PAYBACK: Record<string, string> = { tonight: "tonight", friday: "Friday", day: "" };

export function CloseOut({ rituals, date, data, onDate, onClose, onChanged, onCaptures }: Props) {
  const [st, setSt] = useState<CloseOutState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [offer, setOffer] = useState<{ offer: FlexOffer; pick: Pick } | null>(null);
  // Q46: a note for any followed client, not only those worked that day.
  const [extra, setExtra] = useState<string[]>([]);
  useEffect(() => setExtra([]), [date]);
  const head = useRef<HTMLHeadingElement>(null);
  const tz = data.hours.timeZone;
  const sizes = data.planning.sizes;
  const names = new Map([...data.planClients.map((c) => [c.clientKey, c.clientName] as const), ...(data.devops ?? []).map((c) => [c.clientKey, c.clientName] as const)]);
  const clientName = (k: string) => names.get(k) ?? k;
  const clients = captureClients(data);
  const clearNotice = useCallback(() => setNotice(null), []);

  const load = useCallback(async () => {
    try {
      setSt(await call<CloseOutState>("closeout.load", { date }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load Close out");
    }
  }, [date]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => head.current?.focus(), [date]);

  const act = useCallback(
    async (action: string, input: Record<string, unknown>) => {
      try {
        await planAction(action, input);
        await load();
        onChanged();
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : "That didn't work");
        return false;
      }
    },
    [load, onChanged],
  );
  const makeUp = useCallback(
    async (p: Pick, input: { when: "tonight" | "friday" | "day"; date?: IsoDate; half?: Half }) => {
      try {
        const r = await call<MakeUpResult>("pick.make_up", { id: p.id, ...input });
        setNotice(`Borrowed ${formatDuration(r.borrowed.minutes)} to make up`);
        if (r.flexOffer) setOffer({ offer: r.flexOffer, pick: p });
        await load();
        onChanged();
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : "That didn't work");
        return false;
      }
    },
    [load, onChanged],
  );

  const rowDone = (m?: string) => {
    if (m) setNotice(m);
    void load();
    onChanged();
  };
  if (!st) return <main className="closeout" aria-label="Close out">{error ? <p className="set-problem">{error}</p> : <p className="muted">Loading…</p>}</main>;
  const dueBy = st.followUps.filter((l) => l.due !== null && l.due <= date);
  const rest = st.followUps.filter((l) => !dueBy.includes(l));

  const live = st.picks.filter((p) => p.status === "planned" || p.status === "done");
  // Step 14: a done pick whose item DevOps still lists among my open items; its "Update DevOps" follow-up, if any.
  const work = useContext(DevOpsWork);
  const stillOpen = (clientKey: string, id: number) => !!work.get(clientKey)?.items.some((i) => i.id === id);
  const followUpFor = (id: number) => st.followUps.find((f) => f.kind === "devops_update" && f.itemId === id && !f.closedAt)?.id ?? null;
  const settled = st.picks.filter((p) => p.status === "moved" || p.status === "dropped");
  const totals = dayFocus(st.picks, st.focused, sizes);
  const halves = (["AM", "PM", "EVE"] as const).filter((h) => st.picks.some((p) => p.half === h));
  // Clients worked: from the server (done, focused, flex), plus the day's focus blocks when the week on screen has it.
  const day = data.week.days.find((d) => d.date === date);
  const blockClients = day ? [...day.am.focus, ...day.pm.focus].map((b) => b.clientKey) : [];
  const worked = [...new Set([...st.worked.map((w) => w.clientKey), ...blockClients, ...Object.keys(st.notes), ...extra])];
  const others = data.planClients.filter((c) => !worked.includes(c.clientKey));
  const prev = Temporal.PlainDate.from(date).subtract({ days: 1 }).toString();
  const next = Temporal.PlainDate.from(date).add({ days: 1 }).toString();
  const unpaid = data.borrowed.filter((b) => !b.paidAt);

  return (
    <main className="closeout" aria-label="Close out">
      {rituals}
      <div className="follow-ups-head">
        <h2 ref={head} tabIndex={-1}>
          Close out <span className="muted">{dayName(date)}{st.access === "past" ? " (earlier day)" : ""}</span>
        </h2>
        <span className="co-step">
          <button type="button" className="mini" onClick={() => onDate(prev)} aria-label="Previous day" title="Previous day">‹</button>
          <button type="button" className="mini" onClick={() => onDate(next)} disabled={next > st.today} aria-label="Next day" title="Next day">›</button>
        </span>
        {st.closedOutAt ? (
          <span className="co-done">Closed out {clockOf(st.closedOutAt, tz)}</span>
        ) : null}
        <button
          type="button"
          className="top-btn primary"
          title={st.closedOutAt ? "Back (Esc)" : "Close out this day"}
          onClick={async () => {
            // Step 15.1 (D275): once closed out, Done just goes back; nothing is saved again.
            if (st.closedOutAt) return onClose();
            try {
              setSt(await call<CloseOutState>("closeout.commit", { date }));
              setNotice("Closed out. Nice work.");
              onChanged();
            } catch (e) {
              setError(e instanceof Error ? e.message : "Couldn't save Close out");
            }
          }}
        >
          {st.closedOutAt ? "Done" : "Done for the day"}
        </button>
        {!st.closedOutAt && (
          <button type="button" className="top-btn" onClick={onClose} title="Back (Esc)">
            Back
          </button>
        )}
      </div>
      {error && <p className="set-problem" role="alert">{error}</p>}
      <Fading text={notice} onGone={clearNotice} />
      {offer && <FlexOfferBar offer={offer.offer} clientKey={offer.pick.clientKey} clientName={clientName(offer.pick.clientKey)} title={offer.pick.title} onDone={(m) => { setOffer(null); setNotice(m); onChanged(); }} />}

      <section className="co-section" aria-labelledby="co-picks">
        <h3 id="co-picks">
          1. Picks <span className="muted">{formatDuration(totals.focusedMinutes) || "0m"} focused of {formatDuration(totals.plannedMinutes) || "0m"} planned</span>
        </h3>
        {!st.picks.length && <p className="muted">{st.committedAt ? "No picks that day." : "Nothing was planned that day. That's fine: resume notes and follow-ups still help."}</p>}
        {halves.map((h) => (
          <div key={h} className="co-half">
            <h4>{HALF_NAMES[h]}</h4>
            <ul className="co-picks">
              {live.filter((p) => p.half === h).map((p) => (
                <li key={p.id} className={`co-pick ${p.status}`}>
                  <label className="co-tick">
                    <input type="checkbox" checked={p.status === "done"} onChange={(e) => void act("pick.mark_done", { id: p.id, done: e.target.checked })} />
                    <span className="co-title">
                      {p.itemId !== null && <span className="muted">#{p.itemId} </span>}
                      {p.title}
                    </span>
                  </label>
                  <span className="co-client">{clientName(p.clientKey)}</span>
                  <FocusVsSize seconds={st.focused[p.id] ?? 0} size={p.size} sizes={sizes} />
                  {p.status === "planned" ? <SlipActions pick={p} carryTo={st.carryTo} today={st.today} act={act} makeUp={(i) => makeUp(p, i)} /> : <span className="co-status">Done</span>}
                  {p.status === "done" && p.itemId !== null && stillOpen(p.clientKey, p.itemId) && (
                    // Step 14: done here, still open in DevOps: the same state change as a follow-up's, inline.
                    <DevOpsAction clientKey={p.clientKey} label="Mark done in DevOps" onRun={(w) => w.markDone({ clientKey: p.clientKey, itemId: p.itemId!, title: p.title, ...(followUpFor(p.itemId!) ? { followUpId: followUpFor(p.itemId!)! } : {}) })} />
                  )}
                </li>
              ))}
              {settled.filter((p) => p.half === h).map((p) => (
                <li key={p.id} className={`co-pick ${p.status}`}>
                  <span className="co-title muted">
                    {p.itemId !== null && <span>#{p.itemId} </span>}
                    {p.title}
                  </span>
                  <span className="co-client">{clientName(p.clientKey)}</span>
                  <FocusVsSize seconds={st.focused[p.id] ?? 0} size={p.size} sizes={sizes} />
                  <span className="co-status">{p.status === "moved" ? movedText(p, st) : "Dropped"}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {(st.borrowed.length > 0 || unpaid.length > 0) && (
          <div className="co-borrowed">
            <h4>Borrowed time</h4>
            <ul>
              {[...st.borrowed, ...unpaid.filter((u) => !st.borrowed.some((b) => b.id === u.id))].map((b) => (
                <li key={b.id}>
                  {formatDuration(b.minutes)} for <strong>{b.title}</strong> from {dayName(b.date)}, to make up {PAYBACK[b.payback] || `${dayName(b.paybackDate)} ${HALF_NAMES[b.paybackHalf].toLowerCase()}`}
                  {b.paidAt ? <span className="co-paid"> · paid{b.paidBy === "picks" ? " (pick done)" : ""}</span> : (
                    <button type="button" className="mini" onClick={() => void call("borrow.pay", { id: b.id }).then(load).then(onChanged).catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not mark it paid"))}>
                      Mark paid
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="co-section" aria-labelledby="co-notes">
        <h3 id="co-notes">
          2. Where you left off <span className="muted">one line per client, optional</span>
        </h3>
        {!worked.length && <p className="muted">No client work recorded that day.</p>}
        {others.length > 0 && (
          <label className="co-other">
            <span className="sr-only">Note for another client</span>
            <select value="" onChange={(e) => e.target.value && setExtra((x) => [...x, e.target.value])}>
              <option value="">+ Another client</option>
              {others.map((c) => (
                <option key={c.clientKey} value={c.clientKey}>
                  {c.clientName}
                </option>
              ))}
            </select>
          </label>
        )}
        <ul className="co-notes">
          {worked.map((k) => (
            <NoteRow key={`${date}:${k}`} clientKey={k} clientName={clientName(k)} date={date} saved={st.notes[k]?.note ?? ""} previous={st.previous[k]?.note ?? null} onSaved={() => void load()} onError={setError} />
          ))}
        </ul>
      </section>

      {st.captures > 0 && (
        <section className="co-section co-captures" aria-label="Captures">
          <p>
            <strong>{st.captures} {st.captures === 1 ? "capture" : "captures"} to sort</strong> <span className="muted">into follow-ups or drafts.</span>{" "}
            <button type="button" className="mini" onClick={onCaptures}>Sort captures</button>
          </p>
        </section>
      )}
      <section className="co-section" aria-labelledby="co-follow-ups">
        <h3 id="co-follow-ups">
          3. Follow-ups <span className="muted">{st.followUps.length} open{dueBy.length ? `, ${dueBy.length} due by ${date === st.today ? "today" : dayName(date)} still open` : ""}</span>
        </h3>
        <AddFollowUp clients={clients} onAdded={() => { void load(); onChanged(); }} />
        {!st.followUps.length && <p className="muted">No open follow-ups.</p>}
        {dueBy.length > 0 && <h4 className="co-due-head">Due {date === st.today ? "today" : `by ${dayName(date)}`}, still open</h4>}
        <ul className="follow-up-list">
          {dueBy.map((l) => (
            <FollowUpRow key={l.id} l={l} timeZone={tz} today={st.today} clients={clients} onChanged={rowDone} />
          ))}
        </ul>
        {dueBy.length > 0 && rest.length > 0 && <h4 className="co-due-head">Other open follow-ups</h4>}
        <ul className="follow-up-list">
          {rest.map((l) => (
            <FollowUpRow key={l.id} l={l} timeZone={tz} today={st.today} clients={clients} onChanged={rowDone} />
          ))}
        </ul>
      </section>
    </main>
  );
}

const clockOf = (zoned: string, tz: string) => {
  const z = Temporal.ZonedDateTime.from(zoned).withTimeZone(tz);
  return `${z.hour % 12 || 12}:${String(z.minute).padStart(2, "0")} ${z.hour < 12 ? "AM" : "PM"}`;
};

function movedText(p: Pick, st: CloseOutState): string {
  const to = st.movedTo[p.id];
  const where = to ? `${dayName(to.date)}, ${HALF_NAMES[to.half].toLowerCase()}` : "another day";
  return st.borrowed.some((b) => b.fromPickId === p.id) ? `Making it up ${where}` : `Moved to ${where}`;
}

function NoteRow({ clientKey, clientName, date, saved, previous, onSaved, onError }: { clientKey: string; clientName: string; date: IsoDate; saved: string; previous: string | null; onSaved: () => void; onError: (m: string) => void }) {
  const [v, setV] = useState(saved);
  const [state, setState] = useState<"idle" | "saved">("idle");
  useEffect(() => setV(saved), [saved]);
  const save = async () => {
    if (v.trim() === saved) return;
    try {
      await call("note.set", { clientKey, date, note: v });
      setState("saved");
      onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not save the note");
    }
  };
  return (
    <li className="co-note">
      <label>
        <span className="co-client">{clientName}</span>
        <input
          value={v}
          maxLength={200}
          placeholder={previous ? `Last: ${previous}` : "Where you left off, and what's next"}
          onChange={(e) => { setV(e.target.value); setState("idle"); }}
          onBlur={() => void save()}
          onKeyDown={(e) => e.key === "Enter" && void save()}
        />
      </label>
      {state === "saved" && <span className="muted co-saved">Saved</span>}
    </li>
  );
}
