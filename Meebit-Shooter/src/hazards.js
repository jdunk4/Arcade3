// Floor hazards — tetromino-shaped "lava" patches embedded in the arena
// floor. The player takes damage for standing in one; enemies path around
// them (cheap repulsion in updateEnemies). Count scales with wave number
// within the current chapter and resets each chapter.
//
// The tetrominoes are pure cosmetic+logical quads on the ground plane, so
// they cost almost nothing to render. Every chapter gets its own tint via
// CHAPTERS[i].full.grid1 mixed with a hot-orange core so the hazard reads
// as molten regardless of the theme.

import * as THREE from 'three';
import { scene } from './scene.js';
import { ARENA, CHAPTERS } from './config.js';

// Tetromino footprints — each number is a unit cell offset on the XZ grid.
// Using classic I, O, T, L, S shapes.
const TETROMINOES = [
  // I
  [[-1.5, 0], [-0.5, 0], [0.5, 0], [1.5, 0]],
  // O
  [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]],
  // T
  [[-1, 0], [0, 0], [1, 0], [0, -1]],
  // L
  [[-0.5, -1], [-0.5, 0], [-0.5, 1], [0.5, 1]],
  // S
  [[-1, 0.5], [0, 0.5], [0, -0.5], [1, -0.5]],
];

const CELL_SIZE = 1.6;             // unit cell size in world units
const SAFE_RADIUS_FROM_CENTER = 7; // don't spawn hazards right on the player spawn
const MIN_EDGE_PADDING = 6;        // keep hazards away from arena walls
const ENEMY_REPEL_RADIUS = 1.8;    // enemy gets nudged out if closer than this
const ENEMY_REPEL_STRENGTH = 2.2;  // how hard to push (velocity-scale)

// Per-hazard record: { group, cells: [{x,z}], bbox }
const hazards = [];

// Shared geometry for every tile (cheap — one alloc for the whole game).
const TILE_GEO = new THREE.PlaneGeometry(CELL_SIZE * 0.98, CELL_SIZE * 0.98);
const TILE_CORE_GEO = new THREE.PlaneGeometry(CELL_SIZE * 0.65, CELL_SIZE * 0.65);

// Material pool — keyed by tint hex so each chapter color compiles once.
const _outerMatCache = new Map();
const _coreMatCache = new Map();
function getOuterMat(tintHex) {
  let m = _outerMatCache.get(tintHex);
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      color: tintHex, transparent: true, opacity: 0.78,
      side: THREE.DoubleSide, depthWrite: false,
    });
    _outerMatCache.set(tintHex, m);
  }
  return m;
}
function getCoreMat(tintHex) {
  let m = _coreMatCache.get(tintHex);
  if (!m) {
    // Core is hot orange regardless of chapter so it reads as lava.
    const base = new THREE.Color(tintHex);
    const hot = new THREE.Color(0xff8800);
    base.lerp(hot, 0.65);
    m = new THREE.MeshBasicMaterial({
      color: base.getHex(), transparent: true, opacity: 0.95,
      side: THREE.DoubleSide, depthWrite: false,
    });
    _coreMatCache.set(tintHex, m);
  }
  return m;
}

function _placeHazard(shape, originX, originZ, rotation, tintHex) {
  const group = new THREE.Group();
  const cells = [];
  const outerMat = getOuterMat(tintHex);
  const coreMat = getCoreMat(tintHex);
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  for (const [cx, cz] of shape) {
    // Rotate the footprint, then scale and translate to world.
    const rx = cx * cos - cz * sin;
    const rz = cx * sin + cz * cos;
    const wx = originX + rx * CELL_SIZE;
    const wz = originZ + rz * CELL_SIZE;

    const outer = new THREE.Mesh(TILE_GEO, outerMat);
    outer.rotation.x = -Math.PI / 2;
    outer.position.set(wx, 0.02, wz);
    group.add(outer);

    const core = new THREE.Mesh(TILE_CORE_GEO, coreMat);
    core.rotation.x = -Math.PI / 2;
    core.position.set(wx, 0.03, wz);
    group.add(core);

    cells.push({ x: wx, z: wz });
  }

  scene.add(group);

  // Axis-aligned bbox for fast broad-phase checks (before per-cell tests)
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const c of cells) {
    if (c.x < minX) minX = c.x;
    if (c.x > maxX) maxX = c.x;
    if (c.z < minZ) minZ = c.z;
    if (c.z > maxZ) maxZ = c.z;
  }
  const pad = CELL_SIZE * 0.5;
  const haz = {
    group,
    cells,
    bbox: { minX: minX - pad, maxX: maxX + pad, minZ: minZ - pad, maxZ: maxZ + pad },
    phase: Math.random() * Math.PI * 2,
    coreMat, // ref for per-frame pulse
  };
  hazards.push(haz);
  return haz;
}

