// SA-2: Settings › AI and assistant, drawn with the parts. The team's AI values read-only (Admin › Team defaults › AI sets them), this
// month's spend, Test AI, what is sent, the last 20 requests, and the assistant's history.
import { useCallback, useEffect, useState } from "react";
import type { AiView } from "../../../ai/view.ts";
import { call } from "../../api.ts";
import { useAutoSave } from "../autosave.tsx";
import { Button, Buttons, Group, Note, Page, Result, Row, Table, Value } from "../parts.tsx";
import { NumRow } from "./fields.tsx";
import { labelBy } from "./shared.ts";
import type { FormProps } from "./types.ts";

type AiTestResult = { ok: true; latencyMs: number; cost: string; model: string } | { ok: false; kind: string; message: string };
/** Names for the task names the log keeps. */
const AI_TASK_NAMES: Record<string, string> = {
  test_ai: "Test AI",
  "asks.classify": "Sort an ask",
  "promises.extract": "Read a promise",
  "stories.draft": "Break down",
  "meeting.capture": "Read a client call",
};
const fmtAiTime = (iso: string) =>
  iso
    ? new Date(iso).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "";

export function AiSection(p: FormProps) {
  return (
    <Page>
      <AiForm {...p} />
      <Group>
        <ClearAssistant />
      </Group>
    </Page>
  );
}

function AiForm(p: FormProps) {
  const s = p.data.ai;
  const a = useAutoSave({
    section: "ai",
    initial: { draftMonths: s.draftMonths ?? 12 },
    payload: (v) => v,
    onSaved: p.onSavedData,
    label: labelBy({ draftMonths: "draft-months" }),
  });
  const [st, setSt] = useState<AiView | null>(null);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<AiTestResult | null>(null);
  const load = useCallback(() => call<AiView | null>("ai.status", {}).then(setSt, () => setSt(null)), []);
  const rules = p.data.aiRules;
  useEffect(() => void load(), [load, rules.on, rules.personCapUsd]);
  const nameOf = (k: string | null) => (k ? (p.data.clients.find((c) => c.key === k)?.setting.name ?? k) : "None");
  const runTest = async () => {
    setTesting(true);
    setTest(null);
    try {
      setTest(await call<AiTestResult>("ai.test", {}));
    } catch (e) {
      setTest({
        ok: false,
        kind: "provider",
        message: e instanceof Error ? e.message : "Test AI didn't run",
      });
    } finally {
      setTesting(false);
      void load();
    }
  };
  const notSetUp = st !== null && !st.setUp;
  const log = st?.recentText ?? [];
  return (
    <>
      <Group sid="ai-team">
        <Row id="ai-team" noSid team>
          <Value>{rules.on ? "On" : "Off"}</Value>
        </Row>
        <Row id="ai-allowed" team>
          <Value>{rules.allowedClients.length ? rules.allowedClients.map((k) => nameOf(k)).join(", ") : "No clients yet"}</Value>
        </Row>
        <Row id="ai-limit" team>
          <Value>{rules.personCapUsd === 0 ? "AI budget is set to $0" : `$${rules.personCapUsd}`}</Value>
        </Row>
      </Group>
      {(st === null || notSetUp) && (
        <Note tone="problem" live>
          AI isn't set up for this FocusTime yet
          {st?.provider === "off" ? ": it's turned off" : ""}. Everything else works without it.
        </Note>
      )}
      <Group>
        <Row
          id="ai-month"
          below={
            st?.zeroBudget ? (
              <Result tone="problem">AI budget is set to $0</Result>
            ) : st?.appReached ? (
              <Result tone="problem">FocusTime's AI budget for everyone is used up until next month.</Result>
            ) : undefined
          }
        >
          <Value>
            {st ? st.spentText : "$0"} of {st ? st.capText : `$${rules.personCapUsd}`}
          </Value>
        </Row>
        <NumRow a={a} k="draftMonths" id="draft-months" help="Examples come from the same client's features changed in this many months, 1 to 36." min={1} max={36} step={1} />
        <Row
          id="ai-test"
          help="Sends one fixed request with no client data."
          below={
            test ? (
              test.ok ? (
                <Result tone="ok">
                  OK · {(test.latencyMs / 1000).toFixed(1)} s · {test.cost}
                </Result>
              ) : (
                <Result tone="problem">{test.message}</Result>
              )
            ) : undefined
          }
        >
          <Button disabled={testing} onClick={() => void runTest()}>
            {testing ? "Testing…" : "Test AI"}
          </Button>
        </Row>
        <Row
          id="ai-sent"
          help="Only what a task needs, about one client at a time, and only for clients a FocusTime admin allowed."
          more="Before anything goes, FocusTime checks it: another client's name, project or work item, anything that looks like a key, token or password, your VM, or an email address from outside Cooptimize stops the request. The AI service is asked not to keep requests, and FocusTime's log keeps only the counts and the cost below, never the text."
        />
        <Row id="ai-log" wide help={log.length ? undefined : "No AI requests yet."}>
          {log.length > 0 && (
            <Table
              label="Last 20 AI requests"
              head={["When", "Task", "Client", "Cost", "Result"]}
              rows={log.map((r) => [fmtAiTime(r.at), AI_TASK_NAMES[r.task] ?? r.task, nameOf(r.client), r.cost, r.outcome])}
              rowTone={(i) => (log[i]!.outcome === "OK" ? undefined : "failed")}
            />
          )}
        </Row>
      </Group>
    </>
  );
}

function ClearAssistant() {
  const [asking, setAsking] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  return (
    <Row id="assistant-history" status={status !== null} help={status ?? "What you asked the assistant and its answers, kept 30 days. Only you see it; it is in Export my data."}>
      {asking ? (
        <Buttons>
          <Button
            kind="main"
            onClick={async () => {
              try {
                const r = await call<{ removed: number }>("assistant.clear", {
                  confirm: true,
                });
                setStatus(r.removed ? `Cleared ${r.removed} ${r.removed === 1 ? "entry" : "entries"}` : "Nothing to clear");
              } catch (e) {
                setStatus(e instanceof Error ? e.message : "Couldn't clear it");
              }
              setAsking(false);
            }}
          >
            Clear it
          </Button>
          <Button onClick={() => setAsking(false)}>Keep it</Button>
        </Buttons>
      ) : (
        <Button onClick={() => (setAsking(true), setStatus(null))}>Clear</Button>
      )}
    </Row>
  );
}
