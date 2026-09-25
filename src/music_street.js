import { Composer, degMidi, pick, chance } from './music.js';

// Sampled-instrument soundtrack for the classic look: an original, upbeat street/hip-hop
// groove played on real recorded instruments (see samples.js for sources and licences).
// It reuses the procedural song structure of Composer — sections, chord progressions and
// freshly generated melodies — so it keeps changing instead of looping, but performs it
// with a swung drum kit, fingered electric bass, electric piano, brass stabs and a lead
// that moves between steel drums, marimba and pizzicato strings.

export const STREET_BPM = 100;
const SWING = 0.14;     // fraction of a sixteenth that off-beat sixteenths are delayed
const LEVEL = 0.6;      // recorded instruments are denser than the synth band; match its loudness

const KICKS = {
  boom: (bar) => (bar % 2 ? [0, 3, 7, 10] : [0, 7, 10]),
  bounce: (bar) => (bar % 4 === 3 ? [0, 6, 8, 11, 14] : [0, 6, 8, 11]),
  drive: (bar) => (bar % 4 === 3 ? [0, 4, 8, 12, 14] : [0, 4, 8, 12]),
  half: (bar) => (bar % 2 ? [0, 10, 11] : [0, 10]),
  none: () => [],
};
const HAT_VEL = [0.5, 0.18, 0.32, 0.2, 0.45, 0.18, 0.32, 0.22, 0.5, 0.18, 0.32, 0.2, 0.45, 0.18, 0.3, 0.24];
const CONGA = { 0: 'conga', 3: 'quinto', 6: 'conga', 10: 'quinto', 11: 'quinto', 14: 'conga' };

export class StreetComposer extends Composer {
  constructor(audio) {
    super(audio, 60 / STREET_BPM / 4);
    this.bus = audio.ctx.createGain();
    this.bus.gain.value = LEVEL;
    this.bus.connect(audio.musicBus);
  }

  startSection(type) {
    super.startSection(type);
    const sec = this.section;
    sec.groove = { intro: 'boom', verse: pick(['boom', 'bounce']), chorus: 'drive', bridge: 'half', breakdown: 'none' }[type];
    sec.bassStyle = { intro: 'sustain', verse: pick(['funk', 'synco']), chorus: pick(['funk', 'octaves']), bridge: 'synco', breakdown: 'sustain' }[type];
    sec.lead = { intro: null, verse: pick(['steel', 'marimba']), chorus: 'steel', bridge: pick(['marimba', 'pizz']), breakdown: null }[type];
    sec.comp = { intro: 'pad', verse: 'hold', chorus: 'stabs', bridge: 'hold', breakdown: 'pad' }[type];
    sec.brass = type === 'chorus';
    sec.shaker = type === 'chorus' || (type === 'verse' && chance(0.5));
    sec.congas = type === 'bridge' || type === 'breakdown' || (type === 'verse' && chance(0.3));
    sec.brassFigure = pick([[0, 3, 6], [0, 6, 10], [0, 3, 14], [6, 10, 14]]);
  }

  // sixteenth `s` of the current bar -> audio time, with swing on the off-beats
  swung(when, s) {
    return s % 2 === 1 ? when + this.spb * SWING : when;
  }

