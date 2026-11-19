// Settings (step 6b): every setting FocusTime owns, read from and written to the same validated settings (a person's
// account, or the config file in the developer loop); each field saves itself (ui/settings/autosave.tsx). Values
// owned by Dataverse are shown read-only with where to change them. Secrets are entered in masked fields that go
// straight to the keyring; they are never shown again (only whether they are set, and an expiry date if entered).
import { useCallback, useEffect, useRef, useState } from "react";
import type { SettingsClient, SettingsData } from "../actions/types.ts";
import { AutoSaveProvider } from "./settings/autosave.tsx";
import { call } from "./api.ts";
import { usePhone } from "./viewport.ts";
import { AdminPlace, NOT_ADMIN_TEXT, RETIRED_ADMIN_SECTIONS, useAdmin } from "./settings/Admin.tsx";
import { PanelShell, useNarrow, type RailGroup } from "./PanelShell.tsx";
import { useDeveloperLoop } from "./appenv.ts";
import { resolveSettings, sectionOf, SECTIONS, settingsHref, SETTINGS_GROUPS } from "./settings/registry.ts";
import { search } from "./settings/search.ts";
import { openOf, SearchResults, SettingsSearch, type Open } from "./settings/SearchResults.tsx";
import { takeLanding } from "./settings/landing.ts";
import { MostUsed } from "./settings/MostUsed.tsx";
import { useRowLabels } from "./settings/row-labels.ts";
import { ProfileSection } from "./settings/sections/Profile.tsx";
import { HoursSection } from "./settings/sections/Hours.tsx";
import { NotificationsSection } from "./settings/sections/Notifications.tsx";
import { DisplaySection } from "./settings/sections/Display.tsx";
import { PlanningSection } from "./settings/sections/Planning.tsx";
import { FocusSection } from "./settings/sections/Focus.tsx";
import { ClientSection, ClientsSection } from "./settings/sections/Clients.tsx";
import { ConnectionsSection } from "./settings/sections/Connections.tsx";
import { AiSection } from "./settings/sections/Ai.tsx";
import { DataSection } from "./settings/sections/Data.tsx";
import { AboutSection } from "./settings/sections/About.tsx";
import type { BodyProps, Props } from "./settings/sections/types.ts";

/** ST-1: every section id Settings opens (the registry's). SA-4: Admin is its own place (#/admin), not a section. */
export const SETTINGS_SECTIONS: readonly (readonly [string, string])[] = SECTIONS.map((s) => [s.id, s.label] as const);
/** SA-4: the section Admin's place rides on (ui/nav.ts ADMIN_SECTION), and where someone who isn't an admin lands. */
const ADMIN = "admin";
const NOT_ADMIN = "admin-only";
export type SettingsSectionId = string;

/** The section and setting an address opens: old ids mapped; "" is the rail (a list on the phone, Profile otherwise). */
function placeOf(section: string, setting: string | null | undefined, list: boolean, demo: boolean, admin: boolean | null): { current: string | null; setting: string | null } {
  if (section === "") return { current: list ? null : "you", setting: null };
  // TP-1b: a retired Admin page: Admin (its first page), or Profile for someone who isn't an admin.
  if (RETIRED_ADMIN_SECTIONS.includes(section)) return { current: admin === false ? "you" : null, setting: null };
  // SA-4: someone who isn't an admin, at an Admin address, gets the one line they always got.
  if (section === ADMIN) return { current: NOT_ADMIN, setting: null };
  const r = resolveSettings(section, setting);
  if (!r || (sectionOf(r.section)?.demoOnly && !demo)) return { current: "you", setting: null };
  return { current: r.section, setting: r.setting };
}

/** SA-4: #/admin is Admin's own place (for admins); every other address is Settings. */
export function Settings(props: Props) {
  const admin = useAdmin();
  const retired = RETIRED_ADMIN_SECTIONS.includes(props.section);
  // TP-1b: a retired Admin page lands on Admin for an admin.
  useEffect(() => {
    if (retired && admin) props.onSection(ADMIN, null);
  }, [retired, admin]); // eslint-disable-line react-hooks/exhaustive-deps
  if (props.section === ADMIN && admin === true) return <AdminPlace path={props.setting ?? null} admin={admin} onGo={(path) => props.onSection(ADMIN, path)} onClose={props.onClose} onSettings={() => props.onSection("")} {...(props.onNotice ? { onNotice: props.onNotice } : {})} />;
  return <SettingsPanel {...props} admin={admin} />;
}

