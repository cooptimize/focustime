// WP-1, WP-2: the page's two downloads, as Markdown. Counts, shares, shapes and meanings across clients; client and
// type names are fine. Never a title, item text, an item id or a person. Team, area and project names only in the scope
// line of a client the person is on. WP-2: the summary opens with what the run covered (clients, each one's scope and
// kinds, items in scope and labeled, the agreement sample), then Build work, then Tickets and support; numbers across
// clients come with and without the largest client, and any figure built on fewer than 20 items says "too few to read".
// WP-3: the summary then says which list the labels are on and the agreement sample as it is ("99 of 100 (1 answer
// failed its check)"); request types, readiness and layers get a column per client; agreement is per missing fact and
// per layer, with the request types the answers disagreed on; the chain view of shapes is gone. The request types
// download lists the list in use first, then earlier lists newest first, each under its own heading. Pure.
import { FEW, FEW_WORDS, countWords, shareWords, tooFew, type ClientAnalysis } from "./analysis.ts";
import { KIND_WORDS, type Kind } from "./kinds.ts";
import { analysisScopeWords, type AnalysisScope } from "./scope.ts";
import { FACT_FEW, MISSING, LAYERS, READINESS, STARTING_LIST, WP1_START, disagreements, factReading, type Agreement } from "./labels.ts";
import { PARENT_SHARE_WORDS } from "./levels.ts";
import { isAiList, isOwned, listWords, ownNumber, rankOf } from "./owned.ts";
import { cellWords, clientTable, readinessByType, sampleWords, sumCoverage, sumResults, topOtherNames, type ClientResults, type Coverage, type Results } from "./results.ts";
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
  return `| ${label} | ${num(c.read)} | ${num(c.outside)} | ${c.inScope} | ${c.leftOut} | ${c.toClassify} | ${c.labeled} | ${c.aiOff} | ${c.failed} | ${c.earlier ?? 0} | ${c.notReached} |`;
}

/** WP-3: "not reliable yet" or "too few to read" beside a fact, or its agreement share. */
export function factNote(a: Agreement, kind: "missing" | "layers", fact: string): string {
  const f = factReading(a.facts?.[kind]?.[fact]);
  if (f.few) return `agreement ${FEW_WORDS} (${f.either})`;
  return `agreement ${Math.round((f.share ?? 0) * 100)}%${f.reliable ? "" : ", not reliable yet"}`;
}

/** WP-3: the one line that says what a fact's agreement means, from the fact seen in the most pairs. */
export function factMeaning(a: Agreement): string | null {
  const top = Object.entries(a.facts?.missing ?? {}).filter(([, v]) => v.either >= FACT_FEW).sort((x, y) => y[1].either - x[1].either)[0];
  if (!top) return null;
  return `When one answer said "${top[0]}" was missing, the other said so too ${Math.round((top[1].both / top[1].either) * 100)}% of the time (${top[1].both} of ${top[1].either} pairs).`;
}

/** WP-3: no shape reaches 20 parents. */
export const NO_COMMON_SHAPE = "No shape appears 20 times. There is no common shape.";

function agreementLines(out: string[], a: Agreement) {
  if (!a.pairs) {
    out.push("", "No item has been classified twice yet.");
    return;
  }
  out.push("", `Whole items, on ${a.pairs} items classified twice: request type ${shareWords(a.requestType, a.pairs)}, readiness ${shareWords(a.readiness, a.pairs)}, confidence ${shareWords(a.confidence, a.pairs)}.`);
  const meaning = factMeaning(a);
  if (meaning) out.push("", meaning);
  for (const [kind, list, title] of [["missing", MISSING, "What is missing"], ["layers", LAYERS, "Layers"]] as const) {
    out.push("", `| ${title} | In either answer | In both | Agreement |`, "|---|---|---|---|");
    for (const f of list) {
      if (f === "none") continue;
      const r = factReading(a.facts?.[kind]?.[f]);
      if (!r.either) continue;
      out.push(`| ${f} | ${r.either} | ${r.both} | ${r.few ? FEW_WORDS : `${Math.round((r.share ?? 0) * 100)}%${r.reliable ? "" : ", not reliable yet"}`} |`);
    }
  }
  const d = disagreements(a);
  out.push("", `Request types the two answers disagreed on: ${d.length ? d.map(([x, y, n]) => `${cell(x)} and ${cell(y)}: ${n}`).join("; ") : "none"}.`);
}

