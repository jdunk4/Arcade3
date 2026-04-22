// ============================================================================
// src/powerupZones.js — the 5 stand-in-zone objectives for wave 2.
//
// Flow:
//   1. POWER       — restore main power
//   2. TURRETS_A   — bring turret 0 online
//   3. TURRETS_B   — bring turrets 1 + 2 online
//   4. RADIO       — establish comms (no mechanical effect yet, just story)
//   5. EMP         — launch the EMP missile
//
// Each zone is a flat disk on the floor. Only the currently-active zone
// is "lit" (bright emissive + taller pillar beam + progress arc fill).
// All other zones are dim props — still visible so the player knows what's
// coming, but non-interactable.
//
// The player stands inside the active zone's radius to fill a hold timer.
// When the timer reaches the target, the zone "completes" (sparks, zone
// dims, next zone lights up).
//
// The module owns no wave-end logic — it reports completion of each zone
// to waves.js, which handles turret activation and the EMP fire.
// ============================================================================

import * as THREE from 'three';
import { scene } from './scene.js';
import { CHAPTERS, ARENA } from './config.js';
import { hitBurst } from './effects.js';
import { LAYOUT } from './waveProps.js';

// Zones in completion order. Each one sits DIRECTLY ON TOP of the prop
// it energizes, so the player physically stands at the thing they're
// activating. Stage 3a introduced the central-compound layout:
//   POWER       → on top of the powerplant
//   TURRETS_A   → on top of turret 0 (north of silo)
//   TURRETS_B   → on top of turret 1 (southwest)
//   TURRETS_C   → on top of turret 2 (southeast)
//   RADIO       → on top of the radio tower
//
// The EMP zone from Stage 2 was removed. Stage 3b will replace it with
// a shoot-the-generator-on-the-rocket mechanic. For now, Stage 3a auto-
// fires the EMP a couple seconds after RADIO completes so the wave is
// still playable end-to-end.
const ZONE_DEFS = [
  { id: 'POWER',     label: 'RESTORE POWER',       x: LAYOUT.powerplant.x, z: LAYOUT.powerplant.z, turretIdx: -1 },
  { id: 'TURRETS_A', label: 'LOAD TURRET A',       x: LAYOUT.turrets[0].x, z: LAYOUT.turrets[0].z, turretIdx: 0 },
  { id: 'TURRETS_B', label: 'LOAD TURRET B',       x: LAYOUT.turrets[1].x, z: LAYOUT.turrets[1].z, turretIdx: 1 },
  { id: 'TURRETS_C', label: 'LOAD TURRET C',       x: LAYOUT.turrets[2].x, z: LAYOUT.turrets[2].z, turretIdx: 2 },
  { id: 'RADIO',     label: 'ESTABLISH RADIO COMMS', x: LAYOUT.radioTower.x, z: LAYOUT.radioTower.z, turretIdx: -1 },
];

// Zone tuning.
const ZONE_CFG = {
  radius: 3.0,                      // units — player is "in" the zone inside this
  radiusSq: 3.0 * 3.0,
  holdTime: 3.5,                    // seconds to complete each zone
  pulseHzDormant: 0.4,              // slow pulse when dim
  pulseHzActive: 1.8,               // fast pulse when lit
};

// ---------------------------------------------------------------------------
// SHARED GEO + MATERIALS
// ---------------------------------------------------------------------------
const DISK_GEO = new THREE.CircleGeometry(ZONE_CFG.radius, 32);
const RING_GEO = new THREE.RingGeometry(ZONE_CFG.radius * 0.95, ZONE_CFG.radius, 48);
const BEAM_GEO = new THREE.CylinderGeometry(0.25, 0.5, 10, 10, 1, true);

const _diskDormantMatCache = new Map();
const _diskActiveMatCache = new Map();
const _ringMatCache = new Map();
const _beamDormantMatCache = new Map();
const _beamActiveMatCache = new Map();

