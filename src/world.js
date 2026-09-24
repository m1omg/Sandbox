import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LANES, SPAWN_AHEAD, DESPAWN_BEHIND, SKY_COLOR, FOG_COLOR, FOG_NEAR, FOG_FAR } from './config.js';
import { canvasTexture, radialTexture } from './assets.js';
import { rand, randInt, chance, pick } from './util.js';

const _dir = new THREE.Vector3();
const _color = new THREE.Color();

const SEG = 42;                 // length of one recycled track segment
// The title camera looks back down the track, so the world keeps much more track behind
// the runner there than during a run (see `behind` in update()).
export const MENU_BEHIND = 170;
const SEG_COUNT = Math.ceil((MENU_BEHIND + SPAWN_AHEAD) / SEG);
const WALL_X = 8.6;
const WALL_H = 6;
const CURB_X = 4.35;            // outer edge of the track bed
const GRASS_OUT = 44;           // how far the lawns reach sideways
const FACADE_TILE = 9;          // one facade texture = 3 windows x 3 floors = 9 m square

const FACADE_TINTS = ['#ffffff', '#fff3e6', '#f1ecff', '#e9f6ff', '#fff9e0'];
const ROOF_COLORS = ['#6d7089', '#a65a46', '#3f6b73', '#c29a6b', '#7a5a8c'];
const BUSH_COLORS = ['#4f9e3f', '#5fb84a', '#3f8a3a', '#e86ca0', '#f2c94c', '#66c26b'];
const CANOPY_COLORS = ['#4caf50', '#3d9142', '#6cc04a', '#2e7d32'];

function box(w, h, d, x, y, z) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

