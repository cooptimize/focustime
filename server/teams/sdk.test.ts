// TB-1: the Teams SDK's token check on our own server, against a local Bot Framework key server (the real validator,
// only its metadata URL moved): a valid token reaches the bot, anything else is a 401 and the bot never sees it. And a
// reply goes out through the SDK's connector client with the bot's own token, for the Bot Framework scope only.
import { createServer, type Server } from "node:http";
import { generateKeyPairSync, createSign, type KeyObject } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { onFreePort } from "../../test/ports.ts";
import type { LogRecord } from "../../log/logger.ts";
import type { BotCore, InActivity, Sender } from "./bot.ts";
import { BOT_PATH, BOT_SCOPE, createTeamsEndpoint } from "./sdk.ts";

const APP_ID = "11111111-2222-3333-4444-555555555555";
const TENANT = "abf29d42-0000-0000-0000-000000000001";
const ISSUER = "https://api.botframework.com";
const SECRET_TEXT = "please move the dentist thing";

const good = generateKeyPairSync("rsa", { modulusLength: 2048 });
const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
/** Published by Bot Framework but endorsed for another channel only, and one with no endorsements. */
const webchat = generateKeyPairSync("rsa", { modulusLength: 2048 });
const bare = generateKeyPairSync("rsa", { modulusLength: 2048 });
const b64 = (v: string | Buffer) => Buffer.from(v).toString("base64url");
function jwt(claims: Record<string, unknown>, key: KeyObject = good.privateKey, kid = "k1") {
  const h = b64(JSON.stringify({ alg: "RS256", typ: "JWT", kid }));
  const p = b64(JSON.stringify(claims));
  const s = createSign("RSA-SHA256").update(`${h}.${p}`).sign(key);
  return `${h}.${p}.${b64(s)}`;
}

let keys: Server;
let keysUrl = "";
let connector: Server;
let connectorUrl = "";
const connectorCalls: { path: string; auth: string | undefined; body: unknown }[] = [];
let app: Server;
let appUrl = "";
const seen: InActivity[] = [];
const logs: LogRecord[] = [];
const tokenScopes: string[] = [];
let sender: Sender | null = null;
/** The bot's own token (what its managed identity would give), JWT-shaped as the SDK expects. */
const BOT_TOKEN = jwt({ aud: "https://api.botframework.com", exp: Math.floor(Date.now() / 1000) + 3600, appid: APP_ID }, other.privateKey, "mi");

const listen = (s: Server) => onFreePort((port) => new Promise<number>((ok, fail) => (s.once("error", fail), s.listen(port, "127.0.0.1", () => ok(port)))));

beforeAll(async () => {
  keys = createServer((req, res) => {
    const jwk = { ...good.publicKey.export({ format: "jwk" }), kid: "k1", use: "sig", alg: "RS256", endorsements: ["msteams", "webchat"] };
    const wjwk = { ...webchat.publicKey.export({ format: "jwk" }), kid: "k2", use: "sig", alg: "RS256", endorsements: ["webchat", "skype"] };
    const bjwk = { ...bare.publicKey.export({ format: "jwk" }), kid: "k3", use: "sig", alg: "RS256" };
    res.writeHead(200, { "content-type": "application/json" });
    const meta = { issuer: ISSUER, jwks_uri: `${keysUrl}/v1/.well-known/keys`, id_token_signing_alg_values_supported: ["RS256"] };
    res.end(JSON.stringify(req.url?.endsWith("/openidconfiguration") ? meta : { keys: [jwk, wjwk, bjwk] }));
  });
  keysUrl = `http://127.0.0.1:${await listen(keys)}`;
  connector = createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    connectorCalls.push({ path: req.url ?? "", auth: req.headers.authorization, body: JSON.parse(body || "{}") });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "sent-1" }));
  });
  connectorUrl = `http://127.0.0.1:${await listen(connector)}/`;
  const handle = await createTeamsEndpoint({
    appId: APP_ID,
    tenantId: TENANT,
    token: async (scope) => (tokenScopes.push(scope), BOT_TOKEN),
    log: (r) => logs.push(r),
    core: (s): BotCore => {
      sender = s;
      return { activity: async (a: InActivity) => (seen.push(a), null) };
    },
    cloud: { openIdMetadataUrl: `${keysUrl}/v1/.well-known/openidconfiguration`, tokenIssuer: ISSUER },
  });
  app = createServer((req, res) => void handle(req, res));
  appUrl = `http://127.0.0.1:${await listen(app)}`;
});
afterAll(() => {
  for (const s of [keys, connector, app]) s?.close();
});

