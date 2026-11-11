// My VM (step 15.4): find it by owner tag, confirm it, show its power state and its auto-shutdown time, start it and
// (VM-2) stop it. fix/vm-schedule (D475, unchanged by VM-2): FocusTime never changes a VM's auto-shutdown schedule (no
// delay, no skip, no restore); the Azure client refuses anything but the reads, start and deallocate
// (sources/azure/client.ts ALLOWED). Start and Stop go through the write framework: preview, confirm, read back (the
// real power state), audit log; no undo. FocusTime stops a VM only when its person presses Stop and confirms. VM-2's
// automatic start (actions/vm-autostart.ts, production only, opted in) is the one write without a preview.
// Only for the VM the signed-in person confirmed: every call takes that VM from the store, never from the request.
import { randomUUID } from "node:crypto";
import type { AppConfig } from "../config/schema.ts";
import { hoursOn } from "../week/hours.ts";
import { localToday } from "../week/dates.ts";
import type { IsoDate } from "../week/types.ts";
import { AuthFailure } from "../sources/oauth/oauth.ts";
import { AzureError, parseVmId, sameVm, type AzureClient, type Poll, type VmRef } from "../sources/azure/client.ts";
import { canStart, canStop, chipOf, CHIP_LABEL, chipText, morningPrompt, reached, refreshMs, shutdownFrom, shutdownLabel, type PowerState, type Shutdown, type VmOp, type VmTransition } from "../plan/vm.ts";
import { autoStartEnvAllowed, autoStartStateOf, nextAutoStart, workingWeekdays, type AutoStartState } from "../plan/vm-autostart.ts";
import type { PlanStore } from "../store/plan-store.ts";
import { storedIdentity, type MicrosoftAccount } from "./account.ts";
import type { AutoStartView, ChosenVm, VmError, VmPreview, VmPreviewOp, VmStatus } from "./account-types.ts";
import type { ActionResponse } from "./types.ts";
import { userZone } from "../week/zone.ts";

export const VM_ACTIONS = ["vm.find", "vm.choose", "vm.status", "vm.preview", "vm.confirm", "vm.dismiss_prompt", "vm.log", "vm.start_now", "vm.autostart_skip", "vm.autostart_resume", "vm.autostart_seen"] as const;
export type VmAction = (typeof VM_ACTIONS)[number];

export type VmContext = {
  plan?: PlanStore;
  config: () => Promise<AppConfig | null>;
  account: MicrosoftAccount | null;
  /** An Azure client on a token provider; absent: Azure isn't available here. */
  azure: ((token: () => Promise<string>) => AzureClient) | null;
  now: () => string;
  sleep?: (ms: number) => Promise<void>;
  /** Whether a focus session runs. */
  focusRunning: () => Promise<boolean>;
  /** A workday for the morning prompt: working hours and not PTO. */
  workday: (cfg: AppConfig, date: IsoDate) => Promise<boolean>;
  /**
   * VM-2: where this runs, as the auto-start gate reads it (FOCUSTIME_ENV, raw; the demo and tests pass their own).
   * Only exactly "prod" lets the automatic start run. Absent: it never does.
   */
  autoStartEnv?: string;
  /** VM-2: my whole-day PTO and the observed holidays in a range, for the "Next:" line and the tick. Absent: none known. */
  daysOff?: (cfg: AppConfig, from: IsoDate, to: IsoDate) => Promise<{ pto: ReadonlySet<IsoDate>; holidays: ReadonlySet<IsoDate> }>;
};

export const vmKey = (oid: string) => `vm:${oid}`;
/** A schedule change from before D475 (never acted on now; store/vm-restores.ts marks it cancelled). */
export const shutdownKey = (vmId: string) => `vm_shutdown:${vmId.toLowerCase()}`;
export const PROMPT_MARKER = "vm_prompt";
/** VM-2: the auto-start's own state (plan/vm-autostart.ts AutoStartState), per person in the plan store. */
export const AUTOSTART_KEY = "vm_autostart";
export const readAutoStart = async (plan: PlanStore | undefined): Promise<AutoStartState> => autoStartStateOf(await plan?.getState<unknown>(AUTOSTART_KEY));
/** Re-reads, changes and writes the state; returns what it wrote. */
export const writeAutoStart = async (plan: PlanStore, f: (s: AutoStartState) => AutoStartState): Promise<AutoStartState> => {
  const next = f(await readAutoStart(plan));
  await plan.setState(AUTOSTART_KEY, next);
  return next;
};
/** How long a start may take before FocusTime says it timed out. */
export const POWER_TIMEOUT_MS = 15 * 60_000;
const PREVIEW_MS = 5 * 60_000;

