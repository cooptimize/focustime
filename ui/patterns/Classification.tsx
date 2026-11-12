// WP-3: Build work's classification on the DevOps patterns page. Agreement comes first (the sample as it is, whole items,
// then per missing fact and per layer with "too few to read" under 20 pairs and "not reliable yet" under 70%, and the
// request types the two answers disagreed on), so it is clear which findings to trust. Then request types, readiness and
// layers with a column per client beside all clients and without the largest, readiness by request type, what is
// missing most with each fact's agreement, and the ten most common feature shapes. Counts only, for every client.
import { FEW, FEW_WORDS, countWords, shareWords, tooFew } from "../../plan/patterns/analysis.ts";
import { FACT_FEW, LAYERS, MISSING, READINESS, disagreements, factReading, type Agreement } from "../../plan/patterns/labels.ts";
import { cellWords, clientTable, readinessByType, sumResults, type Results } from "../../plan/patterns/results.ts";
import { fromWords } from "../../plan/patterns/owned.ts";
import { NO_COMMON_SHAPE, factMeaning, factNote } from "../../plan/patterns/report.ts";

const sorted = (m: Record<string, number>) => Object.entries(m).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

function FactTable({ a, kind, title }: { a: Agreement; kind: "missing" | "layers"; title: string }) {
  const list = (kind === "missing" ? MISSING : LAYERS).filter((f) => f !== "none" && factReading(a.facts?.[kind]?.[f]).either);
  return (
    <table className="adm-table pat-agree">
      <thead><tr><th>{title}</th><th>In either answer</th><th>In both</th><th>Agreement</th></tr></thead>
      <tbody>
        {list.length ? list.map((f) => {
          const r = factReading(a.facts?.[kind]?.[f]);
          return (
            <tr key={f}>
              <th scope="row">{f}</th>
              <td>{r.either}</td>
              <td>{r.both}</td>
              <td className={!r.few && !r.reliable ? "field-problem" : undefined}>{r.few ? <span className="muted">{FEW_WORDS}</span> : `${Math.round((r.share ?? 0) * 100)}%${r.reliable ? "" : " · not reliable yet"}`}</td>
            </tr>
          );
        }) : <tr><td colSpan={4} className="muted">None in the sample.</td></tr>}
      </tbody>
    </table>
  );
}

