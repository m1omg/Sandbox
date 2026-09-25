// Sound effects are synthesised with WebAudio at runtime. Music is generated
// procedurally and scheduled against the audio clock, so its tempo is independent of
// the display frame rate: the city look uses synthesised instruments (music.js), the
// classic look plays real recorded instruments (music_street.js, samples.js).

import { Composer } from './music.js';
import { StreetComposer } from './music_street.js';
import { CLASSIC } from './theme.js';

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
    this.sampleData = null; // raw bytes, decoded once audio is unlocked
    this.samples = null;
    this.decoding = null;
  }

  setSampleData(data) {
    this.sampleData = data;
    if (this.ctx && !this.decoding) this.decoding = this.decodeSamples();
  }

  async decodeSamples() {
    const ctx = this.ctx;
    const decode = (buf) => new Promise((resolve, reject) => ctx.decodeAudioData(buf.slice(0), resolve, reject));
    const out = {};
    await Promise.all(Object.entries(this.sampleData).map(async ([name, entry]) => {
      if (entry instanceof ArrayBuffer) {
        out[name] = { buffer: await decode(entry) };
      } else {
        const notes = await Promise.all(Object.entries(entry).map(async ([n, buf]) => [+n, await decode(buf)]));
        out[name] = { notes: notes.sort((x, y) => x[0] - y[0]) };
      }
    }));
    this.samples = out;
    // if the synth fallback started first, hand over to the sampled band
    if (CLASSIC && this.musicPlaying && !(this.composer instanceof StreetComposer)) {
      this.stopMusic();
      this.startMusic();
    }
    return out;
  }

  // Play a recorded sample. Pitched instruments use the nearest sampled note, re-pitched
  // to `note`; `dur` cuts the note short with a quick release.
  sample(name, { note = null, when = 0, vol = 0.5, dur = null, dest } = {}) {
    const s = this.samples && this.samples[name];
    if (!s || !this.ctx) return false;
    const ctx = this.ctx;
    let buffer = s.buffer;
    let rate = 1;
    if (s.notes) {
      // fold the note into the sampled range by octaves so no sample is stretched far
      const lo = s.notes[0][0] - 3;
      const hi = s.notes[s.notes.length - 1][0] + 3;
      while (note > hi) note -= 12;
      while (note < lo) note += 12;
      let best = s.notes[0];
      for (const entry of s.notes) if (Math.abs(entry[0] - note) < Math.abs(best[0] - note)) best = entry;
      buffer = best[1];
      rate = Math.pow(2, (note - best[0]) / 12);
    }
    const t = ctx.currentTime + Math.max(0, when);
    const length = buffer.duration / rate;
    const end = dur ? Math.min(dur, length) : length;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    if (end < length) {
      g.gain.setValueAtTime(vol, t + Math.max(0, end - 0.06));
      g.gain.linearRampToValueAtTime(0.0001, t + end);
    }
    src.connect(g).connect(dest || this.sfxBus);
    src.start(t);
    src.stop(t + end + 0.02);
    return true;
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
      if (this.sampleData && !this.decoding) this.decoding = this.decodeSamples();
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
  // `hold` keeps the note at full volume for most of its length (pads, held bass notes)
  // instead of decaying straight away like a pluck.
  tone({ type = 'sine', f0, f1 = f0, dur = 0.15, vol = 0.3, attack = 0.005, when = 0, dest, curve = 'exp', hold = false }) {
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
    if (hold) g.gain.setValueAtTime(vol, t + Math.max(attack, dur * 0.8));
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
  // The procedural composers write an endless, ever-changing song.
  startMusic() {
    if (!this.ctx || this.musicPlaying) return;
    this.musicPlaying = true;
    const begin = () => {
      if (!this.musicPlaying || this.timer) return;
      this.composer = CLASSIC && this.samples ? new StreetComposer(this) : new Composer(this, 60 / 124 / 4);
      this.spb = this.composer.spb;
      this.nextTime = this.ctx.currentTime + 0.08;
      this.timer = setInterval(() => this.schedule(), 25);
    };
    // the classic look waits for its instrument samples (they decode in well under a second)
    if (CLASSIC && this.decoding && !this.samples) this.decoding.then(begin, begin);
    else begin();
  }

  stopMusic() {
    this.musicPlaying = false;
    clearInterval(this.timer);
    this.timer = null;
    if (this.composer && this.composer.bus) this.composer.bus.disconnect();
  }

  schedule() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    // Background tabs throttle timers; skip the steps we missed instead of playing them all at once.
    while (this.nextTime < now - 0.05) {
      this.composer.advance();
      this.nextTime += this.spb;
    }
    while (this.nextTime < now + 0.12) {
      this.composer.step(this.nextTime - now);
      this.nextTime += this.spb;
    }
  }
}
