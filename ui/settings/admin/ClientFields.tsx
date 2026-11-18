// SA-4: a client's fields that are more than one input (moved from ui/settings/Admin.tsx unchanged): Source systems,
// who can read its code and Check, what Needs attention counts, and its DevOps process with the types' two Rules.
import { useCallback, useEffect, useState } from "react";
import { call } from "../../api.ts";
import { SaveMark, plain } from "../autosave.tsx";
import { SOURCE_SYSTEM_LABEL, type SourceSystem } from "../../../plan/standards.ts";
import { GAP_KINDS, GAP_WORDS, type GapKind } from "../../../plan/fixnext.ts";
import { TypeIcon } from "../../TypeIcon.tsx";
import { AField, Kind, ListInput, type ClientRow, type Saver } from "./shared.tsx";

/** AH-3: the gaps Ahead's Fix next and Readiness count for this client (all four by default). */
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
    <div className="set-form">
      <AField label="Source systems" kind="Rule" s={saver.status(scope, "source_systems")} retry={() => save(shown ?? null)} hint="Which source-system standards go with this client's AI drafts.">
        <select aria-label={`${c.key}: source systems`} value={current} onChange={(e) => save(SOURCE_CHOICES.find(([id]) => id === e.target.value)![2])}>
          {SOURCE_CHOICES.map(([id, label]) => (
            <option key={id} value={id}>{label}</option>
          ))}
        </select>
      </AField>
    </div>
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
    <div className="set-form adm-code">
      <AField label="Who can read this client's code" kind="Rule" s={saver.status(scope, "code_access")} retry={() => void saver.save(scope, "code_access", value, `${c.key}: who can read its code`)} hint="Code shows every client's repos, read only, to every Cooptimizer by default. Its team only keeps them to the people on this client. Every file opened is logged in Admin › Audit › Code views.">
        <select aria-label={`${c.key}: who can read its code`} value={value} onChange={(e) => void saver.save(scope, "code_access", e.target.value, `${c.key}: who can read its code`)}>
          <option value="company">Whole company</option>
          <option value="team">Its team only</option>
        </select>
      </AField>
      <div className="set-field">
        <span className="set-label">Can FocusTime read it?</span>
        <span className="set-value" data-code-check={check && check !== "checking" ? check.state : "checking"}>
          {words}{" "}
          <button type="button" className="mini" disabled={check === "checking"} onClick={() => void run()}>
            Check
          </button>
        </span>
        <span className="set-hint">Read with the company DevOps token for this client. It needs Code (read), added to the token in DevOps.</span>
      </div>
    </div>
  );
}

export function FixGapsField({ c, saver }: { c: ClientRow; saver: Saver }) {
  const scope = `client:${c.key}`;
  const on = saver.shown(scope, "fix_gaps", c.fixGaps ?? [...GAP_KINDS]);
  const save = (v: GapKind[]) => void saver.save(scope, "fix_gaps", GAP_KINDS.filter((k) => v.includes(k)), `${c.key}: what Needs attention counts`);
  return (
    <div className="set-form adm-fixgaps">
      <AField label="What Needs attention counts" kind="Rule" s={saver.status(scope, "fix_gaps")} retry={() => save(on)} hint="Backlog's Needs attention counts only these for this client. Turn off Unsized for a client that doesn't size in DevOps.">
        <span className="adm-switches" role="group" aria-label={`${c.key}: what Needs attention counts`}>
          {GAP_KINDS.map((k) => (
            <label key={k} className="adm-switch">
              <input type="checkbox" role="switch" checked={on.includes(k)} aria-label={`${c.key}: count ${GAP_WORDS[k]}`} onChange={(e) => save(e.target.checked ? [...on, k] : on.filter((x) => x !== k))} /> {GAP_WORDS[k]}
            </label>
          ))}
        </span>
      </AField>
    </div>
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
    <div className="set-form adm-process">
      <h4>
        DevOps process{" "}
        <button type="button" className="mini quiet" disabled={refreshing} onClick={() => void onRefresh()}>
          {refreshing ? "Reading…" : "Refresh"}
        </button>
      </h4>
      <div className="set-grid">
        <AField label="States treated as open" kind="Rule" s={saver.status(scope, "open_states")} retry={() => void saver.save(scope, "open_states", c.openStates, `${c.key}: open states`)} hint="Done states this client still works in, like Resolved. Commas between them.">
          <ListInput label={`${c.key}: states treated as open`} value={c.openStates} onSave={(v) => void saver.save(scope, "open_states", v, `${c.key}: open states`)} />
        </AField>
      </div>
      {p.ok ? (
        <>
          <p className="muted">
            {[p.process ? `${p.process} process` : null, p.project, p.bugs].filter(Boolean).join(" · ")}. Needs breakdown and Background are Rules: they apply to everyone's plans for {c.key}.
          </p>
          <div className="adm-scroll">
            <table className="adm-table adm-types">
              <thead>
                <tr>
                  <th scope="col">Type</th>
                  <th scope="col">Level</th>
                  <th scope="col">Needs breakdown <Kind kind="Rule" /></th>
                  <th scope="col">Background <Kind kind="Rule" /></th>
                  <th scope="col">Last 12 months</th>
                </tr>
              </thead>
              <tbody>
                {p.types.map((t) => {
                  const portfolio = t.level === "top" || t.level === "parent";
                  const needs = portfolio && !hasName(noBreakdown, t.name);
                  const bg = hasName(background, t.name);
                  return (
                    <tr key={t.name}>
                      <th scope="row">
                        <TypeIcon type={t.name} look={t} decorative /> {t.name}
                      </th>
                      <td>{t.level ? LEVEL_WORDS[t.level] : "Not on a backlog"}</td>
                      <td>
                        {portfolio ? (
                          <label className="adm-switch">
                            <input type="checkbox" role="switch" checked={needs} aria-label={`${c.key}: ${t.name} needs breakdown`} onChange={(e) => saveNb(toggled(noBreakdown, t.name, !e.target.checked))} /> {needs ? "Yes" : "No: can be a to-do"}
                          </label>
                        ) : (
                          <span className="muted">A to-do directly</span>
                        )}
                      </td>
                      <td>
                        <label className="adm-switch">
                          <input type="checkbox" role="switch" checked={bg} aria-label={`${c.key}: ${t.name} is background`} onChange={(e) => saveBg(toggled(background, t.name, e.target.checked))} /> {bg ? "No hours" : "Counts hours"}
                        </label>
                      </td>
                      <td className="muted">{t.history ? t.history.replace(`${t.name}: `, "") : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <SaveMark s={saver.status(scope, "no_breakdown") ?? saver.status(scope, "background")} retry={() => (saver.status(scope, "no_breakdown") ? saveNb(noBreakdown) : saveBg(background))} />
        </>
      ) : (
        <>
          <p className="muted">The process couldn't be read: {p.message}. The Rules can still be set by type name.</p>
          <div className="set-grid">
            <AField label="Types that don't need breakdown" kind="Rule" s={saver.status(scope, "no_breakdown")} retry={() => saveNb(noBreakdown)} hint="Parent or top types that can be a to-do directly. Commas between them.">
              <ListInput label={`${c.key}: types that don't need breakdown`} value={noBreakdown} onSave={saveNb} />
            </AField>
            <AField label="Background types" kind="Rule" s={saver.status(scope, "background")} retry={() => saveBg(background)} hint="Types that don't count against hours. Commas between them.">
              <ListInput label={`${c.key}: background types`} value={background} onSave={saveBg} />
            </AField>
          </div>
        </>
      )}
    </div>
  );
}
