// WP-1, WP-2: the page's two downloads, as Markdown. Counts, shares, shapes and meanings across clients; client and
// type names are fine. Never a title, item text, an item id or a person. Team, area and project names only in the scope
// line of a client the person is on. WP-2: the summary opens with what the run covered (clients, each one's scope and
// kinds, items in scope and labeled, the agreement sample), then Build work, then Tickets and support; numbers across
// clients come with and without the largest client, and any figure built on fewer than 20 items says "too few to read".
// Pure.
import { FEW, FEW_WORDS, countWords, shareWords, tooFew, type ClientAnalysis } from "./analysis.ts";
import { KIND_WORDS, type Kind } from "./kinds.ts";
import { analysisScopeWords, type AnalysisScope } from "./scope.ts";
import { STARTING_LIST, WP1_START } from "./labels.ts";
import { PARENT_SHARE_WORDS } from "./levels.ts";
import { sumCoverage, sumResults, topOtherNames, type ClientResults, type Coverage, type Results } from "./results.ts";
import type { Snapshot } from "./inventory.ts";
import type { Platform, TypeList } from "./types.ts";

export type ReportClient = {
  key: string;
  /** The person is on this client: its scope line may name teams and areas. */
  mine: boolean;
  platform: Platform | null;
  scope: AnalysisScope | null;
  analysis: ClientAnalysis | null;
  snapshot: Snapshot | null;
  results: ClientResults | null;
};

const num = (v: number | null | undefined) => (v === null || v === undefined ? "n/a" : String(v));
const cell = (s: string) => s.replace(/\|/g, "/").replace(/\s+/g, " ").trim();
const PLATFORM_WORDS: Record<Platform, string> = { azure: "Azure", fabric: "Fabric", both: "Both" };
const sorted = (m: Record<string, number>, n = 30) => Object.entries(m).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n);
/** A median or other figure from n items: the figure, or "too few to read" under FEW. */
const fig = (v: number | null | undefined, n: number, unit = "") => (v === null || v === undefined ? "n/a" : tooFew(n) ? `${FEW_WORDS} (${n})` : `${v}${unit}`);

function kindsLine(a: ClientAnalysis | null): string {
  if (!a || !a.kinds.length) return "n/a";
  const by = (k: Kind) => a.kinds.filter((r) => r.kind === k).map((r) => cell(r.type));
  return (["build", "tickets", "leave_out"] as const).filter((k) => by(k).length).map((k) => `${KIND_WORDS[k]}: ${by(k).join(", ")}`).join("; ");
}

function coverageRow(label: string, c: Coverage): string {
  return `| ${label} | ${num(c.read)} | ${num(c.outside)} | ${c.inScope} | ${c.leftOut} | ${c.toClassify} | ${c.labeled} | ${c.aiOff} | ${c.failed} | ${c.notReached} |`;
}

/** Pools clients' writing shares, weighting each by its items. */
function pooled(clients: readonly ReportClient[], f: (s: Snapshot) => number | null, n: (s: Snapshot) => number): string {
  let w = 0;
  let t = 0;
  for (const c of clients) {
    const s = c.analysis?.build;
    if (!s) continue;
    const v = f(s);
    if (v === null) continue;
    w += n(s);
    t += v * n(s);
  }
  return shareWords(w ? t / w : null, w);
}

