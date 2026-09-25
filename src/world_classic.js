import * as THREE from 'three';
import { LANES, SPAWN_AHEAD, DESPAWN_BEHIND, FOG_NEAR, FOG_FAR } from './config.js';
import { canvasTexture } from './assets.js';
import { MENU_BEHIND } from './world.js';
import { Pieces, toonMat, shade } from './toon.js';
import { rand, chance, pick } from './util.js';

// "Classic" look: a bright, cel-shaded rail line with overhead wires, arched retaining
// walls, avenues of round trees and rows of gabled houses. Everything is built from
// simple coloured primitives merged into a few vertex-coloured meshes per segment.

const SEG = 42;
const SEG_COUNT = Math.ceil((MENU_BEHIND + SPAWN_AHEAD) / SEG);
const BED_X = 4.4;                // half width of the sandy track bed
const GANTRY_Z = [-10.5, -31.5];  // overhead-line portals within a segment
const MODULES_PER_KIND = 4;

const C = {
  dirt: '#d2ad76',
  dirtDark: '#bf9862',
  sleeper: '#7d5433',
  rail: '#4f5a68',
  railTop: '#d9e1e8',
  grass: '#7cc444',
  grassDark: '#63ad37',
  wall: '#e4572e',
  wallArch: '#a93b1c',
  wallTop: '#f27b4d',
  pole: '#3e4756',
  wire: '#1c2026',
  trunk: '#8a5a35',
  fence: '#f4f1ea',
  signalPole: '#ffffff',
  signalBand: '#e0342b',
  signalHead: '#2a2f38',
  red: '#ff4a3d',
  green: '#38e068',
};
const GREENS = ['#5cb83a', '#7ccc4a', '#4fa33a', '#93d657', '#6abf45'];
const HOUSE = ['#f2c14e', '#4f86c6', '#e06c5a', '#7bc6a4', '#b48fd6', '#f29e4c', '#5fb3d9', '#f4e3b5'];
const ROOF = ['#b5452f', '#5b4a8a', '#3f6d8e', '#8f3b2a', '#c0612f'];

function skyTexture() {
  return canvasTexture(4, 256, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#1f8fe0');
    grad.addColorStop(0.5, '#6cc2f2');
    grad.addColorStop(0.62, '#bfe6fb');
    grad.addColorStop(1, '#e3f5ff');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  });
}

// Arch-shaped panel in the x/y plane (width w, straight sides up to h, round top).
function archShape(w, h) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(w / 2, 0);
  s.lineTo(w / 2, h);
  s.absarc(0, h, w / 2, 0, Math.PI, false);
  s.lineTo(-w / 2, 0);
  return s;
}

// Gable roof: triangle across x (width w, height h) extruded along z (length d).
function gableRoof(w, h, d) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(w / 2, 0);
  s.lineTo(0, h);
  s.lineTo(-w / 2, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false });
  g.translate(0, 0, -d / 2);
  return g;
}

