// WP-3: the request types list a person owns, on the DevOps patterns page. The list in use with its meanings, made-up
// examples and how many items carry each type; Add a type, Rename, Edit (meaning and example), Merge into another, and
// Remove, each with one line of why and what it costs said before Save (from the server's preview: a rename costs
// nothing; adding, merging or removing says how many items would need labeling again). "can't tell" and "other" can't be
// changed. Under it, "Suggested for other": the names the AI gave items it labeled "other", across clients and per
// client, each with Add as a type and Ignore. Earlier versions with who, when and why. No AI request is made here.
import { useState } from "react";
import { countWords } from "../../plan/patterns/analysis.ts";
import type { Results } from "../../plan/patterns/results.ts";
import type { TypeChange, TypeList } from "../../plan/patterns/types.ts";

type Version = { version: string; number: number; at: string; by: string | null; why: string | null; change: TypeChange | null };
type SuggestionRow = { name: string; meaning: string; count: number; clients: Record<string, number> };
type Data = { inUse: TypeList; versions: Version[]; suggestions: SuggestionRow[]; ignored: string[] };
type Act = (name: string, input: Record<string, unknown>, done?: string | ((r: unknown) => string)) => Promise<unknown>;
type Cost = { relabel: number; relabelSmall: number | null; words: string };
type Kind = "add" | "rename" | "edit" | "merge" | "remove";
type Draft = { kind: Kind; name: string; to: string; into: string; meaning: string; example: string; relabel: "other" | "all"; why: string };

const FIXED = ["can't tell", "other"];
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const KIND_WORDS: Record<Kind, string> = { add: "Add a type", rename: "Rename", edit: "Edit the meaning", merge: "Merge into another", remove: "Remove" };
const changeWords = (c: TypeChange) => (c.kind === "add" ? `added ${c.to[0]}` : c.kind === "rename" ? `renamed ${c.from[0]} to ${c.to[0]}` : c.kind === "merge" ? `merged ${c.from[0]} into ${c.to[0]}` : c.kind === "remove" ? `removed ${c.from[0]}` : c.kind === "edit" ? `edited ${c.from[0]}` : c.kind);

function editOf(d: Draft): Record<string, unknown> {
  switch (d.kind) {
    case "add": return { kind: "add", name: d.name, meaning: d.meaning, example: d.example, relabel: d.relabel };
    case "rename": return { kind: "rename", from: d.name, to: d.to };
    case "edit": return { kind: "edit", name: d.name, meaning: d.meaning, example: d.example };
    case "merge": return { kind: "merge", from: d.name, into: d.into };
    case "remove": return { kind: "remove", name: d.name };
  }
}

