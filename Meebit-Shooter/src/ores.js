// ============================================================================
// src/ores.js — NEW FILE
// ============================================================================
// Mining wave overhaul:
//   - Blocks take 100 hits to crack (every bullet = 1 damage, or pickaxe
//     for faster ~5 swings). See blocks.js for damage flow.
//   - When a block breaks it drops an ORE (icosahedron, chapter-tinted).
//   - Player walks over the ore → auto-magnetized pickup.
//   - Player delivers by stepping onto the DEPOT platform.
//   - 5 deposits = mining wave complete.
// ============================================================================

import * as THREE from 'three';
import { scene } from './scene.js';
import { MINING_CONFIG, CHAPTERS } from './config.js';
import { hitBurst } from './effects.js';
import { S, shake } from './state.js';
import { Audio } from './audio.js';
import { UI } from './ui.js';

export const ores = [];
export let depot = null;

// --------- ORE ---------

const ORE_GEO = new THREE.IcosahedronGeometry(0.45, 0);
const ORE_MAGNET_RADIUS = 3.0;
const ORE_PICKUP_RADIUS = 1.1;

export function spawnOre(x, z, tintHex, chapterIdx) {
  const mat = new THREE.MeshStandardMaterial({
    color: tintHex,
    emissive: tintHex,
    emissiveIntensity: 2.2,
    metalness: 0.7,
    roughness: 0.2,
  });
  const mesh = new THREE.Mesh(ORE_GEO, mat);
  mesh.position.set(x, 0.9, z);
  mesh.castShadow = true;
  scene.add(mesh);

  const ore = {
    mesh,
    pos: mesh.position,
    tintHex,
    chapterIdx: chapterIdx || 0,
    life: 60,           // auto-despawn if abandoned
    picked: false,
    bobPhase: Math.random() * Math.PI * 2,
  };
  ores.push(ore);
  return ore;
}

export function updateOres(dt, player) {
  for (let i = ores.length - 1; i >= 0; i--) {
    const o = ores[i];
    if (o.picked) continue;

    // Bob + spin
    o.mesh.rotation.y += dt * 2.5;
    o.mesh.rotation.x += dt * 1.1;
    o.bobPhase += dt * 3;
    o.mesh.position.y = 0.9 + Math.sin(o.bobPhase) * 0.15;

    o.life -= dt;
    if (o.life <= 0) {
      scene.remove(o.mesh);
      ores.splice(i, 1);
      continue;
    }

    // Magnetize to player
    const dx = player.pos.x - o.pos.x;
    const dz = player.pos.z - o.pos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < ORE_MAGNET_RADIUS * ORE_MAGNET_RADIUS) {
      const d = Math.sqrt(d2) || 1;
      const pull = Math.max(0, (ORE_MAGNET_RADIUS - d) / ORE_MAGNET_RADIUS) * 10 * dt;
      o.pos.x += (dx / d) * pull;
      o.pos.z += (dz / d) * pull;
    }
    if (d2 < ORE_PICKUP_RADIUS * ORE_PICKUP_RADIUS) {
      pickupOre(o, i);
    }
  }
}

function pickupOre(ore, idx) {
  ore.picked = true;
  scene.remove(ore.mesh);
  ores.splice(idx, 1);
  S.oresCarried = (S.oresCarried || 0) + 1;
  hitBurst(new THREE.Vector3(ore.pos.x, 1.2, ore.pos.z), ore.tintHex, 8);
  Audio.pickup && Audio.pickup();
  if (UI && UI.toast) UI.toast('+1 ORE', '#ffd93d', 900);
}

export function clearAllOres() {
  for (const o of ores) {
    if (o.mesh && o.mesh.parent) scene.remove(o.mesh);
  }
  ores.length = 0;
}

// --------- DEPOT ---------

/**
 * Build the depot for this mining wave. Placed at a random angle, at a
 * fixed distance from center so it's always reachable but varies run-to-run.
 */
