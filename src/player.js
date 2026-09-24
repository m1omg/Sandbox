import * as THREE from 'three';
import {
  LANES, STEP, GRAVITY, JUMP_HEIGHT, SNEAKER_JUMP_HEIGHT, FAST_DROP_SPEED, ROLL_TIME, LATERAL_SPEED,
  JUMP_BUFFER, COYOTE_TIME, PLAYER_HALF_W, PLAYER_HALF_D, PLAYER_H, PLAYER_ROLL_H, JETPACK_ALT,
  SPEED_START,
} from './config.js';
import { prepareCharacter, inPlaceClip, PoseRig } from './character.js';
import { canvasTexture, radialTexture } from './assets.js';
import { makeBlobShadow } from './world.js';
import { damp, lerp, smoothstep } from './util.js';

const PIVOT_H = 0.75;

function boardMesh() {
  const w = 0.64, l = 1.6, r = 0.3;
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2 + r, -l / 2);
  shape.lineTo(w / 2 - r, -l / 2);
  shape.quadraticCurveTo(w / 2, -l / 2, w / 2, -l / 2 + r);
  shape.lineTo(w / 2, l / 2 - r);
  shape.quadraticCurveTo(w / 2, l / 2, w / 2 - r, l / 2);
  shape.lineTo(-w / 2 + r, l / 2);
  shape.quadraticCurveTo(-w / 2, l / 2, -w / 2, l / 2 - r);
  shape.lineTo(-w / 2, -l / 2 + r);
  shape.quadraticCurveTo(-w / 2, -l / 2, -w / 2 + r, -l / 2);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.06, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 2 });
  geo.rotateX(-Math.PI / 2);
  const tex = canvasTexture(128, 256, (g, cw, ch) => {
    const grad = g.createLinearGradient(0, 0, 0, ch);
    grad.addColorStop(0, '#12c2c9');
    grad.addColorStop(1, '#7b3fe4');
    g.fillStyle = grad;
    g.fillRect(0, 0, cw, ch);
    g.fillStyle = '#ffd400';
    g.beginPath();
    g.moveTo(74, 40); g.lineTo(38, 132); g.lineTo(66, 132); g.lineTo(50, 216); g.lineTo(96, 110); g.lineTo(68, 110); g.lineTo(86, 40);
    g.closePath();
    g.fill();
  });
  tex.repeat.set(1 / w, 1 / l);
  tex.offset.set(0.5, 0.5);
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex }));
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: radialTexture('rgba(90,240,255,0.9)', 'rgba(90,240,255,0)', 64),
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  glow.scale.set(1.6, 1.6, 1);
  glow.position.y = -0.05;
  const g = new THREE.Group();
  g.add(glow, mesh);
  return g;
}

function jetpackMesh() {
  const g = new THREE.Group();
  const red = new THREE.MeshLambertMaterial({ color: 0xff4b3e });
  const grey = new THREE.MeshLambertMaterial({ color: 0x3d4450 });
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xffa12b, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const coreMat = new THREE.MeshBasicMaterial({ color: 0xfff3a0, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
  const flames = [];
  for (const x of [-0.13, 0.13]) {
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.5, 12), red);
    tank.position.x = x;
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), red);
    cap.position.set(x, 0.25, 0);
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.12, 10), grey);
    nozzle.position.set(x, -0.31, 0);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.6, 10), flameMat);
    flame.rotation.x = Math.PI;
    flame.position.set(x, -0.66, 0);
    const core = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.35, 8), coreMat);
    core.rotation.x = Math.PI;
    core.position.set(x, -0.52, 0);
    g.add(tank, cap, nozzle, flame, core);
    flames.push(flame, core);
  }
  g.userData.flames = flames;
  return g;
}

