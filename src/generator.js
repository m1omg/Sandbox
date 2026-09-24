import { RAMP_LEN, TRAIN_H, SPAWN_AHEAD, JUMP_HEIGHT } from './config.js';
import { Rng, clamp, lerp } from './util.js';

const L = [0, 1, 2];

// Procedural level generator. It walks a cursor ahead of the runner and emits "rows"
// of obstacles, keeping these guarantees so every run is always survivable:
//   * at most two lanes are ever walled off by trains at the same distance,
//   * obstacles in one lane are spaced so the runner can land and react,
//   * an oncoming train's lane is clear far enough back for its whole approach.
export class Generator {
  constructor(obstacles, pickups) {
    this.obstacles = obstacles;
    this.pickups = pickups;
    this.reset(0);
  }

  reset(s, rng = new Rng()) {
    this.rng = rng;
    this.startS = s;
    this.cursor = s + 60;
    this.blockedUntil = [-1e9, -1e9, -1e9];
    this.lastEnd = [-1e9, -1e9, -1e9];      // last obstacle or coin line per lane
    this.lastObstacle = [-1e9, -1e9, -1e9]; // last obstacle only
    this.nextPowerup = s + this.rng.rand(170, 260);
    // opening coin line in the middle lane
    const end = this.pickups.addCoinLine(1, s + 18, 12, 1.8);
    this.lastEnd[1] = end + 2;
  }

  difficulty(s) {
    return clamp((s - this.startS) / 3500, 0, 1);
  }

  update(playerS, speed) {
    while (this.cursor < playerS + SPAWN_AHEAD) this.spawnRow(speed);
  }

  free(l, s, gap = 6) {
    return this.blockedUntil[l] < s - 1 && this.lastEnd[l] < s - gap;
  }

  blockedCount(s, except = -1) {
    let n = 0;
    for (const l of L) if (l !== except && this.blockedUntil[l] > s) n++;
    return n;
  }

  spawnRow(speed) {
    const s = this.cursor;
    const d = this.difficulty(s);
    const kind = this.rng.weighted([
      ['trains', 0.4],
      ['barriers', 0.28 + 0.06 * d],
      ['moving', 0.14 + 0.12 * d],
      ['mixed', 0.17 + 0.05 * d],
      ['coins', 0.09 - 0.05 * d],
    ]);
    let placed = false;
    if (kind === 'trains') placed = this.placeTrains(s, d, 2);
    else if (kind === 'barriers') placed = this.placeBarriers(s, d);
    else if (kind === 'moving') placed = this.placeMoving(s, d);
    else if (kind === 'mixed') placed = this.placeMixed(s, d);
    if (!placed) this.placeCoinRun(s, speed);

    this.maybePowerup(s);
    const gapTime = lerp(1.3, 0.92, d) + this.rng.rand(0, 0.45);
    this.cursor = s + Math.max(15, speed * gapTime);
  }

  placeTrains(s, d, maxNew) {
    const cand = this.rng.shuffle(L.filter((l) => this.free(l, s, 6)));
    const allowed = Math.min(cand.length, 2 - this.blockedCount(s), maxNew);
    if (allowed <= 0) return false;
    const n = allowed >= 2 && this.rng.chance(0.45 + 0.2 * d) ? 2 : 1;
    let coinsPlaced = false;
    for (let i = 0; i < n; i++) {
      const l = cand[i];
      const cars = this.rng.randInt(1, d > 0.35 ? 4 : 3);
      const ramp = this.rng.chance(0.45) && this.lastEnd[l] < s - 4;
      const s0 = s + (ramp ? RAMP_LEN : 0) + this.rng.rand(0, 4);
      const tr = this.obstacles.spawnTrain(l, s0, cars, { ramp });
      const end = s0 + tr.len;
      this.blockedUntil[l] = end;
      this.lastEnd[l] = end + 4; // room to drop off the back of the train
      this.lastObstacle[l] = end;
      if (ramp && !coinsPlaced && this.rng.chance(0.8)) {
        coinsPlaced = true;
        const rampStart = s0 - RAMP_LEN;
        const count = Math.floor((end - 1 - (rampStart + 1)) / 1.8);
        this.pickups.addCoinLine(l, rampStart + 1, Math.min(count, 22), 1.8, (cs) =>
          (cs < s0 ? (TRAIN_H * (cs - rampStart)) / RAMP_LEN : TRAIN_H) + 0.9);
      } else if (!ramp && !coinsPlaced && this.rng.chance(0.3)) {
        coinsPlaced = true;
        this.pickups.addCoinLine(l, s0 + 1, Math.min(Math.floor((tr.len - 2) / 1.8), 20), 1.8, null, TRAIN_H + 0.9);
      }
    }
    if (!coinsPlaced) this.coinsInFreeLane(s, 8);
    return true;
  }

