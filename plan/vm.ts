// My Azure VM (step 15.4): pure rules for its power state, the chip, the auto-shutdown schedule (read only: FocusTime
// never changes it, D465) and the morning prompt. No I/O.
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

/** A start FocusTime asked for and is still waiting on (the one VM write; D465). */
export type VmOp = "start";
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

/** What the chip shows: Azure's state, or the transition FocusTime started while Azure still shows the old state. */
export function chipOf(power: PowerState, transition: VmTransition | null): VmChip {
  if (transition?.op === "start" && power !== "running") return "starting";
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
/** Whether a start has reached running. */
export const reached = (_op: VmOp, p: PowerState) => p === "running";
/** Start is offered when the VM is off. */
export const canStart = (c: VmChip) => c === "deallocated" || c === "billing" || c === "unknown";

// ---- Auto-shutdown (Microsoft.DevTestLab/schedules, shutdown-computevm-<vm>) ----

export type ShutdownStatus = "Enabled" | "Disabled";
/** The parts of a schedule FocusTime reads (never writes): daily time "HHMM" in the schedule's own zone, and status. */
export type Shutdown = { time: string; status: ShutdownStatus; timeZoneId: string };

export function minutesOf(hhmm: string): number | null {
  const m = /^([01]\d|2[0-3])([0-5]\d)$/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
export const hhmmOf = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}${String(min % 60).padStart(2, "0")}`;

/** The schedule from a GET body, or null when it isn't a daily shutdown schedule FocusTime understands. */
export function shutdownFrom(body: unknown): Shutdown | null {
  const p = typeof body === "object" && body !== null ? (body as { properties?: unknown }).properties : null;
  if (typeof p !== "object" || p === null) return null;
  const o = p as { dailyRecurrence?: { time?: unknown }; status?: unknown; timeZoneId?: unknown };
  const time = o.dailyRecurrence?.time;
  if (typeof time !== "string" || minutesOf(time) === null) return null;
  const status: ShutdownStatus = o.status === "Disabled" ? "Disabled" : "Enabled";
  return { time, status, timeZoneId: typeof o.timeZoneId === "string" && o.timeZoneId ? o.timeZoneId : "UTC" };
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

/**
 * Step 16.3: the header chip's one line, the single place for VM status: "Running · off at 7:30 PM" (the auto-shutdown
 * time in my zone while it runs or starts and a schedule exists), else the state alone ("Stopped", "Starting…").
 */
export function chipText(chip: VmChip, s: Shutdown | null, myZone: string, today: IsoDate): string {
  const base = CHIP_LABEL[chip];
  if (!s || (chip !== "running" && chip !== "starting")) return base;
  return s.status === "Disabled" ? `${base} · auto-shutdown off` : `${base} · off at ${shutdownTime(s, myZone, today)}`;
}

/** The chip's schedule line. */
export function shutdownLabel(s: Shutdown | null, myZone: string, today: IsoDate): string | null {
  if (!s) return null;
  if (s.status === "Disabled") return "Auto-shutdown off";
  return `Auto-shutdown ${shutdownTime(s, myZone, today)}`;
}

/**
 * A schedule change from before fix/vm-schedule (D465), still in account state as `vm_shutdown:<vm>`: FocusTime no
 * longer puts these back (that would write the schedule); they are marked cancelled once (store/vm-restores.ts).
 */
export type LegacyShutdownChange = {
  vmId: string;
  date: IsoDate;
  original: { time: string; status: ShutdownStatus };
  changed: { time: string; status: ShutdownStatus };
  timeZoneId?: string;
  failedAt: string | null;
  message: string | null;
  cancelledAt?: string;
};

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
