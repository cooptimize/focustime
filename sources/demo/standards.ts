// KB-1: the demo's standards: a handful of fictional articles in the real shape, served as the session's library so
// Break down, Ask and Admin › Standards work on the demo with no network. Never reaches GitHub; the demo's Sync now only
// says so. The repo address is fictional.
import type { StandardsArticle, StandardsLibrary } from "../../plan/standards.ts";
import type { StandardsPort } from "../../actions/standards.ts";
import type { StandardsSyncState } from "../../store/standards-store.ts";

export const DEMO_STANDARDS_REPO = "https://github.com/contoso/standards";
const COMMIT = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";

const a = (path: string, id: string, title: string, domain: string, layer: string, artifact: string, technology: string, body: string): StandardsArticle => ({ path, id, title, domain, layer, artifact, technology, status: "active", sha256: `${id}`.padEnd(64, "0").slice(0, 64), commit: COMMIT, body });

export const DEMO_ARTICLES: StandardsArticle[] = [
  a("SQL/SQL Conventions.md", "sql_conventions", "SQL Conventions", "sql", "agnostic", "conventions", "agnostic", "# SQL Conventions\n\n## Standards\n\n- Never use SELECT *.\n- Name every column explicitly."),
  a("SQL/SQL Layout.md", "sql_formatting", "SQL Layout", "sql", "agnostic", "formatting", "agnostic", "# SQL Layout\n\n## Standards\n\n- Put each selected column on its own line."),
  a("SQL/Silver/Overview.md", "sql_silver_overview", "Silver Tables", "sql", "silver", "table", "agnostic", "# Silver Tables\n\n## Standards\n\n- Do not use an LLM to create or alter generated Silver SQL.\n- Change generated behavior through configuration."),
  a("SQL/Gold/Fact Tables.md", "sql_gold_fact_tables", "Gold Fact Tables", "sql", "gold", "fact_table", "agnostic", "# Gold Fact Tables\n\n## Standards\n\n- Use `fact` and PascalCase table and column names.\n- Name dimension references `FK{DimensionName}`."),
  a("SQL/Gold/Dimension Tables.md", "sql_gold_dimension_tables", "Gold Dimension Tables", "sql", "gold", "dimension_table", "agnostic", "# Gold Dimension Tables\n\n## Standards\n\n- Use `dim` and PascalCase table and column names.\n- Give each dimension one surrogate key."),
  a("SQL/Gold/Views.md", "sql_gold_views", "Gold Views", "sql", "gold", "view", "agnostic", "# Gold Views\n\n## Standards\n\n- Prefix a reporting view with `vw`."),
  a("Technology/Fabric/Fabric Warehouse.md", "tech_fabric_warehouse", "Fabric Warehouse Target", "sql", "agnostic", "agnostic", "fabric_warehouse", "# Fabric Warehouse Target\n\n## Standards\n\n- Don't rely on enforced foreign keys in the warehouse."),
  a("Power BI/Semantic Model/Fact Tables.md", "powerbi_semantic_model_fact_tables", "Power BI Fact Tables", "powerbi", "semantic_model", "fact_table", "power_bi", "# Power BI Fact Tables\n\n## Standards\n\n- Hide fact table foreign keys from report authors."),
  a("Power BI/Semantic Model/DAX.md", "powerbi_semantic_model_dax", "Power BI DAX", "powerbi", "semantic_model", "dax_expression", "power_bi", "# Power BI DAX\n\n## Standards\n\n- Start every new line of a measure's expression on the same indent.\n- Use DIVIDE instead of the division operator."),
  a("Power BI/Reports/Visuals.md", "powerbi_reports_visuals", "Power BI Report Visuals", "powerbi", "report", "visual", "power_bi", "# Power BI Report Visuals\n\n## Standards\n\n- Give every visual a title that names the measure."),
  a("Power BI/Reports/App Deployment.md", "powerbi_reports_app_deployment", "Power BI App Deployment", "powerbi", "report", "app_deployment", "power_bi", "# Power BI App Deployment\n\n## Standards\n\n- Publish report changes through the workspace app."),
  a("Source Systems/D365 FO Source Tables.md", "source_d365_fo", "D365 Finance and Operations Source Tables", "source", "agnostic", "source_table", "d365_fo", "# D365 Finance and Operations Source Tables\n\n## Standards\n\n- Keep `dataareaid` on every company-scoped table."),
];

export function demoStandards(now: () => string): StandardsPort {
  const library: StandardsLibrary = { repo: { owner: "contoso", repo: "standards" }, commit: COMMIT, articles: DEMO_ARTICLES };
  const state: StandardsSyncState = { repoUrl: DEMO_STANDARDS_REPO, branch: "main", commit: COMMIT, syncedAt: now(), checkedAt: now(), error: null, errorAt: null, warnings: [{ kind: "duplicate_id", id: "powerbi_semantic_model_fact_tables", paths: ["Power BI/Semantic Model/Fact Tables.md", "Power BI/Semantic Model/Old Fact Tables.md"] }] };
  return {
    library: async () => library,
    state: async () => state,
    // The demo never reaches GitHub.
    syncNow: async () => ({ ok: true, changed: false, error: null }),
  };
}

/** The demo's Ask, a fixed sample (the real model isn't used): for a question about names, the first rule about names; otherwise the first rule of the first matching article. */
export function demoStandardsAnswer(input: string) {
  const i = JSON.parse(input) as { question?: string; articles?: { title: string; text: string }[] };
  const rulesOf = (a: { text: string }) => a.text.split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2));
  const aboutNames = /\bnam(e|es|ing)\b/i.test(i.question ?? "");
  const named = aboutNames ? i.articles?.find((a) => rulesOf(a).some((r) => /\bnames?\b/i.test(r))) : undefined;
  const first = named ?? i.articles?.[0];
  const rule = named ? rulesOf(named).find((r) => /\bnames?\b/i.test(r)) : first && rulesOf(first)[0];
  if (!first || !rule) return { found: false, article_title: null, answer: "", quote: "" };
  return { found: true, article_title: first.title, answer: `${first.title} says: ${rule.replace(/`/g, "")}`, quote: rule };
}
