// SA-4: a client's fields that are more than one input: Source systems, who can read its code and Check, what Needs
// attention counts, and its DevOps process with the types' two Rules. SA-4 F: each is SA-2's row (or rows), with its
// kind beside the label; the client's tab puts them in its groups.
import { useCallback, useEffect, useState } from "react";
import { call } from "../../api.ts";
import { plain } from "../autosave.tsx";
import { SOURCE_SYSTEM_LABEL, type SourceSystem } from "../../../plan/standards.ts";
import { GAP_KINDS, GAP_WORDS, type GapKind } from "../../../plan/fixnext.ts";
import { TypeIcon } from "../../TypeIcon.tsx";
import { Button, Buttons, Controls, Note, Row, Select, Sub, Table, Value } from "../parts.tsx";
import { AField, ARead, ASwitch, Kind, ListInput, type ClientRow, type Saver } from "./shared.tsx";
import { adminHref } from "./places.ts";

/** KB-1: which D365 systems the client's data comes from: picks the source-system standards its AI drafts use. */
const SOURCE_CHOICES: readonly (readonly [string, string, SourceSystem[] | null])[] = [
  ["both", "Both D365 systems (default)", null],
  ["d365_fo", SOURCE_SYSTEM_LABEL.d365_fo, ["d365_fo"]],
  ["d365_dataverse", SOURCE_SYSTEM_LABEL.d365_dataverse, ["d365_dataverse"]],
  ["none", "None", []],
];
export function SourceSystemsField({ c, saver }: { c: ClientRow; saver: Saver }) {
  const scope = `client:${c.key}`;
  const shown = saver.shown(scope, "source_systems", c.sourceSystems ?? null);
  const current = SOURCE_CHOICES.find(([, , v]) => JSON.stringify(v) === JSON.stringify(shown ?? null))?.[0] ?? "both";
  const save = (v: SourceSystem[] | null) => void saver.save(scope, "source_systems", v, `${c.key}: source systems`);
  return (
    <AField label="Source systems" kind="Rule" s={saver.status(scope, "source_systems")} retry={() => save(shown ?? null)} hint="Which source-system standards go with this client's AI drafts.">
      <Select label={`${c.key}: source systems`} value={current} options={SOURCE_CHOICES.map(([id, label]) => ({ value: id, label }))} onChange={(id) => save(SOURCE_CHOICES.find(([x]) => x === id)![2])} />
    </AField>
  );
}

type CodeCheck = { state: "readable"; repos: number } | { state: "needs_code_read" | "no_token" | "no_devops" | "error"; text: string };
/** RB-1: who can read this client's code in Code, and whether FocusTime can read it yet (checked on open and on Check). */
export function CodeAccessField({ c, saver }: { c: ClientRow; saver: Saver }) {
  const scope = `client:${c.key}`;
  const value = saver.shown(scope, "code_access", c.codeAccess ?? "company");
  const [check, setCheck] = useState<CodeCheck | "checking" | null>(null);
  const run = useCallback(async () => {
    setCheck("checking");
    try {
      setCheck(await call<CodeCheck>("admin.code_check", { clientKey: c.key }));
    } catch (e) {
      setCheck({ state: "error", text: e instanceof Error ? plain(e.message) : "Couldn't check" });
    }
  }, [c.key]);
  useEffect(() => void run(), [run]);
  const words = check === null || check === "checking" ? "Checking…" : check.state === "readable" ? `Code: readable · ${check.repos} repo${check.repos === 1 ? "" : "s"}` : check.text;
  return (
    <>
      <AField label="Who can read this client's code" kind="Rule" s={saver.status(scope, "code_access")} retry={() => void saver.save(scope, "code_access", value, `${c.key}: who can read its code`)} hint="Every Cooptimizer by default, read only. Its team only keeps it to the people on this client." >
        <Select label={`${c.key}: who can read its code`} value={value} options={[{ value: "company", label: "Whole company" }, { value: "team", label: "Its team only" }]} onChange={(v) => void saver.save(scope, "code_access", v, `${c.key}: who can read its code`)} />
      </AField>
      <ARead label="Can FocusTime read it?" help="Read with the company DevOps token for this client. It needs Code (read), added to the token in DevOps.">
        <Buttons result={<span data-code-check={check && check !== "checking" ? check.state : "checking"}>{words}</span>}>
          <Button disabled={check === "checking"} onClick={() => void run()}>
            Check
          </Button>
        </Buttons>
      </ARead>
      <Row id="code-views" def={{ label: "Who opened its code" }} noSid help="Every repo and file opened, in Audit's Code views.">
        <a className="sp-btn plain" href={adminHref({ part: "audit", tab: "code" })}>
          See who opened its code
        </a>
      </Row>
    </>
  );
}

