// Follow-ups (step 13.5): list, add, edit, Close the loop, Not needed, Snooze, Delete (only mine), Who suggestions and
// the review of heads-ups under the new rule. All local to the plan store; the only reads elsewhere are Who
// suggestions (Dataverse teammates and attendees of my own Outlook meetings in a client's domain, never stored).
import { mapSeq } from "./seq.ts";
import type { AppConfig } from "../config/schema.ts";
import { inviteDomains } from "../config/schema.ts";
import { domainAllowed, isExcluded } from "../plan/collab.ts";
import { dueOrder } from "../plan/due.ts";
import type { WorkState } from "../plan/followups.ts";
import type { DataverseSource } from "../sources/dataverse/source.ts";
import type { PeopleReader } from "../sources/graph/source.ts";
import { CLOSE_HOW, PlanError, type CloseHow, type FollowUpFields, type PlanStore } from "../store/plan-store.ts";
import { INTERNAL_CLIENT } from "../week/follow.ts";
import type { IsoDate } from "../week/types.ts";
import { followUpView, internalClients, nameOf, reviewOpenHeadsUps, workdayOf } from "./followup-rules.ts";
import type { ActionResponse, FollowUpView, PeopleData, ReviewData } from "./types.ts";
import { userZone } from "../week/zone.ts";

export const FOLLOWUP_ACTIONS = ["followups.list", "followup.add", "followup.edit", "followup.close", "followup.not_needed", "followup.snooze", "followup.delete", "followup.people", "followups.review"] as const;
export type FollowUpAction = (typeof FOLLOWUP_ACTIONS)[number];

export type FollowUpContext = {
  plan: PlanStore | undefined;
  config: () => Promise<AppConfig | null>;
  dataverse?: (cfg: AppConfig) => Pick<DataverseSource, "teammates" | "myClients">;
  people?: (cfg: AppConfig) => PeopleReader | null;
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
const id = (v: unknown) => {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v <= 0) throw new Invalid("id must be a positive whole number");
  return v;
};
const text = (v: unknown, name: string, max: number, optional = false): string | null => {
  if (optional && (v === undefined || v === null)) return null;
  if (typeof v !== "string") throw new Invalid(`${name} must be text`);
  const t = v.trim();
  if (t.length > max) throw new Invalid(`${name} is at most ${max} characters`);
  return optional ? t || null : t;
};
const day = (v: unknown, name: string): IsoDate | null => {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Invalid(`${name} must be YYYY-MM-DD`);
  try {
    return Temporal.PlainDate.from(v, { overflow: "reject" }).toString();
  } catch {
    throw new Invalid(`${name} must be a real date`);
  }
};
const CHANNELS = ["teams", "email", "devops", "call"] as const;
const channel = (v: unknown): string | null => {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || !(CHANNELS as readonly string[]).includes(v)) throw new Invalid("channel must be teams, email, devops or call");
  return v;
};
const how = (v: unknown): CloseHow | null => {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || !(CLOSE_HOW as readonly string[]).includes(v)) throw new Invalid("how must be teams, email, devops or call");
  return v as CloseHow;
};

/** The editable fields of a follow-up, as given (absent stays as is). */
function editable(o: Obj): Partial<FollowUpFields> {
  const out: Partial<FollowUpFields> = {};
  if (o.clientKey !== undefined) out.clientKey = text(o.clientKey, "clientKey", 100, true);
  if (o.who !== undefined) out.who = text(o.who, "who", 100, true);
  if (o.what !== undefined) {
    const w = text(o.what, "what", 200)!;
    if (!w) throw new Invalid("Say what you owe");
    out.what = w;
  }
  if (o.channel !== undefined) out.channel = channel(o.channel);
  if (o.due !== undefined) out.due = day(o.due, "due");
  // Step 15.2: a linked DevOps item (its id), or null to unlink.
  if (o.itemId !== undefined) {
    if (o.itemId !== null && (typeof o.itemId !== "number" || !Number.isInteger(o.itemId) || o.itemId < 1)) throw new Invalid("itemId must be a positive whole number or null");
    out.itemId = o.itemId as number | null;
  }
  return out;
}

