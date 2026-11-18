// SA-4: Admin › Audit, two tabs: Settings changes (every admin change, the setting by its label and the client's or
// person's name, never a code name or an id) and Code views (who opened which client's code). What is stored doesn't
// change: the labels come from the one list of Admin's settings (settings-list.ts).
import { useEffect, useState } from "react";
import { call } from "../../api.ts";
import { plain } from "../autosave.tsx";
import { useSection, when } from "./shared.tsx";
import { ADMIN_SETTINGS, auditSettingLabel } from "./settings-list.ts";

// ---------- Audit ----------

type Entry = { id: number; at: string; actorName: string; area: string; target: string; setting: string; oldValue: string | null; newValue: string | null; note: string | null };
const AREAS = [["", "Everything"], ["clients", "Clients"], ["ai", "AI"], ["conversations", "Client chats"], ["organization", "Planning and standards"], ["levels", "Levels"], ["people", "People"]] as const;
const shown = (v: string | null) => {
  if (v === null) return "none";
  try {
    const x: unknown = JSON.parse(v);
    if (Array.isArray(x)) return x.join(", ") || "none";
    if (typeof x === "boolean") return x ? "on" : "off";
    if (typeof x === "object" && x) return JSON.stringify(x);
    return String(x);
  } catch {
    return v;
  }
};