export function FixGapsField({ c, saver }: { c: ClientRow; saver: Saver }) {
  const scope = `client:${c.key}`;
  const on = saver.shown(scope, "fix_gaps", c.fixGaps ?? [...GAP_KINDS]);
  const save = (v: GapKind[]) => void saver.save(scope, "fix_gaps", GAP_KINDS.filter((k) => v.includes(k)), `${c.key}: what Needs attention counts`);
  return (
    <AField label="What Needs attention counts" kind="Rule" wide s={saver.status(scope, "fix_gaps")} retry={() => save(on)} hint="Backlog's Needs attention counts only these for this client. Turn off Unsized for a client that doesn't size in DevOps.">
      <Controls>
        {GAP_KINDS.map((k) => (
          <Sub key={k} text={GAP_WORDS[k]}>
            <ASwitch checked={on.includes(k)} label={`${c.key}: count ${GAP_WORDS[k]}`} onChange={(v) => save(v ? [...on, k] : on.filter((x) => x !== k))} />
          </Sub>
        ))}
      </Controls>
    </AField>
  );
}

const hasName = (list: readonly string[], name: string) => list.some((x) => x.toLowerCase() === name.toLowerCase());
const toggled = (list: readonly string[], name: string, on: boolean) => (on ? (hasName(list, name) ? [...list] : [...list, name]) : list.filter((x) => x.toLowerCase() !== name.toLowerCase()));
const LEVEL_WORDS = { top: "Top", parent: "Parent", child: "Child", task: "Task" } as const;

/**
 * WT-1 in Admin › Clients: the client's DevOps process (read with the company read PAT), one row per type with its icon,
 * level and history, and two Rules as switches: Needs breakdown (parent and top types) and Background (no hours).
 */
export function ProcessView({ c, saver, onRefresh, refreshing }: { c: ClientRow; saver: Saver; onRefresh: () => Promise<void>; refreshing: boolean }) {
  const scope = `client:${c.key}`;
  const noBreakdown = saver.shown(scope, "no_breakdown", c.noBreakdown);
  const background = saver.shown(scope, "background", c.background);
  const saveNb = (v: string[]) => void saver.save(scope, "no_breakdown", v, `${c.key}: needs breakdown`);
  const saveBg = (v: string[]) => void saver.save(scope, "background", v, `${c.key}: background types`);
  const p = c.process;
  return (
    <>
      <AField label="States treated as open" kind="Rule" wide s={saver.status(scope, "open_states")} retry={() => void saver.save(scope, "open_states", c.openStates, `${c.key}: open states`)} hint="Done states this client still works in, like Resolved. Commas between them.">
        <ListInput label={`${c.key}: states treated as open`} value={c.openStates} onSave={(v) => void saver.save(scope, "open_states", v, `${c.key}: open states`)} />
      </AField>
      <ARead label="Read from DevOps" help={p.ok ? `${[p.process ? `${p.process} process` : null, p.project, p.bugs].filter(Boolean).join(" · ")}.` : `It couldn't be read: ${p.message}. The Rules can still be set by type name.`}>
        <Button kind="quiet" disabled={refreshing} onClick={() => void onRefresh()}>
          {refreshing ? "Reading…" : "Refresh"}
        </Button>
      </ARead>
      {p.ok ? (
        <Row
          id="types"
          def={{ label: "Types" }}
          noSid
          wide
          badge={<Kind kind="Rule" />}
          help={`Needs breakdown and Background apply to everyone's plans for ${c.key}.`}
          mark={{ s: saver.status(scope, "no_breakdown") ?? saver.status(scope, "background"), retry: () => (saver.status(scope, "no_breakdown") ? saveNb(noBreakdown) : saveBg(background)) }}
        >
          <Table rowHeads
            label={`${c.key}: types`}
            head={["Type", "Level", "Needs breakdown", "Background", "Last 12 months"]}
            rowKey={(i) => p.types[i]!.name}
            rows={p.types.map((t) => {
              const portfolio = t.level === "top" || t.level === "parent";
              const needs = portfolio && !hasName(noBreakdown, t.name);
              const bg = hasName(background, t.name);
              return [
                <Value key="t">
                  <TypeIcon type={t.name} look={t} decorative /> {t.name}
                </Value>,
                t.level ? LEVEL_WORDS[t.level] : "Not on a backlog",
                portfolio ? (
                  <Sub key="n" text={needs ? "Yes" : "No: can be a to-do"}>
                    <ASwitch checked={needs} label={`${c.key}: ${t.name} needs breakdown`} onChange={(v) => saveNb(toggled(noBreakdown, t.name, !v))} />
                  </Sub>
                ) : (
                  "A to-do directly"
                ),
                <Sub key="b" text={bg ? "No hours" : "Counts hours"}>
                  <ASwitch checked={bg} label={`${c.key}: ${t.name} is background`} onChange={(v) => saveBg(toggled(background, t.name, v))} />
                </Sub>,
                t.history ? t.history.replace(`${t.name}: `, "") : "",
              ];
            })}
          />
        </Row>
      ) : (
        <>
          <AField label="Types that don't need breakdown" kind="Rule" wide s={saver.status(scope, "no_breakdown")} retry={() => saveNb(noBreakdown)} hint="Parent or top types that can be a to-do directly. Commas between them.">
            <ListInput label={`${c.key}: types that don't need breakdown`} value={noBreakdown} onSave={saveNb} />
          </AField>
          <AField label="Background types" kind="Rule" wide s={saver.status(scope, "background")} retry={() => saveBg(background)} hint="Types that don't count against hours. Commas between them.">
            <ListInput label={`${c.key}: background types`} value={background} onSave={saveBg} />
          </AField>
        </>
      )}
      {!p.ok && <Note>The process is read with the company read PAT.</Note>}
    </>
  );
}
