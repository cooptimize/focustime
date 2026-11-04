// AP-1: the scheduler's part in Asks: the slow pass reads a chat with Read for asks on when it is due (and not more
// often), the idle rule wakes it for the next read only in working hours, and once a day the text of messages that
// didn't become asks is deleted after 14 days while asks keep theirs.
import { describe, expect, it } from "vitest";
import type { ActionContext } from "../actions/dispatch.ts";
import { setValue } from "../config/edit.ts";
import { parseConfig } from "../config/schema.ts";
import { starterToml } from "../config/starter.ts";
import type { HostMedia, HostNotifications } from "../host/types.ts";
import type { IncomingMessage } from "../plan/asks.ts";
import { createPlanStore } from "../store/plan-store.ts";
import { aChatMember, aClassifyAnswer, aMessage, anAiApp, HOME_TENANT } from "../test/builders/index.ts";
import { stubProvider } from "../ai/stub.ts";
import { IDENTITY_KEY } from "../actions/account.ts";
import type { Notice } from "../plan/notify.ts";
import { personTicks } from "./ticks.ts";

const NY = "America/New_York";
const CHAT = { chatId: "19:fabrikam@thread.v2", displayName: "Fabrikam team", webUrl: null };

async function setup(o: { urgent?: boolean; focus?: boolean; through?: boolean } = {}) {
  let at = Temporal.Instant.from("2026-11-04T15:00:00Z"); // Wednesday 10:00 in New York.
  const plan = createPlanStore({ path: ":memory:", now: () => at.toZonedDateTimeISO(NY) });
  let toml = setValue(starterToml(NY), "dataverse", "my_email", "ana@cooptimize.example");
  // AP-2: AI on for Fabrikam, and (when asked) urgent asks let through focus.
  if (o.urgent) toml = setValue(setValue(toml, "ai", "use", true), "ai", "allowed_clients", ["fabrikam"]);
  if (o.through) toml = setValue(toml, "notify", "asks_through_focus", true);
  const config = parseConfig(toml);
  if (!config.ok) throw new Error("bad test config");
  const calls: string[] = [];
  const said: (IncomingMessage & { modifiedAt: string })[] = [];
  const account = {
    chatMessages: {
      messagesSince: async (chatId: string, _k: string, since: string) => {
        calls.push(since);
        const messages = said.filter((m) => m.chatId === chatId && Date.parse(m.modifiedAt) > Date.parse(since));
        return { messages, newest: messages.map((m) => m.modifiedAt).sort().at(-1) ?? null };
      },
    },
    probe: async (kind: string) => ({ kind, state: "granted", granted: [] }),
  };
  const ctx = {
    plan,
    loadConfig: async () => ({ path: "x", parsed: config }),
    now: () => at.toString(),
    account: () => account,
    makeDataverse: () => { throw new Error("no Dataverse here"); },
    makeOutlook: () => { throw new Error("no Outlook here"); },
    makeGoogle: () => { throw new Error("no Google here"); },
    makeDevOps: () => (o.urgent ? { last: () => null, load: async () => [] } : (() => { throw new Error("no DevOps here"); })()),
    ...(o.urgent ? { ai: { app: anAiApp(), provider: async () => stubProvider({ respond: () => JSON.stringify(aClassifyAnswer({ kind: "incident", urgency: "now", title: "Portal down" })) }), appSpend: { get: async () => 0, add: async () => {} } } } : {}),
  } as unknown as ActionContext;
  const shown: Notice[] = [];
  const notifications = { show: async (n: Notice) => (shown.push(n), null), close: () => {}, line: () => {} } as unknown as HostNotifications;
  const media = { status: async () => ({ players: false, spotify: false }), transition: async () => null, open: async () => {}, endSound: () => {} } as unknown as HostMedia;
  const ticks = personTicks({ log: () => {}, now: () => at, notifications, media, openRoute: () => {} }, plan, ctx, { zone: NY });
  await plan.addDeliveryChat("fabrikam", "customer", CHAT);
  await plan.setDeliveryChatMembers(CHAT.chatId, [aChatMember({ external: true })], at.toString());
  if (o.urgent) await plan.setAccountState(IDENTITY_KEY, { oid: "00000000-0000-4000-8000-0000000000aa", tid: HOME_TENANT, name: "Ana", username: "ana@cooptimize.example", email: "ana@cooptimize.example", signedInAt: at.toString(), systemUserId: null, systemUserEmail: null });
  if (o.focus) await plan.setState("timer", { kind: "focus", pickId: null, label: "Focus", plannedMinutes: 120, elapsedMs: 0, runningSince: at.toString(), startedAt: at.toString(), ended: false, warned: [] });
  return { plan, ticks, calls, said, shown, at: (iso: string) => void (at = Temporal.Instant.from(iso)), now: () => at };
}