function tableLines(out: string[], title: string, t: ReturnType<typeof clientTable>) {
  out.push("", `#### ${title}`, "", `| | ${t.columns.map(cell).join(" | ")} |`, `|---|${t.columns.map(() => "---").join("|")}|`);
  for (const r of t.rows) out.push(`| ${cell(r.value)} | ${r.cells.map(cellWords).join(" | ")} |`);
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

function resultsTables(out: string[], clients: readonly { key: string; r: Results }[], largest: string | null) {
  const all = sumResults(clients.map((c) => c.r));
  const o = { largest: clients.length > 1 ? largest : null };
  out.push("", `Shares are of each column's labeled items. Any cell whose base is under ${FEW} says "${FEW_WORDS}".`);
  tableLines(out, "Request types", clientTable(clients, (r) => r.requestTypes, o));
  tableLines(out, "Readiness as written", clientTable(clients, (r) => r.readiness, { ...o, rows: READINESS.filter((x) => all.readiness[x]) }));
  tableLines(out, "Layers", clientTable(clients, (r) => r.layers, o));
  out.push("", "#### Readiness by request type, across clients", "", `| Request type | Items | ${READINESS.join(" | ")} |`, `|---|---|${READINESS.map(() => "---").join("|")}|`);
  for (const r of readinessByType(all, READINESS)) out.push(`| ${cell(r.type)} | ${r.items} | ${r.cells.map(cellWords).join(" | ")} |`);
  out.push("", "#### What is missing most, by request type", "", "Each fact with its agreement (the two answers on the agreement sample); under 70% it is not reliable yet.", "");
  for (const [t, m] of Object.entries(all.missing).sort(([a], [b]) => a.localeCompare(b))) {
    const n = all.requestTypes[t] ?? 0;
    out.push(`- ${cell(t)} (${countWords(n)}): ${tooFew(n) ? FEW_WORDS : sorted(m, 4).filter(([k]) => k !== "none").slice(0, 3).map(([k, v]) => `${k} (${v}; ${factNote(all.agreement, "missing", k)})`).join(", ") || "nothing"}`);
  }
  const others = topOtherNames(all);
  out.push("", "#### Most suggested names for \"other\"", "", others.length ? others.map(([k, v]) => `- ${cell(k)} (${countWords(v)})`).join("\n") : "None.");
  for (const c of clients) {
    const top = topOtherNames(c.r, 3);
    if (top.length) out.push(`- ${cell(c.key)}: ${top.map(([k, v]) => `${cell(k)} (${v})`).join(", ")}`);
  }
  out.push("", "#### Common feature shapes", "", `${countWords(all.shapes.parents)} parents with at least two classified children; the layers their children touch, as a set. The ten most common.`, "");
  if (!all.shapes.sets.some((x) => x.count >= FEW)) out.push(NO_COMMON_SHAPE);
  else for (const x of all.shapes.sets) out.push(`- ${cell(x.requestType)}: ${x.shape.join(", ")} (${countWords(x.count)})`);
  out.push("", "#### Agreement");
  agreementLines(out, all.agreement);
}

export function summaryMarkdown(clients: readonly ReportClient[], at: string, o: { listVersion?: string | null; labelsOn?: "in use" | "earlier"; wp1Labels?: boolean } = {}): string {
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
  out.push("", "| Client | Read (24 months) | Outside scope | In scope | Left out by kind | To classify | Labeled | AI not allowed | Answer failed its check | On an earlier list | Not reached |", "|---|---|---|---|---|---|---|---|---|---|---|");
  const covs = clients.filter((c) => c.results).map((c) => ({ key: c.key, c: c.results!.coverage }));
  for (const x of covs) out.push(coverageRow(cell(x.key), x.c));
  if (covs.length > 1) out.push(coverageRow("All clients", sumCoverage(covs.map((x) => x.c))));
  const withResults = clients.filter((c) => c.results);
  const labeledAll = sumResults(withResults.flatMap((c) => [c.results!.build, c.results!.tickets]));
  const v = o.listVersion ?? null;
  const listLine = !v ? "" : o.labelsOn === "earlier" ? `Labels are on ${listWords({ version: v, createdAt: "" }, "").replace(/ \(v2-r\d+\), not in use/, " (not in use)")}, not the list in use: nothing on it could be carried safely. Run classification to label against the list in use.` : `Labels are on the request type list in use, ${listWords({ version: v, createdAt: "" }, v)}.`;
  const fromLines = Object.entries(labeledAll.from ?? {}).filter(([k]) => k !== v).map(([k, n]) => `${n} made on ${isOwned(k) ? `version ${ownNumber(k)}` : isAiList(k) ? "the list written by AI" : k === STARTING_LIST.version || k === WP1_START ? "a starting list" : k}`);
  const rerun = Object.values(labeledAll.rerun ?? {}).reduce((t, n) => t + (n ?? 0), 0);
  const earlier = covs.reduce((t, x) => t + (x.c.earlier ?? 0), 0);
  out.push("", [listLine, o.labelsOn !== "earlier" && fromLines.length ? `Carried to it without AI: ${fromLines.join(", ")}.` : "", rerun ? `${rerun} need labeling again (a type removed or added since, or no counterpart on the list in use); they show under their carried type.` : "", earlier ? `${earlier} items have labels only on an earlier list that can't be carried: a classification run is needed for them.` : ""].filter(Boolean).join(" "));
  out.push("", `Agreement sample: ${sampleWords(labeledAll)}.${o.wp1Labels ? " These labels were made before WP-2's rules (a whole project, no kinds, a type for unclear items): run classification again." : ""}`);

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
    resultsTables(out, withResults.filter((c) => c.results!.build.labeled).map((c) => ({ key: c.key, r: c.results!.build })), largest?.key ?? null);
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
      out.push("", `${tickets.labeled} Tickets and support items labeled.`);
      const tc = withResults.filter((c) => c.results!.tickets.labeled).map((c) => ({ key: c.key, r: c.results!.tickets }));
      tableLines(out, "Request types (Tickets and support)", clientTable(tc, (r) => r.requestTypes, { largest: tc.length > 1 ? (largest?.key ?? null) : null }));
    }
  }
  return out.join("\n") + "\n";
}

