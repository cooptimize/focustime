// SA-2: Settings › Day and Week, drawn with the parts (ui/settings/parts.tsx).
import { useState } from "react";
import { COLLAB_LENGTHS } from "../../../config/schema.ts";
import { hoursText, STORY_SIZES, UNSIZED_CHOICES, unsizedText } from "../../../plan/estimate.ts";
import { nextRituals } from "../../../plan/rituals.ts";
import { useAutoSave } from "../autosave.tsx";
import { Button, Choice, Group, List, ListItem, Note, Page, Row, Select, Text, TeamDefault, Time, Value } from "../parts.tsx";
import { NumRow, SwitchRow } from "./fields.tsx";
import { firstLine, labelBy, markOf, rest } from "./shared.ts";
import type { FormProps } from "./types.ts";
import { usePlan } from "./usePlan.ts";

export function DayWeekSection(p: FormProps) {
  return (
    <Page>
      <GuidanceForm {...p} />
      <PlanningForm {...p} />
      <TimeboxForm {...p} />
      <CollabForm {...p} />
      {p.data.risk && <RiskFields {...p} />}
    </Page>
  );
}

const say = (t: string) => ({ help: firstLine(t), more: rest(t) });

/** ST-1: Day and Week's to-dos, rituals and nudges (the focus timer is under Focus, following under Clients). */
function PlanningForm(p: FormProps) {
  const a = usePlan(p, ["unsizedMinutes", "minS", "minM", "minL", "carryDays", "suggest", "reminderOffsetMinutes", "devopsOnDone", "progressOffer", "checkinReminderMinutes", "closeoutReminderMinutes", "weekNudgeThu", "weekNudgeFri", "weekNudgeMon"] as const);
  const sizes = p.data.planning.sizes;
  return (
    <>
      <Group title="To-dos">
        <Row id="count-unsized" {...say("Used wherever a to-do or story has no size yet, in every fit and budget. Nothing is written to DevOps.")} mark={markOf(a, "unsizedMinutes")} below={<Note>{STORY_SIZES.map((z) => `${z} ${sizes[z] < 60 ? `${sizes[z]} min` : hoursText(sizes[z])}`).join(" · ")}</Note>}>
          <Choice options={UNSIZED_CHOICES.map((m) => ({ value: m, label: unsizedText({ ...sizes, unsized: m }) }))} value={a.v.unsizedMinutes} onChange={(m) => a.change("unsizedMinutes", m)} />
        </Row>
        <Row id="shortest-useful-time" />
        <NumRow a={a} k="minS" id="shortest-s" help="The least Timebox my day gives an S to-do (S is 1h, M 2h, L 4h)." />
        <NumRow a={a} k="minM" id="shortest-m" help="The same for M." />
        <NumRow a={a} k="minL" id="shortest-l" help="The same for L." />
        <NumRow a={a} k="carryDays" id="carry-over" help="Unfinished to-dos offered again. 0 turns it off." step={1} max={30} />
        <SwitchRow a={a} k="suggest" id="suggest-empty-blocks" {...say("Today's and your next working day's empty blocks offer to-dos: unfinished ones first, then your backlog. Nothing is planned until you keep it. Also under Week's and Day's View options as Suggestions.")} />
        <Row id="devops-on-done" {...say("Ask opens Wrap it up: Finished or Made progress, a comment, and one preview of what goes to DevOps. Only for items you can change, on clients with DevOps writes. Nothing is written without Confirm.")} mark={markOf(a, "devopsOnDone")}>
          <Choice
            options={[
              { value: "ask", label: "Ask (Wrap it up)" },
              { value: "never", label: "Always skip DevOps" },
            ]}
            value={a.v.devopsOnDone}
            onChange={(v) => a.change("devopsOnDone", v)}
          />
        </Row>
        <SwitchRow a={a} k="progressOffer" id="progress-offer" {...say("After Close out: Remaining Work where the process has it, else a short comment. Always previewed; nothing is written without Confirm.")} />
      </Group>
      <Group title="Reminders" intro="Each comes as a notification; switch the kinds in Notifications.">
        <NumRow a={a} k="reminderOffsetMinutes" id="plan-reminder" help="Only while today has no to-dos." max={240} />
        <NumRow a={a} k="checkinReminderMinutes" id="checkin-reminder" help="On a day with to-dos. 0 is the end of lunch." max={120} />
        <NumRow a={a} k="closeoutReminderMinutes" id="closeout-reminder" help="Only if Close out isn't done." max={120} />
      </Group>
      <Group>
        <Row id="week-nudges" help="Empty turns a nudge off." />
        {(
          [
            ["weekNudgeThu", "nudge-thu", "For next week."],
            ["weekNudgeFri", "nudge-fri", "For next week, if nothing is on it yet."],
            ["weekNudgeMon", "nudge-mon", "For this week, if nothing is on it yet."],
          ] as const
        ).map(([k, id, help]) => (
          <Row key={k} id={id} help={help} mark={markOf(a, k)}>
            <Time clearable value={a.v[k]} onChange={(t) => a.change(k, t)} />
          </Row>
        ))}
      </Group>
      <Group>
        <AheadRituals />
      </Group>
    </>
  );
}

