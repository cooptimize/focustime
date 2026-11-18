// SA-3: Settings › Connections (was Accounts and calendars, with DevOps): one card per connection, all the same shape.
// My VM's rows are shared with Setup, and the calendar links and Pocket forms are their own components: they sit in
// their cards and keep their insides (docs/open-questions.md, SA-2).
import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { SourceSummary } from "../../../actions/types.ts";
import { POCKET_WORDS } from "../../../plan/pocket-words.ts";
import { VmStartForm, YouAccount } from "../../Account.tsx";
import { call } from "../../api.ts";
import { notConnected, SOURCE_NAMES, sourceActions, sourceKey, sourceLabel, stateOf } from "../../status.ts";
import { useTimeboxes } from "../../Timeboxes.tsx";
import { CalendarLinks } from "../CalendarLinks.tsx";
import { PocketRecorder } from "../Pocket.tsx";
import { Button, Buttons, Fold, GoLink, Group, Note, Page, Row, State, StatusItem, StatusList } from "../parts.tsx";
import { DevOpsCard } from "./DevOps.tsx";
import type { BodyProps } from "./types.ts";

type Tone = "live" | "cached" | "error" | "signin" | "muted";

/**
 * SA-3: one card per connection, all the same shape: its name, a state line, what it is for, one main button, and
 * More (closed) for the rest.
 */
function Card({ id, name, state, tone, forWhat, main, more, children }: { id: string; name: string; state?: ReactNode; tone?: Tone; forWhat: string; main?: ReactNode; more?: ReactNode; children?: ReactNode }) {
  return (
    <Group title={name} sid={id} intro={forWhat}>
      {(state || main) && (
        <Buttons>
          {state && <State tone={tone}>{state}</State>}
          {main}
        </Buttons>
      )}
      {children}
      {more && <Fold label="More">{more}</Fold>}
    </Group>
  );
}

const toneOf = (s: SourceSummary | undefined): Tone => (!s ? "muted" : (stateOf(s).cls as Tone));

export function ConnectionsSection(p: BodyProps) {
  const ms = p.sources.find((s) => s.source === "outlook");
  const google = p.sources.find((s) => s.source === "google");
  const calButton = (s: SourceSummary | undefined, cal: "outlook" | "google") => {
    const acts = s ? sourceActions(s) : [];
    if (acts.includes("connect") || acts.includes("reconnect"))
      return (
        <Button kind="main" disabled={p.busy !== null} onClick={() => p.onConnect(cal)}>
          {p.busy === cal ? "Waiting for sign-in…" : acts.includes("connect") ? "Connect" : "Reconnect"}
        </Button>
      );
    return (
      <Button disabled={p.loading} onClick={p.onRefresh}>
        {p.loading ? "Retrying…" : "Retry"}
      </Button>
    );
  };
  return (
    <Page>
      {p.reconnected && (
        <Note tone="ok" live>
          {SOURCE_NAMES[p.reconnected]} is connected again.
        </Note>
      )}
      <Card
        id="sources"
        name="Microsoft and Outlook"
        state={ms ? `Outlook ${stateOf(ms).label}` : "Not connected"}
        tone={toneOf(ms)}
        forWhat="Your sign-in, your Outlook calendar, Dataverse (your focus blocks, clients and time off) and Teams."
        main={calButton(ms, "outlook")}
        more={
          <>
            <SourceList {...p} only={["dataverse", "pto", "outlook"]} />
            <Permissions />
          </>
        }
      />
      <OutlookChanges go={p.go} />
      <Card
        id="google"
        name="Google"
        state={google ? `Google ${stateOf(google).label}` : "Not connected"}
        tone={toneOf(google)}
        forWhat="Your personal Google calendar, shown as personal events and counted in your free time."
        main={calButton(google, "google")}
        more={
          google && sourceActions(google).includes("disconnect") ? (
            <Button kind="quiet" disabled={p.busy !== null} onClick={() => p.onDisconnect("google")}>
              Disconnect Google
            </Button>
          ) : undefined
        }
      />
      <Card id="calendar-links" name="Calendars added by link" forWhat="Any other calendar by its link (iCloud, a school's), busy only or with titles.">
        <CalendarLinks timeZone={Temporal.Now.timeZoneId()} onChanged={p.onRefresh} />
      </Card>
      <DevOpsCard {...p} />
      <Card id="pocket" name={POCKET_WORDS.title} forWhat="Recordings from your Pocket, offered as captures.">
        <PocketRecorder timeZone={Temporal.Now.timeZoneId()} />
      </Card>
      <TeamsApp go={p.go} />
      <Card id="vm" name="My VM" forWhat="The one Azure VM you confirmed: its status in the header, and Start.">
        <YouAccount part="vm" />
        <VmStartForm />
      </Card>
    </Page>
  );
}

/** Each connected source as a line, with Retry and Disconnect where they apply. */
function SourceList(p: BodyProps & { only: readonly SourceSummary["source"][] }) {
  return (
    <StatusList label="Sources">
      {p.sources
        .filter((s) => p.only.includes(s.source))
        .map((s) => {
          const st = stateOf(s);
          const cal = s.source === "outlook" || s.source === "google" ? s.source : null;
          return (
            <StatusItem
              key={sourceKey(s)}
              tone={st.cls as "live"}
              name={sourceLabel(s)}
              state={st.label}
              detail={s.message ?? (s.sample || notConnected(s) ? "" : `${s.itemCount} ${s.itemCount === 1 ? "item" : "items"}`)}
              actions={
                <>
                  <Button disabled={p.loading} onClick={p.onRefresh}>
                    {p.loading ? "Retrying…" : "Retry"}
                  </Button>
                  {cal && sourceActions(s).includes("disconnect") && (
                    <Button kind="quiet" disabled={p.busy !== null} onClick={() => p.onDisconnect(cal)}>
                      Disconnect
                    </Button>
                  )}
                </>
              }
            />
          );
        })}
    </StatusList>
  );
}

