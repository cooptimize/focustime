// SA-3: Connections › DevOps (was its own section): each client's read state, my write access per client, Find an
// item. A write PAT keeps its Check and save: it must be checked first (whose PAT it is), and it is never shown again
// once saved.
import { useRef, useState } from "react";
import type { SettingsData } from "../../../actions/types.ts";
import type { FindAnswer } from "../../../plan/devops-fresh-types.ts";
import type { ClientWork } from "../../../week/types.ts";
import { call } from "../../api.ts";
import { shortDate } from "../../labels.ts";
import { Button, Buttons, DateInput, Fold, Form, Group, Note, Result, Row, Secret, Select, State, StatusItem, StatusList, Sub, Subhead, Text } from "../parts.tsx";
import type { BodyProps } from "./types.ts";

const DEVOPS_STATE: Record<ClientWork["status"], string> = { ok: "Live", identity_missing: "No identity", not_set_up: "Not set up", auth_failed: "PAT problem", no_access: "No access", unreachable: "Unreachable", error: "Error" };

/** SA-3: the DevOps card: a state line, Retry, each client's read state; write access and Find an item under More. */
export function DevOpsCard(p: BodyProps) {
  const d = p.data;
  const withDevOps = d.clients.filter((c) => c.devops);
  const read = p.devops ?? [];
  const live = read.filter((c) => c.status === "ok").length;
  const writes = withDevOps.filter((c) => c.write).length;
  return (
    <Group title="DevOps" intro="Your clients' work items: read for everyone with the company PAT from Dataverse; written only with your own PAT, per client.">
      <Buttons>
        <State tone={read.length && live === read.length ? "live" : read.length ? "error" : "muted"}>{read.length ? `${live} of ${read.length} clients read · writes on for ${writes}` : "No DevOps yet"}</State>
        <Button disabled={p.loading} onClick={p.onRefresh}>
          {p.loading ? "Retrying…" : "Retry"}
        </Button>
      </Buttons>
        <Row id="devops-read" wide help="FocusTime reads with the company PAT from Dataverse, only when fetching; it is never shown.">
          {p.devops && p.devops.length > 0 ? (
            <StatusList>
              {p.devops.map((c) => {
                const ok = c.status === "ok";
                const tone = ok ? (c.fromCache ? "cached" : "live") : "error";
                return (
                  <StatusItem
                    key={c.clientKey}
                    tone={tone}
                    name={c.clientName}
                    state={ok ? (c.fromCache ? "Cached" : "Live") : DEVOPS_STATE[c.status]}
                    detail={`${ok ? `${c.items.length} ${c.items.length === 1 ? "item" : "items"} assigned` : c.message}${c.status === "auth_failed" || c.status === "not_set_up" || c.status === "identity_missing" ? ". Change it in Dataverse" : ""}`}
                    actions={
                      <Button disabled={p.loading} onClick={p.onRefresh}>
                        {p.loading ? "Retrying…" : "Retry"}
                      </Button>
                    }
                  />
                );
              })}
            </StatusList>
          ) : (
            <Note>No DevOps yet. It comes from each followed client's record in Dataverse.</Note>
          )}
        </Row>
      <Fold label="Write access and Find an item">
        <Subhead sid="devops-write">DevOps write access</Subhead>
        <Note>Your own PAT per client, with Work Items (Read & write). FocusTime checks it is yours, keeps it sealed and never shows it again.</Note>
        {withDevOps.length === 0 ? <Note>No client has DevOps set up in Dataverse.</Note> : withDevOps.map((c) => <WriteAccess key={c.key} client={c} onDone={p.reload} />)}
        <FindItem clients={withDevOps.map((c) => ({ key: c.key, name: c.setting.name ?? c.dataverseName ?? c.key }))} />
      </Fold>
    </Group>
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
  const name = c.setting.name ?? c.dataverseName ?? c.key;
  const daysLeft = w?.expires ? Temporal.PlainDate.from(w.expires).since(Temporal.Now.plainDateISO()).days : null;
  const save = async () => {
    const value = ref.current?.value ?? "";
    const input: Record<string, unknown> = { clientKey: c.key };
    if (value) input.pat = value;
    if (expires !== (w?.expires ?? "")) input.expires = expires || null;
    if (Object.keys(input).length === 1) return setStatus("Nothing to save");
    setBusy(true);
    setStatus(value ? "Checking whose PAT this is…" : null);
    try {
      await call("devops.set_write_pat", input);
      setStatus(value ? "Checked and saved. It is never shown again" : "Expiry date saved");
      await onDone();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Not saved");
    } finally {
      if (ref.current) ref.current.value = "";
      setBusy(false);
    }
  };
  return (
    <StatusList>
      <StatusItem
        tone={w ? "live" : "muted"}
        name={name}
        state={w ? "On" : "Off, read-only"}
        detail={
          <>
            {w ? `as ${w.name} (${w.email}) on ${w.org}${w.expires ? `, expires ${shortDate(w.expires)}` : ""}` : "Your own PAT with Work Items (Read & write)."}
            {w?.expires && daysLeft !== null && daysLeft < 14 && (
              <>
                {" "}
                <State tone="error">Expires in {Math.max(0, daysLeft)} days</State>
              </>
            )}
          </>
        }
        below={
          <Form label={`DevOps write access for ${c.setting.name ?? c.key}`} onSubmit={() => void save()}>
          <Buttons>
            <Secret inputRef={ref} placeholder={w ? "New PAT to replace it" : "Paste your PAT"} label={`DevOps write PAT for ${c.setting.name ?? c.key} (masked)`} />
            <Sub text="Expires (optional)">
              <DateInput value={expires} onChange={setExpires} label="Expires (optional)" title="DevOps doesn't tell FocusTime the expiry; copy it from the PAT page" />
            </Sub>
            <Button type="submit" kind="main" disabled={busy}>
              {busy ? "Checking…" : "Check and save"}
            </Button>
            {w && (
              <Button
                kind="quiet"
                disabled={busy}
                onClick={async () => {
                  await call("devops.clear_write_pat", { clientKey: c.key }).catch(() => null);
                  setStatus("Turned off. Your PAT was removed");
                  await onDone();
                }}
              >
                Turn off
              </Button>
            )}
          </Buttons>
          {status && <Result>{status}</Result>}
          </Form>
        }
      />
    </StatusList>
  );
}

const PART: Record<FindAnswer["lines"][number]["part"], string> = { devops: "DevOps", store: "FocusTime", scope: "Scope", day: "Day", week: "Week", ahead: "Backlog", status: "Status" };

/**
 * DV-2: Find an item. One of my clients and an item number; the answer, in order: whether DevOps has it, whether
 * FocusTime has it (and how fresh), the scope, then Day, Week, Backlog and Status, each with why not. It answers from
 * FocusTime's store (never a request to DevOps), only for a client I can already see.
 */
function FindItem({ clients }: { clients: { key: string; name: string }[] }) {
  const [client, setClient] = useState(clients[0]?.key ?? "");
  const [id, setId] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<FindAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const help = "Why an item isn't showing: whether FocusTime's last check of DevOps found it, the scope, and where it shows.";
  const more = "It answers from what FocusTime already read; Refresh checks DevOps now.";
  if (!clients.length) return <Row id="find-item" help={help} more={more} below={<Note>No client has DevOps set up for you yet.</Note>} />;
  const submit = async () => {
    const n = id.trim().replace(/^#/, "");
    if (!/^\d{1,9}$/.test(n)) return setError("Type an item number, like 4417");
    setBusy(true);
    setError(null);
    try {
      setAnswer(await call<FindAnswer>("devops.find", { clientKey: client, itemId: Number(n) }));
    } catch (x) {
      setAnswer(null);
      setError(x instanceof Error ? x.message : "That didn't work");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Row
      id="find-item"
      wide
      help={help}
      more={more}
      below={
        <>
          {error && <Result tone="problem">{error}</Result>}
          {answer && (
            <StatusList label={`What FocusTime knows about #${answer.id}`}>
              {answer.lines.map((l, i) => (
                <StatusItem key={i} tone={l.ok ? "live" : "error"} name={PART[l.part]} detail={l.text} />
              ))}
            </StatusList>
          )}
        </>
      }
    >
      <Form label="Find an item" onSubmit={() => void submit()}>
        <Select label="Client" options={clients.map((c) => ({ value: c.key, label: c.name }))} value={client} onChange={setClient} />
        <Text label="Item number" inputMode="numeric" value={id} onChange={setId} placeholder="4417" />
        <Button type="submit" kind="main" disabled={busy || !id.trim()}>
          {busy ? "Looking…" : "Find"}
        </Button>
      </Form>
    </Row>
  );
}
