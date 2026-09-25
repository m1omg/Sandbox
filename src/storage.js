// Persistent progress. localStorage can be unavailable (private mode, blocked storage),
// so every access is guarded and the game keeps working with in-memory defaults.

const KEY = 'rail-rascals-save-v1';

const DEFAULTS = {
  coins: 0,
  best: 0,
  boards: 3,
  runs: 0,
  upgrades: { jetpack: 0, sneakers: 0, magnet: 0, multiplier: 0 },
  music: true,
  sfx: true,
  showFps: false,
};

function merge(base, extra) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  if (!extra || typeof extra !== 'object') return out;
  for (const k of Object.keys(base)) {
    if (!(k in extra)) continue;
    const b = base[k];
    const e = extra[k];
    if (b && typeof b === 'object' && !Array.isArray(b)) out[k] = merge(b, e);
    else if (typeof e === typeof b) out[k] = e;
  }
  return out;
}

export function loadSave() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return merge(DEFAULTS, JSON.parse(raw));
  } catch (e) {
    /* storage unavailable */
  }
  return merge(DEFAULTS, null);
}

export function writeSave(save) {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch (e) {
    /* storage unavailable */
  }
}
