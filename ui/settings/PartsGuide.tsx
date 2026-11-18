// SA-2: the style guide's page of Settings parts (docs/design/style-guide.md section 12): each part once, with a
// kind of choice and its control. Real registry ids, so the labels are the ones Settings shows.
import { useState } from "react";
import { Button, Buttons, Choice, Fold, Group, List, ListItem, Num, Page, Row, Select, Switch, Table, TeamDefault, Text, Time } from "./parts.tsx";

export function PartsGuide() {
  const [on, setOn] = useState(true);
  const [theme, setTheme] = useState("dark");
  const [sound, setSound] = useState("brown");
  const [mins, setMins] = useState(50);
  const [at, setAt] = useState("08:45");
  const [name, setName] = useState("Northwind");
  const [items, setItems] = useState(["Monday AM · Internal", "Friday PM · Catch-up"]);
  const [tested, setTested] = useState<string | null>(null);
  return (
    <div data-sg="settings-parts">
      <Page>
        <Group title="A group" intro="One intro line under the heading says what the group is for.">
          <Row id="reduce-motion" mark={{ s: { kind: "saved" }, retry: () => {} }}>
            <Switch checked={on} onChange={setOn} />
          </Row>
          <Row id="theme">
            <Choice options={[{ value: "dark", label: "Dark" }, { value: "light", label: "Light" }, { value: "neutral", label: "Neutral" }]} value={theme} onChange={setTheme} />
          </Row>
          <Row id="sound">
            <Select options={["none", "brown", "pink", "rain", "alpha", "beta"].map((v) => ({ value: v, label: v }))} value={sound} onChange={setSound} />
          </Row>
          <Row id="focus-length" team={<TeamDefault value="50 minutes" onReset={() => setMins(50)} />}>
            <Num value={mins} onChange={setMins} min={5} max={240} />
          </Row>
          <Row id="plan-reminder" team>
            <Time value={at} onChange={setAt} />
          </Row>
          <Row id="time-zone">
            <Text value={name} onChange={setName} />
          </Row>
        </Group>
        <Group title="A list and an action">
          <Row id="standing-blocks" wide>
            <List add={<Button onClick={() => setItems([...items, "Tuesday AM · Internal"])}>Add a standing block</Button>}>
              {items.map((t, i) => (
                <ListItem key={i} onRemove={() => setItems(items.filter((_, j) => j !== i))} removeLabel={`Remove ${t}`}>
                  {t}
                </ListItem>
              ))}
            </List>
          </Row>
          <Row id="ai-test">
            <Buttons result={tested}>
              <Button kind="main" onClick={() => setTested("Answered in 0.8 s.")}>Test AI</Button>
            </Buttons>
          </Row>
          <Fold label="A fold" count={2}>
            <Row id="volume" />
            <Row id="fade" />
          </Fold>
        </Group>
        <Group title="A table">
          <Table label="Example log" head={["When", "What", "Result"]} rows={[["Today 9:12", "Status Busy", "Done"], ["Yesterday 14:03", "Cleared", "Done"]]} />
        </Group>
      </Page>
    </div>
  );
}