type CodeViewRow = { id: number; at: string; actorId: string; actorName: string; clientKey: string; repoName: string; path: string; event: "repo_opened" | "file_opened" | "find_used" | "kinds_listed" | "names_searched" | "inside_searched" | "where_new_form" | "where_draft_editor" | "pages_listed" | "fields_listed" | "tables_listed" };
type CodeViewsData = { views: CodeViewRow[]; counts: { clientKey: string; views: number }[]; people: { id: string; name: string }[]; shown: number };
const CODE_EVENT_WORDS: Record<CodeViewRow["event"], string> = { repo_opened: "Opened the repo", file_opened: "Opened a file", find_used: "Used Find", kinds_listed: "Listed by kind", names_searched: "Searched names", inside_searched: "Searched inside files", where_new_form: "Listed names for Where is it? (New form)", where_draft_editor: "Listed names for Where is it? (draft editor)", pages_listed: "Pages listed", fields_listed: "Measures and columns listed", tables_listed: "Tables listed" };
/** RB-3b: the rows whose File column names a thing: the file opened, or the report's, table's or model's file a listing read. */
const CODE_EVENT_PATH = new Set<CodeViewRow["event"]>(["file_opened", "pages_listed", "fields_listed", "tables_listed"]);
/** RB-1: Admin › Audit, Code views: who opened which client's code, newest first, never any content. */
export function CodeViews() {
  const [clientKey, setClientKey] = useState("");
  const [personId, setPersonId] = useState("");
  const [data, setData] = useState<CodeViewsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    call<CodeViewsData>("admin.code_views", { ...(clientKey ? { clientKey } : {}), ...(personId ? { personId } : {}) }).then(
      (d) => live && (setData(d), setError(null)),
      (e) => live && setError(e instanceof Error ? plain(e.message) : "Couldn't load this"),
    );
    return () => void (live = false);
  }, [clientKey, personId]);
  const clients = data ? [...new Set([...data.counts.map((c) => c.clientKey), ...data.views.map((v) => v.clientKey)])].sort((a, b) => a.localeCompare(b)) : [];
  return (
    <section className="set-form adm-code-views" data-setting="code-views" aria-labelledby="code-views-h">
      <h3 id="code-views-h" className="sr-only">Code views</h3>
      <p className="muted">Who opened which client's code in Code, and when: the repo, the file, Find, or a report's pages and a model's tables or measures listed for Where is it? Never any of the code. The newest {data?.shown ?? 200}; kept 12 months.</p>
      {data && data.counts.length > 0 && (
        <p className="adm-code-counts">
          Last 30 days: {data.counts.map((c) => `${c.clientKey} ${c.views}`).join(" · ")}
        </p>
      )}
      <div className="adm-code-filter">
        <select aria-label="Client" value={clientKey} onChange={(e) => setClientKey(e.target.value)}>
          <option value="">Every client</option>
          {clients.map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>
        <select aria-label="Person" value={personId} onChange={(e) => setPersonId(e.target.value)}>
          <option value="">Everyone</option>
          {(data?.people ?? []).map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>
      {error && <p className="field-problem">{error}</p>}
      {data && data.views.length === 0 && <p className="muted">Nothing yet.</p>}
      {data && data.views.length > 0 && (
        <div className="adm-scroll">
          <table className="adm-table adm-code-table">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Who</th>
                <th scope="col">Client</th>
                <th scope="col">Repo</th>
                <th scope="col">What</th>
                <th scope="col">File</th>
              </tr>
            </thead>
            <tbody>
              {data.views.map((v) => (
                <tr key={v.id}>
                  <td>{when(v.at)}</td>
                  <td>{v.actorName}</td>
                  <td>{v.clientKey}</td>
                  <td>{v.repoName || (v.event === "kinds_listed" || v.event === "names_searched" || v.event === "inside_searched" || v.event === "where_new_form" || v.event === "where_draft_editor" ? "All its repos" : "")}</td>
                  <td>{CODE_EVENT_WORDS[v.event]}</td>
                  <td className="adm-val">{CODE_EVENT_PATH.has(v.event) ? v.path : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}


/** SA-4: a client page's See changes: Settings changes opens filtered to that client (once, for this visit). */
/** Who a change was for, in words: a team value is for everyone (a seeded row may carry its key as the target). */
const forWhom = (e: { setting: string; target: string }) => (e.setting.startsWith("org/") ? "Everyone" : e.target);

let pendingFilter: string | null = null;
export const seeChangesFor = (clientKey: string) => void (pendingFilter = clientKey);

/** The stored keys whose label has the words typed, so "allow ai" also finds client:<key>/allow_ai. */
export const keysFor = (q: string): string[] => {
  const s = q.trim().toLowerCase();
  if (s.length < 3) return [];
  return [...new Set(ADMIN_SETTINGS.filter((x) => x.label.toLowerCase().includes(s)).map((x) => (x.scope === "audit" ? x.key : `/${x.key}`)))].slice(0, 4);
};

export function SettingsChanges() {
  const [area, setArea] = useState("");
  const [text, setText] = useState(() => {
    const f = pendingFilter ?? "";
    pendingFilter = null;
    return f;
  });
  const [q, setQ] = useState(text);
  useEffect(() => {
    const t = setTimeout(() => setQ(text), 250);
    return () => clearTimeout(t);
  }, [text]);
  const { data, error } = useSection<{ entries: Entry[] }>("audit", { area, text: q });
  // A label's words find its rows too (the store matches what is stored: the key, the client's or person's name).
  const [more, setMore] = useState<Entry[]>([]);
  useEffect(() => {
    let live = true;
    const keys = keysFor(q);
    if (!keys.length) return void setMore([]);
    void Promise.all(keys.map((k) => call<{ entries: Entry[] }>("admin.load", { section: "audit", area, text: k }).then((d) => d.entries, () => [] as Entry[]))).then((all) => live && setMore(all.flat()));
    return () => void (live = false);
  }, [q, area]);
  const byId = new Map<number, Entry>();
  for (const e of [...(data?.entries ?? []), ...more]) byId.set(e.id, e);
  const entries = [...byId.values()].sort((x, y) => y.id - x.id).slice(0, 200);
  return (
    <div className="set-form">
      <p className="muted">Every admin change: who, when, the setting and its old and new value. The last 200.</p>
      <div className="set-inline adm-audit-filter">
        <select aria-label="Area" value={area} onChange={(e) => setArea(e.target.value)}>
          {AREAS.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <input type="search" aria-label="Filter" placeholder="Filter by who, setting or client" value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      {error && <p className="field-problem">{plain(error)}</p>}
      {data && entries.length === 0 && <p className="muted">Nothing yet.</p>}
      {data && entries.length > 0 && (
        <div className="adm-scroll">
          <table className="adm-table adm-audit adm-rows-phone">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Who</th>
                <th scope="col">For</th>
                <th scope="col">Setting</th>
                <th scope="col">Was</th>
                <th scope="col">Now</th>
                <th scope="col">Note</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} data-setting-key={e.setting}>
                  <td data-label="When">{when(e.at)}</td>
                  <td data-label="Who">{e.actorName}</td>
                  <td data-label="For">{forWhom(e)}</td>
                  <td data-label="Setting">{auditSettingLabel(e.setting)}</td>
                  <td data-label="Was" className="adm-val">{shown(e.oldValue)}</td>
                  <td data-label="Now" className="adm-val">{shown(e.newValue)}</td>
                  <td data-label="Note">{e.note ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