function resultsTables(out: string[], all: Results, rest: Results | null, restName: string | null) {
  const head = rest ? `| | All clients | Without ${cell(restName!)} |` : "| | All clients |";
  const line = rest ? "|---|---|---|" : "|---|---|";
  const row = (k: string, a: number, b: number | null, base: number, baseB: number | null) => `| ${cell(k)} | ${a} (${shareWords(a / (base || 1), base, { base: false })}) |${rest ? ` ${b ?? 0} (${shareWords((b ?? 0) / (baseB || 1), baseB, { base: false })}) |` : ""}`;
  out.push("", "#### Request types", "", head.replace("| |", "| Request type |"), line);
  for (const [k, v] of sorted(all.requestTypes)) out.push(row(k, v, rest ? (rest.requestTypes[k] ?? 0) : null, all.labeled, rest?.labeled ?? null));
  out.push("", "#### Layers", "", head.replace("| |", "| Layer |"), line);
  for (const [k, v] of sorted(all.layers, 20)) out.push(row(k, v, rest ? (rest.layers[k] ?? 0) : null, all.labeled, rest?.labeled ?? null));
  out.push("", "#### Readiness as written", "", head.replace("| |", "| Readiness |"), line);
  for (const [k, v] of sorted(all.readiness, 5)) out.push(row(k, v, rest ? (rest.readiness[k] ?? 0) : null, all.labeled, rest?.labeled ?? null));
  out.push("", "#### What is missing most, by request type", "");
  for (const [t, m] of Object.entries(all.missing).sort(([a], [b]) => a.localeCompare(b))) {
    const n = all.requestTypes[t] ?? 0;
    out.push(`- ${cell(t)} (${countWords(n)}): ${tooFew(n) ? FEW_WORDS : sorted(m, 4).filter(([k]) => k !== "none").slice(0, 3).map(([k, v]) => `${k} (${v})`).join(", ") || "nothing"}`);
  }
  const others = topOtherNames(all);
  out.push("", "#### Most suggested names for \"other\"", "", others.length ? others.map(([k, v]) => `- ${cell(k)} (${countWords(v)})`).join("\n") : "None.");
  out.push("", "#### Common feature shapes", "", `${countWords(all.shapes.parents)} parents with at least two classified children. A shape counted fewer than ${FEW} times is too few to read.`, "", "As a set (the layers touched):", "");
  for (const s of all.shapes.sets) out.push(`- ${cell(s.requestType)}: ${s.shape.join(", ")} (${countWords(s.count)})`);
  out.push("", "As a chain (in the order the children were created):", "");
  for (const s of all.shapes.chains) out.push(`- ${cell(s.requestType)}: ${s.shape.join(" > ")} (${countWords(s.count)})`);
  const a = all.agreement;
  out.push("", `Agreement, on ${a.pairs} items classified twice: request type ${shareWords(a.requestType, a.pairs)}, layers ${shareWords(a.layers, a.pairs)}, readiness ${shareWords(a.readiness, a.pairs)}, missing ${shareWords(a.missing, a.pairs)}, confidence ${shareWords(a.confidence, a.pairs)}.`);
}

