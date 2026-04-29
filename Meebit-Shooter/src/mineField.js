// mineField.js — Anti-personnel mines deployed by the MINE FIELD
// stratagem. Three damage kinds, selectable per stratagem code:
//
//   'explosion' — high-burst AoE damage on detonation. Standard
//                 frag mine; reads as the chapter-tinted classic.
//   'fire'      — smaller burst + leaves a fire patch that ticks
//                 DPS for ~3.5s. Color-shifted toward warm orange.
//   'poison'    — green-tinted mine that puffs a toxic cloud on
//                 trigger. Lower burst damage but applies a 4-second
//                 poison DoT to any enemy in cloud radius.
//
// Mines lay flat on the floor, sit dormant until an enemy steps
// within trigger radius, then beep for ~0.45s before firing.
//
// Public API:
//   deployMineField(centerPos, tint, kind)  — scatter mines around
//                                             centerPos. kind defaults
//                                             to 'explosion'.
//   updateMines(dt)                         — per-frame tick (proximity,
//                                             arming, detonation, fire-patch
//                                             ticking, poison-cloud DPS).
//   clearAllMines()                         — wipe all (game reset).

import * as THREE from 'three';
import { scene } from './scene.js';
import { hitBurst } from './effects.js';
import { enemies } from './enemies.js';

const MINE_COUNT          = 12;
const MINE_SPREAD_RADIUS  = 5.5;
const MINE_TRIGGER_RADIUS = 1.6;
const MINE_BEEP_DUR       = 0.45;          // arming/warning before detonation

// =====================================================================
// PER-KIND TUNING
// =====================================================================
// Each kind is a knob set tuned for a distinct combat role.
const _KIND_CONFIG = {
  explosion: {
    aoeRadius: 3.4,
    aoeDamage: 200,
    bodyColor: 0x2a2c34,                      // dark gunmetal
    lightHex:  null,                          // null = use chapter tint
    burstColor: 0xffaa00,
    secondaryBurstColor: 0xff5520,
    spawnPatch: false,
    spawnPoisonCloud: false,
  },
  fire: {
    aoeRadius: 2.6,
    aoeDamage: 130,
    bodyColor: 0x3a1f12,                      // scorched brown
    lightHex:  0xff7a30,                      // orange override
    burstColor: 0xff5520,
    secondaryBurstColor: 0xffaa00,
    spawnPatch: true,
    patchRadius: 2.6,
    patchDur: 3.5,
    patchDps: 70,
    patchColor: 0xff5520,
    spawnPoisonCloud: false,
  },
  poison: {
    aoeRadius: 3.0,
    aoeDamage: 80,                            // smaller burst
    bodyColor: 0x1f2a14,                      // dark moss
    lightHex:  0x7af797,                      // bright green override
    burstColor: 0x7af797,
    secondaryBurstColor: 0xb3ffd0,
    spawnPatch: false,
    spawnPoisonCloud: true,
    cloudRadius: 3.4,
    cloudDur: 4.0,
    cloudDps: 55,
    cloudColor: 0x7af797,
  },
};

// =====================================================================
// SHARED GEOMETRY
// =====================================================================
const _MINE_BASE_GEO   = new THREE.CylinderGeometry(0.32, 0.36, 0.18, 14);
const _MINE_LIGHT_GEO  = new THREE.SphereGeometry(0.10, 10, 8);
const _PATCH_GEO       = new THREE.CircleGeometry(1.0, 28);
const _CLOUD_PUFF_GEO  = new THREE.SphereGeometry(0.55, 10, 8);

const _activeMines = [];
const _activePatches = [];      // fire patches from 'fire' mines
const _activeClouds = [];       // poison clouds from 'poison' mines

