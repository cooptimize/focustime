// What two of the app's jobs build for one person from that person's action context (server/main.ts runtimeFor):
// the meeting capture job's Graph client, AI and capture context (MC-1), and the shared chat poll's reader, AI, open
// items and client boundary (AP-1, CV-1, GD-2). Built for a run and dropped after it. ID-1: each with the person's
// identity, as every request has it (signedContext): a hosted person's Dataverse user is kept with their sign-in, so
// without it the job read DevOps without them (a pass ended "no_context", the poll had no open items) and knew fewer
// of their clients (the boundary missed the ones that are theirs in Dataverse only). As VM-3 did for the VM start.
import { aiFor, meetingPerson, requestContext, signedContext, type ActionContext } from "../actions/dispatch.ts";
import type { PollPerson } from "../actions/request-poll.ts";
import type { MeetingPerson } from "./meeting-job.ts";

/** MC-1: one reviewer as the meeting job uses them. */
export async function meetingJobPerson(raw: ActionContext): Promise<MeetingPerson | null> {
  return meetingPerson(signedContext(raw));
}

/** AP-1: one follower as the shared chat poll uses them. */
export async function pollJobPerson(name: string, raw: ActionContext): Promise<PollPerson> {
  const ctx = signedContext(raw);
  const loaded = await ctx.loadConfig();
  const config = loaded.parsed.ok ? loaded.parsed.config : null;
  const account = config && ctx.account ? ctx.account(config) : null;
  const rc = await requestContext(ctx);
  return { name, config, chatMessages: account?.chatMessages, chats: account?.chats, ai: () => aiFor(ctx), pipelineAi: () => aiFor(ctx, { cap: "app" }), plan: ctx.plan ?? null, openItems: rc.openItems, ...(rc.boundary ? { boundary: rc.boundary } : {}) };
}
