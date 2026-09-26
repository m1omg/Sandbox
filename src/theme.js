// Two looks share one game: 'city' (default) and 'classic' (a bright, cel-shaded rail
// line with overhead wires, arched walls, round trees and chunky toon trains).
// The Look button saves the choice. `?theme=classic` / `?theme=city` in the URL picks a look
// for that visit only, so opening a shared link doesn't change which look the plain link opens.

// Earlier versions also saved the look from the URL under 'rail-rascals-theme'; a new key
// drops those link-saved values so everyone starts from the default again.
const KEY = 'rail-rascals-look';

function readTheme() {
  const param = new URLSearchParams(location.search).get('theme');
  if (param === 'classic' || param === 'city') return param;
  try {
    if (localStorage.getItem(KEY) === 'classic') return 'classic';
  } catch (e) { /* storage unavailable */ }
  return 'city';
}

export const THEME = readTheme();
export const CLASSIC = THEME === 'classic';

export function switchTheme(theme) {
  const url = new URL(location.href);
  try {
    localStorage.setItem(KEY, theme);
    // reload without a ?theme= override so the saved choice applies
    url.searchParams.delete('theme');
  } catch (e) {
    // storage unavailable: carry the choice in the URL instead
    url.searchParams.set('theme', theme);
  }
  location.href = url.toString();
}
