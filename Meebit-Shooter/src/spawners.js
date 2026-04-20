import * as THREE from 'three';
import { scene } from './scene.js';
import { SPAWNER_CONFIG, CHAPTERS } from './config.js';
import { hitBurst } from './effects.js';

export const spawners = [];

// Create a portal at (x, z) tinted to the current chapter color.
export function spawnPortal(x, z, chapterIdx) {
  const tint = CHAPTERS[chapterIdx % CHAPTERS.length].full.lamp;
  const group = new THREE.Group();
  group.position.set(x, 0, z);

  // Base platform
  const baseGeo = new THREE.CylinderGeometry(2.0, 2.2, 0.3, 12);
  const baseMat = new THREE.MeshStandardMaterial({
    color: 0x1a1a2a, emissive: tint, emissiveIntensity: 0.25, roughness: 0.6,
  });
  const base = new THREE.Mesh(baseGeo, baseMat);
  base.position.y = 0.15;
  base.castShadow = true;
  group.add(base);

  // Vertical ring (the portal "frame")
  const ringGeo = new THREE.TorusGeometry(1.6, 0.15, 8, 24);
  const ringMat = new THREE.MeshStandardMaterial({
    color: tint, emissive: tint, emissiveIntensity: 2.2, metalness: 0.7, roughness: 0.3,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.position.y = 2.0;
  ring.rotation.x = Math.PI / 2;
  group.add(ring);

  // Inner portal (swirling core)
  const coreMat = new THREE.MeshBasicMaterial({
    color: tint, transparent: true, opacity: 0.55, side: THREE.DoubleSide,
  });
  const core = new THREE.Mesh(new THREE.CircleGeometry(1.5, 24), coreMat);
  core.position.y = 2.0;
  core.rotation.x = Math.PI / 2;
  group.add(core);

  // Center orb
  const orb = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 12, 8),
    new THREE.MeshStandardMaterial({
      color: tint, emissive: tint, emissiveIntensity: 3.5,
    })
  );
  orb.position.y = 2.0;
  group.add(orb);

  // Point light
  const light = new THREE.PointLight(tint, 3.5, 18, 1.3);
  light.position.y = 2.0;
  group.add(light);

  // Beam going straight up
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.4, 0.6, 20, 12, 1, true),
    new THREE.MeshBasicMaterial({
      color: tint, transparent: true, opacity: 0.35,
      side: THREE.DoubleSide, depthWrite: false,
    })
  );
  beam.position.y = 12;
  group.add(beam);

  scene.add(group);

  return {
    obj: group,
    pos: group.position,
    ring, core, orb, base, beam, light, coreMat, ringMat, baseMat,
    hp: SPAWNER_CONFIG.spawnerHp || 180,
    hpMax: SPAWNER_CONFIG.spawnerHp || 180,
    hitFlash: 0,
    spawnCooldown: 1 + Math.random() * SPAWNER_CONFIG.spawnIntervalSec,
    enemiesAlive: 0,
    destroyed: false,
    tint,
  };
}

export function spawnAllPortals(chapterIdx) {
  clearAllPortals();
  for (const c of SPAWNER_CONFIG.corners) {
    spawners.push(spawnPortal(c.x, c.z, chapterIdx));
  }
}

export function damageSpawner(spawner, dmg) {
  if (spawner.destroyed) return false;
  spawner.hp -= dmg;
  spawner.hitFlash = 0.15;
  hitBurst(
    new THREE.Vector3(spawner.pos.x, 2, spawner.pos.z),
    spawner.tint, 6
  );
  if (spawner.hp <= 0) {
    destroySpawner(spawner);
    return true;
  }
  return false;
}

function destroySpawner(spawner) {
  spawner.destroyed = true;
  spawner.hp = 0;
  // Big explosion
  const pos = new THREE.Vector3(spawner.pos.x, 2, spawner.pos.z);
  hitBurst(pos, 0xffffff, 30);
  hitBurst(pos, spawner.tint, 25);
  setTimeout(() => hitBurst(pos, 0xff3cac, 20), 80);

  // Collapse animation: shrink the whole group
  spawner.obj.userData._collapsing = true;
  spawner.obj.userData._collapseT = 0;
}

export function updateSpawners(dt) {
  for (const s of spawners) {
    if (s.destroyed) {
      // Collapse animation
      if (s.obj.userData._collapsing) {
        s.obj.userData._collapseT += dt;
        const t = s.obj.userData._collapseT;
        const scale = Math.max(0, 1 - t * 2);
        s.obj.scale.setScalar(scale);
        s.obj.rotation.y += dt * 8;
        if (scale <= 0) {
          scene.remove(s.obj);
          s.obj.userData._collapsing = false;
        }
      }
      continue;
    }
    // Rotate the core + orb
    s.core.rotation.z += dt * 1.5;
    s.orb.position.y = 2.0 + Math.sin(performance.now() * 0.003) * 0.2;
    s.orb.rotation.y += dt * 2;
    // Beam pulse
    s.beam.material.opacity = 0.25 + Math.sin(performance.now() * 0.004) * 0.15;
    // Hit flash
    if (s.hitFlash > 0) {
      s.hitFlash -= dt;
      s.ringMat.emissiveIntensity = 2.2 + s.hitFlash * 8;
    } else {
      s.ringMat.emissiveIntensity = 2.2;
    }
  }
}

// Returns count of still-alive portals
export function livePortalCount() {
  let n = 0;
  for (const s of spawners) if (!s.destroyed) n++;
  return n;
}

export function clearAllPortals() {
  for (const s of spawners) {
    if (s.obj.parent) scene.remove(s.obj);
  }
  spawners.length = 0;
}

// Pick a random NON-destroyed portal to spawn an enemy from.
// Returns null if all are destroyed.
export function pickActivePortal() {
  const live = spawners.filter(s => !s.destroyed);
  if (live.length === 0) return null;
  return live[Math.floor(Math.random() * live.length)];
}