type Held = { id: string; expiresAt: number; op: VmPreviewOp; vmId: string; before: unknown; after: unknown };

export type { ChosenVm, VmError, VmPreview, VmPreviewOp, VmStatus };

// In memory: previews (5 minutes), transitions FocusTime is following, and a short status memo so the top bar and
// Today don't both call Azure. A restart loses transitions; the log's pending rows are settled from the power state.
const previews = new Map<string, Held>();
const transitions = new Map<string, VmTransition & { entryId: number }>();
const memo = new Map<string, { at: number; power: PowerState; schedule: Shutdown | null; scheduleError: VmError | null }>();
const following = new Set<Promise<void>>();
export const clearVmState = () => (previews.clear(), transitions.clear(), memo.clear());
/** Waits for background polling to finish (tests). */
export async function settled(): Promise<void> {
  while (following.size) await Promise.all([...following]);
}

const bad = (error: string): ActionResponse => ({ ok: false, status: 400, error });
const refuse = (error: string, status = 409): ActionResponse => ({ ok: false, status, error });
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const onlyKeys = (v: unknown, keys: string[]) => v === undefined || v === null || (isObj(v) && Object.keys(v).every((k) => keys.includes(k)));

function errOf(e: unknown): VmError {
  if (e instanceof AzureError) return { kind: e.kind, message: e.message, permission: e.permission };
  if (e instanceof AuthFailure) {
    if (e.kind === "consent") return { kind: "consent", message: "FocusTime needs your OK to use Azure. Choose Allow Azure access and sign in", permission: null };
    if (e.kind === "not_connected" || e.kind === "expired") return { kind: "not_signed_in", message: "Sign in with Microsoft first", permission: null };
    return { kind: e.kind, message: e.message, permission: null };
  }
  return { kind: "failed", message: "Something went wrong talking to Azure", permission: null };
}
const errResponse = (e: unknown): ActionResponse => {
  const x = errOf(e);
  const status = x.kind === "forbidden" ? 403 : x.kind === "not_found" ? 404 : x.kind === "consent" || x.kind === "not_signed_in" ? 401 : x.kind === "network" ? 503 : 502;
  return { ok: false, status, error: x.message, code: x.kind };
};

async function chosen(ctx: VmContext): Promise<ChosenVm | null> {
  const me = (await storedIdentity(ctx.plan));
  return me ? ((await ctx.plan?.accountState<ChosenVm>(vmKey(me.oid))) ?? null) : null;
}
function client(ctx: VmContext): AzureClient {
  if (!ctx.account || !ctx.azure) throw new AzureError("not_signed_in", 0, "Sign in with Microsoft first");
  const account = ctx.account;
  return ctx.azure(() => account.armToken());
}
const refOf = (v: ChosenVm): VmRef => parseVmId(v.id)!;
const sleep = (ctx: VmContext, ms: number) => (ctx.sleep ?? ((m: number) => new Promise<void>((r) => setTimeout(r, m))))(ms);
const nowMs = (ctx: VmContext) => Temporal.Instant.from(ctx.now()).epochMilliseconds;

/** Refuses a VM ID that isn't the confirmed one (a stale window, or anything else). */
function guard(vm: ChosenVm | null, asked: unknown): ActionResponse | null {
  if (!vm) return refuse("Choose your VM first (Settings > You)");
  if (asked !== undefined && (typeof asked !== "string" || !sameVm(asked, vm.id))) return refuse("FocusTime only acts on the VM you confirmed as yours", 403);
  return null;
}

async function readSchedule(c: AzureClient, vm: ChosenVm): Promise<Shutdown | null> {
  const raw = await c.getSchedule(refOf(vm));
  return raw ? shutdownFrom(raw) : null;
}