export function summaryMarkdown(clients: readonly ReportClient[], at: string, o: { listVersion?: string | null; wp1Labels?: boolean } = {}): string {
  const out: string[] = [
    "# What is in DevOps",
    "",
    `Summary from FocusTime's DevOps patterns page, ${at.slice(0, 10)}. Counts and shares only. Any figure built on fewer than ${FEW} items says "${FEW_WORDS}". ${PARENT_SHARE_WORDS}`,
    "",
    "## What this covers",
    "",
    "| Client | Platform | Scope | Kinds |",
    "|---|---|---|---|",
  ];
  for (const c of clients) out.push(`| ${cell(c.key)} | ${c.platform ? PLATFORM_WORDS[c.platform] : "Not set"} | ${cell(analysisScopeWords(c.scope, { names: c.mine }))} | ${kindsLine(c.analysis)} |`);
  out.push("", "| Client | Read (24 months) | Outside scope | In scope | Left out by kind | To classify | Labeled | AI not allowed | Answer failed its check | Not reached |", "|---|---|---|---|---|---|---|---|---|---|");
  const covs = clients.filter((c) => c.results).map((c) => ({ key: c.key, c: c.results!.coverage }));
  for (const x of covs) out.push(coverageRow(cell(x.key), x.c));
  if (covs.length > 1) out.push(coverageRow("All clients", sumCoverage(covs.map((x) => x.c))));
  const withResults = clients.filter((c) => c.results);
  const agree = sumResults(withResults.flatMap((c) => [c.results!.build, c.results!.tickets])).agreement;
  out.push("", `Agreement sample: ${agree.pairs} items classified twice.${o.listVersion ? ` Request type list: ${o.listVersion === STARTING_LIST.version || o.listVersion === WP1_START ? "the starting list" : `version 2 (${cell(o.listVersion)})`}.` : ""}${o.wp1Labels ? " These labels were made before WP-2's rules (a whole project, no kinds, a type for unclear items): run classification again." : ""}`);

  // The largest client by items in scope: numbers across clients come with and without it.
  const largest = [...withResults].sort((a, b) => b.results!.coverage.inScope - a.results!.coverage.inScope)[0] ?? null;
  const rest = largest && withResults.length > 1 ? withResults.filter((c) => c !== largest) : null;

  out.push("", "## Build work", "", "### Inventory", "", "| Client | First item | Items | With description | With acceptance | Typical children | Main pair | Changed after work started |", "|---|---|---|---|---|---|---|---|");
  for (const c of clients) {
    const s = c.analysis?.build;
    const h = s?.headline;
    const p = h?.mainPair;
    out.push(`| ${cell(c.key)} | ${c.snapshot?.firstItemAt?.slice(0, 10) ?? "n/a"} | ${num(h?.items)} | ${shareWords(h?.description, h?.items)} | ${shareWords(h?.acceptance, h?.items)} | ${fig(h?.typicalChildren, s ? s.breakdown.children.top.n + s.breakdown.children.middle.n : 0)} | ${p ? `${cell(p.parent)} with no ${cell(p.child)}: ${p.without} of ${p.of}${tooFew(p.of) ? `, ${FEW_WORDS}` : ""}` : "n/a"} | ${shareWords(h?.changedAfterStart, s?.afterFact.sampled)} |`);
  }
  if (clients.filter((c) => c.analysis).length > 1) {
    const all = clients.filter((c) => c.analysis);
    const others = largest ? all.filter((c) => c.key !== largest.key) : null;
    const pool = (list: readonly ReportClient[]) => `${list.reduce((t, c) => t + (c.analysis?.build.items ?? 0), 0)} | ${pooled(list, (s) => s.writing.all.description, (s) => s.items)} | ${pooled(list, (s) => s.writing.all.acceptance, (s) => s.items)}`;
    out.push(`| All clients | | ${pool(all)} | | | |`);
    if (others && others.length && largest) out.push(`| Without ${cell(largest.key)} | | ${pool(others)} | | | |`);
  }
  for (const c of clients) {
    const s = c.analysis?.build;
    if (!s) continue;
    out.push("", `#### ${cell(c.key)}`, "", `Types: ${s.types.map((t) => `${cell(t.type)} (${t.level}, ${t.count})`).join(", ") || "none"}.`);
    const pairs = s.breakdown.pairs ?? [];
    if (pairs.length) {
      out.push("", "| Pair | Without | Children per parent |", "|---|---|---|");
      for (const p of pairs) out.push(`| ${cell(p.parent)} with no ${cell(p.child)} | ${p.without} of ${p.of}${tooFew(p.of) ? `, ${FEW_WORDS}` : ""} | ${tooFew(p.of) ? FEW_WORDS : `median ${num(p.children.median)}, 90% at most ${num(p.children.p90)}, most ${num(p.children.max)}`} |`);
    }
    const np = (s.breakdown.noParent ?? []).filter((x) => x.of);
    if (np.length) out.push("", `With no parent: ${np.map((x) => `${cell(x.type)} ${x.count} of ${x.of}${tooFew(x.of) ? ` (${FEW_WORDS})` : ""}`).join(", ")}.`);
    out.push(`Titles: ${Object.entries(s.titles.patterns).map(([k, v]) => `${k.replace("_", " ")} ${v}`).join(", ")}.`);
    out.push(`Created to started: median ${fig(s.timing.createdToStarted.median, s.timing.createdToStarted.n, " days")}. Started to closed: median ${fig(s.timing.startedToClosed.median, s.timing.startedToClosed.n, " days")}. Closed items created and closed the same day: ${shareWords(s.timing.sameDay.of ? s.timing.sameDay.count / s.timing.sameDay.of : null, s.timing.sameDay.of)}.`);
    out.push(`History sample: ${s.afterFact.sampled} closed items, ${s.afterFact.changedAfterStart} changed after work started, ${s.afterFact.emptyAtClose} still empty at close${tooFew(s.afterFact.sampled) ? ` (${FEW_WORDS})` : ""}.`);
  }
  const build = sumResults(withResults.map((c) => c.results!.build));
  if (build.labeled) {
    out.push("", "### Classification", "", `${build.labeled} Build work items labeled${largest && rest ? `; the largest client by items in scope is ${cell(largest.key)}` : ""}.`);
    resultsTables(out, build, rest ? sumResults(rest.map((c) => c.results!.build)) : null, largest?.key ?? null);
  }

  out.push("", "## Tickets and support", "");
  const t = clients.filter((c) => c.analysis && c.analysis.tickets.items);
  if (!t.length) out.push("No type is Tickets and support.");
  else {
    out.push("| Client | Types | Items | Open | Created to closed (median) | Closed the same day | With description |", "|---|---|---|---|---|---|---|");
    for (const c of t) {
      const k = c.analysis!.tickets;
      out.push(`| ${cell(c.key)} | ${k.types.map(cell).join(", ")} | ${k.items} | ${k.open} | ${fig(k.createdToClosed.median, k.createdToClosed.n, " days")} | ${shareWords(k.sameDay.of ? k.sameDay.count / k.sameDay.of : null, k.sameDay.of)} | ${shareWords(k.writing.description, k.items)} |`);
    }
    const tickets = sumResults(withResults.map((c) => c.results!.tickets));
    if (tickets.labeled) {
      const tr = rest ? sumResults(rest.map((c) => c.results!.tickets)) : null;
      out.push("", `${tickets.labeled} Tickets and support items labeled.`, "", "| Request type | All clients |" + (tr ? ` Without ${cell(largest!.key)} |` : ""), tr ? "|---|---|---|" : "|---|---|");
      for (const [k, v] of sorted(tickets.requestTypes, 10)) out.push(`| ${cell(k)} | ${v} (${shareWords(v / tickets.labeled, tickets.labeled, { base: false })}) |${tr ? ` ${tr.requestTypes[k] ?? 0} |` : ""}`);
    }
  }
  return out.join("\n") + "\n";
}

export function typesMarkdown(lists: readonly TypeList[]): string {
  const out: string[] = ["# Request types", ""];
  for (const l of [...lists].reverse()) {
    const start = l.version === STARTING_LIST.version || l.version === WP1_START;
    out.push(`## ${start ? `Starting list (${l.version === WP1_START ? "WP-1" : "WP-2"})` : `Version 2 (${l.createdAt.slice(0, 10)})`}`, "", "| Request type | Meaning | Made-up example |", "|---|---|---|");
    for (const t of l.types) out.push(`| ${cell(t.name)} | ${cell(t.meaning)} | ${cell(t.example)} |`);
    if (l.changes.length) {
      out.push("", "Changes from the starting list:", "");
      for (const c of l.changes) out.push(`- ${c.kind}: ${c.from.map(cell).join(", ") || "(new)"} > ${c.to.map(cell).join(", ")}, ${c.count} items in pass 1. ${cell(c.reason)}`);
    } else if (!start) out.push("", "No changes from the starting list.");
    out.push("");
  }
  return out.join("\n");
}
