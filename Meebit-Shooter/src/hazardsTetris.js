// Tetris hazard style — chapter 1 visuals.
//
// Tetromino-shaped tiles delivered via a 3D block that hovers over the
// target spot for ~0.8s (telegraph), then slams into the floor. This
// is the original hazard system that pre-dated the chapter-pluggable
// refactor; it has been extracted from hazards.js into this dedicated
// style module so chapter 2 (Galaga) and later chapters can implement
// their own visuals without forking the whole hazards system.
//
// The style exposes 5 hooks that hazards.js calls into:
//   - getCellSize()              — grid quantization unit (2.5u for tetris)
//   - chooseSpawnLocation()      — pick a random valid spot in the active ring
//   - spawnDelivery(spot, tint)  — build the warning visual at the spot
//   - tickDeliveries(dt)         — advance animations, return list of completed
//                                  deliveries (these become hazard tiles)
//   - cleanup()                  — wipe in-flight deliveries on reset

import * as THREE from 'three';
import { scene } from './scene.js';
import { ARENA } from './config.js';
import { hitBurst } from './effects.js';

// Tetromino footprints — each number is a unit cell offset on the XZ grid.
// Used at spawn time to determine which 4 cells a piece will occupy.
const TETROMINOES = [
  [[-1.5, 0], [-0.5, 0], [0.5, 0], [1.5, 0]],           // I
  [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]], // O
  [[-1, 0], [0, 0], [1, 0], [0, -1]],                    // T
  [[-0.5, -1], [-0.5, 0], [-0.5, 1], [0.5, 1]],          // L
  [[-1, 0.5], [0, 0.5], [0, -0.5], [1, -0.5]],           // S
];

// CELL_SIZE matches the arena floor grid spacing so tiles align to grid
// lines. Floor uses GridHelper(ARENA*2, 40) → 2.5u per grid cell.
const CELL_SIZE = 2.5;

// Animation timing.
const HOVER_HEIGHT = 5.0;
const WARNING_DURATION = 0.8;
const DROP_DURATION = 0.35;

// Block + shadow geometry — allocated once.
const BLOCK_GEO = new THREE.BoxGeometry(CELL_SIZE * 0.9, CELL_SIZE * 0.9, CELL_SIZE * 0.9);
const SHADOW_GEO = new THREE.CircleGeometry(CELL_SIZE * 0.55, 16);

const _shadowMat = new THREE.MeshBasicMaterial({
  color: 0x000000,
  transparent: true,
  opacity: 0.4,
  depthWrite: false,
  side: THREE.DoubleSide,
});

// Material cache for the warning blocks (per chapter tint).
const _blockMatCache = new Map();
function getBlockMat(tintHex) {
  let m = _blockMatCache.get(tintHex);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color: tintHex,
      emissive: tintHex,
      emissiveIntensity: 0.9,
      transparent: true,
      opacity: 0.85,
      metalness: 0.2,
      roughness: 0.4,
    });
    _blockMatCache.set(tintHex, m);
  }
  return m;
}

// In-flight deliveries: each entry is a hovering block that hasn't
// landed yet. tickDeliveries() animates these and reports back to
// hazards.js when one finishes (so hazards.js can place its tile).
const _incoming = [];

// Compute the list of cells a tetromino covers given its origin + rotation.
function _cellsFor(shape, originX, originZ, rotation) {
  const cos = Math.cos(rotation), sin = Math.sin(rotation);
  const cells = [];
  for (const [cx, cz] of shape) {
    const rx = cx * cos - cz * sin;
    const rz = cx * sin + cz * cos;
    cells.push({ x: originX + rx * CELL_SIZE, z: originZ + rz * CELL_SIZE });
  }
  return cells;
}

/**
 * The cell quantization size for this style. hazards.js uses this for
 * grid alignment and tile geometry sizing.
 */
export function getCellSize() {
  return CELL_SIZE;
}

/**
 * Pick a spawn location for the next tile. hazards.js passes in:
 *   - ringInner / ringOuter — the active concentric ring (Chebyshev distance)
 *   - validate(cells, originX, originZ) — returns true if the spot
 *     passes player/zone/edge/overlap checks
 *
 * Returns a `spot` object that spawnDelivery accepts, or null if no
 * valid spot found in this attempt.
 */