function ClientTable({ title, t }: { title: string; t: ReturnType<typeof clientTable> }) {
  return (
    <table className="adm-table pat-clients" aria-label={title}>
      <thead><tr><th>{title}</th>{t.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
      <tbody>{t.rows.map((r) => <tr key={r.value}><th scope="row">{r.value}</th>{r.cells.map((c, n) => <td key={n} className={tooFew(c.base) ? "muted" : undefined}>{cellWords(c)}</td>)}</tr>)}</tbody>
    </table>
  );
}

export function Classification({ title, label, clients, labelsOn, sample }: { title: string; label: string; clients: { key: string; r: Results }[]; labelsOn: { mode: "in use" | "earlier"; version: string; wp1?: boolean }; sample: string }) {
  const total = sumResults(clients.map((c) => c.r));
  if (!total.labeled) return (
    <section aria-label={label} className="pat-section">
      <h3>{title}</h3>
      <p className="muted">No classification on the list in use yet. Estimate, then Run classification.</p>
    </section>
  );
  const a = total.agreement;
  const meaning = factMeaning(a);
  const d = disagreements(a);
  const t = (pick: (r: Results) => Record<string, number>, rows?: readonly string[]) => clientTable(clients, pick, rows ? { rows } : {});
  const rerun = Object.values(total.rerun ?? {}).reduce((x, n) => x + (n ?? 0), 0);
  const shapesOk = total.shapes.sets.some((x) => x.count >= FEW);
  return (
    <section aria-label={label} className="pat-section">
      <h3>{title}</h3>
      <p className="muted">{total.labeled} items labeled, across {clients.length} client{clients.length === 1 ? "" : "s"}. Coverage above says what wasn't, and why.</p>
      {labelsOn.mode === "earlier" && <p className="field-problem">These labels are on an earlier list ({labelsOn.version}), not the list in use: nothing on it could be carried safely. Kept as they were. Run classification to label against the list in use.{labelsOn.wp1 ? " They were made before WP-2's rules." : ""}</p>}
      {labelsOn.mode === "in use" && <p className="set-hint">{fromWords(total.from ?? {}, labelsOn.version)}</p>}
      {labelsOn.mode === "in use" && rerun > 0 && <p className="set-hint">{rerun} of these labels need labeling again (a type removed or added since, or no counterpart on the list in use). They show under their carried type until a classification run labels them.</p>}

      <h4>Agreement: which findings to trust</h4>
      <p>Agreement sample, across every client and kind: {sample}. Each item was labeled twice, in separate requests. The figures here are its {a.pairs} Build work pair{a.pairs === 1 ? "" : "s"}.</p>
      {a.pairs > 0 && (
        <>
          <p>Whole items: request type {shareWords(a.requestType, a.pairs)}, readiness {shareWords(a.readiness, a.pairs)}, confidence {shareWords(a.confidence, a.pairs)}.</p>
          <p className="set-hint">{meaning ?? "Per fact: of the pairs where either answer named it, the share where both did."} Under {FACT_FEW} pairs a fact says "{FEW_WORDS}"; under 70% it is not reliable yet.</p>
          <div className="pat-grid">
            <FactTable a={a} kind="missing" title="What is missing" />
            <FactTable a={a} kind="layers" title="Layer" />
          </div>
          <p>Request types the two answers disagreed on: {d.length ? d.map(([x, y, n]) => `${x} and ${y}: ${n}`).join("; ") : "none"}.</p>
        </>
      )}

      <h4>By client</h4>
      <p className="set-hint">Counts, and shares of each column's labeled items. Any cell whose base is under {FEW} says "{FEW_WORDS}".</p>
      <ClientTable title="Request type" t={t((r) => r.requestTypes)} />
      <ClientTable title="Readiness as written" t={t((r) => r.readiness, READINESS.filter((x) => total.readiness[x]))} />
      <ClientTable title="Layer" t={t((r) => r.layers)} />

      <h4>Readiness by request type, across clients</h4>
      <table className="adm-table">
        <thead><tr><th>Request type</th><th>Items</th>{READINESS.map((x) => <th key={x}>{x}</th>)}</tr></thead>
        <tbody>{readinessByType(total, READINESS).map((r) => <tr key={r.type}><th scope="row">{r.type}</th><td>{r.items}</td>{r.cells.map((c, n) => <td key={n} className={tooFew(c.base) ? "muted" : undefined}>{cellWords(c)}</td>)}</tr>)}</tbody>
      </table>

      <h4>What is missing most, by request type</h4>
      <p className="set-hint">Each fact with its agreement on the sample. "Not reliable yet": the two answers agreed on it less than 70% of the time.</p>
      <table className="adm-table">
        <thead><tr><th>Request type</th><th>Missing most</th></tr></thead>
        <tbody>{Object.entries(total.missing).sort(([x], [y]) => x.localeCompare(y)).map(([type, m]) => {
          const n = total.requestTypes[type] ?? 0;
          const top = sorted(m).filter(([k]) => k !== "none").slice(0, 3);
          return (
            <tr key={type}>
              <th scope="row">{type} <span className="set-hint">({n})</span></th>
              <td>{tooFew(n) ? <span className="muted">{FEW_WORDS}</span> : top.length ? top.map(([k, v], i) => {
                const note = factNote(a, "missing", k);
                return <span key={k}>{i ? ", " : ""}{k} ({v}) <span className={/not reliable/.test(note) ? "field-problem" : "set-hint"}>{note}</span></span>;
              }) : <span className="muted">nothing</span>}</td>
            </tr>
          );
        })}</tbody>
      </table>

      <h4>Common feature shapes</h4>
      <p className="set-hint">For each classified parent with at least two classified children ({countWords(total.shapes.parents)} parents), the layers its children touch, as a set. The ten most common.</p>
      {shapesOk ? (
        <table className="adm-table pat-shapes">
          <thead><tr><th>Request type</th><th>Layers touched</th><th>Parents</th></tr></thead>
          <tbody>{total.shapes.sets.map((x) => <tr key={`${x.requestType}|${x.shape.join("|")}`}><th scope="row">{x.requestType}</th><td>{x.shape.join(", ")}</td><td>{countWords(x.count)}</td></tr>)}</tbody>
        </table>
      ) : <p>{NO_COMMON_SHAPE}</p>}

      <h4>Confidence</h4>
      <p>{sorted(total.confidence).map(([k, v]) => `${k} ${shareWords(v / total.labeled, total.labeled, { base: false })}`).join(", ")}.</p>
    </section>
  );
}

