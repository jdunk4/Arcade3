// bossPuddles.js — TOXIC_MAW's per-boss mechanic. Toxic puddles
// spawn periodically near the boss, grow to full size, hold, then
// shrink and dispose. Capped pool: when a new puddle would push past
// the cap, the OLDEST is removed to make room (FIFO eviction). This
// guarantees a smooth visual flow rather than "spawn fizzles silently
// because the cap is full."
//
// Per the boss rework spec for TOXIC_MAW (chapter 4, X faction):
//   - Toxic puddles damage the player on touch
//   - Don't stack (cap enforced)
//   - Reasonable cap (6 alive at once)
//   - Shrink over time (built into the lifecycle)
//
// Damage tuned slightly lower than faction paint (5/sec vs 10/sec)
// because puddles accumulate over a fight and the player will
// inevitably brush them while dodging — full faction-paint DOT
// would compound too punishingly.

import * as THREE from 'three';
import { scene } from './scene.js';
import { Audio } from './audio.js';

// ---- TUNING ----

// Puddle pool cap. 6 max alive at once — arena half-extent is 50u
// and puddle radius is 3u, so 6 puddles use ~170 sq.u of floor area
// vs the arena's ~7800 — meaningful navigation friction without
// blocking the player out of safe space. If field testing shows
// this is too brutal, drop to 4.
const MAX_PUDDLES = 6;

// Lifecycle phases (seconds)
const GROW_TIME    = 1.5;   // 0 → full radius (telegraph + ramp)
const HOLD_TIME    = 5.0;   // at full radius
const SHRINK_TIME  = 3.0;   // full → 0 (dispose at end)
const TOTAL_LIFE   = GROW_TIME + HOLD_TIME + SHRINK_TIME;   // 9.5s

// Geometry
const PUDDLE_RADIUS = 3.0;   // full-size radius in arena units
const PUDDLE_Y      = 0.045; // just above floor, below faction paint (0.04)
                              // — wait, paint is at 0.04 too. Use 0.045 so
                              // the puddle reads slightly above paint when
                              // they overlap. Shouldn't z-fight.

// Damage — DOT 5/sec with VFX flash every 0.4s (matches hazard tile
// cadence in hazards.js for consistency). Half the rate of faction
// paint because puddles cluster and the player will inevitably
// take some pass-through ticks while dodging.
const DOT_PER_SECOND   = 5.0;
const DOT_VFX_INTERVAL = 0.4;

// Color — sickly toxic green. Stays this color regardless of chapter
// tint because "toxic" should read consistently even outside the
// TOXIC chapter (we don't want it red in CRIMSON or yellow in SOLAR
// since the visual SHOULD signal poison/acid universally).
const PUDDLE_COLOR = 0x4dff4d;

// Reusable geometries — 32-segment circles, plenty smooth at this
// rendered size. Cached at module scope so each puddle reuses them
// instead of allocating fresh.
const _PUDDLE_FILL_GEO    = new THREE.CircleGeometry(PUDDLE_RADIUS, 32);
const _PUDDLE_OUTLINE_GEO = new THREE.RingGeometry(
  PUDDLE_RADIUS - 0.25, PUDDLE_RADIUS + 0.10, 32,
);

// ---- STATE ----

const _puddles = [];   // [{ fillMesh, outlineMesh, fillMat, outlineMat, x, z, born }]

// ---- INTERNAL ----