export class Player {
  constructor(scene, gltf) {
    this.scene = scene;
    this.root = new THREE.Group();
    this.pivot = new THREE.Group();
    this.pivot.position.y = PIVOT_H;
    this.holder = new THREE.Group();
    this.holder.position.y = -PIVOT_H;
    this.root.add(this.pivot);
    this.pivot.add(this.holder);

    this.model = gltf.scene;
    prepareCharacter(this.model);
    this.model.rotation.y = Math.PI; // the model faces +z; the runner heads toward -z
    this.holder.add(this.model);

    this.rig = new PoseRig(this.model);
    // Poses are expressed as rotations in the character's space: +x is the sideways axis,
    // positive angles tip "up" toward the facing direction.
    this.rig.define('jump', [
      ['Spine01', 'x', 0.15],
      ['LeftUpLeg', 'x', -1.25], ['LeftLeg', 'x', 1.7],
      ['RightUpLeg', 'x', 0.35], ['RightLeg', 'x', 1.3],
      ['RightArm', 'x', -1.2], ['LeftArm', 'x', 0.55],
    ]);
    this.rig.define('tuck', [
      ['Spine02', 'x', 0.35], ['Spine01', 'x', 0.35], ['Spine', 'x', 0.3], ['neck', 'x', 0.35],
      ['LeftUpLeg', 'x', -2.1], ['RightUpLeg', 'x', -2.1], ['LeftLeg', 'x', 2.5], ['RightLeg', 'x', 2.5],
      ['LeftArm', 'x', -1.3], ['RightArm', 'x', -1.3], ['LeftForeArm', 'x', -0.9], ['RightForeArm', 'x', -0.9],
    ]);
    this.rig.define('surf', [
      ['Spine01', 'x', 0.15],
      ['LeftUpLeg', 'x', -0.45], ['RightUpLeg', 'x', -0.45], ['LeftLeg', 'x', 0.85], ['RightLeg', 'x', 0.85],
    ]);
    this.rig.define('fly', [
      ['LeftUpLeg', 'x', 0.2], ['RightUpLeg', 'x', -0.1], ['LeftLeg', 'x', 0.6], ['RightLeg', 'x', 0.35],
    ]);
    this.rig.define('crash', [
      ['Spine01', 'x', -0.25], ['neck', 'x', -0.3],
      ['LeftArm', 'x', -2.3], ['RightArm', 'x', -2.1],
      ['LeftUpLeg', 'x', -0.6], ['RightUpLeg', 'x', -0.3], ['LeftLeg', 'x', 0.5],
    ]);

    this.mixer = new THREE.AnimationMixer(this.model);
    this.run = this.mixer.clipAction(inPlaceClip(gltf.animations[0]));
    this.run.play();

    this.board = boardMesh();
    this.board.position.y = -PIVOT_H + 0.12;
    this.board.visible = false;
    this.pivot.add(this.board);

    this.jetpack = jetpackMesh();
    this.jetpack.position.set(0, 1.05, 0.24);
    this.jetpack.visible = false;
    this.holder.add(this.jetpack);

    this.shadow = makeBlobShadow(1.3, 0.4);
    scene.add(this.root, this.shadow);

    this.lean = 0;
    this.yaw = 0;
    this.lift = 0;
    this.spin = 0;
    this.reset(0);
  }

  reset(s) {
    this.x = 0; this.y = 0; this.s = s; this.vy = 0;
    this.prevX = 0; this.prevY = 0; this.prevS = s; this.prevH = PLAYER_H;
    this.lane = 1; this.prevLane = 1;
    this.grounded = true; this.airTime = 0;
    this.rollT = 0; this.pendingRoll = false; this.jumpBuffer = 0;
    this.boardT = 0; this.invulnT = 0;
    this.jetpackT = 0; this.sneakersT = 0; this.magnetT = 0; this.multT = 0;
    this.stumbleT = 0; this.dead = false; this.deadT = 0; this.caught = false;
    this.events = [];
    this.pivot.rotation.set(0, 0, 0);
    for (const k of Object.keys(this.rig.weights)) this.rig.weights[k] = 0;
    this.mixer.timeScale = 1;
  }

  height() {
    return this.rollT > 0 || this.pendingRoll ? PLAYER_ROLL_H : PLAYER_H;
  }