export class ClassicWorld {
  constructor(scene) {
    this.scene = scene;
    scene.background = skyTexture();
    scene.fog = new THREE.Fog(0xcdebfa, FOG_NEAR, FOG_FAR);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x9bbf7a, 1.55));
    this.sun = new THREE.DirectionalLight(0xffffff, 1.7);
    scene.add(this.sun, this.sun.target);

    this.mat = toonMat({ vertexColors: true });
    this.staticGeo = this.buildStatic();
    this.modules = { arches: [[], []], trees: [[], []], houses: [[], []] };
    for (const kind of Object.keys(this.modules)) {
      for (const [i, side] of [[0, -1], [1, 1]]) {
        for (let k = 0; k < MODULES_PER_KIND; k++) this.modules[kind][i].push(this.buildModule(kind, side));
      }
    }

    this.segments = [];
    for (let i = 0; i < SEG_COUNT; i++) this.segments.push(this.makeSegment());
    this.lastKind = ['trees', 'arches'];

    this.farGround = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshBasicMaterial({ color: 0x8fd16a }));
    this.farGround.rotation.x = -Math.PI / 2;
    this.farGround.position.y = -0.3;
    scene.add(this.farGround);

    this.reset(0, MENU_BEHIND);
  }

  // Track bed, sleepers, rails, grass and the overhead line: identical in every segment.
  buildStatic() {
    const p = new Pieces();
    const bed = new THREE.PlaneGeometry(BED_X * 2, SEG);
    bed.rotateX(-Math.PI / 2);
    bed.translate(0, -0.02, -SEG / 2);
    p.add(bed, C.dirt);
    for (const side of [-1, 1]) {
      const grass = new THREE.PlaneGeometry(30, SEG);
      grass.rotateX(-Math.PI / 2);
      grass.translate(side * (BED_X + 15), 0, -SEG / 2);
      p.add(grass, C.grass);
      p.box(0.25, 0.12, SEG, side * (BED_X - 0.1), 0.05, -SEG / 2, C.grassDark);
    }
    for (const lx of LANES) {
      for (let i = 0; i < 30; i++) p.box(2.7, 0.16, 0.55, lx, 0.07, -(i + 0.5) * (SEG / 30), C.sleeper);
      for (const rx of [-0.72, 0.72]) {
        p.box(0.16, 0.2, SEG, lx + rx, 0.24, -SEG / 2, C.rail);
        p.box(0.1, 0.03, SEG, lx + rx, 0.355, -SEG / 2, C.railTop);
      }
      // dark strip between the rails, like a worn track bed
      p.box(1.2, 0.01, SEG, lx, 0.005, -SEG / 2, C.dirtDark);
    }

    // overhead line: portal gantries, contact wires and sagging catenary wires
    for (const z of GANTRY_Z) {
      for (const side of [-1, 1]) {
        p.cyl(0.14, 0.18, 10.6, side * 5.4, 5.3, z, C.pole);
        p.box(0.5, 0.25, 0.5, side * 5.4, 0.12, z, C.pole);
      }
      p.box(11.2, 0.3, 0.3, 0, 10.5, z, C.pole);
      p.box(11.2, 0.12, 0.12, 0, 10.0, z, C.pole);
      for (const lx of LANES) {
        p.cyl(0.035, 0.035, 0.8, lx, 9.95, z, C.wire, 5);
        p.cyl(0.07, 0.07, 0.22, lx, 10.25, z, '#6b7684', 8);
      }
    }
    for (const lx of LANES) {
      p.box(0.05, 0.05, SEG, lx, 9.55, -SEG / 2, C.wire);
      const pts = [];
      for (let i = 0; i <= 28; i++) {
        const z = -(i / 28) * SEG;
        pts.push(new THREE.Vector3(lx, 9.85 + 0.35 * Math.abs(Math.cos((Math.PI * (z + 10.5)) / 21)), z));
      }
      p.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 56, 0.035, 4, false), C.wire);
      // droppers between the catenary and the contact wire
      for (let z = -3.5; z > -SEG; z -= 7) p.cyl(0.015, 0.015, 0.45, lx, 9.78, z, C.wire, 4);
    }
    return p.build();
  }

  // Scenery for one side of one segment. side: -1 left, +1 right.
  buildModule(kind, side) {
    const p = new Pieces();
    const sx = (x) => side * x;

    const tree = (x, z, scale = 1) => {
      const h = rand(2.4, 3.4) * scale;
      p.cyl(0.25 * scale, 0.35 * scale, h, x, h / 2, z, C.trunk, 7);
      const r = rand(1.8, 2.5) * scale;
      const col = pick(GREENS);
      p.blob(r, x, h + r * 0.7, z, col);
      for (let k = 0; k < 3; k++) {
        p.blob(r * rand(0.55, 0.75), x + rand(-1.2, 1.2) * scale, h + r * rand(0.4, 1.3), z + rand(-1.2, 1.2) * scale, pick(GREENS));
      }
    };

    const hedge = (x0, x1, y, zStep = 2.2) => {
      for (let z = -rand(0, 1.5); z > -SEG; z -= rand(zStep * 0.7, zStep * 1.3)) {
        p.blob(rand(0.8, 1.25), sx(rand(x0, x1)), y + rand(0.4, 0.7), z, pick(GREENS), 0.85);
      }
    };

    const house = (xNear, z0, w, tall) => {
      const depth = rand(5, 6.5);
      const h = tall ? rand(6.5, 9.5) : rand(4.2, 6.5);
      const col = pick(HOUSE);
      const xc = sx(xNear + depth / 2);
      const zc = z0 - w / 2;
      p.box(depth, h, w, xc, h / 2, zc, col);
      const roof = gableRoof(depth + 0.8, rand(1.8, 2.6), w + 0.5);
      roof.translate(xc, h, zc);
      p.add(roof, pick(ROOF));
      // windows and door on the side facing the tracks
      const face = sx(xNear) - side * 0.02;
      const floors = Math.max(1, Math.floor((h - 0.6) / 2.4));
      const cols = w > 5.5 ? 3 : 2;
      for (let f = 0; f < floors; f++) {
        for (let c = 0; c < cols; c++) {
          if (f === 0 && c === 0) continue;
          const z = z0 - ((c + 0.5) * w) / cols;
          const y = 1.5 + f * 2.4;
          p.box(0.06, 1.3, 1.1, face, y, z, '#ffffff');
          p.box(0.08, 1.05, 0.85, face - side * 0.02, y, z, '#2f5d8a');
        }
      }
      p.box(0.08, 1.9, 1.0, face - side * 0.01, 0.95, z0 - (0.5 * w) / cols, shade(col, 0.55));
    };

    const signal = () => {
      const z = pick([-3, -21, -24, -39]);
      const x = sx(4.95);
      for (let k = 0; k < 6; k++) p.cyl(0.08, 0.08, 0.7, x, 0.35 + k * 0.7, z, k % 2 ? C.signalBand : C.signalPole, 8);
      p.box(0.5, 1.1, 0.4, x, 4.6, z, C.signalHead);
      p.box(0.62, 0.1, 0.5, x, 5.2, z, C.signalHead);
      p.blob(0.14, x, 4.88, z + 0.22, C.red, 1, 1);
      p.blob(0.14, x, 4.32, z + 0.22, C.green, 1, 1);
    };

    if (kind === 'arches') {
      const wx = 7.9;
      const face = wx - 0.7;
      p.box(1.4, 5.2, SEG, sx(wx), 2.6, -SEG / 2, C.wall);
      const cap = new THREE.CylinderGeometry(0.75, 0.75, SEG, 12);
      cap.rotateX(Math.PI / 2);
      cap.translate(sx(wx), 5.2, -SEG / 2);
      p.add(cap, C.wallTop);
      for (let k = 0; k < 8; k++) {
        const z = -(k + 0.5) * (SEG / 8);
        const a = new THREE.ShapeGeometry(archShape(3.2, 2.7), 10);
        a.rotateY(side < 0 ? Math.PI / 2 : -Math.PI / 2);
        a.translate(sx(face) - side * 0.02, 0, z);
        p.add(a, C.wallArch);
      }
      hedge(wx - 0.4, wx + 0.4, 5.3, 2.6);
      hedge(6.0, 6.6, 0, 3.5);
      for (let z = -rand(1, 5); z > -SEG; z -= rand(5, 8)) tree(sx(rand(10, 12.5)), z, 1.1);
      for (let z = -rand(0, 6); z > -SEG + 3; z -= rand(8, 11)) house(rand(15, 18), z, rand(5, 7), true);
    } else if (kind === 'trees') {
      hedge(6.1, 7.2, 0, 1.8);
      for (let z = -rand(0.5, 3); z > -SEG; z -= rand(3.2, 4.6)) tree(sx(rand(7.8, 9.5)), z, rand(1.1, 1.35));
      for (let z = -rand(1, 4); z > -SEG; z -= rand(4, 6)) tree(sx(rand(11, 14)), z, rand(1.2, 1.5));
      for (let z = -rand(0, 6); z > -SEG + 3; z -= rand(9, 13)) house(rand(17, 20), z, rand(5, 7), true);
    } else {
      // picket fence, front gardens and a row of gabled houses
      for (let z = 0; z > -SEG; z -= 0.8) p.box(0.1, 1.0, 0.12, sx(6.7), 0.5, z - 0.4, C.fence);
      p.box(0.08, 0.1, SEG, sx(6.7), 0.75, -SEG / 2, C.fence);
      p.box(0.08, 0.1, SEG, sx(6.7), 0.4, -SEG / 2, C.fence);
      let z = -rand(0, 1);
      while (z > -SEG + 4) {
        const w = rand(5, 7);
        house(rand(8.6, 9.6), z, Math.min(w, z + SEG), false);
        if (chance(0.5)) p.blob(rand(0.7, 1), sx(rand(7.2, 8)), 0.6, z - w / 2, pick(GREENS), 0.8);
        z -= w + rand(0.3, 1.5);
      }
      for (let zz = -rand(0, 4); zz > -SEG; zz -= rand(6, 9)) tree(sx(rand(15, 18)), zz, 1.3);
      for (let zz = -rand(0, 6); zz > -SEG + 3; zz -= rand(9, 13)) house(rand(20, 23), zz, rand(5, 7), true);
    }
    if (chance(0.5)) signal();
    return p.build();
  }

  makeSegment() {
    const g = new THREE.Group();
    const add = (geo) => {
      const m = new THREE.Mesh(geo, this.mat);
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      g.add(m);
      return m;
    };
    add(this.staticGeo);
    g.userData = { left: add(this.modules.trees[0][0]), right: add(this.modules.trees[1][0]), s: 0 };
    this.scene.add(g);
    return g;
  }

  // Side scenery changes in runs, so walls and avenues continue over several segments.
  nextKind(i) {
    const kinds = ['arches', 'trees', 'houses'];
    if (chance(0.7)) return this.lastKind[i];
    this.lastKind[i] = pick(kinds.filter((k) => k !== this.lastKind[i]));
    return this.lastKind[i];
  }

  placeSegment(seg, s) {
    seg.userData.s = s;
    seg.position.z = -s;
    seg.userData.left.geometry = pick(this.modules[this.nextKind(0)][0]);
    seg.userData.right.geometry = pick(this.modules[this.nextKind(1)][1]);
  }

  reset(s, behind = DESPAWN_BEHIND) {
    const start = Math.floor((s - behind) / SEG) * SEG;
    this.segments.forEach((seg, i) => this.placeSegment(seg, start + i * SEG));
  }

  update(playerS, camera, behind = DESPAWN_BEHIND) {
    let maxS = -Infinity;
    for (const seg of this.segments) maxS = Math.max(maxS, seg.userData.s);
    for (const seg of this.segments) {
      if (seg.userData.s + SEG < playerS - behind) {
        maxS += SEG;
        this.placeSegment(seg, maxS);
      }
    }
    this.farGround.position.x = camera.position.x;
    this.farGround.position.z = camera.position.z;
    this.sun.position.set(camera.position.x - 5, 16, camera.position.z + 6);
    this.sun.target.position.set(camera.position.x, 0, camera.position.z - 10);
  }
}

