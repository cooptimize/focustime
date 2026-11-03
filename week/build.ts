import { iso, minutesOn, WEEKDAYS_7, weekDates7, zonedAt } from "./dates.ts";
import { hoursOn, mergeSpans, nominalHours, toHm, toMin, viewRange, type DayHours, type Span, type ViewRange } from "./hours.ts";
import { expandPatterns, mergeFocus, standingBlocksFor } from "./patterns.ts";
import { allDayOn, placeTimed, type Bucket } from "./placement.ts";
import { OOF_TITLE, type PtoDay } from "./pto.ts";
import { evaluateRisks } from "./risks.ts";
import type { CalEvent, Day, FlexSession, FocusPattern, Half, IsoDate, PlacedEvent, Slot, Unavailable, Week, WeekConfig } from "./types.ts";
import { userZone } from "./zone.ts";

export type BuildWeekInput = {
  weekStart: IsoDate;
  patterns: readonly FocusPattern[];
  events: readonly CalEvent[];
  config: WeekConfig;
  /** PTO days from Dataverse (step 6), by date. */
  pto?: Readonly<Record<IsoDate, PtoDay>>;
  /** Unavailable time and flex sessions from the plan store (step 6b). */
  unavailable?: readonly Unavailable[];
  flex?: readonly FlexSession[];
  /** What the timelines show (D123). */
  viewRange?: ViewRange;
  /** Weekend dates with picks on them, so their columns show (the plan store knows; this function doesn't). */
  weekendPlanned?: ReadonlySet<IsoDate>;
};

/** True when a timed event covers all of a working window (HH:MM, that date, that zone). */
function covers(e: CalEvent, date: IsoDate, w: Span, tz: string): boolean {
  if (e.allDay) return false;
  const s = Temporal.Instant.from(e.start).epochMilliseconds;
  const en = Temporal.Instant.from(e.end).epochMilliseconds;
  return s <= zonedAt(date, w.start, tz).epochMilliseconds && en >= zonedAt(date, w.end, tz).epochMilliseconds;
}

/** Unavailable time as a busy calendar item, so every rule treats it like a meeting's time (not as a meeting). */
export function unavailableEvent(u: Unavailable): CalEvent {
  return { id: `unavailable-${u.id}`, source: "focustime", title: u.title, start: u.start, end: u.end, allDay: false, showAs: "busy", isPersonal: false, unavailable: { id: u.id, note: u.note } };
}

/** The local span of an instant range on a date, clipped to that day; null when it doesn't touch the day. */
function spanOn(date: IsoDate, start: string, end: string, tz: string): Span | null {
  const a = Math.max(0, minutesOn(date, start, tz));
  const b = Math.min(1440, minutesOn(date, end, tz));
  return b > a ? { start: toHm(a), end: toHm(b) } : null;
}

/** The parts of spans before, inside and after a main span. */
function around(spans: readonly Span[], main: Span) {
  const [ms, me] = [toMin(main.start), toMin(main.end)];
  const before: Span[] = [];
  const after: Span[] = [];
  for (const s of spans) {
    const [a, b] = [toMin(s.start), toMin(s.end)];
    if (a < ms) before.push({ start: s.start, end: toHm(Math.min(b, ms)) });
    if (b > me) after.push({ start: toHm(Math.max(a, me)), end: s.end });
  }
  return { before, after };
}

/** True when a weekend day has something on it: working hours, a flex session, unavailable time or picks. */
export function weekendHasPlans(h: DayHours, flexOn: number, unavailableOn: number, planned: boolean): boolean {
  return h.segments.length > 0 || flexOn > 0 || unavailableOn > 0 || planned;
}

