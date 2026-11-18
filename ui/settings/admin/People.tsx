// SA-4: Admin › People, five tabs: People (the table, Not Cooptimizers folded under it), Who's set up (with Invite),
// Client logins (client DevOps identities), Levels (positions to levels) and Admins. Moved from ui/settings/Admin.tsx
// with every action and check as it was; Remove asks for the name at the person's row. SA-4 F: drawn with SA-2's
// parts: groups, the one table style, lists, the button row and its result, the saved mark.
import { useState } from "react";
import { call } from "../../api.ts";
import { useSaveContext } from "../autosave.tsx";
import { Badge, Button, Buttons, Faint, Fold, Group, List, ListItem, Mark, Note, OutLink, Page, Select, State, Table, Text } from "../parts.tsx";
import { shortDate } from "../../labels.ts";
import { WhoSetUp } from "../WhoSetUp.tsx";
import { AdminConfirm, ASwitch, Kind, Problem, useAdminSave, useSection, type Saver } from "./shared.tsx";
import { Tabs } from "./Tabs.tsx";
import { adminHref, PART_TABS } from "./places.ts";

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
  positionName: string | null;
  clients: string[];
  sources: { microsoft: boolean; google: boolean; devopsWrites: number } | null;
};
type Position = { name: string; people: number; mapped: boolean; level: string | null };
type IdentityRowView = import("../../../plan/identities.ts").IdentityRowView;
type ClientIdentitiesView = import("../../../plan/identities.ts").ClientIdentitiesView;
type PeopleData = { identities?: ClientIdentitiesView[]; people: Person[]; others: Person[]; positions: Position[]; unmappedPositions: number; noDomains: boolean; leadsShown: number; admins: { id: string; name: string | null; via: string | null; checkedAt: string | null }[]; groupLink: string | null; groupSet: boolean; refreshedAt: string | null; levels: { id: string; name: string }[] };

const SETUP_WORDS = { done: "Done", skipped: "Skipped", started: "Started", not_started: "Not started" } as const;

export function PeoplePart({ tab, onTab }: { tab: string; onTab: (t: string) => void }) {
  const { data, error, load } = useSection<PeopleData>("people");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<Person | null>(null);
  const ctx = useSaveContext();
  const saver = useAdminSave(load);
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
  const tabs = PART_TABS.people.map(([id, label]) => ({ id, label: id === "people" && data ? `${label} (${data.people.length})` : label, href: adminHref({ part: "people", tab: id }) }));
  const removed = async (m: string) => (setRemoving(null), setMsg(m), await load());
  const body = () => {
    if (error) return <Problem>{error}</Problem>;
    if (!data && tab !== "setup") return <Note>Loading…</Note>;
    switch (tab) {
      case "setup":
        return (
          <Page>
            <Group label="Who's set up">
              <WhoSetUp />
            </Group>
          </Page>
        );
      case "logins":
        return <ClientIdentities clients={data!.identities ?? []} people={data!.people} reload={load} />;
      case "levels":
        return <PositionMap positions={data!.positions} unmapped={data!.unmappedPositions} levels={data!.levels} saver={saver} />;
      case "admins":
        return <Admins data={data!} />;
      default:
        return (
          <Page>
            <Group label="People" intro="Cooptimizers only. Levels change suggestions and emphasis only, never what anyone can see or do.">
              <Buttons result={msg ?? (data!.refreshedAt ? `Levels and leads read ${shortDate(data!.refreshedAt.slice(0, 10))}; again each day.` : "Not read from Dataverse yet.")}>
                <Button disabled={busy} onClick={() => void refresh()}>
                  {busy ? "Reading…" : "Refresh from Dataverse"}
                </Button>
              </Buttons>
              {data!.noDomains && <Problem>Set Cooptimize email domains in Admin › Team defaults › Planning and new people (Help invites go only to). Until then only guest accounts are left out of People.</Problem>}
              <PeopleTable people={data!.people} levels={data!.levels} leadsShown={data!.leadsShown} saver={saver} onOverride={override} onRemove={setRemoving} removing={removing} onRemoved={removed} label="People" />
              {data!.others.length > 0 && (
                <Fold label="Not Cooptimizers" count={data!.others.length}>
                  <Note>Guests, people outside the Cooptimize email domains and automation accounts. They have no level, lead no client and never show in pickers. Nothing about them is deleted.</Note>
                  <PeopleTable people={data!.others} levels={data!.levels} leadsShown={data!.leadsShown} saver={saver} onOverride={override} onRemove={setRemoving} removing={removing} onRemoved={removed} label="Not Cooptimizers" others />
                </Fold>
              )}
            </Group>
          </Page>
        );
    }
  };
  return (
    <div className="adm-people">
      <Tabs label="People tabs" tabs={tabs} current={tab} onPick={onTab}>
        {body()}
      </Tabs>
    </div>
  );
}

