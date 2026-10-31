// Dataverse Focus Time rows → FocusPattern. Pure.
// Person and client come from the Account Worker link, falling back to Focus Time's own columns (D32).
import type { DayPart, FocusPattern, WorkWeekday } from "../../week/types.ts";

export type AccountWorkerRef = {
  coop_accountworkerid?: string;
  _coop_user_value: string | null;
  _coop_account_value: string | null;
};

export type FocusTimeRow = {
  coop_focustimeid: string;
  _coop_account_value: string | null;
  _coop_systemuser_value: string | null;
  _coop_accountworker_value?: string | null;
  coop_startdate: string | null;
  coop_enddate: string | null;
  coop_mondaydaypart: number | null;
  coop_tuesdaydaypart: number | null;
  coop_wednesdaydaypart: number | null;
  coop_thursdaydaypart: number | null;
  statecode: number;
  coop_AccountWorker?: AccountWorkerRef | null;
};

export type AccountRow = { accountid: string; name: string | null; coop_reportingnickname: string | null };

export type Skipped = { id: string; reason: string };

const DAY_COLUMNS: [WorkWeekday, keyof FocusTimeRow][] = [
  ["Mon", "coop_mondaydaypart"],
  ["Tue", "coop_tuesdaydaypart"],
  ["Wed", "coop_wednesdaydaypart"],
  ["Thu", "coop_thursdaydaypart"],
];
const DAY_PARTS: Record<number, DayPart> = { 1: "AM", 2: "PM", 3: "AllDay" };

const same = (a: string | null | undefined, b: string) => typeof a === "string" && a.toLowerCase() === b.toLowerCase();
const dateOnly = (v: string) => v.slice(0, 10);

export function personOf(row: FocusTimeRow): string | null {
  return row.coop_AccountWorker?._coop_user_value ?? row._coop_systemuser_value ?? null;
}

export function clientOf(row: FocusTimeRow): string | null {
  return row.coop_AccountWorker?._coop_account_value ?? row._coop_account_value ?? null;
}

export function normalizeFocusTimes(
  rows: readonly FocusTimeRow[],
  accounts: readonly AccountRow[],
  mySystemUserId: string,
): { patterns: FocusPattern[]; skipped: Skipped[] } {
  const byId = new Map(accounts.map((a) => [a.accountid.toLowerCase(), a]));
  const patterns: FocusPattern[] = [];
  const skipped: Skipped[] = [];

  for (const row of rows) {
    if (!same(personOf(row), mySystemUserId)) continue; // not mine
    const id = row.coop_focustimeid;
    const accountId = clientOf(row);
    if (!accountId) {
      skipped.push({ id, reason: "no client" });
      continue;
    }
    if (!row.coop_startdate) {
      skipped.push({ id, reason: "no start date" });
      continue;
    }
    const account = byId.get(accountId.toLowerCase());
    const nickname = account?.coop_reportingnickname?.trim() || null;
    const fullName = account?.name?.trim() || null;
    const display = nickname ?? fullName ?? "Unknown client";

    const days: FocusPattern["days"] = {};
    for (const [day, col] of DAY_COLUMNS) {
      const v = row[col] as number | null;
      if (v === null || v === undefined) continue;
      const part = DAY_PARTS[v];
      if (part) days[day] = part;
      else skipped.push({ id, reason: `unknown day part ${v} on ${day}` });
    }

    const p: FocusPattern = {
      id,
      clientKey: account ? display : `account:${accountId.toLowerCase()}`,
      clientName: display,
      startDate: dateOnly(row.coop_startdate),
      endDate: row.coop_enddate ? dateOnly(row.coop_enddate) : null,
      active: row.statecode === 0,
      days,
    };
    if (fullName && fullName !== display) p.clientFullName = fullName;
    patterns.push(p);
  }
  return { patterns, skipped };
}
