// Shared configuration: tune values live here, no game logic.

export const ARENA = 50; // half-size, world is -ARENA..ARENA on X/Z

// -------- THEMES (cycle on level-up) --------
export const THEMES = [
  { name: 'CEMETERY',  fog: 0x0a0614, ground: 0x1a0c2e, grid1: 0xff3cac, grid2: 0x3a1050, hemi1: 0xff3cac, hemi2: 0x110022, lamp: 0xff3cac, sky: 0x0a0614, enemyTint: 0xff3cac },
  { name: 'TOXIC',     fog: 0x041a0a, ground: 0x0d2a12, grid1: 0x00ff66, grid2: 0x104020, hemi1: 0x00ff66, hemi2: 0x002211, lamp: 0x00ff66, sky: 0x041a0a, enemyTint: 0x00ff44 },
  { name: 'ICE',       fog: 0x0a1428, ground: 0x102238, grid1: 0x4ff7ff, grid2: 0x123a5a, hemi1: 0x4ff7ff, hemi2: 0x001122, lamp: 0x4ff7ff, sky: 0x0a1428, enemyTint: 0x4ff7ff },
  { name: 'INFERNO',   fog: 0x200806, ground: 0x2a0a08, grid1: 0xff6a1a, grid2: 0x4a1808, hemi1: 0xff6a1a, hemi2: 0x220400, lamp: 0xff6a1a, sky: 0x200806, enemyTint: 0xff4422 },
  { name: 'VOID',      fog: 0x1a0830, ground: 0x220c3c, grid1: 0xe63aff, grid2: 0x4a1866, hemi1: 0xe63aff, hemi2: 0x0a0020, lamp: 0xe63aff, sky: 0x1a0830, enemyTint: 0xbb00ff },
  { name: 'SOLAR',     fog: 0x2a2000, ground: 0x2a2408, grid1: 0xffd93d, grid2: 0x4a3810, hemi1: 0xffd93d, hemi2: 0x221800, lamp: 0xffd93d, sky: 0x2a2000, enemyTint: 0xffbb00 },
  { name: 'MATRIX',    fog: 0x001a08, ground: 0x001a0c, grid1: 0x00ff44, grid2: 0x002211, hemi1: 0x00ff44, hemi2: 0x001100, lamp: 0x00ff44, sky: 0x001a08, enemyTint: 0x00ffaa },
];

// -------- WEAPONS --------
// Each weapon completely replaces firing behavior. Starter is 'pistol'.
export const WEAPONS = {
  pistol: {
    name: 'PISTOL',
    fireRate: 0.16,     // seconds between shots
    damage: 25,
    bullets: 1,
    spread: 0.04,
    speed: 40,
    slot: 'pistol',
    color: 0x4ff7ff,
  },
  shotgun: {
    name: 'SHOTGUN',
    fireRate: 0.55,
    damage: 18,
    bullets: 6,
    spread: 0.28,
    speed: 36,
    slot: 'shotgun',
    color: 0xff8800,
  },
  smg: {
    name: 'SMG',
    fireRate: 0.07,
    damage: 14,
    bullets: 1,
    spread: 0.12,
    speed: 44,
    slot: 'smg',
    color: 0xff3cac,
  },
  sniper: {
    name: 'SNIPER',
    fireRate: 0.9,
    damage: 180,
    bullets: 1,
    spread: 0,
    speed: 90,
    slot: 'sniper',
    color: 0x00ff66,
  },
};

// -------- WAVE DEFINITIONS --------
// Wave types: 'combat' (kill all), 'capture' (defend zone), 'boss' (kill boss)
// killTarget = number of enemies to kill
// enemies = weighted spawn table
export function getWaveDef(wave) {
  // Every 5th wave is a boss
  if (wave % 5 === 0) {
    return {
      type: 'boss',
      killTarget: 1,
      enemies: { zomeeb: 0.7, sprinter: 0.3 }, // minions during boss fight
      spawnRate: 1.4,
      bossType: ['MEGA_ZOMEEB', 'BRUTE_KING', 'VOID_LORD', 'SOLAR_TYRANT'][Math.floor(wave / 5 - 1) % 4],
      reward: null, // bosses drop weapons directly
    };
  }
  // Every 3rd wave is a capture objective that grants a weapon
  if (wave % 3 === 0) {
    const weaponRewards = ['shotgun', 'smg', 'sniper'];
    return {
      type: 'capture',
      killTarget: 8 + wave * 2,
      enemies: waveEnemyMix(wave),
      spawnRate: Math.min(3.5, 1 + wave * 0.2),
      captureTime: 6, // seconds to hold the zone
      reward: weaponRewards[Math.floor(wave / 3 - 1) % weaponRewards.length],
    };
  }
  // Normal combat wave
  return {
    type: 'combat',
    killTarget: 10 + wave * 3 + wave * wave * 0.3 | 0,
    enemies: waveEnemyMix(wave),
    spawnRate: Math.min(4, 1 + wave * 0.22),
    reward: null,
  };
}

function waveEnemyMix(wave) {
  if (wave <= 2) return { zomeeb: 1.0 };
  if (wave <= 4) return { zomeeb: 0.75, sprinter: 0.25 };
  if (wave <= 6) return { zomeeb: 0.55, sprinter: 0.30, brute: 0.15 };
  if (wave <= 9) return { zomeeb: 0.40, sprinter: 0.30, brute: 0.20, spitter: 0.10 };
  return { zomeeb: 0.30, sprinter: 0.30, brute: 0.20, spitter: 0.15, phantom: 0.05 };
}

// -------- ENEMY TYPES --------
export const ENEMY_TYPES = {
  zomeeb:   { speed: 2.2, hp: 55,  xp: 3, score: 400,  scale: 1.0,  damage: 12, name: 'ZOMEEB' },
  sprinter: { speed: 4.0, hp: 30,  xp: 2, score: 250,  scale: 0.85, damage: 10, name: 'SPRINTER' },
  brute:    { speed: 1.2, hp: 180, xp: 6, score: 1200, scale: 1.45, damage: 22, name: 'BRUTE' },
  spitter:  { speed: 1.8, hp: 65,  xp: 4, score: 700,  scale: 1.05, damage: 8,  name: 'SPITTER', ranged: true, range: 14 },
  phantom:  { speed: 3.2, hp: 45,  xp: 5, score: 900,  scale: 1.0,  damage: 15, name: 'PHANTOM', phases: true },
};

// -------- BOSSES --------
export const BOSSES = {
  MEGA_ZOMEEB: { hp: 1500, speed: 1.1, damage: 30, xp: 40, score: 15000, scale: 3.2, name: 'MEGA ZOMEEB' },
  BRUTE_KING:  { hp: 2800, speed: 0.9, damage: 40, xp: 60, score: 25000, scale: 3.8, name: 'BRUTE KING' },
  VOID_LORD:   { hp: 4000, speed: 1.5, damage: 35, xp: 80, score: 40000, scale: 3.4, name: 'VOID LORD' },
  SOLAR_TYRANT:{ hp: 6000, speed: 1.3, damage: 45, xp: 100, score: 60000, scale: 4.0, name: 'SOLAR TYRANT' },
};

// -------- PLAYER --------
export const PLAYER = {
  scale: 1.8,             // hero scale — make them feel BIG
  baseSpeed: 7,
  dashSpeed: 3.2,         // multiplier
  dashDuration: 0.18,
  dashCooldown: 1.6,
  hpMax: 100,
};