/** Admins: the signed-in admin and everyone seen; "Nobody seen yet." only when that is true. */
function Admins({ data }: { data: PeopleData }) {
  return (
    <Page>
      <Group label="Admins" intro={`Admins are the members of the Entra group "FocusTime Admins". FocusTime never makes anyone an admin; add or remove members in Entra.`}>
        <Note>{data.groupLink ? <OutLink href={data.groupLink}>Open the group in Entra</OutLink> : "The group isn't set up for this FocusTime yet (runbook: Creating the admin group)."}</Note>
        <List label="Admins" empty="Nobody seen yet.">
          {data.admins.map((a) => (
            <ListItem key={a.id}>
              {a.name ?? "Someone who hasn't signed in"} <Faint>{a.via === "break_glass" ? "break-glass list" : a.via === "demo" ? "the demo" : "FocusTime Admins"}</Faint>
            </ListItem>
          ))}
        </List>
      </Group>
    </Page>
  );
}

/**
 * AH-3: client DevOps identities. A Cooptimizer often signs in to a client's DevOps with a client login ("Ext-…"). Linked
 * ones (from their Account Worker row in Dataverse, or confirmed here) count as them everywhere; a suggestion (the same
 * name once a prefix or suffix is off) waits for Confirm; unmatched ones show as DevOps has them, with Link to a person.
 * Emails never reach this page: rows carry a display name and an opaque ref. Every change is in Admin › Audit.
 */
export function ClientIdentities({ clients, people, reload }: { clients: ClientIdentitiesView[]; people: Person[]; reload: () => Promise<void> }) {
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
    <Page>
      <Group title="Client DevOps identities" label="Client DevOps identities" intro="When someone signs in to a client's DevOps with a client login, FocusTime counts that login as them: their items, the names shown, leads, Team and notes. Suggestions are only applied when you confirm them.">
        {msg && <Note live>{msg}</Note>}
        {clients.length === 0 && <Note>No client logins seen in the clients' DevOps.</Note>}
      </Group>
      {clients.map((c) => (
        <Group key={c.clientKey} title={c.clientKey} label={`${c.clientKey} identities`} intro={c.line}>
          <List label={`${c.clientKey} identities`}>
            {c.rows.map((r) => (
              <ListItem
                key={r.ref}
                extra={
                  r.state === "linked" ? (
                    <Button kind="quiet" disabled={busy === r.ref} onClick={() => void act(r, "remove", r.personId!, `${r.name} is no longer ${r.personName ?? "linked"}`)} label={`Remove ${r.name} from ${r.personName ?? "this person"}`}>
                      Remove
                    </Button>
                  ) : r.state === "suggested" ? (
                    <>
                      <Button disabled={busy === r.ref} onClick={() => void act(r, "link", r.personId!, `${r.name} is ${r.personName} on ${r.clientKey}`)} label={`Confirm ${r.name} is ${r.personName}`}>
                        Confirm
                      </Button>
                      <Button kind="quiet" disabled={busy === r.ref} onClick={() => void act(r, "remove", r.personId!, `${r.name} won't be suggested for ${r.personName} again`)} label={`${r.name} isn't ${r.personName}`}>
                        Not them
                      </Button>
                    </>
                  ) : (
                    <Select
                      label={`Link ${r.name} to a person`}
                      value=""
                      disabled={busy === r.ref}
                      options={[{ value: "", label: "Link to a person…" }, ...coops.map((p) => ({ value: p.id, label: p.name }))]}
                      onChange={(id) => {
                        const p = coops.find((x) => x.id === id);
                        if (p) void act(r, "link", p.id, `${r.name} is ${p.name} on ${r.clientKey}`);
                      }}
                    />
                  )
                }
              >
                <span data-identity={r.state}>
                  {r.name} <Faint>{r.state === "linked" ? `${r.personName ?? "Someone"} · ${r.source === "dataverse" ? "from Dataverse" : "confirmed"}` : r.state === "suggested" ? `Looks like ${r.personName}` : "Not linked"}</Faint>
                </span>
              </ListItem>
            ))}
          </List>
        </Group>
      ))}
    </Page>
  );
}