function _makePuddleMeshes() {
  const fillMat = new THREE.MeshBasicMaterial({
    color: PUDDLE_COLOR,
    transparent: true,
    opacity: 0.0,                   // animated up during grow phase
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const fill = new THREE.Mesh(_PUDDLE_FILL_GEO, fillMat);
  fill.rotation.x = -Math.PI / 2;
  fill.scale.setScalar(0.001);      // start tiny

  const outlineMat = new THREE.MeshBasicMaterial({
    color: PUDDLE_COLOR,
    transparent: true,
    opacity: 0.0,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const outline = new THREE.Mesh(_PUDDLE_OUTLINE_GEO, outlineMat);
  outline.rotation.x = -Math.PI / 2;
  outline.scale.setScalar(0.001);

  return { fill, fillMat, outline, outlineMat };
}

function _disposePuddle(puddle) {
  if (puddle.fill && puddle.fill.parent) puddle.fill.parent.remove(puddle.fill);
  if (puddle.outline && puddle.outline.parent) puddle.outline.parent.remove(puddle.outline);
  // Materials are per-puddle (not shared) so dispose them. Geometries
  // are module-shared — DON'T dispose those.
  if (puddle.fillMat)    puddle.fillMat.dispose();
  if (puddle.outlineMat) puddle.outlineMat.dispose();
}

// ---- PUBLIC API ----

/**
 * Spawn a toxic puddle at world position (x, z). If the pool is at
 * cap, evicts the OLDEST puddle to make room (FIFO). This guarantees
 * a smooth visual flow — there's never a "spawn fizzled because cap
 * is full" gap in the cadence.
 *
 * @param {number} x  world X position
 * @param {number} z  world Z position
 */
export function spawnPuddle(x, z) {
  if (_puddles.length >= MAX_PUDDLES) {
    const evicted = _puddles.shift();
    _disposePuddle(evicted);
  }
  const meshes = _makePuddleMeshes();
  meshes.fill.position.set(x, PUDDLE_Y, z);
  meshes.outline.position.set(x, PUDDLE_Y - 0.005, z);  // slightly under fill
  scene.add(meshes.fill);
  scene.add(meshes.outline);
  _puddles.push({
    ...meshes,
    x, z,
    born: performance.now() / 1000,
  });
  // Audio cue — bug-whir is a wet, sickly sound that fits "puddle of
  // acid just dropped on the ground" without being as heavy as the
  // bigBoom used by faction paint activation. Optional; if audio
  // isn't loaded we silently skip.
  try { Audio.bugWhir && Audio.bugWhir(); } catch (e) {}
}

/**
 * Wipe every active puddle. Call on boss death + chapter teardown.
 * Idempotent.
 */
export function clearAllPuddles() {
  for (const p of _puddles) _disposePuddle(p);
  _puddles.length = 0;
}

/**
 * Per-frame update: animate lifecycle (grow/hold/shrink), apply
 * player damage where appropriate, and dispose expired puddles.
 *
 * Mirrors the hazards.js / factionPaint.js DOT pattern:
 *   - dt-scaled S.hp drain
 *   - VFX flash + audio + shake every DOT_VFX_INTERVAL
 *   - respects S.invulnTimer (dash invuln passes through)
 */
export function updatePuddles(dt, playerPos, S, UI, Audio_, shake) {
  if (_puddles.length === 0) return false;
  const tNow = performance.now() / 1000;
  const pulse = 0.5 + 0.5 * Math.sin(tNow * 3.0);   // a touch faster than paint
  let damaged = false;

  // Iterate backward so we can splice expired puddles in-place.
  for (let i = _puddles.length - 1; i >= 0; i--) {
    const p = _puddles[i];
    const age = tNow - p.born;

    // Compute current size factor (0..1) per phase.
    let sizeT;
    if (age < GROW_TIME) {
      // Growing phase
      sizeT = age / GROW_TIME;
    } else if (age < GROW_TIME + HOLD_TIME) {
      // Holding at full
      sizeT = 1.0;
    } else if (age < TOTAL_LIFE) {
      // Shrinking phase
      const shrinkAge = age - GROW_TIME - HOLD_TIME;
      sizeT = 1.0 - (shrinkAge / SHRINK_TIME);
    } else {
      // Expired — dispose.
      _disposePuddle(p);
      _puddles.splice(i, 1);
      continue;
    }

    // Apply the size factor to both meshes. clamp to a tiny minimum
    // (0.01) so three.js doesn't choke on zero-scale matrices.
    const s = Math.max(0.01, sizeT);
    p.fill.scale.set(s, s, s);
    p.outline.scale.set(s, s, s);

    // Opacity envelope:
    //   - During grow: ramp opacity from 0 to full
    //   - During hold: pulse around steady value
    //   - During shrink: opacity follows sizeT (so puddle fades AS it
    //     shrinks — visually "dries up" rather than "shrinks then
    //     vanishes pop")
    let baseFillOp, baseOutlineOp;
    if (age < GROW_TIME) {
      baseFillOp    = 0.40 * sizeT;
      baseOutlineOp = 0.55 * sizeT;
    } else if (age < GROW_TIME + HOLD_TIME) {
      baseFillOp    = 0.40 + 0.10 * pulse;
      baseOutlineOp = 0.55 + 0.15 * pulse;
    } else {
      baseFillOp    = 0.40 * sizeT;
      baseOutlineOp = 0.55 * sizeT;
    }
    p.fillMat.opacity    = baseFillOp;
    p.outlineMat.opacity = baseOutlineOp;

    // Damage check — only during grow + hold phases (not during
    // shrink). Logic: as the puddle shrinks it's "drying up" and
    // shouldn't hurt anymore. Player feels rewarded for waiting it
    // out instead of always punished.
    if (S.invulnTimer > 0) continue;
    if (age >= GROW_TIME + HOLD_TIME) continue;
    // Distance test — within current effective radius?
    const dx = playerPos.x - p.x;
    const dz = playerPos.z - p.z;
    const distSq = dx * dx + dz * dz;
    const effRadius = PUDDLE_RADIUS * sizeT;
    if (distSq <= effRadius * effRadius) {
      S.hp -= DOT_PER_SECOND * dt;
      damaged = true;
      S._puddleTickTimer = (S._puddleTickTimer || 0) - dt;
      if (S._puddleTickTimer <= 0) {
        S._puddleTickTimer = DOT_VFX_INTERVAL;
        if (UI && UI.damageFlash) UI.damageFlash();
        if (Audio_ && Audio_.damage) try { Audio_.damage(); } catch (e) {}
        if (shake) shake(0.08, 0.06);
      }
      if (S.hp <= 0) S.hp = 0;
    }
  }

  return damaged;
}

/** Returns the current number of live puddles (for debugging / UI). */
export function getPuddleCount() {
  return _puddles.length;
}
