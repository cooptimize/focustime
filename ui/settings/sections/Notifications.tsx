// SA-3: Settings › Reminders and notices (was Notifications, with Day and Week's reminder times, week nudges and
// look-ahead rituals). Where notices reach you, each reminder on one row with its switch, its time and "Also in Teams",
// Quiet, and every other kind of notice folded. Every stored key is the one it was: the row's switch is the reminder's
// own [notify] kind, its time the [plan] key, Also in Teams the [notify] teams_<kind>. Teams' own check-in and close
// out times stay stored and unread (the messages go at the app's time); the note on those rows says so, once.
import { useEffect, useRef, useState } from "react";
import { DAYS_OFF_WORDS, DEFAULT_NOTIFY, KIND_HINT, type NotifyKind, type QuietMode } from "../../../plan/notify.ts";
import { nextRituals } from "../../../plan/rituals.ts";
import { DEFAULT_STATUS_TIMES, type StatusTimes } from "../../../plan/status-report.ts";
import { DEFAULT_TEAMS_RHYTHM, HM, TEAMS_KIND_HINT, TEAMS_KIND_LABEL, TEAMS_KINDS, type TeamsKind, type TeamsNote, type TeamsRhythm } from "../../../plan/teams-rhythm.ts";
import { call } from "../../api.ts";
import { useAppEnv } from "../../appenv.ts";
import { NOTICES_CHANGED } from "../../Notices.tsx";
import { deviceId, disablePush, enablePush, pushSupport, type PushStatus } from "../../pwa.ts";
import { useAutoSave } from "../autosave.tsx";
import { Button, Buttons, Choice, Controls, Fold, Group, List, ListItem, Note, Num, Page, Result, Row, Select, Sub, Subhead, Switch, Time, labelOf } from "../parts.tsx";
import { FOLDS, NOTICE_KINDS_SHOWN } from "../registry.ts";
import { markOf } from "./shared.ts";
import type { FormProps } from "./types.ts";
import { usePlan } from "./usePlan.ts";

const kindId = (k: NotifyKind) => `notify-${k.replace(/_/g, "-")}`;
const IDS: Record<string, string> = { quiet: "quiet", quietPto: "quiet-pto", pushDetails: "push-details", asksThroughFocus: "urgent-during-focus", teamsMessages: "teams-messages", fromTestSite: "from-test-site", status: "status-report-times" };
/** The reason an Also in Teams (or a Teams-only switch) is greyed. */
const TEAMS_OFF = "Teams messages are off";
/** The Teams kinds that sit with the notices, in the fold. */
const TEAMS_IN_FOLD = ["nudges", "meetings"] as const;

/** SA-3: Teams' own two times are never sent from here, so a save can't change them. */
const teamsPayload = (t: TeamsRhythm) => {
  const { checkinAt: _c, closeoutMinutes: _m, ...rest } = t;
  return rest;
};

