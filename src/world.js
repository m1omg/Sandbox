import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LANES, SPAWN_AHEAD, DESPAWN_BEHIND, SKY_COLOR, FOG_COLOR, FOG_NEAR, FOG_FAR } from './config.js';
import { canvasTexture, radialTexture } from './assets.js';
import { rand, chance } from './util.js';

const _dir = new THREE.Vector3();
const SEG = 42;                                    // length of one recycled track segment
const SEG_COUNT = Math.ceil((SPAWN_AHEAD + DESPAWN_BEHIND) / SEG) + 1;
const WALL_X = 8.6;
const WALL_H = 6;

function box(w, h, d, x, y, z) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

export class World {
  constructor(scene, assets) {
    this.scene = scene;
    const { textures } = assets;

    scene.background = new THREE.Color(SKY_COLOR);
    scene.fog = new THREE.Fog(FOG_COLOR, FOG_NEAR, FOG_FAR);

    const hemi = new THREE.HemisphereLight(0xeaf6ff, 0x8a7a66, 1.35);
    scene.add(hemi);
    this.sun = new THREE.DirectionalLight(0xfff1dc, 2.1);
    this.sun.position.set(-6, 14, 8);
    scene.add(this.sun);
    scene.add(this.sun.target);

    // ---- materials ----
    const gravel = textures.gravel;
    gravel.wrapS = gravel.wrapT = THREE.MirroredRepeatWrapping;
    gravel.repeat.set(6, 8);
    const bedTex = gravel.clone();
    bedTex.repeat.set(1, 16);
    bedTex.needsUpdate = true;
    const wallTex = textures.wall;
    wallTex.wrapS = wallTex.wrapT = THREE.MirroredRepeatWrapping;
    wallTex.repeat.set(8, 1);

    this.mats = {
      ground: new THREE.MeshLambertMaterial({ map: gravel, color: 0xd9cdb8 }),
      bed: new THREE.MeshLambertMaterial({ map: bedTex, color: 0xb8aa98 }),
      sleeper: new THREE.MeshLambertMaterial({ color: 0x6b4a33 }),
      rail: new THREE.MeshPhongMaterial({ color: 0xb9c2cc, specular: 0xffffff, shininess: 60 }),
      wall: new THREE.MeshLambertMaterial({ map: wallTex }),
      concrete: new THREE.MeshLambertMaterial({ color: 0xc9c2b6 }),
      darkConcrete: new THREE.MeshLambertMaterial({ color: 0x8f877c }),
      walkway: new THREE.MeshLambertMaterial({ color: 0xb3aa9c }),
      pole: new THREE.MeshLambertMaterial({ color: 0x3b4a5c }),
      lamp: new THREE.MeshBasicMaterial({ color: 0xfff4c2 }),
      fence: new THREE.MeshLambertMaterial({
        map: this.fenceTexture(),
        transparent: true,
        alphaTest: 0.3,
        side: THREE.DoubleSide,
      }),
      bush: new THREE.MeshLambertMaterial({ color: 0x5aa84a }),
    };

    this.buildSegmentGeometry();
    this.segments = [];
    for (let i = 0; i < SEG_COUNT; i++) this.segments.push(this.makeSegment());

    this.buildBackdrop(textures.skyline);
    this.buildProps();
    this.reset(0);
  }

