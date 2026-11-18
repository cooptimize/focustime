// ADM-1, SA-4: Admin, its own place (#/admin) in the same shell Settings uses, only for FocusTime admins (the server
// checks every action again). Five parts in its rail (Clients, People, Team defaults, Health, Audit), the clients under
// them for one click to a client, Search Admin above them and Settings at the foot. Each part is its own file under
// ui/settings/admin/; this file keeps the shell. Nothing here shows anyone's plan, picks, follow-ups, captures, focus
// sessions, PATs, AI request text or chat messages: the server's sections carry names, dates, counts and yes or no only.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { call } from "../api.ts";
import { PanelShell, useNarrow, type RailGroup } from "../PanelShell.tsx";
import { usePhone } from "../viewport.ts";
import { AutoSaveProvider } from "./autosave.tsx";
import { colorVar, useAdminChanged } from "./admin/shared.tsx";
import "./admin/admin.css";
import { ClientsPart } from "./admin/Clients.tsx";
import { PeoplePart } from "./admin/People.tsx";
import { AiTab, ChatsTab, PlanningTab, StandardsTab, type AiClient } from "./admin/TeamDefaults.tsx";
import { HealthPart } from "./admin/Health.tsx";
import { CodeViews, SettingsChanges } from "./admin/Audit.tsx";
import { Tabs } from "./admin/Tabs.tsx";
import { ADMIN_PARTS, CLIENT_TABS, PART_NAME, PART_TABS, adminHref, adminPath, isTabbed, parseAdminPath, type AdminAt, type AdminPart, type ClientTab } from "./admin/places.ts";
import { searchAdmin, type AdminHit, type SearchPerson } from "./admin/search.ts";

export { useAdmin } from "./use-admin.ts";
export { RETIRED_ADMIN_SECTIONS } from "./admin/places.ts";

/** The line under a part's name: only parts that set something say how saving works (Health and Audit set nothing). */
const SAVES = "Team settings for everyone in FocusTime. Changes save as you make them and are logged in Admin › Audit.";
const DESCRIPTION: Record<AdminPart, string | null> = { clients: SAVES, people: SAVES, defaults: SAVES, health: "How FocusTime is doing here. Nothing on this page is a setting.", audit: "Every admin change and every code view. Nothing on this page is a setting." };
/** The message someone who isn't an admin gets at every Admin address (as before SA-4). */
export const NOT_ADMIN_TEXT = 'Admin is only for FocusTime admins (the "FocusTime Admins" group in Entra). Settings shows the team\'s values as "Set by your FocusTime admin".';

/** The tab last used in each part, and on a client's page, for this visit. */
const lastTab: Partial<Record<AdminPart, string>> = {};

/** Who and what the rail and Search Admin list: the clients (with their color) and the Cooptimizers (by name). */
function useRailData() {
  const [clients, setClients] = useState<AiClient[] | null>(null);
  const [people, setPeople] = useState<SearchPerson[] | null>(null);
  const [tick, setTick] = useState(0);
  useAdminChanged(useCallback(() => setTick((t) => t + 1), []));
  useEffect(() => {
    let live = true;
    call<{ clients: AiClient[] }>("admin.load", { section: "ai", filter: "customers" }).then((d) => live && setClients(d.clients.filter((c) => c.isClient)), () => live && setClients([]));
    call<{ people: { id: string; name: string }[] }>("admin.load", { section: "setup" }).then((d) => live && setPeople(d.people.map((p) => ({ id: p.id, name: p.name }))), () => live && setPeople([]));
    return () => void (live = false);
  }, [tick]);
  return { clients, people };
}

/** SA-4: a table on the phone is drawn as rows: each cell gets its column's name (CSS shows it before the value). */
function useRowLabels(root: React.RefObject<HTMLElement | null>, key: string) {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const label = () => {
      for (const t of el.querySelectorAll<HTMLTableElement>(".ps-body table")) {
        const heads = [...t.querySelectorAll<HTMLTableCellElement>("thead th")].map((h) => h.textContent?.trim() ?? "");
        for (const tr of t.querySelectorAll<HTMLTableRowElement>("tbody tr")) {
          [...tr.cells].forEach((c, i) => {
            if (c.colSpan === 1 && heads[i] && c.getAttribute("data-label") !== heads[i]) c.setAttribute("data-label", heads[i]!);
          });
        }
      }
    };
    label();
    const mo = new MutationObserver(label);
    mo.observe(el, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [root, key]);
}

