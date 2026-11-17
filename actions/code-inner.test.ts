// RB-3b: code.inner, the second level of "Where is it?". A report's pages in the PBIR format (pages.json's order,
// hidden pages marked, at most 60 pages, a page file that fails), a legacy report's pages, a TMDL table's measures and
// columns with measures declared in another file, and a one-file model's tables. Each listing opens only the files it
// needs, a few at a time, and writes exactly one row with the repo and the thing's file, never one per file and never
// any words typed; no row, no names. Code's own rule decides who may list, as for every other read.
import { describe, expect, it } from "vitest";
import { codeAction, type CodeContext } from "./code-actions.ts";
import { CodeFailure, type CodeFile, type CodeGit } from "./code-git.ts";
import type { GitRepo } from "../sources/devops/git.ts";
import type { CodeViewInput } from "../store/code-views-store.ts";
import { decodeText, fileKind, nameOf, TEXT_MAX_BYTES, type CodeAccess } from "../plan/code.ts";
import { sortRepo } from "../plan/code-kinds.ts";
import { whereOnly } from "../plan/where-lookup.ts";
import { WHERE_PAGES_MAX, WHERE_PARTS_MAX, type InnerAnswer } from "../plan/where-inner.ts";

const ME = { id: "aaaaaaaa-0000-4000-8000-000000000001", name: "Ana Example" };
const REPO = "0000000a-0000-4000-8000-00000000000a";
const OTHER = "0000000b-0000-4000-8000-00000000000b";
const enc = new TextEncoder();

/** A PBIR report with these pages ([folder, display name, hidden]), pages.json listing them in `order`. */
function pbir(dir: string, pages: [string, string, boolean?][], order?: string[]): Record<string, string> {
  const files: Record<string, string> = {
    [`${dir}/definition.pbir`]: `{ "version": "4.0" }`,
    [`${dir}/definition/report.json`]: `{ "themeCollection": {} }`,
    [`${dir}/definition/version.json`]: `{ "version": "2.0.0" }`,
    [`${dir}/.platform`]: "{}",
  };
  if (order) files[`${dir}/definition/pages/pages.json`] = JSON.stringify({ pageOrder: order, activePageName: order[0] });
  for (const [id, name, hidden] of pages) {
    files[`${dir}/definition/pages/${id}/page.json`] = JSON.stringify({ name: id, displayName: name, displayOption: "FitToPage", ...(hidden ? { visibility: "HiddenInViewMode" } : {}) });
    files[`${dir}/definition/pages/${id}/visuals/v1/visual.json`] = "{}";
  }
  return files;
}
const many = (n: number) => Array.from({ length: n }, (_, i): [string, string] => [`p${String(i).padStart(3, "0")}`, `Page ${i + 1}`]);

const TABLE_ORDERS = "table Orders\n\tmeasure 'Order Count' = COUNTROWS(Orders)\n\tcolumn OrderId\n\t\tdataType: int64\n\tcolumn Amount\n";
const TABLE_ITEMS = "table Items\n\tcolumn ItemId\n";
const MEASURES = "table Orders\n\tmeasure 'Average Order' = DIVIDE([Total], [Order Count])\n\tmeasure 'Order Count' = 1\n\ntable Items\n\tmeasure 'Item Count' = COUNTROWS(Items)\n";
const BIM = JSON.stringify({ name: "Returns", model: { tables: [{ name: "Returns", columns: [{ name: "RowNumber-1", type: "rowNumber" }, { name: "ReturnId" }, { name: "Amount" }], measures: [{ name: "Return Rate" }] }, { name: "Reason", columns: [{ name: "ReasonId" }] }] } });

