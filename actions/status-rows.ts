// DV-1: the status rows registry for Admin › Status. A part of FocusTime that has health to show (DevOps polling
// first; ADM-2 and later steps can add theirs) registers a source once at startup: a title, its rows (label, state,
// detail, last check) and, optionally, one action per row such as Check now. Admin › Status renders every source the
// same way, so a new source needs no screen change. Rows carry names, states and counts only, never a secret, a token,
// an item title or an identity.

export type StatusRowState = "ok" | "warn" | "error" | "idle";

export type StatusRow = {
  /** Unique within its source (a client key, a job name). */
  id: string;
  label: string;
  state: StatusRowState;
  /** One plain line: "3 changed today · every 1 min", "Token not valid". */
  detail: string;
  lastCheck: string | null;
  /** An optional action on this row, run through admin.status_action. */
  action?: { id: string; label: string };
};

export type StatusGroup = { id: string; title: string; note?: string; rows: StatusRow[] };

export type StatusSource = {
  id: string;
  title: string;
  note?: string;
  rows(): Promise<StatusRow[]>;
  act?(rowId: string, actionId: string): Promise<void>;
};

export function createStatusRegistry() {
  const sources: StatusSource[] = [];
  return {
    register(s: StatusSource): void {
      if (sources.some((x) => x.id === s.id)) throw new Error(`status source ${s.id} is registered twice`);
      sources.push(s);
    },
    /** Every source's rows; one that fails shows as one error row, never stopping the others. */
    async groups(): Promise<StatusGroup[]> {
      return Promise.all(
        sources.map(async (s): Promise<StatusGroup> => {
          const rows = await s.rows().catch((): StatusRow[] => [{ id: "unavailable", label: s.title, state: "error", detail: "Couldn't read this status now", lastCheck: null }]);
          return { id: s.id, title: s.title, ...(s.note ? { note: s.note } : {}), rows };
        }),
      );
    },
    /** Runs a row's action: false when there's no such source, row action or action. */
    async act(sourceId: string, rowId: string, actionId: string): Promise<boolean> {
      const s = sources.find((x) => x.id === sourceId);
      if (!s?.act) return false;
      const row = (await s.rows()).find((r) => r.id === rowId);
      if (!row?.action || row.action.id !== actionId) return false;
      await s.act(rowId, actionId);
      return true;
    },
  };
}

export type StatusRegistry = ReturnType<typeof createStatusRegistry>;