export function NotificationsSection(p: FormProps) {
  const n = p.data.notify;
  // The row a kinds or Teams change came from: its mark and its Undo name.
  const lastKind = useRef<NotifyKind>("plan_day");
  const lastTeams = useRef<string>("brief");
  const [, rerender] = useState(0);
  const a = useAutoSave({
    section: "notify",
    initial: { kinds: { ...n.kinds } as Record<NotifyKind, boolean>, quiet: n.quiet as QuietMode, quietPto: n.quietPto, pushDetails: n.pushDetails, asksThroughFocus: n.asksThroughFocus ?? false, teamsMessages: n.teamsMessages ?? false, fromTestSite: n.fromTestSite ?? false, teams: { ...DEFAULT_TEAMS_RHYTHM, ...(n.teams ?? {}) } as TeamsRhythm, status: { ...DEFAULT_STATUS_TIMES, ...(n.status ?? {}) } as StatusTimes },
    payload: (v) => ({ ...v, teams: teamsPayload(v.teams) }),
    onSaved: p.onSavedData,
    label: (k) => (k === "kinds" ? labelOf(kindId(lastKind.current)) : k === "teams" ? labelOf(`teams-kind-${lastTeams.current}`) : labelOf(IDS[k as string] ?? "kinds")),
  });
  const pl = usePlan(p, ["reminderOffsetMinutes", "checkinReminderMinutes", "closeoutReminderMinutes", "weekNudgeThu", "weekNudgeFri", "weekNudgeMon"] as const);
  const setKind = (k: NotifyKind, on: boolean) => {
    lastKind.current = k;
    rerender((x) => x + 1);
    a.change("kinds", { ...a.v.kinds, [k]: on });
  };
  const setTeams = (k: TeamsKind | "friday", t: Partial<TeamsRhythm>) => {
    lastTeams.current = k;
    rerender((x) => x + 1);
    a.change("teams", { ...a.v.teams, ...t });
  };
  const kindMark = (k: NotifyKind) => (lastKind.current === k ? markOf(a, "kinds") : undefined);
  const teamsMark = (k: string) => (lastTeams.current === k ? markOf(a, "teams") : undefined);
  // ENV-1: outside production nothing is sent on its own unless the person switches it on here (the server decides
  // what is production; this only hides the switch where it means nothing).
  const env = useAppEnv();
  const testSite = env !== null && env !== "prod" && env !== "demo";
  const teamsOff = !a.v.teamsMessages;
  const t = a.v.teams;
  const st = a.v.status;
  /** "Also in Teams": the reminder's Teams switch. It keeps its value, greyed with the reason, while In Teams is off. */
  const also = (k: "checkin" | "closeout" | "status") => <Switch sid={`teams-kind-${k}`} text={teamsOff ? `Also in Teams (${TEAMS_OFF.toLowerCase()})` : "Also in Teams"} checked={t[k]} disabled={teamsOff} onChange={(on) => setTeams(k, { [k]: on })} />;
  const changedKinds = NOTICE_KINDS_SHOWN.filter((k) => a.v.kinds[k] !== DEFAULT_NOTIFY.kinds[k]).length + TEAMS_IN_FOLD.filter((k) => t[k] !== DEFAULT_TEAMS_RHYTHM[k]).length;
  const rituals = nextRituals(Temporal.Now.plainDateISO().toString());
  const day = (d: string) => Temporal.PlainDate.from(d).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" });
  return (
    <Page>
      {testSite && (
        <Group title="This test site" sid="test-site" intro="This is a test site. It sends nothing on its own: no reminders, notices, pushes or Teams messages, unless you switch them on here. It never reads chats or calls on its own and never changes your Teams status.">
          <Row id="from-test-site" help="On: you get reminders, notices, pushes and Teams messages from this test site as the real FocusTime sends them, by the switches below." more="Only for you." mark={markOf(a, "fromTestSite")}>
            <Switch checked={a.v.fromTestSite} onChange={(on) => a.change("fromTestSite", on)} />
          </Row>
        </Group>
      )}
      <Group title="Where they reach you">
        <Subhead>In FocusTime</Subhead>
        <Note>Always, while FocusTime is open: each notice shows in More › Notifications, and a click opens where it points.</Note>
        <Subhead>On this device</Subhead>
        <PushDevices />
        <Row id="push-details" help="Off: a push says only what kind of thing it is (Promises due). On: client names and work item titles too, on the lock screen." mark={markOf(a, "pushDetails")}>
          <Switch checked={a.v.pushDetails} onChange={(on) => a.change("pushDetails", on)} />
        </Row>
        <TestNotification />
        <Subhead>In Teams</Subhead>
        <TeamsStatusLine />
        <Row id="teams-messages" help="Off: FocusTime only answers when you message it in Teams." more="On: it may send the reminders and notices you turn on for Teams, only in your own chat with it, never in quiet hours, on days off or weekends, and held while you focus." mark={markOf(a, "teamsMessages")}>
          <Switch checked={a.v.teamsMessages} onChange={(on) => a.change("teamsMessages", on)} />
        </Row>
        <Row id="teams-kind-friday" help={teamsOff ? `${TEAMS_OFF}.` : "Teams messages on the catch-up day too. Never on weekends or days off."} mark={teamsMark("friday")}>
          <Switch checked={t.friday} disabled={teamsOff} onChange={(on) => setTeams("friday", { friday: on })} />
        </Row>
        <TeamsTest off={teamsOff} />
      </Group>
      <Group title="Reminders" intro="Each comes once, at its time, only while there is something to do.">
        <Row
          id="teams-kind-brief"
          wide
          help={teamsOff ? `${TEAMS_KIND_HINT.brief} In Teams only; ${TEAMS_OFF.toLowerCase()}.` : `${TEAMS_KIND_HINT.brief} In Teams only.`}
          mark={teamsMark("brief")}
        >
          <Controls>
            <Switch checked={t.brief} disabled={teamsOff} onChange={(on) => setTeams("brief", { brief: on })} />
            <Choice
              label="Morning brief time"
              disabled={teamsOff}
              options={[
                { value: "start", label: "At the start of my day" },
                { value: "time", label: "At a set time" },
              ]}
              value={t.briefAt ? "time" : "start"}
              onChange={(v) => setTeams("brief", { briefAt: v === "start" ? null : (t.briefAt ?? "09:00") })}
            />
            {t.briefAt !== null && <Time label="Morning brief at" disabled={teamsOff} value={t.briefAt} onChange={(x) => HM.test(x) && setTeams("brief", { briefAt: x })} />}
          </Controls>
        </Row>
        <Row id="notify-plan-day" wide help={KIND_HINT.plan_day} mark={kindMark("plan_day") ?? markOf(pl, "reminderOffsetMinutes")}>
          <Controls>
            <Switch checked={a.v.kinds.plan_day} onChange={(on) => setKind("plan_day", on)} />
            <Sub text="At" sid="plan-reminder">
              <Num label="Add work: minutes after the day starts" unit="minutes after the day starts" min={0} max={240} step={5} value={pl.v.reminderOffsetMinutes} onChange={(x) => pl.set("reminderOffsetMinutes", x)} bind={pl.text("reminderOffsetMinutes")} />
            </Sub>
          </Controls>
        </Row>
        <Row
          id="notify-checkin"
          wide
          help={KIND_HINT.checkin}
          mark={kindMark("checkin") ?? teamsMark("checkin") ?? markOf(pl, "checkinReminderMinutes")}
          below={<TeamsTimeNote kind="checkin" note={p.data.teamsNote} />}
        >
          <Controls>
            <Switch checked={a.v.kinds.checkin} onChange={(on) => setKind("checkin", on)} />
            <Sub text="At" sid="checkin-reminder">
              <Num label="Midday check-in: minutes after lunch" unit="minutes after lunch" min={0} max={120} step={5} value={pl.v.checkinReminderMinutes} onChange={(x) => pl.set("checkinReminderMinutes", x)} bind={pl.text("checkinReminderMinutes")} />
            </Sub>
            {also("checkin")}
          </Controls>
        </Row>
        <Row
          id="notify-closeout"
          wide
          help={KIND_HINT.closeout}
          mark={kindMark("closeout") ?? teamsMark("closeout") ?? markOf(pl, "closeoutReminderMinutes")}
          below={<TeamsTimeNote kind="closeout" note={p.data.teamsNote} />}
        >
          <Controls>
            <Switch checked={a.v.kinds.closeout} onChange={(on) => setKind("closeout", on)} />
            <Sub text="At" sid="closeout-reminder">
              <Num label="Close out: minutes before the day ends" unit="minutes before the day ends" min={0} max={120} step={5} value={pl.v.closeoutReminderMinutes} onChange={(x) => pl.set("closeoutReminderMinutes", x)} bind={pl.text("closeoutReminderMinutes")} />
            </Sub>
            {also("closeout")}
          </Controls>
        </Row>
        <Row id="week-nudges" wide help="While that week has nothing on it yet." mark={kindMark("look_ahead") ?? kindMark("plan_week") ?? markOf(pl, "weekNudgeThu")}>
          <Controls>
            <Switch sid="notify-look-ahead" text="Thursday and Friday, for next week" checked={a.v.kinds.look_ahead} onChange={(on) => setKind("look_ahead", on)} />
            <Sub text="Thursday at" sid="nudge-thu">
              <Time label="Thursday at" value={pl.v.weekNudgeThu} onChange={(x) => HM.test(x) && pl.change("weekNudgeThu", x)} />
            </Sub>
            <Sub text="Friday at" sid="nudge-fri">
              <Time label="Friday at" value={pl.v.weekNudgeFri} onChange={(x) => HM.test(x) && pl.change("weekNudgeFri", x)} />
            </Sub>
          </Controls>
          <Controls>
            <Switch sid="notify-plan-week" text="Monday, for this week" checked={a.v.kinds.plan_week} onChange={(on) => setKind("plan_week", on)} />
            <Sub text="Monday at" sid="nudge-mon">
              <Time label="Monday at" value={pl.v.weekNudgeMon} onChange={(x) => HM.test(x) && pl.change("weekNudgeMon", x)} />
            </Sub>
          </Controls>
        </Row>
        <Row id="notify-status-report" wide help="Friday at this time, or an hour before your day ends if that comes first, when some of your features have no update yet for Monday's report." mark={kindMark("status_report") ?? teamsMark("status") ?? markOf(a, "status")}>
          <Controls>
            <Switch checked={a.v.kinds.status_report} onChange={(on) => setKind("status_report", on)} />
            <Sub text="Friday at" sid="status-report-times">
              <Time label="Friday at" value={st.fridayAt} onChange={(x) => HM.test(x) && a.change("status", { ...st, fridayAt: x })} />
            </Sub>
            <Switch text="Also Sunday evening at" checked={st.sunday} onChange={(on) => a.change("status", { ...st, sunday: on })} />
            <Time label="Sunday at" disabled={!st.sunday} value={st.sundayAt} onChange={(x) => HM.test(x) && a.change("status", { ...st, sundayAt: x })} />
            {also("status")}
          </Controls>
        </Row>
        <Row id="notify-plan-ahead" help={`Every other Thursday from the start of your day, once next week has work on it. Next: ${day(rituals.lookAhead)}.`} more="It opens Backlog › Gantt, to look 4 weeks ahead." mark={kindMark("plan_ahead")}>
          <Controls sid="rituals">
            <Switch checked={a.v.kinds.plan_ahead} onChange={(on) => setKind("plan_ahead", on)} />
          </Controls>
        </Row>
        <Row id="notify-direction" help={`The first Thursday of each month, from the start of your day. Next: ${day(rituals.direction)}.`} more="It opens Backlog › Gantt, to look 8 to 12 weeks ahead." mark={kindMark("direction")}>
          <Switch checked={a.v.kinds.direction} onChange={(on) => setKind("direction", on)} />
        </Row>
      </Group>
      <Group title="Quiet">
        <Row id="quiet" help="Focus timer and meeting warnings still come." mark={markOf(a, "quiet")}>
          {/* SA-3: on stores what "Outside working hours" stored, off what "Never quiet" stored. */}
          <Switch checked={a.v.quiet === "outside_hours"} onChange={(on) => a.change("quiet", on ? "outside_hours" : "off")} />
        </Row>
        <Row id="quiet-pto" help={DAYS_OFF_WORDS.hint} mark={markOf(a, "quietPto")}>
          <Switch checked={a.v.quietPto} onChange={(on) => a.change("quietPto", on)} />
        </Row>
        <Row id="urgent-during-focus" help="Off: an urgent request waits until the focus session ends, with the others." more="During a focus session only the timer, meeting warnings and (if you let them) urgent requests come; the rest wait and come as one after the session." mark={markOf(a, "asksThroughFocus")}>
          <Switch checked={a.v.asksThroughFocus} onChange={(on) => a.change("asksThroughFocus", on)} />
        </Row>
      </Group>
      <Group sid="kinds">
        <Fold label={FOLDS.kinds} count={NOTICE_KINDS_SHOWN.length + TEAMS_IN_FOLD.length} changed={changedKinds}>
          {NOTICE_KINDS_SHOWN.map((k) => (
            <Row key={k} id={kindId(k)} help={KIND_HINT[k]} mark={kindMark(k)}>
              <Switch checked={a.v.kinds[k]} onChange={(on) => setKind(k, on)} />
            </Row>
          ))}
          {TEAMS_IN_FOLD.map((k) => (
            <Row key={k} id={`teams-kind-${k}`} help={teamsOff ? `${TEAMS_KIND_HINT[k]} In Teams; ${TEAMS_OFF.toLowerCase()}.` : `${TEAMS_KIND_HINT[k]} In Teams.`} mark={teamsMark(k)}>
              <Switch checked={t[k]} disabled={teamsOff} onChange={(on) => setTeams(k, { [k]: on })} />
            </Row>
          ))}
        </Fold>
      </Group>
    </Page>
  );
}