  placeBarriers(s, d) {
    const cand = this.rng.shuffle(L.filter((l) => this.free(l, s, 5)));
    if (!cand.length) return false;
    let n = this.rng.weighted([[1, 0.45], [2, 0.4], [3, 0.15 + 0.15 * d]]);
    n = Math.min(n, cand.length);
    let arcDone = false;
    for (let i = 0; i < n; i++) {
      const l = cand[i];
      const kind = this.rng.chance(0.55) ? 'low' : 'high';
      this.obstacles.spawnBarrier(l, s, kind);
      this.lastEnd[l] = s + 1;
      this.lastObstacle[l] = s;
      if (kind === 'low' && !arcDone && this.rng.chance(0.7)) {
        arcDone = true;
        // coins arcing over the barrier along a jump trajectory
        const half = 5;
        for (let k = -half; k <= half; k += 1.25) {
          const t = k / half;
          this.pickups.addCoin(this.laneX(l), 0.9 + (JUMP_HEIGHT - 0.1) * (1 - t * t), s + k);
        }
        this.lastEnd[l] = s + half + 1;
      }
    }
    if (!arcDone) this.coinsInFreeLane(s - 6, 7);
    return true;
  }

  placeMoving(s, d) {
    const reach = 60;
    const cand = this.rng.shuffle(L.filter((l) =>
      this.lastObstacle[l] < s - reach && this.blockedUntil[l] < s - reach && this.blockedCount(s - reach, l) <= 1));
    if (!cand.length) return false;
    const l = cand[0];
    const cars = this.rng.randInt(1, d > 0.5 ? 3 : 2);
    const tr = this.obstacles.spawnTrain(l, s, cars, { moving: true });
    // clear any coins the oncoming train would plough through
    this.pickups.removeCoins(this.laneX(l), s - reach, s + tr.len);
    this.blockedUntil[l] = s + tr.len;
    this.lastEnd[l] = s + tr.len + 4;
    this.lastObstacle[l] = s + tr.len;
    this.coinsInFreeLane(s - 10, 9, l);
    return true;
  }

  placeMixed(s, d) {
    const trainPlaced = this.placeTrains(s, d, 1);
    const bs = s + this.rng.rand(3, 9);
    const cand = this.rng.shuffle(L.filter((l) => this.free(l, bs, 5)));
    if (!cand.length) return trainPlaced;
    const l = cand[0];
    this.obstacles.spawnBarrier(l, bs, this.rng.chance(0.5) ? 'low' : 'high');
    this.lastEnd[l] = bs + 1;
    this.lastObstacle[l] = bs;
    return true;
  }

  placeCoinRun(s, speed) {
    const cand = this.rng.shuffle(L.filter((l) => this.free(l, s, 2)));
    if (!cand.length) return;
    let lane = cand[0];
    let cs = s;
    const count = this.rng.randInt(8, 14);
    for (let i = 0; i < count; i++, cs += 1.8) {
      this.pickups.addCoin(this.laneX(lane), 0.9, cs);
      if (i === Math.floor(count / 2) && this.rng.chance(0.5)) {
        const next = lane === 1 ? (this.rng.chance(0.5) ? 0 : 2) : 1;
        if (this.free(next, cs, 2)) {
          this.lastEnd[lane] = Math.max(this.lastEnd[lane], cs + 2);
          lane = next;
        }
      }
    }
    this.lastEnd[lane] = Math.max(this.lastEnd[lane], cs + 2);
    void speed;
  }

  coinsInFreeLane(s, count, avoid = -1) {
    const len = count * 1.8;
    const cand = this.rng.shuffle(L.filter((l) => l !== avoid && this.blockedUntil[l] < s && this.lastEnd[l] < s - 1 &&
      this.blockedUntil[l] < s + len));
    if (!cand.length) return;
    const l = cand[0];
    const end = this.pickups.addCoinLine(l, s, count, 1.8);
    this.lastEnd[l] = Math.max(this.lastEnd[l], end + 2);
  }

  maybePowerup(s) {
    if (s < this.nextPowerup) return;
    const ps = s + 4;
    const cand = this.rng.shuffle(L.filter((l) => this.free(l, ps, 3)));
    if (!cand.length) return;
    const l = cand[0];
    const type = this.rng.weighted([['jetpack', 0.22], ['sneakers', 0.25], ['magnet', 0.3], ['multiplier', 0.23]]);
    this.pickups.addPowerup(type, this.laneX(l), 0.6, ps);
    this.lastEnd[l] = Math.max(this.lastEnd[l], ps + 4);
    this.nextPowerup = s + this.rng.rand(260, 420);
  }

  laneX(l) {
    return (l - 1) * 2.5;
  }
}
