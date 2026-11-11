// Shared polling in the scheduler (D517): the app job runs at the start of each slow pass, before anyone's ticks, and
// its next due time is part of the idle rule's wake; each person's tick sends one notification per request the AI
// sorted as needing someone now in a chat they see (held during focus unless let through); and once a day the AP-1
// per-person message rows that didn't become asks are still deleted after 14 days (until that table's safe-drop).
import { describe, expect, it } from "vitest";
import type { ActionContext } from "../actions/dispatch.ts";
import { setValue } from "../config/edit.ts";
import { parseConfig } from "../config/schema.ts";
import { starterToml } from "../config/starter.ts";
import type { HostMedia, HostNotifications } from "../host/types.ts";
import { createPlanStore, openPlanDb } from "../store/plan-store.ts";
import { sqliteConn } from "../store/sql/sqlite.ts";
import { createTeamsStore } from "../store/teams-store.ts";
import { aChatMember, aClassifyAnswer, aMessage, HOME_TENANT } from "../test/builders/index.ts";
import { IDENTITY_KEY } from "../actions/account.ts";
import type { Notice } from "../plan/notify.ts";
import { createScheduler } from "./scheduler.ts";
import { personTicks } from "./ticks.ts";
import { backgroundPolicy } from "../config/background-policy.ts";

const PRODUCTION = backgroundPolicy({ FOCUSTIME_ENV: "prod" });

const NY = "America/New_York";
const CHAT = { chatId: "19:fabrikam@thread.v2", displayName: "Fabrikam team", webUrl: null };

const ME = "00000000-0000-4000-8000-0000000000aa";

async function setup(o: { focus?: boolean; through?: boolean; member?: boolean } = {}) {
  let at = Temporal.Instant.from("2026-11-04T15:00:00Z"); // Wednesday 10:00 in New York.
  const plan = createPlanStore({ path: ":memory:", now: () => at.toZonedDateTimeISO(NY) });
  const teams = createTeamsStore(sqliteConn(openPlanDb({ path: ":memory:", now: () => at.toZonedDateTimeISO(NY) })), () => at);
  let toml = setValue(starterToml(NY), "dataverse", "my_email", "ana@cooptimize.example");
  if (o.through) toml = setValue(toml, "notify", "asks_through_focus", true);
  const config = parseConfig(toml);
  if (!config.ok) throw new Error("bad test config");
  const ctx = {
    plan,
    requests: { teams, refresh: async () => ({ polled: 0, messages: 0, updated: 0, candidates: 0, promises: 0, failures: 0 }) },
    loadConfig: async () => ({ path: "x", parsed: config }),
    now: () => at.toString(),
    makeDataverse: () => { throw new Error("no Dataverse here"); },
    makeOutlook: () => { throw new Error("no Outlook here"); },
    makeGoogle: () => { throw new Error("no Google here"); },
    makeDevOps: () => { throw new Error("no DevOps here"); },
  } as unknown as ActionContext;
  const shown: Notice[] = [];
  const notifications = { show: async (n: Notice) => (shown.push(n), null), close: () => {}, line: () => {} } as unknown as HostNotifications;
  const media = { status: async () => ({ players: false, spotify: false }), transition: async () => null, open: async () => {}, endSound: () => {} } as unknown as HostMedia;
  const ticks = personTicks({ policy: PRODUCTION, log: () => {}, now: () => at, notifications, media, openRoute: () => {} }, plan, ctx, { zone: NY });
  await plan.setAccountState(IDENTITY_KEY, { oid: ME, tid: HOME_TENANT, name: "Ana", username: "ana@cooptimize.example", email: "ana@cooptimize.example", signedInAt: at.toString(), systemUserId: null, systemUserEmail: null });
  await teams.addChat({ chatId: CHAT.chatId, clientKey: "fabrikam", kind: "customer", displayName: CHAT.displayName, webUrl: null, members: [aChatMember({ external: true }), ...(o.member === false ? [] : [aChatMember({ userId: ME, displayName: "Ana" })])], by: ME });
  if (o.focus) await plan.setState("timer", { kind: "focus", pickId: null, label: "Focus", plannedMinutes: 120, elapsedMs: 0, runningSince: at.toString(), startedAt: at.toString(), ended: false, warned: [] });
  /** A request the job found and the AI sorted (now, or as given). */
  const urgent = async (text: string, urgency: "now" | "this_week" = "now") => {
    const m = aMessage({ chatId: CHAT.chatId, createdAt: at.toString(), text });
    await teams.saveMessages([{ chatId: m.chatId, messageId: m.messageId, clientKey: "fabrikam", senderId: m.authorId, senderName: "Dana", senderTenant: m.authorTenant, createdAt: m.createdAt, modifiedAt: m.createdAt, html: null, text, hasImage: false, hasFile: false, replyToId: null, mentions: [], fetchedAt: at.toString() }]);
    await teams.addRequest({ chatId: m.chatId, messageId: m.messageId, clientKey: "fabrikam", rule: "question", ruleDetail: null, at: m.createdAt });
    const a = aClassifyAnswer({ kind: "incident", urgency, title: "Portal down" });
    await teams.setSort(m.chatId, m.messageId, "sorted", { kind: "incident", urgency, itemType: null, title: a.title, description: "", likely: null, reason: "Down" }, ME);
    return m;
  };
  return { plan, teams, ticks, shown, urgent, at: (iso: string) => void (at = Temporal.Instant.from(iso)), now: () => at };
}

