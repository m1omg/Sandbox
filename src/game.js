import {
  SPEED_START, SPEED_MAX, SPEED_TAU, CHASE_TIME, HOVERBOARD_TIME, POWERUPS, powerupDuration, DESPAWN_BEHIND,
} from './config.js';
import { World, MENU_BEHIND } from './world.js';
import { Obstacles } from './obstacles.js';
import { Pickups } from './pickups.js';
import { Generator } from './generator.js';
import { Player } from './player.js';
import { Chaser } from './chaser.js';
import { Effects } from './effects.js';
import { writeSave } from './storage.js';
import { damp, lerp, smoothstep, clamp, Rng } from './util.js';

const overlap = (a, b) =>
  a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0 && a.s0 < b.s1 && a.s1 > b.s0;

const MENU_SPEED = 9;

export class Game {
  constructor({ scene, camera, assets, audio, save, ui, input }) {
    this.scene = scene;
    this.camera = camera;
    this.audio = audio;
    this.save = save;
    this.ui = ui;
    this.input = input;

    this.world = new World(scene, assets);
    this.obstacles = new Obstacles(scene, assets);
    this.pickups = new Pickups(scene);
    this.generator = new Generator(this.obstacles, this.pickups);
    this.player = new Player(scene, assets.models.kit);
    this.chaser = new Chaser(scene, assets.models.warden);
    this.effects = new Effects(scene);
    this.groundFn = (x, s, y) => this.obstacles.groundAt(x, s, y);

    this.time = 0;
    this.camBlend = 0;
    this.camB = 0;
    this.camX = 0;
    this.camY = 1.6;
    this.shake = 0;
    this.powerMax = { jetpack: 1, sneakers: 1, magnet: 1, multiplier: 1 };
    this.score = 0;
    this.coins = 0;
    this.enterMenu();
  }

  // ---------- state changes ----------
  enterMenu() {
    this.state = 'menu';
    this.obstacles.clear();
    this.pickups.clear();
    this.effects.clear();
    this.audio.stopJet();
    const s = this.player.s;
    this.player.reset(s);
    this.chaser.reset(0);
    this.chaser.menu = true;
    this.chaser.gap = 3.4;
    this.chaser.prevGap = 3.4;
    this.speed = MENU_SPEED;
    this.world.reset(s, MENU_BEHIND);
  }

  // `seed` makes a run reproducible (used by tests); normal runs get a random level.
  startRun(seed) {
    const s = this.player.s;
    this.rng = new Rng(seed);
    this.obstacles.clear();
    this.pickups.clear();
    this.effects.clear();
    this.audio.stopJet();
    this.player.reset(s);
    this.chaser.reset();
    this.chaser.gap = this.chaser.prevGap = this.state === 'menu' ? 3.4 : 12;
    this.generator.reset(s, this.rng);
    this.speed = SPEED_START;
    this.runTime = 0;
    this.score = 0;
    this.coins = 0;
    this.overTimer = 0;
    this.sideHit = null;
    this.state = 'playing';
    this.input.clear();
    this.audio.whistle();
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.audio.suspend();
    this.ui.showPause();
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'countdown';
    this.countdown = 3;
    this.lastCount = 4;
    this.audio.resume();
    this.input.clear();
  }

  isSimulating() {
    return this.state === 'menu' || this.state === 'playing' || this.state === 'dying';
  }

  multiplier() {
    return this.player.multT > 0 ? 2 : 1;
  }

  // ---------- fixed-step simulation ----------
  step(dt) {
    const p = this.player;
    const actions = this.input.drain();
    if (this.state === 'playing') {
      for (const a of actions) this.handleAction(a);
      this.runTime += dt;
      this.speed = SPEED_START + (SPEED_MAX - SPEED_START) * (1 - Math.exp(-this.runTime / SPEED_TAU));
    } else if (this.state === 'dying') {
      this.speed = 0;
    }

    p.step(dt, this.speed, this.groundFn);
    this.obstacles.step(dt, p.s);

    if (this.state === 'playing') {
      this.collide();
      this.pickups.step(dt, p, this);
      this.score += this.speed * dt * this.multiplier();
      this.generator.update(p.s, this.speed);
    }
    this.chaser.step(dt, p);
    this.handleEvents();

    this.obstacles.cleanup(p.s);
    this.pickups.cleanup(p.s);

    if (this.state === 'dying') {
      this.overTimer += dt;
      if (this.overTimer > 1.6) this.gameOver();
    }
  }

  handleAction(a) {
    const p = this.player;
    if (a === 'left') p.move(-1);
    else if (a === 'right') p.move(1);
    else if (a === 'up') p.jump();
    else if (a === 'down') p.roll();
    else if (a === 'board') this.activateBoard();
  }

