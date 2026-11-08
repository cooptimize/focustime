// KB-1: a fake standards repo on a fake GitHub, with every case the contract has to handle. Records each request.
import type { StandardsArticle } from "../../plan/standards.ts";

export const STD_COMMIT = "0123456789abcdef0123456789abcdef01234567";
export const STD_REPO = { owner: "contoso", repo: "standards" };

const fm = (id: string, title: string, domain: string, layer: string, artifact: string, technology: string, status = "active") => `---\nid: ${id}\ntitle: ${title}\ndomain: ${domain}\nlayer: ${layer}\nartifact: ${artifact}\ntechnology: ${technology}\nstatus: ${status}\n---\n`;
const article = (path: string, id: string, title: string, domain: string, layer: string, artifact: string, technology: string, text: string, status?: string): [string, string] => [path, `${fm(id, title, domain, layer, artifact, technology, status)}# ${title}\n\n${text}\n`];

/** The repo's files: articles, and everything the sync must leave alone. */
export const STD_FILES: Record<string, string> = Object.fromEntries([
  article("SQL/SQL Conventions.md", "sql_conventions", "SQL Conventions", "sql", "agnostic", "conventions", "agnostic", "- Never use SELECT *."),
  article("SQL/SQL Layout.md", "sql_formatting", "SQL Layout", "sql", "agnostic", "formatting", "agnostic", "- One column per line."),
  article("SQL/Silver/Overview.md", "sql_silver_overview", "Silver Tables", "sql", "silver", "table", "agnostic", "- Do not use an LLM to create or alter generated SQL."),
  article("SQL/Gold/Fact Tables.md", "sql_gold_fact_tables", "Gold Fact Tables", "sql", "gold", "fact_table", "agnostic", "- Use `fact` and PascalCase table and column names.\n- Name dimension references `FK{DimensionName}`."),
  article("SQL/Gold/Dimension Tables.md", "sql_gold_dimension_tables", "Gold Dimension Tables", "sql", "gold", "dimension_table", "agnostic", "- Use `dim` and PascalCase."),
  article("Technology/Fabric/Fabric Warehouse.md", "tech_fabric_warehouse", "Fabric Warehouse Target", "sql", "agnostic", "agnostic", "fabric_warehouse", "- No enforced foreign keys."),
  article("Power BI/File Types.md", "powerbi_file_types", "Power BI File Types", "powerbi", "agnostic", "file_type", "power_bi", "- Keep a PBIP in source control."),
  article("Power BI/Semantic Model/Fact Tables.md", "powerbi_semantic_model_fact_tables", "Power BI Fact Tables", "powerbi", "semantic_model", "fact_table", "power_bi", "- Hide fact keys."),
  article("Power BI/Semantic Model/DAX.md", "powerbi_semantic_model_dax", "Power BI DAX", "powerbi", "semantic_model", "dax_expression", "power_bi", "- Use DIVIDE instead of the division operator.\n- Start each new line of a measure on the same indent."),
  article("Power BI/Reports/Visuals.md", "powerbi_reports_visuals", "Power BI Report Visuals", "powerbi", "report", "visual", "power_bi", "- Title every visual."),
  article("Power BI/Reports/App Deployment.md", "powerbi_reports_app_deployment", "Power BI App Deployment", "powerbi", "report", "app_deployment", "power_bi", "- Publish through the app."),
  article("Source Systems/D365 FO Source Tables.md", "source_d365_fo", "D365 Finance and Operations Source Tables", "source", "agnostic", "source_table", "d365_fo", "- Keep dataareaid."),
  article("Source Systems/D365 Dataverse Source Tables.md", "source_d365_dataverse", "D365 Dataverse Source Tables", "source", "agnostic", "source_table", "d365_dataverse", "- Keep statecode."),
  article("Source Systems/D365 Exports.md", "source_d365_exports", "D365 Exports", "source", "agnostic", "export", "d365", "- Exports are read only."),
  // Two active articles with one id: both kept, reported.
  article("SQL/Gold/Views.md", "sql_gold_views", "Gold Views", "sql", "gold", "view", "agnostic", "- Prefix with vw."),
  article("SQL/Gold/Views Again.md", "sql_gold_views", "Gold Views Again", "sql", "gold", "view", "agnostic", "- A second one."),
  // Must not be kept.
  article("SQL/Azure SQL Users.md", "tech_azure_sql_users", "Azure SQL User Setup", "sql", "agnostic", "database_user", "azure_sql", "- A draft.", "draft"),
  article("deprecation/tech/fabric/performance.md", "old_perf", "Old Performance", "sql", "agnostic", "agnostic", "agnostic", "- Retired."),
  article("standards/sql.md", "v1_sql", "V1 SQL", "sql", "agnostic", "agnostic", "agnostic", "- Retired v1."),
  ["SQL/No Front Matter.md", "# Just a discussion\n"],
  ["Power BI/Incomplete.md", "---\ntitle: Half done\nstatus: active\n---\nText\n"],
  ["README.md", fm("readme", "Readme", "sql", "agnostic", "agnostic", "agnostic")],
  ["AGENTS.md", "instructions for editing"],
  ["standards.yml", "routes: []"],
  ["scripts/assemble.py", "import os\nos.system('touch /tmp/pwned')\n"],
  [".obsidian/notes.md", fm("hidden", "Hidden", "sql", "agnostic", "agnostic", "agnostic")],
]);

export type SeenRequest = { url: string; method: string; headers: Record<string, string> };

/** A fake GitHub for one repo. `fail` makes everything fail; `commit` and `files` can change between syncs. */
export function fakeStandardsGitHub(o: { files?: Record<string, string>; commit?: string; branch?: string } = {}) {
  const state = { files: o.files ?? STD_FILES, commit: o.commit ?? STD_COMMIT, fail: null as null | number | "network" };
  const seen: SeenRequest[] = [];
  const branch = o.branch ?? "main";
  const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { "content-type": "application/json" } });
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    seen.push({ url, method: init?.method ?? "GET", headers: Object.fromEntries(new Headers(init?.headers).entries()) });
    if (state.fail === "network") throw new TypeError("fetch failed");
    if (state.fail) return new Response("nope", { status: state.fail });
    const base = `https://api.github.com/repos/${STD_REPO.owner}/${STD_REPO.repo}`;
    if (url === base) return json({ default_branch: branch });
    if (url === `${base}/commits/${encodeURIComponent(branch)}` || url === `${base}/commits/${branch}`) return json({ sha: state.commit, commit: { tree: { sha: `tree-${state.commit}` } } });
    if (url.startsWith(`${base}/git/trees/`)) return json({ tree: Object.keys(state.files).map((path) => ({ path, type: "blob" })) });
    const raw = `https://raw.githubusercontent.com/${STD_REPO.owner}/${STD_REPO.repo}/${state.commit}/`;
    if (url.startsWith(raw)) {
      const path = url.slice(raw.length).split("/").map(decodeURIComponent).join("/");
      const body = state.files[path];
      if (body !== undefined) return new Response(body, { status: 200 });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { fetch: fetchFn, seen, state };
}

export function aStandardsArticle(o: Partial<StandardsArticle> & Pick<StandardsArticle, "title">): StandardsArticle {
  const id = o.id ?? o.title.toLowerCase().replace(/\W+/g, "_");
  return { id, domain: "sql", layer: "agnostic", artifact: "agnostic", technology: "agnostic", status: "active", path: `SQL/${o.title}.md`, sha256: "0".repeat(64), commit: STD_COMMIT, body: `# ${o.title}\n\n- A rule.`, ...o };
}
