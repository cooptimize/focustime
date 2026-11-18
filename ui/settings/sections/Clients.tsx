// SA-2: Settings › Clients and a client's own page, drawn with the parts (ui/settings/parts.tsx). The client chats
// and the data platform come from components Admin shares (DeliveryChatField, DeploySettings): they keep their own
// look here until SA-4 redraws Admin with these parts.
import { useEffect, useState } from "react";
import type { SettingsClient, SettingsData } from "../../../actions/types.ts";
import type { FollowState } from "../../../week/follow.ts";
import { call } from "../../api.ts";
import { DeploySettings } from "../../DeployItems.tsx";
import { shortDate } from "../../labels.ts";
import { useAutoSave } from "../autosave.tsx";
import { DeliveryChatField, DeliveryChatsProvider } from "../DeliveryChats.tsx";
import { Fold, GoLink, Group, LinkItem, Links, Note, Page, Pre, Row, Swatches, Switch, TeamDefault, Text, Value, Button } from "../parts.tsx";
import { settingsHref } from "../registry.ts";
import { NumRow } from "./fields.tsx";
import { labelBy, markOf } from "./shared.ts";
import type { BodyProps, FormProps } from "./types.ts";
import { usePlan } from "./usePlan.ts";

const fullDate = (d: string) => Temporal.PlainDate.from(d).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric" });
/** Why a client is (or isn't) followed, in plain words (step 6d). */
export function followText(f: FollowState | null, grace: number): string {
  if (!f) return "Unknown until Dataverse connects.";
  switch (f.why) {
    case "internal": return "Always followed (internal).";
    case "standing": return "Always followed (standing block).";
    case "ongoing": return "Followed: focus time is ongoing.";
    case "until": return `Followed: focus time until ${fullDate(f.date)}.`;
    case "grace": return `Followed until ${fullDate(f.until)}: focus time ended ${fullDate(f.date)} (${grace} days grace).`;
    case "kept": return "Followed because Keep following is on.";
    case "ended": return `Not followed: focus time ended ${fullDate(f.date)}. No DevOps items or Open half-day choices.`;
    case "none": return "Not followed: no focus time. No DevOps items or Open half-day choices.";
  }
}

const nameOf = (c: SettingsClient) => c.setting.name ?? c.dataverseName ?? c.key;

/** ST-1: Clients › Keep following after focus time ends (a [plan] key; under Planning before). */
function FollowGraceForm(p: FormProps) {
  const a = usePlan(p, ["followGraceDays"] as const);
  return <NumRow a={a} k="followGraceDays" id="follow-grace" help="Clients stay followed this long after their focus time ends." min={1} max={90} step={1} />;
}

/** ST-1: Clients: how long a client stays followed, then one row per client that opens its own page. */
export function ClientsSection(p: BodyProps) {
  const d = p.data;
  const followed = d.clients.filter((c) => c.follow?.active !== false);
  const other = d.clients.filter((c) => c.follow?.active === false);
  const item = (c: SettingsClient) => (
    <LinkItem
      key={c.key}
      href={settingsHref("client", c.key)}
      onGo={() => p.go("client", c.key)}
      color={c.setting.color || c.teamColor || ""}
      name={nameOf(c)}
      detail={`${c.follow?.active === false ? "Not followed" : "Followed"} · ${c.devops ? (c.write ? "DevOps writes on" : "DevOps read-only") : "No DevOps"}`}
    />
  );
  return (
    <Page>
      <Group>
        <FollowGraceForm {...p} />
      </Group>
      <Group sid="client-list">
        <Row
          id="client-list"
          noSid
          wide
          help="From Dataverse (your Account Worker records and focus time). Open one to change how it shows."
          below={
            d.dataverseProblem ? (
              <Note tone="problem" live>
                {d.dataverseProblem} <Button kind="quiet" onClick={() => void p.reload()}>Refresh</Button>
              </Note>
            ) : d.clients.length === 0 ? (
              <Note>No clients yet.</Note>
            ) : undefined
          }
        />
        <Links>{followed.map(item)}</Links>
        {other.length > 0 && (
          <Fold label="Not followed" count={other.length}>
            <Links>{other.map(item)}</Links>
          </Fold>
        )}
      </Group>
    </Page>
  );
}

