// SA-3: Settings › Planning (was Day and Week, with Backlog's three numbers): how to-dos, timeboxes and DevOps updates
// work on top, and the tuning numbers in one closed fold, "Fine tuning · 14 more", that says how many were changed.
import { useState, type ReactNode } from "react";
import { COLLAB_LENGTHS, DEFAULT_COLLAB, DEFAULT_PLAN } from "../../../config/schema.ts";
import { DEFAULT_AHEAD } from "../../../plan/backlog.ts";
import { DEFAULT_THRESHOLDS } from "../../../plan/roadmap.ts";
import { hoursText, STORY_SIZES, UNSIZED_CHOICES, unsizedText } from "../../../plan/estimate.ts";
import { useAutoSave } from "../autosave.tsx";
import { Button, Choice, Fold, Group, List, ListItem, Note, Num, Page, Row, Select, Subhead, Text, TeamDefault, Value } from "../parts.tsx";
import { FOLDS } from "../registry.ts";
import { NumRow, SwitchRow } from "./fields.tsx";
import { firstLine, labelBy, markOf, rest } from "./shared.ts";
import type { FormProps } from "./types.ts";
import { usePlan } from "./usePlan.ts";

/** The risk numbers a new person starts with (config/starter.ts), for the fold's "changed" count. */
const STARTER_RISK = { meetingWatchMinutes: 90, meetingAtRiskMinutes: 150, minFocusWindowMinutes: 90 };

/** SA-3: how many of the fold's 14 settings differ from where a person starts, from what is saved. */
export function tuningChanged(d: FormProps["data"]): number {
  const pl = d.planning;
  const c = d.collab;
  const r = d.risk;
  return [
    pl.minSizes.S !== DEFAULT_PLAN.minSizes.S,
    pl.minSizes.M !== DEFAULT_PLAN.minSizes.M,
    pl.minSizes.L !== DEFAULT_PLAN.minSizes.L,
    pl.carryDays !== DEFAULT_PLAN.carryDays,
    !!r && r.meetingWatchMinutes !== STARTER_RISK.meetingWatchMinutes,
    !!r && r.meetingAtRiskMinutes !== STARTER_RISK.meetingAtRiskMinutes,
    !!r && r.minFocusWindowMinutes !== STARTER_RISK.minFocusWindowMinutes,
    c.meetingMinutes !== DEFAULT_COLLAB.meetingMinutes,
    c.teams !== DEFAULT_COLLAB.teams,
    c.daysAhead !== DEFAULT_COLLAB.daysAhead,
    c.exclude.length > 0,
    (d.ahead?.staleWeeks ?? DEFAULT_AHEAD.staleWeeks) !== DEFAULT_AHEAD.staleWeeks,
    d.roadmap.stalledDays !== DEFAULT_THRESHOLDS.stalledDays,
    d.roadmap.watchWeeks !== DEFAULT_THRESHOLDS.watchWeeks,
  ].filter(Boolean).length;
}
/** The settings in Fine tuning (part rows count; the team's two lines and the group rows don't). */
export const TUNING_COUNT = 14;

export function PlanningSection(p: FormProps) {
  return (
    <Page>
      <Group>
        <PlanningForm {...p} />
        <GuidanceForm {...p} />
      </Group>
      <TimeboxForm {...p} />
      <Group sid="fine-tuning">
        <Fold label={FOLDS.tuning} count={TUNING_COUNT} more changed={tuningChanged(p.data)}>
          <TuningForm {...p} />
          {p.data.risk && <RiskFields {...p} />}
          <CollabForm {...p} />
          <BacklogFields {...p} />
        </Fold>
      </Group>
    </Page>
  );
}

/** A titled part of Fine tuning. */
function Part({ title, children, sid }: { title: string; children: ReactNode; sid?: string }) {
  return (
    <>
      <Subhead sid={sid}>{title}</Subhead>
      {children}
    </>
  );
}

const say = (t: string) => ({ help: firstLine(t), more: rest(t) });

/** SA-3: Planning's rows on top (the focus timer is under Focus, following under Clients). */
function PlanningForm(p: FormProps) {
  const a = usePlan(p, ["unsizedMinutes", "suggest", "devopsOnDone", "progressOffer"] as const);
  const sizes = p.data.planning.sizes;
  return (
    <>
        <Row id="count-unsized" {...say("Used wherever a to-do or story has no size yet, in every fit and budget. Nothing is written to DevOps.")} mark={markOf(a, "unsizedMinutes")} below={<Note>{STORY_SIZES.map((z) => `${z} ${sizes[z] < 60 ? `${sizes[z]} min` : hoursText(sizes[z])}`).join(" · ")}</Note>}>
          <Choice options={UNSIZED_CHOICES.map((m) => ({ value: m, label: unsizedText({ ...sizes, unsized: m }) }))} value={a.v.unsizedMinutes} onChange={(m) => a.change("unsizedMinutes", m)} />
        </Row>
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
    </>
  );
}

