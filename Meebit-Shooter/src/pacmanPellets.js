// Power pellets — chapter 4 power-up tokens that turn ghosts vulnerable.
//
// Four pellets at fixed positions inside the safe zone, near its diagonal
// corners. Pellets glow + pulse continuously to read as "active." Pac-Man
// (only) eats them on contact: pellet despawns, ghost vulnerability is
// triggered, pellet respawns 30s later.
//
// Player walking over a pellet has no effect — pellets are scenery for
// the player, fuel for Pac-Man.
//
// Public API:
//   spawnPellets()                  — initialize all 4 pellets
//   despawnPellets()                — remove pellets from scene
//   updatePellets(dt)               — animate pulse, tick respawn timers
//   tryConsumePelletAt(pos, radius) — Pac-Man's eat-check; returns true
//                                     if a pellet was at that position
//                                     (and consumes it)
//   getNearestActivePellet(pos)     — for Pac-Man's seek behavior
//   arePelletsActive()              — true if at least one pellet exists

import * as THREE from 'three';
import { scene } from './scene.js';

const PELLET_COUNT = 4;
const PELLET_RADIUS = 0.42;
const PELLET_HEIGHT = 0.6;          // floats above the floor
const RESPAWN_DURATION = 30.0;      // seconds before a consumed pellet returns
// Grid-aligned position so Pac-Man (who snaps to multiples of CELL_SIZE
// = 2.5u) can actually arrive at the pellet's cell. Previously this was
// 6.0 which meant pellets sat between grid cells — Pac-Man's nearest
// cells were (5, -5) or (7.5, -7.5), both ~1.41u away, but eat radius
// was only 1.0. Result: pellets were never reached. 5.0 IS a grid
// position so Pac-Man lands directly on top.
const PELLET_DIST_FROM_CENTER = 5.0;

// Geometry + material — single-instance shared across all 4 pellets.
const PELLET_GEO = new THREE.SphereGeometry(PELLET_RADIUS, 14, 14);
const PELLET_MAT = new THREE.MeshStandardMaterial({
  color: 0xffeb3b,
  emissive: 0xfff176,
  emissiveIntensity: 1.4,
  metalness: 0.1,
  roughness: 0.3,
});

// Module state: array of pellets, each with position + state.
//   { mesh, x, z, state: 'ACTIVE' | 'RESPAWNING', respawnTimer: 0..RESPAWN_DURATION }
const _pellets = [];
let _initialized = false;

function _initPositions() {
  // 4 diagonal corners of the safe zone:
  //   (+d, +d), (-d, +d), (-d, -d), (+d, -d)
  // where d = PELLET_DIST_FROM_CENTER
  const d = PELLET_DIST_FROM_CENTER;
  return [
    { x: +d, z: +d },
    { x: -d, z: +d },
    { x: -d, z: -d },
    { x: +d, z: -d },
  ];
}

export function spawnPellets() {
  if (_initialized) return;
  const positions = _initPositions();
  for (const pos of positions) {
    const mesh = new THREE.Mesh(PELLET_GEO, PELLET_MAT.clone());
    mesh.position.set(pos.x, PELLET_HEIGHT, pos.z);
    scene.add(mesh);
    _pellets.push({
      mesh,
      x: pos.x,
      z: pos.z,
      state: 'ACTIVE',
      respawnTimer: 0,
      pulsePhase: Math.random() * Math.PI * 2,
    });
  }
  _initialized = true;
}

export function despawnPellets() {
  for (const p of _pellets) {
    if (p.mesh.parent) scene.remove(p.mesh);
  }
  _pellets.length = 0;
  _initialized = false;
}

export function updatePellets(dt) {
  if (!_initialized) return;
  for (const p of _pellets) {
    if (p.state === 'ACTIVE') {
      // Pulse animation — emissive intensity oscillates around 1.4,
      // scale oscillates ~5%.
      p.pulsePhase += dt * 4;
      const pulse = Math.sin(p.pulsePhase);
      p.mesh.material.emissiveIntensity = 1.0 + pulse * 0.5;
      const sc = 1.0 + pulse * 0.06;
      p.mesh.scale.set(sc, sc, sc);
      // Slight bob up/down.
      p.mesh.position.y = PELLET_HEIGHT + Math.sin(p.pulsePhase * 0.7) * 0.05;
    } else if (p.state === 'RESPAWNING') {
      p.respawnTimer -= dt;
      if (p.respawnTimer <= 0) {
        p.state = 'ACTIVE';
        p.mesh.visible = true;
        p.respawnTimer = 0;
      }
    }
  }
}

/**
 * Test if a pellet exists at the given position (within a radius). If
 * so, mark it as RESPAWNING and return true. Returns false if no pellet
 * was at that position.
 *
 * Called by Pac-Man's update loop each frame against his current pos.
 */
export function tryConsumePelletAt(pos, radius) {
  if (!_initialized || !pos) return false;
  const r2 = radius * radius;
  for (const p of _pellets) {
    if (p.state !== 'ACTIVE') continue;
    const dx = p.x - pos.x;
    const dz = p.z - pos.z;
    if (dx * dx + dz * dz < r2) {
      p.state = 'RESPAWNING';
      p.respawnTimer = RESPAWN_DURATION;
      p.mesh.visible = false;
      return true;
    }
  }
  return false;
}

/**
 * Return the {x, z} of the nearest active pellet to a given pos, or
 * null if no active pellets. Used by Pac-Man's wander logic to bias
 * movement toward pellets when not hunting ghosts.
 */
export function getNearestActivePellet(pos) {
  if (!_initialized || !pos) return null;
  let best = null;
  let bestDist = Infinity;
  for (const p of _pellets) {
    if (p.state !== 'ACTIVE') continue;
    const dx = p.x - pos.x;
    const dz = p.z - pos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestDist) { bestDist = d2; best = p; }
  }
  return best ? { x: best.x, z: best.z } : null;
}

export function arePelletsActive() {
  if (!_initialized) return false;
  for (const p of _pellets) if (p.state === 'ACTIVE') return true;
  return false;
}