/** Step 17: when the Look-ahead rituals come next. Their switches are in Settings > Notifications. */
function AheadRituals() {
  const today = Temporal.Now.plainDateISO().toString();
  const n = nextRituals(today);
  const day = (d: string) => Temporal.PlainDate.from(d).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric" });
  return (
    <Row id="rituals" wide help="Both open Backlog › Gantt; switch them in Notifications.">
      <List>
        <ListItem>Look ahead 4 weeks: every other Thursday, once next week has work on it. Next: {day(n.lookAhead)}.</ListItem>
        <ListItem>Direction review (8 to 12 weeks): the first Thursday of each month. Next: {day(n.direction)}.</ListItem>
      </List>
    </Row>
  );
}

/**
 * ADM-1: guidance with a team default by level (Admin › Team defaults › Planning and new people): your own choice over it, and Reset to team
 * default. Levels change emphasis only: none of these ever blocks anything.
 */
function GuidanceForm(p: FormProps) {
  const org = p.data.org;
  const mine = p.data.guidance;
  const a = useAutoSave<{ draftStories: boolean | null; readinessNudges: boolean | null; planShare: number | null }>({
    section: "guidance",
    initial: { draftStories: mine.draftStories ?? null, readinessNudges: mine.readinessNudges ?? null, planShare: mine.planShare ?? null },
    payload: (v) => v,
    onSaved: p.onSavedData,
    label: labelBy({ draftStories: "break-down-offered", readinessNudges: "readiness-nudges" }),
  });
  if (!org) return null;
  const team = org.levelGuidance;
  const level = org.levelName ? `${org.levelName}${org.levelSource === "override" ? " (set by an admin)" : ""}` : "No level from Dataverse yet";
  const onOff = (b: boolean) => (b ? "on" : "off");
  // QT-1: "Plan up to (% of free time)" is gone from the screen. The stored value stays.
  const teamDefault = (k: "draftStories" | "readinessNudges") => <TeamDefault value={onOff(team[k])} onReset={a.v[k] !== null ? () => a.change(k, null) : null} />;
  return (
    <Group title="Guidance" intro="Your level changes emphasis only; none of these ever blocks anything.">
      <Row id="level" help="From your position in Dataverse. It changes suggestions only, never what you can do.">
        <Value>{level}</Value>
      </Row>
      <SwitchRow a={a} k="draftStories" id="break-down-offered" checked={a.v.draftStories ?? team.draftStories} team={teamDefault("draftStories")} />
      <SwitchRow a={a} k="readinessNudges" id="readiness-nudges" help="The Needs attention flags on Backlog's Gantt rows." checked={a.v.readinessNudges ?? team.readinessNudges} team={teamDefault("readinessNudges")} />
    </Group>
  );
}

/** Settings > Day and Week > Timeboxes (step 12): Put on Outlook by default, and asking before changing my own events. */
function TimeboxForm(p: FormProps) {
  const t = p.data.timebox;
  const a = useAutoSave({
    section: "timebox",
    initial: { ...t },
    payload: (v) => v,
    onSaved: p.onSavedData,
    label: labelBy({ enabled: "timeboxing", outlookDefault: "outlook-default", confirmOwn: "confirm-own" }),
  });
  return (
    <Group title="Timeboxes">
      <SwitchRow a={a} k="enabled" id="timeboxing" help="Off hides the time controls; timeboxes are kept." />
      <SwitchRow a={a} k="outlookDefault" id="outlook-default" help="Every new event shows a preview first." />
      {/* SA-2: ticked means FocusTime asks (the stored confirmOwn); it read "Don't ask again" and was ticked the other way. */}
      <SwitchRow a={a} k="confirmOwn" id="confirm-own" help="Off: no question; every change is still logged and can be undone." />
    </Group>
  );
}

