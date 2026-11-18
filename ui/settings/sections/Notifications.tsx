// SA-2: Settings › Notifications, drawn with the parts (ui/settings/parts.tsx). A notice kind's or a Teams kind's
// "Saved" shows on the row that changed, and the Undo message names that row.
import { Fragment, useEffect, useRef, useState } from "react";
import { DAYS_OFF_WORDS, KIND_HINT, type NotifyKind, type QuietMode } from "../../../plan/notify.ts";
import { DEFAULT_STATUS_TIMES, type StatusTimes } from "../../../plan/status-report.ts";
import { CLOSEOUT_MINUTES, DEFAULT_TEAMS_RHYTHM, HM, TEAMS_KIND_HINT, TEAMS_KINDS, type TeamsKind, type TeamsRhythm } from "../../../plan/teams-rhythm.ts";
import { call } from "../../api.ts";
import { useAppEnv } from "../../appenv.ts";
import { NOTICES_CHANGED } from "../../Notices.tsx";
import { deviceId, disablePush, enablePush, pushSupport, type PushStatus } from "../../pwa.ts";
import { useAutoSave } from "../autosave.tsx";
import { Button, Buttons, Choice, Controls, Group, List, ListItem, Note, Num, Page, Result, Row, Subhead, Sub, Switch, Time, labelOf } from "../parts.tsx";
import { NOTIFY_SHOWN } from "../registry.ts";
import { markOf } from "./shared.ts";
import type { FormProps } from "./types.ts";

const kindId = (k: NotifyKind) => `notify-${k.replace(/_/g, "-")}`;
const IDS: Record<string, string> = { quiet: "quiet", quietPto: "quiet-pto", pushDetails: "push-details", asksThroughFocus: "urgent-during-focus", teamsMessages: "teams-messages", fromTestSite: "from-test-site", status: "status-report-times" };
/** The notice kinds in their groups, in the order the page has always listed them. */
const KIND_GROUPS = NOTIFY_SHOWN.reduce<{ title: string; kinds: NotifyKind[] }[]>((gs, [k, g]) => {
  const last = gs[gs.length - 1];
  if (last?.title === g) last.kinds.push(k);
  else gs.push({ title: g, kinds: [k] });
  return gs;
}, []);

