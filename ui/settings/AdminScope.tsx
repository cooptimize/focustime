// AH-2: Admin › Clients' "Cooptimize's work in this project": the client's DevOps scope (a Rule, audited like every
// admin.set). Automatic until set; or the whole project; or DevOps teams (their own area paths, with sub-areas as each
// team's settings say); or area paths with "Include sub-areas". The project's own teams and area paths come from the
// central store's daily read, each with its open items and how many are Cooptimize's (assigned to a Cooptimizer or
// under an epic or feature one owns), so the BI part of a bigger program can be picked by its numbers. SA-4 F: SA-2's
// parts: the row with its Rule and saved mark, the choice, the one table style, the button row with its preview.
import { useEffect, useMemo, useState } from "react";
import { inArea, type AreaRule, type ClientScopeFacts, type DevOpsScope, type ScopeCounts } from "../../plan/devops-scope.ts";
import type { FieldStatus } from "./autosave.tsx";
import { Badge, Button, Buttons, Check, Choice, Note, Row, Switch, Table } from "./parts.tsx";

export type ClientScopeRow = { rule: DevOpsScope | null; words: string; facts: ClientScopeFacts | null; polled: boolean };
type Mode = "automatic" | "whole" | "teams" | "areas";
type Save = (value: DevOpsScope | undefined) => Promise<void>;

const of = (n: number, m: number) => `${n} of ${m}`;
const items = (n: number) => `${n} open ${n === 1 ? "item" : "items"}`;

/** Open items the chosen area rules take (paths don't overlap, so the per-path counts add up). */
export function previewCount(c: ScopeCounts, rules: readonly AreaRule[]): number {
  return c.areas.filter((a) => inArea(a.path, rules)).reduce((n, a) => n + a.items, 0);
}