// Non-indexed copy of a geometry with a constant vertex colour, so differently coloured
// pieces can be merged into one mesh (one draw call).
function tinted(geo, color) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  _color.set(color);
  const n = g.attributes.position.count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { c[i * 3] = _color.r; c[i * 3 + 1] = _color.g; c[i * 3 + 2] = _color.b; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

// Minimal geometry builder for axis-aligned boxes with world-scaled UVs and vertex colours.
class BoxBuilder {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.uv = [];
    this.col = [];
  }

  quad(a, b, c, d, n, uvs, color) {
    for (const [p, t] of [[a, uvs[0]], [b, uvs[1]], [c, uvs[2]], [a, uvs[0]], [c, uvs[2]], [d, uvs[3]]]) {
      this.pos.push(p[0], p[1], p[2]);
      this.nrm.push(n[0], n[1], n[2]);
      this.uv.push(t[0], t[1]);
      this.col.push(color.r, color.g, color.b);
    }
  }

  // sides: facade faces; top: roof face. UVs are in facade tiles so windows keep their size.
  box(x0, x1, y0, y1, z0, z1, color, { sides = true, top = false, T = FACADE_TILE } = {}) {
    const c = _color.set(color).clone();
    const v0 = y0 / T, v1 = y1 / T;
    if (sides) {
      const dz = (z1 - z0) / T, dx = (x1 - x0) / T;
      this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], [[0, v0], [dz, v0], [dz, v1], [0, v1]], c);
      this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], [[0, v0], [dz, v0], [dz, v1], [0, v1]], c);
      this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], [[0, v0], [dx, v0], [dx, v1], [0, v1]], c);
      this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], [[0, v0], [dx, v0], [dx, v1], [0, v1]], c);
    }
    if (top) {
      this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], c);
    }
  }

  get empty() {
    return this.pos.length === 0;
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
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

    // ---- textures ----
    // Along the track every texture repeats an even whole number of times per segment,
    // so mirrored tiling lines up seamlessly from one segment to the next.
    const gravel = textures.gravel;
    gravel.wrapS = gravel.wrapT = THREE.MirroredRepeatWrapping;
    gravel.repeat.set(1.6, 8);
    const bedTex = gravel.clone();
    bedTex.repeat.set(1, 16);
    bedTex.needsUpdate = true;
    const grass = textures.grass;
    grass.wrapS = grass.wrapT = THREE.MirroredRepeatWrapping;
    grass.repeat.set((GRASS_OUT - CURB_X) / 4, 10);
    const wallTex = textures.wall;
    wallTex.wrapS = wallTex.wrapT = THREE.MirroredRepeatWrapping;
    wallTex.repeat.set(8, 1);
    const facades = [textures.facadeBrick, textures.facadePeach, textures.facadeBlue];
    for (const f of facades) f.wrapS = f.wrapT = THREE.MirroredRepeatWrapping;

    this.mats = {
      ground: new THREE.MeshLambertMaterial({ map: gravel, color: 0xcbbca4 }),
      bed: new THREE.MeshLambertMaterial({ map: bedTex, color: 0xb8aa98 }),
      grass: new THREE.MeshLambertMaterial({ map: grass }),
      curb: new THREE.MeshLambertMaterial({ color: 0xe0d2b8 }),
      sleeper: new THREE.MeshLambertMaterial({ color: 0x6b4a33 }),
      rail: new THREE.MeshPhongMaterial({ color: 0xb9c2cc, specular: 0xffffff, shininess: 60 }),
      wall: new THREE.MeshLambertMaterial({ map: wallTex }),
      terracotta: new THREE.MeshLambertMaterial({ color: 0xb4553f }),
      brick: new THREE.MeshLambertMaterial({ color: 0xc0624a }),
      pole: new THREE.MeshLambertMaterial({ color: 0x2d3e57 }),
      lamp: new THREE.MeshBasicMaterial({ color: 0xfff4c2 }),
      fence: new THREE.MeshLambertMaterial({ map: this.fenceTexture(), transparent: true, alphaTest: 0.3, side: THREE.DoubleSide }),
      fencePost: new THREE.MeshLambertMaterial({ color: 0x2f6e46 }),
      trunk: new THREE.MeshLambertMaterial({ color: 0x7a5236 }),
      foliage: new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
      facades: facades.map((map) => new THREE.MeshLambertMaterial({ map, vertexColors: true })),
      roof: new THREE.MeshLambertMaterial({ vertexColors: true }),
      tower: new THREE.MeshLambertMaterial({ color: 0x8b5e3c }),
      gantry: new THREE.MeshLambertMaterial({ color: 0xf0b429 }),
      signal: new THREE.MeshLambertMaterial({ color: 0x22262e }),
      red: new THREE.MeshBasicMaterial({ color: 0xff4a3d }),
      green: new THREE.MeshBasicMaterial({ color: 0x4dff7a }),
    };

    this.buildSharedGeometry();
    this.segments = [];
    for (let i = 0; i < SEG_COUNT; i++) this.segments.push(this.makeSegment());

    this.buildBackdrop(textures.skyline);
    this.buildGantries();
    this.reset(0, MENU_BEHIND);
  }

  fenceTexture() {
    const tex = canvasTexture(128, 128, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.strokeStyle = '#3f8f5a';
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

  // Geometry identical in every segment.
  buildSharedGeometry() {
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
    const ground = new THREE.PlaneGeometry(CURB_X * 2, SEG);
    ground.rotateX(-Math.PI / 2);
    ground.translate(0, -0.02, -SEG / 2);

    const lawnW = GRASS_OUT - CURB_X;
    const lawnL = new THREE.PlaneGeometry(lawnW, SEG);
    lawnL.rotateX(-Math.PI / 2);
    lawnL.translate(-(CURB_X + lawnW / 2), 0, -SEG / 2);
    const lawnR = new THREE.PlaneGeometry(lawnW, SEG);
    lawnR.rotateX(-Math.PI / 2);
    lawnR.translate(CURB_X + lawnW / 2, 0, -SEG / 2);

    const curbs = mergeGeometries([
      box(0.3, 0.22, SEG, -CURB_X, 0.11, -SEG / 2),
      box(0.3, 0.22, SEG, CURB_X, 0.11, -SEG / 2),
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

    // low brick wall + painted chain-link fence (lets the city show through)
    const lowWalls = mergeGeometries([
      box(0.5, 1.0, SEG, -WALL_X, 0.5, -SEG / 2),
      box(0.5, 1.0, SEG, WALL_X, 0.5, -SEG / 2),
    ]);
    const fenceL = new THREE.PlaneGeometry(SEG, 2.2);
    fenceL.rotateY(Math.PI / 2);
    fenceL.translate(-WALL_X, 2.1, -SEG / 2);
    const fenceR = fenceL.clone();
    fenceR.translate(WALL_X * 2, 0, 0);
    const fencePosts = [];
    for (let i = 0; i <= 6; i++) {
      const z = -i * (SEG / 6);
      fencePosts.push(box(0.12, 2.4, 0.12, -WALL_X, 2.1, z));
      fencePosts.push(box(0.12, 2.4, 0.12, WALL_X, 2.1, z));
    }

    // lamp posts
    const poles = [];
    const lamps = [];
    for (const side of [-1, 1]) {
      for (const z of [-SEG * 0.25, -SEG * 0.75]) {
        const x = side * 6.6;
        const pole = new THREE.CylinderGeometry(0.09, 0.12, 5.6, 8);
        pole.translate(x, 2.8, z);
        poles.push(pole.toNonIndexed());
        poles.push(box(1.4, 0.12, 0.12, x - side * 0.6, 5.5, z).toNonIndexed());
        lamps.push(box(0.5, 0.14, 0.3, x - side * 1.2, 5.42, z));
      }
    }

    this.geo = {
      ground,
      lawns: mergeGeometries([lawnL, lawnR]),
      curbs,
      beds: mergeGeometries(beds),
      sleepers: mergeGeometries(sleepers),
      rails: mergeGeometries(rails),
      walls: mergeGeometries([wallL, wallR]),
      caps,
      lowWalls,
      fences: mergeGeometries([fenceL, fenceR]),
      fencePosts: mergeGeometries(fencePosts),
      poles: mergeGeometries(poles),
      lamps: mergeGeometries(lamps),
    };

    // water tower template: four legs, a tank and a pointed roof
    const parts = [];
    for (const [lx, lz] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]]) parts.push(box(0.18, 2.2, 0.18, lx, 1.1, lz).toNonIndexed());
    const tank = new THREE.CylinderGeometry(1.3, 1.3, 2.4, 12);
    tank.translate(0, 3.4, 0);
    const cone = new THREE.ConeGeometry(1.45, 1.1, 12);
    cone.translate(0, 5.15, 0);
    parts.push(tank.toNonIndexed(), cone.toNonIndexed());
    this.towerTemplate = mergeGeometries(parts);
  }

  // Shrubs along the verge and trees behind the fences; random per segment instance.
  makeFoliage() {
    const shrubs = [];
    for (const side of [-1, 1]) {
      for (let i = 0; i < 6; i++) {
        const g = new THREE.IcosahedronGeometry(rand(0.45, 0.8), 0);
        g.scale(1, 0.8, 1);
        g.translate(side * rand(7.3, 8.1), 0.35, -rand(1, SEG - 1));
        shrubs.push(tinted(g, pick(BUSH_COLORS)));
      }
    }
    const trunks = [];
    const canopies = [];
    for (const side of [-1, 1]) {
      for (let i = 0; i < 5; i++) {
        const x = side * rand(9.8, 14.5);
        const z = -rand(1, SEG - 1);
        const h = rand(2.2, 3.4);
        const t = new THREE.CylinderGeometry(0.16, 0.24, h, 6);
        t.translate(x, h / 2, z);
        trunks.push(t.toNonIndexed());
        const r = rand(1.3, 2.1);
        const c = new THREE.IcosahedronGeometry(r, 0);
        c.translate(x, h + r * 0.6, z);
        canopies.push(tinted(c, pick(CANOPY_COLORS)));
        if (chance(0.5)) {
          const c2 = new THREE.IcosahedronGeometry(r * 0.7, 0);
          c2.translate(x + rand(-0.6, 0.6), h + r * 1.3, z + rand(-0.6, 0.6));
          canopies.push(tinted(c2, pick(CANOPY_COLORS)));
        }
      }
    }
    return {
      shrubs: mergeGeometries(shrubs),
      trunks: mergeGeometries(trunks),
      canopies: mergeGeometries(canopies),
    };
  }

  makeSegment() {
    const g = new THREE.Group();
    const m = this.mats;
    const add = (parent, geo, mat) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      parent.add(mesh);
      return mesh;
    };
    add(g, this.geo.ground, m.ground);
    add(g, this.geo.lawns, m.grass);
    add(g, this.geo.curbs, m.curb);
    add(g, this.geo.beds, m.bed);
    add(g, this.geo.sleepers, m.sleeper);
    add(g, this.geo.rails, m.rail);
    add(g, this.geo.poles, m.pole);
    add(g, this.geo.lamps, m.lamp);
    const foliage = this.makeFoliage();
    add(g, foliage.shrubs, m.foliage);

    const tall = new THREE.Group();
    add(tall, this.geo.walls, m.wall);
    add(tall, this.geo.caps, m.terracotta);
    const open = new THREE.Group();
    add(open, this.geo.lowWalls, m.brick);
    add(open, this.geo.fences, m.fence);
    add(open, this.geo.fencePosts, m.fencePost);
    add(open, foliage.trunks, m.trunk);
    add(open, foliage.canopies, m.foliage);

    // buildings are rebuilt every time the segment is recycled
    const facadeMeshes = m.facades.map((mat) => add(g, new THREE.BufferGeometry(), mat));
    const roofMesh = add(g, new THREE.BufferGeometry(), m.roof);
    const towerMesh = add(g, new THREE.BufferGeometry(), m.tower);
    for (const mesh of [...facadeMeshes, roofMesh, towerMesh]) mesh.visible = false;

    g.add(tall, open);
    g.userData = { tall, open, facadeMeshes, roofMesh, towerMesh, s: 0 };
    this.scene.add(g);
    return g;
  }

  // Rows of apartment blocks behind the walls (further back behind open fences).
  buildBuildings(seg, openSide) {
    const u = seg.userData;
    const facades = u.facadeMeshes.map(() => new BoxBuilder());
    const roofs = new BoxBuilder();
    const towers = [];
    for (const side of [-1, 1]) {
      let z = rand(-1, 0);
      while (z > -SEG + 3) {
        const w = pick([10, 12, 14, 16]);
        const z1 = z - rand(0, 1.2);
        const z0 = Math.max(z1 - w, -SEG);
        if (z1 - z0 < 5) break;
        const h = 3 * (openSide ? randInt(3, 6) : randInt(3, 8));
        const depth = rand(10, 14);
        const near = openSide ? rand(16, 19) : rand(10.2, 11.6);
        const x0 = side < 0 ? -(near + depth) : near;
        const x1 = side < 0 ? -near : near + depth;
        const f = randInt(0, facades.length - 1);
        facades[f].box(x0, x1, 0, h, z0, z1, pick(FACADE_TINTS));
        const roofColor = pick(ROOF_COLORS);
        roofs.box(x0, x1, 0, h, z0, z1, roofColor, { sides: false, top: true });
        roofs.box(x0 - 0.3, x1 + 0.3, h, h + 0.45, z0 - 0.3, z1 + 0.3, roofColor, { top: true, T: 1 });
        if (chance(0.35) && z1 - z0 > 7) {
          const t = this.towerTemplate.clone();
          t.translate((x0 + x1) / 2 + rand(-2, 2), h + 0.45, (z0 + z1) / 2 + rand(-2, 2));
          towers.push(t);
        }
        z = z0;
      }
    }
    const swap = (mesh, geo) => {
      mesh.geometry.dispose();
      mesh.geometry = geo || new THREE.BufferGeometry();
      mesh.visible = !!geo;
    };
    u.facadeMeshes.forEach((mesh, i) => swap(mesh, facades[i].empty ? null : facades[i].build()));
    swap(u.roofMesh, roofs.empty ? null : roofs.build());
    swap(u.towerMesh, towers.length ? mergeGeometries(towers) : null);
    for (const t of towers) t.dispose();
  }

  placeSegment(seg, s) {
    seg.userData.s = s;
    seg.position.z = -s;
    const openSide = chance(0.3);
    seg.userData.tall.visible = !openSide;
    seg.userData.open.visible = openSide;
    this.buildBuildings(seg, openSide);
  }

  buildBackdrop(tex) {
    // endless fogged meadow so nothing shows through past the lawns
    this.farGround = new THREE.Mesh(
      new THREE.PlaneGeometry(4000, 4000),
      new THREE.MeshBasicMaterial({ color: 0x9fcf7e }),
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

  // Painted steel signal gantries spanning the tracks — purely decorative.
  buildGantries() {
    const m = this.mats;
    this.gantries = [];
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group();
      const add = (geo, mat) => g.add(new THREE.Mesh(geo, mat));
      // high enough that the jetpack camera (about 9 m up) passes underneath
      for (const x of [-7.7, 7.7]) add(box(0.4, 14.1, 0.4, x, 7.05, 0), m.gantry);
      add(box(16.2, 0.35, 0.45, 0, 13.9, 0), m.gantry);
      add(box(16.2, 0.35, 0.45, 0, 12.7, 0), m.gantry);
      for (let k = 0; k <= 8; k++) add(box(0.14, 1.2, 0.14, -7.7 + k * 1.925, 13.3, 0), m.gantry);
      for (const lx of LANES) {
        add(box(0.55, 1.1, 0.35, lx, 11.95, 0.05), m.signal);
        const red = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), m.red);
        red.position.set(lx, 12.22, 0.24);
        const green = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), m.green);
        green.position.set(lx, 11.7, 0.24);
        g.add(red, green);
      }
      g.visible = false;
      g.userData.s = -1e9;
      this.scene.add(g);
      this.gantries.push(g);
    }
  }

  reset(s, behind = DESPAWN_BEHIND) {
    const start = Math.floor((s - behind) / SEG) * SEG;
    this.segments.forEach((seg, i) => this.placeSegment(seg, start + i * SEG));
    this.nextGantry = s - behind + rand(40, 140);
    for (const gt of this.gantries) {
      gt.userData.s = -1e9;
      gt.visible = false;
    }
    this.placeGantries(s, behind);
  }

  placeGantries(playerS, behind) {
    for (const gt of this.gantries) {
      if (gt.userData.s < playerS - behind - 5) {
        if (this.nextGantry < playerS + SPAWN_AHEAD) {
          gt.userData.s = this.nextGantry;
          gt.position.z = -this.nextGantry;
          gt.visible = true;
          this.nextGantry += rand(160, 320);
        } else {
          gt.visible = false;
        }
      }
    }
  }

  // `behind`: how much track to keep behind the runner (more on the title screen).
  update(playerS, camera, behind = DESPAWN_BEHIND) {
    // recycle segments that fell behind to the front of the queue
    let maxS = -Infinity;
    for (const seg of this.segments) maxS = Math.max(maxS, seg.userData.s);
    for (const seg of this.segments) {
      if (seg.userData.s + SEG < playerS - behind) {
        maxS += SEG;
        this.placeSegment(seg, maxS);
      }
    }
    this.placeGantries(playerS, behind);

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
