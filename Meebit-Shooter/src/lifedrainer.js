// lifedrainer.js — Chapter 7 signature weapon.
//
// Two-mode behavior:
//   PHASE A — DRAIN: While the player holds fire, green tendril beams
//     connect the gun to up to N enemies in a forward cone. Each beam
//     ticks damage on the enemy and charges the gun's meter (S.lifedrainCharge).
//   PHASE B — RELEASE: Once charge hits 1.0, the next fire press fires
//     a swarm of homing projectiles — one per enemy among the closest
//     in front of the player. Each projectile deals heavy damage. After
//     fire, charge resets to 0.
//
// Public API:
//   updateLifedrainBeams(dt, w, player, enemies, firing)  — per-frame visual + damage tick
//   fireLifedrainSwarm(w, player, enemies)                — release swarm (called on click when charged)
//   clearLifedrainEffects()                               — remove visuals on weapon swap / reset

import * as THREE from 'three';
import { scene } from './scene.js';
import { S } from './state.js';

// ---- BEAM POOL ----
// Up to drainMaxBeams persistent line-segments shared across frames.
// Each beam is a Line2-ish: just a thin BufferGeometry with 2 vertices
// updated each frame. We use additive blend so multiple beams crossing
// the same point bloom brighter.
const _beams = [];           // array of { line, mat }
const MAX_POOL = 8;          // safety cap — drainMaxBeams is 5 normally

function _ensureBeam(idx) {
  while (_beams.length <= idx && _beams.length < MAX_POOL) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position',
      new THREE.BufferAttribute(new Float32Array(6), 3));
    const mat = new THREE.LineBasicMaterial({
      color: 0x00ff66,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const line = new THREE.Line(geo, mat);
    line.frustumCulled = false;
    line.visible = false;
    scene.add(line);
    _beams.push({ line, mat });
  }
  return _beams[idx];
}

function _hideUnusedBeams(usedCount) {
  for (let i = usedCount; i < _beams.length; i++) {
    _beams[i].line.visible = false;
  }
}

// ---- ENEMY HEALTH ORB (visual that tracks at the enemy end of the beam) ----
// Subtle: every drained enemy gets a small green pulse where the beam
// touches them. We don't need persistent orbs — just particles. So this
// is just a per-frame alpha-pulse on the line endpoint, no extra meshes.

// ---- SCANNING: find enemies in the forward cone ----
function _findDrainTargets(w, player, enemies) {
  const cone = w.drainConeAngle;
  const range = w.drainRange;
  const maxBeams = w.drainMaxBeams;
  const dirX = Math.sin(player.facing);
  const dirZ = Math.cos(player.facing);
  const cosCone = Math.cos(cone);
  // Score = closeness within cone — we want the closest enemies first.
  // Build a small list with distances and pick the lowest N.
  const scored = [];
  for (const e of enemies) {
    if (!e || !e.pos) continue;
    if (e.flingLock) continue;     // mid-flinger flight — skip to avoid weird beam targeting
    const dx = e.pos.x - player.pos.x;
    const dz = e.pos.z - player.pos.z;
    const dist2 = dx * dx + dz * dz;
    if (dist2 > range * range) continue;
    const dist = Math.sqrt(dist2);
    if (dist < 0.001) continue;
    // Direction projection — must be inside the cone.
    const dot = (dx * dirX + dz * dirZ) / dist;
    if (dot < cosCone) continue;
    scored.push({ e, dist });
  }
  scored.sort((a, b) => a.dist - b.dist);
  return scored.slice(0, maxBeams).map(s => s.e);
}

// ---- DRAIN TICK + BEAM RENDER ----
// Called every frame while the player holds fire AND has the
// lifedrainer equipped. dt is delta seconds. firing boolean tells us if
// we should be active at all (mouse held). w is the weapon spec.
//
// Returns the number of enemies currently being drained (used by main.js
// for charge accumulation rate).
export function updateLifedrainBeams(dt, w, player, enemies, firing) {
  if (!firing) {
    _hideUnusedBeams(0);
    return 0;
  }
  const targets = _findDrainTargets(w, player, enemies);
  // Build/update one beam per target
  const originX = player.pos.x;
  const originY = 1.3;
  const originZ = player.pos.z;
  for (let i = 0; i < targets.length; i++) {
    const beam = _ensureBeam(i);
    if (!beam) break;
    const e = targets[i];
    const positions = beam.line.geometry.attributes.position.array;
    positions[0] = originX;
    positions[1] = originY;
    positions[2] = originZ;
    positions[3] = e.pos.x;
    positions[4] = (e.bossHitRadius ? 1.5 : 1.0);
    positions[5] = e.pos.z;
    beam.line.geometry.attributes.position.needsUpdate = true;
    // Gentle opacity pulse so the beams feel "alive"
    beam.mat.opacity = 0.7 + 0.25 * Math.sin(S.timeElapsed * 18 + i);
    beam.line.visible = true;
  }
  _hideUnusedBeams(targets.length);
  return targets.length;
}