const FILES: Record<string, string | Uint8Array | { size: number }> = {
  ...pbir("/rpt/Weekly ops.Report", [["b2", "Detail"], ["a1", "Summary"], ["c3", "Drill: one site", true]], ["a1", "b2", "c3"]),
  ...pbir("/rpt/One page.Report", [["only", "Overview"]]),
  ...pbir("/rpt/Sixty.Report", many(WHERE_PAGES_MAX), many(WHERE_PAGES_MAX).map((p) => p[0])),
  ...pbir("/rpt/Too many.Report", many(WHERE_PAGES_MAX + 1)),
  ...pbir("/rpt/Broken page.Report", [["a1", "First"], ["b2", "Second"], ["c3", "Third"]], ["a1", "b2", "c3"]),
  "/rpt/Old.Report/definition.pbir": `{ "version": "1.0" }`,
  "/rpt/Old.Report/report.json": JSON.stringify({ sections: [{ name: "s1", displayName: "Front", ordinal: 0, config: "{}" }, { name: "s2", displayName: "Hidden one", ordinal: 1, config: JSON.stringify({ visibility: 1 }) }] }),
  "/sm/Orders.SemanticModel/definition.pbism": "{}",
  "/sm/Orders.SemanticModel/definition/model.tmdl": "model Model\n\tref table Orders\n",
  "/sm/Orders.SemanticModel/definition/relationships.tmdl": "relationship r1\n",
  "/sm/Orders.SemanticModel/definition/tables/Orders.tmdl": TABLE_ORDERS,
  "/sm/Orders.SemanticModel/definition/tables/Items.tmdl": TABLE_ITEMS,
  "/sm/Orders.SemanticModel/definition/measures.tmdl": MEASURES,
  "/sm/Orders.SemanticModel/definition/roles/Readers.tmdl": "role Readers\n",
  "/sm/Returns.SemanticModel/definition.pbism": "{}",
  "/sm/Returns.SemanticModel/model.bim": BIM,
  "/sm/Huge.SemanticModel/definition.pbism": "{}",
  "/sm/Huge.SemanticModel/model.bim": { size: TEXT_MAX_BYTES + 1 },
  "/sm/Split.SemanticModel/definition.pbism": "{}",
  "/sm/Split.SemanticModel/definition/tables/Sales.tmdl": "table Sales\n\tcolumn Id\n",
  ...Object.fromEntries(Array.from({ length: WHERE_PARTS_MAX + 1 }, (_, i) => [`/sm/Split.SemanticModel/definition/part${i}.tmdl`, `table Sales\n\tmeasure m${i} = 1\n`])),
};
// The broken report's second page isn't JSON.
FILES["/rpt/Broken page.Report/definition/pages/b2/page.json"] = new Uint8Array([0, 1, 2, 3]);

/** A fake CodeGit over FILES: every file opened is recorded. */
function fake(o: { fail?: string } = {}) {
  const opened: string[] = [];
  let at = 0;
  let most = 0;
  const repo = (id: string, name: string): GitRepo => ({ id, name, defaultBranch: "main", disabled: false, webUrl: null });
  const git: CodeGit = {
    repos: async () => [repo(REPO, "ops-reporting"), repo(OTHER, "other")],
    folder: async () => ({ commit: "c", entries: [], cut: false }),
    files: async (_c, r) => ({ commit: "c", paths: r.id === REPO ? Object.keys(FILES).sort() : ["/x/Y.Report/report.json", "/x/Y.Report/definition.pbir"], cut: false }),
    search: async () => ({ count: 0, hits: [], info: 0 }),
    async file(_c, _r, path): Promise<CodeFile> {
      opened.push(path);
      at++;
      most = Math.max(most, at);
      await new Promise((r) => setTimeout(r, 1));
      at--;
      if (o.fail === path) throw new CodeFailure("busy");
      const c = FILES[path];
      if (c === undefined) throw new CodeFailure("not_found");
      const bytes = typeof c === "string" ? enc.encode(c) : c instanceof Uint8Array ? c : null;
      const size = bytes ? bytes.length : (c as { size: number }).size;
      const kind = fileKind({ name: nameOf(path), size, bytes: size > TEXT_MAX_BYTES ? null : bytes });
      return { path, commit: "c", size, kind, text: kind === "text" && bytes ? decodeText(bytes) : null };
    },
  };
  return { git, opened, most: () => most };
}

