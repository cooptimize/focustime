import { aboutHours } from "../plan/fit.ts";
import { ModeArea } from "./ModeSwitch.tsx";
import type React from "react";
// Check-in (step 7): midday, about a minute. For today: each pick's status and focused time, what each block or
// slot has left after meetings, and which picks no longer fit, with move, drop or "make it up". Walk-on work can
// be added to a block; if that puts it over, the picks that no longer fit say so. Computed here from the week
// already loaded (plan/checkin.ts); actions are the usual pick actions. Local only.
import { useCallback, useState } from "react";
import type { WeekLoadData } from "../actions/types.ts";
import { checkIn } from "../plan/checkin.ts";
import { blockClient, isPickable } from "../plan/rules.ts";
import { boxedMinutes } from "../plan/timebox.ts";
import type { Pick } from "../plan/types.ts";
import { formatDuration } from "../week/format.ts";
import type { Half, IsoDate, Slot } from "../week/types.ts";
import { call, planAction } from "./api.ts";
import { useFocused } from "./planview.ts";
import { AnythingShifted } from "./WeekMusts.tsx";
import { mondayOf } from "../week/dates.ts";
import { dayName, FlexOfferBar, FocusVsSize, HALF_NAMES, SlipActions, type FlexOffer, type MakeUpResult } from "./PickReview.tsx";

type Props = { /** Step 16.2: Today's mode switch, at the right of this view's header. */ switcher?: React.ReactNode; data: WeekLoadData; now: string; /** Back to Today › Now. */ onClose: () => void; onChanged: () => void };

const time = (iso: string, tz: string) => {
  const z = Temporal.Instant.from(iso).toZonedDateTimeISO(tz);
  return `${z.hour % 12 || 12}:${String(z.minute).padStart(2, "0")} ${z.hour < 12 ? "AM" : "PM"}`;
};