/** Apply a single drain damage tick to enemies in the cone. Called at
 * the weapon's fireRate cadence (every 50ms) by main.js fire loop. */
export function applyLifedrainTick(w, dmgBoost, player, enemies, killCallback) {
  const targets = _findDrainTargets(w, player, enemies);
  const dmg = w.damage * dmgBoost;
  for (const e of targets) {
    e.hp -= dmg;
    e.hitFlash = Math.max(e.hitFlash || 0, 0.10);
    if (e.hp <= 0 && killCallback) killCallback(e);
  }
  return targets.length;
}

// ---- SWARM RELEASE ----
// Spawn `swarmCount` homing projectiles. Each picks one of the closest
// enemies in front of the player as its homing target. If there are
// fewer enemies than swarmCount, we duplicate-target so all projectiles
// are accounted for (the extras just dogpile on the visible enemies).
//
// The projectile system here is a lightweight inline implementation —
// each projectile lives in _projectiles and is updated each frame by
// updateLifedrainProjectiles().

const _projectiles = [];     // { mesh, mat, vel, target, age, lifetime, w, dmg }

const _projGeo = new THREE.SphereGeometry(0.18, 8, 6);
const _projMat = new THREE.MeshBasicMaterial({
  color: 0x00ff66,
  transparent: true,
  opacity: 1.0,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});

/** Pick swarmCount targets from closest-N enemies in forward cone.
 * If fewer enemies than swarmCount, repeat targets. Returns array of
 * length swarmCount. */
function _pickSwarmTargets(w, player, enemies) {
  const cone = w.swarmConeAngle;
  const range = w.swarmRange;
  const dirX = Math.sin(player.facing);
  const dirZ = Math.cos(player.facing);
  const cosCone = Math.cos(cone);
  const scored = [];
  for (const e of enemies) {
    if (!e || !e.pos) continue;
    const dx = e.pos.x - player.pos.x;
    const dz = e.pos.z - player.pos.z;
    const dist2 = dx * dx + dz * dz;
    if (dist2 > range * range) continue;
    const dist = Math.sqrt(dist2);
    if (dist < 0.001) continue;
    const dot = (dx * dirX + dz * dirZ) / dist;
    if (dot < cosCone) continue;
    scored.push({ e, dist });
  }
  scored.sort((a, b) => a.dist - b.dist);
  if (scored.length === 0) return [];
  const targets = [];
  for (let i = 0; i < w.swarmCount; i++) {
    // Wrap around to repeat targets if we don't have enough enemies
    targets.push(scored[i % scored.length].e);
  }
  return targets;
}

export function fireLifedrainSwarm(w, player, enemies) {
  const targets = _pickSwarmTargets(w, player, enemies);
  if (targets.length === 0) return false;     // no targets = don't fire
  const originX = player.pos.x;
  const originY = 1.3;
  const originZ = player.pos.z;
  // Initial spread direction — fan out projectiles in a tight cluster
  // forward. Each projectile gets a slightly different starting velocity
  // so the swarm looks like a launched volley rather than a column.
  const fwdX = Math.sin(player.facing);
  const fwdZ = Math.cos(player.facing);
  for (let i = 0; i < targets.length; i++) {
    // Random spread inside ±20° of forward
    const ang = player.facing + (Math.random() - 0.5) * 0.7;
    const sx = Math.sin(ang);
    const sz = Math.cos(ang);
    const sy = 0.4 + Math.random() * 1.2;     // upward arc kick
    const speed = w.swarmSpeed * (0.85 + Math.random() * 0.3);
    const mesh = new THREE.Mesh(_projGeo, _projMat.clone());
    mesh.position.set(originX, originY, originZ);
    scene.add(mesh);
    _projectiles.push({
      mesh,
      mat: mesh.material,
      vel: new THREE.Vector3(sx * speed, sy * 4, sz * speed),
      target: targets[i],
      age: 0,
      lifetime: 4.0,
      w,
      dmg: w.swarmDamage,
    });
  }
  return true;
}

