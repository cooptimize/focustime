// NT-1: one answer per person per day to "is this a day off?": whole-day PTO (the Time Off Tracker) or a company holiday
// (the Working Days Calendar), from the same two Dataverse reads the VM start uses (vmContext's daysOff). Everything in a
// person's background asks this one reader: the notification gate, the reminders, the Teams rhythm and the VM start.
//
// - Budget: one read of PTO and holidays together per person per DAY_OFF_READ_MS, for a window from today
//   (DAY_OFF_WINDOW_DAYS long, the VM chip's "Next:" range); any range inside it is answered from that read. A range
//   outside it (the start's pause check looks back) is read on its own, as before.
// - No Dataverse user (none found for the sign-in yet): not PTO, as before.
// - PTO that can't be read fresh: the last good read covering the day, if at most PTO_STALE_HOURS old (this reader's own,
//   or the VM start's stored one), else unknown (null). Each caller decides what unknown means.
// - Holidays that can't be read: not a holiday (a working day).
// - Failed reads: logged once a day per reason, by kind only (never a name, an id, a date or a holiday's title).
// - Outside production nothing is read: the answer is "not a day off" (as the hosted app had it before NT-1).
import type { AppConfig } from "../config/schema.ts";
import type { Logger } from "../log/logger.ts";
import { ptoFromEarlier, type PtoRead } from "../plan/vm-autostart.ts";
import { localToday } from "../week/dates.ts";
import { userZone } from "../week/zone.ts";

export const DAY_OFF_READ_MS = 30 * 60_000;
export const DAY_OFF_WINDOW_DAYS = 14;

type Sets = { pto: ReadonlySet<string> | null; holidays: ReadonlySet<string> | null };
export type DaysOffRead = (cfg: AppConfig, from: string, to: string) => Promise<Sets>;

/** A day's answer. `pto` null: PTO couldn't be read and no recent read covers the day. */
export type DayOff = { pto: boolean | null; holiday: boolean };

/** Whether the day is off for a caller whose fallback for unknown PTO is `unknown` (the gate sends; the rest wait). */
export const isDayOff = (a: DayOff, unknown: boolean): boolean => a.holiday || (a.pto ?? unknown);

export type DaysOffReader = {
  /** The VM start's daysOff, served from the shared read where the range fits. */
  read: DaysOffRead;
  /** A day's answer (outside production: not a day off, nothing read). */
  day: (cfg: AppConfig, date: string) => Promise<DayOff>;
};

export function daysOffReader(d: {
  production: boolean;
  /** The raw reads (vmContext's daysOff), built only when first needed. */
  read: () => Promise<DaysOffRead | null>;
  now: () => Temporal.Instant;
  /** The VM start's last good PTO read (its stored state), for the 24 hour rule. */
  earlier?: () => Promise<PtoRead | null>;
  log: Logger;
}): DaysOffReader {
  let window: { at: number; from: string; to: string; sets: Sets } | null = null;
  let inflight: Promise<Sets> | null = null;
  let lastGood: PtoRead | null = null;
  const logged = new Set<string>();
  const logOnce = (date: string, kind: string) => {
    const k = `${date}:${kind}`;
    if (logged.has(k)) return;
    if (logged.size > 50) logged.clear();
    logged.add(k);
    d.log({ source: "dataverse", op: "day_off", kind });
  };
  /** A read that throws (or a context that can't be built) is unread, both kinds. */
  const raw = async (cfg: AppConfig, from: string, to: string): Promise<Sets> => {
    try {
      const r = await d.read();
      return r ? await r(cfg, from, to) : { pto: new Set(), holidays: new Set() };
    } catch {
      return { pto: null, holidays: null };
    }
  };
  const windowOf = async (cfg: AppConfig, today: string): Promise<Sets> => {
    const t = d.now().epochMilliseconds;
    if (window && window.from === today && t - window.at < DAY_OFF_READ_MS) return window.sets;
    if (inflight) return inflight;
    const to = Temporal.PlainDate.from(today).add({ days: DAY_OFF_WINDOW_DAYS - 1 }).toString();
    inflight = raw(cfg, today, to)
      .then((sets) => {
        window = { at: t, from: today, to, sets };
        if (sets.pto) lastGood = { at: Temporal.Instant.fromEpochMilliseconds(t).toString(), from: today, to, days: [...sets.pto].filter((x) => x >= today && x <= to).sort() };
        return sets;
      })
      .finally(() => (inflight = null));
    return inflight;
  };
  const within = (s: ReadonlySet<string> | null, from: string, to: string) => (s ? new Set([...s].filter((x) => x >= from && x <= to)) : null);
  const todayOf = (cfg: AppConfig) => localToday(d.now().toString(), userZone(cfg));
  return {
    read: async (cfg, from, to) => {
      const today = todayOf(cfg);
      const end = Temporal.PlainDate.from(today).add({ days: DAY_OFF_WINDOW_DAYS - 1 }).toString();
      if (from < today || to > end) return raw(cfg, from, to);
      const s = await windowOf(cfg, today);
      return { pto: within(s.pto, from, to), holidays: within(s.holidays, from, to) };
    },
    day: async (cfg, date) => {
      if (!d.production) return { pto: false, holiday: false };
      const today = todayOf(cfg);
      const end = Temporal.PlainDate.from(today).add({ days: DAY_OFF_WINDOW_DAYS - 1 }).toString();
      const s = date >= today && date <= end ? await windowOf(cfg, today) : await raw(cfg, date, date);
      if (!s.holidays) logOnce(date, "holidays_unread");
      const holiday = !!s.holidays?.has(date);
      if (s.pto) return { pto: s.pto.has(date), holiday };
      // No Dataverse user yet (not found for the sign-in): nothing to read, so not PTO, as before NT-1. Only a read
      // that fails is unknown.
      if (!cfg.dataverse.mySystemUserId) return { pto: false, holiday };
      const now = d.now();
      const stored = d.earlier ? await d.earlier().catch(() => null) : null;
      const found = [lastGood, stored].map((r) => ptoFromEarlier(r, date, now)).filter((x): x is { off: boolean; at: string } => !!x).sort((a, b) => b.at.localeCompare(a.at))[0];
      if (found) {
        logOnce(date, "pto_unread_earlier");
        return { pto: found.off, holiday };
      }
      logOnce(date, "pto_unread");
      return { pto: null, holiday };
    },
  };
}