function ctx(git: CodeGit, o: { why?: "guest"; rule?: CodeAccess; views?: "fail" } = {}) {
  const views: CodeViewInput[] = [];
  const c: CodeContext = {
    me: async () => ME,
    notCooptimizer: async () => o.why ?? null,
    clients: async () => [{ clientKey: "Contoso", name: "Contoso", color: null }],
    rule: async () => o.rule ?? "company",
    team: async () => ({ myClients: [], onClient: () => false }),
    git,
    views: { add: async (v) => (o.views === "fail" ? Promise.reject(new Error("db down")) : void views.push(v)) },
  };
  return { c, views };
}
const list = (c: CodeContext, list: string, path: string, repoId = REPO) => codeAction(c, "code.inner", { clientKey: "Contoso", repoId, path, list });
const data = (r: Awaited<ReturnType<typeof codeAction>>) => (r.ok ? (r.data as InnerAnswer) : null);

describe("a report's pages in today's format", () => {
  it("in the report's own order, hidden ones marked, from pages.json and each page.json; one row", async () => {
    const f = fake();
    const { c, views } = ctx(f.git);
    const r = await list(c, "pages", "/rpt/Weekly ops.Report/definition/report.json");
    expect(data(r)).toEqual({ list: "pages", pages: [{ name: "Summary", hidden: false }, { name: "Detail", hidden: false }, { name: "Drill: one site", hidden: true }], unreadable: 0 });
    expect(f.opened.sort()).toEqual(["/rpt/Weekly ops.Report/definition/pages/a1/page.json", "/rpt/Weekly ops.Report/definition/pages/b2/page.json", "/rpt/Weekly ops.Report/definition/pages/c3/page.json", "/rpt/Weekly ops.Report/definition/pages/pages.json"]);
    expect(views).toEqual([{ actorId: ME.id, actorName: ME.name, clientKey: "Contoso", repoId: REPO, repoName: "ops-reporting", path: "/rpt/Weekly ops.Report/definition/report.json", event: "pages_listed" }]);
  });
  it("one page, with no pages.json", async () => {
    const f = fake();
    const r = await list(ctx(f.git).c, "pages", "/rpt/One page.Report/definition/report.json");
    expect(data(r)).toEqual({ list: "pages", pages: [{ name: "Overview", hidden: false }], unreadable: 0 });
    expect(f.opened).toEqual(["/rpt/One page.Report/definition/pages/only/page.json"]);
  });
  it("60 pages: all of them, a few files at a time; 61: refused before any file is opened, and no row", async () => {
    const f = fake();
    const { c, views } = ctx(f.git);
    const r = data(await list(c, "pages", "/rpt/Sixty.Report/definition/report.json"));
    expect(r?.list === "pages" && r.pages.length).toBe(WHERE_PAGES_MAX);
    expect(f.opened).toHaveLength(WHERE_PAGES_MAX + 1);
    expect(f.most()).toBeLessThanOrEqual(4);
    expect(views).toHaveLength(1);
    const g = fake();
    const two = ctx(g.git);
    expect(await list(two.c, "pages", "/rpt/Too many.Report/definition/report.json")).toMatchObject({ ok: false, status: 409, code: "too_many" });
    expect(g.opened).toEqual([]);
    expect(two.views).toEqual([]);
  });
  it("past 60 pages the box isn't offered the level at all", async () => {
    const sorted = whereOnly(sortRepo(Object.keys(FILES)));
    const more = Object.fromEntries(sorted.things.filter((t) => t.kind === "report" || t.kind === "model").map((t) => [t.name, t.whereMore ?? null]));
    expect(more).toMatchObject({ "Weekly ops": "pages", "One page": "pages", Sixty: "pages", "Too many": null, Old: "pages", Returns: "tables", Huge: "tables", Orders: null });
    // The box still gets no file inside an item.
    expect(sorted.files).toEqual([]);
  });
  it("a page file that can't be read: the others still list, and it is counted", async () => {
    const r = data(await list(ctx(fake().git).c, "pages", "/rpt/Broken page.Report/definition/report.json"));
    expect(r).toEqual({ list: "pages", pages: [{ name: "First", hidden: false }, { name: "Third", hidden: false }], unreadable: 1 });
  });
  it("DevOps busy part way: no names and no row", async () => {
    const f = fake({ fail: "/rpt/Weekly ops.Report/definition/pages/b2/page.json" });
    const { c, views } = ctx(f.git);
    expect(await list(c, "pages", "/rpt/Weekly ops.Report/definition/report.json")).toMatchObject({ ok: false, code: "busy" });
    expect(views).toEqual([]);
  });
});

