// SA-4: Admin › Clients. A list you can scan (one row per client: its color, name, leads and its state as small marks),
// and a page for each client with seven tabs. Every control is the one Admin › Clients and Admin › AI had, with its
// stored key, its check and its action unchanged; nothing is set from the list. The registered chats load once for the
// part (the list's marks and a client's Chats tab share them).
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { call } from "../../api.ts";
import { SaveMark } from "../autosave.tsx";
import { DeliveryChatField, DeliveryChatsProvider, useDeliveryChats } from "../DeliveryChats.tsx";
import { MeetingsField } from "../AdminMeetings.tsx";
import { ScopeField } from "../AdminScope.tsx";
import { DeploySettings } from "../../DeployItems.tsx";
import { TextBox } from "../../TextBox.tsx";
import { StatusRows } from "../StatusRows.tsx";
import type { StatusGroup } from "../../../actions/status-rows.ts";
import { AField, ClientFilter, colorVar, Kind, ListInput, useAdminSave, useSection, type ClientFilterValue, type ClientRow, type ClientsData, type Saver } from "./shared.tsx";
import { CodeAccessField, FixGapsField, ProcessView, SourceSystemsField } from "./ClientFields.tsx";
import { Tabs } from "./Tabs.tsx";
import { adminHref, CLIENT_TABS, type ClientTab } from "./places.ts";
import { seeChangesFor } from "./Audit.tsx";
import { settingLabel } from "./settings-list.ts";

const TYPE_WORDS: Record<string, string> = { customer: "Customer", prospect: "Prospect", partner: "Partner", vendor: "Vendor", consultant: "Consultant", other: "Other", competitor: "Competitor", investor: "Investor", influencer: "Influencer", press: "Press", reseller: "Reseller", supplier: "Supplier" };

