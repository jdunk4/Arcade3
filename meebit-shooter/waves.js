import * as THREE from 'three';
import { S, shake } from './state.js';
import { getWaveDef, WEAPONS, THEMES } from './config.js';
import { Audio } from './audio.js';
import { UI } from './ui.js';
import { enemies, makeEnemy, makeBoss, clearAllEnemies } from './enemies.js';
import { makePickup, makeCaptureZone, removeCaptureZone, hitBurst } from './effects.js';
import { applyTheme } from './scene.js';
import { player } from './player.js';

let waveDef = null;
let spawnCooldown = 0;
let intermissionActive = false;

export function getWaveDef_current() { return waveDef; }

export function startWave(waveNum) {
  S.wave = waveNum;
  waveDef = getWaveDef(waveNum);
  S.waveKillTarget = waveDef.killTarget;
  S.waveKillsProgress = 0;
  S.waveActive = true;
  S.xpSinceWave = 0;
  spawnCooldown = 0;
  intermissionActive = false;

  applyTheme(waveNum - 1);

  if (waveDef.type === 'boss') {
    spawnBoss();
    UI.showBossBar(waveDef.bossType.replace(/_/g, ' '));
    UI.toast(waveDef.bossType.replace(/_/g, ' ') + ' APPROACHES', '#ff2e4d', 2000);
  } else if (waveDef.type === 'capture') {
    const angle = Math.random() * Math.PI * 2;
    const dist = 18;
    S.objectiveZone = makeCaptureZone(Math.cos(angle) * dist, Math.sin(angle) * dist);
    S.captureProgress = 0;
    S.captureTarget = waveDef.captureTime;
    UI.showObjective('RUN TO THE GOLDEN ZONE', 'Hold for ' + waveDef.captureTime + 's to earn the ' + WEAPONS[waveDef.reward].name);
  }

  UI.showWaveStart(waveNum);
  Audio.waveStart();
  shake(0.3, 0.3);
}

export function updateWaves(dt) {
  if (!S.waveActive || !waveDef) return;

  spawnCooldown -= dt;
  const liveNonBosses = enemies.filter(e => !e.isBoss).length;

  // Spawn
  if (waveDef.type !== 'boss' || liveNonBosses < 8) {
    const maxOnScreen = waveDef.type === 'boss' ? 10 : 40 + S.wave * 2;
    if (spawnCooldown <= 0 && liveNonBosses < maxOnScreen) {
      spawnCooldown = Math.max(0.15, 0.9 / waveDef.spawnRate);
      const count = Math.min(3, 1 + Math.floor(S.wave / 3));
      for (let i = 0; i < count; i++) spawnFromMix(waveDef.enemies);
    }
  }

  // Capture progress
  if (waveDef.type === 'capture' && S.objectiveZone) {
    // Animate the zone to be VERY obvious
    const zone = S.objectiveZone;
    zone.ring.rotation.z += dt * 2;
    zone.beam.scale.x = zone.beam.scale.z = 1 + Math.sin(S.timeElapsed * 4) * 0.3;
    zone.beam.material.opacity = 0.4 + Math.sin(S.timeElapsed * 5) * 0.2;

    const dx = player.pos.x - zone.pos.x;
    const dz = player.pos.z - zone.pos.z;
    const distSq = dx * dx + dz * dz;
    const inside = distSq < 9; // 3 unit radius

    if (inside) {
      S.captureProgress += dt;
      zone.inner.material.opacity = 0.15 + 0.35 * (S.captureProgress / S.captureTarget);
      const remaining = Math.max(0, S.captureTarget - S.captureProgress);
      UI.showObjective('CAPTURING... ' + remaining.toFixed(1) + 's', 'Stay in the zone!');
      if (S.captureProgress >= S.captureTarget) {
        grantWeapon(waveDef.reward);
        endWave();
      }
    } else {
      S.captureProgress = Math.max(0, S.captureProgress - dt * 0.5);
      const dist = Math.sqrt(distSq);
      UI.showObjective('RUN TO GOLDEN ZONE', '→ ' + Math.round(dist) + 'm away · EARN ' + WEAPONS[waveDef.reward].name);
    }
  }

  // Combat wave kill target check
  if (waveDef.type === 'combat' && S.waveKillsProgress >= S.waveKillTarget) {
    endWave();
  }
}

