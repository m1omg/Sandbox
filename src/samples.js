// Real instrument samples for the classic look's music (assets/audio/, mono MP3).
//
// Sources and licences:
// * Drums and percussion: Versilian Community Sample Library (VCSL) by Versilian Studios,
//   CC0 1.0 (public domain) - https://github.com/sgossner/VCSL
// * Bass, electric piano, brass, steel drums, marimba and pizzicato strings: Fluid (R3)
//   General MIDI SoundFont by Frank Wen, as rendered by the midi-js-soundfonts project,
//   CC BY 3.0 - https://github.com/gleitz/midi-js-soundfonts
//
// Each file was trimmed to the part the music uses, mixed to mono and normalised.

const BASE = 'assets/audio/';

// one-shot drum and percussion hits
export const DRUMS = ["kick", "snare", "ghost", "hat", "hat2", "hatOpen", "clap", "shaker", "tamb", "crash", "conga", "quinto"];

// pitched instruments: the MIDI notes that were sampled (files are <name>_<note>.mp3)
export const INSTRUMENTS = {
  bass: [33, 38, 43, 48, 53],
  epiano: [48, 53, 58, 63, 68, 73],
  brass: [53, 58, 63, 68, 73],
  steel: [60, 65, 70, 75, 80, 85],
  marimba: [55, 60, 65, 70, 75, 80, 85],
  pizz: [55, 60, 65, 70, 75, 80],
};

// Fetch every sample file (raw bytes); decoding happens once audio is unlocked.
export async function loadSampleData(onProgress) {
  const jobs = [];
  for (const name of DRUMS) jobs.push([name, null, `${BASE}${name}.mp3`]);
  for (const [name, notes] of Object.entries(INSTRUMENTS)) {
    for (const n of notes) jobs.push([name, n, `${BASE}${name}_${n}.mp3`]);
  }
  let done = 0;
  const data = {};
  await Promise.all(jobs.map(async ([name, note, url]) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Could not load ${url}`);
    const buf = await res.arrayBuffer();
    if (note === null) data[name] = buf;
    else (data[name] ||= {})[note] = buf;
    done++;
    if (onProgress) onProgress(done / jobs.length);
  }));
  return data;
}
