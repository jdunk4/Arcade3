// Civilian Meebits — wandering NPCs that flee from enemies.
//
// Behavior states:
//   idle:    random wander within arena
//   flee:    enemy within FLEE_RADIUS → sprint away from nearest
//   panic:   2+ enemies within PANIC_RADIUS → erratic dodge run + scream
//   rescued: reached arena edge → despawn + score bonus
//   dead:    bullet/enemy hit → ragdoll drop, no update
//
// Visual: real VRM from meebits.app/meebit/{id}. Voxel fallback on fetch fail.
//
// Collision:
//   - Enemies can "eat" them on touch (instant death)
//   - Player bullets/rockets/beam can hit them (instant death + score penalty)
//   - Multiple civilians alive at once; each has unique random Meebit ID per spawn

import * as THREE from 'three';
import { scene } from './scene.js';
import { ARENA } from './config.js';
import { getMeebitMesh, pickRandomMeebitId } from './meebitsPublicApi.js';
import { hitBurst } from './effects.js';

export const civilians = [];

const FLEE_RADIUS = 6;
const PANIC_RADIUS = 8;
const RESCUE_EDGE = ARENA - 2;
const CIVILIAN_SPEED = 3.2;
const PANIC_SPEED = 4.6;
const WANDER_CHANGE_SEC = 2.5;

// In-use Meebit IDs this wave (avoid duplicates on screen)
const activeIds = new Set();

// Spawn queue — civilians spawned asynchronously because VRM fetch is async
let spawnQueue = 0;

export function clearAllCivilians() {
  for (const c of civilians) {
    if (c.obj && c.obj.parent) scene.remove(c.obj);
  }
  civilians.length = 0;
  activeIds.clear();
  spawnQueue = 0;
}

/**
 * Spawn `count` civilian Meebits scattered around the arena.
 * Async-safe: each civilian loads in the background, so the wave can start
 * immediately. Civilians pop into existence as their VRMs finish loading.
 */
export function spawnCivilians(count, chapterTintHex) {
  spawnQueue += count;
  for (let i = 0; i < count; i++) {
    spawnOneCivilian(chapterTintHex);
  }
}

async function spawnOneCivilian(chapterTintHex) {
  const id = pickRandomMeebitId(activeIds);
  activeIds.add(id);

  // Position: random spot in the arena, at least 12u from center (so player doesn't mow them down on spawn)
  const angle = Math.random() * Math.PI * 2;
  const dist = 14 + Math.random() * 20;
  const x = Math.cos(angle) * dist;
  const z = Math.sin(angle) * dist;

  // Create placeholder while VRM loads
  const placeholder = new THREE.Group();
  placeholder.position.set(x, 0, z);
  scene.add(placeholder);

  const civilian = {
    obj: placeholder,
    pos: placeholder.position,
    meebitId: id,
    state: 'idle',
    vel: new THREE.Vector3(),
    wanderTarget: new THREE.Vector3(x, 0, z),
    wanderTimer: Math.random() * WANDER_CHANGE_SEC,
    panicPhase: Math.random() * Math.PI * 2,
    screamCooldown: 0,
    hp: 1,
    rescueTimer: 0,
    dead: false,
    ready: false,
    animRefs: null,
    walkPhase: Math.random() * Math.PI * 2,
  };
  civilians.push(civilian);

  try {
    const mesh = await getMeebitMesh(id, chapterTintHex);
    // Swap placeholder for real mesh
    if (civilian.obj.parent) scene.remove(civilian.obj);
    mesh.position.copy(placeholder.position);
    // Add proxy limbs for animation if it's our voxel fallback
    if (mesh.userData.isFallback && mesh.userData.animRefs) {
      civilian.animRefs = mesh.userData.animRefs;
    }
    scene.add(mesh);
    civilian.obj = mesh;
    civilian.pos = mesh.position;
    civilian.ready = true;
  } catch (err) {
    console.warn('[Civilian] failed to load', id, err);
    civilian.ready = true; // keep placeholder as-is
  } finally {
    spawnQueue = Math.max(0, spawnQueue - 1);
  }
}

