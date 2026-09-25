import * as THREE from 'three';
import {
  LANES, LANE_HALF, TRAIN_W, TRAIN_H, TRAIN_HALF_COLL, CAR_LEN, CAR_GAP, RAMP_LEN,
  MOVING_TRAIN_SPEED, MOVING_ACTIVATE, BARRIER_HALF_COLL, LOW_BARRIER_H, HIGH_BARRIER_Y0,
  HIGH_BARRIER_Y1, STEP_UP, DESPAWN_BEHIND,
} from './config.js';
import { stripeTexture, radialTexture, canvasTexture } from './assets.js';
import { pick } from './util.js';
import { CLASSIC } from './theme.js';
import { toonMat } from './toon.js';
import { buildToonCars } from './trains_toon.js';

export const trainLength = (cars) => cars * CAR_LEN + (cars - 1) * CAR_GAP;

function wedgeGeometry(w, h, len) {
  // Ramp rising from local z=0 (ground) to z=-len (height h).
  const hw = w / 2;
  const v = [
    // slope
    -hw, 0, 0, hw, 0, 0, hw, h, -len,
    -hw, 0, 0, hw, h, -len, -hw, h, -len,
    // left side
    -hw, 0, 0, -hw, h, -len, -hw, 0, -len,
    // right side
    hw, 0, 0, hw, 0, -len, hw, h, -len,
    // back
    -hw, 0, -len, -hw, h, -len, hw, h, -len,
    -hw, 0, -len, hw, h, -len, hw, 0, -len,
  ];
  const uv = [
    0, 0, 1, 0, 1, 1,
    0, 0, 1, 1, 0, 1,
    0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0,
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.addGroup(0, 6, 0);
  g.addGroup(6, 12, 1);
  g.computeVertexNormals();
  return g;
}

export class Obstacles {
  constructor(scene, assets) {
    this.scene = scene;
    this.list = [];
    const t = assets.textures;
    // Lambert for the textured city look, cel shading for the classic look.
    const mat = CLASSIC ? (params) => toonMat(params) : (params) => new THREE.MeshLambertMaterial(params);

    if (CLASSIC) {
      this.toonCars = buildToonCars();
      this.toonCarMat = toonMat({ vertexColors: true });
    } else {
      const liveries = [
        [t.trainSide, t.trainFront],
        [t.trainSideRed, t.trainFrontRed],
        [t.trainSideGreen, t.trainFrontGreen],
      ];
      const roof = new THREE.MeshLambertMaterial({ color: 0x9aa4ae });
      const bottom = new THREE.MeshLambertMaterial({ color: 0x2b2f36 });
      this.liveries = liveries.map(([side, front]) => {
        side.wrapS = THREE.RepeatWrapping;
        side.repeat.set(2, 1);
        const sideMat = new THREE.MeshLambertMaterial({ map: side });
        const frontMat = new THREE.MeshLambertMaterial({ map: front });
        return [sideMat, sideMat, roof, bottom, frontMat, frontMat];
      });
    }

    const carGeo = new THREE.BoxGeometry(TRAIN_W, TRAIN_H - 0.05, CAR_LEN);
    carGeo.translate(0, (TRAIN_H - 0.05) / 2 + 0.05, -CAR_LEN / 2);
    this.carGeo = carGeo;
    const roofTop = new THREE.BoxGeometry(TRAIN_W * 0.6, 0.18, CAR_LEN * 0.8);
    roofTop.translate(0, TRAIN_H + 0.05, -CAR_LEN / 2);
    this.roofTopGeo = roofTop;
    this.roofTopMat = new THREE.MeshLambertMaterial({ color: 0x7d8792 });
    this.couplerGeo = new THREE.BoxGeometry(1.2, 1.6, CAR_GAP + 0.1);
    this.couplerMat = mat({ color: 0x33373f });

    this.shadowTex = radialTexture('rgba(0,0,0,0.55)', 'rgba(0,0,0,0)', 64);
    this.shadowMat = new THREE.MeshBasicMaterial({ map: this.shadowTex, transparent: true, depthWrite: false });

    // headlight glow for trains that are moving
    this.glowMat = new THREE.SpriteMaterial({
      map: radialTexture('rgba(255,250,210,1)', 'rgba(255,240,160,0)', 64),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });

    // ramp
    const hazard = stripeTexture('#ffcc00', '#222222', 5, 256, 256);
    hazard.wrapS = hazard.wrapT = THREE.RepeatWrapping;
    hazard.repeat.set(1, 3);
    this.rampGeo = wedgeGeometry(TRAIN_W - 0.1, TRAIN_H, RAMP_LEN);
    this.rampMats = [
      mat({ map: hazard }),
      mat({ color: 0x5b6470 }),
    ];

    // barriers
    const redWhite = stripeTexture('#e8322f', '#ffffff', 6);
    const yellowBlack = stripeTexture('#ffc400', '#1f1f1f', 6);
    const post = mat({ color: 0xe9e9e9 });
    const darkPost = mat({ color: 0x4a5563 });
    this.barrierMats = {
      low: mat({ map: redWhite }),
      high: mat({ map: yellowBlack }),
      post,
      darkPost,
      light: new THREE.MeshBasicMaterial({ color: 0xff3b2f }),
    };
    this.signTex = canvasTexture(256, 64, (g, w, h) => {
      g.fillStyle = '#1f3b73';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#ffffff';
      g.font = 'bold 40px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('DUCK!', w / 2, h / 2 + 2);
    });
    this.signMat = new THREE.MeshBasicMaterial({ map: this.signTex });
    this.barrierGeo = {
      lowPanel: new THREE.BoxGeometry(2.3, 0.5, 0.14),
      lowLeg: new THREE.BoxGeometry(0.12, 0.8, 0.12),
      foot: new THREE.BoxGeometry(0.22, 0.08, 0.7),
      highPanel: new THREE.BoxGeometry(2.4, 1.1, 0.16),
      highPost: new THREE.BoxGeometry(0.18, HIGH_BARRIER_Y1, 0.18),
      light: new THREE.SphereGeometry(0.09, 8, 6),
      sign: new THREE.PlaneGeometry(1.2, 0.3),
    };
  }

  // ---------- spawning ----------
  spawnTrain(lane, s0, cars, { moving = false, ramp = false } = {}) {
    const len = trainLength(cars);
    const group = new THREE.Group();
    const mats = CLASSIC ? null : pick(this.liveries);
    const toonCar = CLASSIC ? pick(this.toonCars) : null;
    for (let i = 0; i < cars; i++) {
      const z = -i * (CAR_LEN + CAR_GAP);
      if (CLASSIC) {
        const car = new THREE.Mesh(toonCar, this.toonCarMat);
        car.position.z = z;
        group.add(car);
      } else {
        const car = new THREE.Mesh(this.carGeo, mats);
        car.position.z = z;
        group.add(car);
        const top = new THREE.Mesh(this.roofTopGeo, this.roofTopMat);
        top.position.z = z;
        group.add(top);
      }
      if (i > 0) {
        const c = new THREE.Mesh(this.couplerGeo, this.couplerMat);
        c.position.set(0, 1.0, z + CAR_GAP / 2);
        group.add(c);
      }
    }
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(TRAIN_W + 1.2, len + 1.2), this.shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(0, 0.03, -len / 2);
    group.add(shadow);
    if (moving) {
      for (const x of CLASSIC ? [-0.72, 0.72] : [-0.83, 0.83]) {
        const glow = new THREE.Sprite(this.glowMat);
        glow.position.set(x, CLASSIC ? 1.0 : 1.12, 0.15);
        glow.scale.set(1.6, 1.6, 1);
        group.add(glow);
      }
    }
    if (ramp) {
      const r = new THREE.Mesh(this.rampGeo, this.rampMats);
      r.position.z = RAMP_LEN;
      group.add(r);
    }
    group.position.set(LANES[lane], 0, -s0);
    this.scene.add(group);
    const o = {
      kind: 'train', lane, x: LANES[lane], s0, prevS0: s0, len, cars, roof: TRAIN_H,
      moving, active: false, v: moving ? MOVING_TRAIN_SPEED : 0, ramp, group, destroyed: false,
    };
    this.list.push(o);
    return o;
  }

  spawnBarrier(lane, s, kind) {
    const group = new THREE.Group();
    const g = this.barrierGeo;
    const m = this.barrierMats;
    if (kind === 'low') {
      const panel = new THREE.Mesh(g.lowPanel, m.low);
      panel.position.y = LOW_BARRIER_H - 0.25;
      group.add(panel);
      for (const x of [-0.95, 0.95]) {
        const leg = new THREE.Mesh(g.lowLeg, m.post);
        leg.position.set(x, 0.4, 0);
        const foot = new THREE.Mesh(g.foot, m.darkPost);
        foot.position.set(x, 0.04, 0);
        group.add(leg, foot);
      }
    } else {
      const panel = new THREE.Mesh(g.highPanel, m.high);
      panel.position.y = (HIGH_BARRIER_Y0 + HIGH_BARRIER_Y1) / 2;
      group.add(panel);
      const sign = new THREE.Mesh(g.sign, this.signMat);
      sign.position.set(0, panel.position.y, 0.085);
      group.add(sign);
      for (const x of [-1.15, 1.15]) {
        const p = new THREE.Mesh(g.highPost, m.darkPost);
        p.position.set(x, HIGH_BARRIER_Y1 / 2, 0);
        const light = new THREE.Mesh(g.light, m.light);
        light.position.set(x, HIGH_BARRIER_Y1 + 0.08, 0);
        group.add(p, light);
      }
    }
    group.position.set(LANES[lane], 0, -s);
    this.scene.add(group);
    const o = { kind, lane, x: LANES[lane], s0: s - 0.15, prevS0: s - 0.15, len: 0.3, group, destroyed: false };
    this.list.push(o);
    return o;
  }

  // ---------- simulation ----------
  step(dt, playerS) {
    for (const o of this.list) {
      o.prevS0 = o.s0;
      if (o.moving && !o.destroyed) {
        if (!o.active && o.s0 - playerS < MOVING_ACTIVATE) o.active = true;
        if (o.active) o.s0 -= o.v * dt;
      }
    }
  }

  cleanup(playerS) {
    const keep = [];
    for (const o of this.list) {
      if (o.s0 + o.len < playerS - DESPAWN_BEHIND) {
        this.scene.remove(o.group);
        o.group.traverse((c) => {
          if (c.isMesh && c.material === this.shadowMat) c.geometry.dispose();
        });
      } else keep.push(o);
    }
    this.list = keep;
  }

  clear() {
    for (const o of this.list) this.scene.remove(o.group);
    this.list = [];
  }

  destroy(o) {
    o.destroyed = true;
    o.group.visible = false;
  }

  // Height of the surface the runner is standing on (train roofs and ramps).
  // Surfaces more than STEP_UP above `y` are walls, not floors, and are ignored.
  groundAt(x, s, y) {
    let g = 0;
    for (const o of this.list) {
      if (o.kind !== 'train' || o.destroyed) continue;
      if (Math.abs(x - o.x) > LANE_HALF) continue;
      if (s >= o.s0 && s <= o.s0 + o.len) {
        if (o.roof <= y + STEP_UP && o.roof > g) g = o.roof;
      } else if (o.ramp && s >= o.s0 - RAMP_LEN && s < o.s0) {
        const h = (o.roof * (s - (o.s0 - RAMP_LEN))) / RAMP_LEN;
        if (h <= y + STEP_UP && h > g) g = h;
      }
    }
    return g;
  }

  // Axis-aligned collider for an obstacle, using its current or previous position.
  collider(o, prev = false) {
    const s0 = prev ? o.prevS0 : o.s0;
    if (o.kind === 'train') {
      return { x0: o.x - TRAIN_HALF_COLL, x1: o.x + TRAIN_HALF_COLL, y0: 0, y1: o.roof - 0.4, s0, s1: s0 + o.len };
    }
    if (o.kind === 'low') {
      return { x0: o.x - BARRIER_HALF_COLL, x1: o.x + BARRIER_HALF_COLL, y0: 0, y1: LOW_BARRIER_H, s0, s1: s0 + o.len };
    }
    return { x0: o.x - BARRIER_HALF_COLL, x1: o.x + BARRIER_HALF_COLL, y0: HIGH_BARRIER_Y0, y1: HIGH_BARRIER_Y1, s0, s1: s0 + o.len };
  }

  syncVisuals(alpha) {
    for (const o of this.list) {
      if (o.moving) o.group.position.z = -(o.prevS0 + (o.s0 - o.prevS0) * alpha);
    }
  }
}
