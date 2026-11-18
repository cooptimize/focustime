// Settings (step 6b): every setting FocusTime owns, read from and written to the same validated settings (a person's
// account, or the config file in the developer loop); each field saves itself (ui/settings/autosave.tsx). Values
// owned by Dataverse are shown read-only with where to change them. Secrets are entered in masked fields that go
// straight to the keyring; they are never shown again (only whether they are set, and an expiry date if entered).
import { FindItem } from "./settings/FindItem.tsx";
import { AzureWriteLog, LoopSendsLog, TeamsStatusLog, VmStartForm, YouAccount } from "./Account.tsx";
import { responseLabel } from "../plan/rsvp.ts";
import { DevOpsWriteLog } from "./DevOpsWrite.tsx";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { SettingsClient, SettingsData } from "../actions/types.ts";
import { MicrosoftPermissions } from "./settings/DeliveryChats.tsx";
import { AutoSaveProvider, SaveMark, useAutoSave, type AutoSave } from "./settings/autosave.tsx";
import type { ClientWork } from "../week/types.ts";
import { call } from "./api.ts";
import type { AiView } from "../ai/view.ts";
import { notConnected, SOURCE_NAMES, sourceActions, sourceKey, sourceLabel, stateOf } from "./status.ts";
import { CalendarLinks } from "./settings/CalendarLinks.tsx";
import { PocketRecorder } from "./settings/Pocket.tsx";
import { POCKET_WORDS } from "../plan/pocket-words.ts";
import { shortDate } from "./labels.ts";
import { useTimeboxes } from "./Timeboxes.tsx";
import type { WriteLogView } from "../actions/types.ts";
import type { WriteEntry } from "../plan/timebox.ts";
import { version as APP_VERSION } from "../package.json";
import { Lockup } from "./brand/Brand.tsx";
import { usePhone } from "./viewport.ts";
import { PhoneReadOnly } from "./Phone.tsx";
import { NEUTRAL_ZONE, userZone } from "../week/zone.ts";
import { WRITES_HREF, type FeedbackStatus } from "../actions/feedback-types.ts";
import { ADMIN_UI_SECTIONS, AdminSection, isAdminSection, RETIRED_ADMIN_SECTIONS, useAdmin } from "./settings/Admin.tsx";
import { PanelShell, useNarrow, type RailGroup } from "./PanelShell.tsx";
import { siteLine, useDeveloperLoop, useKnownEnv } from "./appenv.ts";
import { resolveSettings, searchSettings, sectionOf, SECTIONS, settingsHref, SETTINGS_GROUPS, type SearchHit } from "./settings/registry.ts";
import { DemoSection } from "./settings/Demo.tsx";
import { DiagnosticsPanel } from "./settings/Diagnostics.tsx";
import { ProfileSection } from "./settings/sections/Profile.tsx";
import { HoursSection } from "./settings/sections/Hours.tsx";
import { NotificationsSection } from "./settings/sections/Notifications.tsx";
import { DisplaySection } from "./settings/sections/Display.tsx";
import { DayWeekSection } from "./settings/sections/DayWeek.tsx";
import { FocusSection } from "./settings/sections/Focus.tsx";
import { BacklogSection } from "./settings/sections/Backlog.tsx";
import { ChatsSection } from "./settings/sections/Chats.tsx";
import { ClientSection, ClientsSection } from "./settings/sections/Clients.tsx";
import type { BodyProps, FormProps, Props } from "./settings/sections/types.ts";

/** ST-1: every section id Settings opens (the registry's, then Admin's, for admins only). */
export const SETTINGS_SECTIONS: readonly (readonly [string, string])[] = [...SECTIONS.map((s) => [s.id, s.label] as const), ...ADMIN_UI_SECTIONS];
export type SettingsSectionId = string;

/** Where an app-level value is changed when there is no config file here (hosted, signed in, the demo). */
const ADMIN = "Set by your FocusTime admin";

const DEVOPS_STATE: Record<ClientWork["status"], string> = { ok: "Live", identity_missing: "No identity", not_set_up: "Not set up", auth_failed: "PAT problem", no_access: "No access", unreachable: "Unreachable", error: "Error" };

/** ST-1: `sid` is the setting's id in the registry (ui/settings/registry.ts): search and deep links land on it. */
function Field({ label, children, hint, sid }: { label: string; children: ReactNode; hint?: ReactNode; sid?: string | undefined }) {
  return (
    <label className="set-field" data-setting={sid}>
      <span className="set-label">{label}</span>
      {children}
      {hint && <span className="set-hint">{hint}</span>}
    </label>
  );
}

function ReadOnly({ label, value, where, sid }: { label: string; value: ReactNode; where: string; sid?: string }) {
  return (
    <div className="set-field readonly" data-setting={sid}>
      <span className="set-label">{label}</span>
      <span className="set-value">{value || <span className="muted">not set</span>}</span>
      <span className="set-hint">{where}</span>
    </div>
  );
}

/** A group of settings under a heading, with the heading's own deep link when it is one setting. */
function Group({ title, sid, intro, children }: { title: string; sid?: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <section className="set-section" data-setting={sid} aria-label={title}>
      <h3>{title}</h3>
      {intro && <p className="muted set-intro">{intro}</p>}
      {children}
    </section>
  );
}

/** ST-1: the rail's search. Finds any setting by its label, an old label or a keyword; Enter opens the first. */
function SettingsSearch({ q, setQ, hits, onGo }: { q: string; setQ: (q: string) => void; hits: SearchHit[]; onGo: (h: SearchHit) => void }) {
  return (
    <div className="ps-search">
      <input
        type="search"
        value={q}
        placeholder="Search settings"
        aria-label="Search settings"
        aria-controls="settings-search-results"
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && q) {
            // The first Esc clears the search; the next closes Settings.
            e.preventDefault();
            e.nativeEvent.stopImmediatePropagation();
            setQ("");
          } else if (e.key === "Enter" && hits[0]) {
            e.preventDefault();
            onGo(hits[0]);
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            document.querySelector<HTMLElement>("#settings-search-results a")?.focus();
          }
        }}
      />
    </div>
  );
}

