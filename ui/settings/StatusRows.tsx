// DV-1: the generic render of the status rows registry (actions/status-rows.ts) in Admin › Status: one table per
// source, each row with its state, one plain line, its last check and its action (Check now). A source registered on
// the server shows here with no change to this screen.
import { useState } from "react";
import { call } from "../api.ts";
import type { StatusGroup } from "../../actions/status-rows.ts";

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
        <section key={g.id} className="adm-status-group">
          <h3>{g.title}</h3>
          {g.note ? <p className="muted">{g.note}</p> : null}
          {g.rows.length === 0 ? (
            <p className="muted">Nothing to show yet.</p>
          ) : (
            <table className="adm-table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">State</th>
                  <th scope="col">Details</th>
                  <th scope="col">Last check</th>
                  <th scope="col">
                    <span className="sr-only">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r) => (
                  <tr key={r.id}>
                    <th scope="row">{r.label}</th>
                    <td>
                      <span className={`adm-state adm-state-${r.state}`}>{WORD[r.state]}</span>
                    </td>
                    <td>{r.detail}</td>
                    <td>{when(r.lastCheck)}</td>
                    <td>
                      {r.action ? (
                        <button type="button" className="mini quiet" disabled={busy === `${g.id}/${r.id}`} onClick={() => void act(g.id, r.id, r.action!.id)}>
                          {busy === `${g.id}/${r.id}` ? "Checking…" : r.action.label}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ))}
      {problem ? <p className="field-problem">{problem}</p> : null}
    </>
  );
}
