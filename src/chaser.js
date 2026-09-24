import * as THREE from 'three';
import { CHASER_NEAR, CHASER_FAR, INTRO_CHASE_TIME } from './config.js';
import { prepareCharacter, inPlaceClip } from './character.js';
import { makeBlobShadow } from './world.js';
import { damp, lerp } from './util.js';

// The rail-yard warden who chases the runner. He hangs back off-screen and closes in
// after a stumble; a second stumble while he is close means you're caught.
export class Chaser {
  constructor(scene, gltf) {
    this.root = new THREE.Group();
    this.model = gltf.scene;
    prepareCharacter(this.model);
    this.model.rotation.y = Math.PI;
    this.root.add(this.model);
    this.mixer = new THREE.AnimationMixer(this.model);
    this.run = this.mixer.clipAction(inPlaceClip(gltf.animations[0]));
    this.run.play();
    this.shadow = makeBlobShadow(1.5, 0.35);
    scene.add(this.root, this.shadow);
    this.reset();
  }

  reset(introT = INTRO_CHASE_TIME) {
    this.gap = CHASER_NEAR + 0.5;
    this.prevGap = this.gap;
    this.x = 0;
    this.prevX = 0;
    this.nearT = introT;   // visible and close
    this.alertT = 0;       // close because of a stumble: another stumble = caught
    this.catching = false;
    this.menu = false;
  }

  alert(t) {
    this.nearT = Math.max(this.nearT, t);
    this.alertT = t;
  }

  step(dt, player) {
    this.prevGap = this.gap;
    this.prevX = this.x;
    this.nearT = Math.max(0, this.nearT - dt);
    this.alertT = Math.max(0, this.alertT - dt);
    let target = this.nearT > 0 || this.menu ? CHASER_NEAR : CHASER_FAR;
    let rate = target < this.gap ? 2.4 : 0.7;
    if (this.catching) {
      target = 0.95;
      rate = 3.2;
    }
    if (this.menu) target = 3.2;
    this.gap = damp(this.gap, target, rate, dt);
    this.x = damp(this.x, player.x, this.catching ? 8 : 4, dt);
  }

  updateVisual(dt, alpha, playerRenderS, running) {
    const gap = lerp(this.prevGap, this.gap, alpha);
    const x = lerp(this.prevX, this.x, alpha);
    const s = playerRenderS - gap;
    this.root.position.set(x, 0, -s);
    const visible = gap < 16;
    this.root.visible = visible;
    this.shadow.visible = visible;
    this.shadow.position.set(x, 0.04, -s);
    const done = this.catching && gap < 1.05;
    this.mixer.timeScale = running && !done ? 1.05 : 0;
    this.mixer.update(dt);
  }
}
