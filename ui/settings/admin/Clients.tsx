// SA-4: Admin › Clients. A list you can scan (one row per client: its color, name, leads and its state as small marks),
// and a page for each client with seven tabs. Every control is the one Admin › Clients and Admin › AI had, with its
// stored key, its check and its action unchanged; nothing is set from the list. The registered chats load once for the
// part (the list's marks and a client's Chats tab share them). SA-4 F: drawn with SA-2's parts: the list is the parts'
// list of places to open (Clients in Settings is the same), a tab's settings are groups of rows.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { call } from "../../api.ts";
import { Button, Group, LinkItem, Links, Note, Page, Row, State, Swatches, Table, Text, Value } from "../parts.tsx";
import { DeliveryChatField, DeliveryChatsProvider, useDeliveryChats } from "../DeliveryChats.tsx";
import { MeetingsField } from "../AdminMeetings.tsx";
import { ScopeField } from "../AdminScope.tsx";
import { DeploySettings } from "../../DeployItems.tsx";
import { TextBox } from "../../TextBox.tsx";
import { StatusRows } from "../StatusRows.tsx";
import type { StatusGroup } from "../../../actions/status-rows.ts";
import { AField, ARead, ASwitch, CellMark, ClientFilter, Kind, ListInput, Problem, useAdminChanged, useAdminSave, useSection, type ClientFilterValue, type ClientRow, type ClientsData, type Saver } from "./shared.tsx";
import { CodeAccessField, FixGapsField, ProcessView, SourceSystemsField } from "./ClientFields.tsx";
import { Tabs } from "./Tabs.tsx";
import { adminHref, CLIENT_TABS, type ClientTab } from "./places.ts";
import { seeChangesFor } from "./Audit.tsx";
import { settingLabel } from "./settings-list.ts";

const TYPE_WORDS: Record<string, string> = { customer: "Customer", prospect: "Prospect", partner: "Partner", vendor: "Vendor", consultant: "Consultant", other: "Other", competitor: "Competitor", investor: "Investor", influencer: "Influencer", press: "Press", reseller: "Reseller", supplier: "Supplier" };

/** ADM-2: every account with why it is or isn't a client, and the admins' two overrides (each audited). */
function AllAccounts({ rows, saver }: { rows: ClientRow[]; saver: Saver }) {
  return (
    <Row
      id="all-accounts"
      def={{ label: "All accounts" }}
      noSid
      wide
      badge={<Kind kind="Rule" />}
      help="Every account, with why it is or isn't a client. Treat as a client and Hide from FocusTime are the team's."
    >
      <Table rowHeads
        label="All accounts"
        head={["Account", "In Dataverse", "Client?", "Treat as a client", "Hide from FocusTime"]}
        rowKey={(i) => rows[i]!.key}
        rows={rows.map((c) => {
          const scope = `client:${c.key}`;
          const internal = c.whyText === "Cooptimize Internal";
          return [
            <Value key="a">
              {/* Any account's own page, client or not (its AI switches live there). */}
              <a className="sp-go" href={adminHref({ part: "clients", client: c.key })}>
                {c.key}
              </a>
              {c.names.length > 0 && c.names.join(", ") !== c.key ? ` (${c.names.join(", ")})` : ""}
            </Value>,
            c.types.length ? c.types.map((t) => TYPE_WORDS[t] ?? t).join(", ") : "No type",
            `${c.isClient ? "Client" : "Not a client"}: ${c.whyText}${c.hasSettings ? ". Has settings, not a client" : ""}`,
            internal ? "" : (
              <span key="t">
                <ASwitch checked={saver.shown(scope, "treat_as_client", c.treatAsClient)} label={`Treat ${c.key} as a client`} onChange={(v) => void saver.save(scope, "treat_as_client", v ? true : undefined, `${c.key}: treat as a client`)} />
                <CellMark s={saver.status(scope, "treat_as_client")} retry={() => void saver.save(scope, "treat_as_client", c.treatAsClient, `${c.key}: treat as a client`)} />
              </span>
            ),
            internal ? "Always a client" : (
              <span key="h">
                <ASwitch checked={saver.shown(scope, "hidden", c.hidden)} label={`Hide ${c.key} from FocusTime`} onChange={(v) => void saver.save(scope, "hidden", v ? true : undefined, `${c.key}: hide from FocusTime`)} />
                <CellMark s={saver.status(scope, "hidden")} retry={() => void saver.save(scope, "hidden", c.hidden, `${c.key}: hide from FocusTime`)} />
              </span>
            ),
          ];
        })}
      />
    </Row>
  );
}

