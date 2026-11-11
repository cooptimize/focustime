// WP-1: the page's two downloads, as Markdown. Counts, shares, shapes and meanings across clients; client names are
// fine. Never a title, item text, an item id or a person. Pure.
import type { Snapshot } from "./inventory.ts";
import type { ClientResults } from "./results.ts";
import type { Platform, TypeList } from "./types.ts";

export type ReportClient = { key: string; platform: Platform | null; snapshot: Snapshot | null; results: ClientResults | null };

const pct = (v: number | null | undefined) => (v === null || v === undefined ? "n/a" : `${Math.round(v * 100)}%`);
const num = (v: number | null | undefined) => (v === null || v === undefined ? "n/a" : String(v));
const cell = (s: string) => s.replace(/\|/g, "/").replace(/\s+/g, " ").trim();
const PLATFORM_WORDS: Record<Platform, string> = { azure: "Azure", fabric: "Fabric", both: "Both" };
const top = (m: Record<string, number>, n = 5) => Object.entries(m).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n);

export function summaryMarkdown(clients: readonly ReportClient[], total: ClientResults | null, at: string): string {
  const out: string[] = [`# What is in DevOps`, ``, `Summary from FocusTime's DevOps patterns page, ${at.slice(0, 10)}. Counts and shares only.`, ``, `## Inventory`, ``];
  out.push("| Client | Platform | First item | Items (24 months) | With description | With acceptance | Typical children | Parents with no children | Changed after work started |", "|---|---|---|---|---|---|---|---|---|");
  for (const c of clients) {
    const h = c.snapshot?.headline;
    out.push(`| ${cell(c.key)} | ${c.platform ? PLATFORM_WORDS[c.platform] : "Not set"} | ${c.snapshot?.firstItemAt?.slice(0, 10) ?? "n/a"} | ${num(h?.items)} | ${pct(h?.description)} | ${pct(h?.acceptance)} | ${num(h?.typicalChildren)} | ${pct(h?.parentsNoChildren)} | ${pct(h?.changedAfterStart)} |`);
  }
  for (const c of clients) {
    const s = c.snapshot;
    if (!s) continue;
    out.push("", `### ${cell(c.key)}`, "", `Types: ${s.types.map((t) => `${cell(t.type)} (${t.level}, ${t.count})`).join(", ") || "none"}.`);
    if (s.nesting.length) out.push(`Nesting: ${s.nesting.map((n) => `${cell(n.parent)} > ${cell(n.child)} (${n.count})`).join(", ")}.`);
    out.push(`Middle items with no children: ${s.breakdown.middleNoChildren.count} of ${s.breakdown.middleNoChildren.of}. Leaf items with no parent: ${s.breakdown.leafNoParent.count} of ${s.breakdown.leafNoParent.of}.`);
    out.push(`Titles: ${Object.entries(s.titles.patterns).map(([k, v]) => `${k.replace("_", " ")} ${v}`).join(", ")}.`);
    out.push(`Created to started: median ${num(s.timing.createdToStarted.median)} days. Started to closed: median ${num(s.timing.startedToClosed.median)} days. Created and closed the same day: ${s.timing.sameDay.count} of ${s.timing.sameDay.of}.`);
    out.push(`History sample: ${s.afterFact.sampled} closed items, ${s.afterFact.changedAfterStart} changed after work started, ${s.afterFact.emptyAtClose} still empty at close.`);
  }
  if (total && total.labeled) {
    out.push("", "## Classification", "", `${total.labeled} items labeled.`, "", "| Request type | Items | Share |", "|---|---|---|");
    for (const [k, v] of top(total.requestTypes, 30)) out.push(`| ${cell(k)} | ${v} | ${pct(v / total.labeled)} |`);
    out.push("", "| Layer | Items |", "|---|---|", ...top(total.layers, 20).map(([k, v]) => `| ${cell(k)} | ${v} |`));
    out.push("", "| Readiness | Items |", "|---|---|", ...top(total.readiness, 5).map(([k, v]) => `| ${cell(k)} | ${v} |`));
    out.push("", "### What is missing most, by request type", "");
    for (const [t, m] of Object.entries(total.missing).sort(([a], [b]) => a.localeCompare(b))) out.push(`- ${cell(t)}: ${top(m, 3).filter(([k]) => k !== "none").map(([k, v]) => `${k} (${v})`).join(", ") || "nothing"}`);
    out.push("", "### Common feature shapes", "");
    for (const s of total.shapes) out.push(`- ${cell(s.requestType)}: ${s.shape.join(" > ")} (${s.count})`);
    const a = total.agreement;
    out.push("", `Agreement on ${a.pairs} items classified twice: request type ${pct(a.requestType)}, layers ${pct(a.layers)}, readiness ${pct(a.readiness)}, missing ${pct(a.missing)}, confidence ${pct(a.confidence)}.`);
  }
  return out.join("\n") + "\n";
}

export function typesMarkdown(lists: readonly TypeList[]): string {
  const out: string[] = ["# Request types", ""];
  for (const l of [...lists].reverse()) {
    out.push(`## ${l.version === "v1" ? "Starting list (version 1)" : `Version 2 (${l.createdAt.slice(0, 10)})`}`, "", "| Request type | Meaning | Made-up example |", "|---|---|---|");
    for (const t of l.types) out.push(`| ${cell(t.name)} | ${cell(t.meaning)} | ${cell(t.example)} |`);
    if (l.changes.length) {
      out.push("", "Changes from the starting list:", "");
      for (const c of l.changes) out.push(`- ${c.kind}: ${c.from.map(cell).join(", ") || "(new)"} > ${c.to.map(cell).join(", ")}, ${c.count} items in pass 1. ${cell(c.reason)}`);
    } else if (l.version !== "v1") out.push("", "No changes from the starting list.");
    out.push("");
  }
  return out.join("\n");
}
