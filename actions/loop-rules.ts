// Runs the loop rules (plan/loops.ts) against the plan store (step 7): on week.load with fresh DevOps results and on
// closeout.load with what is already in memory. Local only; nothing is posted or written anywhere else.
import type { AppConfig } from "../config/schema.ts";
import { detectLoops, type WorkState } from "../plan/loops.ts";
import type { Loop, PlanStore } from "../store/plan-store.ts";
import { INTERNAL_CLIENT } from "../week/follow.ts";
import type { IsoDate } from "../week/types.ts";
import type { LoopView } from "./types.ts";

/** How far around today the rules look at picks. */
export const RULE_WINDOW_DAYS = 14;

/** Clients a heads-up isn't owed to: Cooptimize and the standing-block clients. */
export function internalClients(cfg: AppConfig | null): Set<string> {
  return new Set([INTERNAL_CLIENT, ...(cfg?.week.standingBlocks.map((b) => b.clientKey) ?? [])]);
}

export function applyLoopRules(plan: PlanStore, o: { today: IsoDate; work: readonly WorkState[] | null; internal: ReadonlySet<string>; clientName: (key: string) => string }): { opened: number; closed: number } {
  const t = Temporal.PlainDate.from(o.today);
  const picks = plan.picksBetween(t.subtract({ days: RULE_WINDOW_DAYS }).toString(), t.add({ days: RULE_WINDOW_DAYS }).toString());
  const r = detectLoops({
    today: o.today,
    picks,
    pick: (id) => plan.getPick(id),
    committedAt: (d) => plan.day(d)?.committedAt ?? null,
    movedTo: (id) => plan.movedTo(id),
    work: o.work,
    loops: plan.allLoops(),
    internal: o.internal,
    clientName: o.clientName,
  });
  let opened = 0;
  for (const l of r.open) if (plan.openRuleLoop(l)) opened++;
  for (const u of r.update) plan.updateLoopDraft(u.id, u.what, u.draft, u.detail);
  for (const c of r.close) plan.closeLoop(c.id, c.note, "signal");
  return { opened, closed: r.close.length };
}

/** A client's display name: its config name, else what the caller knows (Dataverse), else its key. */
export const nameOf = (cfg: AppConfig | null, known: (key: string) => string | undefined) => (key: string) => cfg?.clientSettings?.[key]?.name || known(key) || key;

export function loopView(plan: PlanStore, l: Loop, today: IsoDate, clientName: (key: string) => string): LoopView {
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
  };
}

/** Loops newest first (Close out and the Loops view). */
export const newestFirst = (a: Loop, b: Loop) => b.openedAt.localeCompare(a.openedAt) || b.id - a.id;
