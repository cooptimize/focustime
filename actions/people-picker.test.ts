// CV-2: the PersonPicker's people and what a follow-up keeps of the choice. Groups: the conversation's people
// (externals marked, by chat member id, never an email), the client's Account Workers who are Cooptimizers, and
// cooptimizers() only for everyone (no guests, nobody outside the domains, no automation accounts); never me; nobody
// twice. A follow-up stores the reference beside its text; new text without a person is a plain name; an older one
// keeps its text. Fictional names.
import { describe, expect, it } from "vitest";
import { levels } from "../plan/levels.ts";
import { createPlanStore } from "../store/plan-store.ts";
import { aDirectoryPerson, HOME_TENANT } from "../test/builders/index.ts";
import { BLAKE, CHAT, EVAN, LENA, SAM, world } from "../test/conversations.ts";
import { OUTSIDER, people } from "../test/conversation-people.ts";
import { conversationPeople } from "./conversation-actions.ts";
import { followUpAction } from "./followup-actions.ts";
import { peoplePicker, pickerPeopleOf, type PickerPeople } from "./people-picker.ts";

const dir = [
  aDirectoryPerson({ personId: EVAN.userId!, name: "Evan Ford", email: "evan@contoso.example" }),
  aDirectoryPerson({ personId: LENA.userId!, name: "Lena Hart", email: "lena@contoso.example" }),
  aDirectoryPerson({ personId: SAM.userId!, name: "Sam Tester", email: "sam@contoso.example" }),
  aDirectoryPerson({ name: "Ari Quinn", email: "ari@contoso.example" }),
  aDirectoryPerson({ name: "Gil Guest", email: "gil@fabrikam.example", guest: true }),
  aDirectoryPerson({ name: "Out Side", email: "out@fabrikam.example" }),
  aDirectoryPerson({ name: "Build Bot", email: "bot@contoso.example" }),
];
const bot = dir[6]!.personId;
const ari = dir[3]!.personId;
function org(): PickerPeople {
  const lv = levels({ directory: dir.map((d) => ({ ...d, entra: true })), leads: [], overrides: [], clients: [], signedIn: [{ id: "u-new", email: "nova@contoso.example", upn: "nova@contoso.example" }], automation: [bot], domains: ["contoso.example"] });
  return pickerPeopleOf({
    levels: lv,
    directory: dir,
    peopleClients: [{ personId: ari, clientKey: "contoso", worker: true }, { personId: LENA.userId!, clientKey: "contoso", worker: true }, { personId: EVAN.userId!, clientKey: "contoso", worker: false }, { personId: dir[4]!.personId, clientKey: "contoso", worker: true }],
    users: [{ id: "u-new", name: "Nova Lane" }],
  });
}

