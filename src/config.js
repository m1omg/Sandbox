// Gameplay tuning. Distances are in world units (roughly metres), times in seconds.
// The simulation runs on a fixed timestep so behaviour is identical at any display refresh rate.

export const STEP = 1 / 120;          // fixed simulation step
export const MAX_FRAME_TIME = 0.25;   // clamp for long frames (tab switches, hitches)

export const LANES = [-2.5, 0, 2.5];
export const LANE_HALF = 1.25;        // half the distance between lane centres

export const SPEED_START = 17;
export const SPEED_MAX = 34;
export const SPEED_TAU = 110;         // speed approaches max with this time constant

export const GRAVITY = 60;
export const JUMP_HEIGHT = 1.9;
export const SNEAKER_JUMP_HEIGHT = 4.3;
export const FAST_DROP_SPEED = 32;
export const ROLL_TIME = 0.62;
export const LATERAL_SPEED = 2.5 / 0.14; // lane switch in ~0.14 s
export const JUMP_BUFFER = 0.12;
export const COYOTE_TIME = 0.08;
export const STEP_UP = 0.45;          // max height the runner can step onto without a crash

export const PLAYER_HALF_W = 0.3;
export const PLAYER_HALF_D = 0.3;
export const PLAYER_H = 1.5;
export const PLAYER_ROLL_H = 0.7;

export const TRAIN_W = 2.3;
export const TRAIN_HALF_COLL = 1.1;
export const TRAIN_H = 2.9;
export const CAR_LEN = 12;
export const CAR_GAP = 0.5;
export const RAMP_LEN = 7.5;
export const MOVING_TRAIN_SPEED = 11;
export const MOVING_ACTIVATE = 110;   // moving trains start rolling once the runner is this close

export const BARRIER_HALF_COLL = 1.15;
export const LOW_BARRIER_H = 1.0;
export const HIGH_BARRIER_Y0 = 1.3;
export const HIGH_BARRIER_Y1 = 2.45;

export const SPAWN_AHEAD = 200;
export const DESPAWN_BEHIND = 30;
export const FOG_NEAR = 70;
export const FOG_FAR = 185;

export const CHASER_NEAR = 2.0;
export const CHASER_FAR = 22;
export const CHASE_TIME = 5;          // how long the warden stays close after a stumble
export const INTRO_CHASE_TIME = 2.6;

export const JETPACK_ALT = 6.2;
export const HOVERBOARD_TIME = 30;
export const HOVERBOARD_COST = 250;

export const POWERUPS = {
  jetpack:    { base: 8,  per: 1.5, label: 'Jetpack',        color: '#ff5a4f' },
  sneakers:   { base: 10, per: 2,   label: 'Spring Sneakers', color: '#5fd64b' },
  magnet:     { base: 10, per: 2,   label: 'Coin Magnet',    color: '#ff3d7a' },
  multiplier: { base: 12, per: 2.5, label: '2x Score',       color: '#ffb800' },
};
export const POWERUP_TYPES = Object.keys(POWERUPS);
export const UPGRADE_COSTS = [300, 750, 1500, 3000, 6000];
export const MAX_UPGRADE = UPGRADE_COSTS.length;

export function powerupDuration(type, level) {
  const p = POWERUPS[type];
  return p.base + p.per * level;
}

export const SKY_COLOR = 0x6ec3fc;
export const FOG_COLOR = 0xf3e7cf;
