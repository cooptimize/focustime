// VM-2: the automatic start before my day, run by my background ticks (server/ticks.ts) and, in the demo, by the
// demo's own tick (demo.vm_tick). Production only: the very first thing it does is ask autoStartEnvAllowed(env), before
// it reads anyone's settings, state or VM, and before any token is asked for. Anything but exactly "prod" stops it.
//
// When it is due (plan/vm-autostart.ts autoStartDue): the day is claimed once (a once-mark, so two passes or two
// server instances on one database can't both start it, and a failure isn't retried), then my confirmed VM is started
// through the same write as Start (actions/vm-actions.ts power: read the state, log the row as automatic, start,
// follow until Azure shows it running). It never stops a VM and never touches its auto-shutdown. The start uses my own
// delegated Azure access (my stored sign-in, as the VM notification's Start does); when that can't be used it leaves
// the VM off and says so once.
import type { AppConfig } from "../config/schema.ts";
import type { Logger } from "../log/logger.ts";
import { notices, type Notice } from "../plan/notify.ts";
import { autoStartDue, autoStartEnvAllowed, clock, plannedAt, shouldPause, type AutoStartState } from "../plan/vm-autostart.ts";
import type { PlanStore } from "../store/plan-store.ts";
import { localToday } from "../week/dates.ts";
import { userZone } from "../week/zone.ts";
import { AUTOSTART_KEY, power, readAutoStart, writeAutoStart, type VmContext } from "./vm-actions.ts";
import { AzureError, parseVmId } from "../sources/azure/client.ts";
import { AuthFailure } from "../sources/oauth/oauth.ts";
import { storedIdentity } from "./account.ts";
import type { ChosenVm } from "./account-types.ts";

/** The once-mark that claims a day's automatic start. */
export const AUTOSTART_MARK = "vm_autostart_day";

export type AutoStartDeps = {
  /** Where this runs (FOCUSTIME_ENV as set, untrimmed). Only exactly "prod" lets it run. */
  env: string | undefined;
  plan: PlanStore;
  config: () => Promise<AppConfig | null>;
  /** My VM context; built only once the gate passed and a start is due. */
  vm: () => Promise<VmContext>;
  now: () => Temporal.Instant;
  /** Whether VM notifications may go out now (the notifier: switch, quiet hours, PTO). */
  allows: () => boolean;
  send: (n: Notice) => Promise<void>;
  log: Logger;
};

export type AutoStartOutcome = "env" | "no_config" | "off" | "paused" | "not_due" | "claimed_elsewhere" | "no_vm" | "not_stopped" | "sign_in" | "failed" | "started";

// Azure sign-in that can't be used: consent missing or refused, signed out, expired. (Azure refusing the permission
// itself, 403, is a failure with its own reason: Allow Azure access wouldn't fix it.)
const signInKinds = new Set(["consent", "not_signed_in", "not_connected", "expired"]);