  box(prev = false) {
    const x = prev ? this.prevX : this.x;
    const y = prev ? this.prevY : this.y;
    const s = prev ? this.prevS : this.s;
    const h = prev ? this.prevH : this.height();
    return { x0: x - PLAYER_HALF_W, x1: x + PLAYER_HALF_W, y0: y, y1: y + h, s0: s - PLAYER_HALF_D, s1: s + PLAYER_HALF_D };
  }

  emit(e) {
    this.events.push(e);
  }

  // ---------- actions ----------
  move(dir) {
    if (this.dead) return;
    const target = this.lane + dir;
    if (target < 0 || target > 2) {
      this.emit('bump');
      return;
    }
    this.prevLane = this.lane;
    this.lane = target;
    this.emit('swipe');
  }

  jump() {
    if (this.dead || this.jetpackT > 0) return;
    if (this.grounded || (this.airTime < COYOTE_TIME && this.vy <= 0)) this.doJump();
    else this.jumpBuffer = JUMP_BUFFER;
  }

  doJump() {
    const big = this.sneakersT > 0;
    const h = big ? SNEAKER_JUMP_HEIGHT : JUMP_HEIGHT;
    this.vy = Math.sqrt(2 * GRAVITY * h);
    this.grounded = false;
    this.airTime = COYOTE_TIME;
    this.rollT = 0;
    this.pendingRoll = false;
    this.jumpBuffer = 0;
    this.emit(big ? 'bigjump' : 'jump');
  }

  roll() {
    if (this.dead || this.jetpackT > 0) return;
    if (this.grounded) {
      this.rollT = ROLL_TIME;
    } else {
      this.vy = Math.min(this.vy, -FAST_DROP_SPEED);
      this.pendingRoll = true;
      this.jumpBuffer = 0;
    }
    this.emit('roll');
  }

  stumbleBack() {
    this.lane = this.prevLane;
    this.stumbleT = 0.5;
  }

  // ---------- simulation (fixed step) ----------
  step(dt, speed, ground) {
    this.prevX = this.x; this.prevY = this.y; this.prevS = this.s; this.prevH = this.height();

    this.rollT = Math.max(0, this.rollT - dt);
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    this.invulnT = Math.max(0, this.invulnT - dt);
    this.stumbleT = Math.max(0, this.stumbleT - dt);
    this.sneakersT = Math.max(0, this.sneakersT - dt);
    this.magnetT = Math.max(0, this.magnetT - dt);
    this.multT = Math.max(0, this.multT - dt);
    if (this.boardT > 0) {
      this.boardT = Math.max(0, this.boardT - dt);
      if (this.boardT === 0) this.emit('boardEnd');
    }
    if (this.dead) this.deadT += dt;

    this.s += speed * dt;

    // lateral: slide toward the target lane at a constant speed
    const dx = LANES[this.lane] - this.x;
    const maxStep = LATERAL_SPEED * dt;
    this.x += Math.abs(dx) <= maxStep ? dx : Math.sign(dx) * maxStep;

    if (this.jetpackT > 0) {
      this.grounded = false;
      this.vy = 0;
      this.y = damp(this.y, JETPACK_ALT, 3.2, dt);
      this.jetpackT = Math.max(0, this.jetpackT - dt);
      if (this.jetpackT === 0) {
        this.invulnT = Math.max(this.invulnT, 1.8);
        this.airTime = 1;
        this.emit('jetpackEnd');
      }
      return;
    }

    if (this.grounded) {
      const g = ground(this.x, this.s, this.y);
      if (g < this.y - 0.05) {
        this.grounded = false;
        this.vy = 0;
        this.airTime = 0;
      } else {
        this.y = g;
      }
    }
    if (!this.grounded) {
      this.airTime += dt;
      this.vy -= GRAVITY * dt;
      this.y += this.vy * dt;
      const g = ground(this.x, this.s, Math.max(this.prevY, this.y));
      if (this.vy <= 0 && this.y <= g) {
        this.y = g;
        this.vy = 0;
        this.grounded = true;
        this.emit('land');
        if (this.pendingRoll) {
          this.pendingRoll = false;
          this.rollT = ROLL_TIME;
        }
        if (this.jumpBuffer > 0) this.doJump();
      }
    }
  }