/**
 * Called every frame. Needs `enemies` and `player` references passed in so
 * civilians can react to them.
 */
export function updateCivilians(dt, enemies, player, onCivilianKilled, onCivilianRescued) {
  for (let i = civilians.length - 1; i >= 0; i--) {
    const c = civilians[i];
    if (c.dead) continue;

    // Count nearby enemies to determine state
    let nearestEnemy = null;
    let nearestDist = Infinity;
    let enemiesNear = 0;
    for (const e of enemies) {
      if (e.isBoss) continue; // bosses don't chase civilians — too scary
      const dx = e.pos.x - c.pos.x;
      const dz = e.pos.z - c.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < FLEE_RADIUS * FLEE_RADIUS) {
        if (d2 < nearestDist) { nearestDist = d2; nearestEnemy = e; }
      }
      if (d2 < PANIC_RADIUS * PANIC_RADIUS) enemiesNear++;
    }

    // State machine
    if (enemiesNear >= 2) {
      c.state = 'panic';
    } else if (nearestEnemy) {
      c.state = 'flee';
    } else {
      c.state = 'idle';
    }

    // Movement
    if (c.state === 'idle') {
      c.wanderTimer -= dt;
      if (c.wanderTimer <= 0) {
        c.wanderTimer = WANDER_CHANGE_SEC + Math.random() * 2;
        const a = Math.random() * Math.PI * 2;
        const r = 4 + Math.random() * 8;
        c.wanderTarget.set(
          Math.max(-RESCUE_EDGE, Math.min(RESCUE_EDGE, c.pos.x + Math.cos(a) * r)),
          0,
          Math.max(-RESCUE_EDGE, Math.min(RESCUE_EDGE, c.pos.z + Math.sin(a) * r))
        );
      }
      const dx = c.wanderTarget.x - c.pos.x;
      const dz = c.wanderTarget.z - c.pos.z;
      const d = Math.sqrt(dx * dx + dz * dz) || 1;
      if (d > 0.5) {
        c.pos.x += (dx / d) * CIVILIAN_SPEED * 0.4 * dt;
        c.pos.z += (dz / d) * CIVILIAN_SPEED * 0.4 * dt;
        c.obj.rotation.y = Math.atan2(dx, dz);
      }
    } else if (c.state === 'flee' && nearestEnemy) {
      // Run directly away from nearest enemy, biased toward arena edge
      const ax = c.pos.x - nearestEnemy.pos.x;
      const az = c.pos.z - nearestEnemy.pos.z;
      const d = Math.sqrt(ax * ax + az * az) || 1;
      const speed = CIVILIAN_SPEED;
      c.pos.x += (ax / d) * speed * dt;
      c.pos.z += (az / d) * speed * dt;
      c.obj.rotation.y = Math.atan2(ax, az);
    } else if (c.state === 'panic' && nearestEnemy) {
      // Erratic — run away but jitter perpendicular
      c.panicPhase += dt * 8;
      const ax = c.pos.x - nearestEnemy.pos.x;
      const az = c.pos.z - nearestEnemy.pos.z;
      const d = Math.sqrt(ax * ax + az * az) || 1;
      const nx = ax / d, nz = az / d;
      // Perpendicular = rotate 90° in xz plane
      const perpX = -nz, perpZ = nx;
      const jitter = Math.sin(c.panicPhase) * 0.6;
      const vx = nx + perpX * jitter;
      const vz = nz + perpZ * jitter;
      const vlen = Math.sqrt(vx * vx + vz * vz) || 1;
      c.pos.x += (vx / vlen) * PANIC_SPEED * dt;
      c.pos.z += (vz / vlen) * PANIC_SPEED * dt;
      c.obj.rotation.y = Math.atan2(vx, vz);
      // Scream occasionally (visual puff — actual scream sound is in main.js)
      c.screamCooldown -= dt;
      if (c.screamCooldown <= 0) {
        c.screamCooldown = 0.6 + Math.random() * 0.4;
        hitBurst(new THREE.Vector3(c.pos.x, 2.8, c.pos.z), 0xffffff, 3);
      }
    }

    // Clamp to arena bounds
    c.pos.x = Math.max(-RESCUE_EDGE, Math.min(RESCUE_EDGE, c.pos.x));
    c.pos.z = Math.max(-RESCUE_EDGE, Math.min(RESCUE_EDGE, c.pos.z));

    // Animate walk (if we have limb refs, i.e. voxel fallback)
    const moving = (c.state !== 'idle' || (c.wanderTimer < WANDER_CHANGE_SEC * 0.7));
    if (moving && c.animRefs) {
      c.walkPhase += dt * (c.state === 'panic' ? 14 : 10);
      const sw = Math.sin(c.walkPhase) * 0.6;
      if (c.animRefs.legL) c.animRefs.legL.rotation.x = sw;
      if (c.animRefs.legR) c.animRefs.legR.rotation.x = -sw;
      if (c.animRefs.armL) c.animRefs.armL.rotation.x = -sw * 0.7;
      if (c.animRefs.armR) c.animRefs.armR.rotation.x = sw * 0.7;
    }

    // Check: did they reach an edge? → rescued
    if (Math.abs(c.pos.x) >= RESCUE_EDGE - 0.5 || Math.abs(c.pos.z) >= RESCUE_EDGE - 0.5) {
      c.rescueTimer += dt;
      if (c.rescueTimer > 0.5) {
        // Celebrate and despawn
        hitBurst(new THREE.Vector3(c.pos.x, 2, c.pos.z), 0x00ff66, 10);
        onCivilianRescued && onCivilianRescued(c);
        removeCivilian(c, i);
        continue;
      }
    } else {
      c.rescueTimer = 0;
    }

    // Check: did an enemy touch them? → killed by enemy
    for (const e of enemies) {
      if (e.isBoss) continue;
      const dx = e.pos.x - c.pos.x;
      const dz = e.pos.z - c.pos.z;
      if (dx * dx + dz * dz < 1.0) {
        killCivilian(c, i, 'enemy', onCivilianKilled);
        break;
      }
    }
  }
}