function SettingsPanel(props: Props & { admin: boolean | null }) {
  const [data, setData] = useState<SettingsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  // SA-5: a client's-page result whose clients are listed, and the setting to land on once a client's page opens.
  const [asking, setAsking] = useState<string | null>(null);
  // The command menu's client's-page result hands its setting over once (ui/settings/landing.ts).
  const [clientSetting, setClientSetting] = useState<string | null>(() => takeLanding());
  // A jump to a setting is owed once, until it lands or the person moves on (see the effect below).
  const jumpDue = useRef(false);
  const phone = usePhone();
  const list = useNarrow() || phone;
  const admin = props.admin;
  const devLoop = useDeveloperLoop();
  const { current, setting } = placeOf(props.section, props.setting, list, props.demo, admin);
  // SA-5: a table on the phone is drawn as rows, as in Admin.
  useRowLabels(() => document.querySelector<HTMLElement>(".panel-shell.settings .ps-body"), `${current}/${setting ?? ""}/${data ? 1 : 0}`);
  const reload = useCallback(async () => {
    try {
      setData(await call<SettingsData>("settings.load", {}));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Settings could not load");
    }
  }, []);
  // Each section reads fresh data, so team values an admin just changed (here or elsewhere) show.
  useEffect(() => {
    void reload();
  }, [reload, current]);
  // Each jump is owed once. The person going anywhere else first (a click, a key, the focus moving) cancels it, so it
  // never takes the focus back; this effect runs after PanelShell's own focus on the section's heading.
  // On a client's page the address's last part is the client; the setting comes from a search result (SA-5).
  const target = current === "client" ? clientSetting : setting;
  useEffect(() => {
    if (!target) return;
    jumpDue.current = true;
    const moved = () => void (jumpDue.current = false);
    for (const e of ["focusin", "pointerdown", "keydown"]) document.addEventListener(e, moved, true);
    return () => {
      for (const e of ["focusin", "pointerdown", "keydown"]) document.removeEventListener(e, moved, true);
    };
  }, [current, target]);
  // A deep link to one setting: into view with a brief highlight, focus on its first control. Waits for the section's
  // data the first time; a later reload of that data (a save, a late response) doesn't do it again.
  useEffect(() => {
    if (!data || !target) return;
    const t = setTimeout(() => {
      if (!jumpDue.current) return;
      const el = document.querySelector<HTMLElement>(`.ps-body [data-setting="${CSS.escape(target)}"]`);
      if (!el) return;
      jumpDue.current = false;
      // SA-3: a setting inside a fold (Fine tuning, Each kind of notice) opens it first.
      for (let d = el.closest("details"); d; d = d.parentElement?.closest("details") ?? null) d.open = true;
      el.scrollIntoView?.({ block: "start" });
      el.classList.remove("ps-flash");
      void el.offsetWidth;
      el.classList.add("ps-flash");
      el.querySelector<HTMLElement>("input:not([disabled]), select:not([disabled]), textarea, button:not([disabled]), a[href]")?.focus({ preventScroll: true });
      setTimeout(() => el.classList.remove("ps-flash"), 2200);
    }, 60);
    return () => clearTimeout(t);
  }, [data, current, target]);
  const saved = useCallback(
    (d: SettingsData) => {
      setData(d);
      props.onSaved();
    },
    [props.onSaved], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const inAdmin = current === NOT_ADMIN;
  const def = current ? sectionOf(current) : undefined;
  const client = current === "client" ? (data?.clients.find((c) => c.key === setting) ?? null) : null;
  const clientName = (c: SettingsClient) => c.setting.name ?? c.dataverseName ?? c.key;
  const title = inAdmin ? "Admin" : current === "client" ? (client ? clientName(client) : (setting ?? "Client")) : (def?.label ?? "Settings");
  const description = inAdmin ? undefined : def?.description;
  const searchOpts = { demo: props.demo, dev: devLoop, phone, admin: admin === true };
  const hits = q.trim() ? search(q, searchOpts) : [];
  const groups: RailGroup[] = [
    ...SETTINGS_GROUPS.map(([g, label]) => ({
      id: g,
      label,
      items: SECTIONS.filter((s) => s.group === g && !s.parent && (!s.demoOnly || props.demo)).map((s) => ({ id: s.id, label: s.label, href: settingsHref(s.id) })),
    })),
  ];
  return (
    <AutoSaveProvider onNotice={props.onNotice}>
      {(leave) => {
        const go = (section: string, s?: string | null) => leave(() => (setQ(""), setAsking(null), setClientSetting(null), props.onSection(section, s ?? null)));
        const open = (o: Open) => {
          if (o.kind === "settings") return go(o.section, o.setting);
          if (o.kind === "admin") return go(ADMIN, o.path || null);
          if (o.kind === "client") return leave(() => (setQ(""), setAsking(null), setClientSetting(o.setting), props.onSection("client", o.client)));
          leave(() => (setQ(""), (location.hash = o.href)));
        };
        const first = hits[0];
        const onEnter = () => {
          if (!first) return;
          const o = openOf(first);
          if (o) open(o);
          else if (first.kind === "client") setAsking(first.id);
        };
        return (
          <PanelShell
            name="Settings"
            className="settings"
            groups={groups}
            current={current}
            railCurrent={current === "client" ? "clients" : current}
            onPick={(id) => go(id)}
            onClose={() => leave(props.onClose)}
            // SA-5: on the phone Back goes from a setting to its section, then to the list; the address follows.
            onBack={current === "client" ? () => go("clients") : list && current !== null && setting && !inAdmin ? () => go(current) : list && current !== null ? () => go("") : null}
            backLabel={current === "client" ? "Clients" : list && current !== null && setting && !inAdmin ? (def?.label ?? "Settings") : "Settings"}
            title={title}
            description={description}
            railLead={current === null && data ? <MostUsed {...props} section="" data={data} onSavedData={saved} reload={reload} client={null} go={go} /> : undefined}
            railTop={<SettingsSearch q={q} setQ={(x) => (setQ(x), setAsking(null))} onEnter={onEnter} />}
            railOverride={q.trim() ? <SearchResults q={q} hits={hits} clients={data?.clients ?? []} admin={admin === true} demo={props.demo} dev={devLoop} phone={phone} asking={asking} setAsking={setAsking} onOpen={open} onGuide={props.onGuide} /> : undefined}
            railFoot={
              // SA-4: Admin is its own place; Settings' rail has one line for it, for admins only.
              admin ? (
                <div className="ps-group ps-foot" role="group" aria-label="Admin">
                  <a href="#/admin" className="ps-item" data-settings-section="admin" onClick={(e) => (e.preventDefault(), go(ADMIN))}>
                    <span>Admin</span>
                  </a>
                </div>
              ) : undefined
            }
            phone={list}
            pageKey={`${current}/${current === "client" ? setting : ""}`}
          >
            {current !== null && (
              <>
                {error && <p className="field-problem">{error}</p>}
                {data && !inAdmin && data.problems.length > 0 && current !== "connections" && current !== "data" && (
                  <div className="config-banner" role="alert">
                    <strong>{data.fromFile ? "The config file has problems, so only Connections and Data work here until it is fixed by hand." : "Your saved settings have problems, so only Connections and Data work here. Ask your FocusTime admin."}</strong>
                    <ul>
                      {data.problems.map((p) => (
                        <li key={p.field}>
                          <code>{p.field}</code> {p.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {inAdmin ? (
                  admin === null ? <p className="muted">Loading…</p> : <p className="muted">{NOT_ADMIN_TEXT}</p>
                ) : (
                  data &&
                  // SA-5: every section works on the phone; none is read-only there.
                  <SectionBody {...props} section={current} data={data} onSavedData={saved} reload={reload} client={client} go={go} />
                )}
              </>
            )}
          </PanelShell>
        );
      }}
    </AutoSaveProvider>
  );
}


function SectionBody(p: BodyProps) {
  switch (p.section) {
    default:
      return null;
    case "you":
      return <ProfileSection {...p} />;
    case "hours":
      return <HoursSection {...p} />;
    case "planning":
      return <PlanningSection {...p} />;
    case "focus":
      return <FocusSection {...p} />;
    case "notifications":
      return <NotificationsSection {...p} />;
    case "clients":
      return <ClientsSection {...p} />;
    case "client":
      return <ClientSection {...p} />;
    case "ai":
      return <AiSection {...p} />;
    case "connections":
      return <ConnectionsSection {...p} />;
    case "display":
      return <DisplaySection {...p} />;
    case "data":
      return <DataSection {...p} />;
    case "about":
      return <AboutSection onGuide={p.onGuide} go={p.go} />;
  }
}





