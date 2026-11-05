// DM-1: the demo preflight. `npm run demo:check -- --url https://<host> [--sha <commit>]` opens a demo session on that
// FocusTime the way a browser does and prints a pass/fail list: the site is up, it runs the expected build, the demo's
// story is there (Today, Week, Inbox, Ahead), an AI answer comes back (real or the stored sample) in time, and Reset
// demo puts a change back in under 5 seconds. It signs the demo session out at the end. It sends nothing but requests
// to that URL, and prints no cookie, token or response body (only counts, names of checks and timings).
export {};

type Check = { name: string; ok: boolean; detail: string };

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? null) : null;
};
const base = (arg("url") ?? "").replace(/\/+$/, "");
const sha = arg("sha");
if (!/^https?:\/\/[^/]+$/.test(base)) {
  console.error("Usage: npm run demo:check -- --url https://<host> [--sha <commit>]");
  process.exit(2);
}

const checks: Check[] = [];
const pass = (name: string, detail = "") => void checks.push({ name, ok: true, detail });
const fail = (name: string, detail: string) => void checks.push({ name, ok: false, detail });

const jar = new Map<string, string>();
const cookies = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
const keep = (r: Response) => {
  for (const c of r.headers.getSetCookie?.() ?? []) {
    const [kv] = c.split(";");
    const at = kv!.indexOf("=");
    if (at > 0) jar.set(kv!.slice(0, at).trim(), kv!.slice(at + 1).trim());
  }
};
const csrf = () => [...jar].find(([k]) => /csrf/i.test(k))?.[1] ?? "";
const headers = () => ({ origin: base, cookie: cookies(), "content-type": "application/json", "x-csrf": csrf() });

async function timed<T>(f: () => Promise<T>): Promise<[T, number]> {
  const t = Date.now();
  const v = await f();
  return [v, Date.now() - t];
}
async function call<T = Record<string, unknown>>(action: string, input: Record<string, unknown> = {}): Promise<T> {
  const r = await fetch(`${base}/api/action`, { method: "POST", headers: headers(), body: JSON.stringify({ action, input }), signal: AbortSignal.timeout(30_000) });
  keep(r);
  const b = (await r.json().catch(() => null)) as { ok?: boolean; data?: T; status?: number } | null;
  if (!b?.ok) throw new Error(`${action} answered ${b?.status ?? r.status}`);
  return b.data as T;
}
async function step(name: string, f: () => Promise<string | void>) {
  try {
    pass(name, (await f()) ?? "");
  } catch (e) {
    fail(name, e instanceof Error ? e.message : "failed");
  }
}

await step("The site is up", async () => {
  const [r, ms] = await timed(() => fetch(`${base}/healthz`, { signal: AbortSignal.timeout(60_000) }));
  if (!r.ok) throw new Error(`/healthz answered ${r.status}`);
  return `${ms} ms${ms > 5000 ? " (it was cold: warm it a few minutes before)" : ""}`;
});
await step("It runs the expected build", async () => {
  const v = (await (await fetch(`${base}/version`, { signal: AbortSignal.timeout(15_000) })).json()) as { sha?: string; env?: string; pr?: string };
  const got = String(v.sha ?? "unknown");
  if (sha && !(got.startsWith(sha) || sha.startsWith(got))) throw new Error(`runs ${got}, expected ${sha}`);
  return `${v.env ?? "?"} · ${got}${sha ? "" : " (pass --sha to compare)"}`;
});
await step("Try the demo signs in", async () => {
  const r = await fetch(`${base}/auth/demo`, { method: "POST", headers: { origin: base, "content-type": "application/json" }, body: "{}", signal: AbortSignal.timeout(60_000) });
  keep(r);
  if (!r.ok) throw new Error(`/auth/demo answered ${r.status}`);
  if (!csrf()) throw new Error("no session came back");
});
const signedIn = checks.at(-1)?.ok === true;

if (signedIn) {
  await step("Today and Week have the demo's week", async () => {
    const w = await call<{ week: { days: { pto: unknown }[] }; openFollowUps: number; promises?: unknown }>("week.load", {});
    if (w.week.days.length < 5) throw new Error("the week has no days");
    if (!w.week.days.some((d) => d.pto)) throw new Error("no PTO day this week");
    return `${w.openFollowUps} follow-ups open`;
  });
  await step("Inbox has a conversation that needs you and two promises", async () => {
    const c = await call<{ needsYou: unknown[]; inProgress: unknown[]; teammates: unknown[] }>("conversations.list", {});
    const p = await call<{ promises: unknown[] }>("my_promises.list", {});
    if (!c.needsYou.length) throw new Error("no conversation needs you");
    if (p.promises.length < 2) throw new Error(`${p.promises.length} promises`);
    return `${c.needsYou.length} need you, ${c.inProgress.length} in progress, ${c.teammates.length} with teammates, ${p.promises.length} promises`;
  });
  await step("Ahead has its changes to save", async () => {
    const a = await call<{ changes: unknown[]; clients: unknown[] }>("ahead.load", {});
    if (!a.clients.length) throw new Error("no clients in Ahead");
    return `${a.clients.length} clients, ${a.changes.length} changes staged`;
  });
  await step("AI answers (real, or the stored sample in time)", async () => {
    const [d, ms] = await timed(() => call<{ cards: unknown[] }>("stories.run", { clientKey: "Northwind", featureId: 1120 }));
    const s = await call<{ ai: { realProvider: boolean; real: number; samples: number; lastReason: string | null } }>("demo.status", {});
    if (!d.cards.length) throw new Error("Break down came back empty");
    if (ms > 10_000) throw new Error(`took ${ms} ms`);
    const how = s.ai.real > 0 ? "real AI" : `stored samples (${s.ai.lastReason ?? "no reason"})`;
    return `${d.cards.length} cards in ${ms} ms from ${how}`;
  });
  await step("Reset demo puts it back in under 5 seconds", async () => {
    const before = (await call<{ captures: number }>("week.load", {})).captures;
    await call("capture.add", { text: "Preflight check capture", clientKey: "Northwind" });
    const [r, ms] = await timed(() => call<{ ms: number }>("demo.reset", {}));
    const after = (await call<{ captures: number }>("week.load", {})).captures;
    if (after !== before) throw new Error(`captures ${after}, expected ${before}`);
    if (ms > 5000) throw new Error(`took ${ms} ms`);
    return `${r.ms} ms on the server, ${ms} ms here`;
  });
  await fetch(`${base}/auth/logout`, { method: "POST", headers: headers(), body: "{}" }).catch(() => null);
}

const width = Math.max(...checks.map((c) => c.name.length));
for (const c of checks) console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name.padEnd(width)}  ${c.detail}`);
const failed = checks.filter((c) => !c.ok).length;
console.log(failed ? `\n${failed} of ${checks.length} failed` : `\nAll ${checks.length} passed`);
process.exit(failed ? 1 : 0);