export async function vmAction(ctx: VmContext, action: VmAction, input: unknown): Promise<ActionResponse> {
  const cfg = await ctx.config();
  const tz = userZone(cfg);
  const today = localToday(ctx.now(), tz);
  switch (action) {
    case "vm.find": {
      if (!onlyKeys(input, ["tag", "value"])) return bad("vm.find takes { tag?, value? }");
      const i = (input ?? {}) as { tag?: unknown; value?: unknown };
      if ((i.tag !== undefined && typeof i.tag !== "string") || (i.value !== undefined && typeof i.value !== "string")) return bad("tag and value are text");
      const me = (await storedIdentity(ctx.plan));
      if (!me) return refuse("Sign in with Microsoft first", 401);
      const tag = i.tag?.trim() || cfg?.azure.ownerTag || "Owner";
      // A2: by default the Owner tag holds the person's UPN; tags from before (their display name) still match.
      const given = i.value?.trim() || cfg?.azure.ownerValue || "";
      const tries = given ? [given] : [...new Set([me.username, me.name].filter((x) => !!x))];
      try {
        let value = tries[0] ?? "";
        let vms = await client(ctx).findVms(tag, value);
        for (const next of tries.slice(1)) {
          if (vms.length) break;
          value = next;
          vms = await client(ctx).findVms(tag, value);
        }
        return { ok: true, data: { tag, value, vms, chosen: (await chosen(ctx))?.id ?? null } };
      } catch (e) {
        return errResponse(e);
      }
    }
    case "vm.choose": {
      if (!isObj(input) || Object.keys(input).some((k) => k !== "vmId")) return bad("vm.choose takes { vmId } (null forgets the choice)");
      const me = (await storedIdentity(ctx.plan));
      if (!me || !ctx.plan) return refuse("Sign in with Microsoft first", 401);
      if (input.vmId === null) {
        (await ctx.plan.setAccountState(vmKey(me.oid), null));
        return { ok: true, data: { vm: null } };
      }
      const ref = parseVmId(input.vmId);
      if (!ref) return bad("That isn't a VM resource ID: /subscriptions/<id>/resourceGroups/<group>/providers/Microsoft.Compute/virtualMachines/<name>");
      try {
        // Confirms the VM exists and I can read it before keeping it.
        const info = await client(ctx).getVm(ref);
        const vm: ChosenVm = { id: parseVmId(info.id)?.id ?? ref.id, name: info.name, resourceGroup: ref.resourceGroup, subscriptionId: ref.subscriptionId, location: info.location, chosenAt: ctx.now() };
        (await ctx.plan.setAccountState(vmKey(me.oid), vm));
        memo.clear();
        return { ok: true, data: { vm } };
      } catch (e) {
        return errResponse(e);
      }
    }
    case "vm.status": {
      if (!onlyKeys(input, ["fresh"])) return bad("vm.status takes { fresh? }");
      return { ok: true, data: await status(ctx, cfg, today, isObj(input) && input.fresh === true) };
    }
    case "vm.preview": {
      if (!isObj(input) || Object.keys(input).some((k) => k !== "op" && k !== "vmId")) return bad("vm.preview takes { op, vmId? }");
      const op = input.op;
      // D475 and VM-2: start and stop (deallocate) are the only changes FocusTime makes to a VM; never its auto-shutdown.
      if (op !== "start" && op !== "deallocate") return bad("op must be start or deallocate. FocusTime only starts and stops your VM; it never changes its auto-shutdown");
      const vm = (await chosen(ctx));
      const g = guard(vm, input.vmId);
      if (g) return g;
      return preview(ctx, vm!, op);
    }
    case "vm.confirm": {
      if (!isObj(input) || Object.keys(input).some((k) => k !== "previewId") || typeof input.previewId !== "string") return bad("vm.confirm takes { previewId }");
      const held = previews.get(input.previewId);
      previews.delete(input.previewId);
      if (!held || held.expiresAt < nowMs(ctx)) return refuse("That preview expired. Look again before confirming", 410);
      const vm = (await chosen(ctx));
      // The VM must still be the confirmed one.
      const g = guard(vm, held.vmId);
      if (g) return g;
      // VM-2: the state is read again; a stop is refused unless the VM still runs (and a start unless it's still off).
      const r = await power(ctx, vm!, held.op, { recheck: true });
      // VM-2 review: a Stop I pressed today also skips today's automatic start, so it never starts the VM I just stopped.
      if (r.ok && held.op === "deallocate" && ctx.plan) await writeAutoStart(ctx.plan, (s) => ({ ...s, skipped: [...new Set([...s.skipped, today])].slice(-30) }));
      return r;
    }
    case "vm.start_now": {
      // Step 15.5 (Q87): the morning box's (or notification's) Start, at once when Settings > You says so. The box
      // names the VM and says it starts; the start is still logged and followed until Azure shows it running.
      if (!onlyKeys(input, ["vmId"])) return bad("vm.start_now takes { vmId? }");
      if (!cfg?.azure.startWithoutAsking) return { ok: false, status: 409, error: "Start asks first: Settings > Accounts and connections > My VM > Start without a preview is off", code: "ask_first" };
      const vm = (await chosen(ctx));
      const g = guard(vm, isObj(input) ? input.vmId : undefined);
      if (g) return g;
      try {
        const p = await client(ctx).power(refOf(vm!));
        const chip = chipOf(p, transitions.get(vm!.id.toLowerCase()) ?? null);
        if (!canStart(chip)) return refuse(`Your VM is ${CHIP_LABEL[chip].toLowerCase()}; there's nothing to start`);
      } catch (e) {
        return errResponse(e);
      }
      return power(ctx, vm!, "start");
    }
    case "vm.dismiss_prompt": {
      // VM-2: Day's "Not today" also skips today's automatic start.
      if (!onlyKeys(input, [])) return bad("vm.dismiss_prompt takes no input");
      (await ctx.plan?.markOnce(PROMPT_MARKER, today));
      if (ctx.plan) await writeAutoStart(ctx.plan, (s) => ({ ...s, skipped: [...new Set([...s.skipped, today])].slice(-30) }));
      return { ok: true, data: { dismissed: today } };
    }
    case "vm.autostart_skip": {
      // VM-2: Skip this one: the next planned automatic start (or a given date) doesn't happen.
      if (!onlyKeys(input, ["date"])) return bad("vm.autostart_skip takes { date? }");
      const asked = isObj(input) ? input.date : undefined;
      if (asked !== undefined && (typeof asked !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(asked) || asked < today)) return bad("date is a day from today on, YYYY-MM-DD");
      if (!ctx.plan || !cfg) return refuse("Settings aren't available", 503);
      const date = (asked as string | undefined) ?? (await autoStartView(ctx, cfg, null)).next?.date ?? null;
      if (!date) return refuse("There's no automatic start coming up to skip");
      await writeAutoStart(ctx.plan, (s) => ({ ...s, skipped: [...new Set([...s.skipped, date])].slice(-30) }));
      return { ok: true, data: { skipped: date } };
    }
    case "vm.autostart_resume": {
      // VM-2: Resume after it paused itself; counts as using FocusTime today.
      if (!onlyKeys(input, [])) return bad("vm.autostart_resume takes no input");
      if (!ctx.plan) return refuse("Settings aren't available", 503);
      await writeAutoStart(ctx.plan, (s) => ({ ...s, pausedOn: null, pauseSeen: false, lastUseOn: today }));
      return { ok: true, data: { resumed: true } };
    }
    case "vm.autostart_seen": {
      // VM-2: the once-only notices (paused, couldn't sign in) were shown.
      if (!isObj(input) || Object.keys(input).some((k) => k !== "what") || (input.what !== "paused" && input.what !== "sign_in")) return bad("vm.autostart_seen takes { what: paused | sign_in }");
      if (!ctx.plan) return refuse("Settings aren't available", 503);
      await writeAutoStart(ctx.plan, (s) => (input.what === "paused" ? { ...s, pauseSeen: true } : { ...s, signInSeen: true }));
      return { ok: true, data: { seen: input.what } };
    }
    case "vm.log": {
      if (!onlyKeys(input, [])) return bad("vm.log takes no input");
      return { ok: true, data: { entries: (await ctx.plan?.azureWriteLog(100)) ?? [] } };
    }
  }
}

