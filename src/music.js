// Procedural soundtrack. Instead of looping a fixed pattern, the composer writes an
// endless song as it plays: it walks between sections (intro, verse, chorus, bridge,
// breakdown), and every section picks its own chord progression, drum and bass
// patterns and a freshly generated melody. Choruses reuse a "hook" for a few rounds
// so the song still feels like a song, then write a new one. Drum fills, crashes,
// risers and the odd key change mark the transitions.
//
// Everything is scheduled on the WebAudio clock by AudioSys, so tempo never depends
// on the display frame rate. Visual-only randomness (Math.random) is fine here: the
// music never affects the simulation.

export const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);
const SCALE = [0, 2, 3, 5, 7, 8, 10]; // natural minor

// Chord progressions as scale degrees (0 = i, 2 = III, 3 = iv, 4 = v, 5 = VI, 6 = VII).
const PROGRESSIONS = [
  [0, 5, 2, 6], [0, 3, 6, 2], [5, 6, 0, 0], [0, 6, 5, 6], [3, 0, 4, 5],
  [2, 6, 0, 5], [0, 4, 5, 3], [5, 3, 0, 4], [0, 2, 3, 4], [5, 2, 6, 0],
];

const NEXT = {
  intro: [['verse', 1]],
  verse: [['chorus', 0.6], ['bridge', 0.4]],
  chorus: [['verse', 0.45], ['breakdown', 0.3], ['bridge', 0.25]],
  bridge: [['chorus', 0.6], ['breakdown', 0.4]],
  breakdown: [['chorus', 1]],
};
const LENGTH = { intro: 4, verse: 8, chorus: 8, bridge: 8, breakdown: 4 };

// Arpeggio shapes: indexes into [root, third, fifth, octave].
const ARPS = [[0, 1, 2, 1], [0, 1, 2, 3], [3, 2, 1, 2], [0, 2, 1, 3], [0, 2, 3, 2]];

const KICKS = {
  four: () => [0, 4, 8, 12],
  break: (bar) => (bar % 2 ? [0, 6, 10, 14] : [0, 6, 10]),
  half: (bar) => (bar % 2 ? [0, 10] : [0]),
  none: () => [],
};

export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const chance = (p) => Math.random() < p;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export function weighted(items) {
  let total = 0;
  for (const [, w] of items) total += w;
  let r = Math.random() * total;
  for (const [v, w] of items) if ((r -= w) <= 0) return v;
  return items[items.length - 1][0];
}

// MIDI note of a scale degree (degrees can be negative or span several octaves).
export function degMidi(key, deg) {
  const oct = Math.floor(deg / 7);
  return key + 12 * oct + SCALE[deg - oct * 7];
}

const CHORD_TONES = [-5, -3, 0, 2, 4, 7, 9, 11];

export class Composer {
  constructor(audio, secondsPerStep) {
    this.a = audio;
    this.spb = secondsPerStep;
    this.key = 57; // A minor, tonic A3
    this.hook = null;
    this.hookUses = 0;
    this.section = null;
    this.s16 = 0;
    this.startSection('intro');
  }

  // ---------- song structure ----------
  startSection(type) {
    const prev = this.section;
    const sec = { type, bars: LENGTH[type], bar: 0 };

    if (type === 'chorus') {
      if (!this.hook || this.hookUses >= 3) {
        this.hook = { prog: pick(PROGRESSIONS), motif: this.makeMotif(0.6), arp: pick(ARPS) };
        this.hookUses = 0;
      }
      this.hookUses++;
      sec.prog = this.hook.prog;
      sec.motif = this.hook.motif;
      sec.arp = this.hook.arp;
    } else {
      sec.prog = pick(PROGRESSIONS);
      sec.motif = this.makeMotif(type === 'verse' ? 0.45 : 0.35);
      sec.arp = pick(ARPS);
    }
    sec.phrase = this.makePhrase(sec.motif, sec.bars);

    sec.kick = { intro: 'four', verse: pick(['four', 'break']), chorus: 'four', bridge: 'half', breakdown: 'none' }[type];
    sec.bass = { intro: 'sustain', verse: pick(['octave', 'synco']), chorus: pick(['octave', 'drive']), bridge: 'synco', breakdown: 'sustain' }[type];
    sec.hats = { intro: 'eighths', verse: pick(['eighths', 'sixteenths']), chorus: 'open', bridge: 'sixteenths', breakdown: 'none' }[type];
    sec.lead = type === 'verse' || type === 'chorus' || type === 'bridge';
    sec.leadWave = type === 'chorus' ? 'square' : pick(['square', 'triangle', 'sawtooth']);
    sec.leadOctave = type === 'bridge' ? 2 : 1;
    sec.arpOn = type === 'chorus' || type === 'bridge' || type === 'breakdown';
    sec.crash = prev !== null && type !== 'breakdown';

    // lift the key after a breakdown now and then, drifting back toward A minor over time
    if (type === 'chorus' && prev && prev.type === 'breakdown' && chance(0.45)) {
      const shift = this.key > 57 ? pick([-2, -3]) : this.key < 57 ? pick([2, 3]) : pick([2, 3, -2]);
      this.key = clamp(this.key + shift, 53, 62);
    }
    this.section = sec;
  }

