// Pick rows for Close out and Check-in (step 7): planned vs actual at a glance, and what to do with a pick that isn't
// done: carry over, move to a day and slot, drop, or "I'll make it up" (tonight, Friday, another day).
import { useState } from "react";
import type { Pick, Size } from "../plan/types.ts";
import type { Half, IsoDate } from "../week/types.ts";
import { formatDuration } from "../week/format.ts";
import { call } from "./api.ts";

export const dayName = (d: IsoDate) => Temporal.PlainDate.from(d).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" });
export const HALF_NAMES: Record<Half, string> = { AM: "Morning", PM: "Afternoon", EVE: "Evening" };
const clock = (hm: string) => {
  const [h, m] = hm.split(":").map(Number) as [number, number];
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 || h === 24 ? "AM" : "PM"}`;
};

/** "45m of M (2h)" with a bar: focused time against the size. */
export function FocusVsSize({ seconds, size, sizes }: { seconds: number; size: Size; sizes: Readonly<Record<Size, number>> }) {
  const minutes = Math.floor(seconds / 60);
  const planned = sizes[size];
  const pct = Math.min(100, Math.round((minutes / planned) * 100));
  return (
    <span className="fvs" title={`${formatDuration(minutes) || "0m"} focused of ${size} (${formatDuration(planned)})`}>
      <span className="fvs-bar" aria-hidden="true">
        <span className={`fvs-fill${minutes > planned ? " over" : ""}`} style={{ width: `${pct}%` }} />
      </span>
      <span className="fvs-text">
        {minutes ? formatDuration(minutes) : "0m"} of {size} <span className="muted">({formatDuration(planned)})</span>
      </span>
    </span>
  );
}

export type FlexOffer = { date: IsoDate; start: string; end: string };
export type MakeUpResult = { flexOffer: FlexOffer | null; borrowed: { minutes: number } };

type Act = (action: string, input: Record<string, unknown>) => Promise<boolean>;

/** What to do with a pick that isn't done. */
export function SlipActions({ pick, carryTo, today, act, makeUp }: { pick: Pick; carryTo: IsoDate | null; today: IsoDate; act: Act; makeUp: (input: { when: "tonight" | "friday" | "day"; date?: IsoDate; half?: Half }) => Promise<boolean> }) {
  const [mode, setMode] = useState<"move" | "makeup" | "makeup-day" | null>(null);
  const [to, setTo] = useState<{ date: IsoDate; half: Half }>({ date: carryTo ?? today, half: pick.half });
  const form = (label: string, submit: () => Promise<boolean>) => (
    <form
      className="slip-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit().then((ok) => ok && setMode(null));
      }}
    >
      <input type="date" required min={today} value={to.date} onChange={(e) => setTo({ ...to, date: e.target.value })} aria-label="Day" />
      <select value={to.half} onChange={(e) => setTo({ ...to, half: e.target.value as Half })} aria-label="Slot">
        {(["AM", "PM", "EVE"] as const).map((h) => (
          <option key={h} value={h}>
            {HALF_NAMES[h]}
          </option>
        ))}
      </select>
      <button type="submit" className="mini primary">
        {label}
      </button>
      <button type="button" className="mini" onClick={() => setMode(null)}>
        Cancel
      </button>
    </form>
  );
  if (mode === "move") return form("Move", () => act("pick.move", { id: pick.id, date: to.date, half: to.half }));
  if (mode === "makeup-day") return form("Make it up", () => makeUp({ when: "day", date: to.date, half: to.half }));
  if (mode === "makeup")
    return (
      <div className="slip-actions" role="group" aria-label="Make it up when">
        <span className="muted">Make it up:</span>
        <button type="button" className="mini" onClick={() => void makeUp({ when: "tonight" }).then((ok) => ok && setMode(null))}>
          Tonight
        </button>
        <button type="button" className="mini" onClick={() => void makeUp({ when: "friday" }).then((ok) => ok && setMode(null))}>
          Friday
        </button>
        <button type="button" className="mini" onClick={() => setMode("makeup-day")}>
          Another day…
        </button>
        <button type="button" className="mini" onClick={() => setMode(null)}>
          Cancel
        </button>
      </div>
    );
  return (
    <div className="slip-actions" role="group" aria-label="Not done">
      {carryTo && (
        <button type="button" className="mini" onClick={() => void act("pick.move", { id: pick.id, date: carryTo, half: pick.half })} title={`Move to ${dayName(carryTo)}, ${HALF_NAMES[pick.half].toLowerCase()}`}>
          Move to {dayName(carryTo)}
        </button>
      )}
      <button type="button" className="mini" onClick={() => setMode("move")}>
        Move…
      </button>
      <button type="button" className="mini" onClick={() => setMode("makeup")}>
        I'll make it up…
      </button>
      <button type="button" className="mini danger" onClick={() => void act("pick.remove", { id: pick.id })}>
        Drop
      </button>
    </div>
  );
}

/** After "I'll make it up" tonight or on a weekend: offer the flex session (local only, no calendar write). */
export function FlexOfferBar({ offer, clientKey, clientName, title, onDone }: { offer: FlexOffer; clientKey: string; clientName: string; title: string; onDone: (msg: string | null) => void }) {
  return (
    <div className="flex-offer" role="status">
      <span>
        Add a flex session {dayName(offer.date)}, {clock(offer.start)} to {clock(offer.end)} for {clientName}? Local only; nothing goes on your calendar.
      </span>
      <button
        type="button"
        className="mini primary"
        onClick={async () => {
          try {
            await call("flex.add", { date: offer.date, clientKey, start: offer.start, end: offer.end, note: `Make up: ${title}`.slice(0, 500) });
            onDone("Flex session added");
          } catch (e) {
            onDone(e instanceof Error ? e.message : "Could not add the flex session");
          }
        }}
      >
        Add flex session
      </button>
      <button type="button" className="mini" onClick={() => onDone(null)}>
        No thanks
      </button>
    </div>
  );
}
