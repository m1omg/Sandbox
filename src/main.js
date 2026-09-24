import * as THREE from 'three';
import { STEP, MAX_FRAME_TIME, HOVERBOARD_COST, UPGRADE_COSTS, MAX_UPGRADE } from './config.js';
import { loadAssets } from './assets.js';
import { AudioSys } from './audio.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { loadSave, writeSave } from './storage.js';
import { Game } from './game.js';

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 800);

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // widen the view on tall (portrait) screens so all three lanes stay visible
  camera.fov = camera.aspect >= 1.1 ? 60 : Math.min(82, 60 + (1.1 - camera.aspect) * 38);
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const ui = new UI();
const save = loadSave();
const audio = new AudioSys();
audio.musicOn = save.music;
audio.sfxOn = save.sfx;
ui.setToggles(save);
const input = new Input(document.getElementById('touch'));
ui.show('loading');

let game = null;

// Browsers only allow audio after a user gesture.
function unlockAudio() {
  audio.unlock();
  audio.startMusic();
}
window.addEventListener('pointerdown', unlockAudio);
window.addEventListener('keydown', unlockAudio);

const touchDevice = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

function startRun() {
  unlockAudio();
  game.startRun();
  ui.showHud();
  // remind newer players how to use the hoverboards they own
  if (save.boards > 0 && save.runs < 5) {
    ui.toast(touchDevice ? 'Double-tap to ride a hoverboard' : 'Press E to ride a hoverboard', 2800);
  }
}

function toMenu() {
  game.enterMenu();
  ui.showMenu(save);
}

ui.on('click', () => audio.click());
ui.on('play', startRun);
ui.on('restart', startRun);
ui.on('menu', toMenu);
ui.on('pause', () => game.pause());
ui.on('resume', () => game.resume());
ui.on('help', () => ui.showHelp('menu'));
ui.on('shop', () => ui.showShop(save, ui.current));
ui.on('back', () => (ui.returnTo === 'over' ? ui.show('over') : ui.showMenu(save)));
ui.on('board', () => input.queue.push('board'));
ui.on('toggleMusic', () => {
  save.music = !save.music;
  audio.setMusic(save.music);
  writeSave(save);
  ui.setToggles(save);
});
ui.on('toggleSfx', () => {
  save.sfx = !save.sfx;
  audio.setSfx(save.sfx);
  writeSave(save);
  ui.setToggles(save);
});
ui.on('buy', (item) => {
  if (item === 'board') {
    if (save.coins < HOVERBOARD_COST) return;
    save.coins -= HOVERBOARD_COST;
    save.boards += 1;
  } else {
    const lvl = save.upgrades[item];
    if (lvl >= MAX_UPGRADE || save.coins < UPGRADE_COSTS[lvl]) return;
    save.coins -= UPGRADE_COSTS[lvl];
    save.upgrades[item] = lvl + 1;
  }
  audio.buy();
  writeSave(save);
  ui.showShop(save);
});

// Menu / pause shortcuts are handled immediately; gameplay actions stay queued for the simulation.
input.onAction((a) => {
  if (!game) return;
  if (a === 'pause') {
    if (game.state === 'playing') game.pause();
    else if (game.state === 'paused') game.resume();
  } else if ((a === 'confirm' || a === 'up') && ui.current === 'menu') {
    startRun();
  } else if (a === 'confirm' && game.state === 'over' && ui.current === 'over') {
    startRun();
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && game) game.pause();
});
window.addEventListener('blur', () => game && game.pause());

try {
  const assets = await loadAssets(renderer, (p) => ui.setLoading(p));
  game = new Game({ scene, camera, assets, audio, save, ui, input });
  window.__game = game;
  renderer.compile(scene, camera);
  ui.showMenu(save);
} catch (err) {
  console.error(err);
  ui.setLoading(0, 'Could not load the game assets. Serve this folder over HTTP (see README).');
}

// Main loop: the simulation advances in fixed STEP increments using real elapsed time,
// and rendering interpolates between the last two simulation states. Game speed is
// therefore the same on 30 Hz, 60 Hz, 144 Hz or any other display.
let last = performance.now();
let acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (!(dt > 0)) dt = 0;
  if (dt > MAX_FRAME_TIME) dt = MAX_FRAME_TIME;
  if (!game) return;
  if (game.isSimulating()) {
    acc += dt;
    let n = 0;
    while (acc >= STEP && game.isSimulating() && n < 40) {
      game.step(STEP);
      acc -= STEP;
      n++;
    }
    if (acc >= STEP) acc = 0;
  }
  game.render(dt, Math.min(1, acc / STEP));
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);
