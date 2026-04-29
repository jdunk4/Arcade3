// mineField.js — Anti-personnel mines deployed by the MINE FIELD
// stratagem. Mines are scattered in a ring around the beacon point.
// Each mine sits dormant until an enemy walks within trigger radius;
// it then beeps for 0.4s before exploding in a small AoE.
//
// Public API:
//   deployMineField(centerPos, tint)  — scatter mines around centerPos
//   updateMines(dt)                   — per-frame tick (proximity check + detonations)
//   clearAllMines()                   — wipe all (game reset)

import * as THREE from 'three';
import { scene } from './scene.js';
import { hitBurst } from './effects.js';
import { enemies } from './enemies.js';

const MINE_COUNT          = 14;
const MINE_SPREAD_RADIUS  = 5.5;
const MINE_TRIGGER_RADIUS = 1.6;
const MINE_AOE_RADIUS     = 3.2;
const MINE_AOE_DAMAGE     = 180;
const MINE_BEEP_DUR       = 0.45;          // arming/warning before detonation

const _MINE_BASE_GEO  = new THREE.CylinderGeometry(0.32, 0.36, 0.18, 14);
const _MINE_LIGHT_GEO = new THREE.SphereGeometry(0.10, 10, 8);

const _activeMines = [];

export function deployMineField(centerPos, tint) {
  const tintColor = new THREE.Color(tint);
  for (let i = 0; i < MINE_COUNT; i++) {
    // Distribute around a ring with jitter so the field doesn't read
    // as a perfect circle.
    const a = (i / MINE_COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
    const r = MINE_SPREAD_RADIUS * (0.4 + Math.random() * 0.7);
    const x = centerPos.x + Math.cos(a) * r;
    const z = centerPos.z + Math.sin(a) * r;

    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x2a2c34,
      emissive: tintColor,
      emissiveIntensity: 0.4,
      roughness: 0.55,
      metalness: 0.70,
    });
    const lightMat = new THREE.MeshBasicMaterial({
      color: tintColor,
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
      tint, tintColor,
      pos: new THREE.Vector3(x, 0, z),
      armed: true,                        // proximity-triggered
      beeping: false,
      beepT: 0,
      detonated: false,
      pulsePhase: Math.random() * Math.PI * 2,
    });
  }
}

export function updateMines(dt) {
  for (let i = _activeMines.length - 1; i >= 0; i--) {
    const m = _activeMines[i];
    // Idle pulse on the light.
    if (!m.beeping && !m.detonated) {
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
      m.detonateT = (m.detonateT || 0) + dt;
      if (m.detonateT > 0.6) {
        _disposeMine(m);
        _activeMines.splice(i, 1);
      }
    }
  }
}

function _detonateMine(m) {
  m.detonated = true;
  m.detonateT = 0;
  // Hide the mine body but leave the group for one frame so the
  // burst has a parent — we'll dispose on the linger timer.
  if (m.base.parent) m.base.visible = false;
  if (m.light.parent) m.light.visible = false;
  // AoE damage.
  const r2 = MINE_AOE_RADIUS * MINE_AOE_RADIUS;
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (!e || !e.pos || e.dying) continue;
    const dx = e.pos.x - m.pos.x;
    const dz = e.pos.z - m.pos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < r2) {
      const falloff = 1 - Math.sqrt(d2) / MINE_AOE_RADIUS;
      e.hp -= MINE_AOE_DAMAGE * falloff;
      e.hitFlash = 0.18;
    }
  }
  // FX.
  const pos = m.pos.clone();
  pos.y = 0.5;
  hitBurst(pos, 0xffffff, 18);
  hitBurst(pos, m.tint, 14);
  setTimeout(() => hitBurst(pos, 0xffaa00, 10), 50);
  // Notify any tutorial observer that a mine fired.
  if (typeof window !== 'undefined' && window.__bonusObserve && window.__bonusObserve.onMineDetonate) {
    try { window.__bonusObserve.onMineDetonate(); } catch (e) {}
  }
}

function _disposeMine(m) {
  if (m.root.parent) scene.remove(m.root);
  if (m.baseMat) m.baseMat.dispose();
  if (m.lightMat) m.lightMat.dispose();
}

export function clearAllMines() {
  for (const m of _activeMines) _disposeMine(m);
  _activeMines.length = 0;
}