/** ADM-2 (D605): Dataverse position names to levels. Applies at once (the next read of levels), audited as one Rule. */
export function PositionMap({ positions, unmapped, levels, saver }: { positions: Position[]; unmapped: number; levels: PeopleData["levels"]; saver: Saver }) {
  const map = Object.fromEntries(positions.filter((p) => p.mapped).map((p) => [p.name, p.level]));
  const shown = saver.shown("org", "org.position_levels", map) as Record<string, string | null>;
  const set = (name: string, level: string | null) => void saver.save("org", "org.position_levels", { ...shown, [name]: level }, `${name} mapped`);
  return (
    <Page>
      <Group title="Positions to levels" label="Positions to levels" intro="Each Cooptimizer's level comes from their Dataverse position. A position that isn't mapped gives no level: those people show Level not set and use the Consultant defaults.">
        <Note>
          <Kind kind="Rule" /> {unmapped > 0 && <Badge>{unmapped} not mapped</Badge>} <Mark s={saver.status("org", "org.position_levels")} retry={() => void saver.save("org", "org.position_levels", shown, "Positions")} />
        </Note>
        <Table
          label="Positions to levels"
          head={["Position in Dataverse", "Level", "People"]}
          rowKey={(i) => positions[i]!.name}
          rows={positions.map((p) => {
            const v = p.name in shown ? shown[p.name] : null;
            return [p.name, <Select key="l" label={`Level for ${p.name}`} value={v ?? ""} options={[...levels.map((l) => ({ value: l.id, label: l.name })), { value: "", label: "Not mapped" }]} onChange={(x) => set(p.name, x || null)} />, String(p.people)];
          })}
        />
      </Group>
    </Page>
  );
}

type OnOverride = (input: Record<string, unknown>, what: string, undo?: Record<string, unknown>) => Promise<void>;

function PeopleTable({ people, levels, leadsShown, saver, onOverride, onRemove, removing, onRemoved, label, others = false }: { people: Person[]; levels: PeopleData["levels"]; leadsShown: number; saver: Saver; onOverride: OnOverride; onRemove: (p: Person | null) => void; removing: Person | null; onRemoved: (m: string) => Promise<void>; label: string; others?: boolean }) {
  // SA-4 F: Last sign-in, Setup, Dataverse and Sources are one column, a line each, so the table fits the page.
  const head = others ? ["Name", "Why not", "Signed in and set up", "Automation", ""] : ["Name", "Level", "Client lead", "Signed in and set up", "Clients", "Automation", ""];
  return (
    <Table
      label={label}
      head={head}
      rowKey={(i) => people[i]!.id}
      rows={people.map((p) => personCells({ p, levels, leadsShown, saver, onOverride, onRemove: () => onRemove(p), others }))}
      // SA-4: the confirm opens at the person's row, not at the foot of the page.
      after={(i) => (removing?.id === people[i]!.id ? <RemovePerson p={people[i]!} onClose={() => onRemove(null)} onDone={onRemoved} /> : null)}
    />
  );
}

