// MB-1: the phone's Day: the Now card's state and a block's name. PH-1 moved the Now card and Next into the phone's own
// screen file (ui/phone/PhoneScreens.tsx), which a computer never downloads; PH-2 moved today's to-dos by block there
// too, as the day's sections (ui/phone/PhoneDayGlance.tsx).
import type { WeekLoadData } from "../actions/types.ts";
import type { Slot } from "../week/types.ts";
import type { DayEvent } from "../plan/todaycal.ts";
import { nowCard, type NowCard } from "../plan/phonenow.ts";
import { isCatchUp, slotOf } from "../plan/dayblocks.ts";

/** RS-2: a block with no client is the catch-up day's ("Catch-up", as Week names it) or an Open half-day. */
const noClient = (data: WeekLoadData, date: string | undefined, half: Slot["half"]) => {
  const d = data.week.days.find((x) => x.date === date);
  return d && isCatchUp(d, slotOf(d, half) ?? d.am) ? "Catch-up" : "Open";
};

/** The Now card's state for today's blocks and calendar. */
export function phoneNowOf(blocks: readonly Slot[], events: readonly DayEvent[], now: string): NowCard {
  return nowCard(
    blocks.map((s) => ({ half: s.half, clientKey: s.focus[0]?.clientKey ?? null, start: s.start, end: s.end })),
    events.map((e) => ({ id: e.event.id, title: e.event.title, start: e.start, end: e.end, isPersonal: e.event.isPersonal, unavailable: e.event.unavailable, notMeeting: e.event.notMeeting, allDay: e.event.allDay })),
    now,
  );
}

/** PH-1: a block's name on the phone: its client, or "Catch-up" or "Open" (RS-2). */
export function phoneNameOf(data: WeekLoadData, nameOf: (k: string) => string, b: { half: string; clientKey: string | null }): string {
  return b.clientKey ? nameOf(b.clientKey) : noClient(data, data.planDay.date, b.half as Slot["half"]);
}