export function CheckIn({ switcher, data, now, onClose, onChanged }: Props) {
  const tz = data.hours.timeZone;
  const today: IsoDate = data.planDay.date;
  const day = data.week.days.find((d) => d.date === today);
  const focused = useFocused();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [offer, setOffer] = useState<{ offer: FlexOffer; pick: Pick } | null>(null);
  const names = new Map([...data.planClients.map((c) => [c.clientKey, c.clientName] as const), ...(data.devops ?? []).map((c) => [c.clientKey, c.clientName] as const)]);
  const clientName = (k: string) => names.get(k) ?? k;
  const picks = data.plan?.[today]?.picks ?? [];
  const committed = !!data.plan?.[today]?.committedAt;

  const act = useCallback(
    async (action: string, input: Record<string, unknown>) => {
      try {
        await planAction(action, input);
        setError(null);
        onChanged();
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : "That didn't work");
        return false;
      }
    },
    [onChanged],
  );
  const makeUp = useCallback(
    async (p: Pick, input: { when: "tonight" | "friday" | "day"; date?: IsoDate; half?: Half }) => {
      try {
        const r = await call<MakeUpResult>("pick.make_up", { id: p.id, ...input });
        setNotice(`Borrowed ${formatDuration(r.borrowed.minutes)} to make up`);
        if (r.flexOffer) setOffer({ offer: r.flexOffer, pick: p });
        onChanged();
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : "That didn't work");
        return false;
      }
    },
    [onChanged],
  );

  if (!day)
    return (
      <main className="closeout" aria-label="Check-in">
        <div className="follow-ups-head">
          <h2 tabIndex={-1}>Check-in</h2>
          <ModeArea>{switcher}</ModeArea>
        </div>
        <p className="muted">Loading today…</p>
      </main>
    );

  const slots: { half: Half; slot: Slot }[] = [{ half: "AM", slot: day.am }, { half: "PM", slot: day.pm }, ...(day.eve ? [{ half: "EVE" as Half, slot: day.eve }] : [])];
  const fit = checkIn(slots.map((s) => ({ half: s.half, slot: { ...s.slot, pto: !!day.pto } })), picks, focused, data.planning.sizes, now, boxedMinutes(data.timeboxes));
  // Tomorrow's first plannable day for carry-over is the server's job; here "Carry over" goes to the next day with hours.
  const nextDay = data.week.days.find((d) => d.date > today && d.hours.segments.length > 0 && !d.pto)?.date ?? null;

  return (
    <main className="closeout checkin" aria-label="Check-in">
      <div className="follow-ups-head">
        <h2 tabIndex={-1}>
          Check-in <span className="muted">{dayName(today)}, {time(now, tz)}</span>
        </h2>
        <ModeArea
          done={{
            title: data.checkIn.done ? "Back to Now (Esc)" : "Check-in done: back to Now",
            onClick: async () => {
              // Step 16.2: Done marks today checked in (the ✓ on the switch), then goes back to Now.
              if (!data.checkIn.done && !(await act("checkin.done", { date: today }))) return;
              onClose();
            },
          }}
        >
          {switcher}
        </ModeArea>
      </div>
      {!committed && <p className="co-notice">Today isn't committed yet. Plan the day (P) to make the most of the afternoon.</p>}
      {error && <p className="set-problem" role="alert">{error}</p>}
      {notice && <p className="co-notice" role="status">{notice}</p>}
      {offer && <FlexOfferBar offer={offer.offer} clientKey={offer.pick.clientKey} clientName={clientName(offer.pick.clientKey)} title={offer.pick.title} onDone={(m) => { setOffer(null); setNotice(m); onChanged(); }} />}
      {fit.map((f) => {
        const slot = slots.find((s) => s.half === f.half)!.slot;
        const block = blockClient(slot.focus[0]?.clientKey ?? null, picks.filter((p) => p.half === f.half));
        // Step 16.4: plain words, whole hours at most ("about an hour over"), never minutes math.
        const head = f.ended ? "ended" : f.leftMinutes > 0 ? `${aboutHours(f.leftMinutes)} left after meetings` : "no time left after meetings";
        const verdict = !f.needMinutes ? "nothing planned left" : f.overBy ? (f.overBy < 45 ? "a little more than the time left" : `${aboutHours(f.overBy)} more than the time left`) : "fits";
        return (
          <section key={f.half} className={`co-section ci-slot${f.overBy ? " over" : ""}${f.ended ? " ended" : ""}`} aria-label={HALF_NAMES[f.half]}>
            <h3>
              {HALF_NAMES[f.half]}
              {block.clientKey && <span className="co-client">{clientName(block.clientKey)}</span>}
              <span className="muted">
                {time(slot.start, tz)} to {time(slot.end, tz)} · {head}
              </span>
              <span className={`ci-verdict${f.overBy ? " over" : ""}`}>{verdict}</span>
            </h3>
            {f.overBy > 0 && !f.ended && (
              <p className="ci-prompt" role="status">
                {f.overBy < 45 ? "A little" : `${aboutHours(f.overBy)[0]!.toUpperCase()}${aboutHours(f.overBy).slice(1)}`} more planned than the time left. What should move? Carry over, move, drop or make up one of the picks marked "No longer fits".
              </p>
            )}
            <ul className="co-picks">
              {f.picks.map(({ pick: p, fits }) => (
                <li key={p.id} className={`co-pick ${p.status}${fits ? "" : " nofit"}`}>
                  <label className="co-tick">
                    <input type="checkbox" checked={p.status === "done"} onChange={(e) => void act("pick.mark_done", { id: p.id, done: e.target.checked })} />
                    <span className="co-title">
                      {p.itemId !== null && <span className="muted">#{p.itemId} </span>}
                      {p.title}
                    </span>
                  </label>
                  <FocusVsSize seconds={focused(p.id)} size={p.size} sizes={data.planning.sizes} />
                  {p.status === "done" ? <span className="co-status">Done</span> : fits ? <span className="co-status fits">Fits</span> : (
                    <>
                      <span className="co-status nofit-tag">No longer fits</span>
                      <SlipActions pick={p} carryTo={nextDay} today={today} act={act} makeUp={(i) => makeUp(p, i)} />
                    </>
                  )}
                </li>
              ))}
            </ul>
            {!f.picks.length && <p className="muted">No picks here.</p>}
            {!f.ended && !day.pto && <WalkOn data={data} date={today} half={f.half} clientKey={block.clientKey} picks={picks} act={act} />}
          </section>
        );
      })}
      <AnythingShifted data={data} weekStart={mondayOf(today)} now={now} onChanged={onChanged} />
    </main>
  );
}

/** Walk-on work: a DevOps item of the block's client, or a typed intention, added to this block. */
function WalkOn({ data, date, half, clientKey, picks, act }: { data: WeekLoadData; date: IsoDate; half: Half; clientKey: string | null; picks: readonly Pick[]; act: (a: string, i: Record<string, unknown>) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [client, setClient] = useState(clientKey ?? data.planClients[0]?.clientKey ?? "");
  const [choice, setChoice] = useState("");
  const [intention, setIntention] = useState("");
  const work = data.devops?.find((w) => w.clientKey === client);
  const taken = new Set(picks.filter((p) => p.status === "planned" || p.status === "done").map((p) => p.itemId));
  const items = work ? [...work.items, ...work.children].filter((i) => isPickable(i) && !taken.has(i.id)) : [];
  if (!open)
    return (
      <button type="button" className="mini ci-walkon" onClick={() => setOpen(true)}>
        Add walk-on work…
      </button>
    );
  return (
    <form
      className="slip-form ci-walkon-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const input = choice ? { itemId: Number(choice) } : { intention };
        if (await act("pick.add", { date, half, clientKey: client, ...input })) {
          setOpen(false);
          setChoice("");
          setIntention("");
        }
      }}
    >
      {!clientKey && (
        <select value={client} onChange={(e) => setClient(e.target.value)} aria-label="Client">
          {data.planClients.map((c) => (
            <option key={c.clientKey} value={c.clientKey}>
              {c.clientName}
            </option>
          ))}
        </select>
      )}
      <select value={choice} onChange={(e) => setChoice(e.target.value)} aria-label="DevOps item">
        <option value="">Typed intention</option>
        {items.map((i) => (
          <option key={i.id} value={i.id}>
            #{i.id} {i.title}
          </option>
        ))}
      </select>
      {!choice && <input required maxLength={200} value={intention} placeholder="What walked in" onChange={(e) => setIntention(e.target.value)} aria-label="Intention" />}
      <button type="submit" className="mini primary">
        Add
      </button>
      <button type="button" className="mini" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </form>
  );
}
