import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Cel shading: three flat light bands.
let gradient = null;
export function toonGradient() {
  if (!gradient) {
    gradient = new THREE.DataTexture(new Uint8Array([105, 185, 255]), 3, 1, THREE.RedFormat);
    gradient.minFilter = gradient.magFilter = THREE.NearestFilter;
    gradient.generateMipmaps = false;
    gradient.needsUpdate = true;
  }
  return gradient;
}

export function toonMat(params = {}) {
  return new THREE.MeshToonMaterial({ gradientMap: toonGradient(), ...params });
}

const _c = new THREE.Color();

// Collects coloured primitives and merges them into one vertex-coloured geometry,
// so a whole prop group renders in a single draw call.
export class Pieces {
  constructor() {
    this.list = [];
  }

  add(geo, color) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    if (g.attributes.uv) g.deleteAttribute('uv');
    _c.set(color);
    const n = g.attributes.position.count;
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      c[i * 3] = _c.r;
      c[i * 3 + 1] = _c.g;
      c[i * 3 + 2] = _c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    this.list.push(g);
    return g;
  }

  box(w, h, d, x, y, z, color) {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    return this.add(g, color);
  }

  // cylinder standing upright
  cyl(r0, r1, h, x, y, z, color, seg = 10) {
    const g = new THREE.CylinderGeometry(r0, r1, h, seg);
    g.translate(x, y, z);
    return this.add(g, color);
  }

  blob(r, x, y, z, color, sy = 1, detail = 1) {
    const g = new THREE.IcosahedronGeometry(r, detail);
    g.scale(1, sy, 1);
    g.translate(x, y, z);
    return this.add(g, color);
  }

  build() {
    const g = mergeGeometries(this.list);
    for (const p of this.list) p.dispose();
    this.list = [];
    g.computeBoundingSphere();
    return g;
  }
}

// Darken or lighten a hex colour.
export function shade(hex, k) {
  return '#' + _c.set(hex).multiplyScalar(k).getHexString();
}
