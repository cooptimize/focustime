// MC-1: the AI pass sends only the meeting's client's data (asserted on what the provider got), masks another client
// and spoken addresses before the guard, keeps client names for Cooptimize Internal, and turns an answer into checked
// proposals with quotes taken from the stored transcript.
import { describe, expect, it } from "vitest";
import { createAi } from "../ai/service.ts";
import { stubProvider } from "../ai/stub.ts";
import type { ProviderCall } from "../ai/types.ts";
import { buildProcessModel } from "../plan/process.ts";
import type { TranscriptLine } from "../plan/transcript.ts";
import { aClientEntry, aClientProcess, anAiApp, anAiRules, aWorkItem } from "../test/builders/index.ts";
import { capturePass, summaryOf, type CaptureInput } from "./meeting-capture.ts";

const lines: TranscriptLine[] = [
  { n: 1, speaker: "Sam Tester", at: 5, text: "Morning. Rates export first, like we did for Fabrikam on Orion." },
  { n: 2, speaker: "Dana Client", at: 40, text: "We also need a holiday calendar import, nothing exists for it yet. Mail dana@contoso.example." },
  { n: 3, speaker: "Sam Tester", at: 70, text: "I'll send the export spec by 2026-11-13." },
  { n: 4, speaker: "Dana Client", at: 95, text: "Decided: CSV only for now, Excel later." },
];

function setup(answer: unknown, o: { internal?: boolean; allowed?: string[] } = {}) {
  const calls: ProviderCall[] = [];
  const ai = createAi({
    // MC-2: the answer has a summary now (the schema requires one); the tests' answers get an empty one.
    provider: async () => stubProvider({ respond: (c) => (calls.push(c), JSON.stringify({ summary: [], ...(answer as object) })) }),
    app: anAiApp(),
    rules: async () => anAiRules({ allowedClients: o.allowed ?? ["contoso", "internal"] }),
    guard: async () => ({ directory: [aClientEntry({ key: "contoso", names: ["Contoso"], projects: ["Rates"], itemIds: [1201, 1202] }), aClientEntry({ key: "fabrikam", names: ["Fabrikam"], projects: ["Orion"], itemIds: [4410] })], homeDomains: ["cooptimize.example"], forbidden: [], internal: !!o.internal }),
    log: { add: async () => {}, spentMicros: async () => 0, recent: async () => [] },
    appSpend: { get: async () => 0, add: async () => {} },
    now: () => "2026-11-10T17:00:00Z",
    sleep: async () => {},
  });
  const input: CaptureInput = {
    clientKey: o.internal ? "internal" : "contoso",
    clientName: o.internal ? "Cooptimize Internal" : "Contoso",
    internal: !!o.internal,
    meeting: { name: "Contoso sync", role: "status", date: "2026-11-10" },
    cooptimizers: [{ id: "me-id", name: "Sam Tester" }],
    items: [aWorkItem({ id: 1201, title: "Rates export", type: "Feature", tier: "feature" }), aWorkItem({ id: 1202, title: "Export CSV", type: "User Story", parentId: 1201 })],
    model: buildProcessModel(aClientProcess()),
    directory: [aClientEntry({ key: "contoso", names: ["Contoso"], projects: ["Rates"], itemIds: [1201, 1202] }), aClientEntry({ key: "fabrikam", names: ["Fabrikam"], projects: ["Orion"], itemIds: [4410] })],
    lines,
  };
  return { ai, calls, input };
}