describe("people.picker", () => {
  it("everyone at Cooptimize is cooptimizers() only, named from the directory or the sign-in; the client's group is its Account Workers", () => {
    const p = org();
    expect(p.cooptimizers.map((x) => x.name).sort()).toEqual(["Ari Quinn", "Evan Ford", "Lena Hart", "Nova Lane", "Sam Tester"]);
    expect(p.workers("contoso").map((x) => x.name)).toEqual(["Ari Quinn", "Lena Hart"]);
  });

  it("groups the conversation's people (externals by member id, no email), then the client's, then everyone; never me, nobody twice", async () => {
    const w = world();
    const m = await w.say(CHAT, BLAKE, "2026-11-04T21:00:00Z", "The totals are off");
    const c = await w.convs.addConversation({ chatId: CHAT.chatId, clientKey: "contoso", title: "Totals", summary: "x", participants: [BLAKE, EVAN, SAM].map((x) => ({ id: x.userId!, name: x.displayName!, external: x.tenantId !== HOME_TENANT })), firstAt: m.createdAt, lastAt: m.createdAt, lastWorkAt: m.createdAt });
    const sam = (await people(w)).as(SAM).ctx;
    const d = await peoplePicker({ me: sam.me, people: async () => org(), conversation: (q) => conversationPeople(sam, q), clientName: async () => "Contoso Supply" }, { clientKey: "contoso", conversationId: c.id });
    expect(d.groups.map((g) => [g.label, g.people.map((p) => p.name)])).toEqual([
      ["In this conversation", ["Blake Novak", "Evan Ford"]],
      ["On Contoso Supply", ["Ari Quinn", "Lena Hart"]],
      ["Everyone at Cooptimize", ["Nova Lane"]],
    ]);
    const [blake, evan] = d.groups[0]!.people;
    expect(blake).toEqual({ name: "Blake Novak", ref: { kind: "external", memberId: BLAKE.userId!.toLowerCase(), name: "Blake Novak" }, email: null, external: true });
    expect(evan).toMatchObject({ ref: { kind: "cooptimizer", id: EVAN.userId!.toLowerCase(), name: "Evan Ford" }, email: "evan@contoso.example", external: false });
    // Someone not in the chat gets no conversation group.
    const out = (await people(w)).as(OUTSIDER).ctx;
    expect(await conversationPeople(out, { conversationId: c.id })).toBeNull();
  });

  it("a promise with no conversation offers the people of its own messages and the one it was made to", async () => {
    const w = world();
    const q = await w.say(CHAT, BLAKE, "2026-11-04T21:00:00Z", "Can you send the totals?");
    const a = await w.say(CHAT, SAM, "2026-11-04T21:02:00Z", "I'll send them tonight", { replyToId: q.messageId });
    const k = await w.convs.addCommitment({ conversationId: null, chatId: CHAT.chatId, clientKey: "contoso", whoId: SAM.userId!, whoName: "Sam Tester", toId: BLAKE.userId!, toName: "Blake Novak", what: "Send the totals", dueAt: null, dueDate: null, impliesItem: false, messageIds: [a.messageId], reason: null });
    const sam = (await people(w)).as(SAM).ctx;
    expect(await conversationPeople(sam, { commitmentId: k.id })).toEqual([{ id: BLAKE.userId!, name: "Blake Novak", external: true, email: null }]);
  });
});

describe("Who on a follow-up", () => {
  const setup = () => {
    const plan = createPlanStore({ path: ":memory:", now: () => Temporal.Instant.from("2026-11-05T15:00:00Z").toZonedDateTimeISO("America/Chicago") });
    const ctx = { plan, config: async () => null, now: () => "2026-11-05T15:00:00Z" };
    const run = async (action: Parameters<typeof followUpAction>[1], input: unknown) => {
      const r = await followUpAction(ctx, action, input);
      if (!r.ok) throw new Error(`${r.status} ${r.error}`);
      return (r.data as { followUp: { id: number; who: string; whoRef: unknown } }).followUp;
    };
    return { plan, ctx, run };
  };
  const evan = { kind: "cooptimizer", id: "00000000-0000-4000-8000-0000000000e1", name: "Evan Ford" };

  it("keeps the person beside the text; the same text keeps them, new text is a plain name", async () => {
    const t = setup();
    const f = await t.run("followup.add", { what: "Send the totals", who: "Evan Ford", whoRef: evan });
    expect(f).toMatchObject({ who: "Evan Ford", whoRef: evan });
    expect(await t.run("followup.edit", { id: f.id, what: "Send the October totals" })).toMatchObject({ who: "Evan Ford", whoRef: evan });
    expect(await t.run("followup.edit", { id: f.id, who: "Evan F." })).toMatchObject({ who: "Evan F.", whoRef: null });
    const ext = { kind: "external", memberId: "00000000-0000-4000-8000-0000000000b1", name: "Blake Novak" };
    expect(await t.run("followup.edit", { id: f.id, who: "Blake Novak", whoRef: ext })).toMatchObject({ who: "Blake Novak", whoRef: ext });
  });

  it("an older follow-up keeps its text with no person; a reference that isn't one is refused; an email never goes in", async () => {
    const t = setup();
    const old = await t.plan.addFollowUp({ who: "Dana at Adatum", what: "Old one", due: null });
    expect((await t.plan.getFollowUp(old.id))!).toMatchObject({ who: "Dana at Adatum", whoRef: null });
    for (const bad of [{ kind: "cooptimizer", id: "x", name: "" }, { kind: "external", memberId: "a b", name: "X" }, { kind: "cooptimizer", id: "x", name: "X", email: "x@contoso.example" }, "Evan"]) {
      const r = await followUpAction(t.ctx, "followup.add", { what: "y", who: "X", whoRef: bad });
      expect(r.ok ? 200 : r.status).toBe(400);
    }
  });
});