/** A person's leads, with Remove on each, "and N more", the removed ones with Undo, and Add as lead of. */
function Leads({ p, leadsShown, onOverride }: { p: Person; leadsShown: number; onOverride: OnOverride }) {
  const [adding, setAdding] = useState("");
  const [allLeads, setAllLeads] = useState(false);
  const leadClients = p.leads.map((l) => l.clientKey);
  const addable = p.clients.filter((k) => !leadClients.includes(k));
  const shownLeads = allLeads ? p.leads : p.leads.slice(0, leadsShown);
  return (
    <List
      label={`${p.name}: leads`}
      add={
        addable.length > 0 && (
          <>
            <Select label={`${p.name}: add as lead of`} value={adding} options={[{ value: "", label: "Add as lead of…" }, ...addable.map((k) => ({ value: k, label: k }))]} onChange={setAdding} />
            <Button disabled={!adding} onClick={() => (void onOverride({ personId: p.id, kind: "lead_add", clientKey: adding }, `${p.name} added as a lead of ${adding}`, { personId: p.id, kind: "lead_add", clientKey: adding, clear: true }), setAdding(""))}>
              Add
            </Button>
          </>
        )
      }
    >
      {shownLeads.map((l) => (
        <ListItem key={l.clientKey} removeLabel={`Remove ${p.name} as lead of ${l.clientKey}`} onRemove={() => void onOverride(l.why.length === 1 && l.why[0] === "override" ? { personId: p.id, kind: "lead_add", clientKey: l.clientKey, clear: true } : { personId: p.id, kind: "lead_remove", clientKey: l.clientKey }, `${p.name} no longer a lead of ${l.clientKey}`)}>
          {l.clientKey} <Faint>{l.whyText.join(", ")}{l.primary ? " · primary" : ""}</Faint>
          {l.why.includes("override") && <Badge>Override</Badge>}
        </ListItem>
      ))}
      {p.leads.length > leadsShown && (
        <ListItem>
          <Button kind="quiet" onClick={() => setAllLeads((a) => !a)}>
            {allLeads ? "Show fewer" : `and ${p.leads.length - leadsShown} more`}
          </Button>
        </ListItem>
      )}
      {p.removedLeads.map((k) => (
        <ListItem key={`removed-${k}`} removeText="Undo" removeLabel={`${p.name} back as a lead of ${k}`} onRemove={() => void onOverride({ personId: p.id, kind: "lead_remove", clientKey: k, clear: true }, `${p.name} back as a lead of ${k}`)}>
          <Faint>{k}: removed by an admin</Faint> <Badge>Override</Badge>
        </ListItem>
      ))}
    </List>
  );
}