export function chooseSpawnLocation(ringInner, ringOuter, validate) {
  const shape = TETROMINOES[Math.floor(Math.random() * TETROMINOES.length)];
  const cheb = ringInner + Math.random() * (ringOuter - ringInner);
  const edge = Math.floor(Math.random() * 4);
  const along = (Math.random() * 2 - 1) * cheb;
  let rawX, rawZ;
  if (edge === 0) { rawX = along;  rawZ = cheb; }
  else if (edge === 1) { rawX = along;  rawZ = -cheb; }
  else if (edge === 2) { rawX = cheb;   rawZ = along; }
  else { rawX = -cheb;  rawZ = along; }
  const x = Math.round(rawX / (CELL_SIZE * 0.5)) * (CELL_SIZE * 0.5);
  const z = Math.round(rawZ / (CELL_SIZE * 0.5)) * (CELL_SIZE * 0.5);
  const rot = [0, Math.PI / 2, Math.PI, -Math.PI / 2][Math.floor(Math.random() * 4)];
  const cells = _cellsFor(shape, x, z, rot);
  if (!validate(cells, x, z)) return null;
  return { shape, x, z, rot, cells };
}

/**
 * Spawn the warning visual for a delivery. Returns nothing — the
 * delivery is tracked internally and reported via tickDeliveries.
 *
 * spot: { shape, x, z, rot, cells } from chooseSpawnLocation
 * tintHex: chapter color for the block + final tile
 */
export function spawnDelivery(spot, tintHex) {
  const group = new THREE.Group();
  const blockMat = getBlockMat(tintHex);
  const blocks = [];
  const shadows = [];
  for (const c of spot.cells) {
    const block = new THREE.Mesh(BLOCK_GEO, blockMat);
    block.position.set(c.x, HOVER_HEIGHT + CELL_SIZE * 0.5, c.z);
    group.add(block);
    blocks.push(block);

    const shadow = new THREE.Mesh(SHADOW_GEO, _shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(c.x, 0.02, c.z);
    shadow.scale.setScalar(0.6);
    group.add(shadow);
    shadows.push(shadow);
  }
  scene.add(group);
  _incoming.push({
    group, blocks, shadows,
    cells: spot.cells,
    tintHex,
    t: 0,
    landed: false,
  });
}

/**
 * Tick all in-flight deliveries. Returns an array of completed
 * deliveries — each one tells hazards.js "these cells should now
 * become a damage tile, with this tint."
 */
export function tickDeliveries(dt) {
  const completed = [];
  for (let i = _incoming.length - 1; i >= 0; i--) {
    const inc = _incoming[i];
    inc.t += dt;
    const warnEnd = WARNING_DURATION;
    const fallEnd = WARNING_DURATION + DROP_DURATION;

    if (inc.t < warnEnd) {
      // HOVER + WARN PULSE
      const p = inc.t / warnEnd;
      const pulse = 0.75 + 0.5 * Math.sin(inc.t * 12);
      for (const b of inc.blocks) {
        b.position.y = HOVER_HEIGHT + CELL_SIZE * 0.5 + Math.sin(inc.t * 6) * 0.15;
        b.material.opacity = 0.6 + pulse * 0.25;
      }
      const sh = 0.4 + p * 0.6;
      for (const s of inc.shadows) s.scale.setScalar(sh);
    } else if (inc.t < fallEnd) {
      // FALL — ease-in (gravity-like acceleration)
      const f = (inc.t - warnEnd) / DROP_DURATION;
      const eased = f * f;
      const y = HOVER_HEIGHT * (1 - eased) + CELL_SIZE * 0.5;
      for (const b of inc.blocks) {
        b.position.y = y;
        b.material.opacity = 0.95;
      }
      const sh = 1.0 - f * 0.2;
      for (const s of inc.shadows) s.scale.setScalar(sh);
    } else {
      // LAND — report this delivery as completed and remove the visual
      if (!inc.landed) {
        inc.landed = true;
        completed.push({
          cells: inc.cells,
          tintHex: inc.tintHex,
        });
        // Small impact burst at the center of the piece.
        let cx = 0, cz = 0;
        for (const c of inc.cells) { cx += c.x; cz += c.z; }
        cx /= inc.cells.length; cz /= inc.cells.length;
        try { hitBurst({ x: cx, y: 0.3, z: cz }, inc.tintHex, 6); } catch (e) {}
        if (inc.group.parent) scene.remove(inc.group);
        _incoming.splice(i, 1);
      }
    }
  }
  return completed;
}

/** Wipe all in-flight deliveries (called on chapter change / reset). */
export function cleanup() {
  for (const inc of _incoming) {
    if (inc.group.parent) scene.remove(inc.group);
  }
  _incoming.length = 0;
}

/** Diagnostic — number of bugs/blocks currently in flight. */
export function getInFlightCount() {
  return _incoming.length;
}