/**
 * Spawn hazards for the given wave. Count scales with localWave (1 → 5 → …).
 * Chapter index picks the tint. Call clearHazards() first at every
 * chapter boundary.
 */
export function spawnHazardsForWave(chapterIdx, localWave) {
  const chapter = CHAPTERS[chapterIdx % CHAPTERS.length];
  const tint = chapter.full.grid1;
  // 2, 4, 6, 8, 10 hazards per wave 1-5
  const target = Math.min(10, localWave * 2);
  let attempts = 0;
  while (hazards.length < target && attempts < target * 10) {
    attempts++;
    const shape = TETROMINOES[Math.floor(Math.random() * TETROMINOES.length)];
    const limit = ARENA - MIN_EDGE_PADDING;
    const x = (Math.random() - 0.5) * 2 * limit;
    const z = (Math.random() - 0.5) * 2 * limit;
    // Don't stomp on the player spawn zone at the origin.
    if (x * x + z * z < SAFE_RADIUS_FROM_CENTER * SAFE_RADIUS_FROM_CENTER) continue;
    const rot = [0, Math.PI / 2, Math.PI, -Math.PI / 2][Math.floor(Math.random() * 4)];
    _placeHazard(shape, x, z, rot, tint);
  }
}

export function clearHazards() {
  for (const h of hazards) {
    if (h.group.parent) scene.remove(h.group);
    h.group.traverse(o => { if (o.geometry && o.geometry !== TILE_GEO && o.geometry !== TILE_CORE_GEO) o.geometry.dispose(); });
  }
  hazards.length = 0;
}

/**
 * Returns true if (x, z) is inside any hazard cell. Cheap broad-phase
 * bbox check first, then per-cell AABB against the unit square.
 */
export function isHazardAt(x, z) {
  const half = CELL_SIZE * 0.49;
  for (const h of hazards) {
    const b = h.bbox;
    if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
    for (const c of h.cells) {
      if (Math.abs(x - c.x) < half && Math.abs(z - c.z) < half) return true;
    }
  }
  return false;
}

/**
 * Damage the player if they're on a hazard. Call every frame.
 * Returns true if damage was dealt.
 */
export function hurtPlayerIfOnHazard(dt, playerPos, S, UI, Audio, shake) {
  if (S.invulnTimer > 0) return false;
  if (!isHazardAt(playerPos.x, playerPos.z)) return false;
  // 10 dps continuous, with a small periodic flash every ~0.4s so it
  // doesn't strobe every frame.
  S._hazardTickTimer = (S._hazardTickTimer || 0) - dt;
  S.hp -= 10 * dt;
  if (S._hazardTickTimer <= 0) {
    S._hazardTickTimer = 0.4;
    if (UI && UI.damageFlash) UI.damageFlash();
    if (Audio && Audio.damage) Audio.damage();
    if (shake) shake(0.12, 0.1);
  }
  if (S.hp <= 0) S.hp = 0;
  return true;
}

/**
 * Pathing nudge — called from updateEnemies. Pushes an enemy out of any
 * hazard it's touching. Cheap (bbox skip + nearest-cell check).
 */
export function repelEnemyFromHazards(e, dt) {
  for (const h of hazards) {
    const b = h.bbox;
    if (e.pos.x < b.minX - ENEMY_REPEL_RADIUS || e.pos.x > b.maxX + ENEMY_REPEL_RADIUS) continue;
    if (e.pos.z < b.minZ - ENEMY_REPEL_RADIUS || e.pos.z > b.maxZ + ENEMY_REPEL_RADIUS) continue;
    // Find nearest cell and nudge away from it
    let best = null, bestD = Infinity;
    for (const c of h.cells) {
      const dx = e.pos.x - c.x;
      const dz = e.pos.z - c.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD) { bestD = d2; best = c; }
    }
    if (best && bestD < ENEMY_REPEL_RADIUS * ENEMY_REPEL_RADIUS) {
      const d = Math.sqrt(bestD) || 0.001;
      const nx = (e.pos.x - best.x) / d;
      const nz = (e.pos.z - best.z) / d;
      e.pos.x += nx * ENEMY_REPEL_STRENGTH * dt;
      e.pos.z += nz * ENEMY_REPEL_STRENGTH * dt;
    }
  }
}

/**
 * Per-frame pulse of the hazard cores so they look molten.
 * Since all hazards in a chapter share the same core material, we pulse
 * each cached material once (not once per hazard) — 10× cheaper and
 * avoids the per-hazard clobbering of a shared material's opacity.
 */
export function updateHazards(dt, timeElapsed) {
  if (hazards.length === 0) return;
  // Global pulse — subtle 0.8 → 1.0 at 2Hz.
  const pulse = 0.85 + Math.sin(timeElapsed * 2) * 0.1 + Math.sin(timeElapsed * 3.3) * 0.05;
  const opacity = Math.max(0.6, Math.min(1, pulse));
  for (const mat of _coreMatCache.values()) mat.opacity = opacity;
}