export async function followUpAction(ctx: FollowUpContext, action: FollowUpAction, input: unknown): Promise<ActionResponse> {
  const plan = ctx.plan;
  if (!plan) return bad("The local plan store isn't available", 503);
  const cfg = await ctx.config().catch(() => null);
  const tz = userZone(cfg);
  const now = Temporal.Instant.from(ctx.now());
  const today = now.toZonedDateTimeISO(tz).toPlainDate().toString();
  const name = nameOf(cfg, () => undefined);
  const view = async (f: Parameters<typeof followUpView>[1]): Promise<FollowUpView> => (await followUpView(plan, f, today, name));
  try {
    switch (action) {
      case "followups.list": {
        const o = fields(input ?? {}, [], ["includeClosed", "includeSnoozed"]);
        if (o.includeClosed !== undefined && typeof o.includeClosed !== "boolean") throw new Invalid("includeClosed must be true or false");
        (await plan.openFlexFollowUps(now));
        const open = (await plan.openFollowUps()).filter((f) => o.includeSnoozed === true || !f.snoozedUntil || f.snoozedUntil <= today);
        const closed = o.includeClosed ? (await plan.allFollowUps()).filter((l) => l.closedAt).sort((a, b) => (b.closedAt ?? "").localeCompare(a.closedAt ?? "")) : [];
        const snoozed = (await plan.openFollowUps()).filter((f) => f.snoozedUntil && f.snoozedUntil > today).length;
        return { ok: true, data: { followUps: await mapSeq([...dueOrder(open, today, (f) => f.due, (f) => f.openedAt), ...closed], view), snoozed } };
      }
      case "followup.add": {
        const o = fields(input, ["what"], ["who", "due", "clientKey", "channel", "itemId"]);
        const f = editable(o);
        if (f.itemId && !f.clientKey) throw new Invalid("A work item needs the client it belongs to");
        const added = (await plan.addFollowUp({ who: f.who ?? null, what: f.what!, due: f.due ?? null, clientKey: f.clientKey ?? null, channel: f.channel ?? null, itemId: f.itemId ?? null }));
        return { ok: true, data: { followUp: await view(added) } };
      }
      case "followup.edit": {
        const o = fields(input, ["id"], ["who", "what", "due", "clientKey", "channel", "itemId"]);
        return { ok: true, data: { followUp: await view((await plan.editFollowUp(id(o.id), editable(o)))) } };
      }
      case "followup.close": {
        const o = fields(input, ["id"], ["note", "how"]);
        const note = text(o.note, "note", 500, true);
        return { ok: true, data: { followUp: await view((await plan.closeFollowUp(id(o.id), note, "me", { how: how(o.how), outcome: "done" }))) } };
      }
      case "followup.not_needed": {
        const o = fields(input, ["id"]);
        return { ok: true, data: { followUp: await view((await plan.closeFollowUp(id(o.id), null, "me", { outcome: "not_needed" }))) } };
      }
      case "followup.snooze": {
        const o = fields(input, ["id", "until"]);
        const until = day(o.until, "until");
        if (until !== null && until <= today) throw new Invalid("Snooze until a day after today");
        return { ok: true, data: { followUp: await view((await plan.snoozeFollowUp(id(o.id), until))) } };
      }
      case "followup.delete": {
        const o = fields(input, ["id"]);
        (await plan.deleteFollowUp(id(o.id)));
        return { ok: true, data: { deleted: true } };
      }
      case "followup.people": {
        const o = fields(input ?? {}, [], ["clientKey"]);
        const clientKey = text(o.clientKey, "clientKey", 100, true);
        if (!cfg) return { ok: true, data: { teammates: [], attendees: [], problems: ["Fix the config to see suggestions"] } satisfies PeopleData };
        const exclude = cfg.collab.exclude;
        const me = cfg.dataverse.myEmail.toLowerCase();
        const problems: string[] = [];
        const dv = ctx.dataverse?.(cfg);
        const team = dv ? await dv.teammates().catch(() => null) : null;
        if (!team || !team.ok) problems.push("Cooptimizers couldn't be read from Dataverse");
        const teammates = team && team.ok ? team.people.filter((p) => p.email.toLowerCase() !== me && domainAllowed(p.email, inviteDomains(cfg)) && !isExcluded(p, exclude)).map((p) => ({ name: p.name, email: p.email.toLowerCase() })).sort((a, b) => a.name.localeCompare(b.name)) : [];
        let attendees: PeopleData["attendees"] = [];
        if (clientKey && clientKey !== INTERNAL_CLIENT) {
          const clients = dv ? await dv.myClients().catch(() => null) : null;
          const domain = clients?.find((c) => c.clientKey === clientKey)?.devopsEmail?.split("@")[1]?.toLowerCase() ?? null;
          const reader = ctx.people?.(cfg) ?? null;
          if (!domain) problems.push(`${clientKey}'s email domain isn't known, so meeting attendees aren't suggested`);
          else if (inviteDomains(cfg).includes(domain)) problems.push(`${clientKey} uses a Cooptimize address`);
          else if (!reader) problems.push("Outlook isn't set up, so meeting attendees aren't suggested");
          else {
            try {
              const start = now.subtract({ hours: 24 * 60 }).toString();
              const end = now.add({ hours: 24 * 14 }).toString();
              attendees = (await reader.attendees(domain, start, end)).filter((p) => !isExcluded(p, exclude));
            } catch {
              problems.push("Outlook didn't answer, so meeting attendees aren't suggested");
            }
          }
        }
        return { ok: true, data: { teammates, attendees, problems } satisfies PeopleData };
      }
      case "followups.review": {
        fields(input ?? {}, []);
        const work: WorkState[] | null = null;
        const list = (await reviewOpenHeadsUps(plan, { today, work, internal: internalClients(cfg), clientName: name, isWorkday: workdayOf(cfg) }));
        return { ok: true, data: { headsUps: await mapSeq(list, async (r) => ({ id: r.id, what: (await plan.getFollowUp(r.id))?.what ?? "", reason: r.reason })) } satisfies ReviewData };
      }
    }
  } catch (e) {
    if (e instanceof Invalid) return bad(e.message);
    if (e instanceof PlanError) return bad(e.message, /^No /.test(e.message) ? 404 : 409);
    throw e;
  }
}
