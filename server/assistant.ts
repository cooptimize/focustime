// AS-1: the assistant for anyone signed in, by their Entra object id: the interface TB-1's Teams bot calls
// (assistant/types.ts, docs/assistant-interface.md). Each call builds that person's own context (their clients, write
// PATs, settings, caps) the same way their browser's calls do; nothing about the person comes from the caller but the id.
import { assistantFor, assistantTranscribe, type ActionContext } from "../actions/dispatch.ts";
import type { Assistant, Channel, Person } from "../assistant/types.ts";

export type AssistantHubOptions = {
  /** The person's action context (server/main.ts runtimeFor). */
  ctxFor: (userId: string) => Promise<ActionContext>;
};

/** One Assistant for every front end; `channel` only labels the turn in history (TB-3: the result is channel-neutral). */
export function createAssistantHub(o: AssistantHubOptions): Assistant & { forChannel: (channel: Channel) => Assistant } {
  const service = async (p: Person, channel: Channel) => {
    if (typeof p?.userId !== "string" || !p.userId) throw new Error("A person is { userId }");
    const a = await assistantFor(await o.ctxFor(p.userId), channel);
    if (!a) throw new Error("The assistant isn't available for this person");
    return a.service;
  };
  const forChannel = (channel: Channel): Assistant => ({
    handle: async (i) => (await service(i.person, i.channel ?? channel)).handle(i.text, i.context ?? {}, i.answer, i.asked),
    confirm: async (i) => (await service(i.person, channel)).confirm(i.proposalId, i.edits ?? {}),
    cancel: async (i) => (await service(i.person, channel)).cancel(i.proposalId),
    propose: async (i) => (await service(i.person, channel)).propose(i.tool, i.args ?? {}),
    undo: async (i) => (await service(i.person, channel)).undo(i.proposalId),
    refresh: async (i) => (await service(i.person, channel)).refresh(i.proposalId),
    undoWrite: async (i) => (await service(i.person, channel)).undoWrite(i.proposalId, i.writeId),
    transcribe: async (i) => assistantTranscribe(await o.ctxFor(i.person.userId), { audio: i.audio, mime: i.mime, seconds: i.seconds, ...(i.context ? { context: i.context } : {}) }),
    history: async (i) => (await service(i.person, channel)).history(i.limit ?? 50, i.from),
    clear: async (i) => (await service(i.person, channel)).clear(),
  });
  return { ...forChannel("teams"), forChannel };
}
