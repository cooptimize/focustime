// TB-1b: the key endorsement check's own rules, with a fake keys address: only Bot Framework's issuer, only a key
// that endorses msteams, keys kept a day, an unknown key fetched again at most every 5 minutes, and nothing kept means
// refused. (The real token path is in sdk.test.ts.)
import { expect, it } from "vitest";
import { createEndorsementCheck } from "./endorsements.ts";

const ISS = "https://api.botframework.com";
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
const bearer = (kid: string, iss = ISS) => `Bearer ${b64({ alg: "RS256", kid })}.${b64({ iss })}.sig`;

function setup(keys: () => { kid: string; endorsements?: string[] }[] | null) {
  let t = 0;
  let calls = 0;
  const check = createEndorsementCheck({
    keysUri: "https://keys.example.com/v1/.well-known/keys",
    issuer: ISS,
    now: () => t,
    fetch: (async () => {
      calls++;
      const k = keys();
      return k ? new Response(JSON.stringify({ keys: k })) : new Response("", { status: 503 });
    }) as typeof fetch,
  });
  return { check, calls: () => calls, advance: (ms: number) => (t += ms) };
}

it("passes only a Bot Framework token signed by a key endorsed for msteams, on a Teams activity", async () => {
  const s = setup(() => [{ kid: "a", endorsements: ["msteams"] }, { kid: "b", endorsements: ["webchat"] }, { kid: "c" }]);
  expect(await s.check(bearer("a"), "msteams")).toBe(true);
  expect(await s.check(bearer("b"), "msteams")).toBe(false);
  expect(await s.check(bearer("c"), "msteams")).toBe(false);
  expect(await s.check(bearer("a"), "webchat")).toBe(false);
  expect(await s.check(bearer("a", "https://sts.windows.net/x/"), "msteams")).toBe(false);
  expect(await s.check(undefined, "msteams")).toBe(false);
  expect(await s.check("Bearer nonsense", "msteams")).toBe(false);
});

it("keeps the keys a day, and fetches again early for an unknown key at most every 5 minutes", async () => {
  let set = [{ kid: "a", endorsements: ["msteams"] }];
  const s = setup(() => set);
  await s.check(bearer("a"), "msteams");
  await s.check(bearer("a"), "msteams");
  expect(s.calls()).toBe(1);
  set = [...set, { kid: "new", endorsements: ["msteams"] }];
  expect(await s.check(bearer("new"), "msteams")).toBe(false);
  expect(s.calls()).toBe(1);
  s.advance(5 * 60 * 1000 + 1);
  expect(await s.check(bearer("new"), "msteams")).toBe(true);
  expect(s.calls()).toBe(2);
  s.advance(24 * 60 * 60 * 1000 + 1);
  await s.check(bearer("a"), "msteams");
  expect(s.calls()).toBe(3);
});

it("refuses when the keys can't be fetched and none are kept, and keeps the old keys when a refresh fails", async () => {
  let up = false;
  const s = setup(() => (up ? [{ kid: "a", endorsements: ["msteams"] }] : null));
  expect(await s.check(bearer("a"), "msteams")).toBe(false);
  up = true;
  s.advance(5 * 60 * 1000 + 1);
  expect(await s.check(bearer("a"), "msteams")).toBe(true);
  up = false;
  s.advance(24 * 60 * 60 * 1000 + 1);
  expect(await s.check(bearer("a"), "msteams")).toBe(true);
});