// =====================================================================
// DEPLOY
// =====================================================================
export function deployMineField(centerPos, tint, kind) {
  const k = (kind && _KIND_CONFIG[kind]) ? kind : 'explosion';
  const cfg = _KIND_CONFIG[k];
  // Light tint — kinds that override get their fixed color; others
  // ride the chapter tint so the field reads as part of the level.
  const lightHex = cfg.lightHex != null ? cfg.lightHex : tint;
  const lightColor = new THREE.Color(lightHex);

  for (let i = 0; i < MINE_COUNT; i++) {
    // Distribute around a ring with jitter so the field doesn't read
    // as a perfect circle.
    const a = (i / MINE_COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
    const r = MINE_SPREAD_RADIUS * (0.4 + Math.random() * 0.7);
    const x = centerPos.x + Math.cos(a) * r;
    const z = centerPos.z + Math.sin(a) * r;

    const baseMat = new THREE.MeshStandardMaterial({
      color: cfg.bodyColor,
      emissive: lightColor,
      emissiveIntensity: 0.4,
      roughness: 0.55,
      metalness: 0.70,
    });
    const lightMat = new THREE.MeshBasicMaterial({
      color: lightColor,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });

    const root = new THREE.Group();
    root.position.set(x, 0.09, z);
    const base = new THREE.Mesh(_MINE_BASE_GEO, baseMat);
    root.add(base);
    const light = new THREE.Mesh(_MINE_LIGHT_GEO, lightMat);
    light.position.y = 0.12;
    root.add(light);
    scene.add(root);

    _activeMines.push({
      root, base, baseMat,
      light, lightMat,
      kind: k,
      cfg,
      tint,                                   // chapter tint for non-overridden FX
      pos: new THREE.Vector3(x, 0, z),
      armed: true,
      beeping: false,
      beepT: 0,
      detonated: false,
      detonateT: 0,
      pulsePhase: Math.random() * Math.PI * 2,
    });
  }
}

// =====================================================================
// PER-FRAME TICK
// =====================================================================
export function updateMines(dt) {
  // --- Mines ---
  for (let i = _activeMines.length - 1; i >= 0; i--) {
    const m = _activeMines[i];
    if (!m.beeping && !m.detonated) {
      // Idle pulse on the light.
      m.pulsePhase += dt * 1.5;
      m.lightMat.opacity = 0.6 + 0.35 * Math.sin(m.pulsePhase);
      // Proximity check.
      const r2 = MINE_TRIGGER_RADIUS * MINE_TRIGGER_RADIUS;
      for (let j = 0; j < enemies.length; j++) {
        const e = enemies[j];
        if (!e || !e.pos || e.dying) continue;
        const dx = e.pos.x - m.pos.x;
        const dz = e.pos.z - m.pos.z;
        if (dx * dx + dz * dz < r2) {
          m.beeping = true;
          m.beepT = 0;
          break;
        }
      }
    } else if (m.beeping && !m.detonated) {
      m.beepT += dt;
      // Fast pulse during the beep window.
      const pulse = 0.5 + 0.5 * Math.sin(m.beepT * 28);
      m.lightMat.opacity = 0.4 + pulse * 0.6;
      m.baseMat.emissiveIntensity = 0.4 + pulse * 1.0;
      if (m.beepT >= MINE_BEEP_DUR) {
        _detonateMine(m);
      }
    } else if (m.detonated) {
      // Brief lingering smoke — disposed at end.
      m.detonateT += dt;
      if (m.detonateT > 0.6) {
        _disposeMine(m);
        _activeMines.splice(i, 1);
      }
    }
  }

  // --- Fire patches (from 'fire' mines) ---
  for (let i = _activePatches.length - 1; i >= 0; i--) {
    const p = _activePatches[i];
    p.life += dt;
    const f = p.life / p.ttl;
    if (f >= 1) {
      if (p.disc.parent) p.disc.parent.remove(p.disc);
      if (p.mat) p.mat.dispose();
      _activePatches.splice(i, 1);
      continue;
    }
    // Pulse + fade.
    const pulse = 0.5 + 0.5 * Math.sin(p.life * 7);
    p.mat.opacity = (0.55 + pulse * 0.20) * (1 - f * 0.6);
    // Damage enemies inside the patch.
    const r2 = p.radius * p.radius;
    for (let j = 0; j < enemies.length; j++) {
      const e = enemies[j];
      if (!e || !e.pos || e.dying) continue;
      const dx = e.pos.x - p.pos.x;
      const dz = e.pos.z - p.pos.z;
      if (dx * dx + dz * dz < r2) {
        e.hp -= p.dps * dt;
      }
    }
  }

  // --- Poison clouds (from 'poison' mines) ---
  for (let i = _activeClouds.length - 1; i >= 0; i--) {
    const c = _activeClouds[i];
    c.life += dt;
    const f = c.life / c.ttl;
    if (f >= 1) {
      for (const puff of c.puffs) {
        if (puff.mesh.parent) puff.mesh.parent.remove(puff.mesh);
        if (puff.mat) puff.mat.dispose();
      }
      _activeClouds.splice(i, 1);
      continue;
    }
    // Drift + dissipate puffs.
    for (const puff of c.puffs) {
      puff.pos.x += puff.vel.x * dt;
      puff.pos.y += puff.vel.y * dt;
      puff.pos.z += puff.vel.z * dt;
      puff.mesh.position.copy(puff.pos);
      // Slow the drift over time so puffs settle.
      puff.vel.multiplyScalar(0.985);
      // Grow + fade.
      const localF = (c.life - puff.delay) / Math.max(0.001, puff.ttl);
      const lf = Math.max(0, Math.min(1, localF));
      const s = 1.0 + lf * 1.6;
      puff.mesh.scale.setScalar(s);
      puff.mat.opacity = (0.45 + 0.15 * Math.sin(c.life * 4 + puff.phase)) * (1 - f);
    }
    // Damage enemies inside the cloud.
    const r2 = c.radius * c.radius;
    for (let j = 0; j < enemies.length; j++) {
      const e = enemies[j];
      if (!e || !e.pos || e.dying) continue;
      const dx = e.pos.x - c.pos.x;
      const dz = e.pos.z - c.pos.z;
      if (dx * dx + dz * dz < r2) {
        e.hp -= c.dps * dt;
      }
    }
  }
}

// =====================================================================
// DETONATION
// =====================================================================
function _detonateMine(m) {
  m.detonated = true;
  m.detonateT = 0;
  // Hide the mine body but leave the group for the linger window so
  // the FX has somewhere reasonable to anchor (though hitBurst is
  // pos-based and doesn't actually need it).
  if (m.base.parent) m.base.visible = false;
  if (m.light.parent) m.light.visible = false;

  const cfg = m.cfg;
  // Burst-style AoE damage in the configured radius.
  const r2 = cfg.aoeRadius * cfg.aoeRadius;
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (!e || !e.pos || e.dying) continue;
    const dx = e.pos.x - m.pos.x;
    const dz = e.pos.z - m.pos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < r2) {
      const falloff = 1 - Math.sqrt(d2) / cfg.aoeRadius;
      e.hp -= cfg.aoeDamage * falloff;
      e.hitFlash = 0.18;
    }
  }

  // FX — burst plume colored to the mine kind.
  const pos = m.pos.clone();
  pos.y = 0.5;
  hitBurst(pos, 0xffffff, 14);
  hitBurst(pos, cfg.burstColor, 18);
  setTimeout(() => hitBurst(pos, cfg.secondaryBurstColor, 12), 50);

  // Per-kind aftermath.
  if (cfg.spawnPatch) {
    _spawnFirePatch(m.pos, cfg);
  }
  if (cfg.spawnPoisonCloud) {
    _spawnPoisonCloud(m.pos, cfg);
  }

  // Notify any tutorial observer that a mine fired. We pass the kind
  // so the lesson can branch if it ever wants to (the current bonus
  // lesson watches for any detonation, kind-agnostic).
  if (typeof window !== 'undefined' && window.__bonusObserve && window.__bonusObserve.onMineDetonate) {
    try { window.__bonusObserve.onMineDetonate(m.kind); } catch (e) {}
  }
}