function personCells({ p, levels, leadsShown, saver, onOverride, onRemove, others }: { p: Person; levels: PeopleData["levels"]; leadsShown: number; saver: Saver; onOverride: OnOverride; onRemove: () => void; others: boolean }) {
  const scope = `person:${p.id}`;
  const automation = (
    <span key="auto">
      <ASwitch checked={saver.shown(scope, "automation", p.automation)} label={`${p.name}: automation account`} onChange={(v) => void saver.save(scope, "automation", v ? true : undefined, `${p.name}: automation account`)} /> <Mark s={saver.status(scope, "automation")} retry={() => void saver.save(scope, "automation", p.automation ? true : undefined, `${p.name}: automation account`)} />
    </span>
  );
  // The word, then the how on its own line (matched by which key, or why there's no sign-in to match yet).
  const dvWord = !p.dataverseMatch ? "Not matched" : p.signedIn ? "Matched" : "In Dataverse";
  const dvHint = p.dataverseText.replace(/^In Dataverse, |^Matched /, "").replace(/^./, (c) => c.toUpperCase());
  const dataverse = (
    <span key="dv" title={p.dataverseText}>
      Dataverse: {p.dataverseMatch ? dvWord : <State tone="error">{dvWord}</State>} <Faint>({dvHint})</Faint>
    </span>
  );
  const name = (
    <span key="name">
      {p.name}
      {p.me && <Faint> (you)</Faint>}
      {p.email && <Faint block>{p.email}</Faint>}
    </span>
  );
  const sources = p.sources ? [p.sources.microsoft ? "Microsoft" : null, p.sources.google ? "Google" : null, p.sources.devopsWrites ? `DevOps writes for ${p.sources.devopsWrites}` : null].filter(Boolean).join(", ") || "None" : "Not signed in";
  const remove = p.signedIn && !p.me ? (
    <Button key="rm" kind="danger" label={`Remove ${p.name} from FocusTime`} onClick={onRemove}>
      Remove
    </Button>
  ) : (
    ""
  );
  const signIn = p.lastSignInAt ? shortDate(p.lastSignInAt.slice(0, 10)) : "Never";
  const setup = p.setup ? SETUP_WORDS[p.setup] : "n/a";
  const state = (
    <span key="state">
      Last sign-in {signIn}
      <Faint block>Setup: {setup}</Faint>
      <span className="sp-block">{dataverse}</span>
      <Faint block>Sources: {sources}</Faint>
    </span>
  );
  if (others) return [name, p.notCooptimizerText ?? "", state, automation, remove];
  const level = (
    <span key="level">
      <Select
        label={`${p.name}: level`}
        value={p.levelSource === "override" ? (p.level ?? "") : ""}
        options={[{ value: "", label: p.dataverseLevel ? `${p.dataverseLevel} (Dataverse)` : "Level not set" }, ...levels.map((l) => ({ value: l.id, label: `${l.name} (override)` }))]}
        onChange={(v) =>
          void (v
            ? onOverride({ personId: p.id, kind: "level", value: v }, `${p.name}'s level set`, p.levelSource === "override" && p.level ? { personId: p.id, kind: "level", value: p.level } : { personId: p.id, kind: "level", clear: true })
            : onOverride({ personId: p.id, kind: "level", clear: true }, `${p.name}'s level back to Dataverse's`, p.level ? { personId: p.id, kind: "level", value: p.level } : undefined))
        }
      />
      {p.levelSource === "override" && <Badge>Override</Badge>}
      {!p.level && <Faint block>Uses Consultant defaults{p.positionName ? ` (position ${p.positionName} isn't mapped)` : ""}</Faint>}
    </span>
  );
  return [name, level, <Leads key="leads" p={p} leadsShown={leadsShown} onOverride={onOverride} />, state, p.clients.length ? p.clients.join(", ") : "None", automation, remove];
}

function RemovePerson({ p, onClose, onDone }: { p: Person; onClose: () => void; onDone: (message: string) => Promise<void> }) {
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
  // HK-3: focus goes back to the person's Remove when this closes (AdminConfirm).
  return (
    <AdminConfirm
      label={`Remove ${p.name}`}
      text={`Remove ${p.name} from FocusTime? This deletes their plan, settings and personal secrets (sign-ins, write PATs) now and ends their sessions. It can't be undone. Their Dataverse, DevOps and Outlook data stay as they are.`}
      confirm={`Remove ${p.name}`}
      disabled={busy || typed.trim().toLowerCase() !== p.name.trim().toLowerCase()}
      onConfirm={() => void run()}
      onCancel={onClose}
    >
      <Text label="Type their name to confirm" value={typed} placeholder={p.name} onChange={setTyped} bind={{ autoFocus: true }} />
      {err && <Problem>{err}</Problem>}
    </AdminConfirm>
  );
}
