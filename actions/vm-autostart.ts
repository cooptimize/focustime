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
import { autoStartDue, autoStartEnvAllowed, clock, NOTE_TEXT, OUTCOMES, outcomeText, outcomeToday, pauseBase, plannedAt, ptoFromEarlier, shouldPause, type OutcomeNote, type OutcomeReason, type PendingNotice } from "../plan/vm-autostart.ts";
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

/**
 * What one pass did, for the log and the tests. VM-3: every outcome from the planned time on is one of OUTCOMES
 * (plan/vm-autostart.ts); "env", "no_config", "off" and "not_due" (before the planned time, or settled earlier today)
 * are the passes that decide nothing new.
 */
export type AutoStartOutcome = "env" | "no_config" | "off" | "not_due" | "claimed_elsewhere" | OutcomeReason;

// Azure sign-in that can't be used: consent missing or refused, signed out, expired. (Azure refusing the permission
// itself, 403, is a refusal with its own reason: Allow Azure access wouldn't fix it.)
const signInKinds = new Set(["consent", "not_signed_in", "not_connected", "expired"]);

/** What VM-2's callers and tests know a pass by; the reasons themselves are in the state and the log (VM-3). */
export type AutoStartResult = "env" | "no_config" | "off" | "paused" | "not_due" | "claimed_elsewhere" | "no_vm" | "not_stopped" | "sign_in" | "failed" | "started";
const LEGACY: Record<AutoStartOutcome, AutoStartResult> = {
  env: "env", no_config: "no_config", off: "off", not_due: "not_due", claimed_elsewhere: "claimed_elsewhere", paused: "paused", no_vm: "no_vm", sign_in: "sign_in",
  started: "started", started_late: "started", already_on: "not_stopped", refused: "failed",
  not_chosen: "not_due", skipped: "not_due", pto: "not_due", holiday: "not_due", pto_unreadable: "not_due", not_running: "not_due",
};

/** One pass, by VM-2's words. */
export async function autoStartTick(d: AutoStartDeps): Promise<AutoStartResult> {
  return LEGACY[await autoStartCheck(d)];
}