/** One pass. Returns what it did, for the log and the tests. */
export async function autoStartTick(d: AutoStartDeps): Promise<AutoStartOutcome> {
  // Production only. Nothing is read before this line.
  if (!autoStartEnvAllowed(d.env)) return "env";
  const cfg = await d.config();
  if (!cfg) return "no_config";
  const zone = userZone(cfg);
  const now = d.now();
  const today = localToday(now.toString(), zone);
  let state = await readAutoStart(d.plan);
  // A notice the notifier held back (quiet before my working hours) goes out once it may, that day only.
  if (state.notice && (state.notice.date !== today || d.allows())) {
    const n = state.notice;
    if (n.date === today) await d.send(n.kind === "started" ? notices.vmAutoStarted(n.date, n.text, n.at) : n.kind === "sign_in" ? notices.vmAutoSignIn(n.date, n.at) : notices.vmAutoFailed(n.date, n.text, n.at)).catch(() => undefined);
    state = { ...state, notice: null };
    await d.plan.setState(AUTOSTART_KEY, state);
  }
  const settings = cfg.azure.autoStart;
  if (!settings.on) return "off";
  if (!state.onSince) {
    state = { ...state, onSince: today };
    await d.plan.setState(AUTOSTART_KEY, state);
  }
  if (!state.pausedOn && shouldPause({ today, lastUseOn: state.lastUseOn, onSince: state.onSince, hours: cfg.week.hours })) {
    await writeAutoStart(d.plan, (s) => ({ ...s, pausedOn: today, pauseSeen: false }));
    d.log({ source: "azure", op: "vm_autostart", kind: "paused" });
    return "paused";
  }
  // The cheap answers first (no PTO, holiday or Azure read until the time has come).
  const base = { now, zone, hours: cfg.week.hours, settings, state };
  const first = autoStartDue({ ...base, pto: false, holiday: false, chip: null });
  if (!first.due) return first.why === "paused" ? "paused" : "not_due";
  const vc = await d.vm();
  const off = vc.daysOff ? await vc.daysOff(cfg, today, today).catch(() => null) : null;
  // PTO or holidays that can't be read: the safer reading is to leave the VM off.
  if (vc.daysOff && !off) return "not_due";
  const second = autoStartDue({ ...base, pto: !!off?.pto.has(today), holiday: !!off?.holidays.has(today), chip: null });
  if (!second.due) return "not_due";
  // Claim the day: one automatic start (or attempt) a day, whichever pass or instance gets here first.
  if (!(await d.plan.markOnce(AUTOSTART_MARK, today))) return "claimed_elsewhere";
  await writeAutoStart(d.plan, (s) => ({ ...s, attemptedOn: today }));
  const me = await storedIdentity(d.plan);
  const vm = me ? ((await d.plan.accountState<ChosenVm>(`vm:${me.oid}`)) ?? null) : null;
  if (!vm || !parseVmId(vm.id)) return "no_vm";
  const r = await power(vc, vm, "start", { auto: true }).catch((e: unknown) => ({ ok: false as const, status: 500, error: e instanceof AzureError || e instanceof AuthFailure ? e.message : "failed", code: e instanceof AzureError || e instanceof AuthFailure ? e.kind : "failed" }));
  const at = now.toString();
  if (r.ok) {
    d.log({ source: "azure", op: "vm_autostart", kind: second.late ? "started_late" : "started" });
    await notice(d, { kind: "started", date: today, at, text: `${vm.name} was started at ${clock(now, zone)}, before your day.` });
    return "started";
  }
  const code = "code" in r ? (r.code ?? "") : "";
  if (signInKinds.has(code)) {
    d.log({ source: "azure", op: "vm_autostart", kind: "sign_in" });
    await writeAutoStart(d.plan, (s) => ({ ...s, signInFailedOn: today, signInSeen: false }));
    await notice(d, { kind: "sign_in", date: today, at, text: "" });
    return "sign_in";
  }
  // Running, starting or stopping when read: nothing to do (it doesn't count as a failure).
  if (r.status === 409 && /now, so it wasn't started/.test(r.error)) return "not_stopped";
  d.log({ source: "azure", op: "vm_autostart", kind: "failed" });
  await notice(d, { kind: "failed", date: today, at, text: `${vm.name} was left off: ${r.error}.` });
  return "failed";
}

/** Sends now when the notifier allows it, else keeps it for the first pass that may (that day only). */
async function notice(d: AutoStartDeps, n: NonNullable<AutoStartState["notice"]>) {
  if (d.allows()) {
    await d.send(n.kind === "started" ? notices.vmAutoStarted(n.date, n.text, n.at) : n.kind === "sign_in" ? notices.vmAutoSignIn(n.date, n.at) : notices.vmAutoFailed(n.date, n.text, n.at)).catch(() => undefined);
    return;
  }
  await writeAutoStart(d.plan, (s) => ({ ...s, notice: n }));
}

/**
 * The idle rule (D431): the next planned automatic start today or tomorrow, so a sleeping scheduler wakes for it. Null
 * outside production or when it's off (nothing read then but the gate).
 */
export async function autoStartWake(d: Pick<AutoStartDeps, "env" | "now"> & { config: AppConfig | null }): Promise<Temporal.Instant | null> {
  if (!autoStartEnvAllowed(d.env) || !d.config?.azure.autoStart.on) return null;
  const zone = userZone(d.config);
  const now = d.now();
  const today = now.toZonedDateTimeISO(zone).toPlainDate();
  for (const date of [today, today.add({ days: 1 })]) {
    const at = plannedAt(d.config.week.hours, date.toString(), zone, d.config.azure.autoStart.minutes);
    if (at && Temporal.Instant.compare(at, now) > 0) return at;
  }
  return null;
}

/** HK-3's real use, once a day per person: pausing counts working days from here. */
export async function recordUse(plan: PlanStore, today: string): Promise<void> {
  const s = await readAutoStart(plan);
  if (s.lastUseOn === today) return;
  await plan.setState(AUTOSTART_KEY, { ...s, lastUseOn: today });
}

