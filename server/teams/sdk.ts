// TB-1: the Teams SDK (@microsoft/teams.apps 2.1.1, pinned; its packages are used only in server/teams) mounted on
// FocusTime's own HTTP server: `app.initialize()` registers the messaging route on our adapter; `app.start()` is
// never called and no second port is opened. The SDK checks each incoming activity's token (Bot Framework's signed
// JWT: issuer, audience = the bot's app id, signature, expiry, the serviceUrl claim) and answers 401 when it fails;
// only then does the bot core (server/teams/bot.ts) see the activity, and the gate pins the tenant on top.
//
// The SDK's logger is replaced by one that drops every argument it is given (activity bodies, tokens, headers): only a
// fixed kind for its errors and warnings reaches FocusTime's log. Replies go through the SDK's connector client with
// the bot's own token from its managed identity (handed in as `token`, for the Bot Framework scope only).
import type { IncomingMessage, ServerResponse } from "node:http";
import { App, type HttpRouteHandler, type IHttpServerAdapter } from "@microsoft/teams.apps";
import { PUBLIC, withOverrides, type CloudEnvironment } from "@microsoft/teams.api";
import type { ILogger } from "@microsoft/teams.common";
import type { Logger } from "../../log/logger.ts";
import { TEAMS_BOT_PATH } from "../guard.ts";
import type { BotCore, OutActivity, Sender } from "./bot.ts";

/** The bot's messaging endpoint on the app (the Azure Bot's endpoint is <public URL> + this). */
export const BOT_PATH = TEAMS_BOT_PATH;
/** The only scope the bot's token is ever asked for: Bot Framework's (replies and card updates). */
export const BOT_SCOPE = "https://api.botframework.com/.default";
const MAX_BODY = 512 * 1024;

/** A logger for the SDK that keeps nothing it is handed: no bodies, tokens, headers or text. */
export function quietLogger(log: Logger): ILogger {
  const self: ILogger = {
    debug: () => {},
    info: () => {},
    trace: () => {},
    warn: () => log({ source: "server", op: "teams_sdk", kind: "warn" }),
    error: () => log({ source: "server", op: "teams_sdk", kind: "error" }),
    log: (level) => {
      if (level === "error" || level === "warn") log({ source: "server", op: "teams_sdk", kind: level });
    },
    child: () => self,
  };
  return self;
}

/** The SDK's transport seam, on our server: it keeps the one route the SDK registers and nothing else. */
class FocusTimeAdapter implements IHttpServerAdapter {
  handler: HttpRouteHandler | null = null;
  registerRoute(method: "POST", path: string, handler: HttpRouteHandler): void {
    if (method === "POST" && path === BOT_PATH) this.handler = handler;
  }
}

async function readBody(req: IncomingMessage): Promise<string | null> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) return null;
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export type TeamsEndpointOptions = {
  /** The bot's Microsoft App ID (its managed identity's client id). */
  appId: string;
  /** Cooptimize's tenant. */
  tenantId: string;
  /** A Bot Framework token from the bot's managed identity. */
  token: (scope: string) => Promise<string>;
  log: Logger;
  /** The bot core, given the sender it replies with. */
  core: (sender: Sender) => BotCore;
  /** Tests: Bot Framework's OpenID metadata and issuer at a local address. */
  cloud?: Partial<CloudEnvironment>;
};

export async function createTeamsEndpoint(o: TeamsEndpointOptions) {
  const adapter = new FocusTimeAdapter();
  const app = new App({
    clientId: o.appId,
    tenantId: o.tenantId,
    token: async (scope) => {
      const s = Array.isArray(scope) ? scope : [scope];
      if (s.length !== 1 || s[0] !== BOT_SCOPE) throw new Error("The bot only asks for the Bot Framework scope");
      return o.token(BOT_SCOPE);
    },
    logger: quietLogger(o.log),
    httpServerAdapter: adapter,
    messagingEndpoint: BOT_PATH,
    cloud: o.cloud ? withOverrides(PUBLIC, o.cloud) : PUBLIC,
  });
  const to = (serviceUrl: string, conversationId: string) => app.api.clone({ serviceUrl }).conversations.activities(conversationId);
  const sender: Sender = {
    async send(addr, a: OutActivity) {
      const r = await to(addr.serviceUrl, addr.conversationId).create(a as never);
      return { id: (r as { id?: string } | undefined)?.id ?? null };
    },
    async update(addr, activityId, a: OutActivity) {
      await to(addr.serviceUrl, addr.conversationId).update(activityId, a as never);
    },
  };
  const core = o.core(sender);
  // An invoke's answer goes back as HTTP 200 with the Universal Action body; anything else is a plain 200.
  app.use(async (ctx) => {
    const r = await core.activity(ctx.activity as never);
    return r ? ({ status: 200, body: r } as never) : undefined;
  });
  await app.initialize();
  if (!adapter.handler) throw new Error("The Teams SDK didn't register its messaging route");
  const handler = adapter.handler;

  /** POST /teams/messages: the body is read, handed to the SDK (token check, then the bot), and its answer written. */
  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== "POST") {
      res.writeHead(405, { allow: "POST" });
      return void res.end();
    }
    const raw = await readBody(req);
    let body: unknown;
    try {
      body = raw === null ? undefined : JSON.parse(raw);
    } catch {
      body = undefined;
    }
    if (!body || typeof body !== "object") {
      res.writeHead(raw === null ? 413 : 400);
      return void res.end();
    }
    const headers: Record<string, string | string[]> = {};
    for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) headers[k.toLowerCase()] = v;
    const r = await handler({ body, headers });
    if (r.status === 401) o.log({ source: "auth", op: "teams_token", kind: "rejected", status: 401 });
    res.writeHead(r.status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(r.body === undefined ? undefined : JSON.stringify(r.body));
  };
}
export type TeamsHandler = Awaited<ReturnType<typeof createTeamsEndpoint>>;