async function status(ctx: VmContext, cfg: AppConfig | null, today: IsoDate, fresh: boolean): Promise<VmStatus> {
  const tz = userZone(cfg);
  const me = storedIdentity(ctx.plan);
  const vm = (await chosen(ctx));
  const base: VmStatus = {
    signedIn: !!me, vm, chip: null, label: null, text: null, power: null, transition: null, canStart: false, canStop: false, schedule: null, prompt: false, startWithoutAsking: cfg?.azure.startWithoutAsking ?? true, refreshMs: 60_000, needsConsent: false, error: null, autoStart: null,
  };
  if (!vm || !me) return base;
  const key = vm.id.toLowerCase();
  const t = nowMs(ctx);
  let m = memo.get(key);
  const live = transitions.get(key) ?? null;
  if (fresh || !m || t - m.at > (live ? 4_000 : 8_000)) {
    try {
      const c = client(ctx);
      const p = await c.power(refOf(vm));
      let schedule: Shutdown | null = null;
      let scheduleError: VmError | null = null;
      try {
        schedule = await readSchedule(c, vm);
      } catch (e) {
        scheduleError = errOf(e);
      }
      m = { at: t, power: p, schedule, scheduleError };
      memo.set(key, m);
    } catch (e) {
      const err = errOf(e);
      return { ...base, chip: "unknown", label: CHIP_LABEL.unknown, text: CHIP_LABEL.unknown, error: err, needsConsent: err.kind === "consent", refreshMs: 60_000, autoStart: cfg ? await autoStartView(ctx, cfg, null).catch(() => null) : null };
    }
  }
  if (!live) await settleOrphans(ctx, vm, m.power, t);
  const chip = chipOf(m.power, live);
  const workStart = cfg ? (hoursOn(cfg.week.hours, today).segments[0]?.start ?? null) : null;
  const wsMin = workStart ? Number(workStart.slice(0, 2)) * 60 + Number(workStart.slice(3, 5)) : null;
  const local = Temporal.Instant.from(ctx.now()).toZonedDateTimeISO(tz);
  const prompt = cfg ? morningPrompt({ chip, workday: await ctx.workday(cfg, today).catch(() => false), nowMin: local.hour * 60 + local.minute, workStartMin: wsMin, dismissed: !!(await ctx.plan?.marked(PROMPT_MARKER, today)) }) : false;
  const label = shutdownLabel(m.schedule, tz, today);
  return {
    ...base, chip, label: CHIP_LABEL[chip], text: chipText(chip, m.schedule, tz, today), power: m.power, transition: live ? { op: live.op, since: live.since } : null, canStart: canStart(chip), canStop: canStop(chip),
    schedule: m.schedule && label ? { label, time: m.schedule.time, status: m.schedule.status, timeZoneId: m.schedule.timeZoneId } : null,
    // VM-2: no schedule read and no read error means Azure has none for this VM.
    noShutdown: !m.schedule && !m.scheduleError,
    prompt, refreshMs: refreshMs(chip), error: m.scheduleError?.kind === "forbidden" ? m.scheduleError : null,
    autoStart: cfg ? await autoStartView(ctx, cfg, chip).catch(() => null) : null,
  };
}

