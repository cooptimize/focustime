// VM-4 STEP 0.5: the leads for production's flaky VM chip (Nov 17, docs/ux/vm4/what-happened.md), each shown or ruled
// out. What the logs showed: after the 21:08 restart and the sign-ins at 21:10 and 21:13, about one read in four of
// the VM's state answered 403 in about 60 ms, the same token answering 200 a minute before and after; no token
// refresh failed, no read timed out, Azure never said it was busy, and no background pass ran long. FocusTime's part:
// one failed read showed Unknown at once and kept it for a minute. Fictional data only.
import { describe, expect, it } from "vitest";
import { backgroundPolicy } from "../config/background-policy.ts";
import { createAzureClient, AzureError } from "../sources/azure/client.ts";
import { createOAuthClient, microsoftProvider, AuthFailure, type Keyring } from "../sources/oauth/oauth.ts";
import { problemOf } from "../actions/vm-actions.ts";
import { createScheduler } from "./scheduler.ts";
import type { PersonTicks } from "./ticks.ts";

const SUB = "00000000-0000-4000-8000-0000000000aa";
const VM_URL = `https://management.azure.com/subscriptions/${SUB}/resourceGroups/rg-dev/providers/Microsoft.Compute/virtualMachines/vm-pat-01/instanceView?api-version=2026-04-01`;
const ref = { id: `/subscriptions/${SUB}/resourceGroups/rg-dev/providers/Microsoft.Compute/virtualMachines/vm-pat-01`, subscriptionId: SUB, resourceGroup: "rg-dev", name: "vm-pat-01" };