  // Two-bar motif on an eighth-note grid; degrees are relative to the current chord's
  // root so the melody follows the harmony. Strong beats land on chord tones.
  makeMotif(density) {
    const notes = {};
    let deg = pick([0, 2, 4, 7]);
    for (let slot = 0; slot < 16; slot++) {
      const step = slot * 2;
      const strong = slot % 4 === 0;
      if (slot !== 0 && !chance(strong ? density + 0.25 : density)) continue;
      deg += weighted([[-2, 1], [-1, 3], [0, 1], [1, 3], [2, 1], [3, 0.4], [-3, 0.4]]);
      deg = clamp(deg, -3, 9);
      if (strong) deg = CHORD_TONES.reduce((best, t) => (Math.abs(t - deg) < Math.abs(best - deg) ? t : best), 0);
      notes[step] = { deg };
      if (!strong && chance(0.15)) notes[step + 1] = { deg: deg + pick([-1, 1]) };
    }
    return this.withLengths(notes);
  }

  withLengths(notes) {
    const steps = Object.keys(notes).map(Number).sort((a, b) => a - b);
    steps.forEach((s, i) => {
      const next = i + 1 < steps.length ? steps[i + 1] : 32;
      notes[s].len = Math.min(6, next - s);
    });
    return notes;
  }

  // Answer phrase: same rhythm, a few notes nudged.
  variant(motif) {
    const out = {};
    for (const [s, n] of Object.entries(motif)) {
      out[s] = { deg: chance(0.35) ? clamp(n.deg + pick([-2, -1, 1, 2]), -3, 9) : n.deg };
    }
    return this.withLengths(out);
  }

  // Closing phrase: first bar of the motif, then settle on the root.
  cadence(motif) {
    const out = {};
    for (const [s, n] of Object.entries(motif)) if (+s < 16) out[s] = { deg: n.deg };
    out[16] = { deg: pick([0, 7]) };
    const c = this.withLengths(out);
    c[16].len = 12;
    return c;
  }

  // One entry per two bars.
  makePhrase(motif, bars) {
    if (bars <= 4) return [motif, this.cadence(motif)];
    return [motif, this.variant(motif), motif, this.cadence(motif)];
  }

  // ---------- playback ----------
  // Advance one sixteenth without playing (used to skip time the timer missed).
  advance() {
    this.s16++;
    if (this.s16 === 16) {
      this.s16 = 0;
      const sec = this.section;
      sec.bar++;
      if (sec.bar >= sec.bars) this.startSection(weighted(NEXT[sec.type]));
    }
  }