  fenceTexture() {
    const tex = canvasTexture(128, 128, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.strokeStyle = '#9aa7b2';
      g.lineWidth = 5;
      for (let i = -w; i < w * 2; i += 32) {
        g.beginPath(); g.moveTo(i, 0); g.lineTo(i + h, h); g.stroke();
        g.beginPath(); g.moveTo(i + h, 0); g.lineTo(i, h); g.stroke();
      }
    });
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(SEG / 2.2, 1);
    return tex;
  }

  buildSegmentGeometry() {
    const sleepers = [];
    const rails = [];
    const beds = [];
    const spacing = SEG / 40;
    for (const lx of LANES) {
      beds.push(box(3.0, 0.16, SEG, lx, 0.0, -SEG / 2));
      for (let i = 0; i < 40; i++) sleepers.push(box(2.3, 0.1, 0.34, lx, 0.1, -(i + 0.5) * spacing));
      rails.push(box(0.1, 0.16, SEG, lx - 0.72, 0.22, -SEG / 2));
      rails.push(box(0.1, 0.16, SEG, lx + 0.72, 0.22, -SEG / 2));
    }
    const ground = new THREE.PlaneGeometry(32, SEG);
    ground.rotateX(-Math.PI / 2);
    ground.translate(0, -0.02, -SEG / 2);

    const walkways = mergeGeometries([
      box(4.4, 0.36, SEG, -(WALL_X - 2.2), 0.18, -SEG / 2),
      box(4.4, 0.36, SEG, WALL_X - 2.2, 0.18, -SEG / 2),
    ]);

    const wallL = new THREE.PlaneGeometry(SEG, WALL_H);
    wallL.rotateY(Math.PI / 2);
    wallL.translate(-WALL_X, WALL_H / 2, -SEG / 2);
    const wallR = new THREE.PlaneGeometry(SEG, WALL_H);
    wallR.rotateY(-Math.PI / 2);
    wallR.translate(WALL_X, WALL_H / 2, -SEG / 2);
    const caps = mergeGeometries([
      box(0.8, 0.45, SEG, -WALL_X - 0.3, WALL_H + 0.2, -SEG / 2),
      box(0.8, 0.45, SEG, WALL_X + 0.3, WALL_H + 0.2, -SEG / 2),
    ]);

    // low wall + fence variant (lets the skyline show through)
    const lowWalls = mergeGeometries([
      box(0.5, 1.2, SEG, -WALL_X, 0.6, -SEG / 2),
      box(0.5, 1.2, SEG, WALL_X, 0.6, -SEG / 2),
    ]);
    const fenceL = new THREE.PlaneGeometry(SEG, 2.4);
    fenceL.rotateY(Math.PI / 2);
    fenceL.translate(-WALL_X, 2.4, -SEG / 2);
    const fenceR = fenceL.clone();
    fenceR.translate(WALL_X * 2, 0, 0);
    const fencePosts = [];
    for (let i = 0; i <= 6; i++) {
      const z = -i * (SEG / 6);
      fencePosts.push(box(0.12, 2.6, 0.12, -WALL_X, 2.3, z));
      fencePosts.push(box(0.12, 2.6, 0.12, WALL_X, 2.3, z));
    }
    const bushes = [];
    for (let i = 0; i < 6; i++) {
      for (const side of [-1, 1]) {
        const g = new THREE.IcosahedronGeometry(rand(1.0, 1.8), 0);
        g.translate(side * (WALL_X + rand(2, 7)), 0.6, -rand(0, SEG));
        bushes.push(g);
      }
    }

    // lamp posts
    const poles = [];
    const lamps = [];
    for (const side of [-1, 1]) {
      for (const z of [-SEG * 0.25, -SEG * 0.75]) {
        const x = side * 6.6;
        const pole = new THREE.CylinderGeometry(0.09, 0.12, 5.6, 8);
        pole.translate(x, 2.8, z);
        poles.push(pole);
        poles.push(box(1.4, 0.12, 0.12, x - side * 0.6, 5.5, z));
        lamps.push(box(0.5, 0.14, 0.3, x - side * 1.2, 5.42, z));
      }
    }

    this.geo = {
      ground,
      beds: mergeGeometries(beds),
      sleepers: mergeGeometries(sleepers),
      rails: mergeGeometries(rails),
      walkways,
      walls: mergeGeometries([wallL, wallR]),
      caps,
      lowWalls,
      fences: mergeGeometries([fenceL, fenceR]),
      fencePosts: mergeGeometries(fencePosts),
      bushes: mergeGeometries(bushes),
      poles: mergeGeometries(poles.map((g) => g.index ? g.toNonIndexed() : g)),
      lamps: mergeGeometries(lamps),
    };
  }

  makeSegment() {
    const g = new THREE.Group();
    const m = this.mats;
    const add = (geo, mat) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      g.add(mesh);
      return mesh;
    };
    add(this.geo.ground, m.ground);
    add(this.geo.beds, m.bed);
    add(this.geo.sleepers, m.sleeper);
    add(this.geo.rails, m.rail);
    add(this.geo.walkways, m.walkway);
    add(this.geo.poles, m.pole);
    add(this.geo.lamps, m.lamp);
    const tall = new THREE.Group();
    tall.add(new THREE.Mesh(this.geo.walls, m.wall));
    tall.add(new THREE.Mesh(this.geo.caps, m.concrete));
    const open = new THREE.Group();
    open.add(new THREE.Mesh(this.geo.lowWalls, m.concrete));
    open.add(new THREE.Mesh(this.geo.fences, m.fence));
    open.add(new THREE.Mesh(this.geo.fencePosts, m.pole));
    open.add(new THREE.Mesh(this.geo.bushes, m.bush));
    g.add(tall, open);
    g.userData = { tall, open, s: 0 };
    this.scene.add(g);
    return g;
  }

  placeSegment(seg, s) {
    seg.userData.s = s;
    seg.position.z = -s;
    const openSide = chance(0.3);
    seg.userData.tall.visible = !openSide;
    seg.userData.open.visible = openSide;
  }

  buildBackdrop(tex) {
    // endless fogged ground so nothing shows through past the last track segment
    this.farGround = new THREE.Mesh(
      new THREE.PlaneGeometry(4000, 4000),
      new THREE.MeshBasicMaterial({ color: FOG_COLOR }),
    );
    this.farGround.rotation.x = -Math.PI / 2;
    this.farGround.position.y = -0.3;
    this.scene.add(this.farGround);

    tex.wrapS = THREE.MirroredRepeatWrapping;
    const H = 300;
    const W = 1400;
    tex.repeat.set(W / (H * (1344 / 576)), 1);
    const mat = new THREE.MeshBasicMaterial({ map: tex, fog: false, depthWrite: false });
    this.backdrop = new THREE.Mesh(new THREE.PlaneGeometry(W, H), mat);
    this.backdrop.renderOrder = -10;
    this.backdropH = H;
    this.scene.add(this.backdrop);
  }

  // Overpass bridges crossing above the tracks — purely decorative.
  buildProps() {
    const deckTex = this.mats.wall.map.clone();
    deckTex.repeat.set(4, 0.35);
    deckTex.needsUpdate = true;
    const side = new THREE.MeshLambertMaterial({ map: deckTex });
    const mats = [side, side, this.mats.concrete, this.mats.darkConcrete, side, side];
    this.bridges = [];
    for (let i = 0; i < 2; i++) {
      const g = new THREE.Group();
      const deck = new THREE.Mesh(new THREE.BoxGeometry(30, 1.4, 5), mats);
      deck.position.y = 11;
      const rail = new THREE.Mesh(new THREE.BoxGeometry(30, 0.8, 0.25), this.mats.pole);
      rail.position.set(0, 12.1, 2.3);
      const rail2 = rail.clone();
      rail2.position.z = -2.3;
      g.add(deck, rail, rail2);
      for (const x of [-7.4, 7.4]) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(1.2, 10.4, 2.4), this.mats.concrete);
        p.position.set(x, 5.2, 0);
        g.add(p);
      }
      this.scene.add(g);
      this.bridges.push(g);
    }
  }

  reset(s) {
    const start = Math.floor((s - DESPAWN_BEHIND) / SEG) * SEG;
    this.segments.forEach((seg, i) => this.placeSegment(seg, start + i * SEG));
    this.nextBridge = s + rand(120, 220);
    for (const b of this.bridges) b.userData.s = -1e9;
    this.placeBridges(s);
  }

  placeBridges(playerS) {
    for (const b of this.bridges) {
      if (b.userData.s < playerS - DESPAWN_BEHIND) {
        if (this.nextBridge < playerS + SPAWN_AHEAD) {
          b.userData.s = this.nextBridge;
          b.position.z = -this.nextBridge;
          b.visible = true;
          this.nextBridge += rand(220, 420);
        } else {
          b.visible = false;
        }
      }
    }
  }

  update(playerS, camera) {
    // recycle segments that fell behind to the front of the queue
    let maxS = -Infinity;
    for (const seg of this.segments) maxS = Math.max(maxS, seg.userData.s);
    for (const seg of this.segments) {
      if (seg.userData.s + SEG < playerS - DESPAWN_BEHIND) {
        maxS += SEG;
        this.placeSegment(seg, maxS);
      }
    }
    this.placeBridges(playerS);

    // skyline and sun follow the camera
    // keep the skyline in front of wherever the camera is looking (the title camera faces backwards)
    camera.getWorldDirection(_dir);
    _dir.y = 0;
    if (_dir.lengthSq() < 1e-6) _dir.set(0, 0, -1);
    _dir.normalize();
    this.backdrop.position.set(camera.position.x + _dir.x * 330, this.backdropH / 2 - 70, camera.position.z + _dir.z * 330);
    this.backdrop.rotation.y = Math.atan2(-_dir.x, -_dir.z);
    this.farGround.position.x = camera.position.x;
    this.farGround.position.z = camera.position.z;
    this.sun.position.set(camera.position.x - 6, 14, camera.position.z + 4);
    this.sun.target.position.set(camera.position.x, 0, camera.position.z - 10);
  }
}

export function makeBlobShadow(size = 1.2, opacity = 0.35) {
  const tex = radialTexture('rgba(0,0,0,1)', 'rgba(0,0,0,0)', 64);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = 1;
  return mesh;
}
