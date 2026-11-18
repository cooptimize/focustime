// SA-2: Settings › Focus, drawn with the parts (ui/settings/parts.tsx).
import { useEffect, useState } from "react";
import { BINAURAL, MAX_PLAYLISTS, playlistLink, SOUND_NAMES, SOUNDS, type Playlist, type SoundKind } from "../../../plan/focussound.ts";
import { useTeamsAccess } from "../../Account.tsx";
import { call } from "../../api.ts";
import { sound } from "../../sound.ts";
import { useAutoSave } from "../autosave.tsx";
import { Button, Buttons, Choice, Group, Level, List, ListItem, Page, Result, Row, Select, Switch, Text } from "../parts.tsx";
import { NumRow, SwitchRow } from "./fields.tsx";
import { labelBy, markOf } from "./shared.ts";
import type { FormProps } from "./types.ts";
import { usePlan } from "./usePlan.ts";

export function FocusSection(p: FormProps) {
  return (
    <Page>
      <FocusTimerForm {...p} />
      <FocusForm {...p} />
    </Page>
  );
}

/** ST-1: Focus › Focus timer (these are [plan] keys; they lived under Planning before). */
function FocusTimerForm(p: FormProps) {
  const a = usePlan(p, ["focusMinutes", "breakMinutes", "endSound"] as const);
  return (
    <Group title="Focus timer">
      <NumRow a={a} k="focusMinutes" id="focus-length" help="The default for a plain timer. A to-do suggests its size instead." max={240} />
      <NumRow a={a} k="breakMinutes" id="break-length" help="Offered when a session ends. 0 for none." max={60} />
      <SwitchRow a={a} k="endSound" id="end-sound" help="With the notification when a session ends." />
    </Group>
  );
}

const FOCUS_IDS = { sound: "sound", volume: "volume", fadeSeconds: "fade", onBreak: "on-break", pauseMedia: "pause-media", teamsStatus: "teams-status", plainFocusStatus: "plain-focus-status", playlists: "playlists" };

