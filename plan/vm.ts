// My Azure VM (step 15.4): pure rules for its power state, the chip, the auto-shutdown schedule (delay, skip,
// next-morning restore) and the morning prompt. No I/O.
import type { IsoDate } from "../week/types.ts";
import { zoneOf } from "./timezones.ts";

/** Azure's power states (instanceView statuses "PowerState/<x>"), plus unknown for none or anything else. */
export type PowerState = "starting" | "running" | "stopping" | "stopped" | "deallocating" | "deallocated" | "unknown";
const POWER: readonly PowerState[] = ["starting", "running", "stopping", "stopped", "deallocating", "deallocated"];

/** The power state from an instanceView's statuses array. */
export function powerFrom(statuses: unknown): PowerState {
  if (!Array.isArray(statuses)) return "unknown";
  for (const s of statuses) {
    const code = typeof s === "object" && s !== null ? (s as { code?: unknown }).code : null;
    if (typeof code === "string" && code.toLowerCase().startsWith("powerstate/")) {
      const p = code.slice("powerstate/".length).toLowerCase() as PowerState;
      return POWER.includes(p) ? p : "unknown";
    }
  }
  return "unknown";
}

/** A start or stop Coopilot asked for and is still waiting on. */
export type VmOp = "start" | "deallocate";
export type VmTransition = { op: VmOp; since: string };

export type VmChip = "running" | "deallocated" | "billing" | "starting" | "stopping" | "unknown";
export const CHIP_LABEL: Record<VmChip, string> = {
  running: "Running",
  deallocated: "Stopped (deallocated)",
  billing: "Stopped (still billing)",
  starting: "Starting…",
  stopping: "Stopping…",
  unknown: "Unknown",
};

/** What the chip shows: Azure's state, or the transition Coopilot started while Azure still shows the old state. */
export function chipOf(power: PowerState, transition: VmTransition | null): VmChip {
  if (transition?.op === "start" && power !== "running") return "starting";
  if (transition?.op === "deallocate" && power !== "deallocated") return "stopping";
  switch (power) {
    case "running": return "running";
    case "deallocated": return "deallocated";
    case "stopped": return "billing";
    case "starting": return "starting";
    case "stopping":
    case "deallocating": return "stopping";
    default: return "unknown";
  }
}

export const isTransition = (c: VmChip) => c === "starting" || c === "stopping";
/** Refresh every 60 s while visible, every 10 s during a transition. */
export const refreshMs = (c: VmChip) => (isTransition(c) ? 10_000 : 60_000);
/** Whether a start or stop has reached the state it asked for. */
export const reached = (op: VmOp, p: PowerState) => (op === "start" ? p === "running" : p === "deallocated");
/** Start is offered when the VM is off; Stop (deallocate) when it runs or is stopped but still billing. */
export const canStart = (c: VmChip) => c === "deallocated" || c === "billing" || c === "unknown";
export const canStop = (c: VmChip) => c === "running" || c === "billing";

// ---- Auto-shutdown (Microsoft.DevTestLab/schedules, shutdown-computevm-<vm>) ----

export type ShutdownStatus = "Enabled" | "Disabled";
/** The parts of a schedule Coopilot reads and changes: daily time "HHMM" in the schedule's own zone, and status. */
export type Shutdown = { time: string; status: ShutdownStatus; timeZoneId: string };

