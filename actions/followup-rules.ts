// Runs the follow-up rules (plan/followups.ts) against the plan store (step 7): on week.load with fresh DevOps results and on
// closeout.load with what is already in memory. Local only; nothing is posted or written anywhere else.
import type { Pick } from "../plan/types.ts";
import type { AppConfig } from "../config/schema.ts";
import { detectFollowUps, reviewHeadsUps, type DetectInput, type WorkState } from "../plan/followups.ts";
import type { FollowUp, PlanStore } from "../store/plan-store.ts";
import { INTERNAL_CLIENT } from "../week/follow.ts";
import { hoursOn } from "../week/hours.ts";
import type { IsoDate } from "../week/types.ts";
import { dueState, promiseDueState } from "../plan/due.ts";
import type { FollowUpView } from "./types.ts";

/** How far around today the rules look at picks. */
export const RULE_WINDOW_DAYS = 14;

/** Clients a heads-up isn't owed to: Cooptimize and the standing-block clients. */
export function internalClients(cfg: AppConfig | null): Set<string> {
  return new Set([INTERNAL_CLIENT, ...(cfg?.week.standingBlocks.map((b) => b.clientKey) ?? [])]);
}

/** Workdays for the blocker re-nudge (Q43): days with working hours in config; Mon to Fri without a config. */
export const workdayOf = (cfg: AppConfig | null) => (cfg ? (d: IsoDate) => hoursOn(cfg.week.hours, d).segments.length > 0 : undefined);

type RuleOptions = { today: IsoDate; work: readonly WorkState[] | null; internal: ReadonlySet<string>; clientName: (key: string) => string; isWorkday?: ((d: IsoDate) => boolean) | undefined };

/** How many moves the rules follow from a pick (plan/followups.ts fateOf). */
const MAX_HOPS = 20;

/**
 * What the rules read from the plan store. The rules are plain functions that look picks up by id; A3 reads every pick
 * they can ask for first (the window's picks, the picks slip and DevOps follow-ups name, and where moved ones went).
 */
export async function ruleInput(plan: PlanStore, o: RuleOptions): Promise<DetectInput> {
  const t = Temporal.PlainDate.from(o.today);
  const picks = await plan.picksBetween(t.subtract({ days: RULE_WINDOW_DAYS }).toString(), t.add({ days: RULE_WINDOW_DAYS }).toString());
  const followUps = await plan.allFollowUps();
  const byId = new Map(picks.map((p) => [p.id, p]));
  const named = followUps.flatMap((l) => [...(l.detail?.picks ?? []), ...(l.kind === "devops_update" ? [Number(l.ruleKey?.split(":")[1])] : [])]).filter((id) => Number.isInteger(id) && !byId.has(id));
  for (const p of await plan.picksByIds([...new Set(named)])) byId.set(p.id, p);
  // Where moved picks went: the latest pick carried from each, followed as far as the rules look.
  const next = new Map<number, Pick>();
  let ask = [...byId.values()].filter((p) => p.status === "moved").map((p) => p.id);
  for (let hop = 0; hop < MAX_HOPS && ask.length; hop++) {
    const found = await plan.picksCarriedFrom(ask);
    for (const p of found) {
      byId.set(p.id, p);
      if (p.carriedFrom !== null) next.set(p.carriedFrom, p);
    }
    ask = found.filter((p) => p.status === "moved" && !next.has(p.id)).map((p) => p.id);
  }
  return {
    today: o.today,
    picks,
    pick: (id) => byId.get(id) ?? null,
    movedTo: (id) => next.get(id) ?? null,
    work: o.work,
    followUps,
    internal: o.internal,
    clientName: o.clientName,
    ...(o.isWorkday ? { isWorkday: o.isWorkday } : {}),
  };
}

/** Open heads-ups that wouldn't open under the step 13.5 rule: listed, never closed automatically. */
export const reviewOpenHeadsUps = async (plan: PlanStore, o: RuleOptions) => reviewHeadsUps((await ruleInput(plan, o)));

export async function applyFollowUpRules(plan: PlanStore, o: RuleOptions): Promise<{ opened: number; closed: number }> {
  const r = detectFollowUps((await ruleInput(plan, o)));
  let opened = 0;
  for (const l of r.open) if ((await plan.openRuleFollowUp(l))) opened++;
  for (const u of r.update) (await plan.updateFollowUpDraft(u.id, u.what, u.draft, u.detail, u.origin));
  for (const c of r.close) (await plan.closeFollowUp(c.id, c.note, "signal"));
  return { opened, closed: r.close.length };
}

/** Older heads-ups had no origin: say what is known (the day it was about and when it opened). */
function originFromDetail(l: FollowUp): FollowUpView["origin"] {
  if (l.kind !== "slip") return null;
  const d = (l.detail as { date?: string } | null)?.date;
  return { trigger: d ? `Work slipped from ${Temporal.PlainDate.from(d).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" })}` : "Work moved out of the week", items: [], at: l.openedAt };
}

/** A client's display name: its config name, else what the caller knows (Dataverse), else its key. */
export const nameOf = (cfg: AppConfig | null, known: (key: string) => string | undefined) => (key: string) => cfg?.clientSettings?.[key]?.name || known(key) || key;

export async function followUpView(plan: PlanStore, l: FollowUp, today: IsoDate, clientName: (key: string) => string): Promise<FollowUpView> {
  const f = l.sourceKind === "flex" && l.sourceId !== null ? (await plan.getFlex(l.sourceId)) : null;
  const pickId = l.kind === "devops_update" ? Number(l.ruleKey?.split(":")[1]) : NaN;
  const url = Number.isInteger(pickId) ? (await plan.getPick(pickId))?.itemUrl ?? null : f?.itemUrl ?? null;
  const opened = l.openedAt.slice(0, 10);
  return {
    id: l.id,
    kind: l.kind,
    clientKey: l.clientKey,
    who: l.who ?? (l.clientKey ? clientName(l.clientKey) : "Someone"),
    whoRef: l.who ? l.whoRef : null,
    what: l.what,
    channel: l.channel,
    due: l.due,
    itemId: l.itemId,
    itemUrl: url,
    draft: l.draft,
    openedAt: l.openedAt,
    isNew: opened === today,
    closedAt: l.closedAt,
    closeNote: l.closeNote,
    closedBy: l.closedBy,
    session: f ? { start: f.start, end: f.end } : null,
    outcome: l.outcome,
    closeHow: l.closeHow,
    snoozedUntil: l.snoozedUntil,
    origin: l.origin ?? originFromDetail(l),
    byHand: l.byHand,
    clientName: l.clientKey ? clientName(l.clientKey) : null,
    // CV-2: a follow-up made from a promise is amber past due ("Was due Wed, Nov 4"), never red.
    dueState: l.closedAt ? null : l.sourceKind === "promise" ? promiseDueState(l.due, today) : dueState(l.due, today),
    hasWho: !!l.who || !!l.clientKey,
  };
}

/** Follow-ups newest first (Close out and the Follow-ups view). */
export const newestFirst = (a: FollowUp, b: FollowUp) => b.openedAt.localeCompare(a.openedAt) || b.id - a.id;
