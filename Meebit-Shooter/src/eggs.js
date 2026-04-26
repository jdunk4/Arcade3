// eggs.js — Green everlasting gobstopper EGG spawning for the
// chapter-1 reflow. Replaces the falling mining blocks with 4 eggs
// hand-loaded into the depot wedge. Player shoots each egg ~20 times
// to crack and shatter it, dropping a charge pickup the player walks
// over to collect.
//
// Design choices:
//   - Eggs join the existing `blocks` array as objects with kind:'egg'.
//     Why: the bullet → block hit code in main.js already iterates
//     blocks for every weapon (pistol, smg, shotgun, rocket, raygun,
//     flame, lifedrainer). Adding kind='egg' lets us reuse all that
//     hit detection without touching 6+ weapon code paths.
//   - Egg-kind blocks override the visual mesh (green emissive ovoid
//     with a thin gold band) but use the standard hp/scale/hitFlash
//     fields so existing damageBlock logic runs unchanged.
//   - On shatter, eggs drop a single ore (the "charge" residue). They
//     do NOT trigger the block AoE explosion handler — that's a
//     mining-block flavor and would feel wrong for eggs.
//
// Public API:
//   spawnEggsInDepotWedge(chapterIdx, count = 4)  — place 4 eggs
//   isEgg(block)                                  — true if kind:'egg'
//   shouldEggDropOre(block)                       — true once for the egg
//   onEggDestroyed(block)                         — called from blocks.js
//                                                  when an egg's hp drops
//                                                  to 0; returns ore drop pos

import * as THREE from 'three';
import { scene } from './scene.js';
import { BLOCK_CONFIG, ARENA, CHAPTERS } from './config.js';
import { hitBurst } from './effects.js';
import { shake } from './state.js';
import { blocks } from './blocks.js';
import { spawnOre, depot } from './ores.js';
import { getTriangleFor } from './triangles.js';

// ---- Visuals ----
// Egg radius — slightly larger than block half-size so the egg reads
// as a similar volume to a mining block. Ovoid: scaled along Y so it's
// taller than wide, like an actual egg.
const EGG_RADIUS = 0.85;
const EGG_HEIGHT_SCALE = 1.15;        // y-stretch factor — eggs are ovoid
const EGG_HP = 20;                    // ~20 shots per user spec
const EGG_GREEN = 0xff8826;           // bright orange (kept var name for diff minimalism)
const EGG_GREEN_DEEP = 0xcc5500;      // deeper orange for body
const EGG_BAND_GOLD = 0xffd633;       // gold band for accent

const _eggBodyGeo = new THREE.SphereGeometry(EGG_RADIUS, 20, 14);
const _eggBandGeo = new THREE.TorusGeometry(EGG_RADIUS * 0.78, EGG_RADIUS * 0.10, 8, 24);

function _getEggBodyMat() {
  // Cached singleton — all 4 eggs share the same material. We'll clone
  // per-instance only if we need per-egg hitFlash animation (we do —
  // existing damageBlock code mutates emissiveIntensity).
  return new THREE.MeshStandardMaterial({
    color: EGG_GREEN_DEEP,
    emissive: EGG_GREEN,
    emissiveIntensity: 0.5,
    roughness: 0.35,
    metalness: 0.1,
  });
}

function _getEggBandMat() {
  return new THREE.MeshStandardMaterial({
    color: EGG_BAND_GOLD,
    emissive: EGG_BAND_GOLD,
    emissiveIntensity: 0.7,
    roughness: 0.4,
    metalness: 0.6,
  });
}

