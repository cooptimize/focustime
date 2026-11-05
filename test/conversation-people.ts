// CV-1 and CV-2 test helpers: each person's way into Conversations and My promises on the shared world
// (test/conversations.ts): their plan store, the shared stores, the config with Contoso and Wingtip, and leads.
import { parseConfig } from "../config/schema.ts";
import { STARTER_TOML } from "../fixtures/starter.ts";
import type { ConversationsData } from "../plan/conversation-views.ts";
import { planStoreOn } from "../store/plan-store.ts";
import { aChatMember, aWorkItem, HOME_TENANT } from "./builders/index.ts";
import { EVAN, LENA, SAM, world, ZONE } from "./conversations.ts";
import { addUsers } from "./db.ts";
import type { WorkItem } from "../week/types.ts";
import { conversationAction, type ConversationAction, type ConversationContext } from "../actions/conversation-actions.ts";
import type { CycleResult } from "../actions/request-poll.ts";
import type { AiService } from "../ai/service.ts";

export const OUTSIDER = aChatMember({ displayName: "Kim Outside" });
export const cfgText = `${STARTER_TOML.replace('client_id = ""', 'client_id = "44444444-4444-4444-8444-444444444444"').replace('my_email = ""', 'my_email = "sam@contoso.example"')}\n[clients.contoso]\nname = "Contoso Supply"\n\n[clients.wingtip]\nname = "Wingtip"\n`;
export const parsed = parseConfig(cfgText, { defaultZone: ZONE });
if (!parsed.ok) throw new Error("config");
export const cfg = parsed.config;

export type W = ReturnType<typeof world>;
const added = new WeakSet<object>();
export async function people(w: W, o: { leads?: string[]; followed?: string[]; items?: WorkItem[]; config?: typeof cfg; ai?: AiService | null; more?: Partial<ConversationContext> } = {}) {
  if (!added.has(w.conn)) await addUsers(w.conn, SAM.userId!, EVAN.userId!, LENA.userId!, OUTSIDER.userId!);
  added.add(w.conn);
  const items = o.items ?? [aWorkItem({ id: 4101, title: "Movement dashboard refresh" }), aWorkItem({ id: 4102, title: "BOM bridging", tier: "feature", level: "portfolio" })];
  const ctxOf = (who: typeof SAM): ConversationContext => ({
    plan: planStoreOn(w.conn, { now: () => Temporal.Instant.from(w.now()).toZonedDateTimeISO(ZONE), userId: who.userId! }),
    requests: { teams: w.teams, refresh: async () => ({}) as CycleResult, conversations: w.convs, users: async () => w.users },
    conversations: w.convs,
    me: async () => who.userId!,
    followed: async () => new Set(o.followed ?? ["contoso", "wingtip"]),
    config: async () => o.config ?? cfg,
    homeTenant: async () => HOME_TENANT,
    openItems: async () => items,
    writeClients: async () => ["contoso"],
    now: w.now,
    log: () => {},
    ai: async () => o.ai ?? null,
    itemDone: () => null,
    isLead: async () => (o.leads ?? []).includes(who.userId!),
    users: async () => w.users,
    pipelineAi: async () => w.ai,
    ...o.more,
  });
  const as = (who: typeof SAM) => {
    const ctx = ctxOf(who);
    const run = async <T = ConversationsData>(action: ConversationAction, input: unknown = {}): Promise<T> => {
      const r = await conversationAction(ctx, action, input);
      if (!r.ok) throw new Error(`${r.status} ${r.error}`);
      return r.data as T;
    };
    const fail = async (action: ConversationAction, input: unknown) => {
      const r = await conversationAction(ctx, action, input);
      if (r.ok) throw new Error("expected a refusal");
      return r;
    };
    return { ctx, run, fail };
  };
  return { as };
}