/**
 * VM-2: the auto-start's part of the status: the "Next:" line (or production only, paused, off), the weekdays the form
 * offers, and the once-only notices. Outside production `next` is null, so the chip's menu shows no time.
 */
export async function autoStartView(ctx: VmContext, cfg: AppConfig, chip: VmStatus["chip"]): Promise<AutoStartView> {
  const tz = userZone(cfg);
  const now = Temporal.Instant.from(ctx.now());
  const today = localToday(ctx.now(), tz);
  const state = await readAutoStart(ctx.plan);
  const settings = cfg.azure.autoStart;
  const to = Temporal.PlainDate.from(today).add({ days: 13 }).toString();
  const off = settings.on && autoStartEnvAllowed(ctx.autoStartEnv) && ctx.daysOff ? await ctx.daysOff(cfg, today, to).catch(() => null) : null;
  const n = nextAutoStart({ env: ctx.autoStartEnv, now, zone: tz, hours: cfg.week.hours, settings, state, pto: (d) => !!off?.pto.has(d), holiday: (d) => !!off?.holidays.has(d), on: chip === "running" || chip === "starting" });
  const prod = autoStartEnvAllowed(ctx.autoStartEnv);
  return {
    on: settings.on,
    minutes: settings.minutes,
    offDays: [...settings.offDays],
    prodOnly: !prod,
    line: n.kind === "off" ? null : n.text,
    next: n.kind === "next" ? { date: n.date, at: n.at, short: n.short } : null,
    paused: n.kind === "paused",
    pauseNotice: prod && n.kind === "paused" && !state.pauseSeen,
    signInProblem: prod && settings.on && state.signInFailedOn === today ? { seen: state.signInSeen } : null,
    days: workingWeekdays(cfg.week.hours),
  };
}

