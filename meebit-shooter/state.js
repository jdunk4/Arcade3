import { PLAYER, WEAPONS } from './config.js';

// Global mutable state. Single source of truth for game.
export const S = {
  phase: 'loading',      // 'loading' | 'call' | 'title' | 'playing' | 'wave-break' | 'gameover'
  running: false,
  paused: false,

  // Score & progression
  score: 0,
  kills: 0,
  wave: 1,
  waveKillTarget: 10,
  waveKillsProgress: 0,
  waveActive: true,      // false during intermissions
  timeElapsed: 0,

  // Player
  hp: PLAYER.hpMax,
  hpMax: PLAYER.hpMax,
  xp: 0,
  xpNext: 10,
  level: 1,
  playerSpeed: PLAYER.baseSpeed,

  // Weapons
  currentWeapon: 'pistol',
  ownedWeapons: new Set(['pistol']),
  fireCooldown: 0,

  // Abilities
  dashCooldown: 0,
  dashActive: 0,
  shields: 0,
  invulnTimer: 0,

  // Wave/boss refs
  bossRef: null,         // active boss enemy object
  objectiveZone: null,   // capture zone mesh
  captureProgress: 0,    // seconds held
  captureTarget: 0,

  // Visual polish
  shakeAmt: 0,
  shakeTime: 0,
  muzzleTimer: 0,
  recoilTimer: 0,

  // XP wave clear threshold
  xpClearThreshold: 50,  // when accumulated since wave start hits this, trigger nuke
  xpSinceWave: 0,
};

export const keys = {};
export const mouse = { worldX: 0, worldZ: 0, down: false };
export const joyState = { active: false, dx: 0, dy: 0, cx: 0, cy: 0 };

export function resetGame() {
  S.phase = 'playing';
  S.running = true;
  S.paused = false;
  S.score = 0;
  S.kills = 0;
  S.wave = 1;
  S.waveKillTarget = 10;
  S.waveKillsProgress = 0;
  S.waveActive = true;
  S.timeElapsed = 0;
  S.hp = PLAYER.hpMax;
  S.hpMax = PLAYER.hpMax;
  S.xp = 0;
  S.xpNext = 10;
  S.level = 1;
  S.playerSpeed = PLAYER.baseSpeed;
  S.currentWeapon = 'pistol';
  S.ownedWeapons = new Set(['pistol']);
  S.fireCooldown = 0;
  S.dashCooldown = 0;
  S.dashActive = 0;
  S.shields = 0;
  S.invulnTimer = 1.0;
  S.bossRef = null;
  S.objectiveZone = null;
  S.captureProgress = 0;
  S.captureTarget = 0;
  S.shakeAmt = 0;
  S.shakeTime = 0;
  S.muzzleTimer = 0;
  S.recoilTimer = 0;
  S.xpSinceWave = 0;
}

export function getWeapon() {
  return WEAPONS[S.currentWeapon];
}

export function shake(amt, time) {
  S.shakeAmt = Math.max(S.shakeAmt, amt);
  S.shakeTime = Math.max(S.shakeTime, time);
}