/** Fine tuning: the shortest useful time per size, and carry-over. */
function TuningForm(p: FormProps) {
  const a = usePlan(p, ["minS", "minM", "minL", "carryDays"] as const);
  return (
    <>
      <Part title="Shortest useful time per size" sid="shortest-useful-time">
        <NumRow a={a} k="minS" id="shortest-s" help="The least Timebox my day gives an S to-do (S is 1h, M 2h, L 4h)." />
        <NumRow a={a} k="minM" id="shortest-m" help="The same for M." />
        <NumRow a={a} k="minL" id="shortest-l" help="The same for L." />
      </Part>
      <Part title="Carry-over">
        <NumRow a={a} k="carryDays" id="carry-over" help="Unfinished to-dos offered again. 0 turns it off." step={1} max={30} />
      </Part>
    </>
  );
}

/** Fine tuning › Backlog (was Settings › Backlog; step 17, BH-1). Whole numbers. */
function BacklogFields(p: FormProps) {
  const r = p.data.roadmap;
  const a = useAutoSave({ section: "roadmap", initial: { stalledDays: r.stalledDays, watchWeeks: r.watchWeeks }, payload: (v) => v, onSaved: p.onSavedData, label: labelBy({ stalledDays: "stalled-days", watchWeeks: "watch-weeks" }) });
  const b = useAutoSave({ section: "ahead", initial: { staleWeeks: p.data.ahead?.staleWeeks ?? DEFAULT_AHEAD.staleWeeks }, payload: (v) => v, onSaved: p.onSavedData, label: labelBy({ staleWeeks: "stale-weeks" }) });
  return (
    <Part title="Backlog">
      <Row id="stale-weeks" help="Open items with no change in DevOps for this long. 1 to 26." mark={markOf(b, "staleWeeks")}>
        <Num min={1} max={26} value={b.v.staleWeeks} onChange={(n) => b.set("staleWeeks", Math.round(n))} bind={b.text("staleWeeks")} />
      </Row>
      <Row id="stalled-days" help="Days with no story change. 3 to 60." mark={markOf(a, "stalledDays")}>
        <Num min={3} max={60} value={a.v.stalledDays} onChange={(n) => a.set("stalledDays", Math.round(n))} bind={a.text("stalledDays")} />
      </Row>
      <Row id="watch-weeks" help="Forecast this close to the target. 0 to 4; 0 is never." mark={markOf(a, "watchWeeks")}>
        <Num min={0} max={4} value={a.v.watchWeeks} onChange={(n) => a.set("watchWeeks", Math.round(n))} bind={a.text("watchWeeks")} />
      </Row>
    </Part>
  );
}

/**
 * ADM-1: guidance with a team default by level (Admin › Organization): your own choice over it, and Reset to team
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
  const onOff = (b: boolean) => (b ? "on" : "off");
  // QT-1: "Plan up to (% of free time)" is gone from the screen. The stored value stays.
  const teamDefault = (k: "draftStories" | "readinessNudges") => <TeamDefault value={onOff(team[k])} onReset={a.v[k] !== null ? () => a.change(k, null) : null} />;
  return (
    <>
      <SwitchRow a={a} k="draftStories" id="break-down-offered" help="Your team's default follows your level (Profile); it changes emphasis only and never blocks anything." checked={a.v.draftStories ?? team.draftStories} team={teamDefault("draftStories")} />
      <SwitchRow a={a} k="readinessNudges" id="readiness-nudges" help="The Needs attention flags on Backlog's Gantt rows." checked={a.v.readinessNudges ?? team.readinessNudges} team={teamDefault("readinessNudges")} />
    </>
  );
}

/** Settings › Planning › Timeboxes (step 12): Put on Outlook by default, and asking before changing my own events. */
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

/** Settings › Planning › Fine tuning › Help sessions (step 13): length, Teams, how many workdays "Ask to collaborate" searches. */
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
    <Part title="Help sessions">
      <Note>For Ask to collaborate.</Note>
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
    </Part>
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
    <Part title="At-risk blocks" sid="risk-rules">
      <Note>When a block's meetings make it Watch or At risk.</Note>
      <NumRow a={a} k="meetingWatchMinutes" id="risk-watch" help="A block with this many minutes of meetings is marked Watch." max={600} />
      <NumRow a={a} k="meetingAtRiskMinutes" id="risk-at-risk" help="At least the Watch value." max={600} />
      <NumRow a={a} k="minFocusWindowMinutes" id="risk-window" help="With no free stretch this long, the block is at risk." max={600} />
    </Part>
  );
}