/** Pending starts and stops from before a restart: settled from the power state Azure shows now. */
async function settleOrphans(ctx: VmContext, vm: ChosenVm, p: PowerState, t: number) {
  for (const e of (await ctx.plan?.azureWriteLog(20)) ?? []) {
    if (e.status !== "pending" || (e.op !== "start" && e.op !== "deallocate") || !sameVm(e.vmId, vm.id)) continue;
    if (reached(e.op, p)) (await ctx.plan!.settleAzureWrite(e.id, { status: "confirmed", message: `Read back: ${CHIP_LABEL[chipOf(p, null)]}`, after: { power: p } }));
    else if (t - Date.parse(e.at) > POWER_TIMEOUT_MS) (await ctx.plan!.settleAzureWrite(e.id, { status: "timed_out", message: "FocusTime stopped following this before Azure finished" }));
  }
}

async function preview(ctx: VmContext, vm: ChosenVm, op: VmOp): Promise<ActionResponse> {
  try {
    const p = await client(ctx).power(refOf(vm));
    const chip = chipOf(p, transitions.get(vm.id.toLowerCase()) ?? null);
    if (op === "start" && !canStart(chip)) return refuse(`Your VM is ${CHIP_LABEL[chip].toLowerCase()}; there's nothing to start`);
    // VM-2: Stop only while it runs; never while it starts or stops.
    if (op === "deallocate" && !canStop(chip)) return refuse(`Your VM is ${CHIP_LABEL[chip].toLowerCase()}; Stop is only for a running VM`);
    const id = randomUUID();
    const expiresAt = nowMs(ctx) + PREVIEW_MS;
    const after: PowerState = op === "start" ? "running" : "deallocated";
    previews.set(id, { id, expiresAt, op, vmId: vm.id, before: { power: p }, after: { power: after } });
    const common = { previewId: id, expiresAt: new Date(expiresAt).toISOString(), op, vm: `${vm.name} (${vm.resourceGroup})` };
    const out: VmPreview =
      op === "start"
        ? { ...common, title: "Start your VM", lines: [{ label: "State", before: CHIP_LABEL[chip], after: "Running" }], notes: ["Compute billing starts while it runs.", "FocusTime follows it until Azure shows it running."], warning: null, confirmLabel: "Start" }
        : {
            ...common, title: "Stop your VM", lines: [{ label: "State", before: CHIP_LABEL[chip], after: CHIP_LABEL.deallocated }],
            notes: [`${vm.name} is deallocated: it shuts down and stops billing for compute.`, "Its auto-shutdown isn't changed.", "FocusTime follows it until Azure shows it stopped (deallocated)."],
            warning: "Anything running or unsaved on it ends: a remote session, Coop, open programs.", confirmLabel: "Stop",
          };
    return { ok: true, data: out };
  } catch (e) {
    return errResponse(e);
  }
}

/**
 * Starts or (VM-2) stops my confirmed VM: the state read first, a log row (who, when, the state before; `auto` for the
 * automatic start), the call, then followed until Azure shows the result. `recheck`: refuse when the state no longer
 * allows it (a preview confirmed after the VM changed).
 */
