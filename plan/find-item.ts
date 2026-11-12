// DV-2: Find an item (Settings › DevOps). `devops.find` gathers the facts from FocusTime's store only (the poller fills
// it from the client's whole project), the scope, my plan, Ahead's filters and Status's features; this turns them into
// plain lines, in order: DevOps, FocusTime's store, the scope, then Day, Week, Ahead and Status. Pure: no I/O, no clock.

export type ItemTier = "epic" | "feature" | "story" | "task";

/** The item as DevOps has it now (only what the answers need; the title only because the person can see the client). */
export type FoundItem = {
  id: number;
  title: string;
  type: string;
  state: string;
  closed: boolean;
  /** From the client's process (its backlog levels), null when the process doesn't place the type. */
  tier: ItemTier | null;
  parentId: number | null;
  assignee: "me" | "someone" | "nobody";
  area: string | null;
};

/** Ahead's answer: shown, hidden by one of my filters (which), or not in Ahead at all. */
export type AheadPresence =
  | { kind: "shown" }
  | { kind: "filtered"; filter: "clients" | "owner" | "epic" | "ready" | "flat" | "dates" | "stale" | "text" | "several"; owner?: "mine" | "contributing" }
  | { kind: "absent" }
  | { kind: "unavailable" };

/** Status: shown as a feature, under Also assigned, its feature shown, or not. */
export type StatusPresence = { kind: "shown" } | { kind: "also" } | { kind: "feature_shown"; featureId: number } | { kind: "absent"; featureId: number | null } | { kind: "unavailable" };

export type FindFacts = {
  clientName: string;
  id: number;
  devops: { kind: "found"; item: FoundItem } | { kind: "missing" } | { kind: "unavailable"; words: string };
  store: { has: boolean; changedAt: string | null; rev: number | null; checkedAt: string | null; okAt: string | null };
  /** The DevOps revision now (to say the store is behind). */
  devopsRev?: number | null;
  /** Against the client's configured scope (Admin › Clients); null when the client has none (everything is in it). */
  scope: { inScope: boolean; rule: string } | null;
  /** A to-do on today's plan. */
  todayTodo: boolean;
  /** On this week's plan (the item, or for a story its feature). */
  weekPlanned: boolean;
  ahead: AheadPresence;
  status: StatusPresence;
};

export type FindLine = { part: "devops" | "store" | "scope" | "day" | "week" | "ahead" | "status"; ok: boolean; text: string };

