// Audience crowd — a ring of boxy spectator figures standing OUTSIDE the
// arena walls, watching the fight. Implemented as THREE.InstancedMesh so
// rendering 400+ figures costs one draw call. Each figure bobs on a per-
// instance seeded sine wave so the crowd feels alive.
//
// The crowd re-tints to match the current chapter via per-instance color.
// No teardown is ever needed — the mesh persists for the whole session.

import * as THREE from 'three';
import { scene } from './scene.js';
import { ARENA, CHAPTERS } from './config.js';

const CROWD_COUNT = 420;

// Ring distances — the crowd occupies a band around the arena walls.
const RING_INNER = ARENA + 6;
const RING_OUTER = ARENA + 22;

// Shared geometry — a simple two-box "figure" (head + body). Rendering
// 420 of these as an InstancedMesh is cheaper than 420 separate meshes
// by a huge margin.
const BODY_GEO = new THREE.BoxGeometry(0.9, 1.8, 0.7);
// Offset the origin so y=0 sits the figure on the ground
BODY_GEO.translate(0, 0.9, 0);
const HEAD_GEO = new THREE.BoxGeometry(0.7, 0.6, 0.6);
HEAD_GEO.translate(0, 2.1, 0);

// Merge body + head into a single geometry per instance (both will render
// in one draw call). Three.js BufferGeometryUtils would be cleaner but
// we can fake it by using two InstancedMeshes sharing the same matrix
// buffer. Simpler: keep them as two InstancedMeshes. That's still 2 draw
// calls total for the whole crowd.
let bodyMesh = null;
let headMesh = null;

// Per-instance bob seeds — captured once at build time so they don't
// re-randomize per frame.
const bobSeeds = new Float32Array(CROWD_COUNT);
const basePositions = new Float32Array(CROWD_COUNT * 3);

const _tmpMatrix = new THREE.Matrix4();
const _tmpPos = new THREE.Vector3();
const _tmpQuat = new THREE.Quaternion();
const _tmpScale = new THREE.Vector3(1, 1, 1);
const _tmpColor = new THREE.Color();

/**
 * Build the crowd once. Call from scene setup.
 * Positions are randomized in a ring around the arena. Colors start at
 * chapter 0's tint and can be recolored via recolorCrowd().
 */
export function buildCrowd() {
  if (bodyMesh) return; // already built

  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x888899, roughness: 0.9, metalness: 0.0,
  });
  const headMat = new THREE.MeshStandardMaterial({
    color: 0xbbbbcc, roughness: 0.85, metalness: 0.0,
  });
  bodyMesh = new THREE.InstancedMesh(BODY_GEO, bodyMat, CROWD_COUNT);
  headMesh = new THREE.InstancedMesh(HEAD_GEO, headMat, CROWD_COUNT);
  bodyMesh.instanceColor = new THREE.InstancedBufferAttribute(
    new Float32Array(CROWD_COUNT * 3), 3
  );
  headMesh.instanceColor = new THREE.InstancedBufferAttribute(
    new Float32Array(CROWD_COUNT * 3), 3
  );

  // Place each instance at a random point in the ring around the arena.
  for (let i = 0; i < CROWD_COUNT; i++) {
    // Uniform distribution in an annulus: sqrt on the ring distance.
    const u = Math.random();
    const r = Math.sqrt(RING_INNER * RING_INNER +
      u * (RING_OUTER * RING_OUTER - RING_INNER * RING_INNER));
    const theta = Math.random() * Math.PI * 2;
    const x = Math.cos(theta) * r;
    const z = Math.sin(theta) * r;

    basePositions[i * 3]     = x;
    basePositions[i * 3 + 1] = 0;
    basePositions[i * 3 + 2] = z;
    bobSeeds[i] = Math.random() * Math.PI * 2;

    // Face toward the arena center
    const faceAngle = Math.atan2(-x, -z);
    _tmpPos.set(x, 0, z);
    _tmpQuat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), faceAngle);
    _tmpMatrix.compose(_tmpPos, _tmpQuat, _tmpScale);
    bodyMesh.setMatrixAt(i, _tmpMatrix);
    headMesh.setMatrixAt(i, _tmpMatrix);
  }

  bodyMesh.instanceMatrix.needsUpdate = true;
  headMesh.instanceMatrix.needsUpdate = true;

  // Start with a neutral tint. recolorCrowd() changes it per chapter.
  recolorCrowd(0x888899);

  scene.add(bodyMesh);
  scene.add(headMesh);
}

/**
 * Recolor every crowd instance to the given chapter tint, with a little
 * per-instance variation so the crowd doesn't look like a solid block.
 */
export function recolorCrowd(tintHex) {
  if (!bodyMesh) return;
  const tint = new THREE.Color(tintHex);
  const dim = tint.clone().multiplyScalar(0.45);     // body shade
  const bright = tint.clone().multiplyScalar(0.85);  // head shade

  for (let i = 0; i < CROWD_COUNT; i++) {
    // Per-instance jitter so the crowd has some variety without looking
    // noisy. Reuse the bob seed as a cheap deterministic random.
    const jitter = (bobSeeds[i] % 1) * 0.25;
    _tmpColor.copy(dim).multiplyScalar(1 - jitter * 0.3);
    bodyMesh.setColorAt(i, _tmpColor);
    _tmpColor.copy(bright).multiplyScalar(1 - jitter * 0.15);
    headMesh.setColorAt(i, _tmpColor);
  }
  if (bodyMesh.instanceColor) bodyMesh.instanceColor.needsUpdate = true;
  if (headMesh.instanceColor) headMesh.instanceColor.needsUpdate = true;
}

/**
 * Per-frame bob animation. Cheap: one matrix update per instance, all
 * in one scene graph traversal via InstancedMesh.
 * Call this every frame from the main animate loop.
 */
export function updateCrowd(timeElapsed) {
  if (!bodyMesh) return;

  for (let i = 0; i < CROWD_COUNT; i++) {
    const x = basePositions[i * 3];
    const z = basePositions[i * 3 + 2];
    const seed = bobSeeds[i];

    // Bob up and down on a seeded sine. Slight horizontal sway for life.
    const bob = Math.sin(timeElapsed * 2.5 + seed) * 0.12;
    const sway = Math.sin(timeElapsed * 1.3 + seed * 1.7) * 0.08;

    const faceAngle = Math.atan2(-x, -z) + sway * 0.15;
    _tmpPos.set(x, bob, z);
    _tmpQuat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), faceAngle);
    _tmpMatrix.compose(_tmpPos, _tmpQuat, _tmpScale);
    bodyMesh.setMatrixAt(i, _tmpMatrix);
    headMesh.setMatrixAt(i, _tmpMatrix);
  }
  bodyMesh.instanceMatrix.needsUpdate = true;
  headMesh.instanceMatrix.needsUpdate = true;
}
