// HK-2: the FocusTime costs workbook sends one Cost Management query (the tenant's quota is 12 QPU per 10 seconds;
// four queries at once hit 429). Every view is a "Duplicate table" merge of that one hidden step.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const BICEP = readFileSync(join(import.meta.dirname, "..", "infra/modules/costs.bicep"), "utf8");
const code = BICEP.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");

describe("the costs workbook (HK-2)", () => {
  it("has exactly one ARM query step, and it's the Cost Management query", () => {
    expect(code.match(/queryType: 12\b/g)).toHaveLength(1);
    expect(code.match(/Microsoft\.CostManagement\/query/g)).toHaveLength(1);
  });

  it("feeds every other view from that step by a Duplicate table merge", () => {
    const merges = code.match(/queryType: 7\b/g) ?? [];
    const duplicates = code.match(/query: duplicate\('[0-9a-f-]{36}', source,/g) ?? [];
    expect(merges.length).toBeGreaterThanOrEqual(4);
    expect(duplicates).toHaveLength(merges.length);
    expect(code).toMatch(/mergeType: 'table', leftTable: sourceName/);
  });

  it("opens on This month, so a normal open costs one QPU", () => {
    expect(code).toMatch(/\{ value: 'MonthToDate', label: 'This month', selected: true \}/);
    expect(code.match(/selected: true/g)).toHaveLength(1);
  });
});
