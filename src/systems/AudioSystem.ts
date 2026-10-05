/**
 * Fully procedural Web Audio synthesis for Nailong Bounce.
 *
 * Intentionally defensive: in headless or restricted browsers the AudioContext
 * may be missing or permanently suspended, so every public method degrades to a
 * silent no-op rather than throwing.
 */

const EPS = 0.0001;
const MAX_VOICES = 24;
const MASTER_LEVEL = 0.25;
const CHORD_DURATION = 5.5;

// Warm, gently jazzy progression (MIDI note numbers).
const CHORDS: readonly (readonly number[])[] = [
  [53, 57, 60, 64], // Fmaj7
  [50, 53, 57, 60], // Dm7
  [46, 50, 53, 57], // Bbmaj7
  [48, 52, 55, 59], // Cmaj7
];

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function getAudioContextConstructor(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null;
  const scoped = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  return scoped.AudioContext ?? scoped.webkitAudioContext ?? null;
}

interface ChargeVoice {
  osc: OscillatorNode;
  filter: BiquadFilterNode;
  gain: GainNode;
}

export class AudioSystem {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private unlocked = false;
  private muted = false;
  private disposed = false;
  private unlockPromise: Promise<void> | null = null;
  private voices = new Set<AudioScheduledSourceNode>();

  private chargeVoice: ChargeVoice | null = null;

  private padOscillators: OscillatorNode[] = [];
  private padFilter: BiquadFilterNode | null = null;
  private padGain: GainNode | null = null;
  private lfo: OscillatorNode | null = null;
  private chordIndex = 0;
  private nextChordTime = 0;
  private nextArpTime = 0;
  private intensity = 0;

  private onGesture: (() => void) | null = null;

  constructor() {
    if (typeof window === 'undefined') return;
    const handler = (): void => {
      void this.unlock();
      this.removeGestureListeners();
    };
    this.onGesture = handler;
    window.addEventListener('pointerdown', handler);
    window.addEventListener('keydown', handler);
  }

  /** Called on first user gesture. Safe to call repeatedly. */
  unlock(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    const ctx = this.context;
    if (ctx && ctx.state === 'running') {
      this.unlocked = true;
      return Promise.resolve();
    }
    if (!this.unlockPromise) {
      this.unlockPromise = this.startContext().finally(() => {
        this.unlockPromise = null;
      });
    }
    return this.unlockPromise;
  }

  isUnlocked(): boolean {
    return this.unlocked && this.context !== null && this.context.state === 'running';
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyMasterGain(0.04);
  }

  isMuted(): boolean {
    return this.muted;
  }

  /** Continuous charge feedback; reuses one voice instead of spawning nodes. */
  setCharge(ratio: number, active: boolean): void {
    const ctx = this.context;
    if (!ctx || !this.unlocked || this.disposed) return;
    try {
      const voice = this.ensureChargeVoice(ctx);
      if (!voice) return;
      const t = ctx.currentTime;
      const target = clamp01(ratio);
      if (active) {
        voice.osc.frequency.setTargetAtTime(170 + target * 540, t, 0.03);
        voice.filter.frequency.setTargetAtTime(500 + target * 2600, t, 0.05);
        voice.gain.gain.setTargetAtTime(0.05, t, 0.05);
      } else {
        voice.gain.gain.setTargetAtTime(EPS, t, 0.06);
      }
    } catch {
      // ignore
    }
  }

