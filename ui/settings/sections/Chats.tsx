// SA-2: Settings › Client chats, drawn with the parts (ui/settings/parts.tsx).
import { useEffect, useState } from "react";
import type { RequestsData } from "../../../plan/asks.ts";
import { call } from "../../api.ts";
import { useAutoSave } from "../autosave.tsx";
import { pollText } from "../DeliveryChats.tsx";
import { Group, List, ListItem, Page, Row, State, Text, Value } from "../parts.tsx";
import { labelBy, markOf } from "./shared.ts";
import type { FormProps } from "./types.ts";

/** The phrases the rules use (the chats are read every 5 minutes for everyone, D514). Commas between phrases. */
const phrases = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

export function ChatsSection(p: FormProps) {
  return (
    <Page>
      <PhrasesForm {...p} />
      <ChatsRead />
    </Page>
  );
}

function PhrasesForm(p: FormProps) {
  const s = p.data.asks;
  // ADM-1: the team's lists are a Default an admin sets; a person adds their own on top and never removes the team's.
  const team = p.data.org?.phrases.team ?? null;
  const a = useAutoSave({
    section: "asks",
    initial: { requestPhrases: s.requestPhrases.join(", "), ackPhrases: s.ackPhrases.join(", "), promisePhrases: (s.promisePhrases ?? []).join(", ") },
    payload: (v) => ({ requestPhrases: phrases(v.requestPhrases), ackPhrases: phrases(v.ackPhrases), promisePhrases: phrases(v.promisePhrases) }),
    onSaved: p.onSavedData,
    label: labelBy({ requestPhrases: "request-phrases", ackPhrases: "ack-phrases", promisePhrases: "promise-phrases" }),
  });
  const field = (k: "requestPhrases" | "ackPhrases" | "promisePhrases", id: string, help: string) => (
    <Row id={id} wide help={help} mark={markOf(a, k)}>
      <Text wide value={a.v[k]} onChange={(x) => a.set(k, x)} bind={a.text(k)} />
    </Row>
  );
  return (
    <Group
      title="Phrases"
      intro={`Each client chat registered below is read every ${p.data.org?.rules.pollMinutes ?? 5} minutes in working hours, once for everyone who follows the client.`}
      more="A new message from someone outside Cooptimize is checked for what it asks when it mentions a Cooptimizer, has a question mark, uses an asking phrase, or has an attachment; one that is only an acknowledgement is never checked. An urgent one can bring an Urgent request notice. The asking phrases used are the team's plus those of the person whose sign-in read the chat. Your own messages with one of the promise phrases become your promises. When a FocusTime admin allows AI for a client, AI sorts these; otherwise the rules alone decide."
    >
      {team && (
        <>
          <Row id="team-phrases" team />
          <Row id="team-request-phrases" wide>
            <Value>{team.request.join(", ") || "None"}</Value>
          </Row>
          <Row id="team-ack-phrases" wide>
            <Value>{team.ack.join(", ") || "None"}</Value>
          </Row>
          <Row id="team-promise-phrases" wide>
            <Value>{team.promise.join(", ") || "None"}</Value>
          </Row>
        </>
      )}
      {field("requestPhrases", "request-phrases", team ? "Added on top of the team's. Commas between them." : "Commas between them. Whole words, any case.")}
      {field("ackPhrases", "ack-phrases", "A message that is only these (and emoji) is never checked.")}
      {field("promisePhrases", "promise-phrases", "In your own messages: commas between them. Inbox › Promises.")}
    </Group>
  );
}

/** One line per client chat I see, with how it's read or its problem. One failing chat never hides the others. */
function ChatsRead() {
  const [d, setD] = useState<RequestsData | null>(null);
  useEffect(() => {
    let live = true;
    void call<RequestsData>("requests.list", {}).then((x) => live && setD(x), () => undefined);
    return () => void (live = false);
  }, []);
  return (
    <Group>
      <Row id="chats-read" wide help={d && !d.chats.length ? "None yet." : undefined}>
        {d && d.chats.length > 0 && (
          <List>
            {d.chats.map((c) => (
              <ListItem key={c.chatId}>
                {c.clientName} · {c.chatName} · {c.state === "reconnect" || c.state === "retry" ? <State tone="error">{pollText(c, null)}</State> : pollText(c, null)}
              </ListItem>
            ))}
          </List>
        )}
      </Row>
    </Group>
  );
}
