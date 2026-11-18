// SA-3: Settings › Your data: What FocusTime keeps about you first, then what it changed in other apps (Activity's five
// logs, as tabs), Export, Reset, Delete, Diagnostics and the demo. Diagnostics is its own panel (DX-1) and keeps its
// insides in a parts card (docs/open-questions.md, SA-2).
import { useEffect, useState } from "react";
import { useDeveloperLoop } from "../../appenv.ts";
import { call } from "../../api.ts";
import { DiagnosticsPanel } from "../Diagnostics.tsx";
import { Button, Buttons, Choice, Form, GoLink, Group, List, ListItem, Page, Row, Select, Switch, Text } from "../parts.tsx";
import { KEEP_LINES } from "../keeps.ts";
import { ActivityLog, LOG_TABS, type LogTab } from "./Activity.tsx";
import type { BodyProps } from "./types.ts";

export function DataSection(p: BodyProps) {
  const dev = useDeveloperLoop();
  return (
    <Page>
      <WhatWeKeep go={p.go} />
      <ChangedElsewhere {...p} />
      <Group>
        <ExportMine />
        <ResetPlan disabled={!p.data.data.planStore} onDone={p.onSaved} />
        <DeleteMine />
      </Group>
      <Group sid="diagnostics">
        <DiagnosticsPanel />
      </Group>
      {(dev || p.demo) && (
        <Group title="Demo" intro="Fictional data; your own plan isn't touched.">
          {/* ST-1: the switch works only in the developer loop (the hosted demo is "Try the demo" at sign-in). */}
          {dev && (
            <Row id="demo-mode">
              <Switch checked={p.demo} onChange={p.setDemo} />
            </Row>
          )}
          {p.demo && <DemoReset />}
          {p.demo && <DemoPerson />}
        </Group>
      )}
    </Page>
  );
}

/** SA-3: what FocusTime keeps about me, how long, and where each is controlled (ui/settings/keeps.ts). */
function WhatWeKeep({ go }: { go: BodyProps["go"] }) {
  return (
    <Group sid="what-we-keep" title="What FocusTime keeps about you">
      <List label="What FocusTime keeps about you">
        {KEEP_LINES.map((l) => (
          <ListItem key={l.id}>
            {l.what} {l.kept}{" "}
            {l.link.section ? (
              <GoLink section={l.link.section} setting={l.link.setting ?? null} go={go}>
                {l.link.label}
              </GoLink>
            ) : (
              <Button kind="quiet" onClick={() => (location.hash = l.link.href!)}>
                {l.link.label}
              </Button>
            )}
          </ListItem>
        ))}
      </List>
    </Group>
  );
}

