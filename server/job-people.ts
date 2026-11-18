// What two of the app's jobs build for one person from that person's action context (server/main.ts runtimeFor):
// the meeting capture job's Graph client, AI and capture context (MC-1), and the shared chat poll's reader, AI, open
// items and client boundary (AP-1, CV-1, GD-2). Built for a run and dropped after it.
import { aiFor, meetingPerson, requestContext, type ActionContext } from "../actions/dispatch.ts";
import type { PollPerson } from "../actions/request-poll.ts";
import type { MeetingPerson } from "./meeting-job.ts";

/** MC-1: one reviewer as the meeting job uses them. */
export async function meetingJobPerson(ctx: ActionContext): Promise<MeetingPerson | null> {
  return meetingPerson(ctx);
}

/** AP-1: one follower as the shared chat poll uses them. */
export async function pollJobPerson(name: string, ctx: ActionContext): Promise<PollPerson> {
  const loaded = await ctx.loadConfig();
  const config = loaded.parsed.ok ? loaded.parsed.config : null;
  const account = config && ctx.account ? ctx.account(config) : null;
  const rc = await requestContext(ctx);
  return { name, config, chatMessages: account?.chatMessages, chats: account?.chats, ai: () => aiFor(ctx), pipelineAi: () => aiFor(ctx, { cap: "app" }), plan: ctx.plan ?? null, openItems: rc.openItems, ...(rc.boundary ? { boundary: rc.boundary } : {}) };
}
