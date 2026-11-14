// ADM-1: the admin console, a part of Settings shown only to FocusTime admins (the server checks every action again).
// Clients, AI, Conversations, People, Organization, Status and Audit. Each field saves itself through admin.set, with
// "Saved" and an Undo toast; turning AI off for everyone and removing a person confirm first. Nothing here shows
// anyone's plan, picks, follow-ups, captures, focus sessions, PATs, AI request text or chat messages: the server's
// sections carry names, dates, counts and yes or no only.
import { Stamp } from "../Stamp.tsx";
import { SOURCE_SYSTEM_LABEL, type SourceSystem } from "../../plan/standards.ts";
import { DeploySettings } from "../DeployItems.tsx";
import { TextBox } from "../TextBox.tsx";
import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { call } from "../api.ts";
import { useReturnFocus } from "../CloseButton.tsx";
import { SaveMark, plain, useSaveContext, type FieldStatus } from "./autosave.tsx";
import { DeliveryChatField, DeliveryChatsProvider } from "./DeliveryChats.tsx";
import { MeetingsField } from "./AdminMeetings.tsx";
import { shortDate } from "../labels.ts";
import { TypeIcon } from "../TypeIcon.tsx";
import { STATUS_WORD, type ConversationStatus } from "../../plan/conversations.ts";
import type { ClientProcess } from "../../actions/types.ts";
import type { StatusGroup } from "../../actions/status-rows.ts";
import { StatusRows } from "./StatusRows.tsx";
import { ScopeField, type ClientScopeRow } from "./AdminScope.tsx";
import { GAP_KINDS, GAP_WORDS, type GapKind } from "../../plan/fixnext.ts";
import { WhoSetUp } from "./WhoSetUp.tsx";
import { Icon } from "../icons.tsx";

export const ADMIN_UI_SECTIONS = [
  ["admin-clients", "Clients"],
  ["admin-ai", "AI"],
  ["admin-conversations", "Conversations"],
  ["admin-people", "People"],
  ["admin-organization", "Organization"],
  ["admin-standards", "Standards"],
  ["admin-status", "Status"],
  ["admin-audit", "Audit"],
] as const;
export type AdminUiSection = (typeof ADMIN_UI_SECTIONS)[number][0];
/** TP-1b: Admin sections taken out of the app (Work templates). An old address opens Admin's first page. */
export const RETIRED_ADMIN_SECTIONS: readonly string[] = ["admin-templates"];
export const isAdminSection = (s: string): s is AdminUiSection => ADMIN_UI_SECTIONS.some(([id]) => id === s);

/** Whether the signed-in person is a FocusTime admin (null while asking). */
export function useAdmin(): boolean | null {
  const [admin, setAdmin] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    call<{ admin: boolean }>("admin.status", {}).then(
      (r) => live && setAdmin(r.admin),
      () => live && setAdmin(false),
    );
    return () => void (live = false);
  }, []);
  return admin;
}

// ---------- saving ----------

type SetResult = { old: unknown; value: unknown; warning: string | null };

/** Saves team settings one field at a time, with Saved, the plain error, Retry and Undo. */
function useAdminSave(onSaved: () => unknown) {
  const ctx = useSaveContext();
  const [statuses, setStatuses] = useState<Record<string, FieldStatus>>({});
  // The value just chosen, shown at once while it saves and the section reloads.
  const [pending, setPending] = useState<Record<string, { v: unknown }>>({});
  const unpend = (id: string) => setPending(({ [id]: _, ...rest }) => rest);
  const [warning, setWarning] = useState<string | null>(null);
  const setStatus = (id: string, s: FieldStatus) => setStatuses((all) => ({ ...all, [id]: s }));
  const send = (scope: string, key: string, value: unknown) => call<SetResult>("admin.set", value === undefined ? { scope, key, clear: true } : { scope, key, value });
  const save = useCallback(
    async (scope: string, key: string, value: unknown, label: string) => {
      const id = `${scope}/${key}`;
      setStatus(id, { kind: "saving" });
      setPending((all) => ({ ...all, [id]: { v: value } }));
      const p = (async () => {
        try {
          const r = await send(scope, key, value);
          setStatus(id, { kind: "saved" });
          setWarning(r.warning);
          setTimeout(() => setStatuses((all) => (all[id]?.kind === "saved" ? { ...all, [id]: null } : all)), 2000);
          await onSaved();
          unpend(id);
          ctx?.offerUndo(`${label} saved.`, async () => {
            await send(scope, key, r.old === null ? undefined : r.old);
            setStatus(id, null);
            onSaved();
          });
        } catch (e) {
          unpend(id);
          const m = e instanceof Error ? plain(e.message) : "";
          setStatus(id, m && !/network|fetch/i.test(m) ? { kind: "error", messages: [m] } : { kind: "retry" });
        }
      })();
      ctx?.track(p);
      return p;
    },
    [ctx, onSaved], // eslint-disable-line react-hooks/exhaustive-deps
  );
  /** The saved value, or the one being saved. */
  const shown = <T,>(scope: string, key: string, saved: T): T => (`${scope}/${key}` in pending ? (pending[`${scope}/${key}`]!.v as T) : saved);
  return { save, shown, status: (scope: string, key: string) => statuses[`${scope}/${key}`] ?? null, warning };
}
type Saver = ReturnType<typeof useAdminSave>;

/** A section's data from admin.load, reloaded after each save. */
function useSection<T>(section: string, extra: Record<string, unknown> = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = JSON.stringify(extra);
  const load = useCallback(async () => {
    try {
      setData(await call<T>("admin.load", { section, ...extra }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load this");
    }
  }, [section, key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => void load(), [load]);
  /** Once with more input (Admin › Clients' Refresh reads DevOps again). */
  const loadWith = useCallback(
    async (more: Record<string, unknown>) => {
      try {
        setData(await call<T>("admin.load", { section, ...extra, ...more }));
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't load this");
      }
    },
    [section, key], // eslint-disable-line react-hooks/exhaustive-deps
  );
  return { data, error, load, loadWith };
}

function Kind({ kind }: { kind: "Rule" | "Default" | "Default by level" }) {
  const hint = kind === "Rule" ? "Applies to everyone" : kind === "Default" ? "People may change it for themselves" : "Per level; people may change it for themselves";
  return (
    <span className="adm-kind" title={hint}>
      {kind}
    </span>
  );
}

function AField({ label, kind, hint, s, retry, children }: { label: string; kind: "Rule" | "Default" | "Default by level"; hint?: ReactNode; s: FieldStatus; retry: () => void; children: ReactNode }) {
  return (
    <div className="set-field adm-field">
      <span className="set-label">
        {label} <Kind kind={kind} />
      </span>
      {children}
      <SaveMark s={s} retry={retry} />
      {hint && <span className="set-hint">{hint}</span>}
    </div>
  );
}

const csv = (v: string) => [...new Set(v.split(",").map((x) => x.trim()).filter(Boolean))];

/** A comma list saved on blur or Enter (only when changed). */
function ListInput({ value, onSave, label, placeholder }: { value: readonly string[]; onSave: (v: string[]) => void; label: string; placeholder?: string }) {
  const [text, setText] = useState(value.join(", "));
  useEffect(() => setText(value.join(", ")), [value.join("\u0000")]); // eslint-disable-line react-hooks/exhaustive-deps
  const commit = () => {
    const next = csv(text);
    if (next.join("\u0000") !== value.join("\u0000")) onSave(next);
  };
  return <input aria-label={label} value={text} placeholder={placeholder ?? "none"} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), commit())} />;
}

/** A number saved on blur or Enter. */
function NumInput({ value, onSave, label, min, max, step = 1 }: { value: number; onSave: (v: number) => void; label: string; min: number; max: number; step?: number }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const n = Number(text);
    if (text.trim() !== "" && n !== value) onSave(n);
  };
  return <input type="number" aria-label={label} min={min} max={max} step={step} value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), commit())} />;
}

/** A line of text saved on blur or Enter. */
function TextInput({ value, onSave, label, placeholder, maxLength = 100 }: { value: string; onSave: (v: string) => void; label: string; placeholder?: string; maxLength?: number }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => text.trim() !== value && onSave(text.trim());
  return <input aria-label={label} value={text} maxLength={maxLength} placeholder={placeholder} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), commit())} />;
}

const colorVar = (c: string | null) => (c ? (c.startsWith("#") ? c : `var(--client-${c})`) : "var(--client-none)");

// ---------- Clients ----------

type ClientRow = { /** KB-1. */ sourceSystems?: SourceSystem[] | null; key: string; isClient: boolean; whyText: string; names: string[]; types: string[]; treatAsClient: boolean; hidden: boolean; hasSettings: boolean; color: string | null; colorFrom: "suggested" | "admin"; allowAi: boolean; openStates: string[]; noBreakdown: string[]; background: string[]; /** GD-2 */ aliases?: string[]; /** HK-7 */ exactCase?: boolean; exactCaseDefault?: boolean; houseStyle: string | null; fixGaps?: GapKind[]; /** RB-1 */ codeAccess?: "company" | "team"; process: ClientProcess; scope: ClientScopeRow | null; leads: { personId: string; name: string; primary: boolean; why: string[] }[] };
type ClientFilterValue = "customers" | "all";
type ClientCounts = { customers: number; all: number };
type ClientsData = { palette: string[]; suggested: string[]; filter: ClientFilterValue; accountsRead: boolean; counts: ClientCounts; clients: ClientRow[] };

/** ADM-2: Customers (the default) or All accounts, on Admin › Clients and AI. */
function ClientFilter({ value, counts, onChange }: { value: ClientFilterValue; counts: ClientCounts | undefined; onChange: (v: ClientFilterValue) => void }) {
  return (
    <span className="adm-filter" role="radiogroup" aria-label="Which accounts">
      {(["customers", "all"] as const).map((v) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)}>
          {v === "customers" ? "Customers" : "All accounts"}
          {counts ? <span className="muted"> {v === "customers" ? counts.customers : counts.all}</span> : null}
        </button>
      ))}
    </span>
  );
}

