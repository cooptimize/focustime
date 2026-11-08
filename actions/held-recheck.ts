// GD-3: every held message checked again under GD-2's rules: whole words, client names and aliases only (Match only as
// written applies), never item ids or numbers. Each goes through the normal pipeline, which holds a real mention in a
// client-facing chat (recording what matched), sorts the rest (Flex tier) and sorts everything in an internal chat.
// Runs once per deploy marker at startup, and for one client when an admin edits its names. Reads only stored messages,
// never Teams. Idempotent: what is released is no longer held, and a real mention is only placed again.
// Logs counts only, never a name, an id or text.
import type { AdminStore } from "../store/admin-store.ts";
import { FOCUSTIME } from "../store/admin-store.ts";
import type { ClientEntry } from "../ai/guard.ts";
import { HELD_REASONS, type MessagePlace } from "../plan/conversations.ts";
import { chatAudience } from "../plan/boundary.ts";
import { tokenOrder, type ClientChat, type TeamsMessage } from "../plan/requests.ts";
import { mapSeq } from "./seq.ts";
import { runPipeline } from "./conversations-pipeline.ts";
import { peopleOnce, pipelineDepsOf, type PollDeps, type PollPerson } from "./request-poll.ts";

export const HELD_RECHECK_MARK = { scope: "meta", key: "held_recheck_v1" } as const;

export type RecheckCounts = {
  /** Held messages looked at, by audience and stored reason ("client_facing:other_client"). */
  before: Record<string, number>;
  released: number;
  stillHeld: number;
  /** In chats with reading off, or whose stored message has gone: left as they are. */
  skipped: number;
  /** In chats whose boundary couldn't be read: left held, tried again at the next start. */
  unresolved: number;
};

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** The union of what the chat's followers know of other clients, so a client one of them follows still matches. */
export function mergeDirectories(all: readonly ClientEntry[]): ClientEntry[] {
  const byKey = new Map<string, ClientEntry>();
  const set = <T,>(a: readonly T[] | undefined, b: readonly T[] | undefined) => [...new Set([...(a ?? []), ...(b ?? [])])];
  for (const c of all) {
    const k = c.key.toLowerCase();
    const had = byKey.get(k);
    byKey.set(k, had ? { ...had, names: set(had.names, c.names), aliases: set(had.aliases, c.aliases), projects: set(had.projects, c.projects), itemIds: set(had.itemIds, c.itemIds), ...(had.exactCase || c.exactCase ? { exactCase: true } : {}) } : c);
  }
  return [...byKey.values()];
}

/**
 * One pass. `clientKey`: only the held messages that concern this client: those in its own chats and those matched
 * against it (an admin edited its names).
 */
export async function recheckHeld(deps: PollDeps, o: { clientKey?: string } = {}): Promise<RecheckCounts> {
  const out: RecheckCounts = { before: {}, released: 0, stillHeld: 0, skipped: 0, unresolved: 0 };
  const convs = deps.conversations;
  if (!convs) return out;
  const now = deps.now();
  const users = await deps.users();
  const person = peopleOnce(deps);
  const home = await deps.homeTenant();
  const rules = deps.audienceRules ? await deps.audienceRules(home).catch(() => null) : null;
  const key = o.clientKey;
  const concerns = (c: ClientChat, p: MessagePlace) => !key || same(c.clientKey, key) || !!p.matched?.some((m) => same(m.key, key));

  await mapSeq(await deps.teams.chats(), async (chat) => {
    const places = (await convs.placesByRole([chat.chatId], "unsorted")).filter((p) => HELD_REASONS.has(p.reason ?? "") && concerns(chat, p));
    if (!places.length) return;
    const audience = chatAudience(chat.members, rules ?? { homeTenant: home, automation: [], domains: [] });
    for (const p of places) {
      const k = `${audience}:${p.reason}`;
      out.before[k] = (out.before[k] ?? 0) + 1;
    }
    // D523: a chat with reading off isn't worked on; its messages stay as they are until they expire.
    if (!chat.readOn) {
      out.skipped += places.length;
      return;
    }
    try {
      const known: { p: PollPerson & { config: NonNullable<PollPerson["config"]> }; b: { internal: boolean; directory: ClientEntry[] } }[] = [];
      for (const uid of tokenOrder(chat, users)) {
        const p = await person(uid);
        const b = p?.config && p.boundary ? await p.boundary(chat.clientKey).catch(() => null) : null;
        if (p?.config && b) known.push({ p: p as PollPerson & { config: NonNullable<PollPerson["config"]> }, b });
      }
      const internal = known.some((k) => k.b.internal);
      const directory = mergeDirectories(known.flatMap((k) => k.b.directory));
      // Never release a message on no knowledge: with nothing to match against, every message would look clean.
      if (!known.length || (!internal && audience !== "internal" && !directory.length)) {
        out.unresolved += places.length;
        return;
      }
      const ms: TeamsMessage[] = (await mapSeq(places, (p) => deps.teams.message(p.chatId, p.messageId))).filter((m): m is TeamsMessage => !!m);
      out.skipped += places.length - ms.length;
      if (!ms.length) return;
      const { p } = known[0]!;
      const ai = p.pipelineAi ? await p.pipelineAi().catch(() => null) : null;
      const items = await p.openItems(p.config, chat.clientKey).catch(() => null);
      await runPipeline(pipelineDepsOf(deps, convs, chat, { p, config: p.config, ai, items, home, users, person, now, boundary: { audience, directory, internal } }), chat, ms);
      for (const m of ms) {
        const after = await convs.placeOf(chat.chatId, m.messageId);
        if (after?.role === "unsorted" && HELD_REASONS.has(after.reason ?? "")) out.stillHeld++;
        else out.released++;
      }
    } catch {
      out.unresolved += places.length;
    }
  });
  logCounts(deps, out, key ? "client" : "all");
  return out;
}

function logCounts(deps: Pick<PollDeps, "log">, c: RecheckCounts, scope: "all" | "client") {
  for (const [k, count] of Object.entries(c.before)) deps.log({ source: "plan", op: "held_recheck", kind: `${scope}:before:${k}`, count });
  for (const [k, count] of [["released", c.released], ["still_held", c.stillHeld], ["skipped", c.skipped], ["unresolved", c.unresolved]] as const) deps.log({ source: "plan", op: "held_recheck", kind: `${scope}:${k}`, count });
}

export type HeldRecheckResult = { ran: boolean; counts: RecheckCounts | null };

/**
 * The one-time re-check at the first start of this build (marked in org_settings, scope "meta"). Marked only when every
 * chat could be worked out; otherwise the next start runs it again, which is safe (see the header).
 */
export async function heldRecheckOnce(d: { store: Pick<AdminStore, "orgRow" | "setOrg">; run: () => Promise<RecheckCounts>; log: PollDeps["log"] }): Promise<HeldRecheckResult> {
  if (await d.store.orgRow(HELD_RECHECK_MARK.scope, HELD_RECHECK_MARK.key)) return { ran: false, counts: null };
  const counts = await d.run();
  if (counts.unresolved === 0) {
    const held = Object.values(counts.before).reduce((a, b) => a + b, 0);
    await d.store.setOrg({ ...HELD_RECHECK_MARK, value: { ...counts }, actor: FOCUSTIME, area: "organization", target: "Everyone", note: `re-checked ${held} held messages: ${counts.released} released, ${counts.stillHeld} still held` });
  }
  d.log({ source: "plan", op: "held_recheck", kind: counts.unresolved ? "incomplete" : "done", count: counts.unresolved });
  return { ran: true, counts };
}