describe("a legacy report", () => {
  it("one file, its pages in order with the hidden one marked, one row", async () => {
    const f = fake();
    const { c, views } = ctx(f.git);
    expect(data(await list(c, "pages", "/rpt/Old.Report/report.json"))).toEqual({ list: "pages", pages: [{ name: "Front", hidden: false }, { name: "Hidden one", hidden: true }], unreadable: 0 });
    expect(f.opened).toEqual(["/rpt/Old.Report/report.json"]);
    expect(views.map((v) => [v.event, v.path])).toEqual([["pages_listed", "/rpt/Old.Report/report.json"]]);
  });
});

describe("a model table's measures and columns", () => {
  it("its own file, then measures declared for it in another file, never another table's; one row", async () => {
    const f = fake();
    const { c, views } = ctx(f.git);
    const r = data(await list(c, "fields", "/sm/Orders.SemanticModel/definition/tables/Orders.tmdl"));
    expect(r).toEqual({ list: "fields", fields: [{ name: "Order Count", what: "measure" }, { name: "OrderId", what: "column" }, { name: "Amount", what: "column" }, { name: "Average Order", what: "measure" }], partsSkipped: 0, unreadable: 0 });
    // The model's fixed files, roles and other tables aren't opened.
    expect(f.opened.sort()).toEqual(["/sm/Orders.SemanticModel/definition/measures.tmdl", "/sm/Orders.SemanticModel/definition/tables/Orders.tmdl"]);
    expect(views.map((v) => [v.event, v.path])).toEqual([["fields_listed", "/sm/Orders.SemanticModel/definition/tables/Orders.tmdl"]]);
    const items = data(await list(c, "fields", "/sm/Orders.SemanticModel/definition/tables/Items.tmdl"));
    expect(items?.list === "fields" && items.fields.map((x) => x.name)).toEqual(["ItemId", "Item Count"]);
  });
  it("more files than it opens: only the table's own, and it says some may be missing", async () => {
    const f = fake();
    const r = data(await list(ctx(f.git).c, "fields", "/sm/Split.SemanticModel/definition/tables/Sales.tmdl"));
    expect(r).toEqual({ list: "fields", fields: [{ name: "Id", what: "column" }], partsSkipped: WHERE_PARTS_MAX + 1, unreadable: 0 });
    expect(f.opened).toEqual(["/sm/Split.SemanticModel/definition/tables/Sales.tmdl"]);
  });
});

describe("a model kept as one file", () => {
  it("its tables with their measures and columns, from one read; one row", async () => {
    const f = fake();
    const { c, views } = ctx(f.git);
    expect(data(await list(c, "tables", "/sm/Returns.SemanticModel/model.bim"))).toEqual({
      list: "tables",
      tables: [
        { name: "Returns", fields: [{ name: "Return Rate", what: "measure" }, { name: "ReturnId", what: "column" }, { name: "Amount", what: "column" }] },
        { name: "Reason", fields: [{ name: "ReasonId", what: "column" }] },
      ],
    });
    expect(f.opened).toEqual(["/sm/Returns.SemanticModel/model.bim"]);
    expect(views.map((v) => [v.event, v.path])).toEqual([["tables_listed", "/sm/Returns.SemanticModel/model.bim"]]);
  });
  it("past Code's text limit: says so, with no names and no row", async () => {
    const { c, views } = ctx(fake().git);
    expect(await list(c, "tables", "/sm/Huge.SemanticModel/model.bim")).toMatchObject({ ok: false, status: 413, code: "too_large" });
    expect(views).toEqual([]);
  });
});