  step(when) {
    const a = this.a;
    const dest = this.bus;
    const sec = this.section;
    const s = this.s16;
    const bar = sec.bar;
    const spb = this.spb;
    const t = this.swung(when, s);
    const chordDeg = sec.prog[bar % 4];
    const lastBar = bar === sec.bars - 1;
    const fill = lastBar && s >= 8 && sec.groove !== 'none' && sec.type !== 'intro';
    const hit = (name, vol, extra = {}) => a.sample(name, { when: t, vol, dest, ...extra });
    const play = (name, note, vol, dur) => a.sample(name, { note, when: t, vol, dur, dest });

    // ---- drums ----
    if (bar === 0 && s === 0 && sec.crash) hit('crash', 0.32);
    const kickOn = !(sec.type === 'intro' && bar < 2);
    if (kickOn && !fill && KICKS[sec.groove](bar).includes(s)) {
      hit('kick', 0.85);
      a.tone({ type: 'sine', f0: 95, f1: 42, dur: 0.2, vol: 0.55, when: t, dest });
    }
    const backbeat = sec.groove === 'half' ? [8] : sec.groove === 'none' || sec.type === 'intro' ? [] : [4, 12];
    if (!fill && backbeat.includes(s)) {
      hit('snare', 0.7);
      if (sec.type === 'chorus' || s === 12) hit('clap', 0.42);
    }
    if (!fill && sec.groove !== 'none' && sec.type !== 'intro' && (s === 7 || s === 15 || s === 9) && chance(0.35)) {
      hit('ghost', 0.2);
    }
    if (fill) {
      const k = (s - 8) / 7;
      hit(s % 2 ? 'ghost' : 'snare', 0.3 + 0.45 * k);
      if (s === 8) hit('kick', 0.8);
      if (s >= 12 && s % 2 === 0) hit('conga', 0.35 + 0.3 * k);
    }
    if (sec.groove !== 'none') {
      if (s === 14 && bar % 2 === 1 && !fill) hit('hatOpen', 0.28);
      else if (sec.type !== 'intro' || s % 2 === 0) hit(s % 4 === 2 ? 'hat2' : 'hat', HAT_VEL[s] * (sec.type === 'intro' ? 0.7 : 1));
    } else if (s % 4 === 2) {
      hit('hat', 0.14);
    }
    if (sec.shaker && s % 2 === 1) hit('shaker', 0.16);
    if (sec.type === 'chorus' && (s === 4 || s === 12)) hit('tamb', 0.26);
    if (sec.congas && CONGA[s] && !fill) hit(CONGA[s], s === 0 ? 0.42 : 0.32);

    // ---- bass (fingered electric) ----
    const root = degMidi(this.key, chordDeg) - 12;
    const fifth = degMidi(this.key, chordDeg + 4) - 12;
    const nextRoot = degMidi(this.key, sec.prog[(bar + 1) % 4]) - 12;
    if (sec.bassStyle === 'sustain') {
      if (s === 0) play('bass', root, 0.55, spb * 14);
    } else if (sec.bassStyle === 'funk') {
      const line = { 0: root, 3: root, 6: root + 12, 8: root, 10: fifth, 11: root + 12, 14: fifth };
      if (s in line) play('bass', line[s], s === 0 ? 0.65 : 0.5, spb * (s === 0 ? 2.5 : 1.4));
      if (s === 15 && nextRoot !== root) play('bass', nextRoot + (nextRoot > root ? -1 : 1), 0.4, spb);
    } else if (sec.bassStyle === 'synco') {
      const line = { 0: root, 3: fifth, 6: root, 10: root, 12: fifth + 12 > root + 12 ? fifth : root + 12, 14: fifth };
      if (s in line) play('bass', line[s], s === 0 ? 0.65 : 0.5, spb * 2.2);
    } else if (sec.bassStyle === 'octaves') {
      if (s % 2 === 0) play('bass', s % 4 === 2 ? root + 12 : root, s % 4 === 0 ? 0.6 : 0.45, spb * 1.3);
    }

    // ---- chords (electric piano) ----
    const voicing = [0, 2, 4, 6].map((d) => {
      let n = degMidi(this.key, chordDeg + d);
      while (n < 55) n += 12;
      while (n > 74) n -= 12;
      return n;
    });
    const chord = (vol, dur) => voicing.forEach((n) => play('epiano', n, vol, dur));
    if (sec.comp === 'pad' && s === 0) chord(0.2, spb * 15);
    if (sec.comp === 'hold' && (s === 0 || s === 10)) chord(0.18, spb * (s === 0 ? 9 : 5));
    if (sec.comp === 'stabs' && (s === 2 || s === 6 || s === 10 || s === 14)) chord(0.16, spb * 1.2);

    // ---- brass stabs on the chorus ----
    if (sec.brass && bar % 2 === 0 && sec.brassFigure.includes(s)) {
      for (const d of [0, 2, 4]) play('brass', degMidi(this.key, chordDeg + d) + 12, 0.2, spb * 1.6);
    }

    // ---- lead melody ----
    if (sec.lead) {
      const unit = sec.phrase[Math.floor(bar / 2) % sec.phrase.length];
      const note = unit[(bar % 2) * 16 + s];
      if (note) {
        const n = degMidi(this.key, chordDeg + note.deg) + 12;
        const dur = note.len * spb;
        play(sec.lead, n, sec.lead === 'pizz' ? 0.45 : 0.42, dur + 0.25);
        if (sec.type === 'chorus') play('marimba', n + 12, 0.22, dur + 0.2);
      }
    }

    // ---- breakdown: pizzicato arpeggio and a riser into the drop ----
    if (sec.type === 'breakdown') {
      if (s % 2 === 0) play('pizz', voicing[[0, 1, 2, 3, 2, 1, 0, 1][(s / 2) % 8]] + 12, 0.3, spb * 1.8);
      if (lastBar && s === 0) {
        const dur = spb * 16;
        a.noise({ type: 'bandpass', f0: 350, f1: 6000, q: 1.2, dur, vol: 0.18, attack: dur * 0.94, when: t, dest });
      }
    }

    this.advance();
  }
}
