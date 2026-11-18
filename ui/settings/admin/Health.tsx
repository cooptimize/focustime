// SA-4: Admin › Health (Admin › Status until SA-4): how FocusTime is doing here. Nothing on it is a setting, so it
// carries no "Changes save" line. Moved from ui/settings/Admin.tsx unchanged. Names and states only; never a secret.
import { STATUS_WORD, type ConversationStatus } from "../../../plan/conversations.ts";
import type { StatusGroup } from "../../../actions/status-rows.ts";
import { StatusRows } from "../StatusRows.tsx";
import { useSection, when } from "./shared.tsx";


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
  if (error) return <p className="field-problem">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;
  const ok = (b: boolean, yes: string, no: string) => <span className={b ? "adm-ok" : "field-problem"}>{b ? yes : no}</span>;
  return (
    <div className="set-form">
      <p className="muted">Names and states only; never a secret's value.</p>
      {data.warnings && data.warnings.length > 0 && (
        <div className="adm-warnings">
          <h3>To look at ({data.warnings.length})</h3>
          <ul className="set-list">
            {data.warnings.map((w, i) => (
              <li key={i} className="set-problem">
                {w.text}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="set-grid">
        <div className="set-field">
          <span className="set-label">This environment</span>
          <span className="set-value">
            {data.environment} · {data.version.sha}
            {data.version.pr ? ` · PR #${data.version.pr}` : ""}
            {data.version.builtAt ? ` · built ${when(data.version.builtAt)}` : ""}
          </span>
          <span className="set-hint">Each environment shows its own version here (dev and prod are separate FocusTimes).</span>
        </div>
        <div className="set-field">
          <span className="set-label">OpenAI key</span>
          <span className="set-value">{ok(data.ai.keyConfigured, `Configured (${data.ai.provider})`, "Not configured")}</span>
        </div>
        <div className="set-field">
          <span className="set-label">Send feedback</span>
          <span className="set-value">{ok(data.feedback.ok, data.feedback.message, data.feedback.message)}</span>
        </div>
        <div className="set-field">
          <span className="set-label">Dataverse people and leads</span>
          <span className="set-value">{ok(data.dataverse.ok, data.dataverse.refreshedAt ? `Read ${when(data.dataverse.refreshedAt)}` : "Not read yet", data.dataverse.message ?? "Not read")}</span>
        </div>
        <div className="set-field">
          <span className="set-label">Teams and DevOps permissions</span>
          <span className="set-value">Per person: Microsoft permissions in Settings › Accounts and calendars, DevOps write access in Settings › DevOps.</span>
        </div>
      </div>
      {data.jobs && data.jobs.length > 0 && (
        <>
          <h3>Jobs</h3>
          <table className="adm-table adm-rows-phone">
            <thead>
              <tr>
                <th scope="col">Job</th>
                <th scope="col">When</th>
                <th scope="col">Last run</th>
              </tr>
            </thead>
            <tbody>
              {data.jobs.map((j) => (
                <tr key={j.name}>
                  <th scope="row">{j.name}</th>
                  <td>{j.every}</td>
                  <td>{j.note ? <span className="muted">{j.note}</span> : when(j.lastRun)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {data.passes && data.passes.length > 0 && (
        <>
          <h3>Background passes</h3>
          <p className="muted">Each piece of work in a pass has a time limit; work over it is named in the log and left behind, and the next pass runs anyway.</p>
          <table className="adm-table adm-rows-phone" data-status="passes">
            <thead>
              <tr>
                <th scope="col">Pass</th>
                <th scope="col">Last finished</th>
                <th scope="col">Took</th>
                <th scope="col">Limit</th>
              </tr>
            </thead>
            <tbody>
              {data.passes.map((x) => (
                <tr key={x.kind} data-pass={x.kind}>
                  <th scope="row">{PASS_WORDS[x.kind] ?? x.kind}</th>
                  <td>{x.warning ? <span className="field-problem">{x.warning}</span> : when(x.finishedAt)}</td>
                  <td>{took(x.ms)}</td>
                  <td>{took(x.limitMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {data.groups?.length ? <StatusRows groups={data.groups} /> : null}
      <h3>Client chats</h3>
      <p className="muted">Last poll: {when(data.lastPoll)}.</p>
      {data.chats.length === 0 ? (
        <p className="muted">No chats registered.</p>
      ) : (
        <table className="adm-table adm-rows-phone">
          <thead>
            <tr>
              <th scope="col">Chat</th>
              <th scope="col">Client</th>
              <th scope="col">Reading</th>
              <th scope="col">Last poll</th>
              <th scope="col">State</th>
              <th scope="col">AI calls today</th>
            </tr>
          </thead>
          <tbody>
            {data.chats.map((c) => (
              <tr key={c.chatId}>
                <th scope="row">{c.name}</th>
                <td>{c.clientKey}</td>
                <td>{c.reading ? "On" : "Off"}</td>
                <td>{when(c.polledAt)}</td>
                <td>
                  {c.state ? (POLL_WORDS[c.state] ?? c.state) : <span className="muted">Not polled yet</span>}
                  {c.via ? ` · via ${c.via}` : ""}
                  {c.note ? ` · ${c.note}` : ""}
                </td>
                <td>{data.conversations ? (data.conversations.aiCallsToday.find((x) => x.chatName === c.name && x.clientKey === c.clientKey)?.calls ?? 0) : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h3>Conversations</h3>
      {data.conversations ? (
        <div className="set-grid">
          <div className="set-field">
            <span className="set-label">Conversations</span>
            <span className="set-value">{countLine(Object.fromEntries(Object.entries(data.conversations.conversationsByStatus).map(([k, n]) => [STATUS_WORD[k as ConversationStatus] ?? k, n])), {})}</span>
          </div>
          <div className="set-field">
            <span className="set-label">Messages</span>
            <span className="set-value">{countLine(data.conversations.messagesByRole, ROLE_WORDS)}</span>
          </div>
          <div className="set-field">
            <span className="set-label">Commitments</span>
            <span className="set-value">{countLine(data.conversations.commitmentsByState, COMMIT_WORDS)}</span>
            <span className="set-hint">Counts only, for every registered chat; never what was said.</span>
          </div>
        </div>
      ) : (
        <p className="muted">Not available here.</p>
      )}
    </div>
  );
}
