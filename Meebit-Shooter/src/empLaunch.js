// ============================================================================
// src/empLaunch.js — EMP missile launch cinematic.
//
// When the generator's charge hits 100%, this module takes over:
//
//   PHASE 1 — FLIGHT (0..0.8s)
//     A new missile mesh is spawned at the silo launch origin. It flies
//     straight up at increasing speed, leaves a chapter-tinted exhaust
//     trail, and triggers a screen shake.
//
//   PHASE 2 — PEAK FLASH (0.8..1.2s)
//     The missile disappears from the world. A DOM overlay flashes a
//     missile-streak across the viewport for the "across-your-screen" beat.
//
//   PHASE 3 — COUNTDOWN (1.2..21.2s, i.e. 20s of detonation wait)
//     HUD shows "EMP DETONATION · Ns" big on center screen. Gameplay
//     continues normally — turrets fire, enemies keep spawning (including
//     from the shielded hives, which are still immune). Player plays on.
//
//   PHASE 4 — DETONATION (21.2s)
//     Full-screen white flash for 80ms, then arena lighting drops hard
//     (ambient + hemi intensity fall ~85%, fog density 2x). Enemies +
//     player keep their glow because emissive materials bypass ambient.
//     A chapter-tinted shockwave ring mesh expands outward from silo
//     over ~1.2s. When shockwave reaches each hive, that hive's shield
//     drops (sequential via per-hive radius check). After ring passes
//     OUTER_RADIUS, lighting recovers over 2s back to the post-EMP
//     baseline. Then we fire the normal _fireEmp() flow which wraps
//     wave 2.
//
// Interface:
//   startLaunch()  — begin the cinematic. Called from waves.js via the
//                    generator's launch handler.
//   updateLaunch(dt, time) — per-frame tick. Called every frame from
//                    main.js unconditionally; no-ops when inactive.
//   isLaunching()  — true while phases 1-4 are running. waves.js checks
//                    this to suppress the old auto-EMP stub.
//   endLaunch()    — called by updateLaunch when phase 4 completes; fires
//                    the existing _fireEmp hook passed in at init.
// ============================================================================

import * as THREE from 'three';
import { scene, renderer } from './scene.js';
import { CHAPTERS } from './config.js';
import { S, shake } from './state.js';
import { UI } from './ui.js';
import { Audio } from './audio.js';
import { hitBurst } from './effects.js';
import { getSiloLaunchOrigin, hideSiloMissile, LAYOUT } from './waveProps.js';
import { spawners } from './spawners.js';
import { removeHiveShields } from './dormantProps.js';
import { getCentroidFor } from './triangles.js';
import { fireShockwave } from './shockwave.js';

// Phase durations.
const FLIGHT_SEC = 1.4;       // longer now — missile arcs across the map
const PEAK_SEC = 0.3;
const COUNTDOWN_SEC = 5.0;    // shorter — was 20, player asked for 5
const FLASH_SEC = 0.08;
const DARKEN_SEC = 1.2;
const LIGHT_RECOVER_SEC = 2.0;

const SHOCKWAVE_MAX_R = 55;

// ---------------------------------------------------------------------------
// STATE
// ---------------------------------------------------------------------------

let _phase = 'idle';    // 'idle' | 'flight' | 'peak' | 'countdown' | 'detonate' | 'recover'
let _phaseT = 0;        // seconds into current phase
let _active = false;
let _detonationFired = false;  // idempotency — don't run the wave-end flow twice
let _megaOre = null;           // landed mega-ore group (spawned at peak)

// Per-launch scene objects (created in startLaunch, cleaned in teardown)
let _missileMesh = null;
let _exhaustBursts = 0;
let _flightStart = null;   // THREE.Vector3 silo origin
let _flightTarget = null;  // THREE.Vector3 hive triangle centroid
let _shockwaveHitHives = null;
let _domOverlay = null;
let _hudCountdown = null;
let _ambientSaved = null;
let _onDetonation = null;

// ---------------------------------------------------------------------------
// PUBLIC API
// ---------------------------------------------------------------------------

/** Register the callback fired when detonation completes. waves.js wires
 *  this to its own _fireEmp() wrapper (minus shield-drop, which the
 *  shockwave does via removeHiveShields()). */
