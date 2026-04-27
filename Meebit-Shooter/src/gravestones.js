// gravestones.js — Tilted upright stone slabs placed around the arena
// perimeter for atmosphere. Each stone has an X or O carving on its
// front face that glows in the current chapter's tint. The carvings
// retint on chapter transitions via recolorGravestones(tintHex).
//
// Why X and O specifically: gives the perimeter an "arena scoreboard"
// vibe — wins and losses, chapter after chapter, etched permanently
// into the world. The random per-stone assignment plus the slight
// yaw jitter makes the formation read as a casual graveyard rather
// than a parade.
//
// Implementation approach:
//   - One non-instanced THREE.Group per stone (12-16 total). Low
//     enough draw-call count that we can afford the per-stone child
//     meshes for the carvings.
//   - Stone slab is a flat box ~0.7w × 1.1h × 0.15d. Slightly tilted
//     forward and yawed randomly so they read as weathered.
//   - Carving is a thin emissive plane on the front face. X is two
//     crossed thin boxes; O is a flat torus.
//   - All carvings share the same chapter tint at any time.
//
// Public API:
//   spawnGravestones(count = 14)  — initial spawn at game start
//   recolorGravestones(tintHex)   — retint carvings on chapter change
//   clearGravestones()             — remove all stones (game reset)

import * as THREE from 'three';
import { scene } from './scene.js';
import { ARENA } from './config.js';

// ---- Layout tunables ----
const STONE_W = 0.7;
const STONE_H = 1.1;
const STONE_D = 0.15;
// Place stones in the band between the arena edge (~ARENA = 50) and
// the inner row of lanterns. The lantern crowd's first row sits at
// ARENA + OUTER_PADDING (= 58). Stones inside that band feel like
// they belong to the arena, not the crowd.
const PERIMETER_INNER = ARENA - 2.0;
const PERIMETER_OUTER = ARENA + 5.0;

// ---- Materials ----
// Stone slab — desaturated dark grey with a very subtle warm tint so
// it doesn't read as flat developer-grey. Same material reused across
// every stone (no per-stone clone — material edits would affect all
// stones, but we never edit stone material per-stone, only the
// CARVING material which IS cloned).
const _stoneMat = new THREE.MeshStandardMaterial({
  color: 0x3d3d44,
  roughness: 0.95,
  metalness: 0.05,
  emissive: 0x0a0a0d,
  emissiveIntensity: 0.1,
});

// Carving material is per-stone-cloned so each stone can independently
// pulse if we ever want that. For now they all match chapter tint.
function _newCarvingMat(tintHex) {
  return new THREE.MeshStandardMaterial({
    color: tintHex,
    emissive: tintHex,
    emissiveIntensity: 1.6,
    roughness: 0.4,
    metalness: 0.2,
  });
}

// ---- Geometries (singletons — shared across stones) ----
const _slabGeo = new THREE.BoxGeometry(STONE_W, STONE_H, STONE_D);
// X carving — two thin crossed boxes. Each arm 0.45 long, 0.06 thick.
// Rotated to form an X on the stone's front face.
const _xArmGeo = new THREE.BoxGeometry(0.06, 0.45, 0.04);
// O carving — flat torus (a flat ring on the front face).
const _oRingGeo = new THREE.TorusGeometry(0.18, 0.04, 8, 24);

// Module state
const _stones = [];              // { group, carvingMat, kind: 'X'|'O' }

