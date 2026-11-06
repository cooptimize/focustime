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
import { capturePass, type CaptureInput } from "./meeting-capture.ts";

const lines: TranscriptLine[] = [
  { n: 1, speaker: "Sam Tester", at: 5, text: "Morning. Rates export first, like we did for Fabrikam on Orion." },
  { n: 2, speaker: "Dana Client", at: 40, text: "We also need a holiday calendar import, nothing exists for it yet. Mail dana@contoso.example." },
  { n: 3, speaker: "Sam Tester", at: 70, text: "I'll send the export spec by 2026-11-13." },
  { n: 4, speaker: "Dana Client", at: 95, text: "Decided: CSV only for now, Excel later." },
];

function setup(answer: unknown, o: { internal?: boolean; allowed?: string[] } = {}) {
  const calls: ProviderCall[] = [];
  const ai = createAi({
    provider: async () => stubProvider({ respond: (c) => (calls.push(c), JSON.stringify(answer)) }),
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
    { itemId: 1201, note: "decision", text: "CSV only for now; Excel later.", lines: [4, 99] },
    { itemId: 4410, note: "status", text: "x", lines: [1] },
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
    expect(sent).toContain("L3 [1:10] Sam Tester: I'll send the export spec by 2026-11-13.");
    if (!r.ok) return;
    expect(r.masked).toEqual({ client: 2, email: 1 });
  });

  it("keeps only proposals that check out, with quotes from the transcript", async () => {
    const { ai, input } = setup(ANSWER);
    const r = await capturePass(ai, input);
    if (!r.ok) throw new Error(r.message);
    expect(r.dropped).toBe(4);
    const kinds = r.proposals.map((p) => p.body.kind);
    expect(kinds).toEqual(["gap", "commitment", "commitment", "comment"]);
    const [gap, mine, theirs, comment] = r.proposals.map((p) => p.body);
    expect(gap).toMatchObject({ type: "User Story", parentId: 1201, parentTitle: "Rates export", title: "Holiday calendar import" });
    expect(mine).toMatchObject({ who: "Sam Tester", whoId: "me-id", side: "cooptimize", due: "2026-11-13" });
    expect(theirs).toMatchObject({ who: "Dana Client", whoId: null, side: "client" });
    expect(comment).toMatchObject({ itemId: 1201, inReport: true, lines: [4] });
    expect(r.proposals[3]!.quotes).toEqual([{ n: 4, speaker: "Dana Client", at: "1:35", text: "Decided: CSV only for now, Excel later." }]);
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
});