/**
 * The request types download: the list in use first, marked "In use", then every earlier list newest first, each under
 * a heading with its own version and date (no two alike). An AI-written list says so and that it isn't in use.
 */
export function typesMarkdown(lists: readonly TypeList[], inUse: string): string {
  const out: string[] = ["# Request types", ""];
  const order = [...lists].sort((a, b) => (a.version === inUse ? -1 : b.version === inUse ? 1 : rankOf(b.version) - rankOf(a.version) || b.createdAt.localeCompare(a.createdAt)));
  for (const l of order) {
    const date = l.createdAt.slice(0, 10);
    const head = l.version === inUse
      ? `In use: version ${ownNumber(l.version)} (${l.version}, ${date})`
      : isOwned(l.version)
        ? `Version ${ownNumber(l.version)} (${l.version}, ${date}), no longer in use`
        : isAiList(l.version)
          ? `Written by AI, not in use (${l.version}, ${date})`
          : l.version === WP1_START
            ? `WP-1's starting list (${l.version}, ${date})`
            : l.version === STARTING_LIST.version
              ? `WP-2's starting list (${l.version}, ${date})`
              : `List ${l.version} (${date})`;
    out.push(`## ${cell(head)}`, "");
    if (l.why) out.push(`Why: ${cell(l.why)}`, "");
    out.push("| Request type | Meaning | Made-up example |", "|---|---|---|");
    for (const t of l.types) out.push(`| ${cell(t.name)} | ${cell(t.meaning)} | ${cell(t.example)} |`);
    if (l.changes.length) {
      out.push("", isOwned(l.version) ? `Changes from ${l.base ? (isOwned(l.base) ? `version ${ownNumber(l.base)}` : "WP-2's starting list") : "the version before"}:` : "Changes from the starting list:", "");
      for (const c of l.changes) out.push(`- ${c.kind}: ${c.from.map(cell).join(", ") || "(new)"} > ${c.to.map(cell).join(", ") || "(removed)"}${isAiList(l.version) ? `, ${c.count} items in pass 1` : ""}. ${cell(c.reason)}`);
    } else if (isAiList(l.version)) out.push("", "No changes from the starting list.");
    out.push("");
  }
  return out.join("\n");
}