type Props = {
  /** Admin's path ("" or null: Admin itself), as the address has it. */
  path: string | null;
  admin: boolean | null;
  onGo: (path: string | null) => void;
  onClose: () => void;
  /** The rail's foot: Settings. */
  onSettings: () => void;
  onNotice?: (message: string) => void;
};

export function AdminPlace(props: Props) {
  const phone = usePhone();
  const list = useNarrow() || phone;
  const raw = parseAdminPath(props.path) ?? { part: null, tab: null, client: null };
  // On a computer Admin opens on Clients; on the phone, the list of parts.
  const at: AdminAt = raw.part === null && !list ? { part: "clients", tab: null, client: null } : raw;
  const part = at.part;
  const tab = !part ? null : at.client ? ((at.tab as ClientTab | null) ?? (lastTab.clients as ClientTab | undefined) ?? "overview") : isTabbed(part) ? (at.tab ?? lastTab[part] ?? PART_TABS[part][0][0]) : null;
  useEffect(() => {
    if (part && tab) lastTab[part] = tab;
  }, [part, tab]);
  const [q, setQ] = useState("");
  const rail = useRailData();
  const root = useRef<HTMLDivElement>(null);
  useRowLabels(root, `${part}/${at.client}/${tab}`);
  const hits = useMemo(() => (q.trim() ? searchAdmin(q, { clients: rail.clients ?? [], people: rail.people ?? [], at }) : []), [q, rail.clients, rail.people, at.client]); // eslint-disable-line react-hooks/exhaustive-deps

  const groups: RailGroup[] = [
    {
      id: "admin",
      label: "Admin",
      items: ADMIN_PARTS.map(([id, label]) => ({
        id,
        label,
        href: adminHref({ part: id }),
        hint: id === "clients" && rail.clients ? String(rail.clients.length) : id === "people" && rail.people ? String(rail.people.length) : undefined,
      })),
    },
    ...(rail.clients && rail.clients.length
      ? [
          {
            id: "admin-clients",
            label: "Clients",
            items: rail.clients.map((c) => ({ id: `client:${c.key}`, label: c.key, href: adminHref({ part: "clients", client: c.key }), icon: <span className="swatch adm-rail-swatch" aria-hidden="true" style={{ "--c": colorVar(c.color ?? null) } as CSSProperties} /> })),
          },
        ]
      : []),
  ];
  const current = part === null ? null : at.client ? `client:${at.client}` : part;
  const title = !part ? "Admin" : at.client ? at.client : PART_NAME[part];
  const description = part && !at.client ? DESCRIPTION[part] : at.client ? SAVES : null;
  return (
    <AutoSaveProvider onNotice={props.onNotice}>
      {(leave) => {
        const goPath = (path: string | null) => leave(() => (setQ(""), props.onGo(path)));
        const goAt = (a: AdminAt) => goPath(adminPath(a) || null);
        const onPick = (id: string) => (id.startsWith("client:") ? goAt({ part: "clients", client: id.slice(7), tab: null }) : goAt({ part: id as AdminPart, tab: null, client: null }));
        const onHit = (h: AdminHit) => {
          const r = parseAdminPath(decodeURIComponent(h.href.replace(/^#\/admin\/?/, "")));
          if (r) goAt(r);
        };
        return (
          <div ref={root} className="adm-place">
            <PanelShell
              name="Admin"
              className="settings admin"
              groups={groups}
              current={current}
              railCurrent={current}
              onPick={onPick}
              onClose={() => leave(props.onClose)}
              onBack={at.client ? () => goAt({ part: "clients", tab: null, client: null }) : list && part !== null ? () => goPath(null) : null}
              backLabel={at.client ? "Clients" : "Admin"}
              title={title}
              description={description}
              railTop={<AdminSearch q={q} setQ={setQ} hits={hits} onGo={onHit} />}
              railOverride={q.trim() ? <AdminHits q={q} hits={hits} onGo={onHit} /> : undefined}
              railFoot={
                <div className="ps-group ps-foot" role="group" aria-label="Settings">
                  <a href="#/settings" className="ps-item" data-settings-section="settings" onClick={(e) => (e.preventDefault(), leave(props.onSettings))}>
                    <span>Settings</span>
                  </a>
                </div>
              }
              phone={list}
              pageKey={`${part}/${at.client ?? ""}`}
            >
              {part !== null && <PartBody at={at} tab={tab} goAt={goAt} />}
            </PanelShell>
          </div>
        );
      }}
    </AutoSaveProvider>
  );
}

function PartBody({ at, tab, goAt }: { at: AdminAt; tab: string | null; goAt: (a: AdminAt) => void }) {
  const part = at.part!;
  switch (part) {
    case "clients":
      return <ClientsPart client={at.client} tab={(tab as ClientTab | null) ?? CLIENT_TABS[0][0]} go={(client, t) => goAt({ part: "clients", client, tab: t ?? null })} />;
    case "people":
      return <PeoplePart tab={tab ?? "people"} onTab={(t) => goAt({ part, tab: t, client: null })} />;
    case "defaults":
      return (
        <Tabs label="Team defaults tabs" tabs={PART_TABS.defaults.map(([id, label]) => ({ id, label, href: adminHref({ part, tab: id }) }))} current={tab ?? "ai"} onPick={(t) => goAt({ part, tab: t, client: null })}>
          {tab === "chats" ? <ChatsTab /> : tab === "planning" ? <PlanningTab /> : tab === "standards" ? <StandardsTab /> : <AiTab />}
        </Tabs>
      );
    case "health":
      return <HealthPart />;
    case "audit":
      return (
        <Tabs label="Audit tabs" tabs={PART_TABS.audit.map(([id, label]) => ({ id, label, href: adminHref({ part, tab: id }) }))} current={tab ?? "changes"} onPick={(t) => goAt({ part, tab: t, client: null })}>
          {tab === "code" ? <CodeViews /> : <SettingsChanges />}
        </Tabs>
      );
  }
}

function AdminSearch({ q, setQ, hits, onGo }: { q: string; setQ: (q: string) => void; hits: AdminHit[]; onGo: (h: AdminHit) => void }) {
  return (
    <div className="ps-search">
      <input
        type="search"
        value={q}
        placeholder="Search Admin"
        aria-label="Search Admin"
        aria-controls="admin-search-results"
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && q) {
            // The first Esc clears the search; the next closes Admin.
            e.preventDefault();
            e.nativeEvent.stopImmediatePropagation();
            setQ("");
          } else if (e.key === "Enter" && hits[0]) {
            e.preventDefault();
            onGo(hits[0]);
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            document.querySelector<HTMLElement>("#admin-search-results a")?.focus();
          }
        }}
      />
    </div>
  );
}

function AdminHits({ q, hits, onGo }: { q: string; hits: AdminHit[]; onGo: (h: AdminHit) => void }) {
  return (
    <div id="admin-search-results" className="ps-results" role="region" aria-label="Search results" aria-live="polite">
      {hits.length === 0 ? (
        <p className="muted ps-none">Nothing in Admin called “{q.trim()}”.</p>
      ) : (
        hits.map((h) => (
          <a
            key={h.id}
            href={h.href}
            className="ps-item ps-hit"
            data-hit={h.kind}
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
              e.preventDefault();
              onGo(h);
            }}
            onKeyDown={(e) => {
              const el = e.currentTarget;
              if (e.key === "ArrowDown") (e.preventDefault(), (el.nextElementSibling as HTMLElement | null)?.focus());
              if (e.key === "ArrowUp") (e.preventDefault(), ((el.previousElementSibling as HTMLElement | null) ?? document.querySelector<HTMLElement>(".admin .ps-search input"))?.focus());
            }}
          >
            <span>{h.label}</span>
            <span className="ps-hint">{h.where}</span>
          </a>
        ))
      )}
    </div>
  );
}