export function ScopeField({ clientKey, project, s, save, status, retry }: { clientKey: string; project: string | null; s: ClientScopeRow; save: Save; status: FieldStatus; retry: () => void }) {
  const rule = s.rule;
  const counts = s.facts?.counts ?? null;
  const [mode, setMode] = useState<Mode>(rule ? rule.kind : "automatic");
  const [teams, setTeams] = useState<Set<string>>(new Set(rule?.kind === "teams" ? rule.teams.map((t) => t.toLowerCase()) : []));
  const [areas, setAreas] = useState<Map<string, AreaRule>>(new Map(rule?.kind === "areas" ? rule.areas.map((a) => [a.path.toLowerCase(), a]) : []));
  useEffect(() => {
    setMode(rule ? rule.kind : "automatic");
    setTeams(new Set(rule?.kind === "teams" ? rule.teams.map((t) => t.toLowerCase()) : []));
    setAreas(new Map(rule?.kind === "areas" ? rule.areas.map((a) => [a.path.toLowerCase(), a]) : []));
  }, [rule]);
  const draft: DevOpsScope | null | "incomplete" = useMemo(() => {
    if (mode === "automatic") return null;
    if (mode === "whole") return { kind: "whole" };
    if (mode === "teams") return teams.size ? { kind: "teams", teams: (counts?.teams ?? []).filter((t) => teams.has(t.name.toLowerCase())).map((t) => t.name) } : "incomplete";
    return areas.size ? { kind: "areas", areas: [...areas.values()] } : "incomplete";
  }, [mode, teams, areas, counts]);
  const same = JSON.stringify(draft) === JSON.stringify(rule);
  const rulesOf = (d: typeof draft): AreaRule[] | null => (d === "incomplete" || d === null || d.kind === "whole" ? null : d.kind === "areas" ? d.areas : (counts?.teams ?? []).filter((t) => d.teams.includes(t.name)).flatMap((t) => t.areas));
  const preview = counts ? (draft === null ? counts.automatic : draft === "incomplete" ? null : draft.kind === "whole" ? counts.total : previewCount(counts, rulesOf(draft) ?? [])) : null;
  const name = project ?? clientKey;
  const label = `${clientKey}: Cooptimize's work in this project`;
  const choose = (m: Mode) => {
    setMode(m);
    // Automatic and Whole project save at once; teams and areas wait for a choice and Save.
    if (m === "automatic" && rule !== null) void save(undefined);
    if (m === "whole" && rule?.kind !== "whole") void save({ kind: "whole" });
  };
  const depth = (p: string) => p.split("\\").length - 1;

  const modes = [
    ["automatic", "Automatic", counts ? of(counts.automatic, counts.total) : null, "Items assigned to Cooptimizers, everything under epics and features a Cooptimizer owns, and the area paths where Cooptimizers have items (never the root area when there are others)."],
    ["whole", "Whole project", counts ? items(counts.total) : null, "Every item in the project."],
    ["teams", "By team", null, "The area paths of the DevOps teams you choose, as each team's settings say."],
    ["areas", "By area path", null, "The area paths you choose, with or without the areas under them."],
  ] as const;
  return (
    <>
      <Row
        id="devops-scope"
        def={{ label: "Which items count" }}
        noSid
        wide
        badge={<Badge title="applies to everyone">Rule</Badge>}
        help={`Backlog, Needs attention and Week's lists show only these items of ${name}, plus anything assigned to the person. Now: ${s.words}${rule === null ? " (until an admin sets it)" : ""}.${counts ? ` Automatic: ${of(counts.automatic, counts.total)} open items.` : ""}`}
        status
        mark={{ s: status, retry }}
      >
        <Choice label={label} value={mode} onChange={choose} options={modes.map(([m, word, n, hint]) => ({ value: m, label: n ? `${word} · ${n}` : word, title: hint, disabled: m === "teams" && !counts?.teams?.length }))} />
      </Row>
      {!s.polled && <Note>DevOps isn't read centrally here, so there are no counts.</Note>}
      {s.polled && !counts && <Note>FocusTime hasn't read {name}'s DevOps yet. Counts show after the first read.</Note>}
      {mode === "teams" && counts && (
        <>
          {s.facts?.teamsProblem && <Note>{s.facts.teamsProblem}.</Note>}
          {counts.teams && counts.teams.length > 0 && (
            <Table
              label={`${clientKey}: teams`}
              head={["Team", "Its area paths", "Open items", "Cooptimize's"]}
              rowKey={(i) => counts.teams![i]!.name}
              rows={counts.teams.map((t) => [
                <span key="t">
                  <Check label={t.name} checked={teams.has(t.name.toLowerCase())} disabled={t.otherField} onChange={(on) => setTeams((x) => (on ? new Set(x).add(t.name.toLowerCase()) : new Set([...x].filter((y) => y !== t.name.toLowerCase()))))} /> {t.name}
                </span>,
                t.otherField ? "Uses a field other than Area Path" : t.areas.map((a) => `${a.path}${a.sub ? " and sub-areas" : ""}`).join("; ") || "None",
                String(t.items),
                String(t.coop),
              ])}
            />
          )}
        </>
      )}
      {mode === "areas" && counts && (
        <>
          {s.facts?.areasProblem && <Note>{s.facts.areasProblem}.</Note>}
          <Table
            label={`${clientKey}: area paths`}
            head={["Area path", "Include sub-areas", "Open items", "Cooptimize's"]}
            rowKey={(i) => counts.areas[i]!.path}
            rows={counts.areas.map((a) => {
              const k = a.path.toLowerCase();
              const on = areas.get(k);
              return [
                <span key="a">
                  {"\u2003".repeat(depth(a.path))}
                  <Check
                    label={a.path}
                    checked={!!on}
                    onChange={(v) =>
                      setAreas((x) => {
                        const n = new Map(x);
                        if (v) n.set(k, { path: a.path, sub: true });
                        else n.delete(k);
                        return n;
                      })
                    }
                  />{" "}
                  {a.path.split("\\").pop()}
                </span>,
                <Switch key="s" label={`${a.path}: include sub-areas`} disabled={!on} checked={!!on?.sub} onChange={(v) => setAreas((x) => new Map(x).set(k, { path: a.path, sub: v }))} />,
                String(a.items),
                String(a.coop),
              ];
            })}
          />
        </>
      )}
      {(mode === "teams" || mode === "areas" || (preview !== null && counts)) && (
        <Buttons result={preview !== null && counts ? `Shows ${of(preview, counts.total)} open items, plus each person's own.` : undefined}>
          {(mode === "teams" || mode === "areas") && (
            <Button kind="main" disabled={draft === "incomplete" || same} onClick={() => draft !== "incomplete" && void save(draft ?? undefined)}>
              Save scope
            </Button>
          )}
        </Buttons>
      )}
    </>
  );
}