/** SA-3: Activity's five logs as tabs; a link to one log opens its tab. */
function ChangedElsewhere(p: BodyProps) {
  const fromHash = (): LogTab => LOG_TABS.find((t) => decodeURIComponent(location.hash).endsWith(`/${t.id}`))?.id ?? "write-log";
  const [tab, setTab] = useState<LogTab>(fromHash);
  useEffect(() => {
    const on = () => setTab((t) => (LOG_TABS.some((x) => decodeURIComponent(location.hash).endsWith(`/${x.id}`)) ? fromHash() : t));
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return (
    <Group title="What FocusTime changed in other apps" intro="Every change FocusTime made for you, with Undo where it can.">
      <Choice label="Which log" options={LOG_TABS.map((t) => ({ value: t.id, label: t.label }))} value={tab} onChange={setTab} />
      <ActivityLog tab={tab} {...p} />
    </Group>
  );
}

/** A2: Export my data: everything FocusTime keeps for the signed-in person, downloaded as one JSON file. */
function ExportMine() {
  const [status, setStatus] = useState<string | null>(null);
  return (
    <Row id="export" status={status !== null} help={status ?? "Your plans, promises, captures, logs and settings. Never a password or token."}>
      <Button
        onClick={async () => {
          try {
            setStatus("Preparing…");
            const r = await call<{ fileName: string; export: unknown }>("data.export_mine", {});
            const url = URL.createObjectURL(
              new Blob([`${JSON.stringify(r.export, null, 2)}\n`], {
                type: "application/json",
              }),
            );
            const a = document.createElement("a");
            a.href = url;
            a.download = r.fileName;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 10_000);
            setStatus(`Downloaded ${r.fileName}`);
          } catch (e) {
            setStatus(e instanceof Error ? e.message : "Export failed");
          }
        }}
      >
        Download JSON
      </Button>
    </Row>
  );
}

/** Reset local plan (Q37): type "reset" to confirm; the server backs the store up first. */
function ResetPlan({ disabled, onDone }: { disabled: boolean; onDone: () => void }) {
  const [asking, setAsking] = useState(false);
  const [typed, setTyped] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const reset = async () => {
    try {
      const r = await call<{ backup: string | null }>("plan.reset", {
        confirm: typed.trim(),
      });
      setStatus(`Done. The plan store was backed up first${r.backup ? ` (${r.backup})` : ""}.`);
      setAsking(false);
      setTyped("");
      onDone();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Not reset");
    }
  };
  return (
    <Row id="reset-plan" status={status !== null} help={status ?? "Empties the plan store after a full backup. Settings and calendars stay."}>
      {asking ? (
        <Form label="Reset my plan" onSubmit={() => void reset()}>
          <Text value={typed} placeholder='Type "reset"' label='Type "reset" to confirm' onChange={setTyped} bind={{ autoFocus: true }} />
          <Button type="submit" kind="danger" disabled={typed.trim() !== "reset"}>
            Reset
          </Button>
          <Button onClick={() => setAsking(false)}>Cancel</Button>
        </Form>
      ) : (
        <Button disabled={disabled} onClick={() => (setAsking(true), setStatus(null))}>
          Reset…
        </Button>
      )}
    </Row>
  );
}

/** A2: Delete my data: signs out and deletes everything kept for this person (kept 30 days, then removed for good). */
function DeleteMine() {
  const [asking, setAsking] = useState(false);
  const [typed, setTyped] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const del = async () => {
    try {
      await call("data.delete_mine", { confirm: "delete" });
      location.replace("/?signin=deleted");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Not deleted");
    }
  };
  return (
    <Row
      id="delete"
      status={status !== null}
      help={status ?? (asking ? "Export first if you want a copy. You'll be signed out and can't sign in again." : "Signs you out and deletes everything FocusTime keeps for you.")}
      more={!status && asking ? "Everything is removed for good after 30 days. Outlook events, DevOps changes and your VM's schedule that FocusTime already made stay as they are." : undefined}
    >
      {asking ? (
        <Form label="Delete my data" onSubmit={() => void del()}>
          <Text value={typed} placeholder='Type "delete"' label='Type "delete" to confirm' onChange={setTyped} bind={{ autoFocus: true }} />
          <Button type="submit" kind="danger" disabled={typed.trim() !== "delete"}>
            Delete
          </Button>
          <Button onClick={() => setAsking(false)}>Cancel</Button>
        </Form>
      ) : (
        <Button onClick={() => (setAsking(true), setStatus(null))}>Delete…</Button>
      )}
    </Row>
  );
}

/** The demo's Reset: puts the demo back as it started. */
function DemoReset() {
  const [state, setState] = useState<"idle" | "resetting" | { error: string }>("idle");
  const reset = async () => {
    setState("resetting");
    try {
      await call<{ reset: boolean; ms: number }>("demo.reset", {});
      // Everything on screen was the old demo: start again from the top.
      location.hash = "#/day";
      location.reload();
    } catch (e) {
      setState({
        error: e instanceof Error ? e.message : "Reset didn't work. Try again",
      });
    }
  };
  return (
    <Row
      id="demo-reset"
      help="Puts the demo back as it started: every change, write, capture and send since is gone. Takes a few seconds."
      more="Fictional data only: nothing in the demo is real and nothing leaves FocusTime. Writes to DevOps and Outlook are simulated, with the real preview, confirm and undo."
    >
      <Buttons result={typeof state === "object" ? state.error : null} tone="problem">
        <Button kind="main" disabled={state === "resetting"} onClick={() => void reset()}>
          {state === "resetting" ? "Resetting…" : "Reset demo"}
        </Button>
      </Buttons>
    </Row>
  );
}

/**
 * DP-3: in the demo, see FocusTime as one of its teammates who use it (their own plan, with what is shared with them),
 * or as yourself again: a second signed-in person, so a shared deployment can be tried from both sides.
 */
function DemoPerson() {
  const [st, setSt] = useState<{
    current: string;
    people: { id: string; name: string }[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => void call<{ current: string; people: { id: string; name: string }[] }>("demo.be", {}).then(setSt, (e: unknown) => setError(e instanceof Error ? e.message : "Couldn't check")), []);
  const choose = async (who: string) => {
    try {
      await call("demo.be", { who });
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work");
    }
  };
  return (
    <Row id="demo-be" status={error !== null} help={error ?? "A teammate who uses FocusTime, with their own plan: a deployment you add them to shows there."}>
      <Select
        disabled={!st}
        options={(st?.people ?? []).map((x) => ({
          value: x.id,
          label: x.id === "me" ? `${x.name} (you)` : x.name,
        }))}
        value={st?.current ?? "me"}
        onChange={(w) => void choose(w)}
      />
    </Row>
  );
}
