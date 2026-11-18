// SA-4: Admin › Health (Admin › Status until SA-4): how FocusTime is doing here. Nothing on it is a setting, so it
// carries no "Changes save" line. Names and states only; never a secret. SA-4 F: groups, read-only rows and the one
// table style (SA-2's parts).
import { STATUS_WORD, type ConversationStatus } from "../../../plan/conversations.ts";
import type { StatusGroup } from "../../../actions/status-rows.ts";
import { StatusRows } from "../StatusRows.tsx";
import { Group, List, ListItem, Note, Page, State, Table, Value } from "../parts.tsx";
import { ARead, Problem, useSection, when } from "./shared.tsx";


type StatusData = {
  environment: string;
  version: { env: string; sha: string; pr: string; builtAt: string | null };
  ai: { provider: string; keyConfigured: boolean };
  feedback: { ok: boolean; message: string };
  dataverse: { refreshedAt: string | null; ok: boolean; message: string | null };
  chats: { chatId: string; clientKey: string; name: string; reading: boolean; polledAt: string | null; state: string | null; note: string | null; via: string | null }[];
  lastPoll: string | null;
  conversations: { conversationsByStatus: Record<string, number>; messagesByRole: Record<string, number>; commitmentsByState: Record<string, number>; aiCallsToday: { chatName: string; clientKey: string; calls: number }[] } | null;
  warnings?: { area: string; text: string }[];
  jobs?: { name: string; every: string; lastRun: string | null; note: string | null }[];
  groups?: StatusGroup[];
  passes?: { kind: "fast" | "slow"; finishedAt: string | null; ms: number | null; since: string | null; limitMs: number; warning: string | null }[];
};
const PASS_WORDS: Record<string, string> = { fast: "Fast pass (focus timer, notices)", slow: "Slow pass (VM start, reminders, chat reads)" };
const took = (ms: number | null) => (ms === null ? "" : ms < 1000 ? "under a second" : ms < 60_000 ? `${Math.round(ms / 1000)} seconds` : `${Math.round(ms / 60_000)} minutes`);
const ROLE_WORDS: Record<string, string> = { work: "work", chatter: "chatter", ack: "short replies", unsorted: "unsorted" };
const COMMIT_WORDS: Record<string, string> = { open: "open", followup: "promises", linked: "linked", created: "item created", done: "done", not_needed: "not needed" };
const countLine = (m: Record<string, number>, words: Record<string, string>) => Object.entries(m).map(([k, n]) => `${n} ${words[k] ?? k}`).join(" · ");
const POLL_WORDS: Record<string, string> = { ok: "OK", via: "Read with another follower's sign-in", reconnect: "Needs reconnecting", retry: "Retrying" };

export function HealthPart() {
  const { data, error } = useSection<StatusData>("status");
  if (error) return <Problem>{error}</Problem>;
  if (!data) return <Note>Loading…</Note>;
  const ok = (b: boolean, yes: string, no: string) => (b ? <State tone="live">{yes}</State> : <State tone="error">{no}</State>);
  const warnings = data.warnings ?? [];
  return (
    <Page>
      {warnings.length > 0 && (
        <Group title={`To look at (${warnings.length})`} label="To look at">
          <List label="To look at">
            {warnings.map((w, i) => (
              <ListItem key={i}>
                <State tone="error">{w.text}</State>
              </ListItem>
            ))}
          </List>
        </Group>
      )}
      <Group title="This FocusTime" label="This FocusTime" intro="Names and states only; never a secret's value.">
        <ARead label="This environment" help="Each environment shows its own version here (dev and prod are separate FocusTimes).">
          <Value>
            {data.environment} · {data.version.sha}
            {data.version.pr ? ` · PR #${data.version.pr}` : ""}
            {data.version.builtAt ? ` · built ${when(data.version.builtAt)}` : ""}
          </Value>
        </ARead>
        <ARead label="OpenAI key">{ok(data.ai.keyConfigured, `Configured (${data.ai.provider})`, "Not configured")}</ARead>
        <ARead label="Send feedback">{ok(data.feedback.ok, data.feedback.message, data.feedback.message)}</ARead>
        <ARead label="Dataverse people and leads">{ok(data.dataverse.ok, data.dataverse.refreshedAt ? `Read ${when(data.dataverse.refreshedAt)}` : "Not read yet", data.dataverse.message ?? "Not read")}</ARead>
        <ARead label="Teams and DevOps permissions" help="Per person: Microsoft permissions in Settings › Connections, DevOps write access in Settings › Connections › DevOps." >
          {null}
        </ARead>
      </Group>
      {data.jobs && data.jobs.length > 0 && (
        <Group title="Jobs" label="Jobs">
          <Table rowHeads label="Jobs" head={["Job", "When", "Last run"]} rowKey={(i) => data.jobs![i]!.name} rows={data.jobs.map((j) => [j.name, j.every, j.note ?? when(j.lastRun)])} />
        </Group>
      )}
      {data.passes && data.passes.length > 0 && (
        <Group title="Background passes" label="Background passes" intro="Each piece of work in a pass has a time limit; work over it is named in the log and left behind, and the next pass runs anyway.">
          <Table rowHeads
            label="Background passes"
            head={["Pass", "Last finished", "Took", "Limit"]}
            rowKey={(i) => data.passes![i]!.kind}
            rowTone={(i) => (data.passes![i]!.warning ? "failed" : undefined)}
            rows={data.passes.map((x) => [PASS_WORDS[x.kind] ?? x.kind, x.warning ? <State key="w" tone="error">{x.warning}</State> : when(x.finishedAt), took(x.ms), took(x.limitMs)])}
          />
        </Group>
      )}
      {data.groups?.length ? <StatusRows groups={data.groups} /> : null}
      <Group title="Client chats" label="Client chats" intro={`Last poll: ${when(data.lastPoll)}.`}>
        {data.chats.length === 0 ? (
          <Note>No chats registered.</Note>
        ) : (
          <Table rowHeads
            label="Client chats"
            head={["Chat", "Client", "Reading", "Last poll", "State", "AI calls today"]}
            rowKey={(i) => data.chats[i]!.chatId}
            rows={data.chats.map((c) => [
              c.name,
              c.clientKey,
              c.reading ? "On" : "Off",
              when(c.polledAt),
              `${c.state ? (POLL_WORDS[c.state] ?? c.state) : "Not polled yet"}${c.via ? ` · via ${c.via}` : ""}${c.note ? ` · ${c.note}` : ""}`,
              data.conversations ? String(data.conversations.aiCallsToday.find((x) => x.chatName === c.name && x.clientKey === c.clientKey)?.calls ?? 0) : "–",
            ])}
          />
        )}
      </Group>
      <Group title="Conversations" label="Conversations" intro="Counts only, for every registered chat; never what was said.">
        {data.conversations ? (
          <>
            <ARead label="Conversations">
              <Value>{countLine(Object.fromEntries(Object.entries(data.conversations.conversationsByStatus).map(([k, n]) => [STATUS_WORD[k as ConversationStatus] ?? k, n])), {})}</Value>
            </ARead>
            <ARead label="Messages">
              <Value>{countLine(data.conversations.messagesByRole, ROLE_WORDS)}</Value>
            </ARead>
            <ARead label="Commitments">
              <Value>{countLine(data.conversations.commitmentsByState, COMMIT_WORDS)}</Value>
            </ARead>
          </>
        ) : (
          <Note>Not available here.</Note>
        )}
      </Group>
    </Page>
  );
}
