import * as THREE from 'three';
import { scene } from './scene.js';

// ---- POOLED PARTICLES ----
const PARTICLE_POOL_SIZE = 120;
const particlePool = [];
const activeParticles = [];

{
  const geo = new THREE.BoxGeometry(0.14, 0.14, 0.14);
  for (let i = 0; i < PARTICLE_POOL_SIZE; i++) {
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 2
    });
    const m = new THREE.Mesh(geo, mat);
    m.visible = false;
    m.userData = { vel: new THREE.Vector3(), life: 0, maxLife: 0 };
    scene.add(m);
    particlePool.push(m);
  }
}

export function spawnParticle(pos, vel, color, life = 0.5) {
  const m = particlePool.pop();
  if (!m) return;
  m.visible = true;
  m.position.copy(pos);
  m.scale.setScalar(1);
  m.userData.vel.copy(vel);
  m.userData.life = life;
  m.userData.maxLife = life;
  m.material.color.set(color);
  m.material.emissive.set(color);
  activeParticles.push(m);
}

export function hitBurst(pos, color, count = 6) {
  for (let i = 0; i < count; i++) {
    spawnParticle(
      pos,
      new THREE.Vector3(
        (Math.random() - 0.5) * 5,
        Math.random() * 3 + 1,
        (Math.random() - 0.5) * 5
      ),
      color,
      0.5
    );
  }
}

export function updateParticles(dt) {
  for (let i = activeParticles.length - 1; i >= 0; i--) {
    const m = activeParticles[i];
    m.position.addScaledVector(m.userData.vel, dt);
    m.userData.vel.y -= 9 * dt;
    m.userData.life -= dt;
    const f = Math.max(0, m.userData.life / m.userData.maxLife);
    m.scale.setScalar(Math.max(0.01, f));
    if (m.userData.life <= 0) {
      m.visible = false;
      activeParticles.splice(i, 1);
      particlePool.push(m);
    }
  }
}

export function clearParticles() {
  for (const p of activeParticles) {
    p.visible = false;
    particlePool.push(p);
  }
  activeParticles.length = 0;
}

// ---- BULLETS ----
export const bullets = [];
const BULLET_GEO = new THREE.BoxGeometry(0.14, 0.14, 0.55);

export function spawnBullet(origin, facing, weapon) {
  for (let i = 0; i < weapon.bullets; i++) {
    const mat = new THREE.MeshStandardMaterial({
      color: 0xfff9b2, emissive: weapon.color, emissiveIntensity: 3
    });
    const b = new THREE.Mesh(BULLET_GEO, mat);
    b.position.copy(origin);
    const spread = (i - (weapon.bullets - 1) / 2) * weapon.spread * 0.6
                 + (Math.random() - 0.5) * weapon.spread;
    const dir = new THREE.Vector3(Math.sin(facing + spread), 0, Math.cos(facing + spread));
    b.userData = {
      vel: dir.clone().multiplyScalar(weapon.speed),
      life: 1.4,
      damage: weapon.damage,
    };
    scene.add(b);
    bullets.push(b);
  }
}

export function clearBullets() {
  for (const b of bullets) scene.remove(b);
  bullets.length = 0;
}

// ---- PICKUPS ----
export const pickups = [];

export function makePickup(type, x, z) {
  const group = new THREE.Group();
  let color;
  switch (type) {
    case 'xp':     color = 0xffd93d; break;
    case 'health': color = 0x00ff66; break;
    case 'speed':  color = 0x4ff7ff; break;
    case 'shield': color = 0xe63aff; break;
    case 'shotgun': color = 0xff8800; break;
    case 'smg': color = 0xff3cac; break;
    case 'sniper': color = 0x00ff66; break;
    default: color = 0xffffff;
  }
  const geo = type === 'xp' ? new THREE.OctahedronGeometry(0.25, 0)
    : ['shotgun','smg','sniper'].includes(type) ? new THREE.BoxGeometry(0.8, 0.5, 0.5)
    : new THREE.BoxGeometry(0.5, 0.5, 0.5);
  const mat = new THREE.MeshStandardMaterial({
    color, emissive: color, emissiveIntensity: 1.5
  });
  const m = new THREE.Mesh(geo, mat);
  m.position.y = 0.6; m.castShadow = true;
  group.add(m);
  group.position.set(x, 0, z);
  scene.add(group);
  const p = { obj: group, mesh: m, type, value: type === 'xp' ? 1 : 1, life: 18, color };
  pickups.push(p);
  return p;
}

export function clearPickups() {
  for (const p of pickups) scene.remove(p.obj);
  pickups.length = 0;
}

// ---- CAPTURE ZONE — BIG AND IMPOSSIBLE TO MISS ----
export function makeCaptureZone(x, z) {
  const group = new THREE.Group();

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(3.0, 3.6, 48),
    new THREE.MeshBasicMaterial({ color: 0xffd93d, side: THREE.DoubleSide, transparent: true, opacity: 1.0 })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.04;
  group.add(ring);

  const inner = new THREE.Mesh(
    new THREE.CircleGeometry(3.4, 48),
    new THREE.MeshBasicMaterial({ color: 0xffd93d, transparent: true, opacity: 0.2 })
  );
  inner.rotation.x = -Math.PI / 2;
  inner.position.y = 0.03;
  group.add(inner);

  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(1.2, 1.8, 30, 12, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xffd93d,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  beam.position.y = 15;
  group.add(beam);

  const beamCore = new THREE.Mesh(
    new THREE.CylinderGeometry(0.4, 0.8, 30, 8, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    })
  );
  beamCore.position.y = 15;
  group.add(beamCore);

  const light = new THREE.PointLight(0xffd93d, 4.0, 18, 1.2);
  light.position.y = 2;
  group.add(light);

  const arrowGeo = new THREE.ConeGeometry(0.8, 2.0, 4);
  const arrowMat = new THREE.MeshStandardMaterial({
    color: 0xffd93d, emissive: 0xffd93d, emissiveIntensity: 2
  });
  const arrow = new THREE.Mesh(arrowGeo, arrowMat);
  arrow.rotation.x = Math.PI;
  arrow.position.y = 6;
  group.add(arrow);

  group.position.set(x, 0, z);
  scene.add(group);
  return { obj: group, ring, inner, beam, beamCore, arrow, light, pos: group.position };
}

export function removeCaptureZone(zone) {
  if (zone && zone.obj) scene.remove(zone.obj);
}