function _getDiskDormantMat(tint) {
  let m = _diskDormantMatCache.get(tint);
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      color: tint, transparent: true, opacity: 0.15, side: THREE.DoubleSide,
    });
    _diskDormantMatCache.set(tint, m);
  }
  return m;
}
function _getDiskActiveMat(tint) {
  let m = _diskActiveMatCache.get(tint);
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      color: tint, transparent: true, opacity: 0.55, side: THREE.DoubleSide,
    });
    _diskActiveMatCache.set(tint, m);
  }
  return m;
}
function _getRingMat(tint) {
  let m = _ringMatCache.get(tint);
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      color: tint, transparent: true, opacity: 0.9, side: THREE.DoubleSide,
    });
    _ringMatCache.set(tint, m);
  }
  return m;
}
function _getBeamDormantMat(tint) {
  let m = _beamDormantMatCache.get(tint);
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      color: tint, transparent: true, opacity: 0.10,
      side: THREE.DoubleSide, depthWrite: false,
    });
    _beamDormantMatCache.set(tint, m);
  }
  return m;
}
function _getBeamActiveMat(tint) {
  let m = _beamActiveMatCache.get(tint);
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      color: tint, transparent: true, opacity: 0.55,
      side: THREE.DoubleSide, depthWrite: false,
    });
    _beamActiveMatCache.set(tint, m);
  }
  return m;
}

/** Pre-build each chapter's materials so the wave-2 start doesn't stall. */
export function prewarmPowerupMats(tint) {
  _getDiskDormantMat(tint);
  _getDiskActiveMat(tint);
  _getRingMat(tint);
  _getBeamDormantMat(tint);
  _getBeamActiveMat(tint);
}

// ---------------------------------------------------------------------------
// STATE
// ---------------------------------------------------------------------------

// Zone objects built at chapter start — visible props in every wave even
// though they only accept charge in wave 2.
const zones = [];

export function getZones() { return zones; }

/** Index of the currently-active zone. -1 means "wave not running" or "all done". */
let activeIdx = -1;

// Progress on the active zone. 0..ZONE_CFG.holdTime.
let activeProgress = 0;

/**
 * Spawn all 5 zones in their inactive visual state. Called from
 * prepareChapter() at chapter start. Idempotent — clears any prior set.
 */
export function spawnPowerupZones(chapterIdx) {
  clearPowerupZones();
  const tint = CHAPTERS[chapterIdx % CHAPTERS.length].full.grid1;
  for (let i = 0; i < ZONE_DEFS.length; i++) {
    const def = ZONE_DEFS[i];
    zones.push(_buildZone(i, def, tint));
  }
}

export function clearPowerupZones() {
  for (const z of zones) {
    if (z.obj && z.obj.parent) scene.remove(z.obj);
  }
  zones.length = 0;
  activeIdx = -1;
  activeProgress = 0;
}

/** Called from waves.js when wave 2 starts. Lights up zone 0. */
export function startPowerupWave() {
  activeIdx = 0;
  activeProgress = 0;
  _lightZone(0);
}

/** Called from waves.js when wave 2 ends (EMP fired). Dims every zone. */
export function endPowerupWave() {
  activeIdx = -1;
  activeProgress = 0;
  // Dim any zone still marked active.
  for (const z of zones) {
    if (z.active) _dimZone(z);
  }
}

// ---------------------------------------------------------------------------
// ZONE BUILDER
// ---------------------------------------------------------------------------