  handleEvents() {
    const p = this.player;
    if (this.state !== 'menu') {
      for (const e of p.events) {
        if (e === 'jump') this.audio.jump();
        else if (e === 'bigjump') this.audio.bigJump();
        else if (e === 'roll') this.audio.roll();
        else if (e === 'swipe') this.audio.swipe();
        else if (e === 'bump') { this.audio.bump(); this.shake = Math.max(this.shake, 0.12); }
        else if (e === 'land') { this.audio.land(); this.effects.dust(p.x, p.y, -p.s); }
        else if (e === 'jetpackEnd') this.audio.stopJet();
        else if (e === 'boardEnd') this.ui.toast('Hoverboard worn out');
      }
    }
    p.events.length = 0;
  }

  collide() {
    const p = this.player;
    if (p.invulnT > 0 || p.jetpackT > 0) return;
    const pb = p.box();
    const pp = p.box(true);
    for (const o of this.obstacles.list) {
      if (o.destroyed) continue;
      if (o.s0 > p.s + 2 || o.s0 + o.len < p.s - 2) continue;
      const b = this.obstacles.collider(o);
      if (!overlap(pb, b)) continue;
      if (p.stumbleT > 0 && this.sideHit === o) continue; // still bouncing off the same object
      const bp = this.obstacles.collider(o, true);
      const inS = pp.s0 < bp.s1 && pp.s1 > bp.s0;
      const inX = pp.x0 < bp.x1 && pp.x1 > bp.x0;
      const inY = pp.y0 < bp.y1 && pp.y1 > bp.y0;
      if (inS && inY && !inX) {
        this.sideHit = o;
        this.stumble();
      } else {
        this.hitFront(o, b);
      }
      return;
    }
  }

  stumble() {
    const p = this.player;
    p.stumbleBack();
    this.audio.stumble();
    this.shake = Math.max(this.shake, 0.25);
    if (this.chaser.alertT > 0) {
      this.caught();
      return;
    }
    this.chaser.alert(CHASE_TIME);
    this.audio.whistle();
  }

  hitFront(o, b) {
    const p = this.player;
    if (p.boardT > 0) {
      p.boardT = 0;
      p.invulnT = 1.3;
      this.audio.boardBreak();
      this.shake = 0.35;
      this.effects.burst(p.x, p.y + 0.4, -p.s, 0x6ef0ff, 18);
      if (o.kind === 'train') {
        p.y = o.roof;
        p.vy = 6;
        p.grounded = false;
        p.airTime = 1;
      } else {
        this.obstacles.destroy(o);
        this.effects.burst(o.x, 1.2, -o.s0, 0xffc400, 12);
      }
      this.ui.toast('Board smashed!');
      return;
    }
    this.crash(b);
  }

  stopTrains() {
    for (const t of this.obstacles.list) if (t.moving) t.active = false;
  }

  crash(b) {
    const p = this.player;
    p.dead = true;
    p.deadT = 0;
    p.rollT = 0;
    p.pendingRoll = false;
    if (b.s0 > p.s - 0.5) {
      p.s = Math.min(p.s, b.s0 - 0.4);
      p.prevS = p.s;
    }
    this.state = 'dying';
    this.deathReason = 'crash';
    this.overTimer = 0;
    this.stopTrains();
    this.audio.crash();
    this.audio.stopJet();
    this.shake = 0.6;
    this.chaser.catching = true;
    this.chaser.nearT = 99;
    this.effects.burst(p.x, p.y + 1.1, -p.s, 0xffffff, 10);
  }

  caught() {
    const p = this.player;
    p.dead = true;
    p.caught = true;
    this.state = 'dying';
    this.deathReason = 'caught';
    this.overTimer = 0;
    this.stopTrains();
    this.audio.stopJet();
    this.chaser.catching = true;
    this.chaser.nearT = 99;
    this.audio.whistle();
  }

  gameOver() {
    this.state = 'over';
    const score = Math.floor(this.score);
    this.save.coins += this.coins;
    this.save.runs += 1;
    const newBest = score > this.save.best;
    if (newBest) this.save.best = score;
    writeSave(this.save);
    this.ui.showGameOver({ score, coins: this.coins, best: this.save.best, newBest, reason: this.deathReason, bank: this.save.coins });
  }

  activateBoard() {
    const p = this.player;
    if (this.state !== 'playing' || p.dead || p.boardT > 0) return;
    if (this.save.boards <= 0) {
      this.ui.toast('No hoverboards left — buy more in the shop');
      return;
    }
    this.save.boards -= 1;
    writeSave(this.save);
    p.boardT = HOVERBOARD_TIME;
    this.audio.board();
    this.effects.burst(p.x, p.y + 0.3, -p.s, 0x6ef0ff, 14);
    this.ui.toast('Hoverboard!');
  }