  // ---------- visuals (per rendered frame) ----------
  updateVisual(dt, alpha, time, speed, groundAtRender) {
    const x = lerp(this.prevX, this.x, alpha);
    const y = lerp(this.prevY, this.y, alpha);
    const s = lerp(this.prevS, this.s, alpha);
    this.root.position.set(x, y, -s);
    this.renderPos = this.root.position;

    const vx = (this.x - this.prevX) / STEP;
    this.lean = damp(this.lean, this.dead ? 0 : -vx * 0.02, 14, dt);

    // choose the pose layered on top of the run cycle
    let target = null;
    if (this.dead) target = this.caught ? null : 'crash';
    else if (this.jetpackT > 0) target = 'fly';
    else if (this.rollT > 0 || this.pendingRoll) target = 'tuck';
    else if (this.boardT > 0) target = 'surf';
    else if (!this.grounded && this.airTime > 0.04) target = 'jump';
    for (const k of Object.keys(this.rig.weights)) {
      this.rig.weights[k] = damp(this.rig.weights[k], k === target ? 1 : 0, target === 'tuck' || k === 'tuck' ? 26 : 16, dt);
    }

    // body pivot: forward roll, lean, crash fall
    let pitch = 0;
    if (this.dead && !this.caught) pitch = Math.min(1, this.deadT / 0.35) * 1.35;
    else if (this.rollT > 0) pitch = -Math.PI * 2 * smoothstep(1 - this.rollT / 0.62);
    else if (this.jetpackT > 0) pitch = -0.35;
    else if (!this.grounded && this.boardT <= 0) pitch = -0.12;
    this.pivot.rotation.x = this.rollT > 0 || (this.dead && !this.caught) ? pitch : damp(this.pivot.rotation.x, pitch, 12, dt);
    const wobble = this.stumbleT > 0 ? Math.sin(time * 40) * 0.25 * (this.stumbleT / 0.5) : 0;
    this.pivot.rotation.z = this.lean + wobble;

    const onBoard = this.boardT > 0 && !this.dead;
    this.yaw = damp(this.yaw, onBoard && this.jetpackT <= 0 ? 1.3 : 0, 12, dt);
    this.holder.rotation.y = this.yaw;
    const tuck = this.rig.weights.tuck;
    this.lift = damp(this.lift, onBoard && this.jetpackT <= 0 ? 0.2 : 0, 12, dt);
    this.holder.position.y = -PIVOT_H + this.lift - tuck * 0.3;

    this.board.visible = onBoard && this.jetpackT <= 0;
    if (this.board.visible) {
      if (!this.grounded) this.spin += dt * 11;
      else this.spin = 0;
      this.board.rotation.z = Math.min(this.spin, Math.PI * 2);
      this.board.position.y = -PIVOT_H + 0.1 + Math.sin(time * 6) * 0.03;
    }

    this.jetpack.visible = this.jetpackT > 0;
    if (this.jetpack.visible) {
      for (const f of this.jetpack.userData.flames) f.scale.y = 0.75 + Math.abs(Math.sin(time * 47 + f.id)) * 0.5;
    }

    this.mixer.timeScale = this.dead ? 0 : 0.95 + Math.max(0, speed - SPEED_START) / 34;
    this.mixer.update(dt);
    this.rig.apply();

    this.model.visible = !(this.invulnT > 0 && !this.dead && Math.floor(time * 14) % 2 === 0);

    const gy = groundAtRender(x, s, y);
    const above = Math.max(0, y - gy);
    this.shadow.position.set(x, gy + 0.04, -s);
    const k = 1 / (1 + above * 0.35);
    this.shadow.scale.setScalar(k);
    this.shadow.material.opacity = 0.4 * k;
  }
}
