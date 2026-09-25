// Two looks share one game: 'city' (default) and 'classic' (a bright, cel-shaded rail
// line with overhead wires, arched walls, round trees and chunky toon trains).
// `?theme=classic` / `?theme=city` in the URL picks one and remembers it.

const KEY = 'rail-rascals-theme';

function readTheme() {
  const param = new URLSearchParams(location.search).get('theme');
  if (param === 'classic' || param === 'city') {
    try { localStorage.setItem(KEY, param); } catch (e) { /* storage unavailable */ }
    return param;
  }
  try {
    if (localStorage.getItem(KEY) === 'classic') return 'classic';
  } catch (e) { /* storage unavailable */ }
  return 'city';
}

export const THEME = readTheme();
export const CLASSIC = THEME === 'classic';

export function switchTheme(theme) {
  try { localStorage.setItem(KEY, theme); } catch (e) { /* storage unavailable */ }
  const url = new URL(location.href);
  url.searchParams.set('theme', theme);
  location.href = url.toString();
}
