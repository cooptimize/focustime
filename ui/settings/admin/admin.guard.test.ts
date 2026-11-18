// SA-4 F: Admin's pages draw every row, group, table, button row and saved mark with SA-2's parts
// (ui/settings/parts.tsx), and none of their own. A page that brings back an old Settings class, a raw table, a raw
// button or the old saved mark fails here. Admin's own pieces (its tabs, the confirm's dialog role) are in Tabs.tsx and
// shared.tsx; the shared components a tab holds (client chats, calls, deployments) keep their insides, as SA-2 left them.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const HERE = import.meta.dirname;
const FILES = [
  ...["Clients.tsx", "ClientFields.tsx", "People.tsx", "TeamDefaults.tsx", "Health.tsx", "Audit.tsx", "shared.tsx"].map((f) => join(HERE, f)),
  ...["WhoSetUp.tsx", "AdminScope.tsx", "StatusRows.tsx"].map((f) => join(HERE, "..", f)),
];
/** The old ways: Settings' and Admin's own row, hint, table, button and mark classes, and raw tables and buttons. */
const OLD = /\b(set-field|set-label|set-hint|set-value|set-grid|set-form|set-row-actions|set-inline|set-check|set-problem|adm-table|adm-field|adm-switch|adm-kind|field-problem)\b|className="mini\b|<SaveMark\b|<(table|thead|tbody|tr|td|th|button|select|h3|h4)\b/;

describe("SA-4 F: Admin draws with SA-2's parts", () => {
  for (const f of FILES) {
    it(f.split("/").slice(-2).join("/"), () => {
      const src = readFileSync(f, "utf8");
      // The invite sheet (WhoSetUp's dialog) keeps its own; only the list above it is checked.
      const body = f.endsWith("WhoSetUp.tsx") ? src.slice(0, src.indexOf("export function InviteSheet")) : src;
      const bad = body.split("\n").flatMap((l, i) => (OLD.test(l) && !l.trim().startsWith("//") ? [`${i + 1}: ${l.trim().slice(0, 120)}`] : []));
      expect(bad).toEqual([]);
    });
  }
});
