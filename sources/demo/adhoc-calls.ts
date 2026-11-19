// MC-2c: the demo's calls started in Northwind's delivery chat, and what Microsoft would answer for their transcripts.
// The real ad hoc call client (its gate, its two requests, its errors) on a pretend Graph in memory: nothing leaves
// FocusTime. Four calls, all fictional:
//   clean     reviews cleanly (one transcript, speakers named)
//   unnamed   the organization doesn't allow speaker names: Teams answers 403 SpeakerAttributionNotAllowed, then gives
//             the transcript in its format without them
//   refused   Microsoft doesn't let this sign-in read it (403)
//   none      no transcript-is-ready event came, so Calls never lists it
// The seed (sources/demo/seeds/cowork.ts) records them as the poll would: started and ended events, and the
// transcript-is-ready events of the first three.
import { createAdhocCallsClient, UNNAMED_FORMAT, type AdhocCallsClient, type AdhocGate } from "../graph/adhoc-calls.ts";

export const DEMO_CHAT_CALLS = {
  clean: "demo-chat-call-clean",
  unnamed: "demo-chat-call-unnamed",
  refused: "demo-chat-call-refused",
  none: "demo-chat-call-none",
} as const;
export const DEMO_CHAT_CALL_CHAT = "19:demo-northwind-delivery@thread.v2";

const VTT = [
  "WEBVTT",
  "",
  "00:00:04.000 --> 00:00:09.000",
  "<v Alex Rivera>Quick one on the rates export. The carrier file changed its date format again.</v>",
  "",
  "00:00:12.000 --> 00:00:18.000",
  "<v Jordan Lee>I saw that. We should add a check that rejects the file instead of loading bad dates.</v>",
  "",
  "00:00:21.000 --> 00:00:27.000",
  "<v Priya Shah>I'll write that up as a story under the rates export feature today.</v>",
  "",
  "00:00:31.000 --> 00:00:36.000",
  "<v Alex Rivera>Good. I'll tell Dana the import is paused until it's in.</v>",
  "",
].join("\n");

const UNNAMED = [
  "00:00:03.000 --> 00:00:08.000 ",
  "",
  "Let's go through the open questions on the holiday calendar import. ",
  "",
  "00:00:10.000 --> 00:00:15.000 ",
  "",
  "The client wants regional holidays too, not just national ones. ",
  "",
  "00:00:18.000 --> 00:00:23.000 ",
  "",
  "Then we need a field for the region on each holiday. I'll add it to the feature. ",
  "",
].join("\n");

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

/** The pretend Graph: answers only the two requests the client may send, by call id. */
async function demoGraph(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = String(input);
  const accept = String((init?.headers as Record<string, string> | undefined)?.accept ?? "");
  const m = /\/me\/adhocCalls\/([^/?#]+)\/transcripts(?:\/([^/?#]+)\/content)?/.exec(url);
  const callId = m ? decodeURIComponent(m[1]!) : "";
  if (callId === DEMO_CHAT_CALLS.refused) return json({ error: { code: "Forbidden", message: "Demo" } }, 403);
  if (callId !== DEMO_CHAT_CALLS.clean && callId !== DEMO_CHAT_CALLS.unnamed) return json({ error: { code: "NotFound", message: "Demo" } }, 404);
  if (!m![2]) return json({ value: [{ id: `${callId}-transcript`, createdDateTime: "2026-11-04T19:05:00Z" }] });
  if (callId === DEMO_CHAT_CALLS.unnamed) {
    if (accept !== UNNAMED_FORMAT) return json({ error: { code: "Forbidden", message: "Demo", innerError: { code: "SpeakerAttributionNotAllowed" } } }, 403);
    return new Response(UNNAMED, { headers: { "content-type": UNNAMED_FORMAT } });
  }
  return new Response(VTT, { headers: { "content-type": "text/vtt" } });
}

/** The demo person's chat call transcript client, behind the same press gate as the hosted app's. */
export function demoAdhocCalls(gate: AdhocGate): AdhocCallsClient {
  return createAdhocCallsClient({ fetch: demoGraph as typeof fetch, token: async () => "demo", invalidate: () => {}, gate, log: () => {} });
}