export async function power(ctx: VmContext, vm: ChosenVm, op: VmOp, o: { recheck?: boolean; auto?: boolean } = {}): Promise<ActionResponse> {
  const plan = ctx.plan;
  if (!plan) return refuse("The local plan store isn't available, so there's no audit log to write to", 503);
  let c: AzureClient;
  let before: PowerState;
  try {
    c = client(ctx);
    before = await c.power(refOf(vm));
  } catch (e) {
    return errResponse(e);
  }
  const chip = chipOf(before, transitions.get(vm.id.toLowerCase()) ?? null);
  if (op === "deallocate" && !canStop(chip)) return refuse(`Your VM is ${CHIP_LABEL[chip].toLowerCase()} now, so it wasn't stopped`);
  // The automatic start only from a state Azure says is stopped (never from Unknown).
  if (op === "start" && o.auto && chip !== "deallocated" && chip !== "billing") return refuse(`Your VM is ${CHIP_LABEL[chip].toLowerCase()} now, so it wasn't started`, 409);
  if (op === "start" && (o.recheck || o.auto) && !canStart(chip)) return refuse(`Your VM is ${CHIP_LABEL[chip].toLowerCase()} now, so it wasn't started`);
  const by = o.auto ? "automatic" : ((await storedIdentity(ctx.plan))?.name ?? "you");
  const entry = (await plan.logAzureWrite({ op, vmId: vm.id, vmName: vm.name, before: { power: before, by }, after: { power: op === "start" ? "running" : "deallocated" }, auto: !!o.auto }));
  let poll: Poll | null;
  try {
    poll = op === "start" ? await c.start(refOf(vm)) : await c.deallocate(refOf(vm));
  } catch (e) {
    const x = errOf(e);
    (await plan.settleAzureWrite(entry.id, { status: x.kind === "forbidden" ? "refused" : "failed", message: x.message }));
    return errResponse(e);
  }
  const key = vm.id.toLowerCase();
  const tr = { op, since: ctx.now(), entryId: entry.id };
  transitions.set(key, tr);
  memo.delete(key);
  const p = follow(ctx, c, vm, op, poll, entry.id).finally(() => {
    if (transitions.get(key) === tr) transitions.delete(key);
    memo.delete(key);
    following.delete(p);
  });
  following.add(p);
  return { ok: true, data: { entry: (await plan.azureWrite(entry.id)), transition: { op, since: tr.since } } };
}

/** Polls the start or stop (Retry-After, else 10 s) and the power state until it gets there, fails, or times out. */
async function follow(ctx: VmContext, c: AzureClient, vm: ChosenVm, op: VmOp, poll: Poll | null, entryId: number): Promise<void> {
  const plan = ctx.plan!;
  const start = nowMs(ctx);
  let wait = Math.min(Math.max(poll?.retryAfterMs ?? 10_000, 5_000), 30_000);
  let opDone = !poll;
  for (;;) {
    await sleep(ctx, wait);
    if (!opDone && poll) {
      try {
        const r = await c.operation(poll);
        if (r.retryAfterMs) wait = Math.min(Math.max(r.retryAfterMs, 5_000), 30_000);
        if (r.status === "Failed" || r.status === "Canceled") {
          (await plan.settleAzureWrite(entryId, { status: "failed", message: `Azure says the ${op === "start" ? "start" : "stop"} ${r.status === "Failed" ? "failed" : "was canceled"}` }));
          return;
        }
        if (r.status === "Succeeded") opDone = true;
      } catch {
        /* a network blip: keep following */
      }
    }
    try {
      const p = await c.power(refOf(vm));
      if (reached(op, p)) {
        (await plan.settleAzureWrite(entryId, { status: "confirmed", message: `Read back: ${CHIP_LABEL[chipOf(p, null)]}`, after: { power: p } }));
        return;
      }
    } catch {
      /* keep following */
    }
    if (nowMs(ctx) - start >= POWER_TIMEOUT_MS) {
      (await plan.settleAzureWrite(entryId, { status: "timed_out", message: `Azure didn't show it ${op === "start" ? "running" : "stopped (deallocated)"} within 15 minutes. Check the VM in the Azure portal` }));
      return;
    }
  }
}