/** Connections › Outlook calendar changes (step 12): whether FocusTime may change its own Outlook events. */
function OutlookChanges({ go }: { go: (section: string, setting?: string | null) => void }) {
  const env = useTimeboxes();
  useEffect(() => env?.loadAccess(), []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!env) return null;
  const a = env.access;
  const ok = a?.access === "write";
  return (
    <Card
      id="outlook-changes"
      name="Outlook calendar changes"
      state={!a ? "Checking…" : ok ? "Allowed" : "Not allowed"}
      tone={!a ? "muted" : ok ? "live" : "muted"}
      forWhat="Lets FocusTime create, change and remove only the Outlook events it created (timeboxes), each after a preview."
      main={
        a && !ok && a.access !== "not_set_up" ? (
          <Button kind="main" onClick={env.connectWrite}>
            Reconnect Outlook with calendar changes
          </Button>
        ) : undefined
      }
      more={
        <>
          {a && !ok && <Note>{a.message}</Note>}
          <Note>It can't change any other event. It asks for this only when you reconnect here.</Note>
          <GoLink section="planning" setting="outlook-default" go={go}>
            Put new timeboxes on Outlook
          </GoLink>
        </>
      }
    />
  );
}

type Perm = { scope: string; api: string; why: string; admin: boolean; later?: string; state: "granted" | "needs_consent" | "needs_admin" | "missing" | "signed_out" | "unknown" };
const PERM_STATE: Record<Perm["state"], [string, "live" | "cached" | "error" | "muted"]> = {
  granted: ["Allowed", "live"],
  needs_consent: ["Not allowed yet", "cached"],
  needs_admin: ["Needs admin consent", "error"],
  missing: ["Missing", "muted"],
  signed_out: ["Signed out", "muted"],
  unknown: ["Couldn't check", "muted"],
};

/** Every permission FocusTime asks Microsoft for, with its state; Check again reads them once more. */
function Permissions() {
  const [rows, setRows] = useState<Perm[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const load = useCallback(() => {
    setProblem(null);
    call<{ signedIn: boolean; rows: Perm[] }>("permissions.status", {}).then((d) => setRows(d.rows), (e) => setProblem(e instanceof Error ? e.message : "Couldn't check"));
  }, []);
  useEffect(load, [load]);
  const admin = rows?.filter((r) => r.state === "needs_admin" || (r.state === "needs_consent" && r.admin)) ?? [];
  return (
    <Row
      id="permissions"
      wide
      help="What FocusTime may do with your Microsoft sign-in. Read only unless it says so."
      more={rows ? rows.map((r) => `${r.why}: ${r.scope}${r.api !== "Microsoft Graph" ? ` (${r.api})` : ""}`).join(". ") : undefined}
      below={
        <>
          {admin.length > 0 && (
            <Note tone="problem" live>
              An admin must allow {admin.map((r) => r.why.toLowerCase()).join(", ")} for the Cooptimize tenant (Entra admin center › App registrations › FocusTime › API permissions › Grant admin consent).
            </Note>
          )}
          {rows?.some((r) => r.state === "needs_consent" && !r.admin) && <Note>Not allowed yet: sign out and sign in again to allow it, or ask your FocusTime admin to allow it for everyone.</Note>}
          <Buttons result={problem} tone="problem">
            <Button onClick={load}>Check again</Button>
          </Buttons>
        </>
      }
    >
      {rows && (
        <StatusList>
          {rows.map((r) => (
            <StatusItem
              key={`${r.api}:${r.scope}`}
              tone={PERM_STATE[r.state][1]}
              name={r.why}
              state={PERM_STATE[r.state][0]}
              detail={`${r.admin ? "Your admin allows it for everyone" : ""}${r.state === "missing" && r.later ? `${r.admin ? ". " : ""}${r.later}` : ""}` || undefined}
            />
          ))}
        </StatusList>
      )}
    </Row>
  );
}

type TeamsStatus = { available: boolean; chat: boolean; blocked: boolean };

/** TB-2: whether FocusTime can reach me in Teams (the hosted app only, after my first message), and where its settings are. */
function TeamsApp({ go }: { go: (section: string, setting?: string | null) => void }) {
  const [st, setSt] = useState<TeamsStatus | null>(null);
  useEffect(() => void call<TeamsStatus>("teams.status", {}).then(setSt, () => setSt(null)), []);
  const line = !st ? "Checking…" : !st.available ? "Runs in the hosted app only" : st.blocked ? "Can't message you: add the app again" : !st.chat ? "Message FocusTime in Teams once, so it knows where to reach you" : "Connected";
  return (
    <Card
      id="teams-app"
      name="FocusTime in Teams"
      state={line}
      tone={st?.available && st.chat && !st.blocked ? "live" : st?.blocked ? "error" : "muted"}
      forWhat="FocusTime in your own 1:1 chat in Teams: ask it things, and the reminders you turn on for Teams."
      main={
        <GoLink kind="button" section="notifications" setting="teams-messages" go={go}>
          What FocusTime may send you in Teams
        </GoLink>
      }
      more={
        <GoLink section="focus" setting="teams-status" go={go}>
          Your Teams status while you focus
        </GoLink>
      }
    />
  );
}
