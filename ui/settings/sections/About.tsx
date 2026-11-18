// SA-2: Settings › About, drawn with the parts: the lockup, the version, which site this is, the Guide and (in the
// developer loop) the style guide.
import { version as APP_VERSION } from "../../../package.json";
import { siteLine, useDeveloperLoop, useKnownEnv } from "../../appenv.ts";
import { Lockup } from "../../brand/Brand.tsx";
import { Button, Group, Note, OutLink, Page, Row, Value } from "../parts.tsx";

export function AboutSection({ onGuide }: { onGuide?: (() => void) | undefined }) {
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
        {dev && (
          <Row id="style-guide" help="Tokens and components in each theme (developer loop).">
            <OutLink href="/styleguide">Open the style guide</OutLink>
          </Row>
        )}
      </Group>
    </Page>
  );
}