const ANSWER = {
  gaps: [
    { type: "User Story", parentId: 1201, title: "Holiday calendar import", description: "The client needs holidays imported.", lines: [2] },
    { type: "User Story", parentId: 4410, title: "Not theirs", description: "x", lines: [2] },
    { type: "User Story", parentId: 1201, title: "Export CSV", description: "Already there", lines: [1] },
  ],
  commitments: [
    { who: "Sam Tester", what: "Send the export spec", toName: "Dana Client", due: "2026-11-13", lines: [3] },
    { who: "Dana Client", what: "Share sample rates", toName: null, due: null, lines: [4] },
    { who: "Nobody Said This", what: "x", toName: null, due: null, lines: [4] },
  ],
  comments: [
    { itemId: 1202, note: "decision", text: "CSV only for now; Excel later.", lines: [4, 99] },
    { itemId: 4410, note: "status", text: "x", lines: [1] },
    // MC-1e: on the Feature: never a proposal, whatever the model says.
    { itemId: 1201, note: "status", text: "Rates export is on track.", lines: [1] },
  ],
};

describe("meeting capture AI pass (MC-1)", () => {
  it("sends only that client's data, with another client and addresses masked", async () => {
    const { ai, calls, input } = setup(ANSWER);
    const r = await capturePass(ai, input);
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(1);
    const sent = calls[0]!.input;
    expect(sent).not.toMatch(/Fabrikam|Orion|4410|dana@contoso/);
    expect(sent).toContain("[another client]");
    expect(sent).toContain("[email]");
    expect(sent).toContain("#1201 Feature: Rates export");
    // MC-1e: only story-level items are marked as taking a comment, and the instructions say so.
    expect(sent).toContain("#1202 User Story [story]: Export CSV");
    expect(calls[0]!.instructions).toContain("Comment only on items marked [story]; never on a feature, an epic or anything above a story.");
    expect(sent).toContain("L3 [1:10] Sam Tester: I'll send the export spec by 2026-11-13.");
    if (!r.ok) return;
    expect(r.masked).toEqual({ client: 2, email: 1 });
  });

  it("keeps only proposals that check out, with quotes from the transcript", async () => {
    const { ai, input } = setup(ANSWER);
    const r = await capturePass(ai, input);
    if (!r.ok) throw new Error(r.message);
    expect(r.dropped).toBe(5);
    const kinds = r.proposals.map((p) => p.body.kind);
    expect(kinds).toEqual(["gap", "commitment", "commitment", "comment"]);
    const [gap, mine, theirs, comment] = r.proposals.map((p) => p.body);
    expect(gap).toMatchObject({ type: "User Story", parentId: 1201, parentTitle: "Rates export", title: "Holiday calendar import" });
    expect(mine).toMatchObject({ who: "Sam Tester", whoId: "me-id", side: "cooptimize", due: "2026-11-13" });
    expect(theirs).toMatchObject({ who: "Dana Client", whoId: null, side: "client" });
    expect(comment).toMatchObject({ itemId: 1202, itemType: "User Story", inReport: false, lines: [4] });
    expect(r.proposals[3]!.quotes).toEqual([{ n: 4, speaker: "Dana Client", at: "1:35", text: "Decided: CSV only for now, Excel later." }]);
  });

  it("GD-2: a proposal naming another client has it replaced and is marked; the prompt says so; the rest are untouched", async () => {
    const answer = { gaps: [{ type: "User Story", parentId: 1201, title: "Holiday calendar import like Fabrikam's", description: "Same as Orion does.", lines: [2] }, { type: "User Story", parentId: 1201, title: "Rates CSV", description: "Plain", lines: [4] }], commitments: [], comments: [] };
    const { ai, calls, input } = setup(answer);
    const r = await capturePass(ai, input);
    if (!r.ok) throw new Error(r.message);
    expect(calls[0]!.instructions).toContain("Never name any other client");
    const [a, b] = r.proposals.map((p) => p.body as { title: string; description: string; namesRemoved?: boolean });
    expect(a).toMatchObject({ title: "Holiday calendar import like another client's", description: "Same as another client does.", namesRemoved: true });
    expect(b!.namesRemoved).toBeUndefined();
  });

  it("lets Cooptimize Internal's meeting name clients (GD-1), still without addresses", async () => {
    const { ai, calls, input } = setup({ gaps: [], commitments: [], comments: [] }, { internal: true });
    const r = await capturePass(ai, input);
    expect(r.ok).toBe(true);
    expect(calls[0]!.input).toContain("Fabrikam on Orion");
    expect(calls[0]!.input).not.toContain("dana@contoso");
  });

  it("sends nothing when the client hasn't Allow AI", async () => {
    const { ai, calls, input } = setup(ANSWER, { allowed: [] });
    const r = await capturePass(ai, input);
    expect(r).toMatchObject({ ok: false, kind: "client_off" });
    expect(calls).toEqual([]);
  });

  it("MC-1e: comments go on story-level items only, whatever the process calls its levels", async () => {
    // A process whose requirement level is "Product Backlog Item" under "Initiative" and "Capability": levels come from
    // the backlogs, never from a type's name.
    const odd = buildProcessModel(aClientProcess({ teamBacklogs: { value: [{ name: "Initiatives", rank: 4, type: "portfolio", workItemTypes: [{ name: "Initiative" }], defaultWorkItemType: { name: "Initiative" } }, { name: "Capabilities", rank: 3, type: "portfolio", workItemTypes: [{ name: "Capability" }], defaultWorkItemType: { name: "Capability" } }, { name: "Backlog items", rank: 2, type: "requirement", workItemTypes: [{ name: "Product Backlog Item" }], defaultWorkItemType: { name: "Product Backlog Item" } }, { name: "Tasks", rank: 1, type: "task", workItemTypes: [{ name: "Task" }], defaultWorkItemType: { name: "Task" } }] } as never }));
    const answer = { gaps: [], commitments: [], comments: [{ itemId: 1301, note: "status", text: "On track.", lines: [1] }, { itemId: 1302, note: "decision", text: "CSV only for now.", lines: [4] }] };
    const { ai, calls, input } = setup(answer);
    const r = await capturePass(ai, { ...input, model: odd, items: [aWorkItem({ id: 1301, title: "Rates", type: "Capability", tier: "feature" }), aWorkItem({ id: 1302, title: "Export CSV", type: "Product Backlog Item", parentId: 1301 })] });
    if (!r.ok) throw new Error(r.message);
    expect(r.proposals.map((p) => p.body)).toEqual([expect.objectContaining({ kind: "comment", itemId: 1302 })]);
    expect(calls[0]!.input).toContain("#1302 Product Backlog Item [story]: Export CSV");
    expect(calls[0]!.input).not.toContain("Capability [story]");
    // Without the client's process FocusTime can't tell a story from a feature, so no comment is proposed.
    const none = await capturePass(ai, { ...input, model: null });
    if (!none.ok) throw new Error(none.message);
    expect(none.proposals.filter((p) => p.body.kind === "comment")).toEqual([]);
  });
});