/** One pass. Returns what it did: one of OUTCOMES' reasons from the planned time on, else why nothing new happened. */
export async function autoStartCheck(d: AutoStartDeps): Promise<AutoStartOutcome> {
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
    if (n.date === today) await d.send(noticeOf(n)).catch(() => undefined);
    // Each write re-reads the state (writeAutoStart), so a Skip or a use recorded meanwhile isn't lost.
    state = await writeAutoStart(d.plan, (s) => ({ ...s, notice: null }));
  }
  const settings = cfg.azure.autoStart;
  if (!settings.on) {
    // Off: turning it on again starts afresh (no old pause, the 3 days counted from then).
    if (state.onSince || state.pausedOn) await writeAutoStart(d.plan, (s) => ({ ...s, onSince: null, pausedOn: null, pauseSeen: false }));
    return "off";
  }
  if (!state.onSince) state = await writeAutoStart(d.plan, (s) => ({ ...s, onSince: today }));
  if (!state.pausedOn && shouldPause({ today, lastUseOn: state.lastUseOn, onSince: state.onSince, hours: cfg.week.hours })) {
    // Only then the PTO and holidays since (they don't count as days without FocusTime). Unreadable: no pause now.
    const base = pauseBase(state.lastUseOn, state.onSince)!;
    const vc = await d.vm();
    const off = vc.daysOff ? await vc.daysOff(cfg, base, today).catch(() => null) : { pto: new Set<string>(), holidays: new Set<string>() };
    if (off?.pto && off.holidays && shouldPause({ today, lastUseOn: state.lastUseOn, onSince: state.onSince, hours: cfg.week.hours, off: new Set([...off.pto, ...off.holidays]) })) {
      await writeAutoStart(d.plan, (s) => ({ ...s, pausedOn: today, pauseSeen: false }));
      await logOnce(d, today, "paused");
      return "paused";
    }
  }
  // Today settled already (any outcome but unreadable PTO, which is looked at again until the late limit): nothing new.
  const settledToday = outcomeToday(state, today);
  if (settledToday && settledToday.reason !== "pto_unreadable") return "not_due";
  // The cheap answers first (no PTO, holiday or Azure read until the time has come).
  const base = { now, zone, hours: cfg.week.hours, settings, state };
  const first = autoStartDue({ ...base, pto: false, holiday: false, chip: null });
  if (!first.due) {
    switch (first.why) {
      case "paused":
        await logOnce(d, today, "paused");
        return "paused";
      case "not_chosen":
      case "skipped": {
        // My own choice: logged once from the planned time on, never told.
        const at = plannedAt(cfg.week.hours, today, zone, settings.minutes);
        if (!at || Temporal.Instant.compare(now, at) < 0) return "not_due";
        await settle(d, today, now, first.why, []);
        return first.why;
      }
      case "too_late": {
        // The late limit passed with nothing tried: PTO or a holiday if that's what it was, else FocusTime wasn't running.
        if (settledToday) return "not_due";
        const vc = await d.vm();
        const off = await daysOffToday(vc, cfg, today);
        const why: OutcomeReason = off.pto?.has(today) ? "pto" : off.holidays?.has(today) ? "holiday" : "not_running";
        await settle(d, today, now, why, []);
        return why;
      }
      default:
        // Before the planned time, a day without working hours, or already tried: nothing to say.
        return "not_due";
    }
  }
  const vc = await d.vm();
  const off = await daysOffToday(vc, cfg, today);
  const notes: OutcomeNote[] = [];
  let pto: boolean;
  if (off.pto) {
    pto = off.pto.has(today);
    await writeAutoStart(d.plan, (s) => ({ ...s, ptoRead: { at: now.toString(), from: today, to: today, days: pto ? [today] : [] } }));
  } else {
    // PTO that can't be read fresh: the last read for today, if it is at most 24 hours old, and say so; else left off.
    const earlier = ptoFromEarlier(state.ptoRead, today, now);
    if (!earlier) {
      // Told once (the first time), looked at again on later passes until the late limit.
      if (!settledToday) await settle(d, today, now, "pto_unreadable", []);
      return "pto_unreadable";
    }
    pto = earlier.off;
    notes.push("pto_earlier");
  }
  // Holidays that can't be read don't stop it: it starts and says once that they couldn't be checked.
  if (!off.holidays) notes.push("holidays_unchecked");
  const holiday = !!off.holidays?.has(today);
  if (pto || holiday) {
    await settle(d, today, now, pto ? "pto" : "holiday", notes.filter((n) => n === "pto_earlier"));
    return pto ? "pto" : "holiday";
  }
  const second = autoStartDue({ ...base, pto, holiday, chip: null });
  if (!second.due) return "not_due";
  // Claim the day: one automatic start (or attempt) a day, whichever pass or instance gets here first.
  if (!(await d.plan.markOnce(AUTOSTART_MARK, today))) return "claimed_elsewhere";
  // A Skip that landed after this pass read the state still counts.
  const fresh = await writeAutoStart(d.plan, (s) => ({ ...s, attemptedOn: today }));
  if (fresh.skipped.includes(today) || fresh.pausedOn) return "not_due";
  const me = await storedIdentity(d.plan);
  const vm = me ? ((await d.plan.accountState<ChosenVm>(`vm:${me.oid}`)) ?? null) : null;
  if (!vm || !parseVmId(vm.id)) {
    // VM-3: the try is in the write log too, as one that didn't start, with why.
    const row = await d.plan.logAzureWrite({ op: "start", vmId: vm?.id ?? "", vmName: vm?.name ?? "Your VM", before: { power: "unknown", by: "automatic" }, after: { power: "running" }, auto: true });
    await d.plan.settleAzureWrite(row.id, { status: "failed", message: NO_VM_MESSAGE });
    await settle(d, today, now, "no_vm", notes);
    return "no_vm";
  }
  const r = await power(vc, vm, "start", { auto: true }).catch((e: unknown) => ({ ok: false as const, status: 500, error: e instanceof AzureError || e instanceof AuthFailure ? e.message : "failed", code: e instanceof AzureError || e instanceof AuthFailure ? e.kind : "failed" }));
  const at = now.toString();
  if (r.ok) {
    const why = second.late ? "started_late" : "started";
    await settle(d, today, now, why, notes);
    // Azure has accepted the start; FocusTime follows it, and the write log has how it ended.
    const said = second.late ? `${vm.name} is starting: FocusTime started it at ${clock(now, zone)}, after your day began.` : `${vm.name} is starting: FocusTime started it at ${clock(now, zone)}, before your day.`;
    await notice(d, { kind: "started", date: today, at, text: [said, ...notes.map((n) => NOTE_TEXT[n])].join(" ") });
    return why;
  }
  const code = "code" in r ? (r.code ?? "") : "";
  if (signInKinds.has(code)) {
    await writeAutoStart(d.plan, (s) => ({ ...s, signInFailedOn: today, signInSeen: false }));
    await settle(d, today, now, "sign_in", notes);
    return "sign_in";
  }
  // Running, starting or stopping when read: nothing to do (not a failure; the day is used up).
  if (r.status === 409 && /now, so it wasn't started/.test(r.error)) {
    await settle(d, today, now, "already_on", []);
    return "already_on";
  }
  // Azure refused or failed: VM-2's notice ("Auto-start couldn't start your VM"), with what Azure said after the reason.
  await settle(d, today, now, "refused", notes, `${vm.name}: ${r.error}.`);
  return "refused";
}

