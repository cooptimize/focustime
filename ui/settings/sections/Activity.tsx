// SA-3: Your data › What FocusTime changed in other apps (was the Activity section), one log per tab. The Outlook write log is
// drawn here; the DevOps, Azure, Teams status and Close the loop logs are shared components that keep their insides
// (in the parts' one table style) until a later step (docs/open-questions.md, SA-2).
import { useEffect, useState } from "react";
import type { WriteLogView } from "../../../actions/types.ts";
import { responseLabel } from "../../../plan/rsvp.ts";
import type { WriteEntry } from "../../../plan/timebox.ts";
import { NEUTRAL_ZONE, userZone } from "../../../week/zone.ts";
import { AzureWriteLog, LoopSendsLog, TeamsStatusLog } from "../../Account.tsx";
import { call } from "../../api.ts";
import { DevOpsWriteLog } from "../../DevOpsWrite.tsx";
import { useTimeboxes } from "../../Timeboxes.tsx";
import { Button, Buttons, Group, List, ListItem, Note, Row, State, Subhead, Table } from "../parts.tsx";
import type { BodyProps } from "./types.ts";

export type LogTab = "write-log" | "devops-log" | "azure-log" | "teams-log" | "loop-log";
/** The tabs, in Activity's order, named for where the change went. */
export const LOG_TABS: readonly { id: LogTab; label: string }[] = [
  { id: "write-log", label: "Outlook" },
  { id: "devops-log", label: "DevOps" },
  { id: "azure-log", label: "Azure" },
  { id: "teams-log", label: "Teams status" },
  { id: "loop-log", label: "Close the loop" },
];

export function ActivityLog({ tab, ...p }: BodyProps & { tab: LogTab }) {
  const tz = userZone(p.data.you);
  if (tab === "write-log") return <WriteLog />;
  return (
    <Group sid={tab} label={LOG_TABS.find((t) => t.id === tab)!.label}>
      {tab === "devops-log" ? <DevOpsWriteLog /> : tab === "azure-log" ? <AzureWriteLog tz={tz} /> : tab === "teams-log" ? <TeamsStatusLog tz={tz} /> : <LoopSendsLog tz={tz} />}
    </Group>
  );
}

const OPS: Record<WriteEntry["op"], string> = {
  create: "Created",
  update: "Changed",
  delete: "Removed",
};
const KINDS: Record<WriteEntry["kind"], string | null> = {
  timebox: null,
  event: "Your event",
  invite: "Help invite",
  sync: "From Outlook",
  rsvp: "Response",
};
const STATUS: Record<WriteEntry["status"], string> = {
  pending: "Not finished",
  confirmed: "Confirmed",
  unconfirmed: "Not confirmed",
  failed: "Failed",
  refused: "Refused",
};

/** Step 12: every Outlook write, newest first, with Undo and Retry; and FocusTime events left on Outlook. */
function WriteLog() {
  const env = useTimeboxes();
  const [log, setLog] = useState<WriteLogView | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    call<WriteLogView>("write.log", {}).then(setLog, (e: unknown) => setError(e instanceof Error ? e.message : "The write log could not load"));
  }, [env?.timeboxes]);
  const tz = env?.tz ?? NEUTRAL_ZONE;
  const stamp = (s: string) =>
    Temporal.ZonedDateTime.from(s).withTimeZone(tz).toPlainDateTime().toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  const clock = (iso: string) => Temporal.Instant.from(iso).toZonedDateTimeISO(tz).toPlainTime().toLocaleString("en-US", { hour: "numeric", minute: "2-digit" });
  const entries = log?.entries ?? [];
  return (
    <Row
      id="write-log"
      wide
      help="Every change FocusTime made in other apps."
      below={error ? <Note tone="problem">{error}</Note> : log && !entries.length ? <Note>Nothing written yet.</Note> : undefined}
    >
      {log && log.orphans.length > 0 && (
        <>
          <Subhead>FocusTime events with no timebox</Subhead>
          <List>
            {log.orphans.map((o) => (
              <ListItem key={o.uid} extra={<Button onClick={() => void env?.sync(o.uid)}>Remove from Outlook</Button>}>
                {o.title} · {o.when}
              </ListItem>
            ))}
          </List>
        </>
      )}
      {entries.length > 0 && (
        <Table
          label="Outlook write log"
          head={[
            "When",
            "What",
            "Where",
            "Result",
            "Before",
            <State key="a" sr>
              Actions
            </State>,
          ]}
          rowKey={(i) => entries[i]!.id}
          rowTone={(i) => entries[i]!.status}
          rows={entries.map((e) => [
            stamp(e.at),
            <>
              {KINDS[e.kind] && <State tone="muted">{KINDS[e.kind]}</State>} {e.undoOf !== null ? "Undo: " : ""}
              {e.kind === "sync" ? (e.message ?? OPS[e.op]).replace(/^From Outlook: /, "") : e.kind === "rsvp" ? `${responseLabel(e.after?.response)} to` : OPS[e.op]}{" "}
              {(e.after ?? e.before)?.subject ?? ""}
              {e.whenText ? ` · ${e.whenText}` : ""}
              {e.auto && e.kind !== "sync" ? " · without asking" : ""}
            </>,
            `Outlook${e.calendar ? ` · ${e.calendar}` : ""}${e.account ? ` · ${e.account}` : ""}`,
            <>
              {STATUS[e.status]}
              {e.undoneBy !== null ? " · undone" : ""}
              {e.attempts > 1 ? ` · ${e.attempts} tries` : ""}
              {e.message && e.status !== "confirmed" ? ` · ${e.message}` : ""}
            </>,
            e.kind === "rsvp" ? responseLabel(e.before?.response) : e.before ? `${e.before.subject}, ${clock(e.before.start)} to ${clock(e.before.end)}` : "Nothing (new)",
            e.undoable || e.retryable ? (
              <Buttons>
                {e.undoable && <Button onClick={() => void env?.undo(e.id)}>Undo</Button>}
                {e.retryable && <Button onClick={() => void env?.retry(e.id)}>Retry</Button>}
              </Buttons>
            ) : null,
          ])}
        />
      )}
    </Row>
  );
}
