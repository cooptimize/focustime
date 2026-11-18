// SA-4: Admin › Team defaults, four tabs: AI (AI for FocusTime, Model, the two caps, Processing tier), Client chats (the
// phrase lists and how chats are read), Planning and new people, and Standards. Moved from Admin › AI, Client chats,
// Organization and Standards with every stored key, check and action as it was. Allow AI is on each client's page now.
import { useState } from "react";
import { call } from "../../api.ts";
import { Stamp } from "../../Stamp.tsx";
import { SaveMark, plain } from "../autosave.tsx";
import { AdminConfirm, AField, Kind, ListInput, NumInput, TextInput, useAdminSave, useSection, type ClientCounts, type ClientFilterValue, type Saver } from "./shared.tsx";
import { adminHref } from "./places.ts";

// ---------- AI ----------

type AiTaskRow = { name: string; label: string; background: boolean; tier: "standard" | "flex" };
export type AiClient = { key: string; isClient: boolean; whyText: string; allowAi: boolean; groupWithoutAi: boolean; attachmentsAi: boolean; /** SA-4: for the rail and Search Admin. */ color?: string | null; names?: string[]; aliases?: string[] };
export type AiData = { tasks: AiTaskRow[]; standardTasks: string[]; on: boolean; model: string; personCapUsd: number; appCapUsd: number; provider: string; keyConfigured: boolean; appSpentMicros: number; zero: { person: boolean; app: boolean }; filter: ClientFilterValue; counts: ClientCounts; clients: AiClient[] };

/**
 * AI-F1: each task's tier. Background tasks (nobody waits on them) run on Flex, half price and slower, and fall back to
 * standard when Flex is busy; an admin can put one back on standard. Interactive tasks are always standard.
 */
