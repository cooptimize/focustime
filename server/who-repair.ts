// CV-3b: the one-time repair of Who, at the first start of this build (marked done in org_settings, scope "meta"; it
// never runs again). A follow-up whose Who is its owner, a promise "to" its own author and a commitment "to" its own
// committer lose that name; nothing is deleted. Each person's rows go through their own scoped store. Only counts are
// logged (D: never names, ids or text).
import type { Owner } from "../plan/follow-who.ts";
import { FOCUSTIME, type AdminStore } from "../store/admin-store.ts";
import type { Logger } from "../log/logger.ts";

export const WHO_REPAIR_MARK = { scope: "meta", key: "who_repair_v1" } as const;

export type WhoRepairPerson = { owner: Owner; clear: (o: Owner) => Promise<{ followUps: number; promises: number }> };
export type WhoRepairResult = { ran: boolean; followUps: number; promises: number; commitments: number };

export async function whoRepair(d: { store: Pick<AdminStore, "orgRow" | "setOrg">; people: () => Promise<WhoRepairPerson[]>; commitments: () => Promise<number>; log?: Logger }): Promise<WhoRepairResult> {
  if (await d.store.orgRow(WHO_REPAIR_MARK.scope, WHO_REPAIR_MARK.key)) return { ran: false, followUps: 0, promises: 0, commitments: 0 };
  let followUps = 0;
  let promises = 0;
  for (const p of await d.people()) {
    const r = await p.clear(p.owner);
    followUps += r.followUps;
    promises += r.promises;
  }
  const commitments = await d.commitments();
  d.log?.({ source: "plan", op: "who_repair", kind: "follow_ups", count: followUps });
  d.log?.({ source: "plan", op: "who_repair", kind: "promises", count: promises });
  d.log?.({ source: "plan", op: "who_repair", kind: "commitments", count: commitments });
  // Marked only once everything ran; a failure part way runs it again at the next start (each step is idempotent).
  await d.store.setOrg({ ...WHO_REPAIR_MARK, value: { followUps, promises, commitments }, actor: FOCUSTIME, area: "organization", target: "Everyone", note: `cleared ${followUps} follow-ups, ${promises} promises, ${commitments} commitments` });
  return { ran: true, followUps, promises, commitments };
}
