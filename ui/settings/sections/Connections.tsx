// SA-2: Settings › Accounts and calendars, drawn with the parts. My VM's rows are shared with Setup, and the calendar
// links and Pocket forms are their own components: they sit in the parts' cards here and keep their insides until a
// later step redraws them (docs/open-questions.md, SA-2).
import { useCallback, useEffect, useState } from "react";
import type { FeedbackStatus } from "../../../actions/feedback-types.ts";
import { POCKET_WORDS } from "../../../plan/pocket-words.ts";
import { VmStartForm, YouAccount } from "../../Account.tsx";
import { call } from "../../api.ts";
import { notConnected, SOURCE_NAMES, sourceActions, sourceKey, sourceLabel, stateOf } from "../../status.ts";
import { useTimeboxes } from "../../Timeboxes.tsx";
import { CalendarLinks } from "../CalendarLinks.tsx";
import { PocketRecorder } from "../Pocket.tsx";
import { Button, Buttons, GoLink, Group, Note, Page, Result, Row, StatusItem, StatusList } from "../parts.tsx";
import type { BodyProps } from "./types.ts";

export function ConnectionsSection(p: BodyProps) {
  return (
    <Page>
      <Group sid="sources">
        <Row id="sources" noSid wide below={p.reconnected ? <Note tone="ok" live>{SOURCE_NAMES[p.reconnected]} is connected again.</Note> : undefined}>
          <StatusList>
            {p.sources.map((s) => {
              const st = stateOf(s);
              const acts = sourceActions(s);
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
                      {cal && (acts.includes("connect") || acts.includes("reconnect")) && (
                        <Button kind="main" disabled={p.busy !== null} onClick={() => p.onConnect(cal)}>
                          {p.busy === cal ? "Waiting for sign-in…" : acts.includes("connect") ? "Connect" : "Reconnect"}
                        </Button>
                      )}
                      {cal && acts.includes("disconnect") && (
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
        </Row>
      </Group>
      <Group title="Calendars added by link" sid="calendar-links">
        <CalendarLinks timeZone={Temporal.Now.timeZoneId()} onChanged={p.onRefresh} />
      </Group>
      <Group title={POCKET_WORDS.title} sid="pocket">
        <PocketRecorder timeZone={Temporal.Now.timeZoneId()} />
      </Group>
      <Group>
        <OutlookWriteRow />
      </Group>
      <Group>
        <Permissions />
      </Group>
      <Group title="My VM">
        <YouAccount part="vm" />
        <VmStartForm />
      </Group>
      <Group>
        <TeamsApp go={p.go} />
      </Group>
      <Group>
        <FeedbackRow go={p.go} />
      </Group>
    </Page>
  );
}

/** Settings > Accounts and calendars (step 12): whether FocusTime may change its own Outlook events, and how to allow it. */
function OutlookWriteRow() {
  const env = useTimeboxes();
  useEffect(() => env?.loadAccess(), []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!env) return null;
  const a = env.access;
  return (
    <Row
      id="outlook-changes"
      help={!a ? "Checking…" : a.access === "write" ? "Allowed: FocusTime can create, change and remove the Outlook events it created (timeboxes), each after a preview." : a.message}
      more={a?.access === "write" ? "It can't change any other event. Asks for Calendars.ReadWrite only when you reconnect here." : "Asks for Calendars.ReadWrite only when you reconnect here."}
    >
      {a && a.access !== "write" && a.access !== "not_set_up" && (
        <Button kind="main" onClick={env.connectWrite}>
          Reconnect Outlook with calendar changes
        </Button>
      )}
    </Row>
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
      help="Every permission FocusTime asks Microsoft for, on your one sign-in. Read only unless it says so."
      below={
        <>
          {admin.length > 0 && (
            <Note tone="problem" live>
              An admin must allow {admin.map((r) => r.scope).join(", ")} for the Cooptimize tenant (Entra admin center › App registrations › FocusTime › API permissions › Grant admin consent).
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
              name={r.scope}
              state={PERM_STATE[r.state][0]}
              detail={`${r.why}${r.api !== "Microsoft Graph" ? ` (${r.api})` : ""}${r.admin ? " · admin consent" : ""}${r.state === "missing" && r.later ? `. ${r.later}` : ""}`}
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
  const line = !st ? "Checking…" : !st.available ? "FocusTime in Teams runs in the hosted app. Here it can't send anything." : st.blocked ? "FocusTime can't message you in Teams. Add the app again." : !st.chat ? "Message FocusTime in Teams once, so it knows where to reach you." : "Connected: FocusTime can reach you in your chat with it.";
  return (
    <Row
      id="teams-app"
      wide
      help={line}
      below={
        <Buttons>
          <GoLink section="notifications" setting="teams-messages" go={go}>
            What FocusTime may send you in Teams
          </GoLink>
          <GoLink section="focus" setting="teams-status" go={go}>
            Your Teams status while you focus
          </GoLink>
        </Buttons>
      }
    />
  );
}

function FeedbackRow({ go }: { go: (section: string, setting?: string | null) => void }) {
  const [st, setSt] = useState<FeedbackStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = (fresh: boolean) => call<FeedbackStatus>("feedback.status", fresh ? { fresh: true } : {}).then((r) => (setSt(r), setError(null)), (e: unknown) => setError(e instanceof Error ? e.message : "Couldn't check"));
  useEffect(() => void load(false), []);
  return (
    <Row id="feedback" wide help={error ?? (st ? st.line : "Checking…")} below={st ? <Result>{`${st.destination}. ${st.sentToday} of ${st.limit} sent today.`}</Result> : undefined}>
      <Buttons>
        {st?.setup.state === "no_pat" && (
          <GoLink kind="button" section="devops" setting="devops-write" go={go}>
            Turn on DevOps writes
          </GoLink>
        )}
        {st && <Button onClick={() => void load(true)}>Check again</Button>}
      </Buttons>
    </Row>
  );
}

