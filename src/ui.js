import { POWERUPS, POWERUP_TYPES, UPGRADE_COSTS, MAX_UPGRADE, HOVERBOARD_COST, HOVERBOARD_TIME, powerupDuration } from './config.js';
import { formatNumber } from './util.js';

const $ = (id) => document.getElementById(id);

const svg = (body) => `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
const ICONS = {
  jetpack: svg('<rect x="4" y="3" width="6.5" height="13" rx="3" fill="#1b2a4a"/><rect x="13.5" y="3" width="6.5" height="13" rx="3" fill="#1b2a4a"/><path d="M5.5 17h3.5l-1.75 5zM15 17h3.5l-1.75 5z" fill="#fff4a0"/>'),
  sneakers: svg('<path d="M3 15c0-3 1-7 3-9l3 1c0 2 1 3 3 3l7 2c2 .6 3 2 3 4v1H3z" fill="#1b2a4a"/><rect x="3" y="17" width="19" height="3" rx="1.5" fill="#fff"/>'),
  magnet: svg('<path d="M5 3h4v9a3 3 0 0 0 6 0V3h4v9a7 7 0 0 1-14 0z" fill="#1b2a4a"/><rect x="5" y="3" width="4" height="3.5" fill="#fff"/><rect x="15" y="3" width="4" height="3.5" fill="#fff"/>'),
  multiplier: svg('<text x="12" y="17" text-anchor="middle" font-size="14" font-weight="900" font-family="system-ui,sans-serif" fill="#1b2a4a">2x</text>'),
  board: svg('<rect x="2" y="9" width="20" height="6" rx="3" fill="#ffd400"/><path d="M11 7l-2 5h3l-1 5 4-6h-3l1-4z" fill="#1b2a4a"/>'),
};

const SCREENS = ['menu', 'pause', 'over', 'shop', 'help', 'loading'];

export class UI {
  constructor() {
    this.handlers = {};
    this.el = {
      hud: $('hud'), score: $('score'), mult: $('mult'), coins: $('coins'),
      powerups: $('powerups'), boardBtn: $('btn-board'), boardCount: $('board-count'), boardBar: $('board-bar').firstElementChild,
      toast: $('toast'), countdown: $('countdown'), loadbar: $('loadbar'), loadMsg: $('load-msg'),
    };
    this.puEls = {};
    for (const type of POWERUP_TYPES) {
      const div = document.createElement('div');
      div.className = 'pu hidden';
      div.innerHTML = `<span class="ico" style="background:${POWERUPS[type].color}">${ICONS[type]}</span><span class="bar"><i style="background:${POWERUPS[type].color}"></i></span>`;
      this.el.powerups.appendChild(div);
      this.puEls[type] = { root: div, bar: div.querySelector('.bar i') };
    }
    this.lastHud = {};
    this.returnTo = 'menu';

    const on = (id, name) => $(id).addEventListener('click', (e) => {
      e.currentTarget.blur();
      this.emit(name);
    });
    on('btn-play', 'play');
    on('btn-shop', 'shop');
    on('btn-help', 'help');
    on('btn-music', 'toggleMusic');
    on('btn-sfx', 'toggleSfx');
    on('btn-pause', 'pause');
    on('btn-resume', 'resume');
    on('btn-restart', 'restart');
    on('btn-quit', 'menu');
    on('btn-again', 'restart');
    on('btn-over-shop', 'shop');
    on('btn-over-menu', 'menu');
    on('btn-shop-back', 'back');
    on('btn-help-back', 'back');
    on('btn-board', 'board');
  }

  on(name, fn) {
    this.handlers[name] = fn;
  }

  emit(name, arg) {
    if (this.handlers.click && name !== 'board') this.handlers.click();
    if (this.handlers[name]) this.handlers[name](arg);
  }

  show(screen) {
    for (const s of SCREENS) $(s).classList.toggle('hidden', s !== screen);
    this.current = screen;
  }

  setLoading(p, msg) {
    this.el.loadbar.style.width = `${Math.round(p * 100)}%`;
    if (msg) this.el.loadMsg.textContent = msg;
  }

  showMenu(save) {
    this.el.hud.classList.add('hidden');
    $('menu-best').textContent = formatNumber(save.best);
    $('menu-coins').textContent = formatNumber(save.coins);
    $('menu-boards').textContent = save.boards;
    this.show('menu');
    $('btn-play').focus({ preventScroll: true });
  }

  showHud() {
    this.show(null);
    this.el.hud.classList.remove('hidden');
    this.lastHud = {};
  }

  showPause() {
    this.show('pause');
    $('btn-resume').focus({ preventScroll: true });
  }

  showGameOver({ score, coins, best, newBest, reason }) {
    $('over-title').textContent = reason === 'caught' ? 'Caught!' : 'Busted!';
    $('over-score').textContent = formatNumber(score);
    $('over-coins').textContent = formatNumber(coins);
    $('over-best').textContent = formatNumber(best);
    $('over-newbest').classList.toggle('hidden', !newBest);
    this.show('over');
    $('btn-again').focus({ preventScroll: true });
  }

  showHelp(from) {
    this.returnTo = from;
    this.show('help');
  }

  showShop(save, from) {
    if (from) this.returnTo = from;
    $('shop-coins').textContent = formatNumber(save.coins);
    const list = $('shop-list');
    list.innerHTML = '';
    for (const type of POWERUP_TYPES) {
      const lvl = save.upgrades[type];
      const maxed = lvl >= MAX_UPGRADE;
      const cost = maxed ? 0 : UPGRADE_COSTS[lvl];
      const li = document.createElement('li');
      li.className = 'shop-item';
      const pips = Array.from({ length: MAX_UPGRADE }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('');
      li.innerHTML = `
        <span class="ico" style="background:${POWERUPS[type].color}">${ICONS[type]}</span>
        <span class="info">
          <span class="name">${POWERUPS[type].label}</span>
          <span class="desc">Lasts ${powerupDuration(type, lvl).toFixed(1)}s${maxed ? '' : ` → ${powerupDuration(type, lvl + 1).toFixed(1)}s`} whenever you pick one up</span>
          <span class="pips">${pips}</span>
        </span>
        <button class="btn primary" ${maxed || save.coins < cost ? 'disabled' : ''}>${maxed ? 'Maxed' : `<span class="coin-icon small"></span>${formatNumber(cost)}`}</button>`;
      li.querySelector('button').addEventListener('click', () => this.emit('buy', type));
      list.appendChild(li);
    }
    const li = document.createElement('li');
    li.className = 'shop-item';
    li.innerHTML = `
      <span class="ico" style="background:linear-gradient(160deg,#12c2c9,#7b3fe4)">${ICONS.board}</span>
      <span class="info">
        <span class="name">Hoverboard ×1</span>
        <span class="desc">Absorbs one crash, lasts ${HOVERBOARD_TIME}s. You own ${save.boards}. Ride one during a run: press E or Shift, double-tap, or tap the board button (bottom right).</span>
      </span>
      <button class="btn primary" ${save.coins < HOVERBOARD_COST ? 'disabled' : ''}><span class="coin-icon small"></span>${HOVERBOARD_COST}</button>`;
    li.querySelector('button').addEventListener('click', () => this.emit('buy', 'board'));
    list.appendChild(li);
    this.show('shop');
  }

  setToggles(save) {
    const m = $('btn-music');
    const s = $('btn-sfx');
    m.textContent = `Music: ${save.music ? 'On' : 'Off'}`;
    m.setAttribute('aria-pressed', String(save.music));
    s.textContent = `Sound: ${save.sfx ? 'On' : 'Off'}`;
    s.setAttribute('aria-pressed', String(save.sfx));
  }

  toast(msg, ms = 1400) {
    const t = this.el.toast;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }

  showCountdown(n) {
    const c = this.el.countdown;
    if (n > 0) {
      c.textContent = n;
      c.classList.remove('hidden');
      this.show(null);
      this.el.hud.classList.remove('hidden');
    } else {
      c.classList.add('hidden');
    }
  }

  // Only touch the DOM when a value actually changes.
  updateHud(game) {
    const p = game.player;
    const h = this.lastHud;
    const score = Math.floor(game.score);
    if (h.score !== score) { this.el.score.textContent = formatNumber(score); h.score = score; }
    if (h.coins !== game.coins) { this.el.coins.textContent = formatNumber(game.coins); h.coins = game.coins; }
    const mult = game.multiplier();
    if (h.mult !== mult) {
      this.el.mult.textContent = `x${mult}`;
      this.el.mult.classList.toggle('hot', mult > 1);
      h.mult = mult;
    }
    const timers = { jetpack: p.jetpackT, sneakers: p.sneakersT, magnet: p.magnetT, multiplier: p.multT };
    for (const type of POWERUP_TYPES) {
      const t = timers[type];
      const el = this.puEls[type];
      const active = t > 0;
      if (el.active !== active) { el.root.classList.toggle('hidden', !active); el.active = active; }
      if (active) {
        const pct = Math.round((t / game.powerMax[type]) * 100);
        if (el.pct !== pct) { el.bar.style.width = `${pct}%`; el.pct = pct; }
      }
    }
    const boards = game.save.boards;
    if (h.boards !== boards) { this.el.boardCount.textContent = boards; h.boards = boards; }
    const boardActive = p.boardT > 0;
    const disabled = boardActive || boards <= 0 || game.state !== 'playing';
    if (h.boardDisabled !== disabled) { this.el.boardBtn.disabled = disabled; h.boardDisabled = disabled; }
    const bpct = boardActive ? Math.round((p.boardT / HOVERBOARD_TIME) * 100) : 0;
    if (h.bpct !== bpct) { this.el.boardBar.style.width = `${bpct}%`; h.bpct = bpct; }
  }
}