export function spawnDepot(chapterIdx) {
  clearDepot();
  const tint = CHAPTERS[chapterIdx % CHAPTERS.length].full.lamp;
  const angle = Math.random() * Math.PI * 2;
  const dist = MINING_CONFIG.depotOffsetFromCenter;
  const x = Math.cos(angle) * dist;
  const z = Math.sin(angle) * dist;

  const group = new THREE.Group();
  group.position.set(x, 0, z);

  // Hex plate (deposit surface)
  const plateGeo = new THREE.CylinderGeometry(2.4, 2.6, 0.35, 6);
  const plateMat = new THREE.MeshStandardMaterial({
    color: 0x1a1a2e,
    emissive: tint,
    emissiveIntensity: 0.6,
    metalness: 0.8,
    roughness: 0.35,
  });
  const plate = new THREE.Mesh(plateGeo, plateMat);
  plate.position.y = 0.18;
  plate.castShadow = true;
  plate.receiveShadow = true;
  group.add(plate);

  // Glowing inner disk
  const diskMat = new THREE.MeshBasicMaterial({
    color: tint,
    transparent: true,
    opacity: 0.7,
    side: THREE.DoubleSide,
  });
  const disk = new THREE.Mesh(new THREE.CircleGeometry(1.8, 24), diskMat);
  disk.rotation.x = -Math.PI / 2;
  disk.position.y = 0.36;
  group.add(disk);

  // Beacon light column — visible across the arena
  const beaconMat = new THREE.MeshBasicMaterial({
    color: tint,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
  });
  const beacon = new THREE.Mesh(
    new THREE.CylinderGeometry(0.35, 0.7, 14, 8, 1, true),
    beaconMat
  );
  beacon.position.y = 7;
  group.add(beacon);

  // Ambient point light
  const light = new THREE.PointLight(tint, 2.2, 16, 1.5);
  light.position.y = 1.5;
  group.add(light);

  scene.add(group);

  depot = {
    obj: group,
    pos: group.position,
    plate, disk, beacon, diskMat, beaconMat, light,
    tint,
    deposited: 0,
    required: MINING_CONFIG.oresRequired,
    pulsePhase: 0,
  };
  return depot;
}

export function clearDepot() {
  if (depot && depot.obj && depot.obj.parent) scene.remove(depot.obj);
  depot = null;
}

/**
 * Update the depot each frame. Returns true if the required deposit count
 * was reached on this tick (so the caller can end the wave).
 */
export function updateDepot(dt, player) {
  if (!depot) return false;
  depot.pulsePhase += dt * 3;
  depot.beaconMat.opacity = 0.3 + Math.abs(Math.sin(depot.pulsePhase)) * 0.4;
  depot.diskMat.opacity = 0.55 + Math.abs(Math.sin(depot.pulsePhase * 1.3)) * 0.25;

  const dx = player.pos.x - depot.pos.x;
  const dz = player.pos.z - depot.pos.z;
  const d2 = dx * dx + dz * dz;
  const r = MINING_CONFIG.depotDepositRadius;

  // Stand on the depot while carrying ore → dump everything at once
  if (d2 < r * r && (S.oresCarried || 0) > 0) {
    while ((S.oresCarried || 0) > 0 && depot.deposited < depot.required) {
      depot.deposited++;
      S.oresCarried--;
      hitBurst(new THREE.Vector3(depot.pos.x, 1.0, depot.pos.z), depot.tint, 10);
      if (UI && UI.toast) {
        UI.toast('ORE DEPOSITED (' + depot.deposited + '/' + depot.required + ')', '#00ff66', 800);
      }
      Audio.levelup && Audio.levelup();
      shake(0.15, 0.1);
    }
    if (depot.deposited >= depot.required) return true;
  }
  return false;
}

export function depotStatus() {
  if (!depot) return null;
  return {
    deposited: depot.deposited,
    required: depot.required,
    pos: depot.pos,
  };
}