function ChangeForm({ list, draft, set, busy, act, onDone }: { list: TypeList; draft: Draft; set: (d: Draft) => void; busy: boolean; act: Act; onDone: () => void }) {
  const [cost, setCost] = useState<Cost | null>(null);
  const [error, setError] = useState<string | null>(null);
  const real = list.types.filter((t) => !FIXED.includes(t.name));
  const field = (k: keyof Draft) => (e: { target: { value: string } }) => (set({ ...draft, [k]: e.target.value }), setCost(null));
  const preview = async () => {
    setError(null);
    const r = (await act("patterns.list_change", { edit: editOf(draft), base: list.version, preview: true })) as { cost: Cost } | null;
    if (r) setCost(r.cost);
    else setError("Check the fields and try again.");
  };
  const save = async () => {
    const r = await act("patterns.list_change", { edit: editOf(draft), base: list.version, why: draft.why }, (x) => `Saved as version ${String((x as { version: string }).version).replace("own-", "")}. ${(x as { cost: Cost }).cost.words}`);
    if (r) onDone();
  };
  const ready = draft.why.trim().length >= 3 && (draft.kind === "add" ? !!draft.name.trim() && !!draft.meaning.trim() : draft.kind === "rename" ? !!draft.to.trim() : draft.kind === "edit" ? !!draft.meaning.trim() : draft.kind === "merge" ? !!draft.into : true);
  return (
    <div className="pat-detail pat-change" role="group" aria-label={KIND_WORDS[draft.kind]}>
      <h4>{KIND_WORDS[draft.kind]}{draft.kind !== "add" ? `: ${draft.name}` : ""}</h4>
      {draft.kind === "add" && <label className="set-inline">Name <input aria-label="New type's name" value={draft.name} maxLength={60} onChange={field("name")} /></label>}
      {draft.kind === "rename" && <label className="set-inline">New name <input aria-label="New name" value={draft.to} maxLength={60} onChange={field("to")} /></label>}
      {(draft.kind === "add" || draft.kind === "edit") && (
        <>
          <label className="set-inline">Meaning <input aria-label="Meaning" value={draft.meaning} maxLength={200} onChange={field("meaning")} /></label>
          <label className="set-inline">Made-up example <input aria-label="Made-up example" value={draft.example} maxLength={200} onChange={field("example")} /></label>
        </>
      )}
      {draft.kind === "merge" && (
        <label className="set-inline">Into{" "}
          <select aria-label="Merge into" value={draft.into} onChange={field("into")}>
            <option value="">Choose a type</option>
            {real.filter((t) => t.name !== draft.name).map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
          </select>
        </label>
      )}
      {draft.kind === "add" && (
        <div role="radiogroup" aria-label="Which items to label again" className="set-inline pat-buttons">
          <label><input type="radio" name="relabel" checked={draft.relabel === "other"} onChange={() => (set({ ...draft, relabel: "other" }), setCost(null))} /> Only the items now labeled other or can't tell{cost?.relabelSmall !== null && cost?.relabelSmall !== undefined ? ` (${cost.relabelSmall})` : ""}</label>
          <label><input type="radio" name="relabel" checked={draft.relabel === "all"} onChange={() => (set({ ...draft, relabel: "all" }), setCost(null))} /> Every labeled item</label>
        </div>
      )}
      <label className="set-inline">Why (one line) <input aria-label="Why" value={draft.why} maxLength={200} onChange={field("why")} /></label>
      <div className="set-inline pat-buttons">
        <button type="button" className="mini" disabled={busy} onClick={() => void preview()}>What it costs</button>
        <button type="button" className="mini" disabled={busy || !cost || !ready} onClick={() => void save()}>Save as a new version</button>
        <button type="button" className="mini" onClick={onDone}>Cancel</button>
      </div>
      {cost && <p className="set-hint" role="status">{cost.words}</p>}
      {!cost && <p className="set-hint">Check what it costs before saving. Labels already made are kept on the version they were made on.</p>}
      {error && <p className="error-line" role="alert">{error}</p>}
    </div>
  );
}

export function RequestTypes({ data, busy, results, act }: { data: Data; busy: boolean; results: Results; act: Act }) {
  const list = data.inUse;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [showIgnored, setShowIgnored] = useState(false);
  const blank = (kind: Kind, name = "", meaning = "", example = ""): Draft => ({ kind, name, to: name, into: "", meaning, example, relabel: "other", why: "" });
  const latest = data.versions[0];
  const clientsOf = (s: SuggestionRow) => Object.entries(s.clients).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, v]) => `${k} ${v}`).join(", ");
  return (
    <section aria-label="Request types" className="pat-section">
      <h3>Request types</h3>
      <p className="muted">
        Version {list.version.replace("own-", "")}, in use{latest && latest.version === list.version && latest.by ? `, made ${when(latest.at)} by ${latest.by}` : ""}{list.why ? `: ${list.why}` : ""}.
        Classification runs against it and never changes it; only a person changes it, here. A request type is always a best guess from the list, "other", or "can't tell". How clear an item is goes in readiness, never in the type.
      </p>
      <table className="adm-table pat-types">
        <thead><tr><th>Request type</th><th>Meaning</th><th>Made-up example</th><th>Labeled</th><th><span className="sr-only">Change</span></th></tr></thead>
        <tbody>{list.types.map((t) => (
          <tr key={t.name}>
            <th scope="row">{t.name}</th>
            <td>{t.meaning}</td>
            <td>{t.example}</td>
            <td>{results.requestTypes[t.name] ?? 0}</td>
            <td>{FIXED.includes(t.name) ? <span className="set-hint">Fixed</span> : (
              <span className="set-inline pat-buttons">
                {(["rename", "edit", "merge", "remove"] as const).map((k) => <button key={k} type="button" className="mini" disabled={busy} aria-label={`${KIND_WORDS[k]}: ${t.name}`} onClick={() => setDraft(blank(k, t.name, t.meaning, t.example))}>{k === "edit" ? "Edit" : k === "merge" ? "Merge" : KIND_WORDS[k]}</button>)}
              </span>
            )}</td>
          </tr>
        ))}</tbody>
      </table>
      <div className="set-inline pat-buttons">
        <button type="button" className="mini" disabled={busy} onClick={() => setDraft(blank("add"))}>+ Add a type</button>
      </div>
      <p className="set-hint">A rename or an edit costs nothing: labels follow the type, not its wording. Adding, merging or removing a type says before you save how many items would need labeling again; Estimate prices them.</p>
      {draft && <ChangeForm list={list} draft={draft} set={setDraft} busy={busy} act={act} onDone={() => setDraft(null)} />}

      <h4>Suggested for "other"</h4>
      <p className="set-hint">The names the AI gave items it labeled "other", across clients and per client. Nothing is added without Add as a type. Names about how unclear an item is, or naming a client, are never shown.</p>
      {data.suggestions.length ? (
        <table className="adm-table pat-suggest">
          <thead><tr><th>Suggested name</th><th>Items</th><th>By client</th><th><span className="sr-only">Choose</span></th></tr></thead>
          <tbody>{data.suggestions.map((x) => (
            <tr key={x.name}>
              <th scope="row">{x.name}{x.meaning && <span className="set-hint adm-block">{x.meaning}</span>}</th>
              <td>{countWords(x.count)}</td>
              <td>{clientsOf(x)}</td>
              <td>
                <span className="set-inline pat-buttons">
                  <button type="button" className="mini" disabled={busy} aria-label={`Add as a type: ${x.name}`} onClick={() => setDraft({ ...blank("add", x.name, x.meaning), why: `Suggested for other on ${x.count} item${x.count === 1 ? "" : "s"}` })}>Add as a type</button>
                  <button type="button" className="mini" disabled={busy} aria-label={`Ignore: ${x.name}`} onClick={() => void act("patterns.suggestion", { name: x.name, ignore: true }, `Ignored "${x.name}".`)}>Ignore</button>
                </span>
              </td>
            </tr>
          ))}</tbody>
        </table>
      ) : <p className="muted">None yet.</p>}
      {data.ignored.length > 0 && (
        <p className="set-hint">
          {data.ignored.length} ignored.{" "}
          <button type="button" className="mini" aria-expanded={showIgnored} onClick={() => setShowIgnored(!showIgnored)}>{showIgnored ? "Hide" : "Show"}</button>
          {showIgnored && data.ignored.map((n) => <span key={n}> · {n} <button type="button" className="mini" disabled={busy} onClick={() => void act("patterns.suggestion", { name: n, ignore: false }, `"${n}" is back.`)}>Show again</button></span>)}
        </p>
      )}

      <h4>Versions</h4>
      <ul className="pat-versions">
        {data.versions.map((v) => (
          <li key={v.version}>Version {v.number}{v.version === list.version ? " (in use)" : ""}, {when(v.at)}{v.by ? ` by ${v.by}` : ""}{v.change ? `: ${changeWords(v.change)}` : ""}{v.why ? `. Why: ${v.why}` : ""}</li>
        ))}
        {!data.versions.some((v) => v.version === "own-1") && <li>Version 1, the first list in use (not changed yet).</li>}
      </ul>
      <p className="set-hint">Earlier lists, the AI-written one included, are kept as they were: Download request types lists every one.</p>
    </section>
  );
}
