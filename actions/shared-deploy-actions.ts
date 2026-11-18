// DP-3: other people on a deployment. Each action reaches a deployment only through the signed-in person's own to-do
// for it (store/plan-store.ts), so only the people on it can read or change it: not an admin, not the client's lead,
// not a teammate who isn't on it. Who can be added: Cooptimizers who use FocusTime, chosen with the shared picker;
// never a guest, an automation account or a typed address. Nothing here writes to Outlook: a hold is the person's own
// timebox for the deployment, and its event is written only through the write framework (actions/timebox-actions.ts),
// after their own preview and confirm, under their own sign-in.
import type { AppConfig } from "../config/schema.ts";
import { windowHalf, windowProblem } from "../plan/deploy.ts";
import { localOf } from "../plan/shared-deploy.ts";
import type { DeployPerson } from "../plan/shared-deploy.ts";
import { localOf as timeboxLocal } from "./timebox-actions.ts";
import { PlanError, type PlanStore } from "../store/plan-store.ts";
import { hoursOn } from "../week/hours.ts";
import { userZone } from "../week/zone.ts";
import type { ActionResponse } from "./types.ts";

export const SHARED_DEPLOY_ACTIONS = ["deploy.people", "deploy.leave", "deploy.rejoin", "deploy.delete", "deploy.restore", "deploy.hold", "deploy.hold_back", "deploy.hold_follow"] as const;
export type SharedDeployAction = (typeof SHARED_DEPLOY_ACTIONS)[number];

/** Whom a list of picker ids names: Cooptimizers who use FocusTime, with their names; or the refusal in plain words. */
export type PeopleResolver = (ids: readonly string[]) => Promise<{ ok: true; people: { id: string; name: string }[] } | { ok: false; error: string }>;

export type SharedDeployContext = {
  plan: PlanStore | undefined;
  config: () => Promise<AppConfig | null>;
  people?: PeopleResolver;
  now: () => string;
};

class Invalid extends Error {}
const bad = (error: string, status = 400): ActionResponse => ({ ok: false, status, error });
type Obj = Record<string, unknown>;
function fields(input: unknown, required: string[], optional: string[] = []): Obj {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new Invalid("input must be an object");
  const o = input as Obj;
  for (const k of Object.keys(o)) if (!required.includes(k) && !optional.includes(k)) throw new Invalid(`unknown input field ${k}`);
  for (const k of required) if (o[k] === undefined) throw new Invalid(`${k} is required`);
  return o;
}
const posId = (v: unknown, name = "id") => {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v <= 0) throw new Invalid(`${name} must be a positive whole number`);
  return v;
};
const version = (v: unknown) => (v === undefined || v === null ? null : posId(v, "version"));

/** The person ids a form sends (from the picker): at most 20, each a short id. */
export function peopleIds(v: unknown): string[] {
  if (!Array.isArray(v) || v.length > 20 || v.some((x) => typeof x !== "string" || !x.trim() || x.length > 64)) throw new Invalid("people must be a list of at most 20 person ids");
  return [...new Set((v as string[]).map((x) => x.trim().toLowerCase()))];
}

/** The people a list names, checked on the server: refused in plain words when one can't be on a deployment. */
export async function resolvePeople(r: PeopleResolver | undefined, ids: readonly string[], me: string): Promise<{ id: string; name: string }[] | string> {
  const others = ids.filter((i) => i !== me.toLowerCase());
  if (!others.length) return [];
  if (!r) return "People can't be added just now";
  const got = await r(others);
  return got.ok ? got.people : got.error;
}

const whoWas = (v: unknown): DeployPerson => {
  const o = fields(v, ["id", "name", "addedBy", "addedAt"]);
  for (const k of ["id", "name", "addedBy", "addedAt"]) if (typeof o[k] !== "string" || (o[k] as string).length > 200) throw new Invalid(`was.${k} must be text`);
  return o as unknown as DeployPerson;
};

export async function sharedDeployAction(ctx: SharedDeployContext, action: SharedDeployAction, input: unknown): Promise<ActionResponse> {
  try {
    return await run(ctx, action, input);
  } catch (e) {
    if (e instanceof Invalid) return bad(e.message);
    if (e instanceof PlanError) return bad(e.message, 409);
    throw e;
  }
}

