// ============================================================================
// src/triangles.js — arena wedge assignment for wave 1/2/3 objectives.
//
// The arena is split into three 120° wedges meeting at the origin. Every
// chapter, we shuffle which of the three waves (mining, power-up, hive)
// gets which wedge. That means run-to-run the same chapter feels
// different: chapter 1 might have the mining depot northeast and the
// compound south, while chapter 2 might reverse them.
//
// The wedges all START a few units out from the origin (INNER_RADIUS) so
// the player spawn point at (0,0) stays clear of props. They extend out
// to OUTER_RADIUS, stopping short of the arena wall so objectives don't
// hug the edge.
//
// Boss (wave 5) and bonus herd (wave 4) ignore triangles entirely — they
// use the whole arena. Only the three "work" waves are wedge-locked.
// ============================================================================

import { ARENA } from './config.js';

export const INNER_RADIUS = 8;       // clear zone around spawn
export const OUTER_RADIUS = ARENA - 10;  // don't touch the walls

// Three wedge center angles, 120° apart. We rotate the whole arrangement
// by a fixed offset so triangle boundaries don't align with the world
// axes (feels more organic + the player isn't staring down a seam).
const ROT_OFFSET = Math.PI / 6;  // 30°, so first wedge center is at 30°

const WEDGE_HALF_WIDTH = Math.PI / 3;  // ±60° from centerline

// Three triangles (wedges), indexed 0..2. Each has a center angle and
// the two boundary angles. Coordinates are in world XZ, with angle 0
// pointing along +X.
const TRIANGLES = [];
for (let i = 0; i < 3; i++) {
  const centerAngle = ROT_OFFSET + (i * 2 * Math.PI) / 3;
  TRIANGLES.push({
    idx: i,
    centerAngle,
    minAngle: centerAngle - WEDGE_HALF_WIDTH,
    maxAngle: centerAngle + WEDGE_HALF_WIDTH,
    // Centroid in world space — useful for placing single props like
    // depot, silo compound center. Radius chosen about 40% out so
    // there's room for the prop + some buffer around it.
    centroid: {
      x: Math.cos(centerAngle) * (INNER_RADIUS + (OUTER_RADIUS - INNER_RADIUS) * 0.40),
      z: Math.sin(centerAngle) * (INNER_RADIUS + (OUTER_RADIUS - INNER_RADIUS) * 0.40),
    },
  });
}

// Per-chapter assignment: which triangle idx does each wave use? Shuffled
// when prepareChapter fires. Indexed by wave kind:
//   'mining'  → wave 1
//   'powerup' → wave 2
//   'hive'    → wave 3
let _assignment = {
  mining: 0,
  powerup: 1,
  hive: 2,
};

/**
 * Shuffle the triangle-to-wave assignment for a new chapter. Uses Math.random
 * so two runs of the same chapter can produce different layouts.
 */
export function shuffleTriangleAssignment() {
  const indices = [0, 1, 2];
  // Fisher-Yates
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  _assignment = {
    mining: indices[0],
    powerup: indices[1],
    hive: indices[2],
  };
  console.info('[triangles] assignment', _assignment);
  return _assignment;
}

/** Returns the triangle object for a given wave kind. */
export function getTriangleFor(waveKind) {
  const idx = _assignment[waveKind];
  if (idx === undefined) return TRIANGLES[0];
  return TRIANGLES[idx];
}

export function getAssignment() {
  return { ..._assignment };
}

/** Returns an array copy of all 3 triangles (for debug/visual overlay). */
export function getAllTriangles() {
  return TRIANGLES.slice();
}

// ----------------------------------------------------------------------------
// GEOMETRY HELPERS
// ----------------------------------------------------------------------------

/** Angle normalized to [-π, π]. */
function _normalizeAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * True if the world point (x, z) is inside the given triangle wedge
 * (ignoring inner/outer radius constraints). Used by block-drop +
 * hive-placement to filter candidate random positions.
 */
export function pointInTriangle(triangle, x, z) {
  const angle = Math.atan2(z, x);
  const delta = _normalizeAngle(angle - triangle.centerAngle);
  return Math.abs(delta) <= WEDGE_HALF_WIDTH;
}

/**
 * Pick a random point inside a triangle wedge between two radii. Uses
 * rejection sampling on the angle (cheap — half-width is 60° so hit rate
 * is ~33% if we sampled over a full circle, but we pick an angle directly
 * from the wedge so no rejection needed).
 *
 * @param triangle - from getTriangleFor()
 * @param rMin     - inner radius (default INNER_RADIUS, or bigger if caller wants a buffer)
 * @param rMax     - outer radius (default OUTER_RADIUS)
 */
export function pickPointInTriangle(triangle, rMin = INNER_RADIUS, rMax = OUTER_RADIUS) {
  // Uniform angle inside the wedge.
  const a = triangle.minAngle + Math.random() * (triangle.maxAngle - triangle.minAngle);
  // Uniform radius weighted by r so the distribution is area-uniform
  // (otherwise points cluster near rMin).
  const u = Math.random();
  const r = Math.sqrt(u * (rMax * rMax - rMin * rMin) + rMin * rMin);
  return { x: Math.cos(a) * r, z: Math.sin(a) * r };
}

/**
 * Convenience lookup: the centroid of the triangle assigned to a wave kind.
 * The power-up compound uses this to place the silo at the wedge centroid
 * (the rest of the compound is laid out relative to that point by waveProps).
 */
export function getCentroidFor(waveKind) {
  const t = getTriangleFor(waveKind);
  return { x: t.centroid.x, z: t.centroid.z };
}

/**
 * Center angle (radians) of the triangle assigned to a wave kind. waveProps
 * uses this to orient the power-up compound so the silo faces "outward"
 * from the arena center.
 */
export function getCenterAngleFor(waveKind) {
  const t = getTriangleFor(waveKind);
  return t.centerAngle;
}