// ---------- marks ----------

/** How many calls each client has registered (meeting.list, the same read the Calls tab makes), once per visit to Clients. */
function useCallCounts(keys: readonly string[]): Record<string, number | null> {
  const [counts, setCounts] = useState<Record<string, number | null>>({});
  const [tick, setTick] = useState(0);
  useAdminChanged(useCallback(() => setTick((t) => t + 1), []));
  const k = keys.join("\u0000");
  useEffect(() => {
    let live = true;
    void Promise.all(keys.map((key) => call<{ meetings: unknown[] }>("meeting.list", { clientKey: key }).then((d) => [key, d.meetings.length] as const, () => [key, null] as const))).then((all) => live && setCounts(Object.fromEntries(all)));
    return () => void (live = false);
  }, [k, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  return counts;
}

type Mark = { id: string; text: string; on: boolean };
/** A client's state as small marks, each from its own value: chats read, calls registered, Allow AI, code, DevOps. */
export function clientMarks(c: ClientRow, chats: { total: number; read: number } | null, calls: number | null | undefined): Mark[] {
  const out: Mark[] = [];
  if (chats) out.push({ id: "chats", text: chats.total === 0 ? "No chats" : chats.read === chats.total ? `${chats.read} ${chats.read === 1 ? "chat" : "chats"} read` : `${chats.read} of ${chats.total} chats read`, on: chats.read > 0 });
  if (c.isClient && calls !== undefined && calls !== null) out.push({ id: "calls", text: calls === 0 ? "No calls" : `${calls} ${calls === 1 ? "call" : "calls"}`, on: calls > 0 });
  out.push({ id: "ai", text: c.allowAi ? "AI allowed" : "AI off", on: c.allowAi });
  // Who can read its code is a fact, not a state to fix: always the quiet word.
  if (c.isClient) out.push({ id: "code", text: (c.codeAccess ?? "company") === "team" ? "Code: its team only" : "Code: whole company", on: false });
  if (c.isClient) out.push({ id: "devops", text: c.process.ok ? "DevOps read" : "DevOps not read", on: c.process.ok });
  return out;
}

/** The marks as the parts' state words: on in the live color, off muted. */
function Marks({ marks }: { marks: Mark[] }) {
  return (
    <>
      {marks.map((m) => (
        <State key={m.id} tone={m.on ? "live" : "muted"}>
          {m.text}
        </State>
      ))}
    </>
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
  if (error) return <Problem>{error}</Problem>;
  if (!data) return <Note>Loading…</Note>;
  const row = client ? data.clients.find((c) => c.key === client) : null;
  return (
    <DeliveryChatsProvider>
      {saver.warning && <Problem live>{saver.warning}</Problem>}
      {client ? (
        row ? (
          <ClientPage c={row} palette={data.palette} saver={saver} tab={tab} onTab={(t) => go(client, t)} onRefresh={() => loadWith({ refresh: true })} />
        ) : filter === "all" ? (
          <Note>
            There is no client called {client} in FocusTime. <a className="sp-go" href={adminHref({ part: "clients" })}>All clients</a>
          </Note>
        ) : (
          <Note>Loading…</Note>
        )
      ) : (
        <ClientList data={data} filter={filter} setFilter={setFilter} saver={saver} onGo={(k) => go(k)} />
      )}
    </DeliveryChatsProvider>
  );
}

function ClientList({ data, filter, setFilter, saver, onGo }: { data: ClientsData; filter: ClientFilterValue; setFilter: (f: ClientFilterValue) => void; saver: Saver; onGo: (client: string) => void }) {
  const [q, setQ] = useState("");
  const chats = useDeliveryChats();
  const shown = useMemo(() => data.clients.filter((c) => matches(c, q)), [data.clients, q]);
  const calls = useCallCounts(useMemo(() => data.clients.filter((c) => c.isClient).map((c) => c.key), [data.clients]));
  return (
    <Page>
      <Group label="Clients">
        <Row id="which-accounts" def={{ label: "Which accounts" }} noSid help="Clients are active Dataverse accounts of type Customer, plus Cooptimize Internal and any account treated as a client under All accounts. Nothing is deleted.">
          <ClientFilter value={filter} counts={data.counts} onChange={setFilter} />
        </Row>
        {!data.accountsRead && <Problem>Account types aren't read from Dataverse yet. Until they are, only accounts with Account Workers or Focus Time, Cooptimize Internal and accounts treated as clients count; prospects don't. Admin › Health shows when Dataverse was last read.</Problem>}
        {data.clients.length === 0 && <Note>No clients yet. They come from Dataverse once people are read (Admin › People › Refresh from Dataverse).</Note>}
        {filter === "all" ? (
          <AllAccounts rows={data.clients} saver={saver} />
        ) : (
          <>
            <Row id="find-client" def={{ label: "Find a client" }} noSid wide>
              <Text wide value={q} placeholder="By name or other name" label="Find a client by name or other name" onChange={setQ} />
            </Row>
            {shown.length === 0 && data.clients.length > 0 && <Note>No client matches.</Note>}
            <Links label="Clients">
              {shown.map((c) => (
                <LinkItem
                  key={c.key}
                  href={adminHref({ part: "clients", client: c.key })}
                  onGo={() => onGo(c.key)}
                  color={c.color ?? ""}
                  name={c.key}
                  data={{ "data-client": c.key }}
                  detail={
                    <>
                      {c.leads.length ? c.leads.map((l) => l.name).join(", ") : "No leads found"} <Marks marks={clientMarks(c, chatCounts(chats?.data?.chats, c.key), calls[c.key])} />
                    </>
                  }
                />
              ))}
            </Links>
          </>
        )}
      </Group>
    </Page>
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
    <div className="adm-client-page">
      <Note>
        <Marks marks={clientMarks(c, chatCounts(chats?.data?.chats, c.key), calls[c.key])} />{" "}
        <a href={adminHref({ part: "audit", tab: "changes" })} className="sp-go" onClick={() => seeChangesFor(c.key)}>
          See changes
        </a>
      </Note>
      {!c.isClient && <Note>{c.whyText}. Only a client's own controls show for it; treat it as a client under Clients › All accounts.</Note>}
      <Tabs key={c.key} label={`${c.key} tabs`} tabs={tabs} current={tab} onPick={(t) => onTab(t as ClientTab)}>
        <ClientTabBody c={c} palette={palette} saver={saver} tab={tab} onRefresh={refresh} refreshing={refreshing} />
      </Tabs>
    </div>
  );
}

function NotForThis({ c, what }: { c: ClientRow; what: string }) {
  return (
    <Page>
      <Note>
        {c.key} isn't a client in FocusTime, so it has no {what}.
      </Note>
    </Page>
  );
}

function ClientTabBody({ c, palette, saver, tab, onRefresh, refreshing }: { c: ClientRow; palette: string[]; saver: Saver; tab: ClientTab; onRefresh: () => Promise<void>; refreshing: boolean }) {
  switch (tab) {
    case "overview":
      return <OverviewTab c={c} palette={palette} saver={saver} />;
    case "chats":
      return <ChatsTab c={c} saver={saver} />;
    case "calls":
      return c.isClient ? (
        <Page>
          <Group label="Calls">
            <MeetingsField clientKey={c.key} clientName={c.key} />
          </Group>
        </Page>
      ) : (
        <NotForThis c={c} what="calls" />
      );
    case "ai":
      return <AiTab c={c} saver={saver} />;
    case "code":
      return c.isClient ? (
        <Page>
          <Group label="Code">
            <CodeAccessField c={c} saver={saver} />
          </Group>
        </Page>
      ) : (
        <NotForThis c={c} what="code" />
      );
    case "deployments":
      return c.isClient ? (
        <Page>
          <Group label="Deployments">
            <DeploySettings clientKey={c.key} clientName={c.key} />
          </Group>
        </Page>
      ) : (
        <NotForThis c={c} what="deployments" />
      );
    case "backlog":
      return <BacklogTab c={c} saver={saver} onRefresh={onRefresh} refreshing={refreshing} />;
  }
}

/** A client's switch: its row says what on means; the help says what it does. */
function SwitchField({ c, saver, k, label, on, off, hint, more, value, aria }: { c: ClientRow; saver: Saver; k: string; label: string; on: string; off: string; hint: ReactNode; more?: ReactNode; value: boolean; aria?: string }) {
  const scope = `client:${c.key}`;
  const shown = saver.shown(scope, k, value);
  return (
    <AField label={label} kind="Rule" s={saver.status(scope, k)} retry={() => void saver.save(scope, k, value, `${c.key}: ${label}`)} hint={<><span className="sp-block">{shown ? on : off}</span>{hint}</>} more={more}>
      <ASwitch checked={shown} label={aria ?? `${label} for ${c.key}`} onChange={(v) => void saver.save(scope, k, v, `${c.key}: ${label}`)} />
    </AField>
  );
}

function OverviewTab({ c, palette, saver }: { c: ClientRow; palette: string[]; saver: Saver }) {
  const scope = `client:${c.key}`;
  const [hex, setHex] = useState(c.color?.startsWith("#") ? c.color : "");
  const useHex = () => /^#[0-9a-fA-F]{6}$/.test(hex.trim()) && void saver.save(scope, "color", hex.trim().toLowerCase(), `${c.key}: team color`);
  return (
    <Page>
      <Group label="Overview">
        <AField label="Team color" kind="Default" wide s={saver.status(scope, "color")} retry={() => void saver.save(scope, "color", c.color, `${c.key}: team color`)} hint={c.colorFrom === "suggested" ? "Suggested by FocusTime: distinct from the others, readable in both themes. Pick another to set it." : "Set by an admin. People may pick their own and reset to this one."}>
          <Swatches label={`${c.key}: team color`} name={`team-color-${c.key}`} values={palette} value={saver.shown(scope, "color", c.color) ?? ""} onChange={(slot) => void saver.save(scope, "color", slot, `${c.key}: team color`)} />
          <Text label={`${c.key}: custom color`} value={hex} placeholder="#rrggbb" maxLength={7} onChange={setHex} bind={{ onKeyDown: (e) => e.key === "Enter" && useHex() }} />
          <Button disabled={!/^#[0-9a-fA-F]{6}$/.test(hex.trim())} onClick={useHex}>
            Use
          </Button>
        </AField>
        <ARead label="Leads" wide help={<>From Dataverse: the account's owner and Lead Consultants on the account. Add or remove one in <a className="sp-go" href={adminHref({ part: "people", tab: "people" })}>Admin › People</a>.</>}>
          <Value>{c.leads.length ? c.leads.map((l) => `${l.name}${l.primary ? " (primary)" : ""}: ${l.why.join(", ")}`).join("; ") : "None found"}</Value>
        </ARead>
        {c.isClient && (
          <>
            <AField label="Other names (aliases)" kind="Rule" wide s={saver.status(scope, "aliases")} retry={() => void saver.save(scope, "aliases", c.aliases ?? [], `${c.key}: other names`)} hint="Other names people use for this client, like a short name or an old company name. Commas between them." more="FocusTime holds back a message that names it in another client's chat with people outside Cooptimize, and flags it in text going to another client.">
              <ListInput label={`${c.key}: other names`} value={saver.shown(scope, "aliases", c.aliases ?? [])} onSave={(v) => void saver.save(scope, "aliases", v, `${c.key}: other names`)} />
            </AField>
            {/* HK-7 (Q-GD2-4): a name that is an ordinary word ("Atlas", "Summit") matches only with its casing. */}
            <SwitchField c={c} saver={saver} k="exact_case" label="Match only as written" aria={`${c.key}: match only as written`} value={c.exactCase ?? false} on="On: only with these capitals" off="Off: any capitals" hint={`Matches the name and other names only with the capitals as written, so "${c.key}" counts and "${c.key.toLowerCase()}" doesn't. For a name that is also an ordinary word. ${c.exactCaseDefault ? "On by default for this name." : "Off by default for this name."}`} />
          </>
        )}
      </Group>
    </Page>
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
    <Page>
      <Group label="Client chats">
        <DeliveryChatField clientKey={c.key} clientName={c.key} refusal={c.chatRefusal ?? null} />
      </Group>
      <Group title="Reading its chats" label="Reading its chats">
        {/* CV-3: rules-only grouping while AI is off for this client (or not set up). */}
        <SwitchField c={c} saver={saver} k="group_without_ai" label="Group messages without AI" value={c.groupWithoutAi} on="On: replies, mentions and one person's run of messages join a conversation" off="Off: each message on its own" hint="While AI is off for the client, or not set up: replies, mentions and the same person within 45 minutes join a conversation." />
        {/* CV-4: images from this client's chats go to the AI to be described; the safety check can't inspect images. */}
        <SwitchField c={c} saver={saver} k="attachments_ai" label="Send attachments to AI" value={c.attachmentsAi} on="On: chat images go to the AI" off="Off: images stay out of AI" hint="Images pasted into the client's chats go to the AI to be described, with Allow AI on." more="The AI safety check reads text only and can't inspect images, so turning this on is the consent. Images are never kept in FocusTime." />
        <ARead label="AI requests per chat per day" help={<>The team's, for every client. <a className="sp-go" href={adminHref({ part: "defaults", tab: "chats" })}>Change it in Team defaults › Client chats</a></>}>
          <Value>{cap === null ? "" : `At most ${cap}`}</Value>
        </ARead>
      </Group>
    </Page>
  );
}

function AiTab({ c, saver }: { c: ClientRow; saver: Saver }) {
  const scope = `client:${c.key}`;
  const [style, setStyle] = useState(c.houseStyle ?? "");
  useEffect(() => setStyle(c.houseStyle ?? ""), [c.houseStyle]);
  return (
    <Page>
      <Group label="AI">
        <SwitchField c={c} saver={saver} k="allow_ai" label={settingLabel("client", "allow_ai")} value={c.allowAi} on="Allowed: AI may work on this client" off="Off: no AI for this client" hint="With AI for FocusTime on (Team defaults › AI), AI may sort this client's chats, break down its items and answer about it. Off: nothing about it goes to AI." />
        {c.isClient && <SourceSystemsField c={c} saver={saver} />}
        <AField label="House style for Break down" kind="Rule" wide s={saver.status(scope, "house_style")} retry={() => void saver.save(scope, "house_style", c.houseStyle, `${c.key}: house style`)} hint="Sent with every Break down request for this client. Empty goes back to the style learned from its own features.">
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
      </Group>
    </Page>
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
  if (!groups) return <Note>Reading the DevOps check…</Note>;
  if (!groups.length || !groups.some((g) => g.rows.length)) return null;
  return <StatusRows groups={groups} />;
}

function BacklogTab({ c, saver, onRefresh, refreshing }: { c: ClientRow; saver: Saver; onRefresh: () => Promise<void>; refreshing: boolean }) {
  const scope = `client:${c.key}`;
  return (
    <Page>
      <Group title="DevOps process" label="DevOps process">
        <ProcessView c={c} saver={saver} onRefresh={onRefresh} refreshing={refreshing} />
      </Group>
      {c.scope && (
        <Group title="Cooptimize's work in this project" label="Cooptimize's work in this project">
          <ScopeField clientKey={c.key} project={c.process.ok ? c.process.project : null} s={c.scope} save={(v) => saver.save(scope, "devops_scope", v, `${c.key}: Cooptimize's work`)} status={saver.status(scope, "devops_scope")} retry={() => void saver.save(scope, "devops_scope", c.scope?.rule ?? undefined, `${c.key}: Cooptimize's work`)} />
        </Group>
      )}
      {c.isClient && (
        <Group title="Needs attention" label="Needs attention">
          <FixGapsField c={c} saver={saver} />
        </Group>
      )}
      {c.isClient && (
        <Group title="DevOps check" label="DevOps check">
          <DevOpsCheck clientKey={c.key} />
        </Group>
      )}
    </Page>
  );
}