describe("lead 1: a token near its end (refreshed within 5 minutes of expiring, after reading the stored sign-in)", () => {
  const provider = microsoftProvider({ tenantId: "11111111-1111-4111-8111-111111111111", clientId: "44444444-4444-4444-8444-444444444444" } as never);
  const tokenFetch = (answers: number[]) => {
    let n = 0;
    const calls = { n: 0 };
    const f = (async () => {
      calls.n++;
      const status = answers[Math.min(n++, answers.length - 1)]!;
      return new Response(JSON.stringify(status === 200 ? { access_token: `AT-${n}`, expires_in: 3600, refresh_token: "RT" } : { error: "invalid_request" }), { status, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    return { f, calls };
  };

  it("near the end it reads the stored sign-in and refreshes; a stored sign-in that can't be read is a failure to reach it, not Azure's 403", async () => {
    let t = 0;
    const keyring: Keyring = { get: async () => { throw new Error("store unavailable"); }, set: async () => {}, delete: async () => {} };
    const { f } = tokenFetch([200]);
    const c = createOAuthClient(provider, { fetch: f, keyring, openBrowser: async () => {}, log: () => {}, now: () => t });
    const e = await c.accessToken("arm").catch((x: unknown) => x);
    expect(e).toBeInstanceOf(AuthFailure);
    // The chip says it can't reach (the store is usually back in a moment), never "Azure refused": production's 403s
    // were not this, and no stored sign-in read failed on Nov 17.
    expect(problemOf(e)).toBe("network");
    expect((e as AuthFailure).kind).toBe("keyring");
    t += 1;
  });

  it("a refresh and a background pass refreshing at once: both get a token (two refreshes), neither fails", async () => {
    let t = 0;
    const keyring: Keyring = { get: async () => "RT", set: async () => {}, delete: async () => {} };
    const { f, calls } = tokenFetch([200, 200]);
    const c = createOAuthClient(provider, { fetch: f, keyring, openBrowser: async () => {}, log: () => {}, now: () => t });
    const [a, b] = await Promise.all([c.accessToken("arm"), c.accessToken("arm")]);
    expect(typeof a).toBe("string");
    expect(typeof b).toBe("string");
    expect(calls.n).toBe(2);
    // Within the last 5 minutes of the hour, the next ask refreshes again.
    t += 56 * 60_000;
    await c.accessToken("arm");
    expect(calls.n).toBe(3);
  });

  it("a refresh that Microsoft refuses is a sign-in failure (production: every refresh on Nov 17 answered 200)", async () => {
    const keyring: Keyring = { get: async () => "RT", set: async () => {}, delete: async () => {} };
    const { f } = tokenFetch([400]);
    const c = createOAuthClient(provider, { fetch: f, keyring, openBrowser: async () => {}, log: () => {} });
    const e = await c.accessToken("arm").catch((x: unknown) => x);
    expect(e).toBeInstanceOf(AuthFailure);
    expect(problemOf(e)).toBe("sign_in");
  });
});

describe("lead 2: Azure itself", () => {
  it("a read cut off at the client's time limit is 'can't reach Azure' (none on Nov 17: the slowest read took 6 s of 20)", async () => {
    const hang = ((_u: string, init: RequestInit) => new Promise<Response>((_ok, fail) => init.signal?.addEventListener("abort", () => fail(new DOMException("timeout", "TimeoutError"))))) as unknown as typeof fetch;
    const c = createAzureClient({ fetch: hang, token: async () => "T", log: () => {}, timeoutMs: 30 });
    const e = await c.power(ref).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(AzureError);
    expect(problemOf(e)).toBe("network");
  });

  it("Azure saying it is busy (429) is 'Azure is busy' (none on Nov 17)", async () => {
    const busy = (async () => new Response(JSON.stringify({ error: { code: "TooManyRequests" } }), { status: 429 })) as unknown as typeof fetch;
    const e = await createAzureClient({ fetch: busy, token: async () => "T", log: () => {} }).power(ref).catch((x: unknown) => x);
    expect(problemOf(e)).toBe("busy");
  });

  it("shown: a 403 from Azure on a read of the VM's own state is 'Azure refused', and its code is now in the log", async () => {
    const logs: { kind?: string; status?: number | string }[] = [];
    let n = 0;
    // Nov 17: the same token answered 200, then 403, then 200.
    const flaky = (async (u: string) => {
      expect(u).toBe(VM_URL);
      return n++ % 2 ? new Response(JSON.stringify({ error: { code: "AuthorizationFailed" } }), { status: 403 }) : new Response(JSON.stringify({ statuses: [{ code: "PowerState/running" }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const c = createAzureClient({ fetch: flaky, token: async () => "SAME-TOKEN", log: (r) => void logs.push(r) });
    expect(await c.power(ref)).toBe("running");
    const e = await c.power(ref).catch((x: unknown) => x);
    // VM-6: AuthorizationFailed now says Azure's reason (not allowed right now); production's 403s had no code.
    expect(problemOf(e)).toBe("not_allowed");
    expect(await c.power(ref)).toBe("running");
    expect(logs.map((l) => [l.status, l.kind ?? null])).toEqual([[200, null], [403, "AuthorizationFailed"], [200, null]]);
  });
});

describe("lead 3: the scheduler's new shape", () => {
  it("a background pass stuck past its limit holds no request: a read answers at once while it waits (none ran long on Nov 17)", async () => {
    const stuck: PersonTicks = { fast: async () => {}, slow: () => new Promise<void>(() => {}), early: () => new Promise<void>(() => {}), wake: async () => null } as unknown as PersonTicks;
    const s = createScheduler({ policy: backgroundPolicy({ FOCUSTIME_ENV: "prod" }), people: () => [stuck], log: () => {}, limits: { fastPass: 40, slowPass: 40, job: 20, early: 20, wake: 20, maintenance: 20 } });
    const pass = s.pass("slow");
    const started = performance.now();
    const read = await createAzureClient({ fetch: (async () => new Response(JSON.stringify({ statuses: [{ code: "PowerState/running" }] }), { status: 200 })) as unknown as typeof fetch, token: async () => "T", log: () => {} }).power(ref);
    expect(read).toBe("running");
    expect(performance.now() - started).toBeLessThan(200);
    await pass;
  });
});