/** Settings > Day and Week > Help sessions (step 13): length, Teams, how many workdays "Ask to collaborate" searches. */
function CollabForm(p: FormProps) {
  const c = p.data.collab;
  const a = useAutoSave({
    section: "collab",
    initial: { meetingMinutes: c.meetingMinutes, teams: c.teams, daysAhead: c.daysAhead, exclude: [...c.exclude] },
    payload: (v) => v,
    onSaved: p.onSavedData,
    label: labelBy({ meetingMinutes: "help-length", teams: "help-teams", daysAhead: "help-days", exclude: "exclude" }),
  });
  const [adding, setAdding] = useState("");
  const add = () => {
    if (!adding.trim()) return;
    a.change("exclude", [...a.v.exclude, adding.trim()]);
    setAdding("");
  };
  return (
    <Group title="Help sessions" intro="For Ask to collaborate.">
      <Row id="help-length" help="Where Ask to collaborate starts." mark={markOf(a, "meetingMinutes")}>
        <Select options={COLLAB_LENGTHS.map((m) => ({ value: m, label: `${m} minutes` }))} value={a.v.meetingMinutes} onChange={(m) => a.change("meetingMinutes", m)} />
      </Row>
      <SwitchRow a={a} k="teams" id="help-teams" help="You can turn it off per invite." />
      <NumRow a={a} k="daysAhead" id="help-days" help="Workdays from today, for items not pinned to a day." min={1} max={10} step={1} />
      {p.data.org && (
        <Row id="never-suggested" team>
          <Value>{p.data.org.rules.neverSuggest.join(", ") || "Nobody"}</Value>
        </Row>
      )}
      <Row id="exclude" wide help="Never suggested as helpers or as Who. By name or email." mark={markOf(a, "exclude")}>
        <List
          add={
            <>
              <Text
                value={adding}
                maxLength={200}
                placeholder="Name or email"
                label="Add a person to exclude"
                onChange={setAdding}
                bind={{
                  onKeyDown: (e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      add();
                    }
                  },
                }}
              />
              <Button disabled={!adding.trim()} onClick={add}>
                Add
              </Button>
            </>
          }
        >
          {a.v.exclude.map((x, i) => (
            <ListItem key={`${x}:${i}`} removeLabel={`Remove ${x}`} onRemove={() => a.change("exclude", a.v.exclude.filter((_, j) => j !== i))}>
              {x}
            </ListItem>
          ))}
        </List>
      </Row>
      <Row id="invite-domains" help={p.data.fromFile ? "Set in config.toml ([collab] domains)" : null} team={p.data.fromFile ? undefined : true}>
        <Value>{c.domains.join(", ") || "No domain yet"}</Value>
      </Row>
    </Group>
  );
}

function RiskFields(p: FormProps) {
  const r = p.data.risk!;
  const a = useAutoSave({
    section: "risk",
    initial: { meetingWatchMinutes: r.meetingWatchMinutes, meetingAtRiskMinutes: r.meetingAtRiskMinutes, minFocusWindowMinutes: r.minFocusWindowMinutes },
    payload: (v) => v,
    onSaved: p.onSavedData,
    label: labelBy({ meetingWatchMinutes: "risk-watch", meetingAtRiskMinutes: "risk-at-risk", minFocusWindowMinutes: "risk-window" }),
  });
  return (
    <Group>
      <Row id="risk-rules" help="When a block's meetings make it Watch or At risk." />
      <NumRow a={a} k="meetingWatchMinutes" id="risk-watch" help="A block with this many minutes of meetings is marked Watch." max={600} />
      <NumRow a={a} k="meetingAtRiskMinutes" id="risk-at-risk" help="At least the Watch value." max={600} />
      <NumRow a={a} k="minFocusWindowMinutes" id="risk-window" help="With no free stretch this long, the block is at risk." max={600} />
    </Group>
  );
}
