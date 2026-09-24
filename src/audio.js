// All sound is synthesised with WebAudio at runtime (no audio files).
// Music is an original loop scheduled against the audio clock, so its tempo is
// independent of the display frame rate.

const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12); // MIDI note -> Hz

export class AudioSys {
  constructor() {
    this.ctx = null;
    this.musicOn = true;
    this.sfxOn = true;
    this.musicPlaying = false;
    this.loops = {};
    this.coinStreak = 0;
    this.lastCoin = 0;
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const ctx = this.ctx;
      this.comp = ctx.createDynamicsCompressor();
      this.comp.threshold.value = -14;
      this.comp.ratio.value = 4;
      this.master = ctx.createGain();
      this.master.gain.value = 0.9;
      this.comp.connect(this.master).connect(ctx.destination);
      this.sfxBus = ctx.createGain();
      this.sfxBus.gain.value = this.sfxOn ? 0.8 : 0;
      this.sfxBus.connect(this.comp);
      this.musicBus = ctx.createGain();
      this.musicBus.gain.value = this.musicOn ? 0.32 : 0;
      this.musicBus.connect(this.comp);
      this.noiseBuf = this.makeNoise();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  makeNoise() {
    const len = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  setMusic(on) {
    this.musicOn = on;
    if (this.ctx) this.musicBus.gain.setTargetAtTime(on ? 0.32 : 0, this.ctx.currentTime, 0.05);
  }

  setSfx(on) {
    this.sfxOn = on;
    if (this.ctx) this.sfxBus.gain.setTargetAtTime(on ? 0.8 : 0, this.ctx.currentTime, 0.05);
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend();
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  // ---------- primitives ----------
  tone({ type = 'sine', f0, f1 = f0, dur = 0.15, vol = 0.3, attack = 0.005, when = 0, dest, curve = 'exp' }) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) {
      if (curve === 'exp') osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
      else osc.frequency.linearRampToValueAtTime(f1, t + dur);
    }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(dest || this.sfxBus);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  noise({ dur = 0.2, vol = 0.3, type = 'bandpass', f0 = 1000, f1 = f0, q = 1, when = 0, dest, attack = 0.004 }) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filt = ctx.createBiquadFilter();
    filt.type = type;
    filt.Q.value = q;
    filt.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) filt.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filt).connect(g).connect(dest || this.sfxBus);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  // ---------- sound effects ----------
  coin() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.coinStreak = now - this.lastCoin < 0.35 ? Math.min(this.coinStreak + 1, 7) : 0;
    this.lastCoin = now;
    const base = 84 + [0, 2, 4, 5, 7, 9, 11, 12][this.coinStreak];
    this.tone({ type: 'square', f0: NOTE(base), dur: 0.06, vol: 0.08 });
    this.tone({ type: 'square', f0: NOTE(base + 5), dur: 0.14, vol: 0.08, when: 0.055 });
  }

  jump() {
    this.tone({ type: 'square', f0: 260, f1: 620, dur: 0.16, vol: 0.09 });
    this.noise({ type: 'highpass', f0: 2500, dur: 0.12, vol: 0.05 });
  }

  bigJump() {
    this.tone({ type: 'square', f0: 200, f1: 900, dur: 0.3, vol: 0.1 });
    this.tone({ type: 'triangle', f0: 400, f1: 1600, dur: 0.3, vol: 0.08 });
  }

  roll() {
    this.noise({ type: 'bandpass', f0: 2400, f1: 300, q: 2, dur: 0.3, vol: 0.16 });
  }

  swipe() {
    this.noise({ type: 'bandpass', f0: 900, f1: 2600, q: 1.5, dur: 0.1, vol: 0.07 });
  }

  land() {
    this.tone({ type: 'sine', f0: 140, f1: 60, dur: 0.09, vol: 0.18 });
  }

  bump() {
    this.tone({ type: 'sine', f0: 180, f1: 70, dur: 0.12, vol: 0.25 });
    this.noise({ type: 'lowpass', f0: 800, dur: 0.1, vol: 0.12 });
  }

  stumble() {
    this.bump();
    this.tone({ type: 'triangle', f0: 520, f1: 300, dur: 0.2, vol: 0.08, when: 0.05 });
  }

  crash() {
    this.noise({ type: 'lowpass', f0: 2200, f1: 200, dur: 0.6, vol: 0.45 });
    this.tone({ type: 'sine', f0: 110, f1: 35, dur: 0.5, vol: 0.5 });
    this.tone({ type: 'square', f0: 300, f1: 90, dur: 0.35, vol: 0.06, when: 0.05 });
  }

  powerup() {
    [72, 76, 79, 84, 88].forEach((n, i) => this.tone({ type: 'square', f0: NOTE(n), dur: 0.12, vol: 0.07, when: i * 0.055 }));
  }

  board() {
    this.tone({ type: 'sawtooth', f0: 180, f1: 900, dur: 0.35, vol: 0.07 });
    this.tone({ type: 'triangle', f0: NOTE(88), dur: 0.25, vol: 0.06, when: 0.2 });
  }

  boardBreak() {
    this.noise({ type: 'bandpass', f0: 3000, f1: 400, q: 0.8, dur: 0.45, vol: 0.35 });
    this.tone({ type: 'square', f0: 700, f1: 120, dur: 0.4, vol: 0.08 });
  }

  whistle() {
    for (let i = 0; i < 2; i++) {
      const when = i * 0.28;
      this.tone({ type: 'sine', f0: 2350, f1: 2450, dur: 0.22, vol: 0.12, when, curve: 'lin' });
      this.tone({ type: 'sine', f0: 2600, f1: 2700, dur: 0.22, vol: 0.05, when, curve: 'lin' });
    }
  }

  click() {
    this.tone({ type: 'triangle', f0: 900, f1: 1200, dur: 0.05, vol: 0.08 });
  }

  buy() {
    [79, 84, 91].forEach((n, i) => this.tone({ type: 'triangle', f0: NOTE(n), dur: 0.14, vol: 0.1, when: i * 0.07 }));
  }

  countdown(final) {
    this.tone({ type: 'square', f0: final ? NOTE(84) : NOTE(72), dur: final ? 0.3 : 0.12, vol: 0.08 });
  }

  // continuous jetpack rumble
  startJet() {
    if (!this.ctx || this.loops.jet) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 700;
    const g = ctx.createGain();
    g.gain.value = 0.0001;
    g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.2);
    src.connect(filt).connect(g).connect(this.sfxBus);
    src.start();
    this.loops.jet = { src, g };
  }

  stopJet() {
    const l = this.loops.jet;
    if (!l || !this.ctx) return;
    const t = this.ctx.currentTime;
    l.g.gain.cancelScheduledValues(t);
    l.g.gain.setValueAtTime(Math.max(l.g.gain.value, 0.0001), t);
    l.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    l.src.stop(t + 0.3);
    this.loops.jet = null;
  }

  // ---------- music ----------
  // An original four-bar loop in A minor (i - VI - III - VII) at 124 BPM.
  startMusic() {
    if (!this.ctx || this.musicPlaying) return;
    this.musicPlaying = true;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.08;
    this.timer = setInterval(() => this.schedule(), 25);
  }

  stopMusic() {
    this.musicPlaying = false;
    clearInterval(this.timer);
  }

  schedule() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const spb = 60 / 124 / 4; // seconds per 16th
    while (this.nextTime < this.ctx.currentTime + 0.12) {
      this.playStep(this.step, this.nextTime - this.ctx.currentTime);
      this.nextTime += spb;
      this.step = (this.step + 1) % 64;
    }
  }

  playStep(step, when) {
    const bus = this.musicBus;
    const bar = Math.floor(step / 16);
    const s = step % 16;
    // chords: Am, F, C, G  (root MIDI notes for bass)
    const roots = [45, 41, 48, 43];
    const chords = [[57, 60, 64], [53, 57, 60], [55, 60, 64], [55, 59, 62]];
    const root = roots[bar];
    const chord = chords[bar];

    // drums
    if (s === 0 || s === 8 || (s === 10 && bar % 2 === 1)) {
      this.tone({ type: 'sine', f0: 150, f1: 42, dur: 0.16, vol: 0.9, when, dest: bus });
    }
    if (s === 4 || s === 12) {
      this.noise({ type: 'bandpass', f0: 1900, q: 0.7, dur: 0.13, vol: 0.45, when, dest: bus });
      this.tone({ type: 'triangle', f0: 190, f1: 140, dur: 0.07, vol: 0.25, when, dest: bus });
    }
    if (s % 2 === 0) {
      this.noise({ type: 'highpass', f0: 7500, dur: s % 4 === 2 ? 0.09 : 0.03, vol: s % 4 === 2 ? 0.16 : 0.1, when, dest: bus });
    }

    // bass: octave-bouncing eighths
    if (s % 2 === 0) {
      const n = s % 4 === 2 ? root + 12 : root;
      this.tone({ type: 'sawtooth', f0: NOTE(n), dur: 0.11, vol: 0.2, when, dest: bus });
      this.tone({ type: 'sine', f0: NOTE(n - 12), dur: 0.12, vol: 0.25, when, dest: bus });
    }

    // lead: a short rising motif, different on the last bar for a turnaround
    const motif = bar === 3
      ? { 0: 2, 3: 1, 6: 0, 8: 1, 10: 2, 12: 3, 14: 4 }
      : { 0: 0, 3: 1, 6: 2, 8: 3, 11: 2, 14: 1 };
    if (s in motif) {
      const idx = motif[s];
      const n = chord[idx % 3] + 12 * (1 + Math.floor(idx / 3));
      this.tone({ type: 'square', f0: NOTE(n), dur: 0.14, vol: 0.05, when, dest: bus });
      this.tone({ type: 'triangle', f0: NOTE(n + 12), dur: 0.1, vol: 0.03, when, dest: bus });
    }
    // soft pad on each bar
    if (s === 0) {
      for (const n of chord) this.tone({ type: 'triangle', f0: NOTE(n), dur: 1.8, vol: 0.035, attack: 0.3, when, dest: bus });
    }
  }
}
