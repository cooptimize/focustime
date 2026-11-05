// WT-1: the type icon: FocusTime's own drawing for each DevOps icon id, the project's color, a neutral fallback, and the
// type name as the accessible name and tooltip. Never an image from DevOps.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildProcessModel, looksOf } from "../plan/process.ts";
import { anInternalProcess } from "../test/builders/index.ts";
import type { ClientWork } from "../week/types.ts";
import { iconPaths, TYPE_ICONS, TypeIcon } from "./TypeIcon.tsx";
import { DevOpsWork } from "./work.ts";

const render = (props: Parameters<typeof TypeIcon>[0], work = new Map<string, ClientWork>()) => renderToStaticMarkup(createElement(DevOpsWork.Provider, { value: work }, createElement(TypeIcon, props)));

describe("TypeIcon", () => {
  it("draws every icon id found in our projects, and the neutral fallback for the rest", () => {
    const inUse = ["icon_crown", "icon_trophy", "icon_book", "icon_list", "icon_clipboard", "icon_insect", "icon_asterisk", "icon_flame", "icon_gavel", "icon_parachute", "icon_chart", "icon_traffic_cone", "icon_diamond", "icon_palette", "icon_megaphone", "icon_check_box", "icon_gear", "icon_database_storage", "icon_headphone", "icon_test_case", "icon_test_plan", "icon_test_suite", "icon_test_step", "icon_test_parameter", "icon_code_review", "icon_code_response", "icon_review", "icon_response"];
    for (const id of inUse) expect(iconPaths(id).known, id).toBe(true);
    expect(iconPaths("icon_something_new")).toMatchObject({ known: false });
    expect(iconPaths(null).known).toBe(false);
    expect(new Set(Object.values(TYPE_ICONS).map((p) => p.join())).size).toBe(Object.keys(TYPE_ICONS).length);
  });

  it("uses the client's process: its icon and its color, with the type name as accessible name and tooltip", () => {
    const work = new Map<string, ClientWork>([["Fabrikam", { clientKey: "Fabrikam", clientName: "Fabrikam", status: "ok", fetchedAt: null, fromCache: false, items: [], children: [], types: looksOf(buildProcessModel(anInternalProcess())) }]]);
    const html = render({ clientKey: "Fabrikam", type: "Recurring" }, work);
    expect(html).toContain('aria-label="Recurring"');
    expect(html).toContain('title="Recurring"');
    expect(html).toContain('fill="#5c197b"');
    expect(html).toContain(TYPE_ICONS.icon_asterisk![0]!);
    expect(html).not.toMatch(/<img|https?:/);
  });

  it("falls back to a neutral icon in the text color when the type isn't known, still named", () => {
    const html = render({ clientKey: "Nobody", type: "Widget" });
    expect(html).toContain("type-icon-fallback");
    expect(html).toContain('fill="currentColor"');
    expect(html).toContain('aria-label="Widget"');
  });

  it("is hidden from assistive tech when the name is written next to it", () => {
    const html = render({ type: "User Story", look: { icon: "icon_book", color: "009CCC" }, decorative: true });
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain("aria-label");
    expect(html).toContain('fill="#009CCC"');
  });
});
