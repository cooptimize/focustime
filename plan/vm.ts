// My Azure VM (step 15.4): pure rules for its power state, the chip, the auto-shutdown schedule (read only: FocusTime
// never changes it, D475) and the morning prompt. VM-2: Stop (deallocate) is offered again, only while it runs. No I/O.
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

/** A start or (VM-2) a stop FocusTime asked for and is still waiting on: the two VM writes. */
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

/** What the chip shows: Azure's state, or the transition FocusTime started while Azure still shows the old state. */
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

// ---- VM-4: a read that failed ----

/**
 * Why FocusTime couldn't read the VM's state, in the four words the chip uses: it can't reach Azure (no network, a
 * time-out, or FocusTime itself didn't answer the page), Azure is busy (it asked to wait, or had a fault of its own),
 * the Azure sign-in needs doing again, or Azure refused (permission, not found, any other no).
 */
export type ReadProblem = "network" | "busy" | "sign_in" | "refused";
/** While a read fails the chip keeps the last state it knew and asks again this often. */
export const CHECK_AGAIN_MS = 10_000;
/** After failing this long it says the reason on its face. */
export const PROBLEM_AFTER_MS = 2 * 60_000;
/** After that, it keeps asking, a little less often. */
export const CHECK_LATER_MS = 30_000;

/** The reason from a failure's kind (AzureError or AuthFailure kinds) and, for Azure, its HTTP status. */
export function readProblemOf(kind: string, status = 0): ReadProblem {
  if (kind === "network" || kind === "timeout" || kind === "keyring") return "network";
  if (kind === "throttled" || status >= 500) return "busy";
  if (kind === "not_signed_in" || kind === "consent" || kind === "expired" || kind === "not_connected" || kind === "misconfigured" || kind === "error") return "sign_in";
  return "refused";
}

/** The words: `short` on the chip's face, `text` in its menu with what to do. One place (docs/design/wording.md). */
/** VM-4: what to do, one line in the chip's menu under the reason (sign_in's is the item itself: Sign in to Azure). */
export const READ_NEXT: Record<ReadProblem | "app", string | null> = {
  network: "Check your connection; FocusTime keeps trying",
  busy: "Nothing to do; FocusTime keeps trying",
  sign_in: null,
  refused: "Your access may have changed: check the Azure portal or ask an admin",
  app: "Check your connection; FocusTime keeps trying",
};
export const READ_PROBLEM: Record<ReadProblem | "app", { short: string; text: string }> = {
  network: { short: "Can't reach Azure", text: "FocusTime can't reach Azure to read your VM's state. It keeps trying; nothing to do unless this lasts." },
  busy: { short: "Azure is busy", text: "Azure is busy and asked FocusTime to wait. It keeps trying; nothing to do." },
  sign_in: { short: "Sign in to Azure again", text: "Azure wants you to sign in again before FocusTime can read your VM. Choose Allow Azure access." },
  refused: { short: "Azure refused", text: "Azure refused to show your VM's state. If this lasts, check in the Azure portal that you can still see the VM, or tell an admin." },
  // The page couldn't reach FocusTime itself (the request for the status failed).
  app: { short: "Can't reach FocusTime", text: "FocusTime isn't answering, so it can't check your VM. It keeps trying; nothing to do unless this lasts." },
};
export const CHECKING = "Checking…";

/**
 * VM-4 and VM-6, for tests and demo verification runs only (demo.vm_fail): how the fake Azure fails a read of the VM's
 * state. VM-6 adds the 403 production got (no body, so no Azure code), a 403 asking for the sign-in again (a challenge
 * naming the token), Azure not finding the VM, and `schedule`: the state is read, the auto-shutdown read is refused.
 */
export const VM_READ_FAILS = ["network", "busy", "sign_in", "refused", "no_state", "no_code", "challenge", "not_found", "schedule"] as const;
export type VmReadFail = (typeof VM_READ_FAILS)[number];

/** "just now", "40 seconds ago", "1 minute ago", "3 minutes ago", "2 hours ago": how old the state shown is. */
export function agoText(at: string | null, nowMs: number): string | null {
  if (!at) return null;
  const s = Math.max(0, Math.round((nowMs - Date.parse(at)) / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${Math.round(s / 10) * 10} seconds ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return m === 1 ? "1 minute ago" : `${m} minutes ago`;
  const h = Math.floor(m / 60);
  return h === 1 ? "1 hour ago" : `${h} hours ago`;
}
/** Refresh every 60 s while visible, every 10 s during a transition. */
export const refreshMs = (c: VmChip) => (isTransition(c) ? 10_000 : 60_000);
/** Whether a start has reached running, or a stop deallocated (not merely stopped: that still bills). */
export const reached = (op: VmOp, p: PowerState) => (op === "start" ? p === "running" : p === "deallocated");
/** Start is offered when the VM is off. */
export const canStart = (c: VmChip) => c === "deallocated" || c === "billing" || c === "unknown";
/**
 * VM-2: Stop is offered only while Azure shows it running and nothing is under way (never while it starts or stops,
 * never when the state is unknown). "Stopped (still billing)" isn't offered a stop either: Start covers it.
 */
export const canStop = (c: VmChip) => c === "running";

// ---- Auto-shutdown (Microsoft.DevTestLab/schedules, shutdown-computevm-<vm>) ----

export type ShutdownStatus = "Enabled" | "Disabled";
/** The parts of a schedule FocusTime reads (never writes): daily time "HHMM" in the schedule's own zone, and status. */
export type Shutdown = { time: string; status: ShutdownStatus; timeZoneId: string };

export function minutesOf(hhmm: string): number | null {
  const m = /^([01]\d|2[0-3])([0-5]\d)$/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

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
 * A schedule change from before fix/vm-schedule (D475), still in account state as `vm_shutdown:<vm>`: FocusTime no
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
