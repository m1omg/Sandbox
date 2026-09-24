import * as THREE from 'three';
import { LANES, JETPACK_ALT, FOG_FAR, PLAYER_H } from './config.js';
import { canvasTexture, radialTexture } from './assets.js';

const COIN_CAP = 600;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _up = new THREE.Vector3(0, 1, 0);

function coinFaceTexture() {
  return canvasTexture(128, 128, (g, w) => {
    const c = w / 2;
    const grad = g.createRadialGradient(c * 0.8, c * 0.7, 4, c, c, c);
    grad.addColorStop(0, '#fff6b0');
    grad.addColorStop(0.55, '#ffcc22');
    grad.addColorStop(1, '#d88a00');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, w);
    g.strokeStyle = '#b86f00';
    g.lineWidth = 8;
    g.beginPath();
    g.arc(c, c, c - 14, 0, Math.PI * 2);
    g.stroke();
    // star emblem
    g.fillStyle = '#fff3a0';
    g.strokeStyle = '#c47a00';
    g.lineWidth = 4;
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? 30 : 13;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      g.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r);
    }
    g.closePath();
    g.fill();
    g.stroke();
  });
}

function labelTexture(text, fill, stroke) {
  return canvasTexture(128, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.font = '900 72px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 12;
    g.strokeStyle = stroke;
    g.strokeText(text, w / 2, h / 2 + 4);
    g.fillStyle = fill;
    g.fillText(text, w / 2, h / 2 + 4);
  });
}

export class Pickups {
  constructor(scene) {
    this.scene = scene;
    this.coins = [];
    this.items = [];

    const geo = new THREE.CylinderGeometry(0.42, 0.42, 0.1, 24);
    geo.rotateX(Math.PI / 2);
    const side = new THREE.MeshPhongMaterial({ color: 0xffb300, emissive: 0x6a4200, specular: 0xffffff, shininess: 80 });
    const face = new THREE.MeshPhongMaterial({ map: coinFaceTexture(), emissive: 0x4a3000, specular: 0xffffff, shininess: 60 });
    this.coinMesh = new THREE.InstancedMesh(geo, [side, face, face], COIN_CAP);
    this.coinMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.coinMesh.count = 0;
    this.coinMesh.frustumCulled = false;
    scene.add(this.coinMesh);

    this.buildItemTemplates();
  }