/** ADM-2: every account with why it is or isn't a client, and the admins' two overrides (each audited). */
function AllAccounts({ rows, saver }: { rows: ClientRow[]; saver: Saver }) {
  return (
    <div className="adm-scroll">
      <table className="adm-table adm-accounts adm-rows-phone">
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
                  {/* Any account's own page, client or not (its AI switches live there now). */}
                  <a href={adminHref({ part: "clients", client: c.key })}>{c.key}</a>
                  {c.names.length > 0 && c.names.join(", ") !== c.key && <span className="muted adm-email">{c.names.join(", ")}</span>}
                </th>
                <td data-label="In Dataverse">{c.types.length ? c.types.map((t) => TYPE_WORDS[t] ?? t).join(", ") : <span className="muted">No type</span>}</td>
                <td data-label="Client?">
                  {c.isClient ? "Client" : <span className="muted">Not a client</span>}
                  <span className="set-hint">{c.whyText}</span>
                  {c.hasSettings && <span className="adm-mark">Has settings, not a client</span>}
                </td>
                <td data-label="Treat as a client">
                  {!internal && (
                    <label className="adm-switch">
                      <input type="checkbox" role="switch" checked={saver.shown(scope, "treat_as_client", c.treatAsClient)} aria-label={`Treat ${c.key} as a client`} onChange={(e) => void saver.save(scope, "treat_as_client", e.target.checked ? true : undefined, `${c.key}: treat as a client`)} /> {c.treatAsClient ? "Yes" : "No"}
                    </label>
                  )}
                  <SaveMark s={saver.status(scope, "treat_as_client")} retry={() => void saver.save(scope, "treat_as_client", c.treatAsClient, `${c.key}: treat as a client`)} />
                </td>
                <td data-label="Hide from FocusTime">
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

// ---------- marks ----------

/** How many calls each client has registered (meeting.list, the same read the Calls tab makes), once per visit to Clients. */
function useCallCounts(keys: readonly string[]): Record<string, number | null> {
  const [counts, setCounts] = useState<Record<string, number | null>>({});
  const k = keys.join("\u0000");
  useEffect(() => {
    let live = true;
    void Promise.all(keys.map((key) => call<{ meetings: unknown[] }>("meeting.list", { clientKey: key }).then((d) => [key, d.meetings.length] as const, () => [key, null] as const))).then((all) => live && setCounts(Object.fromEntries(all)));
    return () => void (live = false);
  }, [k]); // eslint-disable-line react-hooks/exhaustive-deps
  return counts;
}

type Mark = { id: string; text: string; on: boolean };
/** A client's state as small marks, each from its own value: chats read, calls registered, Allow AI, code, DevOps. */
export function clientMarks(c: ClientRow, chats: { total: number; read: number } | null, calls: number | null | undefined): Mark[] {
  const out: Mark[] = [];
  if (chats) out.push({ id: "chats", text: chats.total === 0 ? "No chats" : chats.read === chats.total ? `${chats.read} ${chats.read === 1 ? "chat" : "chats"} read` : `${chats.read} of ${chats.total} chats read`, on: chats.read > 0 });
  if (c.isClient && calls !== undefined && calls !== null) out.push({ id: "calls", text: calls === 0 ? "No calls" : `${calls} ${calls === 1 ? "call" : "calls"}`, on: calls > 0 });
  out.push({ id: "ai", text: c.allowAi ? "AI allowed" : "AI off", on: c.allowAi });
  if (c.isClient) out.push({ id: "code", text: (c.codeAccess ?? "company") === "team" ? "Code: its team only" : "Code: whole company", on: true });
  if (c.isClient) out.push({ id: "devops", text: c.process.ok ? "DevOps read" : "DevOps not read", on: c.process.ok });
  return out;
}

function Marks({ marks }: { marks: Mark[] }) {
  return (
    <span className="adm-marks">
      {marks.map((m) => (
        <span key={m.id} className={`adm-chip${m.on ? "" : " off"}`} data-mark={m.id}>
          {m.text}
        </span>
      ))}
    </span>
  );
}

function chatCounts(chats: { clientKey: string; readOn: boolean }[] | undefined, key: string) {
  if (!chats) return null;
  const mine = chats.filter((c) => c.clientKey === key);
  return { total: mine.length, read: mine.filter((c) => c.readOn).length };
}

const matches = (c: ClientRow, q: string) => {
  const s = q.trim().toLowerCase();
  return !s || [c.key, ...c.names, ...(c.aliases ?? [])].some((n) => n.toLowerCase().includes(s));
};

// ---------- the part ----------

/** Clients: the list, or a client's page. One load of the clients and their chats for both. */
export function ClientsPart({ client, tab, go }: { client: string | null; tab: ClientTab; go: (client: string | null, tab?: ClientTab | null) => void }) {
  const [filter, setFilter] = useState<ClientFilterValue>("customers");
  const { data, error, load, loadWith } = useSection<ClientsData>("clients", { filter });
  const saver = useAdminSave(load);
  // A client's page for an account only in All accounts: read them all once.
  useEffect(() => {
    if (client && data && filter === "customers" && !data.clients.some((c) => c.key === client)) setFilter("all");
  }, [client, data, filter]);
  if (error) return <p className="field-problem">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;
  const row = client ? data.clients.find((c) => c.key === client) : null;
  return (
    <DeliveryChatsProvider>
      {saver.warning && <p className="set-problem" role="status">{saver.warning}</p>}
      {client ? (
        row ? (
          <ClientPage c={row} palette={data.palette} saver={saver} tab={tab} onTab={(t) => go(client, t)} onRefresh={() => loadWith({ refresh: true })} />
        ) : filter === "all" ? (
          <p className="muted">There is no client called {client} in FocusTime. <a href={adminHref({ part: "clients" })}>All clients</a></p>
        ) : (
          <p className="muted">Loading…</p>
        )
      ) : (
        <ClientList data={data} filter={filter} setFilter={setFilter} saver={saver} />
      )}
    </DeliveryChatsProvider>
  );
}

function ClientList({ data, filter, setFilter, saver }: { data: ClientsData; filter: ClientFilterValue; setFilter: (f: ClientFilterValue) => void; saver: Saver }) {
  const [q, setQ] = useState("");
  const chats = useDeliveryChats();
  const shown = useMemo(() => data.clients.filter((c) => matches(c, q)), [data.clients, q]);
  const calls = useCallCounts(useMemo(() => data.clients.filter((c) => c.isClient).map((c) => c.key), [data.clients]));
  return (
    <div className="adm-clients">
      <div className="set-row-actions">
        <ClientFilter value={filter} counts={data.counts} onChange={setFilter} />
        <span className="set-hint">Clients are active Dataverse accounts of type Customer, plus Cooptimize Internal and any account treated as a client under All accounts. Nothing is deleted.</span>
      </div>
      {!data.accountsRead && <p className="set-problem">Account types aren't read from Dataverse yet. Until they are, only accounts with Account Workers or Focus Time, Cooptimize Internal and accounts treated as clients count; prospects don't. Admin › Health shows when Dataverse was last read.</p>}
      {data.clients.length === 0 && <p className="muted">No clients yet. They come from Dataverse once people are read (Admin › People › Refresh from Dataverse).</p>}
      {filter === "all" ? (
        <AllAccounts rows={data.clients} saver={saver} />
      ) : (
        <>
          <label className="adm-find">
            <span className="sr-only">Find a client</span>
            <input type="search" value={q} placeholder="Find a client by name or other name" aria-label="Find a client by name or other name" onChange={(e) => setQ(e.target.value)} />
          </label>
          {shown.length === 0 && data.clients.length > 0 && <p className="muted">No client matches.</p>}
          <ul className="adm-client-list" aria-label="Clients">
            {shown.map((c) => (
              <li key={c.key} style={{ "--c": colorVar(c.color) } as CSSProperties}>
                <a href={adminHref({ part: "clients", client: c.key })} className="adm-client-row" data-client={c.key}>
                  <span className="swatch" aria-hidden="true" />
                  <span className="adm-client-name">{c.key}</span>
                  <span className="adm-client-leads muted">{c.leads.length ? c.leads.map((l) => l.name).join(", ") : "No leads found"}</span>
                  <Marks marks={clientMarks(c, chatCounts(chats?.data?.chats, c.key), calls[c.key])} />
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

// ---------- a client's page ----------

function ClientPage({ c, palette, saver, tab, onTab, onRefresh }: { c: ClientRow; palette: string[]; saver: Saver; tab: ClientTab; onTab: (t: ClientTab) => void; onRefresh: () => Promise<void> }) {
  const chats = useDeliveryChats();
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    await onRefresh();
    setRefreshing(false);
  };
  const calls = useCallCounts(useMemo(() => (c.isClient ? [c.key] : []), [c.key, c.isClient]));
  const tabs = CLIENT_TABS.map(([id, label]) => ({ id, label, href: adminHref({ part: "clients", client: c.key, tab: id }) }));
  return (
    <div className="adm-client-page" style={{ "--c": colorVar(c.color) } as CSSProperties}>
      <p className="adm-client-head">
        <span className="swatch" aria-hidden="true" />
        <Marks marks={clientMarks(c, chatCounts(chats?.data?.chats, c.key), calls[c.key])} />
        <a href={adminHref({ part: "audit", tab: "changes" })} className="mini link-btn" onClick={() => seeChangesFor(c.key)}>
          See changes
        </a>
      </p>
      {!c.isClient && <p className="set-hint">{c.whyText}. Only a client's own controls show for it; treat it as a client under Clients › All accounts.</p>}
      <Tabs label={`${c.key} tabs`} tabs={tabs} current={tab} onPick={(t) => onTab(t as ClientTab)}>
        <ClientTabBody c={c} palette={palette} saver={saver} tab={tab} onRefresh={refresh} refreshing={refreshing} />
      </Tabs>
    </div>
  );
}

function NotForThis({ c, what }: { c: ClientRow; what: string }) {
  return <p className="muted">{c.key} isn't a client in FocusTime, so it has no {what}.</p>;
}

function ClientTabBody({ c, palette, saver, tab, onRefresh, refreshing }: { c: ClientRow; palette: string[]; saver: Saver; tab: ClientTab; onRefresh: () => Promise<void>; refreshing: boolean }) {
  switch (tab) {
    case "overview":
      return <OverviewTab c={c} palette={palette} saver={saver} />;
    case "chats":
      return <ChatsTab c={c} saver={saver} />;
    case "calls":
      return c.isClient ? <MeetingsField clientKey={c.key} clientName={c.key} /> : <NotForThis c={c} what="calls" />;
    case "ai":
      return <AiTab c={c} saver={saver} />;
    case "code":
      return c.isClient ? <CodeAccessField c={c} saver={saver} /> : <NotForThis c={c} what="code" />;
    case "deployments":
      return c.isClient ? <DeploySettings clientKey={c.key} clientName={c.key} /> : <NotForThis c={c} what="deployments" />;
    case "backlog":
      return <BacklogTab c={c} saver={saver} onRefresh={onRefresh} refreshing={refreshing} />;
  }
}

/** A switch whose words say what on means, with its saved mark. */
function SwitchField({ c, saver, k, label, on, off, hint, value, aria }: { c: ClientRow; saver: Saver; k: string; label: string; on: string; off: string; hint: ReactNode; value: boolean; aria?: string }) {
  const scope = `client:${c.key}`;
  const shown = saver.shown(scope, k, value);
  return (
    <AField label={label} kind="Rule" s={saver.status(scope, k)} retry={() => void saver.save(scope, k, value, `${c.key}: ${label}`)} hint={hint}>
      <label className="set-check">
        <input type="checkbox" role="switch" checked={shown} aria-label={aria ?? `${label} for ${c.key}`} onChange={(e) => void saver.save(scope, k, e.target.checked, `${c.key}: ${label}`)} /> {shown ? on : off}
      </label>
    </AField>
  );
}

function OverviewTab({ c, palette, saver }: { c: ClientRow; palette: string[]; saver: Saver }) {
  const scope = `client:${c.key}`;
  const [hex, setHex] = useState(c.color?.startsWith("#") ? c.color : "");
  return (
    <div className="set-form">
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
          <span className="set-value">{c.leads.length ? c.leads.map((l) => `${l.name}${l.primary ? " (primary)" : ""}: ${l.why.join(", ")}`).join("; ") : <span className="muted">None found</span>}</span>
          <span className="set-hint">
            From Dataverse: the account's owner and Lead Consultants on the account. Add or remove one in <a href={adminHref({ part: "people", tab: "people" })}>Admin › People</a>.
          </span>
        </div>
        {c.isClient && (
          <>
            <AField label="Other names (aliases)" kind="Rule" s={saver.status(scope, "aliases")} retry={() => void saver.save(scope, "aliases", c.aliases ?? [], `${c.key}: other names`)} hint="Other names people use for this client, like a short name or an old company name. FocusTime holds back a message that names it in another client's chat with people outside Cooptimize, and flags it in text going to another client. Commas between them.">
              <ListInput label={`${c.key}: other names`} value={saver.shown(scope, "aliases", c.aliases ?? [])} onSave={(v) => void saver.save(scope, "aliases", v, `${c.key}: other names`)} />
            </AField>
            {/* HK-7 (Q-GD2-4): a name that is an ordinary word ("Atlas", "Summit") matches only with its casing. */}
            <SwitchField
              c={c}
              saver={saver}
              k="exact_case"
              label="Match only as written"
              aria={`${c.key}: match only as written`}
              value={c.exactCase ?? false}
              on="On: only with these capitals"
              off="Off: any capitals"
              hint={`Matches the name and other names only with the capitals as written, so "${c.key}" counts and "${c.key.toLowerCase()}" doesn't. For a name that is also an ordinary word. ${c.exactCaseDefault ? "On by default for this name." : "Off by default for this name."}`}
            />
          </>
        )}
      </div>
    </div>
  );
}

/** The team's AI requests per chat per day, read once for the Chats tab's line (Team defaults › Client chats sets it). */
function useChatAiCap(): number | null {
  const [cap, setCap] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    call<{ chatAiDailyCap: number }>("admin.load", { section: "conversations" }).then((d) => live && setCap(d.chatAiDailyCap), () => undefined);
    return () => void (live = false);
  }, []);
  return cap;
}

function ChatsTab({ c, saver }: { c: ClientRow; saver: Saver }) {
  const cap = useChatAiCap();
  return (
    <div className="set-form">
      <DeliveryChatField clientKey={c.key} clientName={c.key} refusal={c.chatRefusal ?? null} />
      <div className="set-grid">
        {/* CV-3: rules-only grouping while AI is off for this client (or not set up). */}
        <SwitchField c={c} saver={saver} k="group_without_ai" label="Group messages without AI" value={c.groupWithoutAi} on="On: replies, mentions and one person's run of messages join a conversation" off="Off: each message on its own" hint="While AI is off for the client, or not set up: replies, mentions and the same person within 45 minutes join a conversation." />
        {/* CV-4: images from this client's chats go to the AI to be described; the safety check can't inspect images. */}
        <SwitchField c={c} saver={saver} k="attachments_ai" label="Send attachments to AI" value={c.attachmentsAi} on="On: chat images go to the AI" off="Off: images stay out of AI" hint="Images pasted into the client's chats go to the AI to be described, with Allow AI on. The AI safety check reads text only and can't inspect images, so turning this on is the consent. Images are never kept in FocusTime." />
      </div>
      <p className="set-hint adm-readonly-line">
        {cap === null ? "AI requests per chat per day: the team's number." : `At most ${cap} AI requests per chat per day, for every client.`} <a href={adminHref({ part: "defaults", tab: "chats" })}>Change it in Team defaults › Client chats</a>
      </p>
    </div>
  );
}

function AiTab({ c, saver }: { c: ClientRow; saver: Saver }) {
  const scope = `client:${c.key}`;
  const [style, setStyle] = useState(c.houseStyle ?? "");
  useEffect(() => setStyle(c.houseStyle ?? ""), [c.houseStyle]);
  return (
    <div className="set-form">
      <div className="set-grid">
        <SwitchField c={c} saver={saver} k="allow_ai" label={settingLabel("client", "allow_ai")} value={c.allowAi} on="Allowed: AI may work on this client" off="Off: no AI for this client" hint="With AI for FocusTime on (Team defaults › AI), AI may sort this client's chats, break down its items and answer about it. Off: nothing about it goes to AI." />
        {c.isClient && <SourceSystemsField c={c} saver={saver} />}
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

/** This client's row of Health's DevOps check (the status rows registry's "devops" source, a row per client). */
function DevOpsCheck({ clientKey }: { clientKey: string }) {
  const [groups, setGroups] = useState<StatusGroup[] | null>(null);
  useEffect(() => {
    let live = true;
    call<{ groups?: StatusGroup[] }>("admin.load", { section: "status" }).then((d) => live && setGroups((d.groups ?? []).filter((g) => g.id === "devops").map((g) => ({ ...g, rows: g.rows.filter((r) => r.id.toLowerCase() === clientKey.toLowerCase()) }))), () => live && setGroups([]));
    return () => void (live = false);
  }, [clientKey]);
  if (!groups) return <p className="muted">Reading the DevOps check…</p>;
  if (!groups.length || !groups.some((g) => g.rows.length)) return null;
  return <StatusRows groups={groups} />;
}

function BacklogTab({ c, saver, onRefresh, refreshing }: { c: ClientRow; saver: Saver; onRefresh: () => Promise<void>; refreshing: boolean }) {
  const scope = `client:${c.key}`;
  return (
    <>
      <ProcessView c={c} saver={saver} onRefresh={onRefresh} refreshing={refreshing} />
      {c.scope && <ScopeField clientKey={c.key} project={c.process.ok ? c.process.project : null} s={c.scope} save={(v) => saver.save(scope, "devops_scope", v, `${c.key}: Cooptimize's work`)} status={saver.status(scope, "devops_scope")} retry={() => void saver.save(scope, "devops_scope", c.scope?.rule ?? undefined, `${c.key}: Cooptimize's work`)} />}
      {c.isClient && <FixGapsField c={c} saver={saver} />}
      {c.isClient && <DevOpsCheck clientKey={c.key} />}
    </>
  );
}
