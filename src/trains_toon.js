import * as THREE from 'three';
import { TRAIN_W, CAR_LEN } from './config.js';
import { Pieces, shade } from './toon.js';

// Chunky cel-shaded train cars for the classic look, built from coloured primitives.
// Every car spans local z from 0 (front, facing the runner) to -CAR_LEN, like the
// textured city cars, so obstacles.js can use either interchangeably.

const LIVERIES = [
  { body: '#f6c326', stripe: '#d8312f', roof: '#dfe6ee', skirt: '#e0ab17' },
  { body: '#e8483c', stripe: '#fff3dc', roof: '#e9eef3', skirt: '#c73a30' },
  { body: '#38a95a', stripe: '#ffe25a', roof: '#e3ecef', skirt: '#2d8c49' },
  { body: '#f28a2e', stripe: '#2f5fa8', roof: '#e8edf2', skirt: '#d8741e' },
];
const FREIGHT = { body: '#3f73b8', rib: '#2f5c99', roof: '#6b99d6', skirt: '#2f5c99' };

const W = TRAIN_W;
const L = CAR_LEN;
const GLASS = '#223452';
const DARK = '#23272e';

function roofArc(p, color, top, bulge) {
  // half cylinder along the car, flattened into a gentle arc
  const g = new THREE.CylinderGeometry(W / 2, W / 2, L, 16, 1, false, -Math.PI / 2, Math.PI);
  g.rotateX(-Math.PI / 2);
  g.scale(1, bulge / (W / 2), 1);
  g.translate(0, top, -L / 2);
  p.add(g, color);
}

function running(p) {
  p.box(W - 0.5, 0.35, L - 1.4, 0, 0.32, -L / 2, DARK);
  for (const z of [-1.7, -2.9, -L + 2.9, -L + 1.7]) {
    for (const x of [-0.92, 0.92]) {
      const w = new THREE.CylinderGeometry(0.34, 0.34, 0.18, 12);
      w.rotateZ(Math.PI / 2);
      w.translate(x, 0.34, z);
      p.add(w, '#15181d');
    }
  }
}

function cabEnd(p, z, dir, liv) {
  // windscreen, headlights and bumper on one end of the car (dir: +1 front, -1 rear)
  const zf = z + dir * 0.02;
  p.box(W - 0.5, 0.85, 0.05, 0, 1.95, zf, GLASS);
  p.box(W - 0.3, 0.12, 0.05, 0, 2.45, zf, shade(liv.body, 0.8));
  for (const x of [-0.72, 0.72]) {
    const lamp = new THREE.CylinderGeometry(0.17, 0.17, 0.08, 14);
    lamp.rotateX(Math.PI / 2);
    lamp.translate(x, 1.0, zf + dir * 0.03);
    p.add(lamp, dir > 0 ? '#fff4b8' : '#ff5b4a');
  }
  p.box(W - 0.2, 0.28, 0.22, 0, 0.55, z + dir * 0.1, DARK);
  p.box(0.5, 0.35, 0.3, 0, 0.55, z + dir * 0.2, '#3a3f48');
}

function passengerCar(liv) {
  const p = new Pieces();
  running(p);
  p.box(W, 2.15, L, 0, 1.55, -L / 2, liv.body);
  p.box(W + 0.03, 0.3, L - 0.1, 0, 0.62, -L / 2, liv.skirt);
  p.box(W + 0.04, 0.26, L - 0.2, 0, 1.12, -L / 2, liv.stripe);
  roofArc(p, liv.roof, 2.62, 0.32);
  for (const x of [-(W / 2 + 0.02), W / 2 + 0.02]) {
    for (let i = 0; i < 4; i++) {
      const z = -1.8 - i * 2.8;
      p.box(0.04, 0.7, 1.4, x, 1.85, z, GLASS);
      p.box(0.03, 0.12, 1.4, x * 1.004, 2.25, z, '#ffffff');
    }
    for (const z of [-3.2, -L + 3.2]) {
      p.box(0.05, 1.75, 1.05, x, 1.35, z, shade(liv.body, 0.82));
      p.box(0.06, 0.65, 0.35, x, 1.8, z - 0.25, GLASS);
      p.box(0.06, 0.65, 0.35, x, 1.8, z + 0.25, GLASS);
    }
  }
  cabEnd(p, 0, 1, liv);
  cabEnd(p, -L, -1, liv);
  return p.build();
}

function freightCar() {
  const liv = FREIGHT;
  const p = new Pieces();
  running(p);
  p.box(W, 2.25, L, 0, 1.6, -L / 2, liv.body);
  roofArc(p, liv.roof, 2.72, 0.22);
  for (const x of [-(W / 2 + 0.04), W / 2 + 0.04]) {
    for (let z = -0.6; z > -L; z -= 0.9) p.box(0.07, 2.1, 0.16, x, 1.6, z, liv.rib);
    p.box(0.08, 1.95, 2.6, x * 1.01, 1.5, -L / 2, shade(liv.body, 1.12));
    p.box(0.09, 0.14, 2.8, x * 1.02, 2.5, -L / 2, liv.rib);
  }
  // blunt ends with a small cab window and lamps
  for (const [z, dir] of [[0, 1], [-L, -1]]) {
    const zf = z + dir * 0.02;
    p.box(W - 1.0, 0.6, 0.05, 0, 2.0, zf, GLASS);
    for (let y = 0.8; y < 2.6; y += 0.35) p.box(0.5, 0.05, 0.08, W / 2 - 0.4, y, z + dir * 0.06, liv.rib);
    for (const x of [-0.72, 0.72]) {
      const lamp = new THREE.CylinderGeometry(0.15, 0.15, 0.08, 12);
      lamp.rotateX(Math.PI / 2);
      lamp.translate(x, 1.0, zf + dir * 0.03);
      p.add(lamp, dir > 0 ? '#fff4b8' : '#ff5b4a');
    }
    p.box(W - 0.2, 0.28, 0.22, 0, 0.55, z + dir * 0.1, DARK);
  }
  return p.build();
}

// One geometry per livery; the fifth is the freight wagon.
export function buildToonCars() {
  return [...LIVERIES.map(passengerCar), freightCar()];
}