const ago = (at: string | null, nowMs: number) => {
  if (!at) return "never";
  const s = Math.max(0, Math.round((nowMs - Date.parse(at)) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
};

const FILTER_WORDS: Record<Exclude<Extract<AheadPresence, { kind: "filtered" }>["filter"], "owner">, string> = {
  clients: "the client filter",
  epic: "the epic filter",
  ready: "Needs attention",
  flat: "One level as a list",
  dates: "the Dates filter",
  stale: "the Stale filter",
  text: "the search text",
  several: "more than one of your filters",
};

/** The lines, in order. Later parts are left out once an earlier one rules the item out. */
export function findAnswer(f: FindFacts, nowMs: number): FindLine[] {
  const out: FindLine[] = [];
  const n = `#${f.id}`;
  if (f.devops.kind === "unavailable") {
    out.push({ part: "devops", ok: false, text: `DevOps couldn't be asked about ${n} now: ${f.devops.words}.` });
  } else if (f.devops.kind === "missing") {
    // One answer for "doesn't exist" and "exists in another project", so the finder can't probe item numbers.
    out.push({ part: "devops", ok: false, text: `FocusTime's last check of ${f.clientName}'s project (${ago(f.store.checkedAt, nowMs)}) found no ${n}. If you just made it, Refresh checks now. If you made it in another project, FocusTime doesn't read that project for ${f.clientName}.` });
    if (!f.store.has) return out;
  } else {
    const i = f.devops.item;
    out.push({ part: "devops", ok: true, text: `DevOps has ${n} "${i.title}", a ${i.type} in ${i.state}.` });
  }

  if (f.store.has) {
    const behind = f.devopsRev != null && f.store.rev != null && f.devopsRev > f.store.rev;
    out.push({
      part: "store",
      ok: !behind,
      text: `FocusTime has it: last changed in DevOps ${ago(f.store.changedAt, nowMs)}, ${f.clientName} last checked ${ago(f.store.checkedAt, nowMs)}.${behind ? " DevOps has a newer change; it shows after the next check (Refresh checks now)." : ""}`,
    });
  } else if (f.devops.kind === "found") {
    out.push({ part: "store", ok: false, text: `FocusTime doesn't have it yet. ${f.clientName} last checked ${ago(f.store.checkedAt, nowMs)}; it arrives with the next check (Refresh checks now).` });
  } else if (f.devops.kind === "missing") {
    out.push({ part: "store", ok: false, text: "FocusTime still has it from an earlier check; it goes at the next daily check." });
  }

  const item = f.devops.kind === "found" ? f.devops.item : null;
  if (!item) return out;

  if (f.scope) {
    out.push(
      f.scope.inScope
        ? { part: "scope", ok: true, text: `It's in what FocusTime shows for ${f.clientName} (${f.scope.rule}).` }
        : { part: "scope", ok: false, text: `It's in area ${item.area ?? "(none)"}, outside what FocusTime shows for ${f.clientName} (${f.scope.rule}). Backlog shows it with Show the whole project; an admin sets the scope in Admin › Clients.` },
    );
  }
  if (!item.tier) out.push({ part: "scope", ok: false, text: `${f.clientName}'s process doesn't place the type ${item.type} on a backlog level, so FocusTime's screens don't show it.` });

  // Day
  if (f.todayTodo) out.push({ part: "day", ok: true, text: "Day shows it: it's a to-do on today's plan." });
  else if (item.closed) out.push({ part: "day", ok: false, text: `Day doesn't show it: it's ${item.state}, and Day shows open to-dos.` });
  else if (item.tier === "story" || item.tier === "task") out.push({ part: "day", ok: false, text: "Day doesn't show it: it isn't a to-do today. Plan it from Week." });
  else out.push({ part: "day", ok: false, text: `Day doesn't show it: Day shows to-dos, and a ${item.type} shows there only as This week's chip once it's on the week's plan.` });

  // Week
  if (item.tier === "story" || item.tier === "task") {
    if (item.closed) out.push({ part: "week", ok: false, text: `Week doesn't show it: it's ${item.state}. Your stories lists open ones.` });
    else if (item.assignee !== "me") out.push({ part: "week", ok: false, text: `Week's Your stories doesn't show it: it's ${item.assignee === "nobody" ? "not assigned to anyone" : "assigned to someone else"}. Take one or assign it to yourself to see it there.` });
    else out.push({ part: "week", ok: true, text: `Week shows it under Your stories in ${f.clientName}'s block details.` });
  } else if (item.tier === "feature" || item.tier === "epic") {
    out.push(f.weekPlanned ? { part: "week", ok: true, text: "Week shows it: it's on this week's plan." } : { part: "week", ok: false, text: `Week's cards don't show it: it isn't on this week's plan. Add it in Week › Plan.` });
  }

  // Ahead
  const a = f.ahead;
  if (a.kind === "shown") out.push({ part: "ahead", ok: true, text: "Backlog shows it." });
  else if (a.kind === "filtered") out.push({ part: "ahead", ok: false, text: a.filter === "owner" ? `Backlog hides it: People for ${f.clientName} is ${a.owner === "contributing" ? "Contributing" : "Mine"}. Choose Everyone to see it.` : `Backlog hides it: ${FILTER_WORDS[a.filter]} is on.` });
  else if (a.kind === "unavailable") out.push({ part: "ahead", ok: false, text: "Backlog couldn't be read now." });
  else if (item.closed) out.push({ part: "ahead", ok: false, text: `Backlog doesn't show it: it's ${item.state}, and Backlog shows open items.` });
  else if (f.scope && !f.scope.inScope) out.push({ part: "ahead", ok: false, text: "Backlog shows it only with Show the whole project (it's outside the scope)." });
  else if (item.tier === "task" || !item.tier) out.push({ part: "ahead", ok: false, text: `Backlog doesn't show it: Backlog shows epics, features and stories, not ${item.type} items.` });
  else if (!f.store.has) out.push({ part: "ahead", ok: false, text: "Backlog shows it after the next check." });
  else out.push({ part: "ahead", ok: false, text: "Backlog doesn't show it." });

  // Status
  const s = f.status;
  if (s.kind === "shown") out.push({ part: "status", ok: true, text: "Status shows it in this week's report." });
  else if (s.kind === "also") out.push({ part: "status", ok: true, text: "Status shows it under Also assigned to you." });
  else if (s.kind === "feature_shown") out.push({ part: "status", ok: true, text: `Status shows its feature #${s.featureId}; Status lists features, with stories under them.` });
  else if (s.kind === "unavailable") out.push({ part: "status", ok: false, text: "Status couldn't be read now." });
  else if (item.tier === "epic") out.push({ part: "status", ok: false, text: "Status doesn't show it: Status lists features, not epics." });
  else out.push({ part: "status", ok: false, text: `Status doesn't show ${s.featureId && s.featureId !== item.id ? `its feature #${s.featureId}` : "it"} unless you commented on it this week: Status lists features on this week's plan, open ones assigned to you, and ones you worked on this week.` });
  return out;
}