/** Build one gravestone group at (x, z). Random X-or-O assignment. */
function _buildStone(x, z, tintHex) {
  const group = new THREE.Group();

  // Slab — centered with bottom on ground
  const slab = new THREE.Mesh(_slabGeo, _stoneMat);
  slab.position.y = STONE_H * 0.5;
  group.add(slab);

  // 50/50 X or O
  const isX = Math.random() < 0.5;
  const carvingMat = _newCarvingMat(tintHex);

  if (isX) {
    // Two crossed arms forming an X. Stand them on the front face
    // (slightly forward of slab center along +Z so they don't
    // z-fight with the slab surface).
    const arm1 = new THREE.Mesh(_xArmGeo, carvingMat);
    arm1.position.set(0, STONE_H * 0.5, STONE_D * 0.5 + 0.025);
    arm1.rotation.z = Math.PI / 4;
    group.add(arm1);
    const arm2 = new THREE.Mesh(_xArmGeo, carvingMat);
    arm2.position.set(0, STONE_H * 0.5, STONE_D * 0.5 + 0.025);
    arm2.rotation.z = -Math.PI / 4;
    group.add(arm2);
  } else {
    const ring = new THREE.Mesh(_oRingGeo, carvingMat);
    ring.position.set(0, STONE_H * 0.5, STONE_D * 0.5 + 0.045);
    // Torus default orientation lays it flat (XY plane). We want it
    // facing forward (XZ plane facing +Z) — rotate around X by π/2.
    // No — we want the ring's plane perpendicular to the stone's
    // front-facing normal. Default torus has tube axis along Z, so
    // it already faces +Z correctly without any rotation.
    group.add(ring);
  }

  // Slight forward tilt + random yaw so the formation reads as
  // weathered. Small angles only — too much and the stones look
  // like they're falling over.
  group.rotation.x = (Math.random() - 0.5) * 0.10;     // ±~3°
  group.rotation.y = Math.random() * Math.PI * 2;      // free yaw
  group.rotation.z = (Math.random() - 0.5) * 0.10;     // ±~3°

  group.position.set(x, 0, z);

  return { group, carvingMat, kind: isX ? 'X' : 'O' };
}

/** Pick a random position in the perimeter band (inside_radius,
 *  outside_radius). Returns null if the band is too thin. */
function _pickPerimeterPos() {
  // Pick a random angle and a random radius in [INNER, OUTER]. Square
  // arena, so we constrain to the square's perimeter band rather than
  // a circular one — pick a side first, then a distance along that
  // side, then a depth into the band.
  const side = Math.floor(Math.random() * 4);
  const along = (Math.random() * 2 - 1) * (PERIMETER_OUTER - 1.0);
  const depth = PERIMETER_INNER + Math.random() * (PERIMETER_OUTER - PERIMETER_INNER);
  switch (side) {
    case 0: return { x: along,   z: -depth };   // south side
    case 1: return { x: along,   z:  depth };   // north
    case 2: return { x: -depth,  z: along };    // west
    case 3: return { x:  depth,  z: along };    // east
  }
  return { x: 0, z: -PERIMETER_INNER };
}

/** Spawn `count` gravestones around the arena perimeter. Idempotent —
 *  calling twice spawns more (use clearGravestones first to reset).
 *  The initial chapter tint is required for first-render carvings;
 *  recolorGravestones(tint) updates it on chapter changes. */
export function spawnGravestones(count = 14, initialTint = 0xff6a1a) {
  for (let i = 0; i < count; i++) {
    const p = _pickPerimeterPos();
    if (!p) continue;
    const stone = _buildStone(p.x, p.z, initialTint);
    scene.add(stone.group);
    _stones.push(stone);
  }
}

/** Update every gravestone's carving emissive color to the new chapter
 *  tint. Called from main.js's chapter-transition path. */
export function recolorGravestones(tintHex) {
  for (const s of _stones) {
    if (s.carvingMat) {
      s.carvingMat.color.setHex(tintHex);
      s.carvingMat.emissive.setHex(tintHex);
    }
  }
}

/** Remove every gravestone from the scene. Called on full game reset. */
export function clearGravestones() {
  for (const s of _stones) {
    if (s.group && s.group.parent) scene.remove(s.group);
    if (s.carvingMat && s.carvingMat.dispose) s.carvingMat.dispose();
  }
  _stones.length = 0;
}