const TYPE_WORDS: Record<string, string> = { customer: "Customer", prospect: "Prospect", partner: "Partner", vendor: "Vendor", consultant: "Consultant", other: "Other", competitor: "Competitor", investor: "Investor", influencer: "Influencer", press: "Press", reseller: "Reseller", supplier: "Supplier" };

/** ADM-2: every account with why it is or isn't a client, and the admins' two overrides (each audited). */
function AllAccounts({ rows, saver }: { rows: ClientRow[]; saver: Saver }) {
  return (
    <div className="adm-scroll">
      <table className="adm-table adm-accounts">
        <thead>
          <tr>
            <th scope="col">Account</th>
            <th scope="col">In Dataverse</th>
            <th scope="col">Client?</th>
            <th scope="col">Treat as a client <Kind kind="Rule" /></th>
            <th scope="col">Hide from FocusTime <Kind kind="Rule" /></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const scope = `client:${c.key}`;
            const internal = c.whyText === "Cooptimize Internal";
            return (
              <tr key={c.key}>
                <th scope="row">
                  {c.key}
                  {c.names.length > 0 && c.names.join(", ") !== c.key && <span className="muted adm-email">{c.names.join(", ")}</span>}
                </th>
                <td>{c.types.length ? c.types.map((t) => TYPE_WORDS[t] ?? t).join(", ") : <span className="muted">No type</span>}</td>
                <td>
                  {c.isClient ? "Client" : <span className="muted">Not a client</span>}
                  <span className="set-hint">{c.whyText}</span>
                  {c.hasSettings && <span className="adm-mark">Has settings, not a client</span>}
                </td>
                <td>
                  {!internal && (
                    <label className="adm-switch">
                      <input type="checkbox" role="switch" checked={saver.shown(scope, "treat_as_client", c.treatAsClient)} aria-label={`Treat ${c.key} as a client`} onChange={(e) => void saver.save(scope, "treat_as_client", e.target.checked ? true : undefined, `${c.key}: treat as a client`)} /> {c.treatAsClient ? "Yes" : "No"}
                    </label>
                  )}
                  <SaveMark s={saver.status(scope, "treat_as_client")} retry={() => void saver.save(scope, "treat_as_client", c.treatAsClient, `${c.key}: treat as a client`)} />
                </td>
                <td>
                  {internal ? (
                    <span className="muted">Always a client</span>
                  ) : (
                    <label className="adm-switch">
                      <input type="checkbox" role="switch" checked={saver.shown(scope, "hidden", c.hidden)} aria-label={`Hide ${c.key} from FocusTime`} onChange={(e) => void saver.save(scope, "hidden", e.target.checked ? true : undefined, `${c.key}: hide from FocusTime`)} /> {c.hidden ? "Hidden" : "No"}
                    </label>
                  )}
                  <SaveMark s={saver.status(scope, "hidden")} retry={() => void saver.save(scope, "hidden", c.hidden, `${c.key}: hide from FocusTime`)} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AdminClients() {
  const [filter, setFilter] = useState<ClientFilterValue>("customers");
  const { data, error, load, loadWith } = useSection<ClientsData>("clients", { filter });
  const saver = useAdminSave(load);
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = async () => {
    setRefreshing(true);
    await loadWith({ refresh: true });
    setRefreshing(false);
  };
  if (error) return <p className="field-problem">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;
  return (
    <DeliveryChatsProvider>
      <p className="muted">Each client's chats, team color, process settings and house style, for everyone. People see these read-only, marked "Set by your FocusTime admin"; a person may still pick their own color.</p>
      <div className="set-row-actions">
        <ClientFilter value={filter} counts={data.counts} onChange={setFilter} />
        <span className="set-hint">Clients are active Dataverse accounts of type Customer, plus Cooptimize Internal and any account treated as a client below. Nothing is deleted.</span>
      </div>
      {saver.warning && <p className="set-problem" role="status">{saver.warning}</p>}
      {!data.accountsRead && <p className="set-problem">Account types aren't read from Dataverse yet. Until they are, only accounts with Account Workers or Focus Time, Cooptimize Internal and accounts treated as clients count; prospects don't. Admin › Status › Refresh.</p>}
      {data.clients.length === 0 && <p className="muted">No clients yet. They come from Dataverse once people are read (Admin › People › Refresh from Dataverse).</p>}
      {filter === "all" ? (
        <AllAccounts rows={data.clients} saver={saver} />
      ) : (
        <div className="set-clients">
          {data.clients.map((c) => (
            <AdminClientCard key={c.key} c={c} palette={data.palette} saver={saver} onRefresh={onRefresh} refreshing={refreshing} />
          ))}
        </div>
      )}
    </DeliveryChatsProvider>
  );
}

function AdminClientCard({ c, palette, saver, onRefresh, refreshing }: { c: ClientRow; palette: string[]; saver: Saver; onRefresh: () => Promise<void>; refreshing: boolean }) {
  const scope = `client:${c.key}`;
  const [style, setStyle] = useState(c.houseStyle ?? "");
  useEffect(() => setStyle(c.houseStyle ?? ""), [c.houseStyle]);
  const [hex, setHex] = useState(c.color?.startsWith("#") ? c.color : "");
  return (
    <div className="set-client-wrap adm-client" style={{ "--c": colorVar(c.color) } as CSSProperties}>
      <div className="set-form set-client">
        <h3>
          <span className="swatch" /> {c.key}
        </h3>
        <div className="set-grid">
          <AField label="Team color" kind="Default" s={saver.status(scope, "color")} retry={() => void saver.save(scope, "color", c.color, `${c.key}: team color`)} hint={c.colorFrom === "suggested" ? "Suggested by FocusTime: distinct from the others, readable in both themes. Pick another to set it." : "Set by an admin. People may pick their own and reset to this one."}>
            <span className="set-choice palette adm-palette" role="radiogroup" aria-label={`${c.key}: team color`}>
              {palette.map((slot) => (
                <label key={slot} className="slot" title={slot}>
                  <input type="radio" name={`team-color-${c.key}`} checked={saver.shown(scope, "color", c.color) === slot} onChange={() => void saver.save(scope, "color", slot, `${c.key}: team color`)} aria-label={slot} />
                  <span className="slot-swatch" style={{ background: `var(--client-${slot})` }} />
                </label>
              ))}
            </span>
            <span className="set-inline">
              <input aria-label={`${c.key}: custom color`} value={hex} placeholder="#rrggbb" maxLength={7} onChange={(e) => setHex(e.target.value)} onKeyDown={(e) => e.key === "Enter" && hex && void saver.save(scope, "color", hex.trim().toLowerCase(), `${c.key}: team color`)} />
              <button type="button" className="mini" disabled={!/^#[0-9a-fA-F]{6}$/.test(hex.trim())} onClick={() => void saver.save(scope, "color", hex.trim().toLowerCase(), `${c.key}: team color`)}>
                Use
              </button>
            </span>
          </AField>
          <div className="set-field">
            <span className="set-label">Leads</span>
            <span className="set-value">
              {c.leads.length ? c.leads.map((l) => `${l.name}${l.primary ? " (primary)" : ""}: ${l.why.join(", ")}`).join("; ") : <span className="muted">None found</span>}
            </span>
            <span className="set-hint">From Dataverse: the account's owner and Lead Consultants on the account. Add or remove one in Admin › People.</span>
          </div>
        </div>
      </div>
      <DeliveryChatField clientKey={c.key} clientName={c.key} />
      {c.isClient && <MeetingsField clientKey={c.key} clientName={c.key} />}
      <ProcessView c={c} saver={saver} onRefresh={onRefresh} refreshing={refreshing} />
      {c.scope && <ScopeField clientKey={c.key} project={c.process.ok ? c.process.project : null} s={c.scope} save={(v) => saver.save(scope, "devops_scope", v, `${c.key}: Cooptimize's work`)} status={saver.status(scope, "devops_scope")} retry={() => void saver.save(scope, "devops_scope", c.scope?.rule ?? undefined, `${c.key}: Cooptimize's work`)} />}
      {c.isClient && <FixGapsField c={c} saver={saver} />}
      {c.isClient && <CodeAccessField c={c} saver={saver} />}
      {c.isClient && <DeploySettings clientKey={c.key} clientName={c.key} />}
      {c.isClient && <SourceSystemsField c={c} saver={saver} />}
      {c.isClient && (
        <div className="set-form">
          <AField label="Other names (aliases)" kind="Rule" s={saver.status(scope, "aliases")} retry={() => void saver.save(scope, "aliases", c.aliases ?? [], `${c.key}: other names`)} hint="Other names people use for this client, like a short name or an old company name. FocusTime holds back a message that names it in another client's chat with people outside Cooptimize, and flags it in text going to another client. Commas between them.">
            <ListInput label={`${c.key}: other names`} value={saver.shown(scope, "aliases", c.aliases ?? [])} onSave={(v) => void saver.save(scope, "aliases", v, `${c.key}: other names`)} />
          </AField>
          {/* HK-7 (Q-GD2-4): a name that is an ordinary word ("Atlas", "Summit") matches only with its casing. */}
          <AField label="Match only as written" kind="Rule" s={saver.status(scope, "exact_case")} retry={() => void saver.save(scope, "exact_case", c.exactCase ?? false, `${c.key}: match only as written`)} hint={`Matches the name and other names only with the capitals as written, so "${c.key}" counts and "${c.key.toLowerCase()}" doesn't. For a name that is also an ordinary word. ${c.exactCaseDefault ? "On by default for this name." : "Off by default for this name."}`}>
            <label className="set-check">
              <input type="checkbox" role="switch" checked={saver.shown(scope, "exact_case", c.exactCase ?? false)} aria-label={`${c.key}: match only as written`} onChange={(e) => void saver.save(scope, "exact_case", e.target.checked, `${c.key}: match only as written`)} /> {saver.shown(scope, "exact_case", c.exactCase ?? false) ? "On" : "Off"}
            </label>
          </AField>
        </div>
      )}
      <div className="set-form set-house-style">
        <AField label="House style for Break down" kind="Rule" s={saver.status(scope, "house_style")} retry={() => void saver.save(scope, "house_style", c.houseStyle, `${c.key}: house style`)} hint="Sent with every Break down request for this client. Empty goes back to the style learned from its own features.">
          <TextBox
            aria-label={`${c.key}: house style`}
            minRows={3}
            maxRows={10}
            maxLength={1200}
            value={style}
            onChange={(e) => setStyle(e.target.value)}
            onBlur={() => style.trim() !== (c.houseStyle ?? "") && void saver.save(scope, "house_style", style.trim() ? style.trim() : undefined, `${c.key}: house style`)}
          />
        </AField>
      </div>
    </div>
  );
}

/** AH-3: the gaps Ahead's Fix next and Readiness count for this client (all four by default). */
/** KB-1: which D365 systems the client's data comes from: picks the source-system standards its AI drafts use. */
const SOURCE_CHOICES: readonly (readonly [string, string, SourceSystem[] | null])[] = [
  ["both", "Both D365 systems (default)", null],
  ["d365_fo", SOURCE_SYSTEM_LABEL.d365_fo, ["d365_fo"]],
  ["d365_dataverse", SOURCE_SYSTEM_LABEL.d365_dataverse, ["d365_dataverse"]],
  ["none", "None", []],
];
function SourceSystemsField({ c, saver }: { c: ClientRow; saver: Saver }) {
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
function CodeAccessField({ c, saver }: { c: ClientRow; saver: Saver }) {
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

function FixGapsField({ c, saver }: { c: ClientRow; saver: Saver }) {
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
function ProcessView({ c, saver, onRefresh, refreshing }: { c: ClientRow; saver: Saver; onRefresh: () => Promise<void>; refreshing: boolean }) {
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

// ---------- AI ----------

type AiTaskRow = { name: string; label: string; background: boolean; tier: "standard" | "flex" };
type AiData = { tasks: AiTaskRow[]; standardTasks: string[]; on: boolean; model: string; personCapUsd: number; appCapUsd: number; provider: string; keyConfigured: boolean; appSpentMicros: number; zero: { person: boolean; app: boolean }; filter: ClientFilterValue; counts: ClientCounts; clients: { key: string; isClient: boolean; whyText: string; allowAi: boolean; groupWithoutAi: boolean; attachmentsAi: boolean }[] };

/** Turning AI off for everyone asks first; focus goes back to the switch when it closes (HK-3). */
function ConfirmAiOff({ onOff, onCancel }: { onOff: () => void; onCancel: () => void }) {
  useReturnFocus();
  return (
    <div className="adm-confirm" role="alertdialog" aria-label="Turn AI off for everyone">
      <p>Turn AI off for everyone? Break down, request sorting and promise reading stop until it's on again.</p>
      <button type="button" className="mini danger" onClick={onOff}>
        Turn AI off
      </button>
      <button type="button" className="mini quiet" autoFocus onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

/**
 * AI-F1: each task's tier. Background tasks (nobody waits on them) run on Flex, half price and slower, and fall back to
 * standard when Flex is busy; an admin can put one back on standard. Interactive tasks are always standard.
 */
function AiTiers({ data, saver }: { data: AiData; saver: Saver }) {
  const o = "org";
  const key = "ai.standard_tasks";
  const shown: string[] = saver.shown(o, key, data.standardTasks);
  const set = (t: AiTaskRow, flex: boolean) => {
    const next = flex ? shown.filter((n) => n !== t.name) : [...new Set([...shown, t.name])].sort();
    void saver.save(o, key, next, `${t.label}: ${flex ? "Flex" : "Standard"}`);
  };
  return (
    <>
      <h3>Processing tier</h3>
      <p className="set-hint">Background work nobody waits on uses Flex: half the price, slower, and it switches to standard by itself when Flex is busy. Everything else, and anything a person is waiting on (Sort again, Sort unsorted), is always standard.</p>
      <SaveMark s={saver.status(o, key)} retry={() => void saver.save(o, key, shown, "Processing tier")} />
      <table className="adm-table adm-ai-tiers">
        <thead>
          <tr>
            <th scope="col">Task</th>
            <th scope="col">Tier <Kind kind="Rule" /></th>
          </tr>
        </thead>
        <tbody>
          {data.tasks.map((t) => {
            const flex = t.background && !shown.includes(t.name);
            return (
              <tr key={t.name}>
                <th scope="row">{t.label}</th>
                <td>
                  {t.background ? (
                    <label className="set-check">
                      <input type="checkbox" role="switch" checked={flex} aria-label={`Use Flex for ${t.label}`} onChange={(e) => set(t, e.target.checked)} /> {flex ? "Flex" : "Standard"}
                    </label>
                  ) : (
                    <span className="muted">Standard</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

function AdminAi() {
  const [filter, setFilter] = useState<ClientFilterValue>("customers");
  const { data, error, load } = useSection<AiData>("ai", { filter });
  const saver = useAdminSave(load);
  const [confirmOff, setConfirmOff] = useState(false);
  if (error) return <p className="field-problem">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;
  const o = "org";
  return (
    <div className="set-form set-ai">
      <AField label="AI for FocusTime" kind="Rule" s={saver.status(o, "ai.on")} retry={() => void saver.save(o, "ai.on", data.on, "AI for FocusTime")} hint="The one switch for everyone, and the emergency off: off stops every AI request at once. Everything else works without AI.">
        <label className="set-check">
          <input type="checkbox" role="switch" checked={saver.shown(o, "ai.on", data.on)} onChange={(e) => (e.target.checked ? void saver.save(o, "ai.on", true, "AI for FocusTime") : setConfirmOff(true))} /> AI on
        </label>
      </AField>
      {confirmOff && <ConfirmAiOff onOff={() => (setConfirmOff(false), void saver.save(o, "ai.on", false, "AI for FocusTime"))} onCancel={() => setConfirmOff(false)} />}
      {saver.warning && <p className="set-problem" role="status">{saver.warning}</p>}
      {!data.keyConfigured && <p className="set-problem">AI isn't set up for this FocusTime: there is no OpenAI key ({data.provider}). The switches save, and AI starts once the key is in Key Vault.</p>}
      <div className="set-grid">
        <AField label="Model" kind="Rule" s={saver.status(o, "ai.model")} retry={() => void saver.save(o, "ai.model", data.model, "Model")}>
          <TextInput label="Model" value={data.model} maxLength={60} onSave={(v) => void saver.save(o, "ai.model", v, "Model")} />
        </AField>
        <AField label="Monthly cap per person (US dollars)" kind="Rule" s={saver.status(o, "ai.person_cap_usd")} retry={() => void saver.save(o, "ai.person_cap_usd", data.personCapUsd, "Cap per person")} hint={data.zero.person ? <span className="field-problem">AI budget is set to $0</span> : "AI stops for a person at this, until next month."}>
          <NumInput label="Monthly cap per person" value={data.personCapUsd} min={0} max={10000} onSave={(v) => void saver.save(o, "ai.person_cap_usd", v, "Cap per person")} />
        </AField>
        <AField label="Monthly cap for everyone (US dollars)" kind="Rule" s={saver.status(o, "ai.app_cap_usd")} retry={() => void saver.save(o, "ai.app_cap_usd", data.appCapUsd, "Cap for everyone")} hint={data.zero.app ? <span className="field-problem">AI budget is set to $0</span> : `This month so far: $${(data.appSpentMicros / 1e6).toFixed(2)}.`}>
          <NumInput label="Monthly cap for everyone" value={data.appCapUsd} min={0} max={10000} onSave={(v) => void saver.save(o, "ai.app_cap_usd", v, "Cap for everyone")} />
        </AField>
      </div>
      <AiTiers data={data} saver={saver} />
      <h3>Per client</h3>
      <p className="set-hint">Send attachments to AI: images pasted into the client's chats go to the AI to be described, with Allow AI on. The AI safety check reads text only and can't inspect images, so turning this on is the consent. Images are never kept in FocusTime.</p>
      <div className="set-row-actions">
        <ClientFilter value={filter} counts={data.counts} onChange={setFilter} />
      </div>
      {data.clients.length === 0 ? (
        <p className="muted">No clients yet.</p>
      ) : (
        <table className="adm-table adm-ai-clients">
          <thead>
            <tr>
              <th scope="col">Client</th>
              <th scope="col">Allow AI <Kind kind="Rule" /></th>
              <th scope="col" title="While AI is off for the client, or not set up: replies, mentions and the same person within 45 minutes join a conversation">Group messages without AI <Kind kind="Rule" /></th>
              <th scope="col" title="Chat images go to the AI to be described. The AI safety check reads text only and can't inspect images, so turning this on is the consent">Send attachments to AI <Kind kind="Rule" /></th>
            </tr>
          </thead>
          <tbody>
            {data.clients.map((c) => (
              <tr key={c.key}>
                <th scope="row">
                  {c.key}
                  {!c.isClient && <span className="set-hint">{c.whyText}</span>}
                </th>
                <td>
                  <label className="set-check">
                    <input type="checkbox" role="switch" checked={saver.shown(`client:${c.key}`, "allow_ai", c.allowAi)} aria-label={`Allow AI for ${c.key}`} onChange={(e) => void saver.save(`client:${c.key}`, "allow_ai", e.target.checked, `${c.key}: Allow AI`)} /> {c.allowAi ? "Allowed" : "Off"}
                  </label>
                  <SaveMark s={saver.status(`client:${c.key}`, "allow_ai")} retry={() => void saver.save(`client:${c.key}`, "allow_ai", c.allowAi, `${c.key}: Allow AI`)} />
                </td>
                <td>
                  {/* CV-3: rules-only grouping while AI is off for this client (or not set up). */}
                  <label className="set-check">
                    <input type="checkbox" role="switch" checked={saver.shown(`client:${c.key}`, "group_without_ai", c.groupWithoutAi)} aria-label={`Group messages without AI for ${c.key}`} onChange={(e) => void saver.save(`client:${c.key}`, "group_without_ai", e.target.checked, `${c.key}: Group messages without AI`)} /> {c.groupWithoutAi ? "On" : "Off"}
                  </label>
                  <SaveMark s={saver.status(`client:${c.key}`, "group_without_ai")} retry={() => void saver.save(`client:${c.key}`, "group_without_ai", c.groupWithoutAi, `${c.key}: Group messages without AI`)} />
                </td>
                <td>
                  {/* CV-4: images from this client's chats go to the AI to be described; the safety check can't inspect images. */}
                  <label className="set-check">
                    <input type="checkbox" role="switch" checked={saver.shown(`client:${c.key}`, "attachments_ai", c.attachmentsAi)} aria-label={`Send attachments to AI for ${c.key}`} onChange={(e) => void saver.save(`client:${c.key}`, "attachments_ai", e.target.checked, `${c.key}: Send attachments to AI`)} /> {c.attachmentsAi ? "On" : "Off"}
                  </label>
                  <SaveMark s={saver.status(`client:${c.key}`, "attachments_ai")} retry={() => void saver.save(`client:${c.key}`, "attachments_ai", c.attachmentsAi, `${c.key}: Send attachments to AI`)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------- Conversations ----------

type ConvData = { pollMinutes: number; retentionDays: number; closedShownDays: number; chatAiDailyCap: number; requestPhrases: string[]; ackPhrases: string[]; promisePhrases: string[]; more: string[] };

function AdminConversations() {
  const { data, error, load } = useSection<ConvData>("conversations");
  const saver = useAdminSave(load);
  if (error) return <p className="field-problem">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;
  const o = "org";
  const list = (key: string, label: string, value: string[], hint: string) => (
    <AField label={label} kind="Default" s={saver.status(o, key)} retry={() => void saver.save(o, key, value, label)} hint={hint}>
      <ListInput label={label} value={value} onSave={(v) => void saver.save(o, key, v, label)} />
    </AField>
  );
  const num = (key: string, label: string, value: number, min: number, max: number, hint: string) => (
    <AField label={label} kind="Rule" s={saver.status(o, key)} retry={() => void saver.save(o, key, value, label)} hint={hint}>
      <NumInput label={label} value={value} min={min} max={max} onSave={(v) => void saver.save(o, key, v, label)} />
    </AField>
  );
  return (
    <div className="set-form">
      <p className="muted">The team's phrase lists. Each person may add their own phrases on top in Settings › Clients, but never removes the team's.</p>
      <div className="set-grid">
        {list("conv.request_phrases", "Request phrases", data.requestPhrases, "A client's message with one of these becomes a request. Commas between them.")}
        {list("conv.ack_phrases", "Thanks and short replies", data.ackPhrases, "A message that is only these (and emoji) is never a request.")}
        {list("conv.promise_phrases", "Commitment phrases", data.promisePhrases, "In a person's own messages: a promise to keep.")}
      </div>
      <h3>Reading client chats</h3>
      <div className="set-grid">
        {num("conv.poll_minutes", "Read client chats every (minutes)", data.pollMinutes, 1, 30, "1 to 30, in followers' working hours only. Applies from the next poll.")}
        {num("conv.retention_days", "Keep messages that aren't requests (days)", data.retentionDays, 1, 90, "Then they're deleted, after each poll.")}
        {num("conv.closed_shown_days", "Closed conversations stay shown (days)", data.closedShownDays, 1, 90, "In Inbox › Conversations › Closed, then they're no longer listed.")}
        {num("conv.chat_ai_daily_cap", "AI requests per chat per day", data.chatAiDailyCap, 0, 5000, "At most, for each chat.")}
      </div>
    </div>
  );
}

// ---------- People ----------

type Person = {
  id: string;
  name: string;
  email: string | null;
  me: boolean;
  signedIn: boolean;
  level: string | null;
  levelName: string | null;
  levelSource: "dataverse" | "override" | null;
  dataverseLevel: string | null;
  leads: { clientKey: string; primary: boolean; why: string[]; whyText: string[] }[];
  removedLeads: string[];
  lastSignInAt: string | null;
  setup: "done" | "skipped" | "started" | "not_started" | null;
  dataverseMatch: boolean;
  /** ADM-2: which key matched ("Matched by email"), or why not. */
  dataverseText: string;
  cooptimizer: boolean;
  notCooptimizerText: string | null;
  automation: boolean;
  /** WP-1: the DevOps patterns page is on for this person (off for everyone by default). */
  devopsPatterns: boolean;
  positionName: string | null;
  clients: string[];
  sources: { microsoft: boolean; google: boolean; devopsWrites: number } | null;
};
type Position = { name: string; people: number; mapped: boolean; level: string | null };
type IdentityRowView = import("../../plan/identities.ts").IdentityRowView;
type ClientIdentitiesView = import("../../plan/identities.ts").ClientIdentitiesView;
type PeopleData = { identities?: ClientIdentitiesView[]; people: Person[]; others: Person[]; positions: Position[]; unmappedPositions: number; noDomains: boolean; leadsShown: number; admins: { id: string; name: string | null; via: string | null; checkedAt: string | null }[]; groupLink: string | null; groupSet: boolean; refreshedAt: string | null; levels: { id: string; name: string }[] };

const SETUP_WORDS = { done: "Done", skipped: "Skipped", started: "Started", not_started: "Not started" } as const;

function AdminPeople() {
  const { data, error, load } = useSection<PeopleData>("people");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<Person | null>(null);
  const ctx = useSaveContext();
  const saver = useAdminSave(load);
  const [othersOpen, setOthersOpen] = useState(false);
  const override = async (input: Record<string, unknown>, what: string, undo?: Record<string, unknown>) => {
    setMsg(null);
    try {
      await call("admin.override", input);
      await load();
      setMsg(`${what}. Logged in Admin › Audit.`);
      if (undo)
        ctx?.offerUndo(`${what}.`, async () => {
          await call("admin.override", undo);
          await load();
        });
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Not saved");
    }
  };
  const refresh = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await call<{ people: number }>("admin.refresh_people", {});
      await load();
      setMsg(`Read ${r.people} people from Dataverse.`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Dataverse couldn't be read");
    } finally {
      setBusy(false);
    }
  };
  if (error) return <p className="field-problem">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;
  return (
    <div className="set-form adm-people">
      <h3>Admins</h3>
      <p className="muted">
        Admins are the members of the Entra group "FocusTime Admins". FocusTime never makes anyone an admin; add or remove members in Entra.{" "}
        {data.groupLink ? (
          <a href={data.groupLink} target="_blank" rel="noreferrer">
            Open the group in Entra
          </a>
        ) : (
          "The group isn't set up for this FocusTime yet (runbook: Creating the admin group)."
        )}
      </p>
      <ul className="set-list adm-admins">
        {data.admins.length === 0 && <li className="muted">Nobody seen yet.</li>}
        {data.admins.map((a) => (
          <li key={a.id}>
            <span>{a.name ?? "Someone who hasn't signed in"}</span> <span className="muted">{a.via === "break_glass" ? "break-glass list" : a.via === "demo" ? "the demo" : "FocusTime Admins"}</span>
          </li>
        ))}
      </ul>
      <WhoSetUp />
      <h3>People</h3>
      <div className="set-row-actions">
        <button type="button" className="mini" disabled={busy} onClick={() => void refresh()}>
          {busy ? "Reading…" : "Refresh from Dataverse"}
        </button>
        <span className="set-hint">{data.refreshedAt ? `Levels and leads read ${shortDate(data.refreshedAt.slice(0, 10))}; again each day.` : "Not read from Dataverse yet."}</span>
        {msg && <span className="set-hint" role="status">{msg}</span>}
      </div>
      <p className="muted">Cooptimizers only. Levels change suggestions and emphasis only, never what anyone can see or do.</p>
      {data.noDomains && <p className="set-problem">Set Cooptimize email domains in Admin › Organization. Until then only guest accounts are left out of People.</p>}
      <PeopleTable people={data.people} levels={data.levels} leadsShown={data.leadsShown} saver={saver} onOverride={override} onRemove={setRemoving} label="People" />
      {data.others.length > 0 && (
        <div className="adm-fold">
          <button type="button" className="fold-line" aria-expanded={othersOpen} onClick={() => setOthersOpen((o) => !o)}>
            <Icon name={othersOpen ? "open" : "closed"} /> Not Cooptimizers ({data.others.length})
          </button>
          {othersOpen && (
            <>
              <p className="muted">Guests, people outside the Cooptimize email domains and automation accounts. They have no level, lead no client and never show in pickers. Nothing about them is deleted.</p>
              <PeopleTable people={data.others} levels={data.levels} leadsShown={data.leadsShown} saver={saver} onOverride={override} onRemove={setRemoving} label="Not Cooptimizers" others />
            </>
          )}
        </div>
      )}
      <ClientIdentities clients={data.identities ?? []} people={data.people} reload={load} />
      <PositionMap positions={data.positions} unmapped={data.unmappedPositions} levels={data.levels} saver={saver} />
      {removing && <RemovePerson p={removing} onClose={() => setRemoving(null)} onDone={async (m) => (setRemoving(null), setMsg(m), await load())} />}
    </div>
  );
}

/**
 * AH-3: client DevOps identities. A Cooptimizer often signs in to a client's DevOps with a client login ("Ext-…"). Linked
 * ones (from their Account Worker row in Dataverse, or confirmed here) count as them everywhere; a suggestion (the same
 * name once a prefix or suffix is off) waits for Confirm; unmatched ones show as DevOps has them, with Link to a person.
 * Emails never reach this page: rows carry a display name and an opaque ref. Every change is in Admin › Audit.
 */
function ClientIdentities({ clients, people, reload }: { clients: ClientIdentitiesView[]; people: Person[]; reload: () => Promise<void> }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const act = async (r: IdentityRowView, op: "link" | "remove", personId: string, what: string) => {
    setBusy(r.ref);
    setMsg(null);
    try {
      await call("admin.identity", { clientKey: r.clientKey, ref: r.ref, personId, op });
      await reload();
      setMsg(`${what}. Logged in Admin › Audit.`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Not saved");
    } finally {
      setBusy(null);
    }
  };
  const coops = people.filter((p) => p.cooptimizer);
  return (
    <section className="adm-identities" aria-label="Client DevOps identities">
      <h3>Client DevOps identities</h3>
      <p className="muted">When someone signs in to a client's DevOps with a client login, FocusTime counts that login as them: their items, the names shown, leads, Team and notes. Suggestions are only applied when you confirm them.</p>
      {msg && (
        <p className="set-hint" role="status">
          {msg}
        </p>
      )}
      {clients.length === 0 && <p className="muted">No client logins seen in the clients' DevOps.</p>}
      {clients.map((c) => (
        <div key={c.clientKey} className="adm-id-client">
          <h4>{c.clientKey}</h4>
          <p className="muted adm-id-line">{c.line}</p>
          <ul className="set-list adm-id-list" aria-label={`${c.clientKey} identities`}>
            {c.rows.map((r) => (
              <li key={r.ref} className={`adm-id-row ${r.state}`}>
                <span className="adm-id-name">{r.name}</span>
                {r.state === "linked" && (
                  <>
                    <span className="muted">
                      {r.personName ?? "Someone"} · {r.source === "dataverse" ? "from Dataverse" : "confirmed"}
                    </span>
                    <button type="button" className="mini quiet" disabled={busy === r.ref} onClick={() => void act(r, "remove", r.personId!, `${r.name} is no longer ${r.personName ?? "linked"}`)} aria-label={`Remove ${r.name} from ${r.personName ?? "this person"}`}>
                      Remove
                    </button>
                  </>
                )}
                {r.state === "suggested" && (
                  <>
                    <span className="muted">Looks like {r.personName}</span>
                    <button type="button" className="mini" disabled={busy === r.ref} onClick={() => void act(r, "link", r.personId!, `${r.name} is ${r.personName} on ${r.clientKey}`)} aria-label={`Confirm ${r.name} is ${r.personName}`}>
                      Confirm
                    </button>
                    <button type="button" className="mini quiet" disabled={busy === r.ref} onClick={() => void act(r, "remove", r.personId!, `${r.name} won't be suggested for ${r.personName} again`)} aria-label={`${r.name} isn't ${r.personName}`}>
                      Not them
                    </button>
                  </>
                )}
                {r.state === "unmatched" && (
                  <label className="adm-id-link">
                    <span className="muted">Not linked</span>
                    <select aria-label={`Link ${r.name} to a person`} value="" disabled={busy === r.ref} onChange={(e) => { const p = coops.find((x) => x.id === e.target.value); if (p) void act(r, "link", p.id, `${r.name} is ${p.name} on ${r.clientKey}`); }}>
                      <option value="">Link to a person…</option>
                      {coops.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

/** ADM-2 (D605): Dataverse position names to levels. Applies at once (the next read of levels), audited as one Rule. */
function PositionMap({ positions, unmapped, levels, saver }: { positions: Position[]; unmapped: number; levels: PeopleData["levels"]; saver: Saver }) {
  const map = Object.fromEntries(positions.filter((p) => p.mapped).map((p) => [p.name, p.level]));
  const shown = saver.shown("org", "org.position_levels", map) as Record<string, string | null>;
  const set = (name: string, level: string | null) => void saver.save("org", "org.position_levels", { ...shown, [name]: level }, `${name} mapped`);
  return (
    <section className="adm-positions" aria-label="Positions to levels">
      <h3>Positions to levels {unmapped > 0 && <span className="adm-kind">{unmapped} not mapped</span>}</h3>
      <p className="muted">Each Cooptimizer's level comes from their Dataverse position. A position that isn't mapped gives no level: those people show Level not set and use the Consultant defaults.</p>
      <SaveMark s={saver.status("org", "org.position_levels")} retry={() => void saver.save("org", "org.position_levels", shown, "Positions")} />
      <div className="adm-scroll">
        <table className="adm-table">
        <thead>
          <tr>
            <th scope="col">Position in Dataverse</th>
            <th scope="col">Level</th>
            <th scope="col">People</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => {
            const v = p.name in shown ? shown[p.name] : null;
            return (
              <tr key={p.name}>
                <th scope="row">{p.name}</th>
                <td>
                  <select aria-label={`Level for ${p.name}`} value={v ?? ""} onChange={(e) => set(p.name, e.target.value || null)}>
                    {levels.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                    <option value="">Not mapped</option>
                  </select>
                </td>
                <td>{p.people}</td>
              </tr>
            );
          })}
        </tbody>
        </table>
      </div>
    </section>
  );
}

type OnOverride = (input: Record<string, unknown>, what: string, undo?: Record<string, unknown>) => Promise<void>;

function PeopleTable({ people, levels, leadsShown, saver, onOverride, onRemove, label, others = false }: { people: Person[]; levels: PeopleData["levels"]; leadsShown: number; saver: Saver; onOverride: OnOverride; onRemove: (p: Person) => void; label: string; others?: boolean }) {
  return (
    <div className="adm-scroll">
      <table className="adm-table adm-people-table" aria-label={label}>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">{others ? "Why not" : "Level"}</th>
            {!others && <th scope="col">Client lead</th>}
            <th scope="col">Last sign-in</th>
            <th scope="col">Setup</th>
            <th scope="col">Dataverse</th>
            {!others && <th scope="col">Clients</th>}
            <th scope="col">Sources</th>
            <th scope="col">Automation <Kind kind="Rule" /></th>
            {!others && <th scope="col">DevOps patterns (preview) <Kind kind="Rule" /></th>}
            <th scope="col"><span className="sr-only">Remove</span></th>
          </tr>
        </thead>
        <tbody>
          {people.map((p) => (
            <PersonRow key={p.id} p={p} levels={levels} leadsShown={leadsShown} saver={saver} onOverride={onOverride} onRemove={() => onRemove(p)} others={others} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PersonRow({ p, levels, leadsShown, saver, onOverride, onRemove, others }: { p: Person; levels: PeopleData["levels"]; leadsShown: number; saver: Saver; onOverride: OnOverride; onRemove: () => void; others: boolean }) {
  const [adding, setAdding] = useState("");
  const [allLeads, setAllLeads] = useState(false);
  const leadClients = p.leads.map((l) => l.clientKey);
  const addable = p.clients.filter((k) => !leadClients.includes(k));
  const shownLeads = allLeads ? p.leads : p.leads.slice(0, leadsShown);
  const scope = `person:${p.id}`;
  const automation = (
    <td>
      <label className="adm-switch">
        <input type="checkbox" role="switch" checked={saver.shown(scope, "automation", p.automation)} aria-label={`${p.name}: automation account`} onChange={(e) => void saver.save(scope, "automation", e.target.checked ? true : undefined, `${p.name}: automation account`)} /> {p.automation ? "Yes" : "No"}
      </label>
      <SaveMark s={saver.status(scope, "automation")} retry={() => void saver.save(scope, "automation", p.automation ? true : undefined, `${p.name}: automation account`)} />
    </td>
  );
  // WP-1: the one switch for the DevOps patterns page; only an admin sets it, off by default.
  const patterns = (
    <td>
      <label className="adm-switch">
        <input type="checkbox" role="switch" checked={saver.shown(scope, "devops_patterns", p.devopsPatterns)} aria-label={`${p.name}: DevOps patterns (preview)`} onChange={(e) => void saver.save(scope, "devops_patterns", e.target.checked ? true : undefined, `${p.name}: DevOps patterns (preview)`)} /> {p.devopsPatterns ? "On" : "Off"}
      </label>
      <SaveMark s={saver.status(scope, "devops_patterns")} retry={() => void saver.save(scope, "devops_patterns", p.devopsPatterns ? true : undefined, `${p.name}: DevOps patterns (preview)`)} />
    </td>
  );
  // The word, then the how on its own line (matched by which key, or why there's no sign-in to match yet).
  const dvWord = !p.dataverseMatch ? "Not matched" : p.signedIn ? "Matched" : "In Dataverse";
  const dvHint = p.dataverseText.replace(/^In Dataverse, |^Matched /, "").replace(/^./, (c) => c.toUpperCase());
  const dataverse = (
    <td title={p.dataverseText}>
      <span className={p.dataverseMatch ? undefined : "field-problem"}>{dvWord}</span>
      <span className="set-hint adm-block">{dvHint}</span>
    </td>
  );
  const name = (
    <th scope="row">
      {p.name}
      {p.me && <span className="muted"> (you)</span>}
      {p.email && <span className="muted adm-email">{p.email}</span>}
    </th>
  );
  const sources = <td>{p.sources ? [p.sources.microsoft ? "Microsoft" : null, p.sources.google ? "Google" : null, p.sources.devopsWrites ? `DevOps writes for ${p.sources.devopsWrites}` : null].filter(Boolean).join(", ") || <span className="muted">None</span> : <span className="muted">Not signed in</span>}</td>;
  const remove = (
    <td>
      {p.signedIn && !p.me && (
        <button type="button" className="mini quiet danger" onClick={onRemove}>
          Remove
        </button>
      )}
    </td>
  );
  if (others)
    return (
      <tr>
        {name}
        <td>{p.notCooptimizerText}</td>
        <td>{p.lastSignInAt ? shortDate(p.lastSignInAt.slice(0, 10)) : <span className="muted">Never</span>}</td>
        <td>{p.setup ? SETUP_WORDS[p.setup] : <span className="muted">n/a</span>}</td>
        {dataverse}
        {sources}
        {automation}
        {remove}
      </tr>
    );
  return (
    <tr>
      {name}
      <td>
        <select
          aria-label={`${p.name}: level`}
          value={p.levelSource === "override" ? (p.level ?? "") : ""}
          onChange={(e) => {
            const v = e.target.value;
            void (v
              ? onOverride({ personId: p.id, kind: "level", value: v }, `${p.name}'s level set`, p.levelSource === "override" && p.level ? { personId: p.id, kind: "level", value: p.level } : { personId: p.id, kind: "level", clear: true })
              : onOverride({ personId: p.id, kind: "level", clear: true }, `${p.name}'s level back to Dataverse's`, p.level ? { personId: p.id, kind: "level", value: p.level } : undefined));
          }}
        >
          <option value="">{p.dataverseLevel ? `${p.dataverseLevel} (Dataverse)` : "Level not set"}</option>
          {levels.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name} (override)
            </option>
          ))}
        </select>
        {p.levelSource === "override" && <span className="adm-mark">Override</span>}
        {!p.level && <span className="set-hint adm-block">Uses Consultant defaults{p.positionName ? ` (position ${p.positionName} isn't mapped)` : ""}</span>}
      </td>
      <td>
        <ul className="adm-leads">
          {shownLeads.map((l) => (
            <li key={l.clientKey}>
              <span>{l.clientKey}</span> <span className="muted">{l.whyText.join(", ")}{l.primary ? " · primary" : ""}</span>{" "}
              {l.why.includes("override") && <span className="adm-mark">Override</span>}
              <button type="button" className="mini quiet" aria-label={`Remove ${p.name} as lead of ${l.clientKey}`} onClick={() => void onOverride(l.why.length === 1 && l.why[0] === "override" ? { personId: p.id, kind: "lead_add", clientKey: l.clientKey, clear: true } : { personId: p.id, kind: "lead_remove", clientKey: l.clientKey }, `${p.name} no longer a lead of ${l.clientKey}`)}>
                Remove
              </button>
            </li>
          ))}
          {p.leads.length > leadsShown && (
            <li>
              <button type="button" className="mini quiet" onClick={() => setAllLeads((a) => !a)}>
                {allLeads ? "Show fewer" : `and ${p.leads.length - leadsShown} more`}
              </button>
            </li>
          )}
          {p.removedLeads.map((k) => (
            <li key={`removed-${k}`} className="muted">
              {k}: removed by an admin <span className="adm-mark">Override</span>{" "}
              <button type="button" className="mini quiet" onClick={() => void onOverride({ personId: p.id, kind: "lead_remove", clientKey: k, clear: true }, `${p.name} back as a lead of ${k}`)}>
                Undo
              </button>
            </li>
          ))}
        </ul>
        {addable.length > 0 && (
          <span className="set-inline">
            <select aria-label={`${p.name}: add as lead of`} value={adding} onChange={(e) => setAdding(e.target.value)}>
              <option value="">Add as lead of…</option>
              {addable.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <button type="button" className="mini" disabled={!adding} onClick={() => (void onOverride({ personId: p.id, kind: "lead_add", clientKey: adding }, `${p.name} added as a lead of ${adding}`, { personId: p.id, kind: "lead_add", clientKey: adding, clear: true }), setAdding(""))}>
              Add
            </button>
          </span>
        )}
      </td>
      <td>{p.lastSignInAt ? shortDate(p.lastSignInAt.slice(0, 10)) : <span className="muted">Never</span>}</td>
      <td>{p.setup ? SETUP_WORDS[p.setup] : <span className="muted">n/a</span>}</td>
      {dataverse}
      <td>{p.clients.length ? p.clients.join(", ") : <span className="muted">None</span>}</td>
      {sources}
      {automation}
      {patterns}
      {remove}
    </tr>
  );
}

function RemovePerson({ p, onClose, onDone }: { p: Person; onClose: () => void; onDone: (message: string) => Promise<void> }) {
  // HK-3: focus goes back to the person's Remove when this closes.
  useReturnFocus();
  const [typed, setTyped] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      await call("admin.remove_person", { personId: p.id, confirmName: typed });
      await onDone(`${p.name} was removed: their FocusTime data and personal secrets are deleted. Logged in Admin › Audit.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Not removed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="adm-confirm" role="alertdialog" aria-label={`Remove ${p.name}`}>
      <p>
        Remove {p.name} from FocusTime? This deletes their plan, settings and personal secrets (sign-ins, write PATs) now and ends their sessions. It can't be undone. Their Dataverse, DevOps and Outlook data stay as they are.
      </p>
      <label className="set-field">
        <span className="set-label">Type their name to confirm</span>
        <input value={typed} autoFocus onChange={(e) => setTyped(e.target.value)} placeholder={p.name} aria-label="Type their name to confirm" />
      </label>
      {err && <p className="field-problem" role="alert">{err}</p>}
      <button type="button" className="mini danger" disabled={busy || typed.trim().toLowerCase() !== p.name.trim().toLowerCase()} onClick={() => void run()}>
        Remove {p.name}
      </button>
      <button type="button" className="mini quiet" onClick={onClose}>
        Cancel
      </button>
    </div>
  );
}

// ---------- Organization ----------

type Guidance = { draftStories: boolean; readinessNudges: boolean; planShare: number };
type NewPerson = { weekdays: Record<string, string[]>; lunch: string; risk: { watch: number; atRisk: number; minWindow: number } };
type OrgData = {
  inviteDomains: string[];
  neverSuggest: string[];
  feedback: { org: string; project: string; parentId: number } | null;
  retentionYears: number;
  idleMinutes: number;
  /** AH-3: Gaps looks at the top N of each backlog. */
  fixTopN?: number;
  newPerson: NewPerson;
  inviteFromBootstrap: boolean;
  feedbackFromBootstrap: boolean;
  levels: Record<string, Guidance>;
  levelNames: Record<string, string>;
};
const DAYS = [["mon", "Monday"], ["tue", "Tuesday"], ["wed", "Wednesday"], ["thu", "Thursday"], ["fri", "Friday"], ["sat", "Saturday"], ["sun", "Sunday"]] as const;

function AdminOrganization() {
  const { data, error, load } = useSection<OrgData>("organization");
  const saver = useAdminSave(load);
  if (error) return <p className="field-problem">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;
  const o = "org";
  const fb = data.feedback ?? { org: "", project: "", parentId: 0 };
  const saveFb = (next: Partial<typeof fb>) => {
    const v = { ...fb, ...next };
    void saver.save(o, "org.feedback", v.org || v.project || v.parentId ? v : null, "Send feedback goes to");
  };
  const np = data.newPerson;
  const saveNp = (next: Partial<NewPerson>) => void saver.save(o, "org.new_person", { ...np, ...next }, "Working week for new people");
  return (
    <div className="set-form">
      <div className="set-grid">
        <AField label="Help invites go only to" kind="Rule" s={saver.status(o, "org.invite_domains")} retry={() => void saver.save(o, "org.invite_domains", data.inviteDomains, "Invite domains")} hint={data.inviteFromBootstrap ? "From the app's settings until an admin sets them here. Commas between domains." : "Commas between domains, like cooptimize.com."}>
          <ListInput label="Help invites go only to" value={data.inviteDomains} onSave={(v) => void saver.save(o, "org.invite_domains", v, "Invite domains")} />
        </AField>
        <AField label="Never suggested as helpers or Who" kind="Rule" s={saver.status(o, "org.never_suggest")} retry={() => void saver.save(o, "org.never_suggest", data.neverSuggest, "Never suggested")} hint="Names or emails, commas between them. People may exclude more for themselves.">
          <ListInput label="Never suggested as helpers or Who" value={data.neverSuggest} onSave={(v) => void saver.save(o, "org.never_suggest", v, "Never suggested")} />
        </AField>
        <AField label="Keep people's data (years)" kind="Rule" s={saver.status(o, "org.retention_years")} retry={() => void saver.save(o, "org.retention_years", data.retentionYears, "Data retention")} hint="Shown to everyone. Deleting older data automatically comes in a later step.">
          <NumInput label="Keep people's data (years)" value={data.retentionYears} min={1} max={10} onSave={(v) => void saver.save(o, "org.retention_years", v, "Data retention")} />
        </AField>
        <AField label="Counts as in use (minutes)" kind="Rule" s={saver.status(o, "org.idle_minutes")} retry={() => void saver.save(o, "org.idle_minutes", data.idleMinutes, "In use")} hint="5 to 60. An open page counts as someone using FocusTime only this long after their last key, click or scroll. Background work waits otherwise.">
          <NumInput label="Counts as in use (minutes)" value={data.idleMinutes} min={5} max={60} onSave={(v) => void saver.save(o, "org.idle_minutes", v, "In use")} />
        </AField>
        <AField label="Needs attention looks at the top N of each backlog" kind="Rule" s={saver.status(o, "ahead.fix_top_n")} retry={() => void saver.save(o, "ahead.fix_top_n", data.fixTopN ?? 30, "Needs attention top N")} hint="10 to 100, for epics, features and stories each. Backlog's Needs attention also shows what's dated in the next 4 weeks and the features and epics each person owns.">
          <NumInput label="Needs attention looks at the top N of each backlog" value={data.fixTopN ?? 30} min={10} max={100} onSave={(v) => void saver.save(o, "ahead.fix_top_n", v, "Needs attention top N")} />
        </AField>
      </div>
      <h3>Send feedback</h3>
      <p className="muted">{data.feedbackFromBootstrap ? "From the app's settings until an admin sets it here." : "Set here; the app's settings no longer apply."} Stories are created under the parent feature by the person sending them, with their own DevOps write PAT for that project's client.</p>
      <div className="set-grid">
        <AField label="DevOps organization" kind="Rule" s={saver.status(o, "org.feedback")} retry={() => saveFb({})}>
          <TextInput label="Feedback DevOps organization" value={fb.org} onSave={(v) => saveFb({ org: v })} />
        </AField>
        <AField label="Project" kind="Rule" s={null} retry={() => saveFb({})}>
          <TextInput label="Feedback project" value={fb.project} onSave={(v) => saveFb({ project: v })} />
        </AField>
        <AField label="Parent feature" kind="Rule" s={null} retry={() => saveFb({})}>
          <NumInput label="Feedback parent feature" value={fb.parentId} min={1} max={99999999} onSave={(v) => saveFb({ parentId: v })} />
        </AField>
      </div>
      <h3>New people</h3>
      <p className="muted">Prefilled into Setup for someone signing in for the first time; theirs to change after.</p>
      <div className="set-grid">
        {DAYS.map(([k, name]) => (
          <AField key={k} label={name} kind="Default" s={null} retry={() => saveNp({})} hint={k === "mon" ? "Spans like 09:00-17:00; empty for a day off." : undefined}>
            <ListInput label={`New people: ${name}`} value={np.weekdays[k] ?? []} onSave={(v) => saveNp({ weekdays: { ...np.weekdays, [k]: v } })} placeholder="day off" />
          </AField>
        ))}
        <AField label="Lunch" kind="Default" s={null} retry={() => saveNp({})} hint="A span like 12:00-12:30.">
          <TextInput label="New people: lunch" value={np.lunch} maxLength={11} onSave={(v) => saveNp({ lunch: v })} />
        </AField>
        <AField label="Meeting watch (minutes)" kind="Default" s={null} retry={() => saveNp({})}>
          <NumInput label="New people: meeting watch" value={np.risk.watch} min={1} max={600} onSave={(v) => saveNp({ risk: { ...np.risk, watch: v } })} />
        </AField>
        <AField label="Meeting at risk (minutes)" kind="Default" s={null} retry={() => saveNp({})}>
          <NumInput label="New people: meeting at risk" value={np.risk.atRisk} min={1} max={600} onSave={(v) => saveNp({ risk: { ...np.risk, atRisk: v } })} />
        </AField>
        <AField label="Shortest focus window (minutes)" kind="Default" s={null} retry={() => saveNp({})}>
          <NumInput label="New people: shortest focus window" value={np.risk.minWindow} min={1} max={600} onSave={(v) => saveNp({ risk: { ...np.risk, minWindow: v } })} />
        </AField>
      </div>
      <SaveMark s={saver.status(o, "org.new_person")} retry={() => saveNp({})} />
      {saver.status(o, "org.feedback") && <SaveMark s={saver.status(o, "org.feedback")} retry={() => saveFb({})} />}
      <h3>By level</h3>
      <p className="muted">Each level's defaults; a person may change any of these for themselves (Settings › Day and Week, Reset to team default). They never block anything.</p>
      <table className="adm-table">
        <thead>
          <tr>
            <th scope="col">Level</th>
            <th scope="col">Break down offered</th>
            <th scope="col">Needs attention nudges</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(data.levels).map(([lv, g]) => {
            const scope = `level:${lv}`;
            return (
              <tr key={lv}>
                <th scope="row">{data.levelNames[lv]}</th>
                <td>
                  <input type="checkbox" aria-label={`${data.levelNames[lv]}: Break down offered`} checked={saver.shown(scope, "draft_stories", g.draftStories)} onChange={(e) => void saver.save(scope, "draft_stories", e.target.checked, `${data.levelNames[lv]}: Break down`)} />
                  <SaveMark s={saver.status(scope, "draft_stories")} retry={() => void saver.save(scope, "draft_stories", g.draftStories, "Break down")} />
                </td>
                <td>
                  <input type="checkbox" aria-label={`${data.levelNames[lv]}: Needs attention nudges`} checked={saver.shown(scope, "readiness_nudges", g.readinessNudges)} onChange={(e) => void saver.save(scope, "readiness_nudges", e.target.checked, `${data.levelNames[lv]}: readiness nudges`)} />
                  <SaveMark s={saver.status(scope, "readiness_nudges")} retry={() => void saver.save(scope, "readiness_nudges", g.readinessNudges, "Needs attention nudges")} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------- Status ----------

type StatusData = {
  environment: string;
  version: { env: string; sha: string; pr: string; builtAt: string | null };
  ai: { provider: string; keyConfigured: boolean };
  feedback: { ok: boolean; message: string };
  dataverse: { refreshedAt: string | null; ok: boolean; message: string | null };
  chats: { chatId: string; clientKey: string; name: string; reading: boolean; polledAt: string | null; state: string | null; note: string | null; via: string | null }[];
  lastPoll: string | null;
  conversations: { conversationsByStatus: Record<string, number>; messagesByRole: Record<string, number>; commitmentsByState: Record<string, number>; aiCallsToday: { chatName: string; clientKey: string; calls: number }[] } | null;
  warnings?: { area: string; text: string }[];
  jobs?: { name: string; every: string; lastRun: string | null; note: string | null }[];
  groups?: StatusGroup[];
};
const ROLE_WORDS: Record<string, string> = { work: "work", chatter: "chatter", ack: "short replies", unsorted: "unsorted" };
const COMMIT_WORDS: Record<string, string> = { open: "open", followup: "promises", linked: "linked", created: "item created", done: "done", not_needed: "not needed" };
const countLine = (m: Record<string, number>, words: Record<string, string>) => Object.entries(m).map(([k, n]) => `${n} ${words[k] ?? k}`).join(" · ");
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "never");
const POLL_WORDS: Record<string, string> = { ok: "OK", via: "Read with another follower's sign-in", reconnect: "Needs reconnecting", retry: "Retrying" };

function AdminStatus() {
  const { data, error } = useSection<StatusData>("status");
  if (error) return <p className="field-problem">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;
  const ok = (b: boolean, yes: string, no: string) => <span className={b ? "adm-ok" : "field-problem"}>{b ? yes : no}</span>;
  return (
    <div className="set-form">
      <p className="muted">Names and states only; never a secret's value.</p>
      {data.warnings && data.warnings.length > 0 && (
        <div className="adm-warnings">
          <h3>To look at ({data.warnings.length})</h3>
          <ul className="set-list">
            {data.warnings.map((w, i) => (
              <li key={i} className="set-problem">
                {w.text}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="set-grid">
        <div className="set-field">
          <span className="set-label">This environment</span>
          <span className="set-value">
            {data.environment} · {data.version.sha}
            {data.version.pr ? ` · PR #${data.version.pr}` : ""}
            {data.version.builtAt ? ` · built ${when(data.version.builtAt)}` : ""}
          </span>
          <span className="set-hint">Each environment shows its own version here (dev and prod are separate FocusTimes).</span>
        </div>
        <div className="set-field">
          <span className="set-label">OpenAI key</span>
          <span className="set-value">{ok(data.ai.keyConfigured, `Configured (${data.ai.provider})`, "Not configured")}</span>
        </div>
        <div className="set-field">
          <span className="set-label">Send feedback</span>
          <span className="set-value">{ok(data.feedback.ok, data.feedback.message, data.feedback.message)}</span>
        </div>
        <div className="set-field">
          <span className="set-label">Dataverse people and leads</span>
          <span className="set-value">{ok(data.dataverse.ok, data.dataverse.refreshedAt ? `Read ${when(data.dataverse.refreshedAt)}` : "Not read yet", data.dataverse.message ?? "Not read")}</span>
        </div>
        <div className="set-field">
          <span className="set-label">Teams and DevOps permissions</span>
          <span className="set-value">Per person: Microsoft permissions in Settings › Accounts and calendars, DevOps write access in Settings › DevOps.</span>
        </div>
      </div>
      {data.jobs && data.jobs.length > 0 && (
        <>
          <h3>Jobs</h3>
          <table className="adm-table">
            <thead>
              <tr>
                <th scope="col">Job</th>
                <th scope="col">When</th>
                <th scope="col">Last run</th>
              </tr>
            </thead>
            <tbody>
              {data.jobs.map((j) => (
                <tr key={j.name}>
                  <th scope="row">{j.name}</th>
                  <td>{j.every}</td>
                  <td>{j.note ? <span className="muted">{j.note}</span> : when(j.lastRun)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {data.groups?.length ? <StatusRows groups={data.groups} /> : null}
      <h3>Client chats</h3>
      <p className="muted">Last poll: {when(data.lastPoll)}.</p>
      {data.chats.length === 0 ? (
        <p className="muted">No chats registered.</p>
      ) : (
        <table className="adm-table">
          <thead>
            <tr>
              <th scope="col">Chat</th>
              <th scope="col">Client</th>
              <th scope="col">Reading</th>
              <th scope="col">Last poll</th>
              <th scope="col">State</th>
              <th scope="col">AI calls today</th>
            </tr>
          </thead>
          <tbody>
            {data.chats.map((c) => (
              <tr key={c.chatId}>
                <th scope="row">{c.name}</th>
                <td>{c.clientKey}</td>
                <td>{c.reading ? "On" : "Off"}</td>
                <td>{when(c.polledAt)}</td>
                <td>
                  {c.state ? (POLL_WORDS[c.state] ?? c.state) : <span className="muted">Not polled yet</span>}
                  {c.via ? ` · via ${c.via}` : ""}
                  {c.note ? ` · ${c.note}` : ""}
                </td>
                <td>{data.conversations ? (data.conversations.aiCallsToday.find((x) => x.chatName === c.name && x.clientKey === c.clientKey)?.calls ?? 0) : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h3>Conversations</h3>
      {data.conversations ? (
        <div className="set-grid">
          <div className="set-field">
            <span className="set-label">Conversations</span>
            <span className="set-value">{countLine(Object.fromEntries(Object.entries(data.conversations.conversationsByStatus).map(([k, n]) => [STATUS_WORD[k as ConversationStatus] ?? k, n])), {})}</span>
          </div>
          <div className="set-field">
            <span className="set-label">Messages</span>
            <span className="set-value">{countLine(data.conversations.messagesByRole, ROLE_WORDS)}</span>
          </div>
          <div className="set-field">
            <span className="set-label">Commitments</span>
            <span className="set-value">{countLine(data.conversations.commitmentsByState, COMMIT_WORDS)}</span>
            <span className="set-hint">Counts only, for every registered chat; never what was said.</span>
          </div>
        </div>
      ) : (
        <p className="muted">Not available here.</p>
      )}
    </div>
  );
}

// ---------- Audit ----------

type Entry = { id: number; at: string; actorName: string; area: string; target: string; setting: string; oldValue: string | null; newValue: string | null; note: string | null };
const AREAS = [["", "Everything"], ["clients", "Clients"], ["ai", "AI"], ["conversations", "Conversations"], ["organization", "Organization"], ["levels", "Levels"], ["people", "People"]] as const;
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

type CodeViewRow = { id: number; at: string; actorId: string; actorName: string; clientKey: string; repoName: string; path: string; event: "repo_opened" | "file_opened" | "find_used" };
type CodeViewsData = { views: CodeViewRow[]; counts: { clientKey: string; views: number }[]; people: { id: string; name: string }[]; shown: number };
const CODE_EVENT_WORDS: Record<CodeViewRow["event"], string> = { repo_opened: "Opened the repo", file_opened: "Opened a file", find_used: "Used Find" };
/** RB-1: Admin › Audit › Code views: who opened which client's code, newest first, never any content. */
function CodeViews() {
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
  useEffect(() => {
    if (!data || !/\/code-views$/.test(location.hash)) return;
    document.querySelector<HTMLElement>('[data-setting="code-views"]')?.scrollIntoView?.({ block: "start" });
  }, [data]);
  const clients = data ? [...new Set([...data.counts.map((c) => c.clientKey), ...data.views.map((v) => v.clientKey)])].sort((a, b) => a.localeCompare(b)) : [];
  return (
    <section className="set-form adm-code-views" data-setting="code-views" aria-labelledby="code-views-h">
      <h3 id="code-views-h">Code views</h3>
      <p className="muted">Who opened which client's code in Code, and when: the repo, the file or Find. Never any of the code. The newest {data?.shown ?? 200}; kept 12 months.</p>
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
                  <td>{v.repoName}</td>
                  <td>{CODE_EVENT_WORDS[v.event]}</td>
                  <td className="adm-val">{v.event === "file_opened" ? v.path : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function AdminAudit() {
  const [area, setArea] = useState("");
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQ(text), 250);
    return () => clearTimeout(t);
  }, [text]);
  const { data, error } = useSection<{ entries: Entry[] }>("audit", { area, text: q });
  return (
    <div className="set-form">
      <p className="muted">Every admin change: who, when, the setting and its old and new value. The last 200.</p>
      <div className="set-inline adm-filter">
        <select aria-label="Area" value={area} onChange={(e) => setArea(e.target.value)}>
          {AREAS.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <input aria-label="Filter" placeholder="Filter by who, setting or client" value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      {error && <p className="field-problem">{error}</p>}
      {data && data.entries.length === 0 && <p className="muted">Nothing yet.</p>}
      {data && data.entries.length > 0 && (
        <div className="adm-scroll">
          <table className="adm-table adm-audit">
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
              {data.entries.map((e) => (
                <tr key={e.id}>
                  <td>{when(e.at)}</td>
                  <td>{e.actorName}</td>
                  <td>{e.target}</td>
                  <td>{e.setting}</td>
                  <td className="adm-val">{shown(e.oldValue)}</td>
                  <td className="adm-val">{shown(e.newValue)}</td>
                  <td>{e.note ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** One Admin section, by its Settings id. A non-admin who lands here sees why, not the section. */
type StandardsData = {
  available: boolean; repoUrl: string; branch: string; defaults: { repoUrl: string; branch: string }; everyMinutes: number; budget: number; syncedFrom: { repoUrl: string; branch: string } | null;
  commit: string | null; syncedAt: string | null; checkedAt: string | null; error: string | null; errorAt: string | null;
  warnings: ({ kind: "duplicate_id"; id: string; paths: string[] } | { kind: "incomplete"; path: string; missing: string[] })[];
  articles: { id: string; title: string; domain: string; layer: string; artifact: string; technology: string; path: string; url: string }[];
};

/** KB-1: Admin › Standards: the repo and branch (Rules), the last sync, Sync now, the warnings and the articles. Read only on GitHub. */
function AdminStandards() {
  const { data, error, load } = useSection<StandardsData>("standards");
  const saver = useAdminSave(load);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (error) return <p className="set-problem">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;
  const o = "org";
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const syncNow = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await call<{ ok: boolean; changed: boolean; error: string | null }>("admin.standards_sync", {});
      setMsg(r.ok ? (r.changed ? "Synced: a new copy is in use." : "Checked: nothing new.") : (r.error ?? "The sync failed. The last good copy is still in use."));
    } catch (e) {
      setMsg(e instanceof Error ? plain(e.message) : "The sync failed");
    }
    setBusy(false);
    await load();
  };
  return (
    <div className="adm-standards">
      <p className="muted">FocusTime reads Cooptimize's development standards from GitHub and uses them in AI drafts and Ask. It only ever reads the repo, with no token, and runs nothing from it. It looks for a new commit every {data.everyMinutes} minutes while FocusTime is in use.</p>
      <div className="set-form">
        <AField label="Repo" kind="Rule" s={saver.status(o, "standards.repo_url")} retry={() => void saver.save(o, "standards.repo_url", data.repoUrl, "Standards repo")} hint="A public https://github.com/<owner>/<repo> address.">
          <TextInput label="Standards repo" value={saver.shown(o, "standards.repo_url", data.repoUrl)} maxLength={300} onSave={(v) => void saver.save(o, "standards.repo_url", v, "Standards repo")} />
        </AField>
        <AField label="Branch" kind="Rule" s={saver.status(o, "standards.branch")} retry={() => void saver.save(o, "standards.branch", data.branch, "Standards branch")} hint="Empty means the repo's default branch.">
          <TextInput label="Standards branch" placeholder="The default branch" value={saver.shown(o, "standards.branch", data.branch)} maxLength={200} onSave={(v) => void saver.save(o, "standards.branch", v, "Standards branch")} />
        </AField>
        <div className="set-field">
          <span className="set-label">Last synced</span>
          <span>{data.syncedAt ? <><Stamp at={data.syncedAt} tz={zone} /> · commit <code>{data.commit?.slice(0, 7)}</code></> : "Not synced yet"}</span>
        </div>
        {data.checkedAt && (
          <div className="set-field">
            <span className="set-label">Last checked</span>
            <span><Stamp at={data.checkedAt} tz={zone} /></span>
          </div>
        )}
        <div className="set-field">
          <span className="set-label">Budget</span>
          <span>{data.budget.toLocaleString()} tokens of matched articles per AI request</span>
        </div>
        <div className="set-field">
          <span className="set-inline">
            <button type="button" className="mini" disabled={busy || !data.available} onClick={() => void syncNow()}>{busy ? "Syncing…" : "Sync now"}</button>
            {msg && <span className="muted" role="status">{msg}</span>}
          </span>
        </div>
      </div>
      {data.error && (
        <p className="set-problem" role="alert">The last sync failed{data.errorAt ? <> (<Stamp at={data.errorAt} tz={zone} />)</> : null}: {data.error}. The last good copy is still in use.</p>
      )}
      {data.warnings.map((w) => (
        <p key={w.kind === "duplicate_id" ? w.id : w.path} className="set-problem">
          {w.kind === "duplicate_id" ? <>Two active articles share the id <code>{w.id}</code>: {w.paths.join(" and ")}. Both are in use.</> : <>{w.path} is active but its front matter is missing {w.missing.join(", ")}, so it isn't used.</>}
        </p>
      ))}
      <h3 className="set-sub">Active articles ({data.articles.length})</h3>
      {data.articles.length === 0 ? <p className="muted">None yet.</p> : (
        <table className="adm-standards-table">
          <thead><tr><th>Title</th><th>Domain</th><th>Layer</th><th>Artifact</th><th>Technology</th><th>Path</th></tr></thead>
          <tbody>
            {data.articles.map((a) => (
              <tr key={a.path}>
                <td><a href={a.url} target="_blank" rel="noreferrer">{a.title}</a></td>
                <td>{a.domain}</td><td>{a.layer}</td><td>{a.artifact}</td><td>{a.technology}</td>
                <td className="adm-standards-path">{a.path}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function AdminSection({ id, admin }: { id: AdminUiSection; admin: boolean | null }) {
  if (admin === null) return <p className="muted">Loading…</p>;
  if (!admin) return <p className="muted">Admin is only for FocusTime admins (the "FocusTime Admins" group in Entra). Settings shows the team's values as "Set by your FocusTime admin".</p>;
  switch (id) {
    case "admin-clients":
      return <AdminClients />;
    case "admin-ai":
      return <AdminAi />;
    case "admin-conversations":
      return <AdminConversations />;
    case "admin-people":
      return <AdminPeople />;
    case "admin-organization":
      return <AdminOrganization />;
    case "admin-standards":
      return <AdminStandards />;
    case "admin-status":
      return <AdminStatus />;
    case "admin-audit":
      return (
        <>
          <AdminAudit />
          <CodeViews />
        </>
      );
  }
}
