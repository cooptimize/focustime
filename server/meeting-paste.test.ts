// MC-7: a paste goes through the upload's own route, so it has the upload's checks: who is asking (ID-1), whether they
// may upload for this call, its size. Through the real route with fictional people, AI and words. Never a pasted word
// in a log.
import { describe, expect, it } from "vitest";
import type { ProviderCall, TranscribeCall } from "../ai/types.ts";
import type { LogRecord } from "../log/logger.ts";
import { PASTE_TEXT } from "../plan/call-words.ts";
import { MAX_TRANSCRIPT_BYTES } from "../plan/transcript.ts";
import { addUsers, sqliteDb } from "../test/db.ts";
import { aCall, ANA, BEN, hostedPerson, type Reads } from "../test/hosted-person.ts";
import { CSRF_COOKIE } from "./auth/cookies.ts";
import { MEETING_UPLOAD_PATH } from "./app.ts";
import { startTestApp } from "./test-app.ts";

const PASTED = "Ana Example: Rates export is first.\nDana Client: We also need a holiday calendar import.\nAna Example: Noted, quisling marmalade.";
type Answer = { ok: true; data: { occurrenceId: number; outcome: string; lines: number; kind: string } } | { ok: false; status: number; error: string };

async function world() {
  const db = sqliteDb();
  await addUsers(db.conn, ANA.oid, BEN.oid);
  // Ana is the call's one reviewer; Ben isn't on it.
  const { port, series } = await aCall(db.conn, [ANA]);
  const calls: ProviderCall[] = [];
  const reads: Reads = { devops: [], myClients: [] };
  const logs: LogRecord[] = [];
  const people = {
    [ANA.oid]: (await hostedPerson(db.conn, ANA, { meetings: port, calls, heard: [] as TranscribeCall[], reads, more: { log: (r: LogRecord) => logs.push(r) } })).ctx,
    [BEN.oid]: (await hostedPerson(db.conn, BEN, { meetings: port, calls: [], heard: [] as TranscribeCall[], reads: { devops: [], myClients: [] } })).ctx,
  };
  const app = await startTestApp({ ctx: (s) => people[s.userId]!, log: (r) => logs.push(r) });
  const paste = async (who: typeof ANA | null, text: string | Buffer, as = "notes"): Promise<{ status: number; body: Answer }> => {
    const b = app.browser();
    if (who) await b.signIn(who.oid);
    const r = await b.send(`${MEETING_UPLOAD_PATH}?series=${series.id}&date=2026-11-17&paste=${as}`, { origin: app.publicUrl, "content-type": "text/plain; charset=utf-8", "x-csrf": b.jar.get(CSRF_COOKIE) ?? "" }, "POST", text);
    return { status: r.status, body: JSON.parse(r.body) as Answer };
  };
  return { app, paste, calls, logs, port, series };
}

describe("MC-7: a paste through the upload's route", () => {
  it("a reviewer's paste is saved as the call's transcript and the AI pass runs, with their identity", async () => {
    const w = await world();
    try {
      const r = await w.paste(ANA, PASTED, "transcript");
      expect(r.status).toBe(200);
      if (!r.body.ok) throw new Error(r.body.error);
      expect(r.body.data).toMatchObject({ kind: "pasted", lines: 3, outcome: "done" });
      expect(w.calls.length).toBe(1);
      const occ = await w.port.store.occurrence(r.body.data.occurrenceId);
      expect(occ?.transcriptKind).toBe("pasted");
      // The log says a paste was saved, its kind and its line count: never a word, a name or a title.
      expect(w.logs).toContainEqual(expect.objectContaining({ op: "meeting_paste", kind: "pasted", count: 3 }));
      const said = JSON.stringify(w.logs);
      for (const word of ["quisling", "marmalade", "holiday", "Rates export", "Dana Client", "Ana Example", "Contoso sync"]) expect(said).not.toContain(word);
    } finally {
      await w.app.close();
    }
  });

  it("someone who isn't the call's reviewer, and a signed-out request, are refused and nothing is saved", async () => {
    const w = await world();
    try {
      const ben = await w.paste(BEN, PASTED);
      expect(ben.body.ok).toBe(false);
      expect([403, 404]).toContain(ben.status);
      const out = await w.paste(null, PASTED);
      expect([401, 403]).toContain(out.status);
      expect(await w.port.store.occurrencesOf(w.series.id)).toEqual([]);
      expect(w.calls.length).toBe(0);
    } finally {
      await w.app.close();
    }
  });

  it("more than a transcript may be is refused in plain words, and nothing is saved", async () => {
    const w = await world();
    try {
      const r = await w.paste(ANA, Buffer.alloc(MAX_TRANSCRIPT_BYTES + 1, "a "));
      expect(r.status).toBe(413);
      expect(r.body).toMatchObject({ ok: false, error: PASTE_TEXT.tooLong });
      expect(await w.port.store.occurrencesOf(w.series.id)).toEqual([]);
    } finally {
      await w.app.close();
    }
  });
});