describe("a transcript whose speakers aren't named (PK-1)", () => {
  const pocket: TranscriptLine[] = [
    { n: 1, speaker: "Speaker 1", at: null, text: "Morning. We need a holiday calendar import." },
    { n: 2, speaker: "Speaker 2", at: null, text: "Sam here, I'll send the export spec to Dana by Friday." },
    { n: 3, speaker: "Speaker 1", at: null, text: "I'll share sample rates." },
    { n: 4, speaker: "Speaker 3", at: null, text: "Dana will check the import with her team." },
    { n: 5, speaker: "Speaker 2", at: null, text: "Decided: CSV only for now." },
  ];
  const answer = {
    gaps: [{ type: "User Story", parentId: 1201, title: "Holiday calendar import", description: "Holidays imported.", lines: [1] }],
    commitments: [
      { who: "Sam Tester", what: "Send the export spec", toName: "Dana", due: null, lines: [2] },
      // To whom: a name the words don't hold is a guess, so no one.
      { who: "Speaker 1", what: "Share sample rates", toName: "Dana Client", due: null, lines: [3] },
      // A name the cited words don't hold: a guess, so nobody's.
      { who: "Sam Tester", what: "Share sample rates again", toName: null, due: null, lines: [3] },
      { who: "Dana", what: "Check the import with her team", toName: null, due: null, lines: [4] },
    ],
    comments: [
      { itemId: 1202, note: "decision", text: "CSV only for now.", lines: [5] },
      { itemId: 1201, note: "status", text: "On the feature.", lines: [5] },
    ],
  };

  it("tells the AI the labels aren't people only for such a transcript, and sends no times for its lines", async () => {
    const named = setup(ANSWER);
    await capturePass(named.ai, named.input);
    expect(named.calls[0]!.instructions).not.toContain("speakers aren't named");
    const t = setup(answer);
    await capturePass(t.ai, { ...t.input, lines: pocket, speakersNamed: false });
    const c = t.calls[0]!;
    expect(c.instructions).toContain("Labels like Speaker 1 are not people");
    expect(c.instructions).toContain("Name a person only where the words themselves name them");
    expect(c.input).toContain("L2 Speaker 2: Sam here, I'll send the export spec to Dana by Friday.");
    expect(c.input).not.toMatch(/\[\d+:\d\d\]/);
  });

  it("a promise is someone's only when its own words name them; otherwise it is noted with the call, nobody's", async () => {
    const t = setup(answer);
    const r = await capturePass(t.ai, { ...t.input, lines: pocket, speakersNamed: false });
    if (!r.ok) throw new Error(r.message);
    const promises = r.proposals.map((p) => p.body).filter((b) => b.kind === "commitment");
    expect(promises).toEqual([
      expect.objectContaining({ what: "Send the export spec", who: "Sam Tester", whoId: "me-id", side: "cooptimize", toName: "Dana" }),
      expect.objectContaining({ what: "Share sample rates", who: "", whoId: null, side: "unknown", toName: null }),
      expect.objectContaining({ what: "Share sample rates again", who: "", whoId: null, side: "unknown" }),
      expect.objectContaining({ what: "Check the import with her team", who: "Dana", whoId: null, side: "client" }),
    ]);
    // New items as for any transcript; a comment still only on a story.
    expect(r.proposals.filter((p) => p.body.kind === "gap")).toHaveLength(1);
    expect(r.proposals.filter((p) => p.body.kind === "comment").map((p) => p.body)).toEqual([expect.objectContaining({ itemId: 1202 })]);
    // Quotes carry no time.
    expect(r.proposals.flatMap((p) => p.quotes).every((q) => q.at === "")).toBe(true);
  });
});