function spawnFromMix(mix) {
  let total = 0;
  for (const v of Object.values(mix)) total += v;
  let r = Math.random() * total;
  let type = 'zomeeb';
  for (const [k, v] of Object.entries(mix)) {
    if (r < v) { type = k; break; }
    r -= v;
  }
  const angle = Math.random() * Math.PI * 2;
  const dist = 28 + Math.random() * 12;
  const x = Math.max(-48, Math.min(48, player.pos.x + Math.cos(angle) * dist));
  const z = Math.max(-48, Math.min(48, player.pos.z + Math.sin(angle) * dist));
  const theme = THEMES[(S.wave - 1) % THEMES.length];
  makeEnemy(type, theme.enemyTint, new THREE.Vector3(x, 0, z));
}

function spawnBoss() {
  const theme = THEMES[(S.wave - 1) % THEMES.length];
  const angle = Math.random() * Math.PI * 2;
  const pos = new THREE.Vector3(Math.cos(angle) * 18, 0, Math.sin(angle) * 18);
  S.bossRef = makeBoss(waveDef.bossType, theme.enemyTint, pos);
}

function grantWeapon(weaponId) {
  S.ownedWeapons.add(weaponId);
  S.currentWeapon = weaponId;
  UI.updateWeaponSlots();
  UI.toast('+' + WEAPONS[weaponId].name + ' UNLOCKED! Press ' + weaponSlotKey(weaponId) + ' to equip', '#ffd93d', 3000);
  Audio.weaponGet();
}

function weaponSlotKey(weaponId) {
  return { pistol: 1, shotgun: 2, smg: 3, sniper: 4 }[weaponId];
}

export function onEnemyKilled(enemy) {
  if (enemy.isBoss) {
    UI.hideBossBar();
    S.bossRef = null;
    grantBossReward();
    endWave();
  } else {
    S.waveKillsProgress++;
  }
}

function grantBossReward() {
  const all = ['shotgun', 'smg', 'sniper'];
  const missing = all.filter(w => !S.ownedWeapons.has(w));
  if (missing.length > 0) {
    grantWeapon(missing[0]);
  } else {
    S.score += 10000;
    UI.toast('+10,000 SCORE', '#ffd93d', 2000);
  }
}

function endWave() {
  if (intermissionActive) return;
  intermissionActive = true;
  S.waveActive = false;

  triggerNuke();

  if (S.objectiveZone) {
    removeCaptureZone(S.objectiveZone);
    S.objectiveZone = null;
    UI.hideObjective();
  }

  let count = 3;
  UI.showWaveBanner(count);
  const tick = () => {
    Audio.countdown();
    count--;
    if (count <= 0) {
      UI.hideWaveBanner();
      startWave(S.wave + 1);
    } else {
      UI.showWaveBanner(count);
      setTimeout(tick, 800);
    }
  };
  setTimeout(tick, 1200);
}

function triggerNuke() {
  shake(0.8, 0.8);
  Audio.bigBoom();
  const origin = new THREE.Vector3(player.pos.x, 1, player.pos.z);
  hitBurst(origin, 0xffffff, 30);
  setTimeout(() => hitBurst(origin, 0xffd93d, 30), 80);
  setTimeout(() => hitBurst(origin, 0xff3cac, 30), 160);
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    if (e.isBoss) continue;
    const epos = e.pos.clone(); epos.y = 1;
    hitBurst(epos, 0xff3cac, 4);
    S.score += Math.floor(e.scoreVal * 0.5);
    S.kills++;
    e.obj.parent && e.obj.parent.remove(e.obj);
    enemies.splice(i, 1);
  }
}

export function resetWaves() {
  clearAllEnemies();
  if (S.objectiveZone) {
    removeCaptureZone(S.objectiveZone);
    S.objectiveZone = null;
  }
  UI.hideBossBar();
  UI.hideObjective();
  UI.hideWaveBanner();
  waveDef = null;
  spawnCooldown = 0;
  intermissionActive = false;
}