export function registerDetonationHandler(fn) {
  _onDetonation = fn;
}

export function isLaunching() {
  return _active;
}

/** Start the launch cinematic. Idempotent — re-entrant calls are ignored. */
export function startLaunch() {
  if (_active) return;
  _active = true;
  _phase = 'flight';
  _phaseT = 0;
  _detonationFired = false;
  _shockwaveHitHives = new Set();

  const chapter = CHAPTERS[S.chapter % CHAPTERS.length];
  const tint = chapter.full.grid1;

  // Spawn the flight missile at the silo top and hide the in-silo copy.
  const origin = getSiloLaunchOrigin();
  if (origin) {
    _missileMesh = _buildFlightMissile(tint);
    _missileMesh.position.copy(origin);
    scene.add(_missileMesh);
    _flightStart = origin.clone();
  } else {
    // Fallback — shouldn't happen in practice.
    _flightStart = new THREE.Vector3(LAYOUT.silo.x, 6.5, LAYOUT.silo.z);
  }
  hideSiloMissile();

  // Flight target: centroid of the hive triangle. The missile arcs from
  // the silo toward the hives and detonates directly over them, so the
  // shockwave ripples outward from the hives instead of from the silo.
  const hiveCentroid = getCentroidFor('hive');
  _flightTarget = new THREE.Vector3(hiveCentroid.x, 0.5, hiveCentroid.z);

  // Initial ignition burst + shake.
  if (origin) {
    hitBurst(origin, 0xffffff, 18);
    hitBurst(origin, 0xffaa00, 22);
  }
  shake(0.6, 0.4);
  try { Audio.bigBoom && Audio.bigBoom(); } catch (e) {}

  UI.toast('EMP MISSILE LAUNCHED', '#4ff7ff', 2200);
}

// ---------------------------------------------------------------------------
// BUILDERS
// ---------------------------------------------------------------------------

function _buildFlightMissile(tint) {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0xcccccc,
    emissive: tint,
    emissiveIntensity: 0.5,
    metalness: 0.8,
    roughness: 0.3,
  });
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.55, 0.55, 3.2, 10),
    bodyMat,
  );
  g.add(body);
  const nose = new THREE.Mesh(
    new THREE.ConeGeometry(0.55, 1.1, 10),
    bodyMat,
  );
  nose.position.y = 2.15;
  g.add(nose);
  // Exhaust cone pointing down
  const exhaustMat = new THREE.MeshBasicMaterial({
    color: 0xffaa00,
    transparent: true,
    opacity: 0.9,
  });
  const exhaust = new THREE.Mesh(
    new THREE.ConeGeometry(0.5, 1.6, 8),
    exhaustMat,
  );
  exhaust.position.y = -2.4;
  exhaust.rotation.x = Math.PI;
  g.add(exhaust);
  return g;
}

// ---------------------------------------------------------------------------
// MEGA ORE REVEAL
//
// After the missile peaks and vanishes, a "landed" warhead casing is
// planted tip-down at the detonation target. During the countdown the
// casing cracks open around a huge gold ore crystal inside — reinforcing
// the lore that the mining and the EMP launch are the same payoff.
// At detonation the crystal shatters in a big chapter-tinted burst.
//
// All geometry/materials are owned by _megaOre so _teardown() can dispose
// them cleanly whether the detonation played out normally or was aborted.
// ---------------------------------------------------------------------------