// ---- TRAIL + IMPACT PARTICLES ----
// Each in-flight projectile sheds tiny green sparks every couple frames.
// On impact (or natural despawn at lifetime), a burst of 6 brighter sparks
// pops at the impact point. Both use shared geometry + per-spark cloned
// material so opacity can fade independently.
const _sparks = [];        // { mesh, mat, vel, age, lifetime }
const _sparkGeo = new THREE.SphereGeometry(0.10, 5, 4);
function _spawnSpark(x, y, z, vx, vy, vz, lifetime, scale) {
  const mat = new THREE.MeshBasicMaterial({
    color: 0x88ff99,
    transparent: true,
    opacity: 1.0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(_sparkGeo, mat);
  mesh.position.set(x, y, z);
  mesh.scale.setScalar(scale || 1.0);
  scene.add(mesh);
  _sparks.push({ mesh, mat, vel: new THREE.Vector3(vx, vy, vz), age: 0, lifetime });
}

function _updateSparks(dt) {
  for (let i = _sparks.length - 1; i >= 0; i--) {
    const s = _sparks[i];
    s.age += dt;
    if (s.age >= s.lifetime) {
      scene.remove(s.mesh);
      s.mat.dispose();
      _sparks.splice(i, 1);
      continue;
    }
    s.mesh.position.x += s.vel.x * dt;
    s.mesh.position.y += s.vel.y * dt;
    s.mesh.position.z += s.vel.z * dt;
    s.vel.y -= 4 * dt;     // light gravity
    const t = s.age / s.lifetime;
    s.mat.opacity = 1.0 - t;
    s.mesh.scale.setScalar((1 - t * 0.4) * (s.mesh.scale.x));
  }
}

// ---- PROJECTILE PHYSICS + HOMING ----
// Called every frame from main.js. Updates positions, applies gravity-
// like settle on lost targets, kills enemies on impact.
export function updateLifedrainProjectiles(dt, killCallback) {
  // Tick existing sparks first so even after all projectiles despawn
  // their trails finish their fade.
  _updateSparks(dt);
  for (let i = _projectiles.length - 1; i >= 0; i--) {
    const p = _projectiles[i];
    p.age += dt;
    if (p.age > p.lifetime) {
      // End-of-life burst — a small fade pop where the projectile dies.
      _spawnImpactBurst(p.mesh.position.x, p.mesh.position.y, p.mesh.position.z, 4);
      scene.remove(p.mesh);
      p.mat.dispose();
      _projectiles.splice(i, 1);
      continue;
    }
    // Trail — spawn a small fading spark behind the projectile every
    // ~2 frames. Using p.age modulo a stride to throttle.
    if (Math.floor(p.age * 30) !== Math.floor((p.age - dt) * 30)) {
      _spawnSpark(
        p.mesh.position.x,
        p.mesh.position.y,
        p.mesh.position.z,
        (Math.random() - 0.5) * 1.2,
        (Math.random() - 0.3) * 1.0,
        (Math.random() - 0.5) * 1.2,
        0.45 + Math.random() * 0.3,
        0.7,
      );
    }
    // Homing — turn velocity vector toward target if it's still alive.
    if (p.target && p.target.hp > 0) {
      const tx = p.target.pos.x - p.mesh.position.x;
      const ty = (p.target.pos.y || 1) - p.mesh.position.y;
      const tz = p.target.pos.z - p.mesh.position.z;
      const tlen = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
      const desired = new THREE.Vector3(tx / tlen, ty / tlen, tz / tlen)
        .multiplyScalar(p.w.swarmSpeed);
      // Lerp velocity toward desired direction at homingStrength rate
      const lerp = Math.min(1, dt * p.w.swarmHoming);
      p.vel.lerp(desired, lerp);
    } else {
      // Target died — keep flying straight, lose y component for arc fall
      p.vel.y -= 8 * dt;     // small gravity
    }
    p.mesh.position.x += p.vel.x * dt;
    p.mesh.position.y += p.vel.y * dt;
    p.mesh.position.z += p.vel.z * dt;
    // Hit check — if close to current target, deal damage and remove
    if (p.target && p.target.hp > 0) {
      const dx = p.target.pos.x - p.mesh.position.x;
      const dy = (p.target.pos.y || 1) - p.mesh.position.y;
      const dz = p.target.pos.z - p.mesh.position.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      const radius = p.target.bossHitRadius ? 1.7 : 0.95;
      if (d2 < radius * radius) {
        p.target.hp -= p.dmg;
        p.target.hitFlash = Math.max(p.target.hitFlash || 0, 0.18);
        // Impact burst at hit point
        _spawnImpactBurst(p.mesh.position.x, p.mesh.position.y, p.mesh.position.z, 7);
        if (p.target.hp <= 0 && killCallback) killCallback(p.target);
        scene.remove(p.mesh);
        p.mat.dispose();
        _projectiles.splice(i, 1);
        continue;
      }
    }
  }
}

/** Burst N sparks radiating from (x,y,z). Cheap visual reward when a
 * swarm projectile connects. */
function _spawnImpactBurst(x, y, z, n) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const e = (Math.random() - 0.3) * Math.PI;
    const sp = 4 + Math.random() * 5;
    const vx = Math.cos(e) * Math.cos(a) * sp;
    const vy = Math.sin(e) * sp + 2;
    const vz = Math.cos(e) * Math.sin(a) * sp;
    _spawnSpark(x, y, z, vx, vy, vz, 0.5 + Math.random() * 0.4, 1.1);
  }
}

/** Hide all beams + clear projectiles + clear sparks. Called on
 * weapon swap or reset. */
export function clearLifedrainEffects() {
  _hideUnusedBeams(0);
  for (const p of _projectiles) {
    scene.remove(p.mesh);
    p.mat.dispose();
  }
  _projectiles.length = 0;
  for (const s of _sparks) {
    scene.remove(s.mesh);
    s.mat.dispose();
  }
  _sparks.length = 0;
}
