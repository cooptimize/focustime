// RB-5: the tree By kind draws for a database's SQL objects, rendered to markup: a folder starts closed unless it is
// the only one at its level, a folder with more than 100 objects shows 100 and Show all, and the filter opens every
// folder. Invented names only.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SqlBar, sqlFolderKeys, sqlOpened, sqlPathTo, SqlTree, SQL_FOLDER_SHOWN, type SqlRow, type SqlTreeMemo } from "./SqlTree.tsx";

const row = (schema: string | null, sqlType: SqlRow["sqlType"], name: string): SqlRow => ({ name, file: `/${schema ?? "x"}/${sqlType}/${name}.sql`, repoId: "r1", sqlType, ...(schema ? { schema } : {}) });
const memo = (open: Record<string, boolean> = {}, whole: string[] = []): SqlTreeMemo => ({ open: new Map(Object.entries(open)), whole: new Set(whole) });
const render = (objects: SqlRow[], m: SqlTreeMemo = memo(), extra: Partial<Parameters<typeof SqlTree>[0]> = {}) =>
  renderToStaticMarkup(createElement(SqlTree, { id: "t", label: "SQL objects", objects, grouping: "schema", filtering: false, selected: { repoId: null, path: null }, onOpen: () => {}, memo: m, onMemo: () => {}, attr: "data-code-thing", ...extra }));
const lines = (html: string) => [...html.matchAll(/<li[^>]*aria-level="(\d)"[^>]*>.*?<\/li>/g)].map((m) => `${m[1]} ${m[0].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()}`);

describe("SqlTree (RB-5 B)", () => {
  const many = [...Array.from({ length: 150 }, (_, i) => row("kiln", "table", `T${String(i).padStart(3, "0")}`)), row("kiln", "view", "vAll"), row("yard", "table", "Stack")];
  it("folders start closed; a level with one folder starts open", () => {
    expect(lines(render(many))).toEqual(["1 kiln 151", "1 yard 1"]);
    // One schema: it is open, and its one type under it too.
    expect(lines(render([row("yard", "table", "Stack"), row("yard", "table", "Pile")]))).toEqual(["1 yard 2", "2 Tables 2", "3 Pile", "3 Stack"]);
  });
  it("a folder with more than 100 objects shows 100 and Show all; then all of them", () => {
    const open = { "t|schema|s:kiln": true, "t|schema|s:kiln/t:table": true };
    const shown = lines(render(many, memo(open)));
    expect(shown.slice(0, 3)).toEqual(["1 kiln 151", "2 Tables 150", "3 T000"]);
    expect(shown.filter((l) => /^3 T\d/.test(l)).length).toBe(SQL_FOLDER_SHOWN);
    expect(shown).toContain("3 Show all 150");
    const all = lines(render(many, memo(open, ["t|schema|s:kiln/t:table"])));
    expect(all.filter((l) => /^3 T\d/.test(l)).length).toBe(150);
    expect(all.some((l) => l.includes("Show all"))).toBe(false);
  });
  it("while filtering every folder is open, whatever was closed by hand", () => {
    const hits = [row("kiln", "view", "vAll"), row("yard", "table", "Stack")];
    expect(lines(render(hits, memo({ "t|schema|s:kiln": false }), { filtering: true }))).toEqual(["1 kiln 1", "2 Views 1", "3 vAll", "1 yard 1", "2 Tables 1", "3 Stack"]);
  });
  it("RB-6: every folder's key, for Expand all and Collapse all, in either grouping", () => {
    expect(sqlFolderKeys("t", [row("yard", "table", "Stack"), row("kiln", "view", "vAll")], "schema")).toEqual(["t|schema|s:kiln", "t|schema|s:kiln/t:view", "t|schema|s:yard", "t|schema|s:yard/t:table"]);
    const open = Object.fromEntries(sqlFolderKeys("t", many, "schema").map((k) => [k, true]));
    expect(lines(render(many, memo(open))).filter((l) => l.startsWith("2 "))).toEqual(["2 Tables 150", "2 Views 1", "2 Tables 1"]);
  });
  it("review 2: the folders that lead to a file, in either grouping, whether or not the tree is shown", () => {
    const stack = { repoId: "r1", path: "/yard/table/Stack.sql" };
    expect(sqlPathTo("t", many, "schema", stack)).toEqual(["t|schema|s:yard", "t|schema|s:yard/t:table"]);
    expect(sqlPathTo("t", many, "type", stack)).toEqual(["t|type|t:table", "t|type|t:table/s:yard"]);
    expect(sqlPathTo("t", many, "type", { repoId: "r2", path: stack.path })).toEqual([]);
    expect(sqlPathTo("t", many, "type", { repoId: null, path: null })).toEqual([]);
    // Opening them shows the object, even past the first 100 of its folder.
    const last = { repoId: "r1", path: "/kiln/table/T149.sql" };
    const opened = sqlOpened(memo({ "t|schema|s:kiln": false }), sqlPathTo("t", many, "schema", last));
    expect(lines(render(many, opened, { selected: last }))).toContain("3 T149");
    expect(sqlOpened(memo(), [])).toEqual(memo());
  });
  it("review 2: the Group by label is tied to its switch (RB-6: one bar for every database)", () => {
    const html = renderToStaticMarkup(createElement(SqlBar, { grouping: "schema", onGrouping: () => {}, onAll: () => {}, disabled: false }));
    const id = /<span class="cv-sql-by" id="([^"]+)"/.exec(html)![1]!;
    expect(id).not.toMatch(/\s/);
    expect(html).toContain(`aria-labelledby="${id}"`);
  });
  it("a folder says its name and count to a screen reader, and one row takes Tab", () => {
    const html = render(many);
    expect(html).toContain('aria-label="kiln, 151"');
    expect(html).toContain('role="tree"');
    expect([...html.matchAll(/tabindex="0"/g)].length).toBe(1);
    expect(html).not.toContain("data-sql-group-btn");
    expect(renderToStaticMarkup(createElement(SqlBar, { grouping: "schema", onGrouping: () => {}, onAll: () => {}, disabled: false }))).toContain('aria-pressed="true" data-sql-group-btn="schema"');
  });
});