export function NotificationsSection(p: FormProps) {
  const n = p.data.notify;
  // The row a kinds or Teams change came from: its mark and its Undo name.
  const lastKind = useRef<NotifyKind>("plan_day");
  const lastTeams = useRef<string>("brief");
  const [, rerender] = useState(0);
  const a = useAutoSave({
    section: "notify",
    initial: { kinds: { ...n.kinds } as Record<NotifyKind, boolean>, quiet: n.quiet as QuietMode, quietPto: n.quietPto, pushDetails: n.pushDetails, asksThroughFocus: n.asksThroughFocus ?? false, teamsMessages: n.teamsMessages ?? false, fromTestSite: n.fromTestSite ?? false, teams: { ...DEFAULT_TEAMS_RHYTHM, ...(n.teams ?? {}) } as TeamsRhythm, status: { ...DEFAULT_STATUS_TIMES, ...(n.status ?? {}) } as StatusTimes },
    payload: (v) => v,
    onSaved: p.onSavedData,
    label: (k) => (k === "kinds" ? labelOf(kindId(lastKind.current)) : k === "teams" ? labelOf(`teams-kind-${lastTeams.current}`) : labelOf(IDS[k as string] ?? "kinds")),
  });
  const setKind = (k: NotifyKind, on: boolean) => {
    lastKind.current = k;
    rerender((x) => x + 1);
    a.change("kinds", { ...a.v.kinds, [k]: on });
  };
  const [test, setTest] = useState<string | null>(null);
  // ENV-1: outside production nothing is sent on its own unless the person switches it on here (the server decides
  // what is production; this only hides the switch where it means nothing).
  const env = useAppEnv();
  const testSite = env !== null && env !== "prod" && env !== "demo";
  const st = a.v.status;
  return (
    <Page>
      {testSite && (
        <Group title="This test site" sid="test-site" intro="This is a test site. It sends nothing on its own: no reminders, notices, pushes or Teams messages, unless you switch them on here. It never reads chats or calls on its own and never changes your Teams status.">
          <Row id="from-test-site" help="On: you get reminders, notices, pushes and Teams messages from this test site as the real FocusTime sends them, by the switches below." more="Only for you." mark={markOf(a, "fromTestSite")}>
            <Switch checked={a.v.fromTestSite} onChange={(on) => a.change("fromTestSite", on)} />
          </Row>
        </Group>
      )}
      <Group title="In FocusTime" sid="kinds" intro="Each is sent once; a click opens FocusTime there.">
        {KIND_GROUPS.map((g) => (
          <Fragment key={g.title}>
            <Subhead>{g.title}</Subhead>
            {g.kinds.map((k) => (
              <Row key={k} id={kindId(k)} help={KIND_HINT[k]} mark={lastKind.current === k ? markOf(a, "kinds") : undefined}>
                <Switch checked={a.v.kinds[k]} onChange={(on) => setKind(k, on)} />
              </Row>
            ))}
          </Fragment>
        ))}
      </Group>
      <Group title="Timing">
        <Row id="status-report-times" help="Friday at this time, or an hour before your day ends if that comes first. Sunday only when you turn it on." more="These times hold in Teams too." mark={markOf(a, "status")}>
          <Controls>
            <Sub text="Friday at">
              <Time label="Friday at" value={st.fridayAt} onChange={(t) => HM.test(t) && a.change("status", { ...st, fridayAt: t })} />
            </Sub>
            <Switch text="Also Sunday evening at" checked={st.sunday} onChange={(on) => a.change("status", { ...st, sunday: on })} />
            <Time label="Sunday at" disabled={!st.sunday} value={st.sundayAt} onChange={(t) => HM.test(t) && a.change("status", { ...st, sundayAt: t })} />
          </Controls>
        </Row>
        <Row id="urgent-during-focus" help="Off: an urgent request waits until the focus session ends, with the others." mark={markOf(a, "asksThroughFocus")}>
          <Switch checked={a.v.asksThroughFocus} onChange={(on) => a.change("asksThroughFocus", on)} />
        </Row>
      </Group>
      <Group title="Quiet hours">
        <Row id="quiet" help="Focus timer and meeting warnings still come." mark={markOf(a, "quiet")}>
          <Choice
            options={[
              { value: "outside_hours", label: "Outside working hours" },
              { value: "off", label: "Never quiet" },
            ]}
            value={a.v.quiet}
            onChange={(q) => a.change("quiet", q as QuietMode)}
          />
        </Row>
        <Row id="quiet-pto" help={DAYS_OFF_WORDS.hint} mark={markOf(a, "quietPto")}>
          <Switch checked={a.v.quietPto} onChange={(on) => a.change("quietPto", on)} />
        </Row>
      </Group>
      <Group title="Test" intro="During a focus session only the timer, meeting warnings and (if you let them) urgent requests come; the rest wait and come as one after the session.">
        <Row id="test-notification">
          <Buttons result={test}>
            <Button
              onClick={() => {
                setTest("Sending…");
                void call("notify.test", {}).then(
                  () => (setTest("Sent. Click it to come back here."), window.dispatchEvent(new Event(NOTICES_CHANGED))),
                  (e: unknown) => setTest(e instanceof Error ? e.message : "Couldn't send it"),
                );
              }}
            >
              Send now
            </Button>
          </Buttons>
        </Row>
      </Group>
      <Group title="On your devices" sid="devices">
        <PushDevices />
        <Row id="push-details" help="Off: a push says only what kind of thing it is (Promises due). On: client names and work item titles too, on the lock screen." mark={markOf(a, "pushDetails")}>
          <Switch checked={a.v.pushDetails} onChange={(on) => a.change("pushDetails", on)} />
        </Row>
      </Group>
      <Group title="In Teams">
        <TeamsStatusLine />
        <Row id="teams-messages" help="Off: FocusTime only answers when you message it in Teams." more="On: it may send the kinds you turn on below, only in your own chat with it, never in quiet hours, on days off or weekends, and held while you focus." mark={markOf(a, "teamsMessages")}>
          <Switch checked={a.v.teamsMessages} onChange={(on) => a.change("teamsMessages", on)} />
        </Row>
        <TeamsKinds
          v={a.v.teams}
          on={a.v.teamsMessages}
          last={lastTeams.current}
          mark={markOf(a, "teams")}
          change={(t, row) => {
            lastTeams.current = row;
            rerender((x) => x + 1);
            a.change("teams", t);
          }}
          set={(t, row) => {
            lastTeams.current = row;
            a.set("teams", t);
          }}
          commit={(t) => a.commit("teams", t)}
        />
      </Group>
    </Page>
  );
}