export function minutesOf(hhmm: string): number | null {
  const m = /^([01]\d|2[0-3])([0-5]\d)$/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
export const hhmmOf = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}${String(min % 60).padStart(2, "0")}`;

/** The schedule from a GET body, or null when it isn't a daily shutdown schedule Coopilot understands. */
export function shutdownFrom(body: unknown): Shutdown | null {
  const p = typeof body === "object" && body !== null ? (body as { properties?: unknown }).properties : null;
  if (typeof p !== "object" || p === null) return null;
  const o = p as { dailyRecurrence?: { time?: unknown }; status?: unknown; timeZoneId?: unknown };
  const time = o.dailyRecurrence?.time;
  if (typeof time !== "string" || minutesOf(time) === null) return null;
  const status: ShutdownStatus = o.status === "Disabled" ? "Disabled" : "Enabled";
  return { time, status, timeZoneId: typeof o.timeZoneId === "string" && o.timeZoneId ? o.timeZoneId : "UTC" };
}

/** The schedule's time later by some minutes, or null when that would pass midnight (Skip tonight is for that). */
export function delayed(time: string, minutes: number): string | null {
  const m = minutesOf(time);
  if (m === null || m + minutes >= 24 * 60) return null;
  return hhmmOf(m + minutes);
}

/** "7:00 PM", shown in my time zone (the schedule's zone may differ; today's date decides the offset). */
export function shutdownTime(s: Pick<Shutdown, "time" | "timeZoneId">, myZone: string, today: IsoDate): string {
  const m = minutesOf(s.time) ?? 0;
  const zone = zoneOf({ name: s.timeZoneId }) ?? "UTC";
  let t = Temporal.PlainTime.from({ hour: Math.floor(m / 60), minute: m % 60 });
  try {
    t = Temporal.PlainDate.from(today).toZonedDateTime({ timeZone: zone, plainTime: t }).withTimeZone(myZone).toPlainTime();
  } catch {
    /* keep the schedule's own time */
  }
  const h = t.hour % 12 === 0 ? 12 : t.hour % 12;
  return `${h}:${String(t.minute).padStart(2, "0")} ${t.hour < 12 ? "AM" : "PM"}`;
}

/** The chip's schedule line. */
export function shutdownLabel(s: Shutdown | null, myZone: string, today: IsoDate): string | null {
  if (!s) return null;
  if (s.status === "Disabled") return "Auto-shutdown off";
  return `Auto-shutdown ${shutdownTime(s, myZone, today)}`;
}

export type ShutdownChoice = "delay60" | "delay120" | "skip";
/** The schedule after a choice, or why it can't be done. Delays add to the time it has now. */
export function applyChoice(s: Shutdown, choice: ShutdownChoice): { time: string; status: ShutdownStatus } | { error: string } {
  if (s.status === "Disabled") return { error: "Auto-shutdown is already off tonight" };
  if (choice === "skip") return { time: s.time, status: "Disabled" };
  const t = delayed(s.time, choice === "delay60" ? 60 : 120);
  return t ? { time: t, status: "Enabled" } : { error: "That would be after midnight. Use Skip tonight instead" };
}

/**
 * A schedule Coopilot changed and will put back: the original (first one, kept across further delays), what it was
 * changed to, the local day of the change, and the last failed restore, if any.
 */
export type ShutdownChange = {
  vmId: string;
  date: IsoDate;
  original: { time: string; status: ShutdownStatus };
  changed: { time: string; status: ShutdownStatus };
  /** The schedule's own zone (Windows name), for showing its times. */
  timeZoneId?: string;
  failedAt: string | null;
  message: string | null;
};

/** Restore is due from the first run after midnight (any later local day). */
export const restoreDue = (c: ShutdownChange, today: IsoDate) => Temporal.PlainDate.compare(Temporal.PlainDate.from(today), Temporal.PlainDate.from(c.date)) > 0;

/** What restoring does against the schedule as it is now: put it back, nothing (already back), or leave it (changed elsewhere). */
export function restorePlan(c: ShutdownChange, now: Shutdown | null): "restore" | "already" | "changed_elsewhere" | "gone" {
  if (!now) return "gone";
  const same = (a: { time: string; status: string }) => a.time === now.time && a.status === now.status;
  if (same(c.original)) return "already";
  if (same(c.changed)) return "restore";
  return "changed_elsewhere";
}

/** After a failed restore, try again at most this often (and at work start). */
export const RESTORE_RETRY_MS = 10 * 60_000;
export function restoreAttemptDue(c: ShutdownChange, today: IsoDate, nowMs: number, atWorkStart: boolean): boolean {
  if (!restoreDue(c, today)) return false;
  if (!c.failedAt || atWorkStart) return true;
  return nowMs - Date.parse(c.failedAt) >= RESTORE_RETRY_MS;
}

/** Today's warning: a change still not put back after its day ended. */
export const stillChanged = (c: ShutdownChange | null, today: IsoDate) => !!c && restoreDue(c, today);

// ---- Morning prompt ----

/**
 * "Your VM is off. Start it?": on a workday, from work start, when my confirmed VM is stopped, unless dismissed for
 * the day. Never starts anything by itself.
 */
export function morningPrompt(o: { chip: VmChip | null; workday: boolean; nowMin: number; workStartMin: number | null; dismissed: boolean }): boolean {
  if (!o.chip || !o.workday || o.dismissed || o.workStartMin === null) return false;
  if (o.nowMin < o.workStartMin) return false;
  return o.chip === "deallocated" || o.chip === "billing";
}