export function damageCivilianAt(x, z, hitRadius, cause, onCivilianKilled) {
  // Called by bullet/rocket/beam hit tests in main.js
  for (let i = civilians.length - 1; i >= 0; i--) {
    const c = civilians[i];
    if (c.dead) continue;
    const dx = c.pos.x - x;
    const dz = c.pos.z - z;
    if (dx * dx + dz * dz < hitRadius * hitRadius) {
      killCivilian(c, i, cause, onCivilianKilled);
      return true;
    }
  }
  return false;
}

function killCivilian(c, idx, cause, onCivilianKilled) {
  c.dead = true;
  c.state = 'dead';
  // Ragdoll-ish: drop slightly, tip over
  if (c.obj) {
    c.obj.rotation.x = Math.PI / 2;
    c.obj.position.y = 0.3;
  }
  hitBurst(new THREE.Vector3(c.pos.x, 1.5, c.pos.z), 0xff2e4d, 12);
  setTimeout(() => hitBurst(new THREE.Vector3(c.pos.x, 0.5, c.pos.z), 0x880000, 6), 80);
  onCivilianKilled && onCivilianKilled(c, cause);
  // Leave corpse on floor for 3 seconds then remove
  setTimeout(() => {
    const realIdx = civilians.indexOf(c);
    if (realIdx >= 0) removeCivilian(c, realIdx);
  }, 3000);
}

function removeCivilian(c, idx) {
  if (c.obj && c.obj.parent) scene.remove(c.obj);
  activeIds.delete(c.meebitId);
  civilians.splice(idx, 1);
}