type TeamsStatus = { available: boolean; chat: boolean; blocked: boolean };

/** TB-2: whether FocusTime can reach me in Teams: the hosted app only, after my first message, unless Teams refused it. */
function TeamsStatusLine() {
  const [st, setSt] = useState<TeamsStatus | null>(null);
  useEffect(() => void call<TeamsStatus>("teams.status", {}).then(setSt, () => setSt(null)), []);
  if (!st) return null;
  if (!st.available) return <Note>FocusTime in Teams runs in the hosted app. Here it can't send anything.</Note>;
  if (st.blocked) return <Note tone="warn" live>FocusTime can't message you in Teams. Add the app again.</Note>;
  if (!st.chat) return <Note>Message FocusTime in Teams once, so it knows where to reach you.</Note>;
  return null;
}

/** TB-2: the kinds FocusTime may send in Teams, each with its time and Send me a test now. */
function TeamsKinds(p: { v: TeamsRhythm; on: boolean; last: string; mark: ReturnType<typeof markOf>; set: (t: TeamsRhythm, row: string) => void; commit: (t: TeamsRhythm) => void; change: (t: TeamsRhythm, row: string) => void }) {
  const [test, setTest] = useState<{ kind: TeamsKind; text: string } | null>(null);
  const t = p.v;
  const off = !p.on;
  const send = (kind: TeamsKind) => {
    setTest({ kind, text: "Sending…" });
    void call("teams.test", { kind }).then(
      () => setTest({ kind, text: "Sent. Look in your chat with FocusTime in Teams." }),
      (e: unknown) => setTest({ kind, text: e instanceof Error ? e.message : "Couldn't send it" }),
    );
  };
  const time = (kind: TeamsKind) => {
    if (kind === "brief")
      return (
        <>
          <Choice
            label="Morning brief time"
            disabled={off}
            options={[
              { value: "start", label: "At the start of my day" },
              { value: "time", label: "At a set time" },
            ]}
            value={t.briefAt ? "time" : "start"}
            onChange={(v) => p.change({ ...t, briefAt: v === "start" ? null : (t.briefAt ?? "09:00") }, kind)}
          />
          {t.briefAt !== null && <Time label="Morning brief at" disabled={off} value={t.briefAt} onChange={(x) => HM.test(x) && p.change({ ...t, briefAt: x }, kind)} />}
        </>
      );
    if (kind === "checkin") return <Time label="Midday check-in at" disabled={off} value={t.checkinAt} onChange={(x) => HM.test(x) && p.change({ ...t, checkinAt: x }, kind)} />;
    if (kind === "closeout")
      return (
        <Num
          label="Minutes before my day ends"
          unit="minutes before my day ends"
          disabled={off}
          min={CLOSEOUT_MINUTES.min}
          max={CLOSEOUT_MINUTES.max}
          step={5}
          value={t.closeoutMinutes}
          onChange={(x) => p.set({ ...t, closeoutMinutes: Math.max(CLOSEOUT_MINUTES.min, Math.min(CLOSEOUT_MINUTES.max, Math.round(x || 30))) }, kind)}
          bind={{ onBlur: () => p.commit(t), onKeyDown: (e) => e.key === "Enter" && p.commit(t) }}
        />
      );
    return null;
  };
  const markFor = (row: string) => (p.last === row ? p.mark : undefined);
  return (
    <>
      <Row id="teams-kinds" help="Never on weekends or PTO days. A test comes now, whatever the switches say." />
      {TEAMS_KINDS.map((k) => (
        <Row
          key={k}
          id={`teams-kind-${k}`}
          help={TEAMS_KIND_HINT[k]}
          mark={markFor(k)}
          below={
            <Buttons result={test?.kind === k ? test.text : null}>
              {time(k)}
              <Button disabled={off} onClick={() => send(k)}>
                Send me a test now
              </Button>
            </Buttons>
          }
        >
          <Switch checked={t[k]} disabled={off} onChange={(on) => p.change({ ...t, [k]: on }, k)} />
        </Row>
      ))}
      <Row id="teams-kind-friday" mark={markFor("friday")}>
        <Switch checked={t.friday} disabled={off} onChange={(on) => p.change({ ...t, friday: on }, "friday")} />
      </Row>
    </>
  );
}