describe("the poll job in the scheduler", () => {
  it("runs at the start of every slow pass, before anyone's ticks; its next due time is in the idle wake", async () => {
    const order: string[] = [];
    const at = Temporal.Instant.from("2026-11-04T15:00:00Z");
    const stored: Temporal.Instant[] = [];
    const scheduler = createScheduler({ policy: PRODUCTION,
      people: () => [{ fast: async () => void order.push("fast"), slow: async () => void order.push("person"), wake: async () => at.add({ hours: 3 }) }],
      log: () => {},
      active: () => false,
      now: () => at,
      wakeStore: { load: async () => null, save: async (t) => void stored.push(t) },
      jobs: [{ name: "requests_poll", run: async () => void order.push("job"), wake: async () => at.add({ minutes: 5 }) }],
    });
    await scheduler.first();
    expect(order).toEqual(["fast", "job", "person"]);
    expect(stored.at(-1)?.toString()).toBe("2026-11-04T15:05:00Z");
  });

  it("a job that fails doesn't stop the pass", async () => {
    const ran: string[] = [];
    const logs: string[] = [];
    const s = createScheduler({ policy: PRODUCTION, people: () => [{ fast: async () => {}, slow: async () => void ran.push("person") }], log: (r) => void logs.push(String(r.kind)), jobs: [{ name: "requests_poll", run: async () => { throw new Error("x"); }, wake: async () => null }] });
    await s.pass("slow");
    expect(ran).toEqual(["person"]);
    expect(logs).toContain("requests_poll_failed");
  });
});

describe("Requests in each person's tick", () => {
  it("once a day: the AP-1 per-person rows' 14-day cleanup runs, with the cutoff 14 days back (CL-1: store/legacy-chat-rows.test.ts has the rule)", async () => {
    const s = await setup();
    const cuts: string[] = [];
    const purge = s.plan.purgeChatText.bind(s.plan);
    s.plan.purgeChatText = async (o) => (cuts.push(o.olderThan), purge(o));
    await s.ticks.slow();
    expect(cuts).toEqual(["2026-10-21T15:00:00Z"]);
    // Not again the same day.
    s.at("2026-11-04T17:00:00Z");
    await s.ticks.slow();
    expect(cuts).toHaveLength(1);
    s.at("2026-11-05T15:00:00Z");
    await s.ticks.slow();
    expect(cuts).toEqual(["2026-10-21T15:00:00Z", "2026-10-22T15:00:00Z"]);
  });

  it("a request sorted as needing someone now, in a chat I see: one notification, held during focus unless let through", async () => {
    for (const [focus, through, sent] of [[false, false, true], [true, false, false], [true, true, true]] as const) {
      const s = await setup({ focus, through });
      await s.urgent("The portal is down, can you look?");
      await s.ticks.slow();
      await s.ticks.slow();
      const asks = s.shown.filter((n) => n.kind === "asks");
      expect(asks.map((n) => [n.title, n.route])).toEqual(sent ? [["Urgent request from fabrikam", "conversations"]] : []);
    }
  });

  it("not for a chat I'm not in, not for one that isn't urgent now, and not once its sort is over 2 hours old", async () => {
    const out = await setup({ member: false });
    await out.urgent("Down?");
    await out.ticks.slow();
    expect(out.shown.filter((n) => n.kind === "asks")).toEqual([]);
    const s = await setup();
    await s.urgent("Can you add a column this week?", "this_week");
    await s.ticks.slow();
    expect(s.shown.filter((n) => n.kind === "asks")).toEqual([]);
    const late = await setup();
    await late.urgent("Down?");
    late.at("2026-11-04T17:01:00Z");
    await late.ticks.slow();
    expect(late.shown.filter((n) => n.kind === "asks")).toEqual([]);
  });
});
