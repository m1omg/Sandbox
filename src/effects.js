import * as THREE from 'three';
import { canvasTexture } from './assets.js';

// Pooled sprite particles. Purely visual: advanced with real frame time.
export class Effects {
  constructor(scene) {
    const star = canvasTexture(64, 64, (g, w) => {
      const c = w / 2;
      const grad = g.createRadialGradient(c, c, 0, c, c, c);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.25, 'rgba(255,255,255,0.8)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, w, w);
    });
    const puff = canvasTexture(64, 64, (g, w) => {
      const c = w / 2;
      const grad = g.createRadialGradient(c, c, 0, c, c, c);
      grad.addColorStop(0, 'rgba(255,255,255,0.9)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, w, w);
    });
    this.pool = [];
    for (let i = 0; i < 120; i++) {
      const additive = i < 80;
      const mat = new THREE.SpriteMaterial({
        map: additive ? star : puff,
        transparent: true,
        depthWrite: false,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      });
      const sp = new THREE.Sprite(mat);
      sp.visible = false;
      sp.userData = { additive, life: 0, max: 1, vx: 0, vy: 0, vz: 0, size: 1, grow: 0, gravity: 0 };
      scene.add(sp);
      this.pool.push(sp);
    }
  }

  spawn(additive, x, y, z, opts) {
    const sp = this.pool.find((p) => !p.visible && p.userData.additive === additive);
    if (!sp) return;
    const u = sp.userData;
    Object.assign(u, { life: 0, max: 0.5, vx: 0, vy: 0, vz: 0, size: 0.4, grow: 0, gravity: 0 }, opts);
    sp.material.color.set(opts.color || 0xffffff);
    sp.position.set(x, y, z);
    sp.scale.setScalar(u.size);
    sp.material.opacity = 1;
    sp.visible = true;
  }

  sparkle(x, y, z) {
    for (let i = 0; i < 5; i++) {
      const a = Math.random() * Math.PI * 2;
      this.spawn(true, x, y, z, {
        color: i % 2 ? 0xffe066 : 0xffffff, max: 0.35, size: 0.35,
        vx: Math.cos(a) * 3, vy: Math.sin(a) * 3 + 1, vz: -4, grow: -0.6,
      });
    }
  }

  burst(x, y, z, color = 0xffffff, n = 14) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 3 + Math.random() * 5;
      this.spawn(true, x, y, z, {
        color, max: 0.6, size: 0.6, vx: Math.cos(a) * sp, vy: Math.random() * 6 + 1, vz: Math.sin(a) * sp, gravity: 14, grow: -0.6,
      });
    }
  }

  dust(x, y, z, n = 5) {
    for (let i = 0; i < n; i++) {
      this.spawn(false, x + (Math.random() - 0.5) * 0.8, y + 0.15, z + Math.random() * 0.6, {
        color: 0xe9dcc6, max: 0.5, size: 0.5, vx: (Math.random() - 0.5) * 2, vy: 0.8 + Math.random(), vz: 2 + Math.random() * 2, grow: 2.2,
      });
    }
  }

  update(dt) {
    for (const sp of this.pool) {
      if (!sp.visible) continue;
      const u = sp.userData;
      u.life += dt;
      if (u.life >= u.max) {
        sp.visible = false;
        continue;
      }
      u.vy -= u.gravity * dt;
      sp.position.x += u.vx * dt;
      sp.position.y += u.vy * dt;
      sp.position.z += u.vz * dt;
      const size = Math.max(0.02, u.size + u.grow * u.life);
      sp.scale.setScalar(size);
      sp.material.opacity = 1 - u.life / u.max;
    }
  }

  clear() {
    for (const sp of this.pool) sp.visible = false;
  }
}