function SearchResults({ q, hits, onGo }: { q: string; hits: SearchHit[]; onGo: (h: SearchHit) => void }) {
  return (
    <div id="settings-search-results" className="ps-results" role="region" aria-label="Search results" aria-live="polite">
      {hits.length === 0 ? (
        <p className="muted ps-none">Nothing called “{q.trim()}”.</p>
      ) : (
        hits.map((h) => (
          <a
            key={`${h.section}/${h.setting ?? ""}`}
            className="ps-item ps-hit"
            href={settingsHref(h.section, h.setting)}
            onClick={(e) => (e.preventDefault(), onGo(h))}
            onKeyDown={(e) => {
              const el = e.currentTarget;
              if (e.key === "ArrowDown") (e.preventDefault(), (el.nextElementSibling as HTMLElement | null)?.focus());
              if (e.key === "ArrowUp") (e.preventDefault(), ((el.previousElementSibling as HTMLElement | null) ?? document.querySelector<HTMLElement>(".ps-search input"))?.focus());
            }}
          >
            <span>{h.label}</span>
            <span className="ps-hint">
              {h.where}
              {h.matched ? ` · was “${h.matched}”` : ""}
            </span>
          </a>
        ))
      )}
    </div>
  );
}

/** The section and setting an address opens: old ids mapped; "" is the rail (a list on the phone, Profile otherwise). */
function placeOf(section: string, setting: string | null | undefined, list: boolean, demo: boolean, admin: boolean | null): { current: string | null; setting: string | null } {
  if (section === "") return { current: list ? null : "you", setting: null };
  // TP-1b: a retired Admin page: Admin's first page, or Profile for someone who isn't an admin.
  if (RETIRED_ADMIN_SECTIONS.includes(section)) return { current: admin === false ? "you" : ADMIN_UI_SECTIONS[0][0], setting: null };
  if (isAdminSection(section)) return { current: section, setting: null };
  const r = resolveSettings(section, setting);
  if (!r || (sectionOf(r.section)?.demoOnly && !demo)) return { current: "you", setting: null };
  return { current: r.section, setting: r.setting };
}

