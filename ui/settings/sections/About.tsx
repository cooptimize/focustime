// SA-2: Settings › About, drawn with the parts: the lockup, the version, which site this is, the Guide, Send feedback
// (SA-3, from Accounts and calendars) and (in the developer loop) the style guide.
import { useEffect, useState } from "react";
import type { FeedbackStatus } from "../../../actions/feedback-types.ts";
import { version as APP_VERSION } from "../../../package.json";
import { call } from "../../api.ts";
import { siteLine, useDeveloperLoop, useKnownEnv } from "../../appenv.ts";
import { Lockup } from "../../brand/Brand.tsx";
import { Button, Buttons, GoLink, Group, Note, OutLink, Page, Result, Row, Value } from "../parts.tsx";

type Go = (section: string, setting?: string | null) => void;

export function AboutSection({ onGuide, go }: { onGuide?: (() => void) | undefined; go?: Go | undefined }) {
  const dev = useDeveloperLoop();
  const env = useKnownEnv();
  return (
    <Page>
      <Group>
        <Lockup />
        <Row id="version" below={<>{env && <Note site>Site: {siteLine(env, location.host)}</Note>}<Note>FocusTime is made by Cooptimize, for planning a week of client work.</Note></>}>
          <Value>{APP_VERSION}</Value>
        </Row>
        <Row id="guide" help="How FocusTime works, the keys and the questions people ask.">
          <Button onClick={() => onGuide?.()}>Open the Guide</Button>
        </Row>
        {go && <FeedbackRow go={go} />}
        {dev && (
          <Row id="style-guide" help="Tokens and components in each theme (developer loop).">
            <OutLink href="/styleguide">Open the style guide</OutLink>
          </Row>
        )}
      </Group>
    </Page>
  );
}

/** Send feedback: where it goes and how many are left today; Turn on DevOps writes when it needs a PAT. */
function FeedbackRow({ go }: { go: Go }) {
  const [st, setSt] = useState<FeedbackStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = (fresh: boolean) => call<FeedbackStatus>("feedback.status", fresh ? { fresh: true } : {}).then((r) => (setSt(r), setError(null)), (e: unknown) => setError(e instanceof Error ? e.message : "Couldn't check"));
  useEffect(() => void load(false), []);
  return (
    <Row id="feedback" wide status help={error ?? (st ? st.line : "Checking…")} below={
        st ? (
          <>
            <Result>{`${st.destination}.`}</Result> <Result>{`${st.sentToday} of ${st.limit} sent today.`}</Result>
          </>
        ) : undefined
      }>
      <Buttons>
        {st?.setup.state === "no_pat" && (
          <GoLink kind="button" section="connections" setting="devops-write" go={go}>
            Turn on DevOps writes
          </GoLink>
        )}
        {st && <Button onClick={() => void load(true)}>Check again</Button>}
      </Buttons>
    </Row>
  );
}
