// SA-2: Settings › Profile, drawn with the parts (ui/settings/parts.tsx). SA-3: with Your level (from Day and Week);
// the Dataverse lines and Start over only for admins, and for nobody on production.
import { useContext, useEffect, useState } from "react";
import { AuthCtx, usePhotosAccess } from "../../Account.tsx";
import { call } from "../../api.ts";
import { useAppEnv, useDeveloperLoop } from "../../appenv.ts";
import type { SetupView } from "../../../plan/setup.ts";
import { Button, Buttons, GoLink, Group, Note, Page, Result, Row, Value } from "../parts.tsx";
import type { BodyProps, Props } from "./types.ts";
import { useAdmin } from "../use-admin.ts";

const errText = (e: unknown) => (e instanceof Error ? e.message : "That didn't work");

/** SA-3: admin-only lines show to admins, and to nobody on production (or before the environment is known). */
export function useAdminLines(): boolean {
  const admin = useAdmin();
  const env = useAppEnv();
  return admin === true && env !== null && env !== "prod";
}

export function ProfileSection(p: BodyProps) {
  const d = p.data;
  const adminLines = useAdminLines();
  const org = d.org;
  const level = org?.levelName ? `${org.levelName}${org.levelSource === "override" ? " (set by an admin)" : ""}` : "No level from Dataverse yet";
  return (
    <Page>
      <Group>
        <SignedIn />
        {d.you && (
          <>
            <Row id="email" help={d.fromFile ? "Used only when signed out ([dataverse] my_email in config.toml)" : "From your Microsoft sign-in"}>
              <Value>{d.you.email}</Value>
            </Row>
            {adminLines && (
              <>
                <Row id="dataverse-user" help="Change this in Dataverse">
                  <Value>{d.you.systemUserId ? "Found" : "Not found yet"}</Value>
                </Row>
                <Row id="environment" help={d.fromFile ? "Set in config.toml ([dataverse] environment_url)" : null} team={d.fromFile ? undefined : true}>
                  <Value>{d.you.environmentUrl}</Value>
                </Row>
              </>
            )}
          </>
        )}
        {org && (
          <Row id="level" help="From your position in Dataverse. It changes suggestions only (Offer Break down and Needs attention nudges in Planning), never what you can do.">
            <Value>{level}</Value>
          </Row>
        )}
      </Group>
      <Note>
        {p.demo ? `Your settings save as you change them, to ${d.configPath}. ` : null}Your time zone is under{" "}
        <GoLink section="hours" setting="time-zone" go={p.go}>
          Working hours
        </GoLink>
        .
      </Note>
      <Group>
        <SetupRow {...p} />
      </Group>
    </Page>
  );
}

function SignedIn() {
  const dev = useDeveloperLoop();
  const { status, signIn, signOut } = useContext(AuthCtx);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const photos = usePhotosAccess();
  const run = async (f: () => Promise<unknown>) => {
    setBusy(true);
    setMessage(null);
    try {
      await f();
    } catch (e) {
      setMessage(errText(e));
    } finally {
      setBusy(false);
    }
  };
  if (!status?.configured) return <Note>{dev ? "Microsoft sign-in needs an app registration: set [outlook] client_id in config." : "Microsoft sign-in isn't set up for this FocusTime yet."}</Note>;
  const person = status.person;
  const signedIn = status.state !== "signed_out";
  return (
    <>
      <Row
        id="signed-in"
        help={status.state === "unavailable" ? `Offline or keyring locked: showing who was signed in. ${status.message ?? ""}` : "One Microsoft sign-in for you, your calendar and your Azure VM."}
        more={signedIn ? "Your plan stays in your FocusTime account." : undefined}
        below={message ? <Result tone="problem">{message}</Result> : undefined}
      >
        <Value>{person && signedIn ? `${person.name} · ${person.username}` : "Not signed in"}</Value>
        {signedIn ? (
          <Button disabled={busy} onClick={() => void run(signOut)}>
            Sign out
          </Button>
        ) : (
          <Button kind="main" disabled={busy} onClick={() => void run(async () => setMessage(await signIn(true)))}>
            Sign in with Microsoft
          </Button>
        )}
      </Row>
      {signedIn && (
        <Row id="photos" help={photos.text} below={photos.message ? <Result tone="problem">{photos.message}</Result> : undefined}>
          {photos.allow && (
            <Button kind="main" disabled={photos.busy} onClick={photos.allow}>
              Allow photos
            </Button>
          )}
        </Row>
      )}
    </>
  );
}

/**
 * S1 (D451): Settings > Setup. Run setup again opens the four screens on the same settings (nothing is duplicated:
 * each screen saves Working hours, Clients, Standing blocks or Connections as those sections do). Start over forgets
 * the setup record so the flow opens by itself again; dev and local only.
 */
function SetupRow(p: Props) {
  const [view, setView] = useState<SetupView | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  // SA-3: Start over only for admins, never on production (the server refuses it on prod too).
  const adminLines = useAdminLines();
  useEffect(() => {
    call<SetupView>("setup.load", {}).then(setView, () => setView(null));
  }, []);
  if (p.demo) return <Row id="setup" help="Setup isn't part of the demo." />;
  // RF-1: what's left, even once Today stopped offering it.
  const left = view?.left?.text;
  return (
    <Row
      id="setup"
      wide
      help={view ? (left ? `${left}.` : "Every step is done.") : ""}
      more="The four first-run screens: your day, your clients, standing blocks and calendars. They change the same settings as the sections here."
    >
      <Buttons result={status}>
        <Button kind="main" onClick={() => p.onSetup?.(view?.left?.step ?? "day")}>
          {left ? "Finish setup" : "Run setup again"}
        </Button>
        {left && <Button onClick={() => p.onSetup?.("day")}>Run setup from the start</Button>}
        {adminLines && (
          <Button
            kind="quiet"
            title="Forget your setup record, so the screens open by themselves next time (dev and local only)"
            onClick={async () => {
              try {
                setView(await call<SetupView>("setup.reset", {}));
                setStatus("Setup record cleared. The screens open by themselves the next time FocusTime opens");
              } catch (e) {
                setStatus(e instanceof Error ? e.message : "Not cleared");
              }
            }}
          >
            Start over
          </Button>
        )}
      </Buttons>
    </Row>
  );
}