function AiTiers({ data, saver }: { data: AiData; saver: Saver }) {
  const o = "org";
  const key = "ai.standard_tasks";
  const shown: string[] = saver.shown(o, key, data.standardTasks);
  const set = (t: AiTaskRow, flex: boolean) => {
    const next = flex ? shown.filter((n) => n !== t.name) : [...new Set([...shown, t.name])].sort();
    void saver.save(o, key, next, `${t.label}: ${flex ? "Flex" : "Standard"}`);
  };
  return (
    <>
      <h3>Processing tier</h3>
      <p className="set-hint">Background work nobody waits on uses Flex: half the price, slower, and it switches to standard by itself when Flex is busy. Everything else, and anything a person is waiting on (Sort again, Sort unsorted), is always standard.</p>
      <SaveMark s={saver.status(o, key)} retry={() => void saver.save(o, key, shown, "Processing tier")} />
      <table className="adm-table adm-ai-tiers adm-rows-phone">
        <thead>
          <tr>
            <th scope="col">Task</th>
            <th scope="col">Tier <Kind kind="Rule" /></th>
          </tr>
        </thead>
        <tbody>
          {data.tasks.map((t) => {
            const flex = t.background && !shown.includes(t.name);
            return (
              <tr key={t.name}>
                <th scope="row">{t.label}</th>
                <td>
                  {t.background ? (
                    <label className="set-check">
                      <input type="checkbox" role="switch" checked={flex} aria-label={`Use Flex for ${t.label}`} onChange={(e) => set(t, e.target.checked)} /> {flex ? "Flex: half price, slower" : "Standard: full price"}
                    </label>
                  ) : (
                    <span className="muted">Standard</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

export function AiTab() {
  const { data, error, load } = useSection<AiData>("ai", { filter: "all" });
  const saver = useAdminSave(load);
  const [confirmOff, setConfirmOff] = useState(false);
  if (error) return <p className="field-problem">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;
  const o = "org";
  const allowed = data.clients.filter((c) => c.isClient && c.allowAi).length;
  const clients = data.clients.filter((c) => c.isClient).length;
  const on = saver.shown(o, "ai.on", data.on);
  return (
    <div className="set-form set-ai">
      <AField label="AI for FocusTime" kind="Rule" s={saver.status(o, "ai.on")} retry={() => void saver.save(o, "ai.on", data.on, "AI for FocusTime")} hint="The one switch for everyone, and the emergency off: off stops every AI request at once. Everything else works without AI.">
        <label className="set-check">
          <input type="checkbox" role="switch" aria-label="AI for FocusTime" checked={on} onChange={(e) => (e.target.checked ? void saver.save(o, "ai.on", true, "AI for FocusTime") : setConfirmOff(true))} /> {on ? "AI on: AI runs where a client allows it" : "AI off: no AI request runs"}
        </label>
      </AField>
      {confirmOff && (
        <AdminConfirm label="Turn AI off for everyone" text="Turn AI off for everyone? Break down, chat sorting and promise reading stop until it's on again." confirm="Turn AI off" onConfirm={() => (setConfirmOff(false), void saver.save(o, "ai.on", false, "AI for FocusTime"))} onCancel={() => setConfirmOff(false)} />
      )}
      {saver.warning && <p className="set-problem" role="status">{saver.warning}</p>}
      {!data.keyConfigured && <p className="set-problem">AI isn't set up for this FocusTime: there is no OpenAI key ({data.provider}). The switches save, and AI starts once the key is in Key Vault.</p>}
      <p className="set-hint adm-readonly-line" data-allow-ai-count={allowed}>
        {allowed === 0 ? "No client allows AI yet." : `${allowed} of ${clients} ${clients === 1 ? "client allows" : "clients allow"} AI.`} Each client's Allow AI is on its page: <a href={adminHref({ part: "clients" })}>Clients</a>, then the client's AI tab.
      </p>
      <div className="set-grid">
        <AField label="Model" kind="Rule" s={saver.status(o, "ai.model")} retry={() => void saver.save(o, "ai.model", data.model, "Model")} hint="The OpenAI model every AI request uses, by its name in OpenAI, like gpt-5-mini.">
          <TextInput label="Model" value={data.model} maxLength={60} onSave={(v) => void saver.save(o, "ai.model", v, "Model")} />
        </AField>
        <AField label="Monthly cap per person (US dollars)" kind="Rule" s={saver.status(o, "ai.person_cap_usd")} retry={() => void saver.save(o, "ai.person_cap_usd", data.personCapUsd, "Cap per person")} hint={data.zero.person ? <span className="field-problem">AI budget is set to $0</span> : "AI stops for a person at this, until next month."}>
          <NumInput label="Monthly cap per person" value={data.personCapUsd} min={0} max={10000} onSave={(v) => void saver.save(o, "ai.person_cap_usd", v, "Cap per person")} />
        </AField>
        <AField label="Monthly cap for everyone (US dollars)" kind="Rule" s={saver.status(o, "ai.app_cap_usd")} retry={() => void saver.save(o, "ai.app_cap_usd", data.appCapUsd, "Cap for everyone")} hint={data.zero.app ? <span className="field-problem">AI budget is set to $0</span> : `This month so far: $${(data.appSpentMicros / 1e6).toFixed(2)}.`}>
          <NumInput label="Monthly cap for everyone" value={data.appCapUsd} min={0} max={10000} onSave={(v) => void saver.save(o, "ai.app_cap_usd", v, "Cap for everyone")} />
        </AField>
      </div>
      <AiTiers data={data} saver={saver} />
    </div>
  );
}

// ---------- Conversations ----------

type ConvData = { pollMinutes: number; retentionDays: number; closedShownDays: number; chatAiDailyCap: number; requestPhrases: string[]; ackPhrases: string[]; promisePhrases: string[]; more: string[] };

export function ChatsTab() {
  const { data, error, load } = useSection<ConvData>("conversations");
  const saver = useAdminSave(load);
  if (error) return <p className="field-problem">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;
  const o = "org";
  const list = (key: string, label: string, value: string[], hint: string) => (
    <AField label={label} kind="Default" s={saver.status(o, key)} retry={() => void saver.save(o, key, value, label)} hint={hint}>
      <ListInput label={label} value={value} onSave={(v) => void saver.save(o, key, v, label)} />
    </AField>
  );
  const num = (key: string, label: string, value: number, min: number, max: number, hint: string) => (
    <AField label={label} kind="Rule" s={saver.status(o, key)} retry={() => void saver.save(o, key, value, label)} hint={hint}>
      <NumInput label={label} value={value} min={min} max={max} onSave={(v) => void saver.save(o, key, v, label)} />
    </AField>
  );
  return (
    <div className="set-form">
      <p className="muted adm-first-line">
        A chat is registered on its client's page: <a href={adminHref({ part: "clients" })}>Clients</a>, then the client's Chats tab. Here are the team's phrase lists and how chats are read, for every client.
      </p>
      <p className="muted">Each person may add their own phrases on top in Settings › Client chats, but never removes the team's.</p>
      <div className="set-grid">
        {list("conv.request_phrases", "Asking phrases", data.requestPhrases, "A client's message with one of these is checked for what it asks. Commas between them.")}
        {list("conv.ack_phrases", "Thanks and short replies", data.ackPhrases, "A message that is only these (and emoji) is never checked.")}
        {list("conv.promise_phrases", "Promise phrases", data.promisePhrases, "In a person's own messages: a promise to keep.")}
      </div>
      <h3>Reading client chats</h3>
      <div className="set-grid">
        {num("conv.poll_minutes", "Read client chats every (minutes)", data.pollMinutes, 1, 30, "1 to 30, in followers' working hours only. Applies from the next poll.")}
        {num("conv.retention_days", "Keep chat messages nothing was found in (days)", data.retentionDays, 1, 90, "Then they're deleted, after each poll.")}
        {/* NM-2: Closed conversations stay shown (conv.closed_shown_days) is hidden: no list shows closed ones since IB-4. Its value is kept and still read. */}
        {num("conv.chat_ai_daily_cap", "AI requests per chat per day", data.chatAiDailyCap, 0, 5000, "At most, for each chat.")}
      </div>
    </div>
  );
}

// ---------- Organization ----------

type Guidance = { draftStories: boolean; readinessNudges: boolean; planShare: number };
type NewPerson = { weekdays: Record<string, string[]>; lunch: string; risk: { watch: number; atRisk: number; minWindow: number } };
type OrgData = {
  inviteDomains: string[];
  neverSuggest: string[];
  feedback: { org: string; project: string; parentId: number } | null;
  retentionYears: number;
  idleMinutes: number;
  /** AH-3: Gaps looks at the top N of each backlog. */
  fixTopN?: number;
  newPerson: NewPerson;
  inviteFromBootstrap: boolean;
  feedbackFromBootstrap: boolean;
  levels: Record<string, Guidance>;
  levelNames: Record<string, string>;
};
const DAYS = [["mon", "Monday"], ["tue", "Tuesday"], ["wed", "Wednesday"], ["thu", "Thursday"], ["fri", "Friday"], ["sat", "Saturday"], ["sun", "Sunday"]] as const;

export function PlanningTab() {
  const { data, error, load } = useSection<OrgData>("organization");
  const saver = useAdminSave(load);
  if (error) return <p className="field-problem">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;
  const o = "org";
  const fb = data.feedback ?? { org: "", project: "", parentId: 0 };
  const saveFb = (next: Partial<typeof fb>) => {
    const v = { ...fb, ...next };
    void saver.save(o, "org.feedback", v.org || v.project || v.parentId ? v : null, "Send feedback goes to");
  };
  const np = data.newPerson;
  const saveNp = (next: Partial<NewPerson>) => void saver.save(o, "org.new_person", { ...np, ...next }, "Working week for new people");
  return (
    <div className="set-form">
      <div className="set-grid">
        <AField label="Help invites go only to" kind="Rule" s={saver.status(o, "org.invite_domains")} retry={() => void saver.save(o, "org.invite_domains", data.inviteDomains, "Invite domains")} hint={data.inviteFromBootstrap ? "From the app's settings until an admin sets them here. Commas between domains." : "Commas between domains, like cooptimize.com."}>
          <ListInput label="Help invites go only to" value={data.inviteDomains} onSave={(v) => void saver.save(o, "org.invite_domains", v, "Invite domains")} />
        </AField>
        <AField label="Never suggested, for everyone" kind="Rule" s={saver.status(o, "org.never_suggest")} retry={() => void saver.save(o, "org.never_suggest", data.neverSuggest, "Never suggested")} hint="Names or emails, commas between them. People may exclude more for themselves.">
          <ListInput label="Never suggested, for everyone" value={data.neverSuggest} onSave={(v) => void saver.save(o, "org.never_suggest", v, "Never suggested")} />
        </AField>
        {/* SA-4: "Keep people's data (years)" (org.retention_years) left the screen: nothing enforces it. Its value is kept; Health's Jobs row says it isn't enforced. */}
        <AField label="Counts as in use (minutes)" kind="Rule" s={saver.status(o, "org.idle_minutes")} retry={() => void saver.save(o, "org.idle_minutes", data.idleMinutes, "In use")} hint="5 to 60. An open page counts as someone using FocusTime only this long after their last key, click or scroll. Background work waits otherwise.">
          <NumInput label="Counts as in use (minutes)" value={data.idleMinutes} min={5} max={60} onSave={(v) => void saver.save(o, "org.idle_minutes", v, "In use")} />
        </AField>
        <AField label="Needs attention looks at the top N of each backlog" kind="Rule" s={saver.status(o, "ahead.fix_top_n")} retry={() => void saver.save(o, "ahead.fix_top_n", data.fixTopN ?? 30, "Needs attention top N")} hint="10 to 100, for epics, features and stories each. Backlog's Needs attention also shows what's dated in the next 4 weeks and the features and epics each person owns.">
          <NumInput label="Needs attention looks at the top N of each backlog" value={data.fixTopN ?? 30} min={10} max={100} onSave={(v) => void saver.save(o, "ahead.fix_top_n", v, "Needs attention top N")} />
        </AField>
      </div>
      <h3>Send feedback</h3>
      <p className="muted">{data.feedbackFromBootstrap ? "From the app's settings until an admin sets it here." : "Set here; the app's settings no longer apply."} Stories are created under the parent feature by the person sending them, with their own DevOps write PAT for that project's client.</p>
      <div className="set-grid">
        <AField label="DevOps organization" kind="Rule" s={saver.status(o, "org.feedback")} retry={() => saveFb({})}>
          <TextInput label="Feedback DevOps organization" value={fb.org} onSave={(v) => saveFb({ org: v })} />
        </AField>
        <AField label="Project" kind="Rule" s={null} retry={() => saveFb({})}>
          <TextInput label="Feedback project" value={fb.project} onSave={(v) => saveFb({ project: v })} />
        </AField>
        <AField label="Parent feature" kind="Rule" s={null} retry={() => saveFb({})}>
          <NumInput label="Feedback parent feature" value={fb.parentId} min={1} max={99999999} onSave={(v) => saveFb({ parentId: v })} />
        </AField>
      </div>
      <h3>New people's starting values</h3>
      <p className="muted">Prefilled into Setup for someone signing in for the first time; theirs to change after.</p>
      <div className="set-grid">
        {DAYS.map(([k, name]) => (
          <AField key={k} label={name} kind="Default" s={null} retry={() => saveNp({})} hint={k === "mon" ? "Spans like 09:00-17:00; empty for a day off." : undefined}>
            <ListInput label={`New people: ${name}`} value={np.weekdays[k] ?? []} onSave={(v) => saveNp({ weekdays: { ...np.weekdays, [k]: v } })} placeholder="day off" />
          </AField>
        ))}
        <AField label="Lunch" kind="Default" s={null} retry={() => saveNp({})} hint="A span like 12:00-12:30.">
          <TextInput label="New people: lunch" value={np.lunch} maxLength={11} onSave={(v) => saveNp({ lunch: v })} />
        </AField>
        <AField label="Watch at (minutes of meetings)" kind="Default" s={null} retry={() => saveNp({})}>
          <NumInput label="New people: meeting watch" value={np.risk.watch} min={1} max={600} onSave={(v) => saveNp({ risk: { ...np.risk, watch: v } })} />
        </AField>
        <AField label="At risk at (minutes of meetings)" kind="Default" s={null} retry={() => saveNp({})}>
          <NumInput label="New people: meeting at risk" value={np.risk.atRisk} min={1} max={600} onSave={(v) => saveNp({ risk: { ...np.risk, atRisk: v } })} />
        </AField>
        <AField label="Shortest useful focus window (minutes)" kind="Default" s={null} retry={() => saveNp({})}>
          <NumInput label="New people: shortest focus window" value={np.risk.minWindow} min={1} max={600} onSave={(v) => saveNp({ risk: { ...np.risk, minWindow: v } })} />
        </AField>
      </div>
      <SaveMark s={saver.status(o, "org.new_person")} retry={() => saveNp({})} />
      {saver.status(o, "org.feedback") && <SaveMark s={saver.status(o, "org.feedback")} retry={() => saveFb({})} />}
      <h3>By level</h3>
      <p className="muted">Each level's defaults; a person may change any of these for themselves (Settings › Day and Week, Reset to team default). They never block anything.</p>
      <table className="adm-table adm-by-level">
        <thead>
          <tr>
            <th scope="col">Level</th>
            <th scope="col">Break down offered</th>
            <th scope="col">Needs attention nudges</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(data.levels).map(([lv, g]) => {
            const scope = `level:${lv}`;
            return (
              <tr key={lv}>
                <th scope="row">{data.levelNames[lv]}</th>
                <td>
                  <label className="set-check">
                    <input type="checkbox" role="switch" aria-label={`${data.levelNames[lv]}: Break down offered`} checked={saver.shown(scope, "draft_stories", g.draftStories)} onChange={(e) => void saver.save(scope, "draft_stories", e.target.checked, `${data.levelNames[lv]}: Break down`)} /> {saver.shown(scope, "draft_stories", g.draftStories) ? "Offered" : "Not offered"}
                  </label>
                  <SaveMark s={saver.status(scope, "draft_stories")} retry={() => void saver.save(scope, "draft_stories", g.draftStories, "Break down")} />
                </td>
                <td>
                  <label className="set-check">
                    <input type="checkbox" role="switch" aria-label={`${data.levelNames[lv]}: Needs attention nudges`} checked={saver.shown(scope, "readiness_nudges", g.readinessNudges)} onChange={(e) => void saver.save(scope, "readiness_nudges", e.target.checked, `${data.levelNames[lv]}: readiness nudges`)} /> {saver.shown(scope, "readiness_nudges", g.readinessNudges) ? "Nudged" : "No nudges"}
                  </label>
                  <SaveMark s={saver.status(scope, "readiness_nudges")} retry={() => void saver.save(scope, "readiness_nudges", g.readinessNudges, "Needs attention nudges")} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

type StandardsData = {
  available: boolean; repoUrl: string; branch: string; defaults: { repoUrl: string; branch: string }; everyMinutes: number; budget: number; syncedFrom: { repoUrl: string; branch: string } | null;
  commit: string | null; syncedAt: string | null; checkedAt: string | null; error: string | null; errorAt: string | null;
  warnings: ({ kind: "duplicate_id"; id: string; paths: string[] } | { kind: "incomplete"; path: string; missing: string[] })[];
  articles: { id: string; title: string; domain: string; layer: string; artifact: string; technology: string; path: string; url: string }[];
};

/** KB-1: Admin › Team defaults › Standards: the repo and branch (Rules), the last sync, Sync now, the warnings and the articles. Read only on GitHub. */
export function StandardsTab() {
  const { data, error, load } = useSection<StandardsData>("standards");
  const saver = useAdminSave(load);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (error) return <p className="set-problem">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;
  const o = "org";
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const syncNow = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await call<{ ok: boolean; changed: boolean; error: string | null }>("admin.standards_sync", {});
      setMsg(r.ok ? (r.changed ? "Synced: a new copy is in use." : "Checked: nothing new.") : (r.error ?? "The sync failed. The last good copy is still in use."));
    } catch (e) {
      setMsg(e instanceof Error ? plain(e.message) : "The sync failed");
    }
    setBusy(false);
    await load();
  };
  return (
    <div className="adm-standards">
      <p className="muted">FocusTime reads Cooptimize's development standards from GitHub and uses them in AI drafts and Ask. It only ever reads the repo, with no token, and runs nothing from it. It looks for a new commit every {data.everyMinutes} minutes while FocusTime is in use.</p>
      <div className="set-form">
        <AField label="Repo" kind="Rule" s={saver.status(o, "standards.repo_url")} retry={() => void saver.save(o, "standards.repo_url", data.repoUrl, "Standards repo")} hint="A public https://github.com/<owner>/<repo> address.">
          <TextInput label="Standards repo" value={saver.shown(o, "standards.repo_url", data.repoUrl)} maxLength={300} onSave={(v) => void saver.save(o, "standards.repo_url", v, "Standards repo")} />
        </AField>
        <AField label="Branch" kind="Rule" s={saver.status(o, "standards.branch")} retry={() => void saver.save(o, "standards.branch", data.branch, "Standards branch")} hint="Empty means the repo's default branch.">
          <TextInput label="Standards branch" placeholder="The default branch" value={saver.shown(o, "standards.branch", data.branch)} maxLength={200} onSave={(v) => void saver.save(o, "standards.branch", v, "Standards branch")} />
        </AField>
        <div className="set-field">
          <span className="set-label">Last synced</span>
          <span>{data.syncedAt ? <><Stamp at={data.syncedAt} tz={zone} /> · commit <code>{data.commit?.slice(0, 7)}</code></> : "Not synced yet"}</span>
        </div>
        {data.checkedAt && (
          <div className="set-field">
            <span className="set-label">Last checked</span>
            <span><Stamp at={data.checkedAt} tz={zone} /></span>
          </div>
        )}
        <div className="set-field">
          <span className="set-label">Budget</span>
          <span>{data.budget.toLocaleString()} tokens of matched articles per AI request</span>
        </div>
        <div className="set-field">
          <span className="set-inline">
            <button type="button" className="mini" disabled={busy || !data.available} onClick={() => void syncNow()}>{busy ? "Syncing…" : "Sync now"}</button>
            {msg && <span className="muted" role="status">{msg}</span>}
          </span>
        </div>
      </div>
      {data.error && (
        <p className="set-problem" role="alert">The last sync failed{data.errorAt ? <> (<Stamp at={data.errorAt} tz={zone} />)</> : null}: {data.error}. The last good copy is still in use.</p>
      )}
      {data.warnings.map((w) => (
        <p key={w.kind === "duplicate_id" ? w.id : w.path} className="set-problem">
          {w.kind === "duplicate_id" ? <>Two active articles share the id <code>{w.id}</code>: {w.paths.join(" and ")}. Both are in use.</> : <>{w.path} is active but its front matter is missing {w.missing.join(", ")}, so it isn't used.</>}
        </p>
      ))}
      <h3 className="set-sub">Active articles ({data.articles.length})</h3>
      {data.articles.length === 0 ? <p className="muted">None yet.</p> : (
        <table className="adm-standards-table adm-rows-phone">
          <thead><tr><th>Title</th><th>Domain</th><th>Layer</th><th>Artifact</th><th>Technology</th><th>Path</th></tr></thead>
          <tbody>
            {data.articles.map((a) => (
              <tr key={a.path}>
                <td><a href={a.url} target="_blank" rel="noreferrer">{a.title}</a></td>
                <td>{a.domain}</td><td>{a.layer}</td><td>{a.artifact}</td><td>{a.technology}</td>
                <td className="adm-standards-path">{a.path}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