/** SA-3: the one-time note on Midday check-in and Close out: Teams' own time is no longer used. Got it, and never again. */
function TeamsTimeNote({ kind, note }: { kind: "checkin" | "closeout"; note: TeamsNote | undefined }) {
  const [gone, setGone] = useState(false);
  const old = note?.[kind];
  if (!old || gone) return null;
  return (
    <Note>
      Teams used {old}. It now uses this time.{" "}
      <Button kind="quiet" onClick={() => void call("settings.note_seen", { kind }).then(() => setGone(true), () => setGone(true))}>
        Got it
      </Button>
    </Note>
  );
}

/** The in-app test notification (it goes out whatever the switches say). */
function TestNotification() {
  const [test, setTest] = useState<string | null>(null);
  return (
    <Row id="test-notification" help="It comes now, whatever the switches say.">
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
          Send a test
        </Button>
      </Buttons>
    </Row>
  );
}

/** SA-3: one Send a test for Teams, with a choice of which message (was a button on each of six rows). */
function TeamsTest({ off }: { off: boolean }) {
  const [kind, setKind] = useState<TeamsKind>("brief");
  const [test, setTest] = useState<string | null>(null);
  const send = () => {
    setTest("Sending…");
    void call("teams.test", { kind }).then(
      () => setTest("Sent. Look in your chat with FocusTime in Teams."),
      (e: unknown) => setTest(e instanceof Error ? e.message : "Couldn't send it"),
    );
  };
  return (
    <Row id="teams-kinds" help={off ? `${TEAMS_OFF}.` : "It comes now, whatever the switches say. Never on weekends or days off otherwise."}>
      <Buttons result={test}>
        <Select label="Which message" disabled={off} options={TEAMS_KINDS.map((k) => ({ value: k, label: TEAMS_KIND_LABEL[k] }))} value={kind} onChange={setKind} />
        <Button disabled={off} onClick={send}>
          Send a test
        </Button>
      </Buttons>
    </Row>
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

/**
 * P1: push, per device. "Notify this device" asks the browser's permission only when tapped; the list shows every
 * device with push on, with Remove. In-app notifications (More › Notifications) work without any of this.
 */
function PushDevices() {
  const [st, setSt] = useState<PushStatus | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => void call<PushStatus>("push.status", {}).then(setSt, () => setSt({ available: false, reason: "Push status isn't available right now.", publicKey: null, devices: [] })), []);
  if (!st) return <Row id="devices" help="Checking…" />;
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
    <Row id="devices" wide help={help} below={msg ? <Result>{msg}</Result> : undefined}>
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
                  if (r.ok) (setSt(r.status), setMsg("This device gets notifications now. Send a test below to check."));
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
