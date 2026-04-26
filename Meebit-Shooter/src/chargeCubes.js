// chargeCubes.js — Chapter-1 wave-1 finisher items. After the crusher
// finisher animation, 4 chapter-tinted glowing cubes appear on the
// crusher pad. Player walks over each to pick it up. Wave 1 ends only
// when all 4 are collected. Each cube grants +1 to S.chargesCarried so
// wave 2 inherits the loaded state — no second trip to the depot.
//
// Visual:
//   - Solid cube ~0.55u edge length
//   - Chapter-tinted emissive material (pulses subtly)
//   - Slow yaw rotation + small vertical bob so they read as "alive"
//   - Glowing halo ring on the floor below each cube for visibility
//
// Pickup:
//   - Radius ~1.4u (generous so the player doesn't have to thread)
//   - Magnetize: when player is within ~3u, cube drifts toward them
//   - On pickup: cube vanishes with a chapter-tinted burst + brief
//     SFX (eggHit-style chime). S.chargesCarried bumps. Pickup count
//     tracked locally so chargeCubesRemaining() returns the live count.

import * as THREE from 'three';
import { scene } from './scene.js';
import { CHAPTERS } from './config.js';
import { hitBurst } from './effects.js';
import { S } from './state.js';
import { Audio } from './audio.js';

// ---- Geometry singletons ----
const CUBE_GEO  = new THREE.BoxGeometry(0.55, 0.55, 0.55);
const HALO_GEO  = new THREE.RingGeometry(0.4, 0.7, 16);

// ---- Tunables ----
const CUBE_HEIGHT = 1.6;            // hover Y above floor
const PICKUP_RADIUS = 1.4;
const MAGNET_RADIUS = 3.5;
const MAGNET_SPEED = 7.0;           // u/s when fully magnetized

// ---- Module state ----
let _cubes = [];

function _cubeMat(tint) {
  return new THREE.MeshStandardMaterial({
    color: tint, roughness: 0.3, metalness: 0.6,
    emissive: tint, emissiveIntensity: 1.4,
  });
}
function _haloMat(tint) {
  return new THREE.MeshBasicMaterial({
    color: tint, transparent: true, opacity: 0.55,
    side: THREE.DoubleSide, depthWrite: false,
  });
}

/** Spawn 4 chapter-tinted cubes in a tight ring at (basePosX, basePosZ).
 *  Cubes are arranged in a 2x2 grid centered on the crusher anvil. */
export function spawnChargeCubes(chapterIdx, basePosX, basePosZ) {
  clearChargeCubes();
  const tint = CHAPTERS[chapterIdx % CHAPTERS.length].full.grid1;
  // 2x2 grid centered on the anvil — small offsets so cubes don't overlap
  const offsets = [
    { x: -0.55, z: -0.55 },
    { x:  0.55, z: -0.55 },
    { x: -0.55, z:  0.55 },
    { x:  0.55, z:  0.55 },
  ];
  for (let i = 0; i < offsets.length; i++) {
    const off = offsets[i];
    const cubeMat = _cubeMat(tint);
    const cube = new THREE.Mesh(CUBE_GEO, cubeMat);
    cube.position.set(basePosX + off.x, CUBE_HEIGHT, basePosZ + off.z);
    cube.castShadow = true;
    scene.add(cube);

    // Floor halo
    const haloMat = _haloMat(tint);
    const halo = new THREE.Mesh(HALO_GEO, haloMat);
    halo.rotation.x = -Math.PI / 2;
    halo.position.set(basePosX + off.x, 0.05, basePosZ + off.z);
    scene.add(halo);

    _cubes.push({
      mesh: cube,
      mat: cubeMat,
      halo, haloMat,
      restPos: new THREE.Vector3(basePosX + off.x, CUBE_HEIGHT, basePosZ + off.z),
      bobSeed: i * 0.7,
      yaw: i * 0.5,
      collected: false,
      magnetActive: false,
    });
  }
}

/** Per-frame update — animate bob/rotation/pulse, magnetize toward
 *  player, collection check. Returns number of cubes still uncollected. */
export function updateChargeCubes(dt, playerPos) {
  if (!_cubes.length) return 0;
  let remaining = 0;
  for (let i = _cubes.length - 1; i >= 0; i--) {
    const c = _cubes[i];
    if (c.collected) continue;
    remaining++;

    // Idle animation — yaw + small bob + emissive pulse
    c.bobSeed += dt;
    c.yaw += dt * 1.6;
    c.mesh.rotation.y = c.yaw;
    c.mesh.rotation.x = Math.sin(c.bobSeed * 0.8) * 0.18;
    const pulse = 1.2 + Math.sin(c.bobSeed * 3.0) * 0.4;
    c.mat.emissiveIntensity = pulse;
    if (c.haloMat) c.haloMat.opacity = 0.45 + Math.sin(c.bobSeed * 2.2) * 0.20;

    // Pickup / magnet logic
    if (playerPos) {
      const dx = playerPos.x - c.mesh.position.x;
      const dz = playerPos.z - c.mesh.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      // Pickup
      if (dist < PICKUP_RADIUS) {
        // Collected!
        c.collected = true;
        S.chargesCarried = (S.chargesCarried || 0) + 1;
        // Pickup VFX
        const tint = c.mat.color.getHex();
        const p = c.mesh.position.clone();
        hitBurst(p, 0xffffff, 12);
        hitBurst(p, tint, 24);
        try { Audio.eggHit && Audio.eggHit(); } catch (e) {}
        // Remove meshes
        if (c.mesh && c.mesh.parent) scene.remove(c.mesh);
        if (c.mat && c.mat.dispose) c.mat.dispose();
        if (c.halo && c.halo.parent) scene.remove(c.halo);
        if (c.haloMat && c.haloMat.dispose) c.haloMat.dispose();
        _cubes.splice(i, 1);
        remaining--;
        continue;
      }

      // Magnet — drift toward player when within range
      if (dist < MAGNET_RADIUS && dist > 0.001) {
        const t = 1 - (dist / MAGNET_RADIUS);   // 0..1
        const speed = MAGNET_SPEED * t * dt;
        const inv = 1 / dist;
        c.mesh.position.x += dx * inv * speed;
        c.mesh.position.z += dz * inv * speed;
        // Halo follows
        c.halo.position.x = c.mesh.position.x;
        c.halo.position.z = c.mesh.position.z;
      } else {
        // Drift back toward rest if no longer in magnet range
        const rdx = c.restPos.x - c.mesh.position.x;
        const rdz = c.restPos.z - c.mesh.position.z;
        c.mesh.position.x += rdx * Math.min(1, dt * 2);
        c.mesh.position.z += rdz * Math.min(1, dt * 2);
        c.halo.position.x = c.mesh.position.x;
        c.halo.position.z = c.mesh.position.z;
      }
    }

    // Bob
    c.mesh.position.y = CUBE_HEIGHT + Math.sin(c.bobSeed * 1.4) * 0.18;
  }
  return remaining;
}

export function chargeCubesRemaining() {
  let n = 0;
  for (const c of _cubes) if (!c.collected) n++;
  return n;
}

export function hasChargeCubes() {
  return chargeCubesRemaining() > 0;
}

export function clearChargeCubes() {
  for (const c of _cubes) {
    if (c.mesh && c.mesh.parent) scene.remove(c.mesh);
    if (c.mat && c.mat.dispose) c.mat.dispose();
    if (c.halo && c.halo.parent) scene.remove(c.halo);
    if (c.haloMat && c.haloMat.dispose) c.haloMat.dispose();
  }
  _cubes = [];
}