// =====================================================================
// FIRE PATCH (fire mine aftermath)
// =====================================================================
function _spawnFirePatch(pos, cfg) {
  const mat = new THREE.MeshBasicMaterial({
    color: cfg.patchColor,
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const disc = new THREE.Mesh(_PATCH_GEO, mat);
  disc.rotation.x = -Math.PI / 2;
  disc.position.set(pos.x, 0.06, pos.z);
  disc.scale.set(cfg.patchRadius, cfg.patchRadius, 1);
  scene.add(disc);
  _activePatches.push({
    disc, mat,
    pos: pos.clone(),
    radius: cfg.patchRadius,
    dps: cfg.patchDps,
    life: 0,
    ttl: cfg.patchDur,
  });
}

// =====================================================================
// POISON CLOUD (poison mine aftermath)
// =====================================================================
// A cloud is several drifting additive puffs covering an area — they
// share a damage region (radius around cloud.pos) but each renders
// independently for visual variety.
function _spawnPoisonCloud(pos, cfg) {
  const cloudColor = new THREE.Color(cfg.cloudColor);
  const puffs = [];
  const PUFF_COUNT = 7;
  for (let i = 0; i < PUFF_COUNT; i++) {
    const a = (i / PUFF_COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
    const r = cfg.cloudRadius * (0.2 + Math.random() * 0.7);
    const px = pos.x + Math.cos(a) * r;
    const pz = pos.z + Math.sin(a) * r;
    const py = 0.35 + Math.random() * 0.4;
    const mat = new THREE.MeshBasicMaterial({
      color: cloudColor,
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(_CLOUD_PUFF_GEO, mat);
    mesh.position.set(px, py, pz);
    scene.add(mesh);
    puffs.push({
      mesh, mat,
      pos: new THREE.Vector3(px, py, pz),
      vel: new THREE.Vector3(
        (Math.random() - 0.5) * 0.6,
        0.15 + Math.random() * 0.25,
        (Math.random() - 0.5) * 0.6,
      ),
      delay: i * 0.05,
      ttl: cfg.cloudDur,
      phase: Math.random() * Math.PI * 2,
    });
  }
  _activeClouds.push({
    puffs,
    pos: pos.clone(),
    radius: cfg.cloudRadius,
    dps: cfg.cloudDps,
    life: 0,
    ttl: cfg.cloudDur,
  });
}

// =====================================================================
// DISPOSAL
// =====================================================================
function _disposeMine(m) {
  if (m.root.parent) scene.remove(m.root);
  if (m.baseMat) m.baseMat.dispose();
  if (m.lightMat) m.lightMat.dispose();
}

export function clearAllMines() {
  for (const m of _activeMines) _disposeMine(m);
  _activeMines.length = 0;
  for (const p of _activePatches) {
    if (p.disc.parent) p.disc.parent.remove(p.disc);
    if (p.mat) p.mat.dispose();
  }
  _activePatches.length = 0;
  for (const c of _activeClouds) {
    for (const puff of c.puffs) {
      if (puff.mesh.parent) puff.mesh.parent.remove(puff.mesh);
      if (puff.mat) puff.mat.dispose();
    }
  }
  _activeClouds.length = 0;
}
