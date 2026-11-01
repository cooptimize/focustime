// Focus sounds made in the app with Web Audio (step 10): brown, pink and rain-like noise, binaural beats, and a
// soft chime. No files, no network. One engine per window; the timer decides what plays (plan/focussound.ts).
import { BINAURAL, type SoundKind } from "../plan/focussound.ts";

type Playing = { kind: SoundKind; gain: GainNode; stop: () => void };

const NOISE_SECONDS = 8;

/** A looping noise buffer: brown (integrated white) or pink (Paul Kellet's filter). */
function noiseBuffer(ctx: AudioContext, color: "brown" | "pink" | "white"): AudioBuffer {
  const len = ctx.sampleRate * NOISE_SECONDS;
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let last = 0, b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (color === "brown") {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      } else if (color === "pink") {
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      } else d[i] = w * 0.5;
    }
    // Cross-fade the loop point so it doesn't click.
    const fade = Math.floor(ctx.sampleRate * 0.05);
    for (let i = 0; i < fade; i++) {
      const t = i / fade;
      d[i] = d[i]! * t + d[len - fade + i]! * (1 - t);
    }
  }
  return buf;
}

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private playing: Playing | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private volume = 0.4;

  private audio(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
    }
    return this.ctx;
  }
  private buffer(color: "brown" | "pink" | "white"): AudioBuffer {
    const ctx = this.audio();
    let b = this.buffers.get(color);
    if (!b) this.buffers.set(color, (b = noiseBuffer(ctx, color)));
    return b;
  }

  /** The browser may hold audio until a click; true when it can play now. */
  get blocked(): boolean {
    return !!this.ctx && this.ctx.state === "suspended";
  }
  async unlock(): Promise<boolean> {
    const ctx = this.audio();
    if (ctx.state === "suspended") await ctx.resume().catch(() => {});
    return ctx.state === "running";
  }
  get current(): SoundKind | null {
    return this.playing?.kind ?? null;
  }

  /** 0 to 100. */
  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(100, v)) / 100;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.1);
  }

  /** Plays one sound (fading in), replacing what plays (fading out). Same sound: nothing changes. */
  play(kind: SoundKind, fadeSeconds: number): void {
    if (kind === "none") return this.stop(fadeSeconds);
    if (this.playing?.kind === kind) return;
    this.stop(fadeSeconds);
    const ctx = this.audio();
    void this.unlock();
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.master!);
    const stops: (() => void)[] = [];
    const bin = BINAURAL[kind];
    if (bin) {
      // Binaural: a tone per ear, a few hertz apart; the beat is heard between them (headphones).
      const merge = ctx.createChannelMerger(2);
      const level = ctx.createGain();
      level.gain.value = 0.25;
      for (const [ch, f] of [[0, bin.carrier], [1, bin.carrier + bin.beat]] as const) {
        const o = ctx.createOscillator();
        o.frequency.value = f;
        o.connect(merge, 0, ch);
        o.start();
        stops.push(() => o.stop());
      }
      merge.connect(level).connect(gain);
    } else {
      const src = ctx.createBufferSource();
      src.buffer = this.buffer(kind === "brown" ? "brown" : kind === "pink" ? "pink" : "white");
      src.loop = true;
      if (kind === "rain") {
        // Rain-like: band-limited noise with a slow, uneven swell.
        const hp = ctx.createBiquadFilter();
        hp.type = "highpass";
        hp.frequency.value = 500;
        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = 5200;
        const swell = ctx.createGain();
        swell.gain.value = 0.55;
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 0.13;
        const depth = ctx.createGain();
        depth.gain.value = 0.18;
        lfo.connect(depth).connect(swell.gain);
        lfo.start();
        stops.push(() => lfo.stop());
        src.connect(hp).connect(lp).connect(swell).connect(gain);
      } else src.connect(gain);
      src.start();
      stops.push(() => src.stop());
    }
    gain.gain.setTargetAtTime(1, ctx.currentTime, Math.max(0.05, fadeSeconds / 3));
    this.playing = { kind, gain, stop: () => stops.forEach((s) => s()) };
  }

  /** Fades out and stops whatever plays. */
  stop(fadeSeconds: number): void {
    const p = this.playing;
    if (!p || !this.ctx) return;
    this.playing = null;
    const t = Math.max(0.05, fadeSeconds);
    p.gain.gain.cancelScheduledValues(this.ctx.currentTime);
    p.gain.gain.setTargetAtTime(0, this.ctx.currentTime, t / 3);
    setTimeout(() => {
      try {
        p.stop();
        p.gain.disconnect();
      } catch {
        /* already stopped */
      }
    }, t * 1000 + 200);
  }

  /** A soft two-note chime (a break starting). */
  chime(): void {
    const ctx = this.audio();
    void this.unlock();
    const now = ctx.currentTime;
    [660, 880].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = f;
      g.gain.setValueAtTime(0, now + i * 0.35);
      g.gain.linearRampToValueAtTime(0.35, now + i * 0.35 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.35 + 1.6);
      o.connect(g).connect(this.master!);
      o.start(now + i * 0.35);
      o.stop(now + i * 0.35 + 1.7);
    });
  }
}

/** The window's one engine. */
export const sound = new SoundEngine();