/** VM-3: the write log's words for a try whose VM record couldn't be found. */
export const NO_VM_MESSAGE = "Not started: FocusTime couldn't find your VM. Choose it again in Settings › Accounts and connections › My VM";

/** Today's PTO and holidays; each null when it can't be read (a read that throws is both). */
async function daysOffToday(vc: VmContext, cfg: AppConfig, today: string): Promise<{ pto: ReadonlySet<string> | null; holidays: ReadonlySet<string> | null }> {
  if (!vc.daysOff) return { pto: new Set(), holidays: new Set() };
  return vc.daysOff(cfg, today, today).catch(() => ({ pto: null, holidays: null }));
}

/** The log word, once a day per reason. */
async function logOnce(d: AutoStartDeps, today: string, word: string): Promise<void> {
  const s = await readAutoStart(d.plan);
  const had = s.logged?.date === today ? s.logged.words : [];
  if (had.includes(word)) return;
  await writeAutoStart(d.plan, (x) => ({ ...x, logged: { date: today, words: [...(x.logged?.date === today ? x.logged.words : []), word] } }));
  d.log({ source: "azure", op: "vm_autostart", kind: word });
}

/**
 * VM-3: records today's outcome, logs its word once, and tells the person once when it is a reason they are told (the
 * notice waits for the notifier, as VM-2's do). A start's own notice is sent by the caller.
 */
async function settle(d: AutoStartDeps, today: string, now: Temporal.Instant, reason: OutcomeReason, notes: OutcomeNote[], detail?: string): Promise<void> {
  const before = outcomeToday(await readAutoStart(d.plan), today);
  const same = before?.reason === reason;
  if (!same) await writeAutoStart(d.plan, (s) => ({ ...s, outcome: { date: today, reason, at: now.toString(), notes, seen: false } }));
  await logOnce(d, today, OUTCOMES[reason].log);
  for (const n of notes) await logOnce(d, today, n);
  if (same || !OUTCOMES[reason].tell) return;
  const at = now.toString();
  if (reason === "sign_in") return notice(d, { kind: "sign_in", date: today, at, text: "" });
  if (reason === "refused") return notice(d, { kind: "failed", date: today, at, text: [outcomeText({ reason, notes }), detail].filter(Boolean).join(" ") });
  await notice(d, { kind: "left_off", date: today, at, text: outcomeText({ reason, notes }) });
}

const noticeOf = (n: PendingNotice) =>
  n.kind === "started" ? notices.vmAutoStarted(n.date, n.text, n.at) : n.kind === "sign_in" ? notices.vmAutoSignIn(n.date, n.at) : n.kind === "left_off" ? notices.vmAutoLeftOff(n.date, n.text, n.at) : notices.vmAutoFailed(n.date, n.text, n.at);

/** Sends now when the notifier allows it, else keeps it for the first pass that may (that day only). */
async function notice(d: AutoStartDeps, n: PendingNotice) {
  if (d.allows()) {
    await d.send(noticeOf(n)).catch(() => undefined);
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