function _spawnMegaOre() {
  if (!_flightTarget) return;
  // Remove any lingering ore from a previous launch (e.g. abortLaunch in
  // the middle of a prior countdown).
  _disposeMegaOre();

  const chapter = CHAPTERS[S.chapter % CHAPTERS.length];
  const tint = chapter.full.grid1;
  // Ore color is always gold/amber regardless of chapter — it reads as
  // "MEGA ORE" specifically, not as chapter tint.
  const oreColor = 0xffd93d;

  const group = new THREE.Group();
  group.position.set(_flightTarget.x, 0, _flightTarget.z);

  // --- Warhead casing (two half-shells) ---
  // Landed missile body — cylinder buried tip-first so the flat end
  // faces up. The "casing halves" are two hemispherical shells on top
  // that rotate apart during the countdown to reveal the ore.
  const casingMat = new THREE.MeshStandardMaterial({
    color: 0x888888,
    emissive: tint,
    emissiveIntensity: 0.45,
    metalness: 0.85,
    roughness: 0.35,
  });
  const bodyGeo = new THREE.CylinderGeometry(1.4, 1.0, 3.6, 14);
  const body = new THREE.Mesh(bodyGeo, casingMat);
  body.position.y = 1.6;
  group.add(body);
  // Tilt the buried body slightly so it looks like it speared in at an angle
  body.rotation.z = 0.12;
  body.rotation.x = -0.08;

  // Two casing halves — half cylinders split along the z-axis that rotate
  // apart around the x-axis during countdown.
  const halfGeo = new THREE.CylinderGeometry(1.42, 1.42, 2.0, 14, 1, false, 0, Math.PI);
  const halfA = new THREE.Mesh(halfGeo, casingMat);
  const halfB = new THREE.Mesh(halfGeo, casingMat);
  // Pivot points so they hinge outward from the vertical center line
  const pivotA = new THREE.Group();
  const pivotB = new THREE.Group();
  pivotA.position.set(0, 3.5, 0);
  pivotB.position.set(0, 3.5, 0);
  // HalfA covers one side (0..π), HalfB covers the other (π..2π)
  halfA.position.y = 0;   // pivot origin is at top of cylinder in local
  halfB.position.y = 0;
  halfB.rotation.y = Math.PI;
  pivotA.add(halfA);
  pivotB.add(halfB);
  group.add(pivotA);
  group.add(pivotB);

  // --- MEGA ORE crystal (octahedron, gold, oversized) ---
  const oreGeo = new THREE.OctahedronGeometry(1.4, 0);
  const oreMat = new THREE.MeshStandardMaterial({
    color: oreColor,
    emissive: oreColor,
    emissiveIntensity: 1.4,
    metalness: 0.3,
    roughness: 0.2,
  });
  const ore = new THREE.Mesh(oreGeo, oreMat);
  ore.position.y = 3.5;
  ore.scale.setScalar(0.01);  // starts tiny, grows as casing opens
  group.add(ore);

  // Ambient glow halo around the ore — bright sphere that fades in.
  const haloGeo = new THREE.SphereGeometry(2.0, 16, 12);
  const haloMat = new THREE.MeshBasicMaterial({
    color: oreColor,
    transparent: true,
    opacity: 0.0,
    depthWrite: false,
  });
  const halo = new THREE.Mesh(haloGeo, haloMat);
  halo.position.y = 3.5;
  group.add(halo);

  // Ground ring to mark the impact crater.
  const ringGeo = new THREE.RingGeometry(2.2, 2.8, 32);
  const ringMat = new THREE.MeshBasicMaterial({
    color: tint,
    transparent: true,
    opacity: 0.7,
    side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.05;
  group.add(ring);

  scene.add(group);

  _megaOre = {
    obj: group,
    body, bodyGeo, casingMat,
    pivotA, pivotB, halfGeo,
    ore, oreGeo, oreMat,
    halo, haloGeo, haloMat,
    ring, ringGeo, ringMat,
    sparkTimer: 0,
    tint,
    oreColor,
  };

  // Landing impact burst + screen shake.
  const origin = new THREE.Vector3(_flightTarget.x, 0.3, _flightTarget.z);
  hitBurst(origin, 0xffffff, 20);
  hitBurst(origin, 0xffaa00, 18);
  hitBurst(origin, tint, 14);
  shake(0.4, 0.3);
}

function _tickMegaOre(dt, frac, time) {
  if (!_megaOre) return;
  const m = _megaOre;

  // Casing halves crack open — rotate outward from 0 to ~95° over the
  // first 60% of the countdown. Past 60% they sit open.
  const openFrac = Math.min(1, frac / 0.6);
  const openAngle = openFrac * (Math.PI * 0.52);  // ~95°
  if (m.pivotA) m.pivotA.rotation.x = -openAngle;
  if (m.pivotB) m.pivotB.rotation.x =  openAngle;

  // Ore grows from tiny to full size over the first 70% of countdown.
  const growFrac = Math.min(1, frac / 0.7);
  const targetScale = 0.01 + growFrac * 1.2;  // 0.01 → 1.21
  const cur = m.ore.scale.x;
  const next = cur + (targetScale - cur) * Math.min(1, dt * 3);
  m.ore.scale.setScalar(next);

  // Ore rotates faster with frac, pulses on frac.
  const rotSpeed = 0.5 + frac * 2.5;
  m.ore.rotation.y += dt * rotSpeed;
  m.ore.rotation.x += dt * rotSpeed * 0.6;
  // Emissive intensity ramps from 1.4 → 4.5 over countdown.
  if (m.oreMat) {
    const pulse = 0.5 + 0.5 * Math.sin(time * (2 + frac * 6));
    m.oreMat.emissiveIntensity = 1.4 + frac * 2.6 + pulse * 0.5;
  }
  // Gentle bob
  m.ore.position.y = 3.5 + Math.sin(time * 2.2) * 0.15;

  // Halo fades in as ore grows; scales up slightly with pulse.
  if (m.haloMat) {
    m.haloMat.opacity = growFrac * 0.35 + Math.sin(time * 3) * 0.04;
  }
  if (m.halo) {
    const hs = 1.0 + frac * 0.3;
    m.halo.scale.setScalar(hs);
  }

  // Ring on ground pulses with heartbeat tied to frac.
  if (m.ringMat) {
    const hb = 0.5 + 0.5 * Math.sin(time * (1.5 + frac * 3.5) * Math.PI * 2);
    m.ringMat.opacity = 0.3 + frac * 0.4 + hb * 0.2;
  }

  // Ambient sparks — drip some gold/tint sparks up from the casing at
  // an accelerating rate as countdown progresses.
  m.sparkTimer -= dt;
  if (m.sparkTimer <= 0) {
    m.sparkTimer = 0.35 - frac * 0.3;   // fires up to 3x/sec at full
    const a = Math.random() * Math.PI * 2;
    const r = 0.6 + Math.random() * 0.8;
    const px = m.obj.position.x + Math.cos(a) * r;
    const pz = m.obj.position.z + Math.sin(a) * r;
    const py = 2.0 + Math.random() * 1.5;
    hitBurst(new THREE.Vector3(px, py, pz), m.oreColor, 2);
    if (Math.random() < 0.4) {
      hitBurst(new THREE.Vector3(px, py, pz), m.tint, 2);
    }
  }
}

function _detonateMegaOre() {
  if (!_megaOre) return;
  const m = _megaOre;
  const origin = new THREE.Vector3(m.obj.position.x, 3.5, m.obj.position.z);

  // Big cascading burst — white, gold, chapter tint, offset in time so it
  // reads as a shattering explosion rather than one puff.
  hitBurst(origin, 0xffffff, 40);
  hitBurst(origin, m.oreColor, 36);
  setTimeout(() => hitBurst(origin, m.oreColor, 24), 60);
  setTimeout(() => hitBurst(origin, m.tint, 20), 140);
  setTimeout(() => hitBurst(origin, 0xffffff, 14), 220);

  // Also burst the casing halves outward so they visibly disintegrate.
  const cxs = [-1, 1];
  for (const sx of cxs) {
    const burstPos = new THREE.Vector3(
      origin.x + sx * 1.0, origin.y - 1.0, origin.z,
    );
    hitBurst(burstPos, 0x888888, 10);
    hitBurst(burstPos, m.tint, 6);
  }

  // Immediately remove the mega ore — the shockwave + flash cover the pop.
  // Deferred teardown would leave the now-lifeless mesh on screen.
  _disposeMegaOre();
}

function _disposeMegaOre() {
  if (!_megaOre) return;
  const m = _megaOre;
  if (m.obj && m.obj.parent) scene.remove(m.obj);
  if (m.bodyGeo) m.bodyGeo.dispose();
  if (m.halfGeo) m.halfGeo.dispose();
  if (m.oreGeo) m.oreGeo.dispose();
  if (m.haloGeo) m.haloGeo.dispose();
  if (m.ringGeo) m.ringGeo.dispose();
  if (m.casingMat) m.casingMat.dispose();
  if (m.oreMat) m.oreMat.dispose();
  if (m.haloMat) m.haloMat.dispose();
  if (m.ringMat) m.ringMat.dispose();
  _megaOre = null;
}

// ---------------------------------------------------------------------------
// DOM overlays (flash + countdown)
// ---------------------------------------------------------------------------

function _ensureDomOverlay() {
  if (_domOverlay) return;
  _domOverlay = document.createElement('div');
  _domOverlay.id = 'emp-flash';
  _domOverlay.style.cssText = `
    position: fixed; inset: 0; pointer-events: none;
    background: #ffffff;
    opacity: 0;
    z-index: 9200;
    transition: opacity 0.12s ease-out;
  `;
  document.body.appendChild(_domOverlay);
}

function _showPeakStreak(tint) {
  _ensureDomOverlay();
  const cssTint = '#' + tint.toString(16).padStart(6, '0');
  // Use the overlay as a canvas-like gradient streak for the peak flash.
  _domOverlay.style.background =
    `linear-gradient(115deg, transparent 35%, ${cssTint} 48%, #ffffff 52%, ${cssTint} 56%, transparent 70%)`;
  _domOverlay.style.opacity = '0.9';
  // Fade after ~0.35s
  setTimeout(() => {
    if (_domOverlay) _domOverlay.style.opacity = '0';
  }, 350);
}

function _showDetonationFlash() {
  _ensureDomOverlay();
  _domOverlay.style.background = '#ffffff';
  _domOverlay.style.opacity = '1';
  setTimeout(() => {
    if (_domOverlay) _domOverlay.style.opacity = '0';
  }, FLASH_SEC * 1000);
}

function _ensureHudCountdown() {
  if (_hudCountdown) return;
  _hudCountdown = document.createElement('div');
  _hudCountdown.id = 'emp-countdown';
  _hudCountdown.style.cssText = `
    position: fixed;
    top: 18%;
    left: 50%;
    transform: translateX(-50%);
    font-family: 'Impact', monospace;
    font-size: clamp(32px, 5vw, 64px);
    letter-spacing: 6px;
    color: #4ff7ff;
    text-shadow: 0 0 18px #4ff7ff, 0 0 36px #4ff7ff, 2px 2px 0 #000;
    pointer-events: none;
    z-index: 15;
    opacity: 0;
    transition: opacity 0.3s ease-out;
  `;
  document.body.appendChild(_hudCountdown);
}
function _setCountdownText(secLeft) {
  _ensureHudCountdown();
  const txt = `EMP DETONATION · ${Math.ceil(secLeft)}s`;
  _hudCountdown.textContent = txt;
  _hudCountdown.style.opacity = '1';
}
function _hideCountdown() {
  if (_hudCountdown) _hudCountdown.style.opacity = '0';
}

// ---------------------------------------------------------------------------
// LIGHTING DARKEN / RESTORE
// ---------------------------------------------------------------------------

function _darkenArena() {
  // Cache every scene light's current intensity so we can restore later.
  _ambientSaved = [];
  scene.traverse((obj) => {
    if (obj.isLight && obj.intensity !== undefined) {
      _ambientSaved.push({ light: obj, orig: obj.intensity });
      obj.intensity = obj.intensity * 0.15;
    }
  });
  // Ramp fog density if present.
  if (scene.fog && scene.fog.density !== undefined) {
    _fogSaved = scene.fog.density;
    scene.fog.density = _fogSaved * 2.5;
  } else if (scene.fog && scene.fog.far !== undefined) {
    _fogSaved = scene.fog.far;
    scene.fog.far = _fogSaved * 0.4;  // Closer far = more fog
  }
}
let _fogSaved = null;

function _restoreLighting(frac) {
  // frac 0..1 — how much back toward normal.
  if (_ambientSaved) {
    for (const entry of _ambientSaved) {
      entry.light.intensity = entry.orig * (0.15 + 0.85 * frac);
    }
  }
  if (_fogSaved !== null && scene.fog) {
    if (scene.fog.density !== undefined) {
      scene.fog.density = _fogSaved * (2.5 - 1.5 * frac);
    } else if (scene.fog.far !== undefined) {
      scene.fog.far = _fogSaved * (0.4 + 0.6 * frac);
    }
  }
}

function _fullyRestoreLighting() {
  _restoreLighting(1);
  _ambientSaved = null;
  _fogSaved = null;
}

// ---------------------------------------------------------------------------
// PER-FRAME TICK
// ---------------------------------------------------------------------------

export function updateLaunch(dt, time) {
  if (!_active) return;
  _phaseT += dt;
  const chapter = CHAPTERS[S.chapter % CHAPTERS.length];
  const tint = chapter.full.grid1;

  if (_phase === 'flight') {
    // Parabolic arc from silo origin to hive-triangle centroid. Peak
    // height scales with horizontal distance so the arc feels right even
    // when the two points are close.
    const f = Math.min(1, _phaseT / FLIGHT_SEC);
    if (_missileMesh && _flightStart && _flightTarget) {
      // Lerp xz linearly; y = lerp + parabola kick at mid-flight.
      const x = _flightStart.x + (_flightTarget.x - _flightStart.x) * f;
      const z = _flightStart.z + (_flightTarget.z - _flightStart.z) * f;
      const baseY = _flightStart.y + (_flightTarget.y - _flightStart.y) * f;
      // Parabola: peak height = 0.7× horizontal distance, so a long flight
      // arcs higher than a short one.
      const horizDist = Math.hypot(
        _flightTarget.x - _flightStart.x,
        _flightTarget.z - _flightStart.z
      );
      const peakKick = Math.max(6, horizDist * 0.7);
      const arcY = 4 * peakKick * f * (1 - f);  // classic 4·h·t·(1-t)
      _missileMesh.position.set(x, baseY + arcY, z);

      // Orient along velocity. Derivative of the arc:
      //   dx/df, dz/df = (target-start) constants
      //   dy/df = lerpDy + 4*peak*(1 - 2f)
      const lerpDy = _flightTarget.y - _flightStart.y;
      const vx = _flightTarget.x - _flightStart.x;
      const vz = _flightTarget.z - _flightStart.z;
      const vy = lerpDy + 4 * peakKick * (1 - 2 * f);
      const horizLen = Math.hypot(vx, vz);
      // Pitch: angle above horizontal.
      const pitch = Math.atan2(vy, horizLen);
      // Yaw: direction of travel in XZ.
      const yaw = Math.atan2(vx, vz);
      _missileMesh.rotation.set(pitch - Math.PI / 2, yaw, 0, 'YXZ');

      // Exhaust burst every other frame.
      _exhaustBursts++;
      if (_exhaustBursts % 2 === 0) {
        // Spawn exhaust slightly behind the missile along velocity.
        const back = _missileMesh.position.clone();
        const vLen = Math.hypot(vx, vy, vz) || 1;
        back.x -= (vx / vLen) * 1.6;
        back.y -= (vy / vLen) * 1.6;
        back.z -= (vz / vLen) * 1.6;
        hitBurst(back, 0xffaa00, 4);
        hitBurst(back, 0xffffff, 2);
      }
    }

    if (_phaseT >= FLIGHT_SEC) {
      // Transition to peak. Missile vanishes; DOM streak carries the beat.
      _phase = 'peak';
      _phaseT = 0;
      if (_missileMesh && _missileMesh.parent) scene.remove(_missileMesh);
      _missileMesh = null;
      _showPeakStreak(tint);
    }
  }
  else if (_phase === 'peak') {
    if (_phaseT >= PEAK_SEC) {
      _phase = 'countdown';
      _phaseT = 0;
      UI.toast('HOLD THE LINE — EMP DETONATES IN ' + Math.ceil(COUNTDOWN_SEC) + ' SECONDS', '#4ff7ff', 3000);
      // Spawn the "landed missile → mega ore" reveal at the detonation
      // target. The casing animates open during the countdown and the
      // mega ore pulses brighter every second.
      _spawnMegaOre();
    }
  }
  else if (_phase === 'countdown') {
    const left = Math.max(0, COUNTDOWN_SEC - _phaseT);
    _setCountdownText(left);
    // Countdown progress 0..1 — drives mega-ore animation (casing opens,
    // crystal pulses harder, emissive ramps up).
    const frac = Math.min(1, _phaseT / COUNTDOWN_SEC);
    _tickMegaOre(dt, frac, time);
    if (_phaseT >= COUNTDOWN_SEC) {
      _phase = 'detonate';
      _phaseT = 0;
      _hideCountdown();
      _showDetonationFlash();
      _darkenArena();
      shake(1.2, 0.8);
      try { Audio.bigBoom && Audio.bigBoom(); } catch (e) {}
      // Shockwave originates from the hive-triangle centroid — where
      // the missile detonated — not the silo. As the ring passes each
      // hive, drop that hive's shield via the onRadius callback.
      const origin = _flightTarget || { x: 0, y: 0.2, z: 0 };
      fireShockwave(
        { x: origin.x, y: 0.2, z: origin.z },
        {
          maxRadius: SHOCKWAVE_MAX_R,
          durationSec: DARKEN_SEC,
          onRadius: (r) => {
            for (const h of spawners) {
              if (!h.shielded || _shockwaveHitHives.has(h)) continue;
              const dx = h.pos.x - origin.x;
              const dz = h.pos.z - origin.z;
              const d = Math.sqrt(dx * dx + dz * dz);
              if (r >= d) {
                _shockwaveHitHives.add(h);
                hitBurst(new THREE.Vector3(h.pos.x, 2.5, h.pos.z), 0xffffff, 16);
                const tintNow = CHAPTERS[S.chapter % CHAPTERS.length].full.grid1;
                hitBurst(new THREE.Vector3(h.pos.x, 2.5, h.pos.z), tintNow, 14);
              }
            }
          },
        },
      );

      // Mega ore pop — the big pulsing crystal erupts and scatters chunks.
      _detonateMegaOre();

      // Fire the detonation handler (wave-end work) AT THE EXPLOSION,
      // not after lighting recovery. The user wants the next-wave
      // countdown to kick in immediately on explosion. The recover
      // phase (lighting fade-back) still runs for visual continuity but
      // the wave-end flow no longer waits on it.
      if (_onDetonation && !_detonationFired) {
        _detonationFired = true;
        try { _onDetonation(); }
        catch (err) { console.warn('[empLaunch] onDetonation threw:', err); }
      }
    }
  }
  else if (_phase === 'detonate') {
    // Shared shockwave module handles the ring expansion + hive-shield
    // drop-as-ring-passes via the onRadius callback registered above.
    if (_phaseT >= DARKEN_SEC) {
      _phase = 'recover';
      _phaseT = 0;
      // Safety net: drop every remaining hive shield in case the
      // shockwave missed any (e.g. a hive sitting outside SHOCKWAVE_MAX_R).
      removeHiveShields();
    }
  }
  else if (_phase === 'recover') {
    // Fade lighting back up over LIGHT_RECOVER_SEC. No more onDetonation
    // fire here — it already fired on explosion entry.
    const f = Math.min(1, _phaseT / LIGHT_RECOVER_SEC);
    _restoreLighting(f);
    if (_phaseT >= LIGHT_RECOVER_SEC) {
      _fullyRestoreLighting();
      _phase = 'idle';
      _phaseT = 0;
      _active = false;
      _teardown();
    }
  }
}

function _teardown() {
  if (_missileMesh && _missileMesh.parent) scene.remove(_missileMesh);
  _missileMesh = null;
  _hideCountdown();
  if (_domOverlay) _domOverlay.style.opacity = '0';
  _shockwaveHitHives = null;
  _exhaustBursts = 0;
  _flightStart = null;
  _flightTarget = null;
  // Mega ore cleanup — normally already disposed by _detonateMegaOre, but
  // idempotent _disposeMegaOre handles the abort-mid-countdown case.
  _disposeMegaOre();
}

/** Hard reset for game-over / chapter teardown. */
export function abortLaunch() {
  if (!_active) return;
  _fullyRestoreLighting();
  _teardown();
  _phase = 'idle';
  _phaseT = 0;
  _active = false;
}
