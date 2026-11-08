// AS-3: the assistant's golden set against a running FocusTime, for a person to read (not in CI). It opens a demo
// session the way a browser does ("Try the demo": fictional data only), asks the golden questions in order (a
// follow-up right after the request it follows), prints each answer (the reply, its sections, its suggestions, any
// proposal's title) and how it came back, then signs the demo session out. On dev, a demo session's AI is the app's
// real model under the usual switches and caps (DM-1), falling back to the stored sample when it is off or slow; the
// result header says which, from the AI log's counts.
//
//   node scripts/assistant-eval.ts --url https://<dev host>              the golden set
//   node scripts/assistant-eval.ts --url https://<dev host> --only 1,3   some of it
//
// It sends nothing but requests to that URL, and prints no cookie or token. Proposals are never confirmed.
export {};

type Section = { kind: "section"; title: string; lines: { text: string }[] };
type Card = { kind: string; title?: string; text?: string; choices?: { label: string }[]; lines?: { text: string }[]; id?: number };
type Result = { status: string; reply: string; cards: Card[]; proposals: { title: string }[]; links: { label: string }[] };

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? null) : null;
};
const base = (arg("url") ?? "").replace(/\/+$/, "");
if (!/^https?:\/\/[^/]+$/.test(base)) {
  console.error("Usage: node scripts/assistant-eval.ts --url https://<host> [--only 1,3]");
  process.exit(2);
}
const only = (arg("only") ?? "").split(",").map(Number).filter(Boolean);

const jar = new Map<string, string>();
const keep = (r: Response) => {
  for (const c of r.headers.getSetCookie?.() ?? []) {
    const [kv] = c.split(";");
    const at = kv!.indexOf("=");
    if (at > 0) jar.set(kv!.slice(0, at).trim(), kv!.slice(at + 1).trim());
  }
};
const headers = () => ({ origin: base, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "), "content-type": "application/json", "x-csrf": [...jar].find(([k]) => /csrf/i.test(k))?.[1] ?? "" });
async function call<T>(action: string, input: Record<string, unknown> = {}): Promise<T> {
  const r = await fetch(`${base}/api/action`, { method: "POST", headers: headers(), body: JSON.stringify({ action, input }), signal: AbortSignal.timeout(60_000) });
  keep(r);
  const b = (await r.json().catch(() => null)) as { ok?: boolean; data?: T; status?: number; error?: string } | null;
  if (!b?.ok) throw new Error(`${action} answered ${b?.status ?? r.status}${b?.error ? `: ${b.error}` : ""}`);
  return b.data as T;
}

const start = await fetch(`${base}/auth/demo`, { method: "POST", headers: headers(), body: "{}", redirect: "manual", signal: AbortSignal.timeout(60_000) });
keep(start);
if (start.status >= 400) {
  console.error(`Try the demo answered ${start.status}`);
  process.exit(1);
}

// The demo's own clients stand in for the golden set's real ones (the demo's are fictional).
const week = await call<{ clients: Record<string, string> }>("week.load", {});
const names = Object.values(week.clients ?? {});
const [A = "the first client", B = names[0] ?? "the second client"] = names;
const ahead = await call<{ clients: { clientKey: string; items: { id: number; title: string; type: string; level: string }[] }[] }>("ahead.load", {}).catch(() => ({ clients: [] }));
const feature = ahead.clients.flatMap((c) => c.items).find((i) => i.level === "parent")?.title ?? "the export";
const story = ahead.clients.flatMap((c) => c.items).find((i) => i.level === "child")?.title ?? "the export";

/** The golden set, in order: the six from the brief (with the demo's names), then the others. Follow-ups come right after their request. */
const GOLDEN: { n: number; say: string; note?: string }[] = [
  { n: 1, say: "I'm planning next week. What should I look out for?" },
  { n: 2, say: "What can you help me with here exactly?" },
  { n: 4, say: `Move the ${feature.split(" ").slice(0, 2).join(" ").toLowerCase()} things to Friday AM`, note: "request 4 in loose words" },
  { n: 3, say: `Can't you read that the Feature name they're under is ${feature.toLowerCase()}?`, note: "a follow-up to the request above" },
  { n: 5, say: "Move all the items I have on my Wednesday PM block to Friday AM" },
  { n: 6, say: `Mark the user story for ${story} as complete and add a comment that the stored procedure has the requested fields` },
  { n: 7, say: "What's on my plate tomorrow?" },
  { n: 8, say: "Which promises are late?" },
  { n: 9, say: `What's not ready for the ${B} work next week?` },
  { n: 10, say: "Do I have any deployments this weekend?" },
  { n: 11, say: "Which features still need an update for Monday?" },
  { n: 12, say: `What did I get done this week for ${A}?` },
  { n: 13, say: "What am I waiting on?" },
  { n: 14, say: `How is the ${A} work looking next week?` },
];

const print = (n: number, said: string, r: Result, ms: number, note?: string) => {
  const out: string[] = [`\n## ${n}. ${said}${note ? `  (${note})` : ""}`, `status ${r.status} · ${ms} ms`, `> ${r.reply}`];
  for (const c of r.cards) {
    if (c.kind === "section") out.push(`  ${(c as Section).title}`, ...(c as Section).lines.map((l) => `    - ${l.text}`));
    else if (c.kind === "suggest" || c.kind === "question") out.push(`  [${c.kind}] ${c.text ?? ""}`, ...(c.choices ?? []).map((x) => `    ( ${x.label} )`));
    else out.push(`  [${c.kind}] ${c.title ?? c.text ?? (c.id ? `#${c.id}` : "")}`);
  }
  for (const p of r.proposals) out.push(`  [proposal, not confirmed] ${p.title}`);
  if (r.links.length) out.push(`  links: ${r.links.map((l) => l.label).join(" · ")}`);
  console.log(out.join("\n"));
};

console.log(`# AS-3 golden set on ${base} (a demo session; ${names.length} demo clients)`);
for (const g of GOLDEN) {
  if (only.length && !only.includes(g.n) && !(g.n === 4 && only.includes(3))) continue;
  const t = Date.now();
  try {
    const r = await call<Result>("assistant.ask", { text: g.say, context: { screen: "#/week" } });
    print(g.n, g.say, r, Date.now() - t, g.note);
  } catch (e) {
    console.log(`\n## ${g.n}. ${g.say}\n  failed: ${e instanceof Error ? e.message : "?"}`);
  }
}
await fetch(`${base}/auth/logout`, { method: "POST", headers: headers(), body: "{}", redirect: "manual" }).catch(() => null);
console.log("\nThe demo session is signed out. Nothing was confirmed.");