describe("Asks in the scheduler (AP-1)", () => {
  it("the slow pass reads a chat that is on, once per interval; the idle rule wakes it for the next read", async () => {
    const s = await setup();
    await s.ticks.slow();
    expect(s.calls).toEqual([]);
    await s.plan.setAsksOn(CHAT.chatId, true, "2026-11-04T15:00:00Z");
    s.at("2026-11-04T15:00:30Z");
    await s.ticks.slow();
    s.at("2026-11-04T15:01:00Z");
    await s.ticks.slow();
    expect(s.calls).toHaveLength(1);
    expect((await s.ticks.wake!()).toString()).toBe("2026-11-04T15:05:30Z");
    s.at("2026-11-04T15:05:30Z");
    await s.ticks.slow();
    expect(s.calls).toHaveLength(2);
  });

  it("outside working hours the idle rule doesn't wake it for a read", async () => {
    const s = await setup();
    await s.plan.setAsksOn(CHAT.chatId, true, "2026-11-04T15:00:00Z");
    s.at("2026-11-05T03:00:00Z"); // 22:00
    const wake = await s.ticks.wake!();
    expect(Temporal.Instant.compare(wake, Temporal.Instant.from("2026-11-05T04:00:00Z"))).toBeGreaterThanOrEqual(0);
    await s.ticks.slow();
    expect(s.calls).toEqual([]);
  });

  it("once a day: unmatched messages older than 14 days are deleted, asks keep their text", async () => {
    const s = await setup();
    const old = (m: Partial<IncomingMessage>) => {
      const { mentionedUserIds: _m, ...x } = aMessage({ chatId: CHAT.chatId, createdAt: "2026-10-15T15:00:00Z", ...m });
      return x;
    };
    const plain = old({ text: "Just an update" });
    const asked = old({ text: "Can you fix the export?" });
    await s.plan.addChatMessages([plain, asked]);
    await s.plan.addAsk({ chatId: CHAT.chatId, messageId: asked.messageId, clientKey: "fabrikam", rule: "phrase", ruleDetail: "can you", at: asked.createdAt });
    await s.ticks.slow();
    expect(await s.plan.chatMessage(CHAT.chatId, plain.messageId)).toBeNull();
    expect((await s.plan.chatMessage(CHAT.chatId, asked.messageId))?.text).toBe("Can you fix the export?");
    // Not again the same day: a message that turns 14 days old later today waits for tomorrow.
    const later = old({ createdAt: "2026-10-21T16:00:00Z", text: "Another update" });
    await s.plan.addChatMessages([later]);
    s.at("2026-11-04T17:00:00Z");
    await s.ticks.slow();
    expect(await s.plan.chatMessage(CHAT.chatId, later.messageId)).not.toBeNull();
    s.at("2026-11-05T15:00:00Z");
    await s.ticks.slow();
    expect(await s.plan.chatMessage(CHAT.chatId, later.messageId)).toBeNull();
  });

  it("AP-2: an ask AI sorts as needing me now sends one notification, held during focus unless let through", async () => {
    for (const [focus, through, sent] of [[false, false, true], [true, false, false], [true, true, true]] as const) {
      const s = await setup({ urgent: true, focus, through });
      await s.plan.setAsksOn(CHAT.chatId, true, "2026-11-04T15:00:00Z");
      const member = (await s.plan.deliveryChats())[0]!.members![0]!;
      s.said.push({ ...aMessage({ chatId: CHAT.chatId, authorId: member.userId, createdAt: "2026-11-04T15:00:10Z", text: "The portal is down, can you look?" }), modifiedAt: "2026-11-04T15:00:10Z" });
      s.at("2026-11-04T15:00:30Z");
      await s.ticks.slow();
      s.at("2026-11-04T15:06:00Z");
      await s.ticks.slow();
      const asks = s.shown.filter((n) => n.kind === "asks");
      expect(asks.map((n) => n.title)).toEqual(sent ? ["Urgent ask from fabrikam"] : []);
    }
  });
});
