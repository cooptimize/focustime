// Part 0: the one-time move to shared owners, run once by the scheduler (claimed in job_claims, kept out of its purge).
// Each conversation goes by plan/ownership.ts's backfillOutcome, and only an unclaimed one is ever written, so a claim
// made meanwhile stands. Logs counts only, never a conversation, chat or person.
import { batchOf } from "./conversations-pipeline.ts";
import { isExternal } from "../plan/chats.ts";
import { backfillOutcome } from "../plan/ownership.ts";
import type { Logger } from "../log/logger.ts";
import type { ConversationStore } from "../store/conversation-store.ts";
import { claimPeriod, finishPeriod, releasePeriod } from "../store/retention.ts";
import type { Conn } from "../store/sql/conn.ts";
import type { TeamsStore } from "../store/teams-store.ts";

const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

export const OWNERSHIP_BACKFILL_JOB = "conversation_ownership_backfill";
const PERIOD = "once";

export type BackfillCounts = { owned: number; closed: number; open_in_progress: number; open_needs_you: number; open_no_teammate: number; already_claimed: number };

/** Goes through every conversation once; the counts. */
export async function backfillOwnership(d: { convs: ConversationStore; teams: TeamsStore; homeTenant: string | null }): Promise<BackfillCounts> {
  const out: BackfillCounts = { owned: 0, closed: 0, open_in_progress: 0, open_needs_you: 0, open_no_teammate: 0, already_claimed: 0 };
  for (const c of await d.convs.allConversations()) {
    if (c.claimedBy && !c.closedAt) {
      out.already_claimed++;
      continue;
    }
    const open = (await d.convs.commitmentsIn([c.id])).filter((k) => k.state === "open" && k.whoId).map((k) => k.whoId!);
    const chat = await d.teams.chat(c.chatId);
    let lastInternalSpeaker: string | null = null;
    const mentioned = new Set<string>();
    for (const p of (await d.convs.placesIn([c.id])).filter((x) => x.role === "work")) {
      const m = await d.teams.message(p.chatId, p.messageId);
      if (!m) continue;
      for (const w of m.mentions) {
        const member = w.id ? chat?.members?.find((x) => same(x.userId, w.id)) : null;
        if (member && (!d.homeTenant || !isExternal(member, d.homeTenant))) mentioned.add(w.id!);
      }
      if (m.senderId && !batchOf(m, chat ?? { members: null }, d.homeTenant).external) lastInternalSpeaker = m.senderId;
    }
    const r = backfillOutcome(c, { openCommitters: open, lastInternalSpeaker, mentioned: [...mentioned] });
    if (r.kind === "closed") out.closed++;
    else if (r.kind === "open") out[`open_${r.why}`]++;
    else if (await d.convs.backfillOwner(c.id, r.owner)) out.owned++;
    else out.already_claimed++;
  }
  return out;
}

export function ownershipBackfillJob(d: { db: Conn; convs: ConversationStore; teams: TeamsStore; homeTenant: () => Promise<string | null>; now: () => Temporal.Instant; log: Logger }) {
  let finished = false;
  return {
    name: OWNERSHIP_BACKFILL_JOB,
    async run(): Promise<void> {
      if (finished) return;
      const now = d.now();
      if (!(await claimPeriod(d.db, OWNERSHIP_BACKFILL_JOB, PERIOD, now))) {
        finished = true;
        return;
      }
      try {
        const counts = await backfillOwnership({ convs: d.convs, teams: d.teams, homeTenant: await d.homeTenant() });
        await finishPeriod(d.db, OWNERSHIP_BACKFILL_JOB, PERIOD, d.now(), counts);
        for (const [kind, count] of Object.entries(counts)) d.log({ source: "plan", op: "ownership_backfill", kind, count });
        finished = true;
      } catch {
        await releasePeriod(d.db, OWNERSHIP_BACKFILL_JOB, PERIOD).catch(() => undefined);
        d.log({ source: "plan", op: "ownership_backfill", kind: "failed" });
      }
    },
    /** Due now until it has run here (the claim says if another start already did it); then nothing. */
    wake: async (): Promise<Temporal.Instant | null> => (finished ? null : d.now()),
  };
}
