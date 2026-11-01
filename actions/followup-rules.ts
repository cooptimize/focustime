// Runs the follow-up rules (plan/followups.ts) against the plan store (step 7): on week.load with fresh DevOps results and on
// closeout.load with what is already in memory. Local only; nothing is posted or written anywhere else.
import type { AppConfig } from "../config/schema.ts";
import { detectFollowUps, reviewHeadsUps, type DetectInput, type WorkState } from "../plan/followups.ts";
import type { FollowUp, PlanStore } from "../store/plan-store.ts";
import { INTERNAL_CLIENT } from "../week/follow.ts";
import { hoursOn } from "../week/hours.ts";
import type { IsoDate } from "../week/types.ts";
import { dueState } from "../plan/due.ts";
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

/** What the rules read from the plan store. */
export function ruleInput(plan: PlanStore, o: RuleOptions): DetectInput {
  const t = Temporal.PlainDate.from(o.today);
  const picks = plan.picksBetween(t.subtract({ days: RULE_WINDOW_DAYS }).toString(), t.add({ days: RULE_WINDOW_DAYS }).toString());
  return {
    today: o.today,
    picks,
    pick: (id) => plan.getPick(id),
    committedAt: (d) => plan.day(d)?.committedAt ?? null,
    movedTo: (id) => plan.movedTo(id),
    work: o.work,
    followUps: plan.allFollowUps(),
    internal: o.internal,
    clientName: o.clientName,
    ...(o.isWorkday ? { isWorkday: o.isWorkday } : {}),
  };
}

/** Open heads-ups that wouldn't open under the step 13.5 rule: listed, never closed automatically. */
export const reviewOpenHeadsUps = (plan: PlanStore, o: RuleOptions) => reviewHeadsUps(ruleInput(plan, o));

export function applyFollowUpRules(plan: PlanStore, o: RuleOptions): { opened: number; closed: number } {
  const r = detectFollowUps(ruleInput(plan, o));
  let opened = 0;
  for (const l of r.open) if (plan.openRuleFollowUp(l)) opened++;
  for (const u of r.update) plan.updateFollowUpDraft(u.id, u.what, u.draft, u.detail, u.origin);
  for (const c of r.close) plan.closeFollowUp(c.id, c.note, "signal");
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

export function followUpView(plan: PlanStore, l: FollowUp, today: IsoDate, clientName: (key: string) => string): FollowUpView {
  const f = l.sourceKind === "flex" && l.sourceId !== null ? plan.getFlex(l.sourceId) : null;
  const pickId = l.kind === "devops_update" ? Number(l.ruleKey?.split(":")[1]) : NaN;
  const url = Number.isInteger(pickId) ? plan.getPick(pickId)?.itemUrl ?? null : f?.itemUrl ?? null;
  const opened = l.openedAt.slice(0, 10);
  return {
    id: l.id,
    kind: l.kind,
    clientKey: l.clientKey,
    who: l.who ?? (l.clientKey ? clientName(l.clientKey) : "Someone"),
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
    dueState: l.closedAt ? null : dueState(l.due, today),
    hasWho: !!l.who || !!l.clientKey,
  };
}

/** Follow-ups newest first (Close out and the Follow-ups view). */
export const newestFirst = (a: FollowUp, b: FollowUp) => b.openedAt.localeCompare(a.openedAt) || b.id - a.id;