  // Schedule every sound for the current sixteenth `when` seconds from now, then advance.
  step(when) {
    const a = this.a;
    const dest = a.musicBus;
    const sec = this.section;
    const s = this.s16;
    const bar = sec.bar;
    const spb = this.spb;
    const chordDeg = sec.prog[bar % 4];
    const triad = [0, 2, 4].map((d) => degMidi(this.key, chordDeg + d));
    const bassRoot = degMidi(this.key, chordDeg) - 12;
    const lastBar = bar === sec.bars - 1;
    const fill = lastBar && s >= 8 && (sec.type === 'verse' || sec.type === 'chorus' || sec.type === 'bridge');

    // crash cymbal on section starts
    if (bar === 0 && s === 0 && sec.crash) a.noise({ type: 'highpass', f0: 5200, dur: 1.5, vol: 0.2, when, dest });

    // kick & snare (the intro brings the kick in halfway)
    const kickOn = !(sec.type === 'intro' && bar < 2);
    if (!fill && kickOn && KICKS[sec.kick](bar).includes(s)) {
      a.tone({ type: 'sine', f0: 150, f1: 42, dur: 0.16, vol: 0.9, when, dest });
    }
    const snareSteps = sec.kick === 'half' ? [8] : sec.kick === 'none' || sec.type === 'intro' ? [] : [4, 12];
    if (!fill && snareSteps.includes(s)) {
      a.noise({ type: 'bandpass', f0: 1900, q: 0.7, dur: 0.13, vol: 0.45, when, dest });
      a.tone({ type: 'triangle', f0: 190, f1: 140, dur: 0.07, vol: 0.25, when, dest });
    }
    if (fill) {
      const k = (s - 8) / 7;
      a.noise({ type: 'bandpass', f0: 1700 + k * 900, q: 0.8, dur: 0.09, vol: 0.18 + 0.3 * k, when, dest });
      a.tone({ type: 'triangle', f0: 230 - k * 90, f1: 150 - k * 60, dur: 0.1, vol: 0.18 + 0.15 * k, when, dest });
      if (s === 8 || s === 12) a.tone({ type: 'sine', f0: 150, f1: 42, dur: 0.16, vol: 0.8, when, dest });
    }

    // hi-hats
    if (sec.hats === 'eighths' && s % 2 === 0) {
      a.noise({ type: 'highpass', f0: 7500, dur: 0.03, vol: s % 4 === 2 ? 0.13 : 0.09, when, dest });
    } else if (sec.hats === 'sixteenths') {
      a.noise({ type: 'highpass', f0: 8000, dur: 0.025, vol: s % 2 === 0 ? 0.1 : 0.05, when, dest });
    } else if (sec.hats === 'open') {
      if (s % 4 === 2) a.noise({ type: 'highpass', f0: 6500, dur: 0.16, vol: 0.14, when, dest });
      else if (s % 2 === 0) a.noise({ type: 'highpass', f0: 7500, dur: 0.03, vol: 0.09, when, dest });
    }

    // bass
    const bassNote = (n, dur, vol, hold = false) => {
      a.tone({ type: 'sawtooth', f0: NOTE(n), dur, vol, when, dest, hold, attack: hold ? 0.02 : 0.005 });
      a.tone({ type: 'sine', f0: NOTE(n - 12), dur: dur + 0.01, vol: vol * 1.25, when, dest, hold, attack: hold ? 0.02 : 0.005 });
    };
    if (sec.bass === 'sustain') {
      if (s === 0) bassNote(bassRoot, spb * 15, 0.1, true);
    } else if (sec.bass === 'octave') {
      if (s % 2 === 0) bassNote(s % 4 === 2 ? bassRoot + 12 : bassRoot, 0.11, 0.2);
    } else if (sec.bass === 'drive') {
      if (s % 2 === 0) bassNote(bassRoot, 0.1, s % 4 === 0 ? 0.22 : 0.15);
    } else if (sec.bass === 'synco') {
      if ([0, 3, 6, 8, 11, 14].includes(s)) {
        const fifth = degMidi(this.key, chordDeg + 4) - 12;
        bassNote(s === 6 || s === 14 ? fifth : bassRoot, 0.14, 0.2);
      }
    }

    // pad
    if (s === 0) {
      const vol = sec.type === 'chorus' ? 0.02 : 0.03;
      for (const n of triad) a.tone({ type: 'triangle', f0: NOTE(n), dur: spb * 16, vol, attack: 0.25, hold: true, when, dest });
    }

    // arpeggio
    if (sec.arpOn) {
      const tones = [triad[0], triad[1], triad[2], triad[0] + 12];
      const n = tones[sec.arp[s % sec.arp.length]] + 12;
      a.tone({ type: 'triangle', f0: NOTE(n), dur: 0.09, vol: sec.type === 'breakdown' ? 0.04 : 0.03, when, dest });
    }

    // lead melody
    if (sec.lead) {
      const unit = sec.phrase[Math.floor(bar / 2) % sec.phrase.length];
      const note = unit[(bar % 2) * 16 + s];
      if (note) {
        const n = degMidi(this.key, chordDeg + note.deg) + 12 * sec.leadOctave;
        const dur = note.len * spb * 0.92;
        a.tone({ type: sec.leadWave, f0: NOTE(n), dur, vol: sec.leadWave === 'sawtooth' ? 0.035 : 0.05, when, dest });
        if (sec.type === 'chorus') a.tone({ type: 'triangle', f0: NOTE(n + 12), dur: dur * 0.8, vol: 0.022, when, dest });
      }
    }

    // riser into the drop
    if (sec.type === 'breakdown' && lastBar && s === 0) {
      const dur = spb * 16;
      a.noise({ type: 'bandpass', f0: 350, f1: 6000, q: 1.2, dur, vol: 0.22, attack: dur * 0.94, when, dest });
    }

    this.advance();
  }
}