async function run(ctx: SharedDeployContext, action: SharedDeployAction, input: unknown): Promise<ActionResponse> {
  const plan = ctx.plan;
  if (!plan) return bad("The local plan store isn't available", 503);
  const me = plan.deployPerson();
  const mine = async (id: number) => {
    const d = await plan.deploymentOf(id);
    if (!d) throw new PlanError("That deployment isn't on your plan");
    return d;
  };
  switch (action) {
    case "deploy.people": {
      // Anyone on it changes who is on it. Those added see it at once; those removed are told.
      const o = fields(input, ["id", "people"], ["version"]);
      const id = posId(o.id);
      await mine(id);
      const people = await resolvePeople(ctx.people, peopleIds(o.people), me);
      if (typeof people === "string") return bad(people, 422);
      const r = await plan.deploySetPeople(id, version(o.version), people);
      return { ok: true, data: { pick: r.pick, before: r.before.map((p) => p.id) } };
    }
    case "deploy.leave": {
      // Take me off: only me; the last one off deletes it. It is gone from my plan at once.
      const id = posId(fields(input, ["id"]).id);
      await mine(id);
      const r = await plan.deployLeave(id);
      return { ok: true, data: { deleted: r.deleted, was: r.was, others: r.others.map((p) => p.name), title: r.title } };
    }
    case "deploy.rejoin": {
      const o = fields(input, ["id", "was"]);
      const was = whoWas(o.was);
      if (was.id !== me) throw new Invalid("Only you can put yourself back");
      return { ok: true, data: { pick: await plan.deployRejoin(posId(o.id), was) } };
    }
    case "deploy.delete": {
      // Delete for everyone on it (the screen asks first and names the others).
      const id = posId(fields(input, ["id"]).id);
      await mine(id);
      const r = await plan.deployDeleteAll(id);
      return { ok: true, data: { others: r.people.filter((p) => p.id !== me).map((p) => p.name), title: r.title } };
    }
    case "deploy.restore":
      return { ok: true, data: { pick: await plan.deployRestore(posId(fields(input, ["id"]).id)) } };
    case "deploy.hold": {
      // Put on my Outlook (on: true) or take it off (on: false): my own timebox for the deployment, its title, window
      // and Busy. Nothing is written here; the screen then opens the preview, and only my confirm writes my calendar.
      const o = fields(input, ["id", "on"]);
      if (typeof o.on !== "boolean") throw new Invalid("on must be true or false");
      const id = posId(o.id);
      const d = await mine(id);
      const p = d.pick;
      if (p.status !== "planned" && p.status !== "done") throw new PlanError("This deployment isn't planned");
      const cfg = await ctx.config();
      if (!cfg) return bad("Fix the config first", 409);
      const tz = userZone(cfg);
      const hold = p.shared?.hold;
      if (hold?.timeboxId) {
        const tb = await plan.timebox(hold.timeboxId);
        if (!tb) throw new PlanError("No such hold");
        const next = await plan.updateTimebox(tb.id, { outlook: o.on, outlookNote: null });
        return { ok: true, data: { uid: next.uid, sync: true } };
      }
      if (!o.on) return { ok: true, data: { uid: null, sync: false } };
      const iso = (s: string) => Temporal.Instant.from(s).toZonedDateTimeISO(tz).toString({ timeZoneName: "never", smallestUnit: "second" });
      const l = localOf(p.shared!.startAt, p.shared!.endAt, tz);
      const end = l.clipped ? Temporal.PlainDate.from(l.date).add({ days: 1 }).toZonedDateTime({ timeZone: tz }).toInstant().toString() : p.shared!.endAt;
      const tb = await plan.addTimebox({ date: p.date, clientKey: p.clientKey, pickId: p.id, itemId: null, title: p.title, url: null, start: iso(p.shared!.startAt), end: iso(end), outlook: true, showAs: "busy" });
      return { ok: true, data: { uid: tb.uid, sync: true } };
    }
    case "deploy.hold_back": {
      // My hold was moved in Outlook while others are on it: put my hold back where the deployment is. What Outlook
      // shows becomes "what is there", so the usual preview (by my own setting) writes the deployment's time back.
      const id = posId(fields(input, ["id"]).id);
      const d = await mine(id);
      const tb = d.pick.shared?.hold.timeboxId ? await plan.timebox(d.pick.shared.hold.timeboxId) : null;
      if (!tb?.conflict) throw new PlanError("Your hold wasn't moved in Outlook");
      const own = await plan.ownEvent(tb.uid);
      if (own && tb.conflict.outlook) await plan.recordOwnEvent(tb.uid, tb.id, own.eventId, tb.conflict.outlook);
      const next = await plan.updateTimebox(tb.id, { conflict: null, outlookNote: null });
      return { ok: true, data: { uid: next.uid, sync: true } };
    }
    case "deploy.hold_follow": {
      // My hold was moved in Outlook: move the deployment there for everyone on it (my choice, never by itself).
      const id = posId(fields(input, ["id"]).id);
      const d = await mine(id);
      const tb = d.pick.shared?.hold.timeboxId ? await plan.timebox(d.pick.shared.hold.timeboxId) : null;
      const theirs = tb?.conflict?.outlook ?? null;
      if (!tb || !theirs) throw new PlanError("Your hold wasn't moved in Outlook");
      const cfg = await ctx.config();
      if (!cfg) return bad("Fix the config first", 409);
      const tz = userZone(cfg);
      const l = localOf(theirs.start, theirs.end, tz);
      const problem = l.clipped ? "A deployment's window ends on the day it starts" : windowProblem(l.window);
      if (problem) throw new PlanError(`Outlook's time can't be the deployment's: ${problem.charAt(0).toLowerCase()}${problem.slice(1)}`);
      const before = timeboxLocal(tb);
      const pick = await plan.deployFollow(id, theirs.start, theirs.end, windowHalf(hoursOn(cfg.week.hours, l.date), l.window));
      const iso = (s: string) => Temporal.Instant.from(s).toZonedDateTimeISO(tz).toString({ timeZoneName: "never", smallestUnit: "second" });
      const next = await plan.updateTimebox(tb.id, { conflict: null, outlookNote: null, date: l.date, start: iso(theirs.start), end: iso(theirs.end) });
      const own = await plan.ownEvent(tb.uid);
      if (own) await plan.recordOwnEvent(tb.uid, tb.id, own.eventId, theirs);
      await plan.logWrite({ op: "update", kind: "sync", status: "confirmed", message: "From Outlook: the deployment moved to your hold's time (chosen)", uid: tb.uid, eventId: own?.eventId ?? null, account: null, calendar: null, before: own?.fields ?? null, after: theirs, localBefore: before, localAfter: timeboxLocal(next), auto: false });
      return { ok: true, data: { pick } };
    }
  }
}
