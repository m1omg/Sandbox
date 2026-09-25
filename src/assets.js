import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const TEXTURES = {
  trainSide: 'assets/textures/train_side.jpg',
  trainSideRed: 'assets/textures/train_side_red.jpg',
  trainSideGreen: 'assets/textures/train_side_green.jpg',
  trainFront: 'assets/textures/train_front.jpg',
  trainFrontRed: 'assets/textures/train_front_red.jpg',
  trainFrontGreen: 'assets/textures/train_front_green.jpg',
  wall: 'assets/textures/graffiti_wall.jpg',
  gravel: 'assets/textures/gravel.jpg',
  skyline: 'assets/textures/skyline.jpg',
  grass: 'assets/textures/grass.jpg',
  facadeBrick: 'assets/textures/facade_brick.jpg',
  facadePeach: 'assets/textures/facade_peach.jpg',
  facadeBlue: 'assets/textures/facade_blue.jpg',
};

const MODELS = {
  kit: 'assets/models/kit.glb',
  warden: 'assets/models/warden.glb',
};

// textureKeys: which entries of TEXTURES to load (the classic look needs none of them).
export async function loadAssets(renderer, onProgress, textureKeys = Object.keys(TEXTURES)) {
  const manager = new THREE.LoadingManager();
  manager.onProgress = (_url, loaded, total) => onProgress && onProgress(loaded / total);
  const texLoader = new THREE.TextureLoader(manager);
  const gltfLoader = new GLTFLoader(manager);
  const maxAniso = Math.min(16, renderer.capabilities.getMaxAnisotropy());

  const textures = {};
  const texJobs = textureKeys.map(async (key) => {
    const url = TEXTURES[key];
    const tex = await texLoader.loadAsync(url);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = maxAniso;
    textures[key] = tex;
  });

  const models = {};
  const modelJobs = Object.entries(MODELS).map(async ([key, url]) => {
    models[key] = await gltfLoader.loadAsync(url);
  });

  await Promise.all([...texJobs, ...modelJobs]);
  return { textures, models };
}

// Small procedural textures drawn on canvases.
export function canvasTexture(w, h, draw, { repeat = false, srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export function stripeTexture(c1, c2, stripes = 6, w = 256, h = 64) {
  return canvasTexture(w, h, (g) => {
    g.fillStyle = c1;
    g.fillRect(0, 0, w, h);
    g.fillStyle = c2;
    const sw = w / stripes;
    for (let i = -2; i < stripes + 2; i++) {
      g.beginPath();
      g.moveTo(i * sw, h);
      g.lineTo(i * sw + sw / 2, h);
      g.lineTo(i * sw + sw / 2 + h, 0);
      g.lineTo(i * sw + h, 0);
      g.closePath();
      g.fill();
    }
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.lineWidth = 6;
    g.strokeRect(0, 0, w, h);
  });
}

export function radialTexture(inner, outer, size = 128) {
  return canvasTexture(size, size, (g) => {
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, inner);
    grad.addColorStop(1, outer);
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
  });
}
