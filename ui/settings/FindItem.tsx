// DV-2: Settings › DevOps › Find an item. One of my clients and an item number; the answer, in order: whether DevOps
// has it, whether FocusTime has it (and how fresh), the scope, then Day, Week, Ahead and Status, each with why not.
// It reads that one item and nothing else, only for a client I can already see.
import { useState, type FormEvent } from "react";
import type { FindAnswer } from "../../plan/devops-fresh-types.ts";
import { call } from "../api.ts";

const PART: Record<FindAnswer["lines"][number]["part"], string> = { devops: "DevOps", store: "FocusTime", scope: "Scope", day: "Day", week: "Week", ahead: "Ahead", status: "Status" };

export function FindItem({ clients }: { clients: { key: string; name: string }[] }) {
  const [client, setClient] = useState(clients[0]?.key ?? "");
  const [id, setId] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<FindAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!clients.length) return <p className="muted">No client has DevOps set up for you yet.</p>;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
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
    <div className="find-item">
      <form className="find-item-form" onSubmit={(e) => void submit(e)} aria-label="Find an item">
        <label className="set-field">
          <span className="set-label">Client</span>
          <select value={client} onChange={(e) => setClient(e.target.value)}>
            {clients.map((c) => (
              <option key={c.key} value={c.key}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="set-field">
          <span className="set-label">Item number</span>
          <input type="text" inputMode="numeric" value={id} onChange={(e) => setId(e.target.value)} placeholder="4417" aria-label="Item number" />
        </label>
        <button type="submit" className="mini primary" disabled={busy || !id.trim()}>
          {busy ? "Looking…" : "Find"}
        </button>
      </form>
      {error && (
        <p className="find-item-error" role="alert">
          {error}
        </p>
      )}
      {answer && (
        <ol className="find-item-answer" aria-label={`What FocusTime knows about #${answer.id}`}>
          {answer.lines.map((l, i) => (
            <li key={i} className={l.ok ? "ok" : "no"}>
              <span className="find-part">{PART[l.part]}</span>
              <span className="dot" aria-hidden="true" />
              <span>{l.text}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
