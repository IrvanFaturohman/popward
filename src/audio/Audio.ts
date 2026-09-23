import { AUDIO } from '../balance';

type Wave = OscillatorType;

interface ToneOpts {
  type?: Wave;
  f0: number;
  f1?: number;
  dur: number;
  gain: number;
  attack?: number;
  when?: number;
  lowpass?: number;
}

interface NoiseOpts {
  dur: number;
  gain: number;
  freq: number;
  q?: number;
  filter?: BiquadFilterType;
  when?: number;
  attack?: number;
  sweepTo?: number;
}

/**
 * Every sound is synthesised on the fly with the Web Audio API — no audio files.
 * The context is created lazily on the first user gesture (browser autoplay policy),
 * and a limiter plus per-sound cooldowns keep bursts of pops from turning into noise.
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private last = new Map<string, number>();
  private popTimes: number[] = [];
  private _muted: boolean;
  private _volume: number;

  constructor(muted: boolean, volume: number) {
    this._muted = muted;
    this._volume = volume;
  }

  get muted(): boolean {
    return this._muted;
  }

  get volume(): number {
    return this._volume;
  }

  get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** Must be called from a user gesture handler. Safe to call repeatedly. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 10;
      comp.ratio.value = 6;
      comp.attack.value = 0.003;
      comp.release.value = 0.15;
      this.master = this.ctx.createGain();
      this.master.gain.value = this.targetGain();
      this.master.connect(comp);
      comp.connect(this.ctx.destination);
      const len = Math.floor(this.ctx.sampleRate * 0.5);
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setMuted(muted: boolean): void {
    this._muted = muted;
    this.applyGain();
  }

  setVolume(volume: number): void {
    this._volume = Math.max(0, Math.min(1, volume));
    this.applyGain();
  }

  private targetGain(): number {
    return this._muted ? 0 : this._volume * 0.8;
  }

  private applyGain(): void {
    if (!this.ctx || !this.master) return;
    this.master.gain.setTargetAtTime(this.targetGain(), this.ctx.currentTime, 0.03);
  }

  private can(key: string, cooldown: number): boolean {
    if (!this.ctx || this._muted || this.ctx.state !== 'running') return false;
    const now = this.ctx.currentTime;
    const prev = this.last.get(key) ?? -1;
    if (now - prev < cooldown) return false;
    this.last.set(key, now);
    return true;
  }

  private tone(o: ToneOpts): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + (o.when ?? 0);
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.f0, t);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t + o.dur);
    const g = ctx.createGain();
    const attack = o.attack ?? 0.005;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    let node: AudioNode = osc;
    if (o.lowpass) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = o.lowpass;
      osc.connect(f);
      node = f;
    }
    node.connect(g);
    g.connect(this.master!);
    osc.start(t);
    osc.stop(t + o.dur + 0.02);
  }

  private noise(o: NoiseOpts): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + (o.when ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = o.filter ?? 'bandpass';
    f.frequency.setValueAtTime(o.freq, t);
    if (o.sweepTo) f.frequency.exponentialRampToValueAtTime(o.sweepTo, t + o.dur);
    f.Q.value = o.q ?? 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.gain, t + (o.attack ?? 0.003));
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.master!);
    src.start(t, Math.random() * 0.3);
    src.stop(t + o.dur + 0.02);
  }

  // ------------------------------------------------------------------ sounds

  /** Pitch climbs a little with the chain so rapid pops feel rhythmic; capped so it never gets shrill. */
  pop(teal: boolean, chain: number): void {
    if (!this.ctx || this._muted || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    this.popTimes = this.popTimes.filter((t) => now - t < AUDIO.popWindowSec);
    if (this.popTimes.length >= AUDIO.maxPopsPerWindow) return;
    this.popTimes.push(now);
    const step = Math.min(chain - 1, 9);
    const pitch = Math.pow(2, (step * 1.5) / 12) * (0.94 + Math.random() * 0.12);
    this.noise({ dur: 0.07, gain: 0.5, freq: 2200 * pitch, q: 0.9 });
    this.tone({ type: 'sine', f0: 700 * pitch, f1: 260 * pitch, dur: 0.09, gain: 0.3 });
    if (teal) {
      this.tone({ type: 'triangle', f0: 1318 * pitch, dur: 0.22, gain: 0.12, when: 0.02 });
      this.tone({ type: 'triangle', f0: 1976 * pitch, dur: 0.18, gain: 0.07, when: 0.06 });
    }
  }

  spawn(): void {
    if (!this.can('spawn', 0.05)) return;
    const p = 0.95 + Math.random() * 0.1;
    this.noise({ dur: 0.14, gain: 0.12, freq: 500 * p, sweepTo: 1400 * p, q: 0.7, attack: 0.03 });
    this.tone({ type: 'sine', f0: 190 * p, f1: 420 * p, dur: 0.13, gain: 0.14, attack: 0.02 });
  }

  fail(): void {
    if (!this.can('fail', 0.2)) return;
    this.tone({ type: 'triangle', f0: 240, f1: 170, dur: 0.12, gain: 0.12, lowpass: 900 });
  }

  evolveStart(): void {
    if (!this.can('evoStart', 0.2)) return;
    this.tone({ type: 'sine', f0: 520, f1: 1040, dur: 0.28, gain: 0.07, attack: 0.05 });
  }

  evolve(): void {
    if (!this.can('evolve', 0.15)) return;
    [784, 988, 1319].forEach((f, i) => this.tone({ type: 'triangle', f0: f, dur: 0.26, gain: 0.13, when: i * 0.055 }));
  }

  push(): void {
    if (!this.can('push', 0.25)) return;
    this.tone({ type: 'square', f0: 95, f1: 62, dur: 0.1, gain: 0.05, lowpass: 420 });
    this.noise({ dur: 0.05, gain: 0.05, freq: 900, q: 2 });
  }

  impact(strength: number): void {
    if (!this.can('impact', 0.2)) return;
    const g = Math.min(0.16, 0.06 + strength / 3000);
    this.tone({ type: 'sine', f0: 130, f1: 70, dur: 0.12, gain: g });
  }

  bump(strength: number): void {
    if (strength < AUDIO.bumpThreshold || !this.can('bump', AUDIO.bumpCooldownSec)) return;
    const g = Math.min(0.06, 0.015 + strength / 12000);
    this.tone({ type: 'sine', f0: 330 + Math.random() * 120, f1: 220, dur: 0.05, gain: g });
  }

  purchase(): void {
    if (!this.can('purchase', 0.05)) return;
    this.tone({ type: 'square', f0: 880, dur: 0.09, gain: 0.07, lowpass: 3000 });
    this.tone({ type: 'square', f0: 1318, dur: 0.16, gain: 0.07, lowpass: 3000, when: 0.07 });
    this.noise({ dur: 0.12, gain: 0.05, freq: 6000, q: 1.5, when: 0.07 });
  }

  denied(): void {
    if (!this.can('denied', 0.2)) return;
    this.tone({ type: 'triangle', f0: 300, dur: 0.07, gain: 0.08, lowpass: 1200 });
    this.tone({ type: 'triangle', f0: 250, dur: 0.1, gain: 0.08, lowpass: 1200, when: 0.08 });
  }

  rescue(): void {
    if (!this.can('rescue', 0.3)) return;
    this.noise({ dur: 0.18, gain: 0.06, freq: 700, sweepTo: 300, q: 0.6, attack: 0.02 });
  }

  stageClear(): void {
    if (!this.can('stage', 1)) return;
    [523, 659, 784, 1047].forEach((f, i) => this.tone({ type: 'triangle', f0: f, dur: 0.32, gain: 0.16, when: i * 0.09 }));
    [523, 659, 784].forEach((f) => this.tone({ type: 'sine', f0: f * 2, dur: 0.7, gain: 0.06, when: 0.4, attack: 0.03 }));
  }

  click(): void {
    if (!this.can('click', 0.04)) return;
    this.tone({ type: 'sine', f0: 900, f1: 700, dur: 0.035, gain: 0.05 });
  }
}
