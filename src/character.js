import * as THREE from 'three';
import { CLASSIC } from './theme.js';
import { toonGradient } from './toon.js';

// Helpers for the rigged GLB characters generated for this game: material cleanup,
// clip cleanup and procedural poses layered on top of the run animation.

const _pq = new THREE.Quaternion();
const _r = new THREE.Quaternion();
const _m = new THREE.Quaternion();
const AXES = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };

export function prepareCharacter(root) {
  const skinned = [];
  root.traverse((o) => {
    if (o.isMesh) {
      const old = o.material;
      // The generated GLBs ship with an emissive copy of the base colour, which flattens
      // all shading. Replace with a plain lit material using only the base colour map.
      o.material = CLASSIC
        ? new THREE.MeshToonMaterial({ map: old.map, gradientMap: toonGradient() })
        : new THREE.MeshStandardMaterial({ map: old.map, roughness: 0.78, metalness: 0 });
      old.dispose();
      o.frustumCulled = false;
      if (o.isSkinnedMesh) skinned.push(o);
    }
  });
  if (CLASSIC) for (const m of skinned) addOutline(m);
}

// Cartoon ink line for the classic look: a slightly inflated copy of the mesh that only draws
// its back faces, in a dark colour. It shares the character's skeleton, so it follows every
// animation and pose, and it is a child of the model, so it hides and shows with it.
let outlineMat = null;
function addOutline(mesh, width = 0.016) {
  if (!outlineMat) {
    outlineMat = new THREE.MeshBasicMaterial({ color: 0x241a33, side: THREE.BackSide });
    outlineMat.onBeforeCompile = (shader) => {
      shader.uniforms.outlineWidth = { value: width };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float outlineWidth;')
        .replace('#include <begin_vertex>', 'vec3 transformed = position + normal * outlineWidth;');
    };
  }
  const line = new THREE.SkinnedMesh(mesh.geometry, outlineMat);
  line.bind(mesh.skeleton, mesh.bindMatrix);
  line.position.copy(mesh.position);
  line.quaternion.copy(mesh.quaternion);
  line.scale.copy(mesh.scale);
  line.frustumCulled = false;
  mesh.parent.add(line);
}

// How far the character's back sticks out behind the torso (model space, facing +z), e.g. a backpack.
export function backDepth(root) {
  let depth = 0;
  root.traverse((o) => {
    if (!o.isMesh || o.material.side === THREE.BackSide) return;
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y > 0.85 && y < 1.35) depth = Math.max(depth, -pos.getZ(i));
    }
  });
  return depth;
}

// Keep the vertical bounce of the hips but remove horizontal drift so the character
// runs in place (the game moves the character itself).
export function inPlaceClip(clip) {
  const c = clip.clone();
  c.tracks = c.tracks.filter((t) => !t.name.endsWith('.scale'));
  for (const t of c.tracks) {
    if (t.name === 'Hips.position') {
      const v = t.values;
      let mx = 0, mz = 0;
      const n = v.length / 3;
      for (let i = 0; i < n; i++) { mx += v[i * 3]; mz += v[i * 3 + 2]; }
      mx /= n; mz /= n;
      for (let i = 0; i < n; i++) { v[i * 3] = mx; v[i * 3 + 2] = mz; }
    }
  }
  return c;
}

function modelSpaceQuat(obj, root, out) {
  out.identity();
  const chain = [];
  for (let o = obj; o && o !== root; o = o.parent) chain.push(o);
  for (let i = chain.length - 1; i >= 0; i--) out.multiply(chain[i].quaternion);
  return out;
}

// Rotate a bone about an axis expressed in the character's own space
// (+z = facing direction, +y = up), regardless of the bone's local orientation.
function rotateInModelSpace(bone, root, axis, angle) {
  modelSpaceQuat(bone.parent, root, _pq);
  _r.setFromAxisAngle(axis, angle);
  _m.copy(_pq).invert().multiply(_r).multiply(_pq);
  bone.quaternion.premultiply(_m);
}

function depth(o, root) {
  let d = 0;
  for (let p = o; p && p !== root; p = p.parent) d++;
  return d;
}

export class PoseRig {
  constructor(root) {
    this.root = root;
    this.bones = {};
    root.traverse((o) => { if (o.isBone) this.bones[o.name] = o; });
    this.list = Object.values(this.bones).sort((a, b) => depth(a, root) - depth(b, root));
    this.rest = new Map(this.list.map((b) => [b, b.quaternion.clone()]));
    this.hips = this.bones.Hips;
    this.restHips = this.hips ? this.hips.position.clone() : null;
    this.poses = {};
    this.weights = {};
  }

  // deltas: [[boneName, axis, angle], ...] applied on top of the rest (A-) pose.
  define(name, deltas, hipsOffset = null) {
    for (const b of this.list) b.quaternion.copy(this.rest.get(b));
    const byBone = new Map();
    for (const [bn, axis, angle] of deltas) {
      const b = this.bones[bn];
      if (!b) continue;
      if (!byBone.has(b)) byBone.set(b, []);
      byBone.get(b).push([AXES[axis], angle]);
    }
    for (const b of this.list) {
      const ops = byBone.get(b);
      if (ops) for (const [axis, angle] of ops) rotateInModelSpace(b, this.root, axis, angle);
    }
    const target = new Map(this.list.map((b) => [b, b.quaternion.clone()]));
    for (const b of this.list) b.quaternion.copy(this.rest.get(b));
    let hips = null;
    if (this.restHips) {
      hips = this.restHips.clone();
      if (hipsOffset) hips.add(hipsOffset);
    }
    this.poses[name] = { target, hips };
    this.weights[name] = 0;
  }

  // Call after the mixer has written the animated pose for this frame.
  apply() {
    for (const [name, pose] of Object.entries(this.poses)) {
      const w = this.weights[name];
      if (w < 0.001) continue;
      for (const [b, q] of pose.target) b.quaternion.slerp(q, w);
      if (pose.hips) this.hips.position.lerp(pose.hips, w);
    }
  }
}
