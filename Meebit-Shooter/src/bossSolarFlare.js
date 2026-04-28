// bossSolarFlare.js — SOLAR_TYRANT's per-boss mechanic. Predictive
// AOE circles dropped at the player's projected position 2 seconds
// in the future, with a 1.5s telegraph before damage. Player has to
// break their movement pattern within the telegraph window to dodge.
//
// Gameplay teaching: "don't kite in a straight line." A player moving
// at constant velocity gets PUNISHED — the AOE lands exactly on their
// projected position. Standing still also gets punished (zero velocity
// → AOE drops on top of them). Survival requires changing speed or
// direction during the telegraph.
//
// Per spec:
//   - Predict player position 2s out (linear extrapolation from
//     current velocity)
//   - 4u radius AOE
//   - 1.5s telegraph (orange-yellow pulse on the floor at predicted
//     position)
//   - Then 0.5s active damage window
//   - Cadence: every 4s
//   - Damage: 35 (matches SOLAR_TYRANT's base damage)

import * as THREE from 'three';
import { scene } from './scene.js';
import { Audio } from './audio.js';
import { ARENA } from './config.js';

// ---- TUNING ----

const AOE_RADIUS       = 4.0;
const TELEGRAPH_TIME   = 1.5;
const ACTIVE_TIME      = 0.5;        // damage window after telegraph
const TOTAL_LIFE       = TELEGRAPH_TIME + ACTIVE_TIME;
const PLAYER_DAMAGE    = 35;

// Solar gold/orange — stays this color regardless of chapter palette
// since "solar flare" should always read as fire/heat. Picked to
// contrast against the cyan freeze pods used by GLACIER_WRAITH so
// players with both bosses fresh in mind don't confuse the cues.
const SOLAR_COLOR = 0xffaa22;

// ---- STATE ----

const _flares = [];     // [{ fillMesh, ringMesh, fillMat, ringMat, x, z, born, damaged }]

// Cached geometry — reused across all flares to keep allocation
// pressure low.
const _FILL_GEO = new THREE.CircleGeometry(AOE_RADIUS, 32);
const _RING_GEO = new THREE.RingGeometry(AOE_RADIUS - 0.30, AOE_RADIUS, 48);

function _makeFlareMeshes(x, z) {
  const fillMat = new THREE.MeshBasicMaterial({
    color: SOLAR_COLOR,
    transparent: true,
    opacity: 0.0,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const fill = new THREE.Mesh(_FILL_GEO, fillMat);
  fill.rotation.x = -Math.PI / 2;
  fill.position.set(x, 0.05, z);
  scene.add(fill);

  const ringMat = new THREE.MeshBasicMaterial({
    color: SOLAR_COLOR,
    transparent: true,
    opacity: 0.0,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const ring = new THREE.Mesh(_RING_GEO, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, 0.055, z);
  scene.add(ring);

  return { fill, fillMat, ring, ringMat };
}

function _disposeFlare(flare) {
  if (flare.fill && flare.fill.parent) flare.fill.parent.remove(flare.fill);
  if (flare.ring && flare.ring.parent) flare.ring.parent.remove(flare.ring);
  if (flare.fillMat) flare.fillMat.dispose();
  if (flare.ringMat) flare.ringMat.dispose();
}

// ---- PUBLIC API ----

/**
 * Drop a solar flare at (x, z) — typically the player's projected
 * position 2 seconds in the future. The boss pattern dispatch does
 * the projection and clamps to arena bounds before calling.
 */
export function spawnSolarFlare(x, z) {
  // Clamp inside arena (radius 4 + 1u margin)
  const lim = ARENA - 5;
  const cx = Math.max(-lim, Math.min(lim, x));
  const cz = Math.max(-lim, Math.min(lim, z));
  const meshes = _makeFlareMeshes(cx, cz);
  _flares.push({
    ...meshes,
    x: cx, z: cz,
    born: performance.now() / 1000,
    damaged: false,         // set true after damage window fires (so we only damage once)
  });
  // Audio cue at telegraph start — radio beep matches faction paint's
  // warning sound, telling the player "incoming AOE somewhere on the
  // floor, look down and find the circle."
  try { Audio.radioBeep && Audio.radioBeep(); } catch (e) {}
}

/**
 * Wipe every active flare. Call on boss death + chapter teardown.
 */
export function clearAllFlares() {
  for (const f of _flares) _disposeFlare(f);
  _flares.length = 0;
}

/**
 * Per-frame update. Animates telegraph→active opacity, applies damage
 * during active window (single frame per flare to avoid stacking),
 * disposes expired flares.
 *
 * Pattern matches updatePuddles + updateFactionPaint — DOT-style flow
 * with VFX flash + audio when player is hit.
 */
export function updateFlares(dt, playerPos, S, UI, Audio_, shake) {
  if (_flares.length === 0) return false;
  const tNow = performance.now() / 1000;
  const pulse = 0.5 + 0.5 * Math.sin(tNow * 6.0);    // fast pulse (urgent)
  let damaged = false;

  for (let i = _flares.length - 1; i >= 0; i--) {
    const f = _flares[i];
    const age = tNow - f.born;

    if (age >= TOTAL_LIFE) {
      _disposeFlare(f);
      _flares.splice(i, 1);
      continue;
    }

    if (age < TELEGRAPH_TIME) {
      // Telegraph phase — opacity ramps with pulse.
      const t = age / TELEGRAPH_TIME;
      f.fillMat.opacity = 0.20 * t + 0.10 * pulse * t;
      f.ringMat.opacity = 0.40 * t + 0.40 * pulse * t;
    } else {
      // Active phase — bright solid + damage check.
      const activeAge = age - TELEGRAPH_TIME;
      const fadeT = 1.0 - (activeAge / ACTIVE_TIME);
      f.fillMat.opacity = 0.85 * fadeT;
      f.ringMat.opacity = 1.0 * fadeT;

      // Damage exactly once per flare on the first active frame.
      // Using `damaged` flag to ensure single-hit even if telegraph
      // ends mid-frame and the active phase persists across multiple.
      if (!f.damaged) {
        f.damaged = true;
        if (S.invulnTimer <= 0) {
          const dx = playerPos.x - f.x;
          const dz = playerPos.z - f.z;
          if (dx * dx + dz * dz <= AOE_RADIUS * AOE_RADIUS) {
            S.hp -= PLAYER_DAMAGE;
            if (S.hp <= 0) S.hp = 0;
            damaged = true;
            if (UI && UI.damageFlash) UI.damageFlash();
            if (Audio_ && Audio_.bigBoom) {
              try { Audio_.bigBoom(); } catch (e) {}
            }
            if (shake) shake(0.3, 0.3);
          }
        }
      }
    }
  }
  return damaged;
}

/** Diagnostic — count of active flares. */
export function getFlareCount() {
  return _flares.length;
}