  buildItemTemplates() {
    const lambert = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });
    const t = {};

    // Jetpack: twin tanks
    {
      const g = new THREE.Group();
      const tank = new THREE.CylinderGeometry(0.14, 0.14, 0.55, 14);
      const cap = new THREE.SphereGeometry(0.14, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
      const nozzle = new THREE.CylinderGeometry(0.07, 0.11, 0.14, 10);
      const red = lambert(0xff4b3e);
      const grey = lambert(0x3d4450);
      for (const x of [-0.16, 0.16]) {
        const m = new THREE.Mesh(tank, red);
        m.position.x = x;
        const c = new THREE.Mesh(cap, red);
        c.position.set(x, 0.275, 0);
        const n = new THREE.Mesh(nozzle, grey);
        n.position.set(x, -0.34, 0);
        g.add(m, c, n);
      }
      const strap = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.2), grey);
      strap.position.y = 0.1;
      g.add(strap);
      t.jetpack = g;
    }
    // Spring sneakers
    {
      const g = new THREE.Group();
      const sole = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.09, 0.62), lambert(0xffffff));
      sole.position.y = -0.05;
      const upper = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.24, 0.42), lambert(0x5fd64b));
      upper.position.set(0, 0.11, 0.08);
      const toe = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 8), lambert(0x5fd64b));
      toe.scale.set(0.95, 0.6, 1);
      toe.position.set(0, 0.03, -0.17);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.29, 0.06, 0.3), lambert(0xff9f1a));
      stripe.position.set(0, 0.13, 0.08);
      g.add(sole, upper, toe, stripe);
      const springMat = lambert(0xc7ced6);
      for (let i = 0; i < 3; i++) {
        const coil = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.025, 6, 14), springMat);
        coil.rotation.x = Math.PI / 2;
        coil.position.set(0, -0.14 - i * 0.07, 0.05);
        g.add(coil);
      }
      g.position.y = 0.15;
      const wrap = new THREE.Group();
      wrap.add(g);
      t.sneakers = wrap;
    }
    // Magnet
    {
      const g = new THREE.Group();
      const arc = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.11, 10, 20, Math.PI), lambert(0xff2d55));
      arc.rotation.z = 0;
      arc.position.y = 0.05;
      g.add(arc);
      for (const x of [-0.28, 0.28]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.22), lambert(0xff2d55));
        leg.position.set(x, -0.06, 0);
        const tip = new THREE.Mesh(new THREE.BoxGeometry(0.23, 0.14, 0.23), lambert(0xe6ebf0));
        tip.position.set(x, -0.24, 0);
        g.add(leg, tip);
      }
      t.magnet = g;
    }
    // 2x multiplier
    {
      const g = new THREE.Group();
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture('2x', '#ffd21f', '#8a3b00') }));
      sprite.scale.set(1.0, 1.0, 1);
      g.add(sprite);
      t.multiplier = g;
    }
    this.templates = t;
    this.glowMats = {
      jetpack: this.glowMat('rgba(255,120,90,0.9)'),
      sneakers: this.glowMat('rgba(120,255,110,0.9)'),
      magnet: this.glowMat('rgba(255,90,150,0.9)'),
      multiplier: this.glowMat('rgba(255,210,60,0.9)'),
    };
  }

  glowMat(color) {
    return new THREE.SpriteMaterial({
      map: radialTexture(color, 'rgba(255,255,255,0)', 64),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
  }

  // ---------- spawning ----------
  addCoin(x, y, s) {
    this.coins.push({ x, y, s, px: x, py: y, ps: s, magnet: false, alive: true });
  }

  addCoinLine(lane, s0, count, spacing = 1.7, heightFn = null, baseY = 0.9) {
    for (let i = 0; i < count; i++) {
      const s = s0 + i * spacing;
      const y = heightFn ? heightFn(s) : baseY;
      this.addCoin(LANES[lane], y, s);
    }
    return s0 + (count - 1) * spacing;
  }

  // A trail of coins at jetpack altitude that weaves between lanes.
  addSkyTrail(s0, length, startLane, rng) {
    let lane = startLane;
    let s = s0;
    const y = JETPACK_ALT + 0.7;
    while (s < s0 + length) {
      const n = rng.randInt(10, 17);
      for (let i = 0; i < n && s < s0 + length; i++, s += 2.2) this.addCoin(LANES[lane], y, s);
      const options = [lane - 1, lane + 1].filter((l) => l >= 0 && l <= 2);
      lane = rng.pick(options);
      s += 2;
    }
  }

  addPowerup(type, x, y, s) {
    const group = new THREE.Group();
    const model = this.templates[type].clone();
    const glow = new THREE.Sprite(this.glowMats[type]);
    glow.scale.set(1.9, 1.9, 1);
    group.add(glow, model);
    group.position.set(x, y + 0.2, -s);
    this.scene.add(group);
    this.items.push({ type, x, y, s, group, model, alive: true, phase: Math.random() * 6 });
  }

  // ---------- simulation ----------
  step(dt, player, game) {
    const px = player.x;
    const py = player.y + player.height() * 0.55;
    const ps = player.s;
    const h = player.height();
    const magnet = player.magnetT > 0;
    const pull = Math.max(26, game.speed + 16) * dt;

    for (const c of this.coins) {
      if (!c.alive) continue;
      c.px = c.x; c.py = c.y; c.ps = c.s;
      if (magnet && !c.magnet && c.s > ps - 3 && c.s < ps + 24 && c.y < player.y + 6) c.magnet = true;
      if (c.magnet) {
        const dx = px - c.x;
        const dy = py - c.y;
        const ds = ps - c.s;
        const d = Math.hypot(dx, dy, ds);
        if (d <= pull + 0.3) {
          c.alive = false;
          game.onCoin(c);
          continue;
        }
        const k = pull / d;
        c.x += dx * k;
        c.y += dy * k;
        c.s += ds * k;
        continue;
      }
      if (Math.abs(c.s - ps) < 0.9 && Math.abs(c.x - px) < 0.85 && c.y > player.y - 0.4 && c.y < player.y + h + 0.5) {
        c.alive = false;
        game.onCoin(c);
      }
    }

    for (const it of this.items) {
      if (!it.alive) continue;
      if (Math.abs(it.s - ps) < 1.1 && Math.abs(it.x - px) < 1.0 && it.y > player.y - 0.6 && it.y < player.y + h + 0.6) {
        it.alive = false;
        this.scene.remove(it.group);
        game.onPowerup(it);
      }
    }
  }

  cleanup(playerS) {
    this.coins = this.coins.filter((c) => c.alive && (c.magnet || c.s > playerS - 8));
    const keep = [];
    for (const it of this.items) {
      if (it.alive && it.s > playerS - 10) keep.push(it);
      else if (it.alive) this.scene.remove(it.group);
    }
    this.items = keep;
  }

  clear() {
    this.coins = [];
    for (const it of this.items) this.scene.remove(it.group);
    this.items = [];
    this.coinMesh.count = 0;
  }

  removeCoins(x, s0, s1) {
    for (const c of this.coins) {
      if (c.alive && Math.abs(c.x - x) < 0.1 && c.s >= s0 && c.s <= s1 && c.y < 4) c.alive = false;
    }
  }

  render(time, alpha, viewS) {
    _q.setFromAxisAngle(_up, time * 4.5);
    let n = 0;
    for (const c of this.coins) {
      if (!c.alive || n >= COIN_CAP) continue;
      if (c.s > viewS + FOG_FAR) continue;
      _p.set(c.px + (c.x - c.px) * alpha, c.py + (c.y - c.py) * alpha, -(c.ps + (c.s - c.ps) * alpha));
      _m.compose(_p, _q, _s);
      this.coinMesh.setMatrixAt(n++, _m);
    }
    this.coinMesh.count = n;
    this.coinMesh.instanceMatrix.needsUpdate = true;

    for (const it of this.items) {
      it.model.rotation.y = time * 2.2 + it.phase;
      it.group.position.y = it.y + 0.25 + Math.sin(time * 3 + it.phase) * 0.12;
    }
  }
}

export const COIN_Y = 0.9;
export const PLAYER_CHEST = PLAYER_H * 0.55;
