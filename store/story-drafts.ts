// DS-1: the plan store's part for Draft stories: draft runs (the reviewed cards as JSON), the proposal → DevOps write
// map that makes a retry safe, and each client's house style. Every statement is the person's own (store/scope.ts);
// every write runs in a transaction. Spread into the plan store (plan-store.ts).
import type { HouseStyle, StoryDraft, StoryDraftBody } from "../plan/stories.ts";
import type { ScopedDb } from "./scope.ts";
import type { Row } from "./sql/conn.ts";

type Db = ScopedDb;
const instant = (v: unknown): string => (typeof v === "string" && v ? Temporal.Instant.from(v).toString() : v instanceof Date ? v.toISOString() : "");
const toDraft = (r: Row): StoryDraft => ({ ...(JSON.parse(r.body as string) as StoryDraftBody), id: r.id as string, clientKey: r.client_key as string, featureId: Number(r.feature_id), createdAt: instant(r.created_at), updatedAt: instant(r.updated_at) });
const toStyle = (r: Row): HouseStyle => ({ clientKey: r.client_key as string, computed: (r.computed_text as string | null) ?? null, computedAt: r.computed_at == null ? null : instant(r.computed_at), learned: Number(r.learned) === 1 || r.learned === true, edited: (r.edited_text as string | null) ?? null, editedAt: r.edited_at == null ? null : instant(r.edited_at) });
const DRAFT_ID = /^[0-9a-f-]{36}$/;
/** The JSON body has a limit well above what 10 cards need, so nothing unbounded is kept. */
const BODY_MAX = 200_000;

export function storyDraftMethods(db: Db, now: () => string) {
  const body = (d: StoryDraftBody) => {
    const s = JSON.stringify({ featureTitle: d.featureTitle, storyType: d.storyType, note: d.note, exemplarIds: d.exemplarIds, proposals: d.proposals, rationale: d.rationale, setAside: d.setAside, costMicros: d.costMicros, ...(d.namesRemoved ? { namesRemoved: true } : {}) } satisfies StoryDraftBody);
    if (s.length > BODY_MAX) throw new Error("This draft is too large to keep");
    return s;
  };
  const m = {
    /** A new draft run for a feature; its id. */
    async addStoryDraft(clientKey: string, featureId: number, d: StoryDraftBody): Promise<StoryDraft> {
      const id = crypto.randomUUID();
      const at = now();
      await db.tx(() => db.run("INSERT INTO story_drafts (id, client_key, feature_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", id, clientKey.slice(0, 100), featureId, body(d), at, at));
      return (await m.storyDraft(id))!;
    },
    async storyDraft(id: string): Promise<StoryDraft | null> {
      if (!DRAFT_ID.test(id)) return null;
      const r = (await db.get("SELECT * FROM story_drafts WHERE id = ?", id)) as Row | undefined;
      return r ? toDraft(r) : null;
    },
    /** The newest draft for a feature (to reopen Review where the person left it), or null. */
    async latestStoryDraft(clientKey: string, featureId: number): Promise<StoryDraft | null> {
      const r = (await db.get("SELECT * FROM story_drafts WHERE client_key = ? AND feature_id = ? ORDER BY updated_at DESC LIMIT 1", clientKey, featureId)) as Row | undefined;
      return r ? toDraft(r) : null;
    },
    async saveStoryDraft(id: string, d: StoryDraftBody): Promise<StoryDraft> {
      await db.tx(async () => {
        if ((await db.run("UPDATE story_drafts SET body = ?, updated_at = ? WHERE id = ?", body(d), now(), id)).changes === 0) throw new Error("No such draft");
      });
      return (await m.storyDraft(id))!;
    },
    /** Which DevOps write created (or is creating) each proposal of a draft. */
    async storyDraftWrites(draftId: string): Promise<Map<string, number>> {
      const rows = (await db.all("SELECT proposal_id, write_id FROM story_draft_writes WHERE draft_id = ?", draftId)) as Row[];
      return new Map(rows.map((r) => [r.proposal_id as string, Number(r.write_id)]));
    },
    /** Ties a proposal to its write, once: a second tie for the same proposal is refused (never two items). */
    async linkStoryDraftWrite(draftId: string, proposalId: string, writeId: number): Promise<void> {
      await db.tx(async () => {
        if (await db.get("SELECT 1 AS x FROM story_draft_writes WHERE draft_id = ? AND proposal_id = ?", draftId, proposalId)) throw new Error("That proposal already has a write");
        await db.run("INSERT INTO story_draft_writes (draft_id, proposal_id, write_id, created_at) VALUES (?, ?, ?, ?)", draftId, proposalId.slice(0, 16), writeId, now());
      });
    },
    async houseStyle(clientKey: string): Promise<HouseStyle | null> {
      const r = (await db.get("SELECT * FROM house_styles WHERE client_key = ?", clientKey)) as Row | undefined;
      return r ? toStyle(r) : null;
    },
    async houseStyles(): Promise<HouseStyle[]> {
      return ((await db.all("SELECT * FROM house_styles ORDER BY client_key")) as Row[]).map(toStyle);
    },
    /** The computed style (and when); an edit is left as it is. */
    async setComputedHouseStyle(clientKey: string, text: string, learned: boolean): Promise<HouseStyle> {
      await db.tx(async () => {
        const at = now();
        if (await db.get("SELECT 1 AS x FROM house_styles WHERE client_key = ?", clientKey)) await db.run("UPDATE house_styles SET computed_text = ?, computed_at = ?, learned = ? WHERE client_key = ?", text.slice(0, 2000), at, learned ? 1 : 0, clientKey);
        else await db.run("INSERT INTO house_styles (client_key, computed_text, computed_at, learned) VALUES (?, ?, ?, ?)", clientKey.slice(0, 100), text.slice(0, 2000), at, learned ? 1 : 0);
      });
      return (await m.houseStyle(clientKey))!;
    },
    /** The person's edit, or null to go back to the computed one. */
    async editHouseStyle(clientKey: string, text: string | null): Promise<HouseStyle> {
      await db.tx(async () => {
        const at = text === null ? null : now();
        if (await db.get("SELECT 1 AS x FROM house_styles WHERE client_key = ?", clientKey)) await db.run("UPDATE house_styles SET edited_text = ?, edited_at = ? WHERE client_key = ?", text, at, clientKey);
        else await db.run("INSERT INTO house_styles (client_key, learned, edited_text, edited_at) VALUES (?, ?, ?, ?)", clientKey.slice(0, 100), 0, text, at);
      });
      return (await m.houseStyle(clientKey))!;
    },
  };
  return m;
}
