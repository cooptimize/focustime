// DP-2: the seeded lists, a client's own list on top, what a client switch keeps, and matching spoken item names.
import { describe, expect, it } from "vitest";
import { DEPLOY_CATALOG } from "../config/deploy-catalog.ts";
import { defaultKeys, DeployItemsInputError, fullList, groupsFor, itemsSummary, matchNamed, namedInRequest, ownKey, parseDeployItems, resolveTicked, switchTicks, toRows } from "./deploy-items.ts";

const names = (g: { items: { name: string }[] }) => g.items.map((i) => i.name);
const onNames = (g: { items: { name: string; on: boolean }[] }) => g.items.filter((i) => i.on).map((i) => i.name);

describe("the seeded lists", () => {
  it("Fabric has its nine items and four defaults", () => {
    const [g] = groupsFor({ dataPlatform: "fabric" });
    expect(names(g!)).toEqual(["Lakehouse", "Lakehouse SQL", "Warehouse SQL", "Pipelines", "Framework Tables", "Notebooks", "Semantic Models", "Reports", "Variable libraries / parameters"]);
    expect(onNames(g!)).toEqual(["Warehouse SQL", "Framework Tables", "Semantic Models", "Reports"]);
  });
  it("Azure has its six items and three defaults", () => {
    const [g] = groupsFor({ dataPlatform: "azure" });
    expect(names(g!)).toEqual(["Serverless SQL", "Data Warehouse SQL", "ADF Pipelines", "Framework / watermark tables", "Semantic Models", "Reports"]);
    expect(onNames(g!)).toEqual(["Data Warehouse SQL", "Semantic Models", "Reports"]);
  });
  it("a client with no platform gets both lists, nothing ticked", () => {
    const g = groupsFor({ dataPlatform: null });
    expect(g.map((x) => x.label)).toEqual(["Fabric", "Azure"]);
    expect(defaultKeys(g)).toEqual([]);
  });
});

describe("a client's own list", () => {
  const fabric = fullList("fabric", null);
  it("adds, hides, reorders and changes defaults", () => {
    const own = { key: ownKey("Dataflows", fabric.map((i) => i.key)), name: "Dataflows", on: true, hidden: false, own: true };
    const edited = [own, ...fabric.map((i) => (i.name === "Notebooks" ? { ...i, hidden: true } : i.name === "Reports" ? { ...i, on: false } : i))];
    const [g] = groupsFor({ dataPlatform: "fabric", deployItems: parseDeployItems({ fabric: toRows(edited) }) });
    expect(names(g!)[0]).toBe("Dataflows");
    expect(names(g!)).not.toContain("Notebooks");
    expect(onNames(g!)).toEqual(["Dataflows", "Warehouse SQL", "Framework Tables", "Semantic Models"]);
  });
  it("a seed added to the catalog later reaches a client that reordered", () => {
    const rows = toRows(fabric.slice(0, 3));
    expect(fullList("fabric", { fabric: rows }).map((i) => i.key)).toEqual(DEPLOY_CATALOG.fabric.map((c) => c.key));
  });
  it("refuses a repeated name, an unnamed own item and an unknown platform", () => {
    expect(() => parseDeployItems({ fabric: [{ key: "own.a", name: "Reports", on: true }, { key: "fabric.reports", on: true }] })).toThrow(DeployItemsInputError);
    expect(() => parseDeployItems({ fabric: [{ key: "own.a", on: true }] })).toThrow(DeployItemsInputError);
    expect(() => parseDeployItems({ snowflake: [] })).toThrow(DeployItemsInputError);
  });
});

describe("switching the client", () => {
  const fabric = groupsFor({ dataPlatform: "fabric" });
  const azure = groupsFor({ dataPlatform: "azure" });
  it("resets to the new client's defaults", () => {
    expect(switchTicks(fabric, new Set(), azure).ticked).toEqual(defaultKeys(azure));
  });
  it("keeps a manual tick only for an item both lists share by name", () => {
    const shared = azure[0]!.items.filter((i) => i.on).map((i) => i.key);
    expect(switchTicks(fabric, new Set(["fabric.notebooks"]), azure).ticked.sort()).toEqual([...shared].sort());
    const off = { ...azure[0]!, items: azure[0]!.items.map((i) => ({ ...i, on: false })) };
    expect(switchTicks(fabric, new Set(["fabric.reports"]), [off]).ticked).toEqual(["azure.reports"]);
  });
});

describe("what a save ticks", () => {
  const c = { dataPlatform: "fabric" as const };
  it("keeps list order and names from the list", () => {
    expect(resolveTicked(["fabric.reports", "fabric.lakehouse"], c, null).items).toEqual([{ key: "fabric.lakehouse", name: "Lakehouse" }, { key: "fabric.reports", name: "Reports" }]);
  });
  it("refuses a key that isn't on the list, but keeps what the deployment already has", () => {
    expect(resolveTicked(["azure.reports"], c, null).unknown).toEqual(["azure.reports"]);
    expect(resolveTicked(["own.gone"], c, [{ key: "own.gone", name: "Gone" }])).toEqual({ items: [{ key: "own.gone", name: "Gone" }], unknown: [] });
  });
  it("an item the deployment has keeps the name it was planned with", () => {
    expect(resolveTicked(["fabric.reports"], c, [{ key: "fabric.reports", name: "Old name" }]).items).toEqual([{ key: "fabric.reports", name: "Old name" }]);
  });
  it("an unset client's Reports in both groups counts once", () => {
    expect(resolveTicked(["fabric.reports", "azure.reports"], { dataPlatform: null }, null).items).toHaveLength(1);
  });
  it("summarizes the count", () => {
    expect(itemsSummary([{ key: "a", name: "A" }])).toBe("1 item");
    expect(itemsSummary([{ key: "a", name: "A" }, { key: "b", name: "B" }])).toBe("2 items");
    expect(itemsSummary(null)).toBeNull();
  });
});

describe("matching spoken names", () => {
  const fabric = groupsFor({ dataPlatform: "fabric" });
  const azure = groupsFor({ dataPlatform: "azure" });
  const got = (w: string[], g = fabric) => matchNamed(w, g).items.map((i) => i.name);
  it("matches exact names, plurals, parts of a name and small typos", () => {
    expect(got(["warehouse SQL", "reports"])).toEqual(["Warehouse SQL", "Reports"]);
    expect(got(["semantic model"])).toEqual(["Semantic Models"]);
    expect(got(["warehouse sql"], azure)).toEqual(["Data Warehouse SQL"]);
    expect(got(["watermark"], azure)).toEqual(["Framework / watermark tables"]);
    expect(got(["notebok"])).toEqual(["Notebooks"]);
  });
  it("prefers the exact name over a longer one", () => {
    expect(got(["lakehouse"])).toEqual(["Lakehouse"]);
  });
  it("never guesses between two that fit equally", () => {
    expect(matchNamed(["SQL"], fabric)).toEqual({ items: [], unmatched: ["SQL"] });
  });
  it("reports what isn't on the list", () => {
    expect(matchNamed(["spreadsheets"], fabric).unmatched).toEqual(["spreadsheets"]);
  });
  it("finds the item words in a request", () => {
    expect(namedInRequest("Plan the Contoso deployment Saturday 9 to 11 with warehouse SQL and reports")).toEqual(["warehouse SQL", "reports"]);
    expect(namedInRequest("Plan the deployment Saturday 9 to 11")).toEqual([]);
  });
});