describe("a call's summary (MC-2)", () => {
  const directory = [aClientEntry({ key: "contoso", names: ["Contoso"] }), aClientEntry({ key: "fabrikam", names: ["Fabrikam"], projects: ["Orion"] })];
  it("is at most 5 lines, taken in turn from each part, without repeats or another client's name", () => {
    const s = summaryOf([["Rates export first.", "Fabrikam wants the same.", "Orion slips a week.", "  Spec   by Friday. "], ["Rates export first.", "CSV only.", "Ops owns the import.", "Six."]], { clientKey: "contoso", directory });
    expect(s).toEqual(["Rates export first.", "another client wants the same.", "CSV only.", "another client slips a week.", "Ops owns the import."]);
  });
  it("names no other client even for Internal, and drops what isn't text", () => {
    expect(summaryOf([["Fabrikam asked about rates.", 7, null, ""]], { clientKey: "internal", directory })).toEqual(["another client asked about rates."]);
    expect(summaryOf([], { clientKey: "contoso", directory })).toEqual([]);
    // A name at the clip is replaced before it is cut, so no part of it survives.
    const long = `${"x".repeat(295)} Fabrikam`;
    expect(summaryOf([[long]], { clientKey: "contoso", directory })[0]).not.toMatch(/Fabr|Fab/);
  });
});