const activity = (o: Partial<InActivity> = {}): InActivity => ({
  id: `act-${Math.random()}`,
  type: "message",
  text: SECRET_TEXT,
  channelId: "msteams",
  serviceUrl: "https://smba.trafficmanager.net/amer/",
  conversation: { id: "a:1", conversationType: "personal", tenantId: TENANT },
  from: { aadObjectId: "aaaaaaaa-0000-0000-0000-000000000001" },
  recipient: { id: `28:${APP_ID}` },
  ...o,
});
const now = () => Math.floor(Date.now() / 1000);
const claims = (o: Record<string, unknown> = {}) => ({ iss: ISSUER, aud: APP_ID, exp: now() + 600, nbf: now() - 10, serviceurl: "https://smba.trafficmanager.net/amer/", ...o });
const post = (body: unknown, auth?: string) =>
  fetch(`${appUrl}${BOT_PATH}`, { method: "POST", headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) }, body: JSON.stringify(body) });

it("lets a valid Bot Framework token through to the bot", async () => {
  const a = activity();
  const r = await post(a, `Bearer ${jwt(claims())}`);
  expect(r.status).toBe(200);
  expect(seen.map((x) => x.id)).toContain(a.id);
});

it("rejects a missing, forged, expired, wrong-audience, wrong-issuer or wrong-serviceUrl token with 401, before the bot", async () => {
  const before = seen.length;
  const cases: [string, string | undefined][] = [
    ["no header", undefined],
    ["not a jwt", "Bearer nonsense"],
    ["another key", `Bearer ${jwt(claims(), other.privateKey)}`],
    ["expired", `Bearer ${jwt(claims({ exp: now() - 3600, nbf: now() - 7200 }))}`],
    ["audience", `Bearer ${jwt(claims({ aud: "someone-else" }))}`],
    ["issuer", `Bearer ${jwt(claims({ iss: "https://evil.example.com" }))}`],
    ["serviceUrl", `Bearer ${jwt(claims({ serviceurl: "https://elsewhere.example.com/" }))}`],
  ];
  for (const [why, auth] of cases) expect((await post(activity(), auth)).status, why).toBe(401);
  expect(seen.length).toBe(before);
  expect(logs.filter((l) => l.op === "teams_token").every((l) => l.kind === "rejected" || l.kind === "not_endorsed")).toBe(true);
});

it("rejects a token whose signing key doesn't endorse msteams, an Entra-issued token, and a non-Teams activity, with 401 (TB-1b)", async () => {
  const before = seen.length;
  const cases: [string, string, Partial<InActivity>][] = [
    ["endorsed for webchat only", `Bearer ${jwt(claims(), webchat.privateKey, "k2")}`, {}],
    ["no endorsements", `Bearer ${jwt(claims(), bare.privateKey, "k3")}`, {}],
    ["unknown key", `Bearer ${jwt(claims(), other.privateKey, "k9")}`, {}],
    ["Entra issuer", `Bearer ${jwt(claims({ iss: `https://sts.windows.net/${TENANT}/` }))}`, {}],
    ["webchat activity", `Bearer ${jwt(claims())}`, { channelId: "webchat" }],
  ];
  for (const [why, auth, o] of cases) expect((await post(activity(o), auth)).status, why).toBe(401);
  expect(seen.length).toBe(before);
  expect(logs.some((l) => l.op === "teams_token" && l.kind === "not_endorsed")).toBe(true);
});

it("never puts a message's text, a token or a header in the log", async () => {
  await post(activity(), `Bearer ${jwt(claims())}`);
  await post(activity(), "Bearer nonsense");
  const all = JSON.stringify(logs);
  expect(all).not.toContain(SECRET_TEXT);
  expect(all).not.toContain("Bearer");
  expect(all).not.toContain("bot-token-123");
  expect(all).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
});

it("refuses bodies that aren't an activity", async () => {
  const r = await fetch(`${appUrl}${BOT_PATH}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" });
  expect(r.status).toBe(400);
});

it("replies through the connector with the bot's own token, for the Bot Framework scope only", async () => {
  expect(sender).not.toBeNull();
  const r = await sender!.send({ conversationId: "a:1", serviceUrl: connectorUrl }, { type: "message", text: "hi" });
  expect(r.id).toBe("sent-1");
  const call = connectorCalls.at(-1)!;
  expect(decodeURIComponent(call.path)).toContain("/v3/conversations/a:1/activities");
  expect(call.auth).toBe(`Bearer ${BOT_TOKEN}`);
  expect(JSON.stringify(logs)).not.toContain(BOT_TOKEN.slice(0, 40));
  expect(tokenScopes.every((s) => s === BOT_SCOPE)).toBe(true);
});
