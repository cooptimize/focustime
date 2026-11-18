// DV-1: the generic render of the status rows registry (actions/status-rows.ts) in Admin › Health: one table per
// source, each row with its state, one plain line, its last check and its action (Check now). A source registered on
// the server shows here with no change to this screen. SA-4 F: a group and the one table style (SA-2's parts).
import { useState } from "react";
import { call } from "../api.ts";
import type { StatusGroup } from "../../actions/status-rows.ts";
import { Button, Group, Note, State, Table } from "./parts.tsx";

const TONE = { ok: "live", warn: "cached", error: "error", idle: "muted" } as const;
const WORD = { ok: "OK", warn: "Slowed down", error: "Problem", idle: "Not checked yet" } as const;
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "never");

export function StatusRows({ groups: initial }: { groups: readonly StatusGroup[] }) {
  const [groups, setGroups] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const act = async (source: string, row: string, action: string) => {
    setBusy(`${source}/${row}`);
    setProblem(null);
    try {
      setGroups((await call<{ groups: StatusGroup[] }>("admin.status_action", { source, row, action })).groups);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "That didn't work");
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      {groups.map((g) => (
        <Group key={g.id} title={g.title} label={g.title} intro={g.note || undefined}>
          {g.rows.length === 0 ? (
            <Note>Nothing to show yet.</Note>
          ) : (
            <Table rowHeads
              label={g.title}
              head={["Name", "State", "Details", "Last check", <State key="a" sr>Action</State>]}
              rowKey={(i) => g.rows[i]!.id}
              rows={g.rows.map((r) => [
                r.label,
                <State key="s" tone={TONE[r.state]}>
                  {WORD[r.state]}
                </State>,
                r.detail,
                when(r.lastCheck),
                r.action ? (
                  <Button key="a" kind="quiet" disabled={busy === `${g.id}/${r.id}`} onClick={() => void act(g.id, r.id, r.action!.id)}>
                    {busy === `${g.id}/${r.id}` ? "Checking…" : r.action.label}
                  </Button>
                ) : (
                  ""
                ),
              ])}
            />
          )}
        </Group>
      ))}
      {problem ? <Note tone="problem">{problem}</Note> : null}
    </>
  );
}