/** Settings > Focus (step 10): the default sound, volume, fade, what a break sounds like, media pause, playlists. */
function FocusForm(p: FormProps) {
  const f = p.data.focus;
  const a = useAutoSave({
    section: "focus",
    initial: { sound: f.sound, volume: f.volume, fadeSeconds: f.fadeSeconds, onBreak: f.onBreak, pauseMedia: f.pauseMedia, teamsStatus: f.teamsStatus, plainFocusStatus: f.plainFocusStatus, playlists: f.playlists as Playlist[] },
    payload: (v) => ({ ...v, playlists: v.playlists.filter((l) => l.name.trim() || l.url.trim()) }),
    onSaved: p.onSavedData,
    label: labelBy(FOCUS_IDS),
  });
  const v = a.v;
  const lists = v.playlists;
  const teams = useTeamsAccess();
  const [media, setMedia] = useState<{ players: boolean; spotify: boolean } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  useEffect(() => {
    call<{ players: boolean; spotify: boolean }>("media.status", {}).then(setMedia, () => setMedia(null));
  }, []);
  const preview = async () => {
    if (v.sound === "none") return;
    await sound.unlock();
    sound.setVolume(v.volume);
    sound.play(v.sound, 1);
    setPreviewing(true);
    setTimeout(() => {
      sound.stop(1);
      setPreviewing(false);
    }, 6000);
  };
  const badLink = (u: string) => !!u.trim() && !playlistLink(u);
  // A playlist row saves when you leave it, and only once its link is a good one (or empty).
  const editList = (i: number, patch: Partial<Playlist>) => a.set("playlists", lists.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const leaveList = () => {
    if (!lists.some((l) => badLink(l.url))) a.commit("playlists");
  };
  const listKeys = { onBlur: leaveList, onKeyDown: (e: { key: string; preventDefault: () => void }) => e.key === "Enter" && (e.preventDefault(), leaveList()) };
  return (
    <>
      <Group title="Teams status" intro="Set while focus runs, back to automatic after. A change you make in Teams wins.">
        <Row
          id="teams-status"
          help="Logged in Settings › Your data › Teams status log."
          mark={markOf(a, "teamsStatus")}
          below={
            teams.text || teams.allow ? (
              <Buttons result={teams.message} tone="problem">
                <Result>{teams.text}</Result>
                {teams.allow && (
                  <Button kind="main" disabled={teams.busy} onClick={teams.allow}>
                    Allow Teams status
                  </Button>
                )}
              </Buttons>
            ) : undefined
          }
        >
          <Switch checked={v.teamsStatus} onChange={(on) => a.change("teamsStatus", on)} />
        </Row>
        <Row id="plain-focus-status" help="Deep focus always sets Do not disturb." mark={markOf(a, "plainFocusStatus")}>
          <Choice
            disabled={!v.teamsStatus}
            options={[
              { value: "busy", label: "Busy" },
              { value: "none", label: "Nothing: leave my status alone" },
            ]}
            value={v.plainFocusStatus}
            onChange={(x) => a.change("plainFocusStatus", x as "busy" | "none")}
          />
        </Row>
      </Group>
      <Group title="Sound while focusing" intro="Plays only while focus runs. The focus screen can pick another.">
        <Row id="sound" help={BINAURAL[v.sound as SoundKind] ? "Binaural beats need headphones." : "Brown is deep, pink brighter, rain a slow swell."} mark={markOf(a, "sound")}>
          <Select options={SOUNDS.map((k) => ({ value: k, label: SOUND_NAMES[k] }))} value={v.sound} onChange={(k) => a.change("sound", k as SoundKind)} />
          <Button disabled={v.sound === "none" || previewing} onClick={() => void preview()}>
            {previewing ? "Playing…" : "Try it"}
          </Button>
        </Row>
        <Row id="volume" help="0 to 100." mark={markOf(a, "volume")}>
          <Level
            value={v.volume}
            onChange={(n) => {
              a.set("volume", n);
              sound.setVolume(n);
            }}
            onCommit={() => a.commit("volume")}
          />
        </Row>
        <NumRow a={a} k="fadeSeconds" id="fade" help="0 to 30." max={30} step={1} />
        <Row id="on-break" help="The sound stops either way." mark={markOf(a, "onBreak")}>
          <Choice
            options={[
              { value: "silence", label: "Silence" },
              { value: "chime", label: "A soft chime" },
            ]}
            value={v.onBreak}
            onChange={(x) => a.change("onBreak", x as "silence" | "chime")}
          />
        </Row>
      </Group>
      <Group title="Music players">
        <Row
          id="pause-media"
          help={
            media === null
              ? "Checking for music players…"
              : media.players
                ? "Pauses what is playing when focus ends or a break starts, and resumes it when the next focus starts."
                : "FocusTime can't pause or resume music players here. Nothing is installed for you."
          }
          mark={markOf(a, "pauseMedia")}
        >
          <Switch checked={v.pauseMedia} disabled={media !== null && !media.players && !v.pauseMedia} onChange={(on) => a.change("pauseMedia", on)} />
        </Row>
      </Group>
      <Group>
        <Row
          id="playlists"
          wide
          help={`Keep up to ${MAX_PLAYLISTS} Spotify or YouTube links.`}
          more={`Choosing one on the focus screen opens it: ${media?.spotify ? "Spotify links in the Spotify app" : "in your default browser (the Spotify app isn't installed)"}.`}
          mark={markOf(a, "playlists")}
        >
          <List add={lists.length < MAX_PLAYLISTS && <Button onClick={() => a.set("playlists", [...lists, { name: "", url: "" }])}>Add a playlist</Button>}>
            {lists.map((l, i) => (
              <ListItem key={i} removeLabel={`Remove playlist ${l.name || i + 1}`} onRemove={() => a.change("playlists", lists.filter((_, j) => j !== i))} below={badLink(l.url) ? <Result tone="problem">Only Spotify or YouTube links (https)</Result> : undefined}>
                <Text value={l.name} placeholder="Name" label={`Playlist ${i + 1} name`} maxLength={60} onChange={(name) => editList(i, { name })} bind={listKeys} />
                <Text value={l.url} placeholder="https://open.spotify.com/playlist/… or https://www.youtube.com/playlist?list=…" label={`Playlist ${i + 1} link`} maxLength={500} onChange={(url) => editList(i, { url })} bind={{ ...listKeys, "aria-invalid": badLink(l.url) }} />
              </ListItem>
            ))}
          </List>
        </Row>
      </Group>
    </>
  );
}