/** One client's own page: its settings, its DevOps identity (Dataverse's) and, when it has DevOps, my write access. */
export function ClientSection(p: BodyProps) {
  const c = p.client;
  const d = p.data;
  if (!c)
    return (
      <Page>
        <Note>
          This client isn't one of yours.{" "}
          <GoLink section="clients" go={p.go}>
            See your clients
          </GoLink>
          .
        </Note>
      </Page>
    );
  const name = nameOf(c);
  const allowed = d.aiRules.allowedClients.includes(c.key);
  return (
    <DeliveryChatsProvider>
      <Page>
        <ClientForm client={c} data={d} onSavedData={p.onSavedData} />
        <Group>
          {c.devops ? (
            <Row
              id="client-writes"
              help={c.write ? `As ${c.write.name} on ${c.write.org}${c.write.expires ? `, expires ${shortDate(c.write.expires)}` : ""}.` : "Add your own PAT to write to DevOps."}
              below={
                <GoLink section="devops" setting="devops-write" go={p.go}>
                  {c.write ? "Change DevOps write access" : "Turn on DevOps writes"}
                </GoLink>
              }
            >
              <Value>{c.write ? "On" : "Off, read-only"}</Value>
            </Row>
          ) : (
            d.dataverseReached && <Note>No DevOps set up for {name} in Dataverse, so there is nothing to write to. Change it in Dataverse.</Note>
          )}
        </Group>
        <Group sid="client-chats">
          <DeliveryChatField clientKey={c.key} clientName={name} readOnly />
        </Group>
        <Group>
          <Row id="client-ai" team>
            <Value>{!d.aiRules.on ? "Off for FocusTime" : allowed ? `Allowed for ${name}` : `Not allowed for ${name}`}</Value>
          </Row>
        </Group>
        <Group sid="client-platform">
          <DeploySettings clientKey={c.key} clientName={name} />
        </Group>
        {c.devops && <HouseStyle clientKey={c.key} name={name} />}
      </Page>
    </DeliveryChatsProvider>
  );
}

type HouseStyleData = { clientKey: string; text: string; computed: string | null; computedAt: string | null; learned: boolean; edited: string | null; team?: string | null; read?: boolean | null };

/** DS-1, ADM-1: the client's house style for Break down. The team's (a Rule, Admin › Clients) when set, else learned. */
function HouseStyle({ clientKey, name }: { clientKey: string; name: string }) {
  const [h, setH] = useState<HouseStyleData | null>(null);
  useEffect(() => void call<HouseStyleData>("stories.house_style", { clientKey }).then(setH, () => setH(null)), [clientKey]);
  if (!h) return null;
  return (
    <Group>
      <Row id="client-house-style" wide team={h.team ? true : undefined} help={h.team ? null : h.learned ? `Learned from ${name}'s own features each week. A FocusTime admin can set the team's in Admin › Clients.` : "The default: too few features with stories to learn from yet."}>
        <Pre>{h.text}</Pre>
      </Row>
    </Group>
  );
}

function ClientForm({ client: c, data, onSavedData }: { client: SettingsClient; data: SettingsData; onSavedData: (d: SettingsData) => void }) {
  const reached = data.dataverseReached;
  const a = useAutoSave({
    section: "client",
    initial: { name: c.setting.name ?? "", color: c.setting.color ?? "", keep: c.setting.follow },
    payload: (v) => ({ key: c.key, name: v.name, color: v.color, follow: v.keep }),
    onSaved: onSavedData,
    label: (k) => `${c.setting.name ?? c.key}: ${labelBy({ name: "client-shown-as", color: "client-color", keep: "client-followed" })(k)}`,
  });
  // ADM-1: the team color (a Default set by an admin) unless you pick your own; Reset clears yours.
  const team = c.teamColor ?? "";
  const color = a.v.color || team;
  const own = !!a.v.color && a.v.color !== team;
  const openStates = data.org?.clients[c.key]?.openStates ?? c.setting.openStates;
  return (
    <Group title={c.setting.name ?? c.key}>
      <Row id="client-nickname" help="Change this in Dataverse">
        <Value>{c.dataverseName ?? c.key}</Value>
      </Row>
      <Row id="client-identity" help="Change this in Dataverse">
        <Value>{c.devopsEmail ?? (reached ? null : "unknown until Dataverse connects")}</Value>
      </Row>
      <Row id="client-shown-as" help="Empty shows the Dataverse nickname." mark={markOf(a, "name")}>
        <Text value={a.v.name} placeholder={c.key} maxLength={60} onChange={(x) => a.set("name", x)} bind={a.text("name")} />
      </Row>
      <Row
        id="client-color"
        wide
        mark={markOf(a, "color")}
        help={[color.startsWith("#") ? `Custom color ${color} (pick a palette color to use theme-aware colors).` : null, own ? (team ? null : "Your own color.") : team ? "The team color, set by your FocusTime admin. Pick another to use your own." : "No team color yet."].filter(Boolean).join(" ") || undefined}
        team={own && team ? <TeamDefault value={team} onReset={() => a.change("color", "")} /> : undefined}
      >
        <Swatches name={`color-${c.key}`} values={data.palette} value={color} onChange={(slot) => a.change("color", slot)} />
      </Row>
      <Row id="client-followed" help={followText(c.follow, data.planning.followGraceDays)} mark={markOf(a, "keep")}>
        <Switch checked={a.v.keep} onChange={(on) => a.change("keep", on)} disabled={c.follow?.why === "internal" || c.follow?.why === "standing"} />
      </Row>
      <Row id="client-open-states" team>
        <Value>{openStates.join(", ") || "None"}</Value>
      </Row>
    </Group>
  );
}