describe("the rules every read keeps", () => {
  it("no row, no names", async () => {
    const { c } = ctx(fake().git, { views: "fail" });
    for (const [l, p] of [["pages", "/rpt/Weekly ops.Report/definition/report.json"], ["pages", "/rpt/Old.Report/report.json"], ["fields", "/sm/Orders.SemanticModel/definition/tables/Orders.tmdl"], ["tables", "/sm/Returns.SemanticModel/model.bim"]] as const) {
      const r = await list(c, l, p);
      expect(r).toMatchObject({ ok: false, status: 503, code: "not_logged" });
      expect(JSON.stringify(r)).not.toMatch(/Summary|Front|Order Count|Return Rate/);
    }
  });
  it("someone Code refuses gets nothing, and nothing is opened", async () => {
    const a = fake();
    expect(await list(ctx(a.git, { why: "guest" }).c, "pages", "/rpt/Old.Report/report.json")).toMatchObject({ ok: false, status: 403 });
    const b = fake();
    expect(await list(ctx(b.git, { rule: "team" }).c, "pages", "/rpt/Old.Report/report.json")).toMatchObject({ ok: false, status: 403, code: "team_only" });
    expect([...a.opened, ...b.opened]).toEqual([]);
  });
  it("only a thing of that repo, of the right kind, by its own file; what to open comes from the repo, never the request", async () => {
    const { c, views } = ctx(fake().git);
    expect(await list(c, "pages", "/rpt/Weekly ops.Report/definition/pages/a1/page.json")).toMatchObject({ ok: false, code: "not_listable" });
    expect(await list(c, "pages", "/sm/Returns.SemanticModel/model.bim")).toMatchObject({ ok: false, code: "not_listable" });
    expect(await list(c, "tables", "/sm/Orders.SemanticModel/definition/model.tmdl")).toMatchObject({ ok: false, code: "not_listable" });
    expect(await list(c, "fields", "/sm/Orders.SemanticModel/definition/measures.tmdl")).toMatchObject({ ok: false, code: "not_listable" });
    expect(await list(c, "pages", "/rpt/Old.Report/../Old.Report/report.json")).toMatchObject({ ok: false, code: "bad_path" });
    expect(await list(c, "pages", "/rpt/Old.Report/report.json", "not-a-repo")).toMatchObject({ ok: false, code: "no_repo" });
    expect(await list(c, "everything", "/rpt/Old.Report/report.json")).toMatchObject({ ok: false, code: "bad_list" });
    // No words travel: the action takes no other field.
    expect(await codeAction(c, "code.inner", { clientKey: "Contoso", repoId: REPO, path: "/rpt/Old.Report/report.json", list: "pages", words: "front" })).toMatchObject({ ok: false, error: "unknown input field words" });
    expect(views).toEqual([]);
  });
});

describe("review 2: a TMDL line of any length parses in linear time", () => {
  it("a million spaces in a table or measure line", async () => {
    const { tmdlTableFields } = await import("../plan/where-inner.ts");
    const pad = " ".repeat(1_000_000);
    const t0 = performance.now();
    expect(tmdlTableFields(`table a${pad}x\n\tmeasure m${pad}x = 1\n\tmeasure 'Total ''Net'' Sales' = 1\n\tcolumn Id\n`, null)).toEqual([{ name: `m${pad}x`, what: "measure" }, { name: "Total 'Net' Sales", what: "measure" }, { name: "Id", what: "column" }]);
    expect(performance.now() - t0).toBeLessThan(500);
  });
});
