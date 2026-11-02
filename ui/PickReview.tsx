// Shared by Today's Check-in and Close out (step 7, U2): day and slot names, and the flex session offered after
// "I'll make it up" tonight or on a weekend. The pick rows themselves are PickRow (density "today").
import type { Half, IsoDate } from "../week/types.ts";
import { call } from "./api.ts";

export const dayName = (d: IsoDate) => Temporal.PlainDate.from(d).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" });
export const HALF_NAMES: Record<Half, string> = { AM: "Morning", PM: "Afternoon", EVE: "Evening" };
const clock = (hm: string) => {
  const [h, m] = hm.split(":").map(Number) as [number, number];
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 || h === 24 ? "AM" : "PM"}`;
};

export type FlexOffer = { date: IsoDate; start: string; end: string };
export type MakeUpResult = { flexOffer: FlexOffer | null; borrowed: { minutes: number } };

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