function _buildZone(idx, def, tint) {
  const group = new THREE.Group();
  group.position.set(def.x, 0, def.z);

  const disk = new THREE.Mesh(DISK_GEO, _getDiskDormantMat(tint));
  disk.rotation.x = -Math.PI / 2;
  disk.position.y = 0.04;
  group.add(disk);

  // Progress arc — a thin ring on top of the disk. We build it as a
  // RingGeometry with a custom thetaLength that we tween on update.
  // Starts at zero length (0 rads) so it's invisible until it fills.
  const progressRingGeo = new THREE.RingGeometry(
    ZONE_CFG.radius * 0.75,
    ZONE_CFG.radius * 0.85,
    48,
    1,
    0,
    0.0001
  );
  const progressRingMat = _getRingMat(tint).clone();
  progressRingMat.opacity = 0;
  const progressRing = new THREE.Mesh(progressRingGeo, progressRingMat);
  progressRing.rotation.x = -Math.PI / 2;
  progressRing.position.y = 0.06;
  group.add(progressRing);

  // Outer ring outline for readability.
  const outline = new THREE.Mesh(RING_GEO, _getRingMat(tint));
  outline.rotation.x = -Math.PI / 2;
  outline.position.y = 0.05;
  group.add(outline);

  // Vertical pillar beam so the zone is visible from across the map.
  const beam = new THREE.Mesh(BEAM_GEO, _getBeamDormantMat(tint));
  beam.position.y = 5;
  group.add(beam);

  scene.add(group);

  return {
    idx,
    def,
    obj: group,
    pos: group.position,
    disk,
    outline,
    beam,
    progressRing,
    progressRingMat,
    tint,
    active: false,
    completed: false,
    pulsePhase: Math.random() * Math.PI * 2,
  };
}

function _lightZone(idx) {
  const z = zones[idx];
  if (!z) return;
  z.active = true;
  z.disk.material = _getDiskActiveMat(z.tint);
  z.beam.material = _getBeamActiveMat(z.tint);
  z.beam.scale.y = 1.6;
  z.beam.position.y = 8;
  // Small welcome spark so the player sees the activation.
  hitBurst(new THREE.Vector3(z.pos.x, 0.2, z.pos.z), z.tint, 10);
  hitBurst(new THREE.Vector3(z.pos.x, 3.0, z.pos.z), 0xffffff, 6);
}

function _dimZone(z) {
  if (!z) return;
  z.active = false;
  z.disk.material = _getDiskDormantMat(z.tint);
  z.beam.material = _getBeamDormantMat(z.tint);
  z.beam.scale.y = 1.0;
  z.beam.position.y = 5;
}

function _completeZone(z) {
  z.completed = true;
  // Big celebration burst.
  hitBurst(new THREE.Vector3(z.pos.x, 0.3, z.pos.z), 0xffffff, 16);
  hitBurst(new THREE.Vector3(z.pos.x, 0.3, z.pos.z), z.tint, 20);
  hitBurst(new THREE.Vector3(z.pos.x, 3.0, z.pos.z), z.tint, 12);
  _dimZone(z);
  // Leave the progress ring fully filled at dim opacity as a "completed"
  // marker, so the player can visually track what's done.
  z.progressRingMat.opacity = 0.30;
  _setProgressArc(z, 1);
}

/**
 * Update the progress ring geometry to show `frac` (0..1) of a full circle.
 * We rebuild the RingGeometry each call — cheap (48 segments, one Mesh),
 * done only on the active zone so at most once per frame.
 */
function _setProgressArc(z, frac) {
  const theta = Math.max(0.0001, Math.min(1, frac)) * Math.PI * 2;
  if (z.progressRing.geometry) z.progressRing.geometry.dispose();
  z.progressRing.geometry = new THREE.RingGeometry(
    ZONE_CFG.radius * 0.75,
    ZONE_CFG.radius * 0.85,
    48, 1,
    -Math.PI / 2,   // start at "12 o'clock"
    theta,
  );
}

// ---------------------------------------------------------------------------
// PER-FRAME UPDATE
// ---------------------------------------------------------------------------