/** Build the whole week view model. Pure: same input, same output. */
export function buildWeek({ weekStart, patterns, events, config, pto = {}, unavailable = [], flex = [], viewRange: mode = "business", weekendPlanned = new Set() }: BuildWeekInput): Week {
  const model = config.hours;
  const tz = userZone(model);
  const all7 = weekDates7(weekStart);
  const hours = new Map(all7.map((d) => [d, hoursOn(model, d)]));
  const startDate = (x: { start: string }) => Temporal.Instant.from(x.start).toZonedDateTimeISO(tz).toPlainDate().toString();
  const flexOn = (d: IsoDate) => flex.filter((f) => startDate(f) === d);
  const unavailableOn = (d: IsoDate) => unavailable.filter((u) => spanOn(d, u.start, u.end, tz));
  const dates = all7.filter((d, i) => i < 5 || weekendHasPlans(hours.get(d)!, flexOn(d).length, unavailableOn(d).length, weekendPlanned.has(d)));

  const dataverse = expandPatterns(patterns, weekStart);
  const standing = standingBlocksFor(config.standingBlocks, weekStart);
  const busyItems = [...events, ...unavailable.map(unavailableEvent)];
  const nominal = nominalHours(model);

  // One range for the whole week, so the timelines line up: widened for unavailable time on the days shown.
  const planned = dates.flatMap((d) => unavailableOn(d).map((u) => spanOn(d, u.start, u.end, tz)!));
  const range = viewRange(mode, dates.map((d) => hours.get(d)!), planned);
  const [rStart, rEnd] = [toMin(range.start), toMin(range.end)];

  const days: Day[] = dates.map((date) => {
    const i = WEEKDAYS_7.indexOf(WEEKDAYS_7[Temporal.PlainDate.from(date).dayOfWeek - 1]!);
    const kind = i < 4 ? "work" : i === 4 ? "overflow" : "weekend";
    const h = hours.get(date)!;
    const listed = pto[date] ?? null;
    // Q34 (step 6c): a session may overlap working hours; that part is already working time, so it is noted, not counted.
    const dayFlex = flexOn(date).map((f) => {
      const sp = spanOn(date, f.start, f.end, tz);
      const overlapMinutes = sp ? h.segments.reduce((n, w) => n + Math.max(0, Math.min(toMin(sp.end), toMin(w.end)) - Math.max(toMin(sp.start), toMin(w.start))), 0) : 0;
      return { ...f, overlapMinutes };
    });
    const flexSpans = mergeSpans(dayFlex.map((f) => spanOn(date, f.start, f.end, tz)).filter((s): s is Span => !!s));

    // Working windows per slot: early flex joins the morning, evening spans and late flex form EVE (D122).
    let amWin: Span[] = [];
    let pmWin: Span[] = [];
    let eveWin: Span[] = [];
    if (h.main) {
      const fx = around(flexSpans, h.main);
      amWin = mergeSpans([h.am!, ...fx.before]);
      pmWin = [h.pm!];
      eveWin = mergeSpans([...h.extra, ...fx.after]);
    } else eveWin = flexSpans;
    const amB = h.am ?? nominal.am;
    const pmB = h.pm ?? nominal.pm;

    // What each card's timeline shows.
    let amView: [number, number];
    let pmView: [number, number];
    let eveView: [number, number] | null = null;
    const eveStart = eveWin[0] ? toMin(eveWin[0].start) : null;
    const eveEnd = eveWin.length ? toMin(eveWin[eveWin.length - 1]!.end) : null;
    if (!h.main && eveStart !== null) {
      amView = pmView = [eveStart, eveStart];
      eveView = [Math.min(rStart, eveStart), Math.max(rEnd, eveEnd!)];
    } else {
      amView = [Math.min(rStart, toMin((amWin[0] ?? amB).start)), toMin(pmB.start)];
      const pmEnd = eveStart !== null ? Math.max(toMin(pmB.end), Math.min(rEnd, eveStart)) : Math.max(rEnd, toMin(pmB.end));
      pmView = [toMin(pmB.start), pmEnd];
      if (eveStart !== null) eveView = [pmEnd, Math.max(rEnd, eveEnd!)];
    }
    const at = (n: number) => zonedAt(date, toHm(Math.min(n, 1440)), tz);
    const first = !h.main && eveView ? eveView[0] : amView[0];
    const last = eveView ? eveView[1] : pmView[1];
    const buckets: Bucket[] = [
      { name: "early", start: at(0), end: at(first) },
      { name: "AM", start: at(amView[0]), end: at(amView[1]) },
      { name: "PM", start: at(pmView[0]), end: at(pmView[1]) },
      ...(eveView ? [{ name: "EVE", start: at(eveView[0]), end: at(eveView[1]) }] : []),
      { name: "evening", start: at(last), end: at(1440) },
    ];
    const placed = placeTimed(busyItems, buckets, tz);
    const allDay = allDayOn(events, date);
    // S1 (D453): one PTO answer per half, shared by Week, Plan the week and Plan the day. Dataverse PTO is a whole day
    // (D105); out-of-office time covering all of a half's working hours makes that half PTO; both halves, the day.
    const oofHalf = (win: Span[]) => win.length > 0 && win.every((w) => events.some((e) => !e.isPersonal && e.showAs === "oof" && covers(e, date, w, tz)));
    const amOof = kind === "work" || kind === "overflow" ? oofHalf(amWin) : false;
    const pmOof = kind === "work" || kind === "overflow" ? oofHalf(pmWin) : false;
    const allDayOof = allDay.some((e) => !e.isPersonal && e.showAs === "oof") && (amWin.length > 0 || pmWin.length > 0);
    const listedHalf = listed?.half ?? null;
    const amOff = !!listed && listedHalf !== "PM" ? true : amOof || allDayOof;
    const pmOff = !!listed && listedHalf !== "AM" ? true : pmOof || allDayOof;
    const whole = (amOff || !amWin.length) && (pmOff || !pmWin.length) && (amOff || pmOff);
    const off: PtoDay | null = whole ? (listed && !listed.half ? listed : { date, titles: listed?.titles ?? [OOF_TITLE] }) : null;
    const ptoHalf: PtoDay | null = !whole && (amOff || pmOff) ? { date, titles: listed?.titles ?? [OOF_TITLE], half: amOff ? "AM" : "PM" } : null;
    const halfOff = (half: Half) => (half === "AM" ? amOff : half === "PM" ? pmOff : !!off);

    const slot = (half: Half, bounds: Span, view: [number, number], win: Span[]): Slot => {
      const at2 = (x: string) => iso(zonedAt(date, x, tz));
      const evs: PlacedEvent[] = placed.get(half) ?? [];
      const focus = kind === "work" && half !== "EVE" ? mergeFocus(dataverse.filter((x) => x.date === date && x.half === half), standing.filter((x) => x.date === date && x.half === half)) : [];
      const windows = win.map((w) => ({ start: at2(w.start), end: at2(w.end) }));
      const start = at2(bounds.start);
      const end = at2(bounds.end);
      const r = evaluateRisks({ focus, events: evs, allDay, start, end, windows, timeZone: tz }, config.thresholds);
      // A PTO day or half is simply off: nothing there is at risk (D99, D105, D453).
      const isOff = halfOff(half);
      const risks = isOff ? [] : r.risks;
      const slotFlex = dayFlex.filter((f) => {
        const m = minutesOn(date, f.start, tz);
        return half === "EVE" ? !h.main || m >= toMin(h.main.end) || m < 0 : half === "AM" ? !!h.main && m < toMin(h.pm!.start) && m >= 0 : !!h.main && m >= toMin(h.pm!.start) && m < toMin(h.main.end);
      });
      return {
        date,
        half,
        start,
        end,
        view: { start: iso(at(view[0])), end: iso(at(view[1])) },
        windows,
        off: windows.length === 0,
        flex: half === "EVE" ? dayFlex.filter((f) => !slotFlexElsewhere(f)) : slotFlex,
        focus,
        open: kind === "work" && half !== "EVE" && focus.length === 0 && windows.length > 0 && !isOff,
        events: evs,
        ...r,
        risks,
        pto: isOff,
      };
    };
    // Flex sessions shown on the morning or afternoon card are not repeated on EVE.
    const slotFlexElsewhere = (f: FlexSession) => {
      if (!h.main) return false;
      const m = minutesOn(date, f.start, tz);
      return m >= 0 && m < toMin(h.main.end);
    };

    const eve = eveView ? slot("EVE", { start: eveWin[0]!.start, end: eveWin[eveWin.length - 1]!.end }, eveView, eveWin) : null;
    return {
      date,
      weekday: WEEKDAYS_7[i]!,
      kind,
      allDay,
      early: placed.get("early")!,
      am: slot("AM", amB, amView, amWin),
      pm: slot("PM", pmB, pmView, pmWin),
      eve,
      evening: placed.get("evening")!,
      hours: h,
      flexMinutes: dayFlex.reduce((n, f) => n + Math.max(0, (Temporal.Instant.from(f.end).epochMilliseconds - Temporal.Instant.from(f.start).epochMilliseconds) / 60000 - f.overlapMinutes), 0),
      pto: off,
      ptoHalf,
    };
  });

  return { weekStart, timeZone: tz, days, range: { mode, ...range } };
}