  // ---------- pickups ----------
  onCoin(c) {
    this.coins += 1;
    this.audio.coin();
    this.effects.sparkle(c.x, c.y, -c.s);
  }

  onPowerup(it) {
    const p = this.player;
    const dur = powerupDuration(it.type, this.save.upgrades[it.type] || 0);
    this.powerMax[it.type] = dur;
    if (it.type === 'jetpack') {
      p.jetpackT = dur;
      p.rollT = 0;
      p.pendingRoll = false;
      this.pickups.addSkyTrail(p.s + 16, dur * this.speed * 0.9, p.lane, this.rng);
      this.audio.startJet();
    } else if (it.type === 'sneakers') p.sneakersT = dur;
    else if (it.type === 'magnet') p.magnetT = dur;
    else if (it.type === 'multiplier') p.multT = dur;
    this.audio.powerup();
    this.effects.burst(it.x, it.y + 0.5, -it.s, 0xffffff, 12);
    this.ui.toast(POWERUPS[it.type].label + '!');
  }

  // ---------- per-frame presentation ----------
  render(dt, alpha) {
    this.time += dt;
    if (this.state === 'countdown') {
      this.countdown -= dt;
      const n = Math.ceil(this.countdown);
      if (n !== this.lastCount) {
        this.lastCount = n;
        if (n > 0) this.audio.countdown(false);
        this.ui.showCountdown(n);
      }
      if (this.countdown <= 0) {
        this.state = 'playing';
        this.audio.countdown(true);
        this.ui.showCountdown(0);
      }
    }

    const p = this.player;
    const animDt = this.state === 'paused' || this.state === 'countdown' || this.state === 'over' ? 0 : dt;
    this.obstacles.syncVisuals(alpha);
    p.updateVisual(animDt, alpha, this.time, this.speed, this.groundFn);
    const ps = -p.root.position.z;
    this.chaser.updateVisual(animDt, alpha, ps, this.isSimulating());
    this.pickups.render(this.time, alpha, ps);
    this.effects.update(animDt);
    this.updateCamera(dt);
    // the title camera looks back down the track, so keep more of it behind the runner
    this.world.update(ps, this.camera, lerp(MENU_BEHIND, DESPAWN_BEHIND, this.camB));
    if (this.state !== 'menu') this.ui.updateHud(this);
  }

  updateCamera(dt) {
    const cam = this.camera;
    const p = this.player.root.position;
    const target = this.state === 'menu' ? 0 : 1;
    this.camBlend = damp(this.camBlend, target, 1.8, dt);
    const b = smoothstep(clamp(this.camBlend, 0, 1));
    this.camB = b;
    const flying = this.player.jetpackT > 0;
    const portrait = cam.aspect < 1;

    // gameplay camera: behind and above the runner, lagging slightly on lane changes
    this.camX = damp(this.camX, p.x * 0.85, 9, dt);
    // never skim just above a train roof (e.g. right after dropping off the end of one)
    const roofBelow = this.obstacles.groundAt(cam.position.x, -cam.position.z, 100);
    const minY = roofBelow > 0 ? roofBelow + 1.6 : 0;
    const wantY = Math.max((portrait ? 3.9 : 3.35) + p.y * (flying ? 0.95 : 0.75), minY);
    this.camY = damp(this.camY, wantY, flying ? 3 : 6, dt);

    // title camera: in front of the runner; on wide screens she sits left of the menu
    const menuX = p.x + (portrait ? -0.4 : -0.9);
    const menuLookX = p.x + (portrait ? 0 : -1.75);
    const menuDist = portrait ? 3.9 : 3.5;

    // orbit from the front (theta = PI) round the side to behind (theta = 0)
    const theta = Math.PI * (1 - b);
    const dist = lerp(menuDist, portrait ? 6.3 : 5.9, b);
    const swing = Math.sin(theta);
    this.shake = Math.max(0, this.shake - dt);
    const sh = this.shake * 0.9;
    cam.position.set(
      lerp(menuX, this.camX, b) + swing * 3.2 + (Math.random() - 0.5) * sh,
      lerp(1.3, this.camY, b) + swing * 0.8 + (Math.random() - 0.5) * sh,
      p.z + Math.cos(theta) * dist,
    );
    cam.lookAt(
      lerp(menuLookX, this.camX, b),
      lerp((portrait ? 0.95 : 1.0) + p.y, 1.0 + p.y * 0.62, b),
      p.z - 9 * b,
    );
  }

}