/**
 * Tick the power-up zones. Returns the ID of a zone that JUST COMPLETED
 * this frame (one of ZONE_DEFS[].id) or null if nothing completed. The
 * caller is responsible for triggering side-effects (activating turrets,
 * firing the EMP) based on the returned id.
 *
 * Safe to call any frame — if no wave is active or there are no zones,
 * returns null immediately.
 */
export function updatePowerupZones(dt, playerPos, time) {
  if (!zones.length) return null;

  // Always tick the dormant pulse on all zones (cheap — material opacity
  // tweens; no re-alloc).
  for (const z of zones) {
    if (z.active || z.completed) continue;
    z.pulsePhase += dt;
    const p = 0.5 + 0.5 * Math.sin(z.pulsePhase * ZONE_CFG.pulseHzDormant * Math.PI * 2);
    // Don't touch the shared cached material — write to the beam scale
    // instead so we don't affect OTHER zones that share the material.
    // Actually safer: the shared material's opacity being 0.10 is fine;
    // we just nudge beam height a tiny amount.
    z.beam.scale.y = 1.0 + p * 0.08;
  }

  if (activeIdx < 0 || activeIdx >= zones.length) return null;
  const active = zones[activeIdx];
  if (!active || active.completed) return null;

  // Active-zone pulse + progress.
  active.pulsePhase += dt * 3;
  const activePulse = 0.5 + 0.5 * Math.sin(active.pulsePhase * ZONE_CFG.pulseHzActive);
  active.beam.scale.y = 1.4 + activePulse * 0.4;

  // Player inside?
  let inside = false;
  if (playerPos) {
    const dx = playerPos.x - active.pos.x;
    const dz = playerPos.z - active.pos.z;
    inside = dx * dx + dz * dz < ZONE_CFG.radiusSq;
  }

  if (inside) {
    activeProgress = Math.min(ZONE_CFG.holdTime, activeProgress + dt);
  } else {
    // Slowly decay so stepping out briefly doesn't nuke progress.
    activeProgress = Math.max(0, activeProgress - dt * 0.5);
  }

  const frac = activeProgress / ZONE_CFG.holdTime;
  active.progressRingMat.opacity = 0.65 + activePulse * 0.2;
  _setProgressArc(active, frac);

  if (activeProgress >= ZONE_CFG.holdTime) {
    const completedId = active.def.id;
    _completeZone(active);
    activeIdx++;
    activeProgress = 0;
    if (activeIdx < zones.length) {
      _lightZone(activeIdx);
    }
    return completedId;
  }

  return null;
}

// ---------------------------------------------------------------------------
// QUERIES (for the HUD + objective arrows)
// ---------------------------------------------------------------------------

/** Returns the active zone's {id, label, pos} — or null if none active. */
export function getActiveZone() {
  if (activeIdx < 0 || activeIdx >= zones.length) return null;
  const z = zones[activeIdx];
  if (!z) return null;
  return {
    id: z.def.id,
    label: z.def.label,
    pos: z.pos,
    // For TURRETS_A/B/C zones this is the turret's index in turrets.js's
    // turrets array. -1 for non-turret zones (POWER, RADIO).
    turretIdx: (typeof z.def.turretIdx === 'number') ? z.def.turretIdx : -1,
  };
}

/** Returns the current charge progress 0..1 on the active zone. */
export function getActiveProgress() {
  return activeProgress / ZONE_CFG.holdTime;
}

/** How many zones have been completed (0..ZONE_DEFS.length). */
export function getCompletedCount() {
  let n = 0;
  for (const z of zones) if (z.completed) n++;
  return n;
}

export function getZoneCount() {
  return ZONE_DEFS.length;
}

/** True if the player is currently inside the active zone's radius. */
export function isPlayerInActiveZone(playerPos) {
  const z = getActiveZone();
  if (!z || !playerPos) return false;
  const dx = playerPos.x - z.pos.x;
  const dz = playerPos.z - z.pos.z;
  return dx * dx + dz * dz < ZONE_CFG.radiusSq;
}