  launch(power: number): void {
    const ctx = this.playable();
    const master = this.master;
    if (!ctx || !master || !this.canSpawn()) return;
    try {
      const p = clamp01(power);
      const t = ctx.currentTime;
      const dur = 0.22 + p * 0.2;

      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      const f0 = 150 + p * 120 + rand(-8, 8);
      osc.frequency.setValueAtTime(f0, t);
      osc.frequency.exponentialRampToValueAtTime(f0 * (2.4 + p * 1.8), t + dur);

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(700 + p * 1400, t);
      filter.Q.value = 1;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(EPS, t);
      gain.gain.exponentialRampToValueAtTime(0.14 + p * 0.12, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(EPS, t + dur);

      osc.connect(filter).connect(gain).connect(master);
      osc.start(t);
      osc.stop(t + dur + 0.03);
      this.finish(osc, [filter, gain]);

      this.noiseBurst(t, 0.16 + p * 0.16, 0.045 + p * 0.05, 'bandpass', 600 + p * 1200, 0.8);
    } catch {
      // ignore
    }
  }

  land(impact: number): void {
    const ctx = this.playable();
    const master = this.master;
    if (!ctx || !master || !this.canSpawn()) return;
    try {
      const i = clamp01(impact);
      const t = ctx.currentTime;
      const dur = 0.26 + i * 0.14;

      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(170 + i * 40, t);
      osc.frequency.exponentialRampToValueAtTime(55, t + dur);

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 480;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(EPS, t);
      gain.gain.exponentialRampToValueAtTime(0.15 + i * 0.13, t + 0.008);
      gain.gain.exponentialRampToValueAtTime(EPS, t + dur);

      osc.connect(filter).connect(gain).connect(master);
      osc.start(t);
      osc.stop(t + dur + 0.03);
      this.finish(osc, [filter, gain]);

      this.noiseBurst(t, 0.16, 0.05 + i * 0.08, 'lowpass', 340, 0.7);
    } catch {
      // ignore
    }
  }

  bounce(strength: number): void {
    const ctx = this.playable();
    const master = this.master;
    if (!ctx || !master || !this.canSpawn()) return;
    try {
      const s = clamp01(strength);
      const t = ctx.currentTime;
      const dur = 0.24 + s * 0.12;

      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      const f0 = 190 + s * 150 + rand(-6, 6);
      osc.frequency.setValueAtTime(f0, t);
      osc.frequency.exponentialRampToValueAtTime(f0 * (2.0 + s * 0.9), t + dur * 0.55);

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(900 + s * 1400, t);
      filter.Q.value = 1.4;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(EPS, t);
      gain.gain.exponentialRampToValueAtTime(0.12 + s * 0.1, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(EPS, t + dur);

      osc.connect(filter).connect(gain).connect(master);
      osc.start(t);
      osc.stop(t + dur + 0.03);
      this.finish(osc, [filter, gain]);
    } catch {
      // ignore
    }
  }

  collect(index: number): void {
    const ctx = this.playable();
    const master = this.master;
    if (!ctx || !master || !this.canSpawn()) return;
    try {
      const step = Math.min(24, Math.max(0, Math.floor(index)));
      const midi = 72 + step;
      const t = ctx.currentTime;
      const dur = 0.26;
      const base = midiToFreq(midi) * rand(0.998, 1.004);

      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(base, t);
      osc.frequency.exponentialRampToValueAtTime(base * 1.02, t + 0.1);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(EPS, t);
      gain.gain.exponentialRampToValueAtTime(0.12, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(EPS, t + dur);

      osc.connect(gain).connect(master);
      osc.start(t);
      osc.stop(t + dur + 0.03);
      this.finish(osc, [gain]);

      const shimmer = ctx.createOscillator();
      shimmer.type = 'sine';
      shimmer.frequency.value = base * 2;
      const shimmerGain = ctx.createGain();
      shimmerGain.gain.setValueAtTime(EPS, t);
      shimmerGain.gain.exponentialRampToValueAtTime(0.045, t + 0.01);
      shimmerGain.gain.exponentialRampToValueAtTime(EPS, t + dur * 0.7);
      shimmer.connect(shimmerGain).connect(master);
      shimmer.start(t);
      shimmer.stop(t + dur * 0.75);
      this.finish(shimmer, [shimmerGain]);
    } catch {
      // ignore
    }
  }

  hurt(): void {
    const ctx = this.playable();
    const master = this.master;
    if (!ctx || !master || !this.canSpawn()) return;
    try {
      const t = ctx.currentTime;
      const dur = 0.42;

      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(260, t);
      osc.frequency.exponentialRampToValueAtTime(80, t + dur);

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1300, t);
      filter.frequency.exponentialRampToValueAtTime(300, t + dur);
      filter.Q.value = 1;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(EPS, t);
      gain.gain.exponentialRampToValueAtTime(0.1, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(EPS, t + dur);

      osc.connect(filter).connect(gain).connect(master);
      osc.start(t);
      osc.stop(t + dur + 0.03);
      this.finish(osc, [filter, gain]);

      this.noiseBurst(t, 0.22, 0.05, 'lowpass', 700, 0.9);
    } catch {
      // ignore
    }
  }

  win(): void {
    const ctx = this.playable();
    const master = this.master;
    if (!ctx || !master) return;
    try {
      const notes = [67, 72, 76, 79, 84];
      const t = ctx.currentTime;
      for (let i = 0; i < notes.length; i++) {
        if (!this.canSpawn()) break;
        const start = t + i * 0.11;
        const dur = 0.42;
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = midiToFreq(notes[i]) * rand(0.997, 1.004);

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(EPS, start);
        gain.gain.exponentialRampToValueAtTime(0.1, start + 0.015);
        gain.gain.exponentialRampToValueAtTime(EPS, start + dur);
        osc.connect(gain).connect(master);
        osc.start(start);
        osc.stop(start + dur + 0.03);
        this.finish(osc, [gain]);
      }
      this.noiseBurst(t, 0.5, 0.03, 'highpass', 1800, 0.7);
    } catch {
      // ignore
    }
  }

  levelStart(): void {
    const ctx = this.playable();
    const master = this.master;
    if (!ctx || !master) return;
    try {
      const notes = [62, 69];
      const t = ctx.currentTime;
      for (let i = 0; i < notes.length; i++) {
        if (!this.canSpawn()) break;
        const start = t + i * 0.13;
        const dur = 0.55;
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = midiToFreq(notes[i]) * rand(0.998, 1.003);

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(EPS, start);
        gain.gain.exponentialRampToValueAtTime(0.1, start + 0.04);
        gain.gain.exponentialRampToValueAtTime(EPS, start + dur);
        osc.connect(gain).connect(master);
        osc.start(start);
        osc.stop(start + dur + 0.03);
        this.finish(osc, [gain]);
      }
    } catch {
      // ignore
    }
  }

  ui(): void {
    const ctx = this.playable();
    const master = this.master;
    if (!ctx || !master || !this.canSpawn()) return;
    try {
      const t = ctx.currentTime;
      const dur = 0.09;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      const f0 = 720 * rand(0.97, 1.03);
      osc.frequency.setValueAtTime(f0, t);
      osc.frequency.exponentialRampToValueAtTime(f0 * 1.18, t + dur);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(EPS, t);
      gain.gain.exponentialRampToValueAtTime(0.07, t + 0.008);
      gain.gain.exponentialRampToValueAtTime(EPS, t + dur);

      osc.connect(gain).connect(master);
      osc.start(t);
      osc.stop(t + dur + 0.02);
      this.finish(osc, [gain]);
    } catch {
      // ignore
    }
  }

  /** Ambient music bed. Call every frame; intensity 0..1 ramps with danger. */
  update(delta: number, intensity: number): void {
    const ctx = this.context;
    if (!ctx || !this.unlocked || this.disposed) return;
    try {
      const dt = Math.min(delta > 0 ? delta : 0, 0.1);
      const target = clamp01(intensity);
      this.intensity += (target - this.intensity) * Math.min(1, dt * 2);
      const t = ctx.currentTime;

      if (this.padGain) {
        this.padGain.gain.setTargetAtTime(0.05 + this.intensity * 0.035, t, 0.6);
      }
      if (this.padFilter) {
        this.padFilter.frequency.setTargetAtTime(420 + this.intensity * 900, t, 0.6);
      }

      if (t >= this.nextChordTime) {
        this.chordIndex = (this.chordIndex + 1) % CHORDS.length;
        this.applyChord(0.9);
        this.nextChordTime = t + CHORD_DURATION;
      }

      if (t >= this.nextArpTime) {
        this.playArpNote(this.intensity);
        const interval = (0.95 - this.intensity * 0.45) * rand(0.85, 1.2);
        this.nextArpTime = t + interval;
      }
    } catch {
      // ignore
    }
  }

  dispose(): void {
    this.disposed = true;
    this.unlocked = false;
    this.removeGestureListeners();

    for (const source of this.voices) {
      try {
        source.stop();
      } catch {
        // ignore
      }
      this.safeDisconnect(source);
    }
    this.voices.clear();

    if (this.chargeVoice) {
      try {
        this.chargeVoice.osc.stop();
      } catch {
        // ignore
      }
      this.chargeVoice = null;
    }

    for (const osc of this.padOscillators) {
      try {
        osc.stop();
      } catch {
        // ignore
      }
    }
    this.padOscillators = [];

    if (this.lfo) {
      try {
        this.lfo.stop();
      } catch {
        // ignore
      }
      this.lfo = null;
    }

    this.padFilter = null;
    this.padGain = null;
    this.master = null;
    this.noiseBuffer = null;

    const ctx = this.context;
    this.context = null;
    if (ctx) {
      try {
        void ctx.close();
      } catch {
        // ignore
      }
    }
  }

  private async startContext(): Promise<void> {
    try {
      const Ctor = getAudioContextConstructor();
      if (!Ctor) return;
      let ctx = this.context;
      if (!ctx || ctx.state === 'closed') {
        ctx = new Ctor();
        this.context = ctx;
        this.buildGraph(ctx);
      }
      if (ctx.state !== 'running') {
        await ctx.resume();
      }
      this.unlocked = ctx.state === 'running';
      if (this.unlocked) this.applyMasterGain(0.06);
    } catch {
      this.unlocked = false;
    }
  }

  private buildGraph(ctx: AudioContext): void {
    const master = ctx.createGain();
    master.gain.value = 0;

    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.004;
    limiter.release.value = 0.25;

    master.connect(limiter).connect(ctx.destination);
    this.master = master;
    this.noiseBuffer = this.createNoiseBuffer(ctx);
    this.buildAmbient(ctx);
  }

  private buildAmbient(ctx: AudioContext): void {
    const master = this.master;
    if (!master) return;

    const padFilter = ctx.createBiquadFilter();
    padFilter.type = 'lowpass';
    padFilter.frequency.value = 520;
    padFilter.Q.value = 0.4;

    const padGain = ctx.createGain();
    padGain.gain.value = 0;
    padFilter.connect(padGain).connect(master);

    const oscs: OscillatorNode[] = [];
    for (let i = 0; i < 4; i++) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.detune.value = (i - 1.5) * 6;
      osc.connect(padFilter);
      osc.start();
      oscs.push(osc);
    }

    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 140;
    lfo.connect(lfoGain).connect(padFilter.frequency);
    lfo.start();

    this.padFilter = padFilter;
    this.padGain = padGain;
    this.padOscillators = oscs;
    this.lfo = lfo;
    this.chordIndex = 0;
    this.applyChord(0.01);
    this.nextChordTime = ctx.currentTime + CHORD_DURATION;
    this.nextArpTime = ctx.currentTime + 1.2;
  }

  private applyChord(ramp: number): void {
    const ctx = this.context;
    if (!ctx || this.padOscillators.length === 0) return;
    const chord = CHORDS[this.chordIndex % CHORDS.length];
    const t = ctx.currentTime;
    for (let i = 0; i < this.padOscillators.length; i++) {
      const midi = chord[i % chord.length] - 12;
      const freq = midiToFreq(midi);
      this.padOscillators[i].frequency.setTargetAtTime(freq, t, ramp);
    }
  }

  private playArpNote(intensityValue: number): void {
    const ctx = this.context;
    const master = this.master;
    if (!ctx || !master || !this.canSpawn()) return;
    const chord = CHORDS[this.chordIndex % CHORDS.length];
    const midi = chord[Math.floor(Math.random() * chord.length)] + 12 * (Math.random() < 0.5 ? 1 : 2);
    const t = ctx.currentTime;
    const dur = rand(1.0, 1.6);

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = midiToFreq(midi) * rand(0.995, 1.005);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1400 + intensityValue * 1600;
    filter.Q.value = 0.5;

    const gain = ctx.createGain();
    const amp = 0.05 + intensityValue * 0.03;
    gain.gain.setValueAtTime(EPS, t);
    gain.gain.exponentialRampToValueAtTime(amp, t + 0.18);
    gain.gain.exponentialRampToValueAtTime(EPS, t + dur);

    osc.connect(filter).connect(gain).connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
    this.finish(osc, [filter, gain]);
  }

  private noiseBurst(
    t: number,
    dur: number,
    amp: number,
    type: BiquadFilterType,
    freq: number,
    q: number,
  ): void {
    const ctx = this.context;
    const master = this.master;
    if (!ctx || !master || !this.noiseBuffer || !this.canSpawn()) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    src.playbackRate.value = rand(0.85, 1.15);

    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(EPS, t);
    gain.gain.exponentialRampToValueAtTime(amp, t + 0.015);
    gain.gain.exponentialRampToValueAtTime(EPS, t + dur);

    src.connect(filter).connect(gain).connect(master);
    src.start(t);
    src.stop(t + dur + 0.03);
    this.finish(src, [filter, gain]);
  }

  private ensureChargeVoice(ctx: AudioContext): ChargeVoice | null {
    if (this.chargeVoice) return this.chargeVoice;
    const master = this.master;
    if (!master) return null;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 170;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 600;
    filter.Q.value = 0.7;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(filter).connect(gain).connect(master);
    osc.start();
    this.chargeVoice = { osc, filter, gain };
    return this.chargeVoice;
  }

  private createNoiseBuffer(ctx: AudioContext): AudioBuffer {
    const length = Math.max(1, Math.floor(ctx.sampleRate * 1.5));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      last = last * 0.5 + white * 0.5;
      data[i] = last;
    }
    return buffer;
  }

  private applyMasterGain(ramp: number): void {
    const ctx = this.context;
    const master = this.master;
    if (!ctx || !master) return;
    try {
      const t = ctx.currentTime;
      const target = this.muted ? 0 : MASTER_LEVEL;
      master.gain.cancelScheduledValues(t);
      master.gain.setTargetAtTime(target, t, ramp);
    } catch {
      // ignore
    }
  }

  private playable(): AudioContext | null {
    const ctx = this.context;
    if (!ctx || !this.unlocked || this.disposed) return null;
    if (ctx.state !== 'running') return null;
    return ctx;
  }

  private canSpawn(): boolean {
    return this.voices.size < MAX_VOICES;
  }

  private finish(source: AudioScheduledSourceNode, nodes: AudioNode[]): void {
    if (this.voices.size >= MAX_VOICES) {
      try {
        source.stop();
      } catch {
        // ignore
      }
      source.onended = () => {
        this.safeDisconnect(source);
        for (const node of nodes) this.safeDisconnect(node);
      };
      return;
    }
    this.voices.add(source);
    source.onended = () => {
      this.voices.delete(source);
      this.safeDisconnect(source);
      for (const node of nodes) this.safeDisconnect(node);
    };
  }

  private safeDisconnect(node: AudioNode): void {
    try {
      node.disconnect();
    } catch {
      // ignore
    }
  }

  private removeGestureListeners(): void {
    if (typeof window === 'undefined' || !this.onGesture) return;
    window.removeEventListener('pointerdown', this.onGesture);
    window.removeEventListener('keydown', this.onGesture);
    this.onGesture = null;
  }
}