export function Settings(props: Props) {
  const [data, setData] = useState<SettingsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  // A jump to a setting is owed once, until it lands or the person moves on (see the effect below).
  const jumpDue = useRef(false);
  const phone = usePhone();
  const list = useNarrow() || phone;
  const admin = useAdmin();
  const devLoop = useDeveloperLoop();
  const { current, setting } = placeOf(props.section, props.setting, list, props.demo, admin);
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
  useEffect(() => {
    if (!setting || current === "client") return;
    jumpDue.current = true;
    const moved = () => void (jumpDue.current = false);
    for (const e of ["focusin", "pointerdown", "keydown"]) document.addEventListener(e, moved, true);
    return () => {
      for (const e of ["focusin", "pointerdown", "keydown"]) document.removeEventListener(e, moved, true);
    };
  }, [current, setting]);
  // A deep link to one setting: into view with a brief highlight, focus on its first control. Waits for the section's
  // data the first time; a later reload of that data (a save, a late response) doesn't do it again.
  useEffect(() => {
    if (!data || !setting || current === "client") return;
    const t = setTimeout(() => {
      if (!jumpDue.current) return;
      const el = document.querySelector<HTMLElement>(`.ps-body [data-setting="${CSS.escape(setting)}"]`);
      if (!el) return;
      jumpDue.current = false;
      el.scrollIntoView?.({ block: "start" });
      el.classList.remove("ps-flash");
      void el.offsetWidth;
      el.classList.add("ps-flash");
      el.querySelector<HTMLElement>("input:not([disabled]), select:not([disabled]), textarea, button:not([disabled]), a[href]")?.focus({ preventScroll: true });
      setTimeout(() => el.classList.remove("ps-flash"), 2200);
    }, 60);
    return () => clearTimeout(t);
  }, [data, current, setting]);
  const saved = useCallback(
    (d: SettingsData) => {
      setData(d);
      props.onSaved();
    },
    [props.onSaved], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const inAdmin = current !== null && isAdminSection(current);
  const def = current ? sectionOf(current) : undefined;
  const client = current === "client" ? (data?.clients.find((c) => c.key === setting) ?? null) : null;
  const clientName = (c: SettingsClient) => c.setting.name ?? c.dataverseName ?? c.key;
  const title = inAdmin ? `Admin › ${ADMIN_UI_SECTIONS.find(([id]) => id === current)![1]}` : current === "client" ? (client ? clientName(client) : (setting ?? "Client")) : (def?.label ?? "Settings");
  const description = inAdmin ? "Team settings for everyone in FocusTime. Changes save as you make them and are logged in Admin › Audit." : def?.description;
  const hits = q.trim() ? searchSettings(q, { demo: props.demo, dev: devLoop }) : [];
  const groups: RailGroup[] = [
    ...SETTINGS_GROUPS.map(([g, label]) => ({
      id: g,
      label,
      items: SECTIONS.filter((s) => s.group === g && !s.parent && (!s.demoOnly || props.demo)).map((s) => ({ id: s.id, label: s.label, href: settingsHref(s.id) })),
    })),
    ...(admin ? [{ id: "admin", label: "Admin", items: ADMIN_UI_SECTIONS.map(([id, label]) => ({ id, label, href: settingsHref(id) })) }] : []),
  ];
  return (
    <AutoSaveProvider onNotice={props.onNotice}>
      {(leave) => {
        const go = (section: string, s?: string | null) => leave(() => (setQ(""), props.onSection(section, s ?? null)));
        return (
          <PanelShell
            name="Settings"
            className="settings"
            groups={groups}
            current={current}
            railCurrent={current === "client" ? "clients" : current}
            onPick={(id) => go(id)}
            onClose={() => leave(props.onClose)}
            onBack={current === "client" ? () => go("clients") : list && current !== null ? () => go("") : null}
            backLabel={current === "client" ? "Clients" : "Settings"}
            title={title}
            description={description}
            railTop={<SettingsSearch q={q} setQ={setQ} hits={hits} onGo={(h) => go(h.section, h.setting)} />}
            railOverride={q.trim() ? <SearchResults q={q} hits={hits} onGo={(h) => go(h.section, h.setting)} /> : undefined}
            phone={list}
            pageKey={`${current}/${current === "client" ? setting : ""}`}
          >
            {current !== null && (
              <>
                {error && <p className="field-problem">{error}</p>}
                {data && !inAdmin && data.problems.length > 0 && current !== "connections" && current !== "devops" && current !== "data" && current !== "activity" && (
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
                  <AdminSection id={current as Parameters<typeof AdminSection>[0]["id"]} admin={admin} />
                ) : (
                  data &&
                  (phone && def?.phoneReadOnly ? (
                    <PhoneReadOnly line="Changing these works best on a bigger screen">
                      <SectionBody {...props} section={current} data={data} onSavedData={saved} reload={reload} client={client} go={go} />
                    </PhoneReadOnly>
                  ) : (
                    <SectionBody {...props} section={current} data={data} onSavedData={saved} reload={reload} client={client} go={go} />
                  ))
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
  const dev = useDeveloperLoop();
  switch (p.section) {
    default:
      return null;
    case "you":
      return <ProfileSection {...p} />;
    case "hours":
      return <HoursSection {...p} />;
    case "planning":
      return <DayWeekSection {...p} />;
    case "focus":
      return <FocusSection {...p} />;
    case "notifications":
      return <NotificationsSection {...p} />;
    case "ahead":
      return <BacklogSection {...p} />;
    case "clients":
      return <ClientsSection {...p} />;
    case "client":
      return <ClientSection {...p} />;
    case "chats":
      return <ChatsSection {...p} />;
    case "ai":
      return (
        <>
          <AiForm {...p} />
          <Group title="Assistant" sid="assistant-history">
            <div className="set-grid">
              <ClearAssistant />
            </div>
          </Group>
        </>
      );
    case "connections":
      return <Connections {...p} />;
    case "devops":
      return <DevOpsSection {...p} />;
    case "display":
      return <DisplaySection {...p} />;
    case "activity":
      return <ActivitySection {...p} />;
    case "data":
      return <DataSection {...p} />;
    case "about":
      // Step 17.5: the lockup, the version and the credit line (BR-1: the lockup is the week mark's).
      return (
        <div className="brand-about">
          <Lockup />
          <p data-setting="version">Version {APP_VERSION}</p>
          <SiteLine />
          <p className="set-hint">FocusTime is made by Cooptimize, for planning a week of client work.</p>
          <div className="set-grid">
            <div className="set-field" data-setting="guide">
              <span className="set-label">Guide</span>
              <button type="button" className="mini" onClick={() => p.onGuide?.()}>
                Open the Guide
              </button>
              <span className="set-hint">How FocusTime works, the keys and the questions people ask.</span>
            </div>
            {dev && (
              <div className="set-field" data-setting="style-guide">
                <span className="set-label">Style guide</span>
                <a href="/styleguide" target="_blank" rel="noopener">
                  Open the style guide
                </a>
                <span className="set-hint">Tokens and components in each theme (developer loop).</span>
              </div>
            )}
          </div>
        </div>
      );
  }
}



/** A field that saves itself: its input (from `children`), "Saved" or "Couldn't save. Retry" by it, an error under it. */
/** ST-1: a field's key → its setting id in the registry, where the two differ only in name. */
const SID: Record<string, string> = {
  lunch: "lunch", tz: "time-zone", draftStories: "break-down-offered", readinessNudges: "readiness-nudges", carryDays: "carry-over",
  reminderOffsetMinutes: "plan-reminder", devopsOnDone: "devops-on-done", progressOffer: "progress-offer", suggest: "suggest-empty-blocks", checkinReminderMinutes: "checkin-reminder", closeoutReminderMinutes: "closeout-reminder",
  followGraceDays: "follow-grace", focusMinutes: "focus-length", breakMinutes: "break-length", endSound: "end-sound", enabled: "timeboxing", outlookDefault: "outlook-default",
  confirmOwn: "confirm-own", meetingMinutes: "help-length", teams: "help-teams", daysAhead: "help-days", exclude: "exclude", teamsStatus: "teams-status",
  plainFocusStatus: "plain-focus-status", sound: "sound", volume: "volume", fadeSeconds: "fade", onBreak: "on-break", pauseMedia: "pause-media", staleWeeks: "stale-weeks",
  stalledDays: "stalled-days", watchWeeks: "watch-weeks", requestPhrases: "request-phrases", ackPhrases: "ack-phrases", promisePhrases: "promise-phrases",
  status: "status-report-times", asksThroughFocus: "urgent-during-focus", quiet: "quiet", quietPto: "quiet-pto", pushDetails: "push-details", teamsMessages: "teams-messages", fromTestSite: "from-test-site",
  draftMonths: "draft-months", startWithoutAsking: "vm-start",
};

function AutoField<V>({ a, k, label, hint, children, sid }: { a: AutoSave<V>; k: keyof V; label: string; hint?: ReactNode; children: ReactNode; sid?: string | undefined }) {
  return (
    <Field label={label} hint={hint} sid={sid ?? SID[String(k)]}>
      {children}
      <SaveMark s={a.status(k)} retry={() => a.commit(k)} />
    </Field>
  );
}


/** Settings > Notifications (step 15.5): a switch per kind, quiet hours, held during focus, a test. */
type TeamsStatus = { available: boolean; chat: boolean; blocked: boolean };

/** TB-2: whether FocusTime can reach me in Teams: the hosted app only, after my first message, unless Teams refused it. */
function TeamsStatusLine({ always = false }: { always?: boolean } = {}) {
  const [st, setSt] = useState<TeamsStatus | null>(null);
  useEffect(() => void call<TeamsStatus>("teams.status", {}).then(setSt, () => setSt(null)), []);
  if (!st) return always ? <p className="muted">Checking…</p> : null;
  if (!st.available) return <p className="muted">FocusTime in Teams runs in the hosted app. Here it can't send anything.</p>;
  if (st.blocked) return <p className="set-warn" role="status">FocusTime can't message you in Teams. Add the app again.</p>;
  if (!st.chat) return <p className="muted">Message FocusTime in Teams once, so it knows where to reach you.</p>;
  return always ? <p>Connected: FocusTime can reach you in your chat with it.</p> : null;
}

/** ST-1: DevOps: each client's read status (from the week's fetch) and my own write access per client. */
function DevOpsSection(p: BodyProps) {
  const d = p.data;
  const withDevOps = d.clients.filter((c) => c.devops);
  return (
    <div className="set-form">
      <Group title="Reading" sid="devops-read" intro="FocusTime reads with the company PAT from Dataverse, only when fetching; it is never shown.">
        {p.devops && p.devops.length > 0 ? (
          <ul className="set-list sources">
            {p.devops.map((c) => {
              const ok = c.status === "ok";
              const cls = ok ? (c.fromCache ? "cached" : "live") : "error";
              return (
                <li key={c.clientKey} className={`source ${cls}`}>
                  <span className="dot" aria-hidden="true" />
                  <strong>{c.clientName}</strong>
                  <span className={`state ${cls}`}>{ok ? (c.fromCache ? "Cached" : "Live") : DEVOPS_STATE[c.status]}</span>
                  <span className="muted">
                    {ok ? `${c.items.length} ${c.items.length === 1 ? "item" : "items"} assigned` : c.message}
                    {c.status === "auth_failed" || c.status === "not_set_up" || c.status === "identity_missing" ? ". Change it in Dataverse" : ""}
                  </span>
                  <span className="row-actions">
                    <button type="button" className="mini" disabled={p.loading} onClick={p.onRefresh}>
                      {p.loading ? "Retrying…" : "Retry"}
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="muted">No DevOps yet. It comes from each followed client's record in Dataverse.</p>
        )}
      </Group>
      <Group title="Write access" sid="devops-write" intro="Your own PAT per client, with Work Items (Read & write). FocusTime checks it is yours, keeps it sealed and never shows it again.">
        {withDevOps.length === 0 ? (
          <p className="muted">No client has DevOps set up in Dataverse.</p>
        ) : (
          withDevOps.map((c) => <WriteAccess key={c.key} client={c} onDone={p.reload} />)
        )}
      </Group>
      <Group title="Find an item" sid="find-item" intro="Why an item isn't showing: whether FocusTime's last check of DevOps found it, the scope, and where it shows. It answers from what FocusTime already read; Refresh checks DevOps now.">
        <FindItem clients={withDevOps.map((c) => ({ key: c.key, name: c.setting.name ?? c.dataverseName ?? c.key }))} />
      </Group>
    </div>
  );
}

type AiTestResult = { ok: true; latencyMs: number; cost: string; model: string } | { ok: false; kind: string; message: string };

/** AI-0, ADM-1: Settings › AI: the team's AI values read-only (Admin › AI sets them), this month's spend, Test AI, what is sent, and the last 20 requests. */
function AiForm(p: FormProps) {
  const s = p.data.ai;
  const a = useAutoSave({
    section: "ai",
    initial: { draftMonths: s.draftMonths ?? 12 },
    payload: (v) => v,
    onSaved: p.onSavedData,
    label: () => "Break down looks back",
  });
  const [st, setSt] = useState<AiView | null>(null);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<AiTestResult | null>(null);
  const load = useCallback(() => call<AiView | null>("ai.status", {}).then(setSt, () => setSt(null)), []);
  const rules = p.data.aiRules;
  useEffect(() => void load(), [load, rules.on, rules.personCapUsd]);
  const nameOf = (k: string | null) => (k ? (p.data.clients.find((c) => c.key === k)?.setting.name ?? k) : "None");
  const runTest = async () => {
    setTesting(true);
    setTest(null);
    try {
      setTest(await call<AiTestResult>("ai.test", {}));
    } catch (e) {
      setTest({ ok: false, kind: "provider", message: e instanceof Error ? e.message : "Test AI didn't run" });
    } finally {
      setTesting(false);
      void load();
    }
  };
  const notSetUp = st !== null && !st.setUp;
  return (
    <div className="set-form set-ai">
      <div className="set-grid" data-setting="ai-team">
        <ReadOnly label="AI for FocusTime" value={rules.on ? "On" : "Off"} where={ADMIN} />
        <ReadOnly
          label="Allowed for"
          value={rules.allowedClients.length ? rules.allowedClients.map((k) => nameOf(k)).join(", ") : "No clients yet"}
          where={ADMIN}
        />
        <ReadOnly label="Your monthly limit" value={rules.personCapUsd === 0 ? "AI budget is set to $0" : `$${rules.personCapUsd}`} where={ADMIN} />
      </div>
      {(st === null || notSetUp) && (
        <p className="set-problem" role="status">
          AI isn't set up for this FocusTime yet{st?.provider === "off" ? ": it's turned off" : ""}. Everything else works without it.
        </p>
      )}
      <div className="set-ai-month" data-setting="ai-month">
        <span className="set-ai-label">This month</span>
        <strong>
          {st ? st.spentText : "$0"} of {st ? st.capText : `$${rules.personCapUsd}`}
        </strong>
        {st?.zeroBudget ? <span className="field-problem">AI budget is set to $0</span> : st?.appReached && <span className="field-problem">FocusTime's AI budget for everyone is used up until next month.</span>}
      </div>
      <AutoField a={a} k="draftMonths" label="Break down looks back (months)" hint="Examples come from the same client's features changed in this many months, 1 to 36.">
        <input type="number" min={1} max={36} step={1} value={a.v.draftMonths} onChange={(e) => a.set("draftMonths", Number(e.target.value))} {...a.text("draftMonths")} />
      </AutoField>
      <div className="set-ai-test" data-setting="ai-test">
        <button type="button" className="mini" disabled={testing} onClick={() => void runTest()}>
          {testing ? "Testing…" : "Test AI"}
        </button>
        {test && (test.ok ? <span className="set-ai-ok" role="status">OK · {(test.latencyMs / 1000).toFixed(1)} s · {test.cost}</span> : <span className="field-problem" role="status">{test.message}</span>)}
        <span className="set-hint">Sends one fixed request with no client data.</span>
      </div>
      <details className="set-ai-sent" data-setting="ai-sent">
        <summary>What is sent</summary>
        <p className="muted">
          Only what a task needs, about one client at a time, and only for clients a FocusTime admin allowed. Before anything goes, FocusTime checks it: another client's name, project or work item, anything that looks like a key, token or password, your VM, or an email address from outside Cooptimize stops the request. The AI service is asked not to keep requests, and FocusTime's log keeps only the counts and the cost below, never the text.
        </p>
      </details>
      <h3 className="set-ai-h" data-setting="ai-log">Last 20 requests</h3>
      {st && st.recentText.length ? (
        <table className="set-ai-log">
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">Task</th>
              <th scope="col">Client</th>
              <th scope="col">Cost</th>
              <th scope="col">Result</th>
            </tr>
          </thead>
          <tbody>
            {st.recentText.map((r, i) => (
              <tr key={i}>
                <td>{fmtAiTime(r.at)}</td>
                <td>{AI_TASK_NAMES[r.task] ?? r.task}</td>
                <td>{nameOf(r.client)}</td>
                <td>{r.cost}</td>
                <td className={r.outcome === "OK" ? "" : "field-problem"}>{r.outcome}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted">No AI requests yet.</p>
      )}
    </div>
  );
}

/** Names for the task names the log keeps. */
const AI_TASK_NAMES: Record<string, string> = { test_ai: "Test AI", "asks.classify": "Sort an ask", "promises.extract": "Read a promise", "stories.draft": "Break down", "meeting.capture": "Read a client call" };
const fmtAiTime = (iso: string) => (iso ? new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");

function Connections(p: BodyProps) {
  return (
    <div className="set-form">
      <Group title="Sources" sid="sources">
      <ul className="set-list sources">
        {p.sources.map((s) => {
          const st = stateOf(s);
          const acts = sourceActions(s);
          const cal = s.source === "outlook" || s.source === "google" ? s.source : null;
          return (
            <li key={sourceKey(s)} className={`source ${st.cls}`}>
              <span className="dot" aria-hidden="true" />
              <strong>{sourceLabel(s)}</strong>
              <span className={`state ${st.cls}`}>{st.label}</span>
              <span className="muted">{s.message ?? (s.sample || notConnected(s) ? "" : `${s.itemCount} ${s.itemCount === 1 ? "item" : "items"}`)}</span>
              <span className="row-actions">
                <button type="button" className="mini" disabled={p.loading} onClick={p.onRefresh}>
                  {p.loading ? "Retrying…" : "Retry"}
                </button>
                {cal && (acts.includes("connect") || acts.includes("reconnect")) && (
                  <button type="button" className="mini primary" disabled={p.busy !== null} onClick={() => p.onConnect(cal)}>
                    {p.busy === cal ? "Waiting for sign-in…" : acts.includes("connect") ? "Connect" : "Reconnect"}
                  </button>
                )}
                {cal && acts.includes("disconnect") && (
                  <button type="button" className="mini quiet" disabled={p.busy !== null} onClick={() => p.onDisconnect(cal)}>
                    Disconnect
                  </button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {p.reconnected && (
        <p className="reconnect-line" role="status">
          {SOURCE_NAMES[p.reconnected]} is connected again.
        </p>
      )}
      </Group>
      <Group title="Calendars added by link" sid="calendar-links">
        <CalendarLinks timeZone={Temporal.Now.timeZoneId()} onChanged={p.onRefresh} />
      </Group>
      <Group title={POCKET_WORDS.title} sid="pocket">
        <PocketRecorder timeZone={Temporal.Now.timeZoneId()} />
      </Group>
      <div data-setting="outlook-changes"><OutlookWriteRow /></div>
      <div data-setting="permissions"><MicrosoftPermissions /></div>
      <Group title="My VM">
        <YouAccount part="vm" />
        <VmStartForm />
      </Group>
      <Group title="FocusTime in Teams" sid="teams-app">
        <TeamsStatusLine always />
        <p className="set-fix">
          <a href={settingsHref("notifications", "teams-messages")} onClick={(e) => (e.preventDefault(), p.go("notifications", "teams-messages"))}>
            What FocusTime may send you in Teams
          </a>
          {" · "}
          <a href={settingsHref("focus", "teams-status")} onClick={(e) => (e.preventDefault(), p.go("focus", "teams-status"))}>
            Your Teams status while you focus
          </a>
        </p>
      </Group>
      <div data-setting="feedback"><FeedbackRow go={p.go} /></div>
    </div>
  );
}

/**
 * Step 14: DevOps write access per client. A masked field for my own PAT; the server checks it belongs to my DevOps
 * identity there before keeping it in the keyring. The PAT is never shown again, and never sent anywhere else.
 */
function WriteAccess({ client: c, onDone }: { client: SettingsData["clients"][number]; onDone: () => Promise<void> }) {
  const ref = useRef<HTMLInputElement>(null);
  const [expires, setExpires] = useState(c.write?.expires ?? "");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const w = c.write;
  const daysLeft = w?.expires ? Temporal.PlainDate.from(w.expires).since(Temporal.Now.plainDateISO()).days : null;
  return (
    <form
      className="set-row secret devops-write"
      autoComplete="off"
      aria-label={`DevOps write access for ${c.setting.name ?? c.key}`}
      onSubmit={async (e) => {
        e.preventDefault();
        const value = ref.current?.value ?? "";
        const input: Record<string, unknown> = { clientKey: c.key };
        if (value) input.pat = value;
        if (expires !== (w?.expires ?? "")) input.expires = expires || null;
        if (Object.keys(input).length === 1) return setStatus("Nothing to save");
        setBusy(true);
        setStatus(value ? "Checking whose PAT this is…" : null);
        try {
          await call("devops.set_write_pat", input);
          setStatus(value ? "Checked and saved to the keyring" : "Expiry date saved");
          await onDone();
        } catch (err) {
          setStatus(err instanceof Error ? err.message : "Not saved");
        } finally {
          if (ref.current) ref.current.value = "";
          setBusy(false);
        }
      }}
    >
      <strong>DevOps write access for {c.setting.name ?? c.dataverseName ?? c.key}</strong>
      <span className={`state ${w ? "live" : "muted"}`}>{w ? "On" : "Off, read-only"}</span>
      {w ? (
        <span className="muted">
          as {w.name} ({w.email}) on {w.org}
          {w.expires ? `, expires ${shortDate(w.expires)}` : ""}
        </span>
      ) : (
        <span className="muted">Your own PAT with Work Items (Read &amp; write).</span>
      )}
      {w?.expires && daysLeft !== null && daysLeft < 14 && <span className="field-problem">Expires in {Math.max(0, daysLeft)} days</span>}
      <input ref={ref} type="password" autoComplete="new-password" spellCheck={false} placeholder={w ? "New PAT to replace it" : "Paste your PAT"} aria-label={`DevOps write PAT for ${c.setting.name ?? c.key} (masked)`} />
      <label className="set-inline">
        <span className="muted">Expires (optional)</span>
        <input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} title="DevOps doesn't tell FocusTime the expiry; copy it from the PAT page" />
      </label>
      <button type="submit" className="mini primary" disabled={busy}>
        {busy ? "Checking…" : "Check and save"}
      </button>
      {w && (
        <button
          type="button"
          className="mini quiet"
          disabled={busy}
          onClick={async () => {
            await call("devops.clear_write_pat", { clientKey: c.key }).catch(() => null);
            setStatus("Turned off. The PAT was removed from the keyring");
            await onDone();
          }}
        >
          Turn off
        </button>
      )}
      {status && (
        <span className="muted" role="status">
          {status}
        </span>
      )}
    </form>
  );
}

/** EV-1: which site this is, in a word, and its address ("Site: Dev · focustime-dev.example.com"); nothing until /version answers, nothing when it fails. */
function SiteLine() {
  const env = useKnownEnv();
  if (!env) return null;
  return <p className="set-hint" data-site-line>Site: {siteLine(env, location.host)}</p>;
}

/** Reset local plan (Q37): type "reset" to confirm; the server backs the store up first. */
function ResetPlan({ disabled, onDone }: { disabled: boolean; onDone: () => void }) {
  const [asking, setAsking] = useState(false);
  const [typed, setTyped] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  return (
    <div className="set-field" data-setting="reset-plan">
      <span className="set-label">Reset my plan</span>
      {asking ? (
        <form
          className="set-inline"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              const r = await call<{ backup: string | null }>("plan.reset", { confirm: typed.trim() });
              setStatus(`Done. The plan store was backed up first${r.backup ? ` (${r.backup})` : ""}.`);
              setAsking(false);
              setTyped("");
              onDone();
            } catch (err) {
              setStatus(err instanceof Error ? err.message : "Not reset");
            }
          }}
        >
          <input autoFocus value={typed} placeholder='Type "reset"' aria-label='Type "reset" to confirm' onChange={(e) => setTyped(e.target.value)} />
          <button type="submit" className="mini danger" disabled={typed.trim() !== "reset"}>
            Reset
          </button>
          <button type="button" className="mini" onClick={() => setAsking(false)}>
            Cancel
          </button>
        </form>
      ) : (
        <button type="button" className="mini" disabled={disabled} onClick={() => { setAsking(true); setStatus(null); }}>
          Reset…
        </button>
      )}
      <span className="set-hint">{status ?? "Empties the plan store after a full backup. Settings and calendars stay."}</span>
    </div>
  );
}

/** A2: Export my data: everything FocusTime keeps for the signed-in person, downloaded as one JSON file. */
function ExportMine() {
  const [status, setStatus] = useState<string | null>(null);
  return (
    <div className="set-field" data-setting="export">
      <span className="set-label">Export my data</span>
      <button
        type="button"
        className="mini"
        onClick={async () => {
          try {
            setStatus("Preparing…");
            const r = await call<{ fileName: string; export: unknown }>("data.export_mine", {});
            const url = URL.createObjectURL(new Blob([`${JSON.stringify(r.export, null, 2)}\n`], { type: "application/json" }));
            const a = document.createElement("a");
            a.href = url;
            a.download = r.fileName;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 10_000);
            setStatus(`Downloaded ${r.fileName}`);
          } catch (e) {
            setStatus(e instanceof Error ? e.message : "Export failed");
          }
        }}
      >
        Download JSON
      </button>
      <span className="set-hint">{status ?? "Your plans, promises, captures, logs and settings. Never a password or token."}</span>
    </div>
  );
}

/** AS-1: the assistant keeps 30 days of what I asked and its answers, for me only (in Export, never shown to admins). */
function ClearAssistant() {
  const [asking, setAsking] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  return (
    <div className="set-field">
      <span className="set-label">Assistant history</span>
      {asking ? (
        <span className="set-inline">
          <button
            type="button"
            className="mini primary"
            onClick={async () => {
              try {
                const r = await call<{ removed: number }>("assistant.clear", { confirm: true });
                setStatus(r.removed ? `Cleared ${r.removed} ${r.removed === 1 ? "entry" : "entries"}` : "Nothing to clear");
              } catch (e) {
                setStatus(e instanceof Error ? e.message : "Couldn't clear it");
              }
              setAsking(false);
            }}
          >
            Clear it
          </button>
          <button type="button" className="mini" onClick={() => setAsking(false)}>Keep it</button>
        </span>
      ) : (
        <button type="button" className="mini" onClick={() => (setAsking(true), setStatus(null))}>Clear</button>
      )}
      <span className="set-hint">{status ?? "What you asked the assistant and its answers, kept 30 days. Only you see it; it is in Export my data."}</span>
    </div>
  );
}

/** A2: Delete my data: signs out and deletes everything kept for this person (kept 30 days, then removed for good). */
function DeleteMine() {
  const [asking, setAsking] = useState(false);
  const [typed, setTyped] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  return (
    <div className="set-field" data-setting="delete">
      <span className="set-label">Delete my data</span>
      {asking ? (
        <form
          className="set-inline set-delete"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await call("data.delete_mine", { confirm: "delete" });
              location.replace("/?signin=deleted");
            } catch (err) {
              setStatus(err instanceof Error ? err.message : "Not deleted");
            }
          }}
        >
          <input autoFocus value={typed} placeholder='Type "delete"' aria-label='Type "delete" to confirm' onChange={(e) => setTyped(e.target.value)} />
          <button type="submit" className="mini danger" disabled={typed.trim() !== "delete"}>
            Delete
          </button>
          <button type="button" className="mini" onClick={() => setAsking(false)}>
            Cancel
          </button>
        </form>
      ) : (
        <button type="button" className="mini" onClick={() => { setAsking(true); setStatus(null); }}>
          Delete…
        </button>
      )}
      <span className="set-hint">
        {status ??
          (asking
            ? "Export first if you want a copy. You'll be signed out and can't sign in again. Everything is removed for good after 30 days. Outlook events, DevOps changes and your VM's schedule that FocusTime already made stay as they are."
            : "Signs you out and deletes everything FocusTime keeps for you.")}
      </span>
    </div>
  );
}

/** ST-1: Activity: every change FocusTime made in other apps (was the top of Data). */
function ActivitySection(p: BodyProps) {
  return (
    <div className="set-form">
      <div data-setting="write-log"><WriteLog /></div>
      <div data-setting="devops-log"><DevOpsWriteLog /></div>
      <div data-setting="azure-log"><AzureWriteLog tz={userZone(p.data.you)} /></div>
      <div data-setting="teams-log"><TeamsStatusLog tz={userZone(p.data.you)} /></div>
      <div data-setting="loop-log"><LoopSendsLog tz={userZone(p.data.you)} /></div>
    </div>
  );
}

function DataSection(p: BodyProps) {
  const dev = useDeveloperLoop();
  return (
    <div className="set-form">
      <div className="set-grid">
        <ExportMine />
        <ResetPlan disabled={!p.data.data.planStore} onDone={p.onSaved} />
        <DeleteMine />
      </div>
      <div data-setting="diagnostics"><DiagnosticsPanel /></div>
      {(dev || p.demo) && (
        <Group title="Demo" intro="Fictional data; your own plan isn't touched.">
          {/* ST-1: the switch works only in the developer loop (the hosted demo is "Try the demo" at sign-in). */}
          {dev && (
            <div className="set-grid">
              <fieldset className="set-choice" data-setting="demo-mode">
                <legend>Demo mode</legend>
                <label>
                  <input type="checkbox" checked={p.demo} onChange={(e) => p.setDemo(e.target.checked)} /> Show demo data
                </label>
              </fieldset>
            </div>
          )}
          {p.demo && (
            <div data-setting="demo-reset">
              <DemoSection />
            </div>
          )}
          {p.demo && (
            <div data-setting="demo-be">
              <DemoPerson />
            </div>
          )}
        </Group>
      )}
    </div>
  );
}

/**
 * DP-3: in the demo, see FocusTime as one of its teammates who use it (their own plan, with what is shared with them),
 * or as yourself again: a second signed-in person, so a shared deployment can be tried from both sides.
 */
function DemoPerson() {
  const [st, setSt] = useState<{ current: string; people: { id: string; name: string }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => void call<{ current: string; people: { id: string; name: string }[] }>("demo.be", {}).then(setSt, (e: unknown) => setError(e instanceof Error ? e.message : "Couldn't check")), []);
  const choose = async (who: string) => {
    try {
      await call("demo.be", { who });
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work");
    }
  };
  return (
    <fieldset className="set-choice">
      <legend>See the demo as</legend>
      <select value={st?.current ?? "me"} disabled={!st} onChange={(e) => void choose(e.target.value)} aria-describedby="demo-be-hint">
        {(st?.people ?? []).map((x) => (
          <option key={x.id} value={x.id}>{x.id === "me" ? `${x.name} (you)` : x.name}</option>
        ))}
      </select>
      <p className="set-hint" id="demo-be-hint">{error ?? "A teammate who uses FocusTime, with their own plan: a deployment you add them to shows there."}</p>
    </fieldset>
  );
}

/** F1, FB-1: Send feedback's setup for me: my own write PAT for the feedback project's client, and the parent there. */
function FeedbackRow({ go }: { go: (section: string, setting?: string | null) => void }) {
  const [st, setSt] = useState<FeedbackStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = (fresh: boolean) => call<FeedbackStatus>("feedback.status", fresh ? { fresh: true } : {}).then((r) => (setSt(r), setError(null)), (e: unknown) => setError(e instanceof Error ? e.message : "Couldn't check"));
  useEffect(() => void load(false), []);
  return (
    <div className="set-write feedback-setup">
      <h3>Send feedback</h3>
      <p>{error ?? (st ? st.line : "Checking…")}</p>
      {st?.setup.state === "no_pat" && (
        <a className="mini primary" href={WRITES_HREF} onClick={(e) => (e.preventDefault(), go("devops", "devops-write"))}>
          Turn on DevOps writes
        </a>
      )}
      {st && (
        <button type="button" className="mini" onClick={() => void load(true)}>
          Check again
        </button>
      )}
      <p className="set-hint">{st ? `${st.destination}. ${st.sentToday} of ${st.limit} sent today.` : ""}</p>
    </div>
  );
}

/** Settings > Connections (step 12): whether FocusTime may change its own Outlook events, and how to allow it. */
function OutlookWriteRow() {
  const env = useTimeboxes();
  useEffect(() => env?.loadAccess(), []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!env) return null;
  const a = env.access;
  return (
    <div className="set-write">
      <h3>Outlook calendar changes</h3>
      <p>
        {!a ? "Checking…" : a.access === "write" ? "Allowed: FocusTime can create, change and remove the Outlook events it created (timeboxes), each after a preview. It can't change any other event." : a.message}
      </p>
      {a && a.access !== "write" && a.access !== "not_set_up" && (
        <button type="button" className="mini primary" onClick={env.connectWrite}>
          Reconnect Outlook with calendar changes
        </button>
      )}
      <p className="set-hint">Asks for Calendars.ReadWrite only when you reconnect here.</p>
    </div>
  );
}

const OPS: Record<WriteEntry["op"], string> = { create: "Created", update: "Changed", delete: "Removed" };
const KINDS: Record<WriteEntry["kind"], string | null> = { timebox: null, event: "Your event", invite: "Help invite", sync: "From Outlook", rsvp: "Response" };
const STATUS: Record<WriteEntry["status"], string> = { pending: "Not finished", confirmed: "Confirmed", unconfirmed: "Not confirmed", failed: "Failed", refused: "Refused" };
/** Settings > Data (step 12): every external write, newest first, with Undo and Retry; and FocusTime events left on Outlook. */
function WriteLog() {
  const env = useTimeboxes();
  const [log, setLog] = useState<WriteLogView | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    call<WriteLogView>("write.log", {}).then(setLog, (e: unknown) => setError(e instanceof Error ? e.message : "The write log could not load"));
  }, [env?.timeboxes]);
  const tz = env?.tz ?? NEUTRAL_ZONE;
  const stamp = (s: string) => Temporal.ZonedDateTime.from(s).withTimeZone(tz).toPlainDateTime().toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return (
    <section className="write-log" aria-label="Write log">
      <h3>Write log</h3>
      <p className="muted">Every change FocusTime made in other apps.</p>
      {error && <p className="set-problem">{error}</p>}
      {log && log.orphans.length > 0 && (
        <div className="wl-orphans">
          <h4>FocusTime events with no timebox</h4>
          <ul>
            {log.orphans.map((o) => (
              <li key={o.uid}>
                <span>{o.title}</span> <span className="muted">{o.when}</span>{" "}
                <button type="button" className="mini" onClick={() => void env?.sync(o.uid)}>Remove from Outlook</button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {log && !log.entries.length && <p className="muted">Nothing written yet.</p>}
      {log && log.entries.length > 0 && (
        <table className="wl-table">
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">What</th>
              <th scope="col">Where</th>
              <th scope="col">Result</th>
              <th scope="col">Before</th>
              <th scope="col"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {log.entries.map((e) => (
              <tr key={e.id} className={`wl-${e.status}`}>
                <td>{stamp(e.at)}</td>
                <td>
                  {KINDS[e.kind] && <span className={`wl-kind wl-kind-${e.kind}`}>{KINDS[e.kind]}</span>}{" "}
                  {e.undoOf !== null ? "Undo: " : ""}
                  {e.kind === "sync" ? (e.message ?? OPS[e.op]).replace(/^From Outlook: /, "") : e.kind === "rsvp" ? `${responseLabel(e.after?.response)} to` : OPS[e.op]} <strong>{(e.after ?? e.before)?.subject ?? ""}</strong>
                  {e.whenText && <span className="muted"> · {e.whenText}</span>}
                  {e.auto && e.kind !== "sync" && <span className="muted"> · without asking</span>}
                </td>
                <td>Outlook{e.calendar ? ` · ${e.calendar}` : ""}{e.account ? ` · ${e.account}` : ""}</td>
                <td>
                  {STATUS[e.status]}
                  {e.undoneBy !== null && <span className="muted"> · undone</span>}
                  {e.attempts > 1 && <span className="muted"> · {e.attempts} tries</span>}
                  {e.message && e.status !== "confirmed" && <div className="muted">{e.message}</div>}
                </td>
                <td className="muted">{e.kind === "rsvp" ? responseLabel(e.before?.response) : e.before ? `${e.before.subject}, ${Temporal.Instant.from(e.before.start).toZonedDateTimeISO(tz).toPlainTime().toLocaleString("en-US", { hour: "numeric", minute: "2-digit" })} to ${Temporal.Instant.from(e.before.end).toZonedDateTimeISO(tz).toPlainTime().toLocaleString("en-US", { hour: "numeric", minute: "2-digit" })}` : "Nothing (new)"}</td>
                <td>
                  {e.undoable && <button type="button" className="mini" onClick={() => void env?.undo(e.id)}>Undo</button>}
                  {e.retryable && <button type="button" className="mini" onClick={() => void env?.retry(e.id)}>Retry</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