// ---- Vein geometry generator ----
// Build a procedural vein network on a unit sphere. Returns a
// BufferGeometry of line segments traced over the sphere surface.
// Each "vein" starts at a random point and walks outward in a curved
// path with small random kinks, like a meandering bioluminescent
// vessel. The geometry is built ONCE and cached; per-egg variation
// comes from random rotations of the same network.
const _veinGeoCache = (() => {
  const positions = [];
  // 12 main veins, each ~6 segments long
  const VEIN_COUNT = 12;
  const SEG_PER_VEIN = 6;
  const RADIUS = 1.0;       // unit sphere — scaled by egg geo
  for (let v = 0; v < VEIN_COUNT; v++) {
    // Start point on sphere — random direction
    const startTheta = Math.random() * Math.PI * 2;
    const startPhi = Math.random() * Math.PI;
    let curTheta = startTheta;
    let curPhi = startPhi;
    let prevX = 0, prevY = 0, prevZ = 0;
    for (let s = 0; s <= SEG_PER_VEIN; s++) {
      // Convert (theta, phi) to xyz on unit sphere
      const sinPhi = Math.sin(curPhi);
      const x = RADIUS * sinPhi * Math.cos(curTheta);
      const y = RADIUS * Math.cos(curPhi);
      const z = RADIUS * sinPhi * Math.sin(curTheta);
      if (s > 0) {
        // Push two endpoints (LineSegments draws independent segs)
        positions.push(prevX, prevY, prevZ);
        positions.push(x, y, z);
      }
      prevX = x; prevY = y; prevZ = z;
      // Walk: small random angular step
      curTheta += (Math.random() - 0.5) * 0.4;
      curPhi += (Math.random() - 0.4) * 0.35;     // slight bias toward +phi
      // Clamp phi so we don't wander past poles
      if (curPhi < 0.1) curPhi = 0.1;
      if (curPhi > Math.PI - 0.1) curPhi = Math.PI - 0.1;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geo;
})();

// Small "knotty" bump geometry for organic relief detail. Tiny
// flattened sphere — sits proud of the egg surface like a thorn.
const _knotGeo = new THREE.SphereGeometry(EGG_RADIUS * 0.13, 8, 6);

function _getVeinMat(tint) {
  // Veins glow in chapter tint with high emissive — they pulse
  // brighter as hp drops (driven by updateBlocks tick).
  return new THREE.LineBasicMaterial({
    color: tint || 0x88ffaa,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
  });
}

function _getKnotMat() {
  return new THREE.MeshStandardMaterial({
    color: 0x1a4020,                       // dark moldy green
    emissive: 0x224a28,
    emissiveIntensity: 0.4,
    roughness: 0.9,
    metalness: 0.0,
  });
}

/** Build a single egg group: ovoid green body + bioluminescent vein
 *  network + a few knotty bumps for organic relief. */
function _buildEgg(chapterTint) {
  const group = new THREE.Group();

  // Body — sphere stretched along Y for ovoid shape
  const bodyMat = _getEggBodyMat().clone();    // clone for per-egg flash anim
  const body = new THREE.Mesh(_eggBodyGeo, bodyMat);
  body.scale.y = EGG_HEIGHT_SCALE;
  body.castShadow = true;
  group.add(body);
  group.userData.body = body;
  group.userData.bodyMat = bodyMat;

  // Vein network — LineSegments wrapping the body. The veins use a
  // shared geometry but a CLONED material so we can pulse brightness
  // per-egg based on hp.
  const veinMat = _getVeinMat(chapterTint || 0x88ffaa);
  const veins = new THREE.LineSegments(_veinGeoCache, veinMat);
  // Slightly larger than the body so the veins sit proud of the
  // surface (otherwise z-fighting). Match Y stretch so they hug the
  // ovoid shape.
  veins.scale.set(EGG_RADIUS * 1.005, EGG_RADIUS * EGG_HEIGHT_SCALE * 1.005, EGG_RADIUS * 1.005);
  group.add(veins);
  group.userData.veins = veins;
  group.userData.veinMat = veinMat;

  // Knotty bumps — 4 small dark relief nubs at random surface points.
  // Pure decoration; not animated. Shared dark material.
  const knotMat = _getKnotMat();
  for (let k = 0; k < 4; k++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = (Math.random() * 0.7 + 0.15) * Math.PI;     // avoid poles
    const sinPhi = Math.sin(phi);
    const knot = new THREE.Mesh(_knotGeo, knotMat);
    knot.position.set(
      EGG_RADIUS * sinPhi * Math.cos(theta) * 0.96,
      EGG_RADIUS * Math.cos(phi) * EGG_HEIGHT_SCALE * 0.96,
      EGG_RADIUS * sinPhi * Math.sin(theta) * 0.96,
    );
    group.add(knot);
  }

  // Random rotation per egg so the vein network looks unique on each.
  group.rotation.y = Math.random() * Math.PI * 2;

  return group;
}

/** Pick 4 positions clustered in the depot wedge, spaced apart. The
 *  depot wedge is the triangle sector containing the depot beacon.
 *  We cluster the eggs in the OUTER half of that wedge (away from the
 *  depot itself) so the player can mine them and then walk inward to
 *  the beacon to deliver. */
function _pickEggPositions(count) {
  const t = getTriangleFor('mining');     // depot is in the mining wedge
  const halfWidth = (t.maxAngle - t.minAngle) / 2;
  const positions = [];
  const MIN_SEPARATION = 4.0;
  const MIN_SEPARATION_SQ = MIN_SEPARATION * MIN_SEPARATION;

  for (let i = 0; i < count; i++) {
    let x = 0, z = 0;
    let placed = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      // Sample within the wedge, biased toward the OUTER half
      // (radius 14-26) so eggs aren't on top of the depot beacon.
      const angle = t.centerAngle + (Math.random() - 0.5) * 1.8 * halfWidth;
      const radius = 14 + Math.random() * 12;
      x = Math.cos(angle) * radius;
      z = Math.sin(angle) * radius;
      // Keep eggs at least MIN_SEPARATION apart from each other
      let tooClose = false;
      for (const p of positions) {
        const ddx = x - p.x, ddz = z - p.z;
        if (ddx * ddx + ddz * ddz < MIN_SEPARATION_SQ) { tooClose = true; break; }
      }
      if (tooClose) continue;
      // Keep eggs at least 3.5u from the depot itself
      if (depot && depot.pos) {
        const ddx = x - depot.pos.x, ddz = z - depot.pos.z;
        if (ddx * ddx + ddz * ddz < 3.5 * 3.5) continue;
      }
      placed = true;
      break;
    }
    positions.push({ x, z, placed });
  }
  return positions;
}

/** Spawn `count` eggs in the depot wedge. Each egg is added to the
 *  shared `blocks` array with kind:'egg' so the existing bullet hit
 *  detection treats them as targetable objects. Returns the spawned
 *  egg objects. */
export function spawnEggsInDepotWedge(chapterIdx, count = 4) {
  const positions = _pickEggPositions(count);
  const tint = (CHAPTERS[chapterIdx % CHAPTERS.length].full.grid1) || 0x88ffaa;
  const spawned = [];
  for (const p of positions) {
    const group = _buildEgg(tint);
    const restY = EGG_RADIUS * EGG_HEIGHT_SCALE;
    group.position.set(p.x, restY, p.z);
    scene.add(group);

    // Push onto the shared blocks array so all bullet code finds it.
    // Mark with kind:'egg' so blocks.js / main.js code can branch on
    // egg-specific behavior (no AoE on death, drop charge ore, etc).
    const egg = {
      mesh: group,
      shadow: null,           // eggs don't have a falling shadow
      pos: group.position,
      targetY: restY,
      hp: EGG_HP,
      hpMax: EGG_HP,
      falling: false,         // eggs are placed, not falling
      hitFlash: 0,
      chapterIdx,
      color: EGG_GREEN,
      kind: 'egg',
      targetScale: 1.0,
      currentScale: 1.0,
    };
    blocks.push(egg);
    spawned.push(egg);
  }
  return spawned;
}

/** True if a block-array entry is an egg (kind:'egg'). */
export function isEgg(block) {
  return block && block.kind === 'egg';
}

/** Called from blocks.js damageBlock when an egg's hp hits 0. Spawns
 *  a charge ore at the egg's position, plays the shatter VFX, and
 *  removes the egg mesh from the scene. Returns true so blocks.js
 *  knows to skip its normal block-explosion + ore-spawn path. */
export function destroyEgg(egg) {
  // Shatter VFX — green burst + gold sparkle + small shake
  const burstPos = new THREE.Vector3(egg.pos.x, egg.pos.y + 0.3, egg.pos.z);
  hitBurst(burstPos, EGG_GREEN, 28);
  hitBurst(burstPos, EGG_BAND_GOLD, 10);
  shake(0.30, 0.18);

  // Drop a charge ore at the egg position. spawnOre uses rainbow
  // visual regardless of tint, so the player sees a familiar
  // collectable. The tint argument is kept for API compat.
  spawnOre(egg.pos.x, egg.pos.z, EGG_GREEN, egg.chapterIdx || 0);

  // Remove the mesh from scene
  if (egg.mesh && egg.mesh.parent) scene.remove(egg.mesh);

  return true;
}

/** Clear all live eggs (e.g. on game reset). The shared blocks array
 *  is cleaned by blocks.js's clearAllBlocks(); here we just have to
 *  remove egg meshes from the scene if any survived. */
export function clearAllEggs() {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (b.kind === 'egg') {
      if (b.mesh && b.mesh.parent) scene.remove(b.mesh);
      blocks.splice(i, 1);
    }
  }
}