/**
 * P1: push, per device. "Notify this device" asks the browser's permission only when tapped; the list shows every
 * device with push on, with Remove. In-app notifications (⋯ › Notifications) work without any of this.
 */
function PushDevices() {
  const [st, setSt] = useState<PushStatus | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => void call<PushStatus>("push.status", {}).then(setSt, () => setSt({ available: false, reason: "Push status isn't available right now.", publicKey: null, devices: [] })), []);
  if (!st) return <Row id="devices" noSid help="Checking…" />;
  const me = deviceId();
  const here = st.devices.some((d) => d.deviceId === me);
  const support = pushSupport();
  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    setMsg(null);
    try {
      await f();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "That didn't work");
    } finally {
      setBusy(false);
    }
  };
  const when = (iso: string) => new Date(iso.replace(/\[.*\]$/, "")).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const help = !st.available ? st.reason : support === "ios-install" ? "On iPhone, add FocusTime to your home screen first (More › Install app), then open it from there to turn this on." : support === "unsupported" ? "This browser can't get push notifications. In-app notifications still work." : undefined;
  const can = st.available && support !== "ios-install" && support !== "unsupported";
  return (
    <Row
      id="devices"
      noSid
      wide
      help={help}
      below={msg ? <Result>{msg}</Result> : undefined}
    >
      <List
        add={
          can &&
          (here ? (
            <Button disabled={busy} onClick={() => void run(async () => setSt((await disablePush()) ?? st))}>
              Turn off for this device
            </Button>
          ) : (
            <Button
              kind="main"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const r = await enablePush(st.publicKey!);
                  if (r.ok) (setSt(r.status), setMsg("This device gets notifications now. Send a test above to check."));
                  else setMsg(r.reason);
                })
              }
            >
              Notify this device
            </Button>
          ))
        }
      >
        {st.devices.map((d) => (
          <ListItem key={d.deviceId} disabled={busy} removeLabel={`Remove ${d.label}`} onRemove={() => void run(async () => setSt(d.deviceId === me ? ((await disablePush()) ?? st) : await call<PushStatus>("push.remove", { deviceId: d.deviceId })))}>
            {d.label}
            {d.deviceId === me ? " (this device)" : ""} · Added {when(d.createdAt)}
            {d.failedAt ? " · last one didn't arrive" : d.sentAt ? ` · last ${when(d.sentAt)}` : ""}
          </ListItem>
        ))}
      </List>
    </Row>
  );
}
