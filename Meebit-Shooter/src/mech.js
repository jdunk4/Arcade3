// mech.js — Pilotable EXOSUIT mech.
//
// Spawned by the EXOSUIT stratagem. The player walks up to a deployed
// mech and presses INTERACT (E key / gamepad A) to enter. While
// piloted:
//   • Player movement input drives the mech body (slower but heavier)
//   • Aim still tracks the cursor; LMB / right-trigger fires rockets
//     in salvos
//   • Hold SHIFT (or left-trigger) to fire the heavy machine gun (a
//     fast pulsing primary weapon)
//   • SPACE / dash button — short charge dash that crushes a line of
//     enemies in front of the mech
//   • F / B button — STOMP: a downward AoE that damages anything
//     adjacent
// On HP=0 the mech explodes and the player is ejected with full HP
// at the mech's position.
//
// Public API:
//   spawnMech(pos, tint)       — drop a fresh mech at pos
//   updateMechs(dt)            — per-frame tick (drive, weapons, FX)
//   getMechs()                 — iterable for input handlers
//   findEnterableMech(playerPos)
//                              — return nearest mech if within range,
//                                or null
//   enterMech(mech)            — switch player into mech control
//   exitMech()                 — eject player from mech (manual)
//   isPiloting()               — boolean
//   getPilotedMech()           — current mech or null
//   tickPilotedMech(inputs, dt)— main.js calls this every frame while
//                                piloting; passes the WASD vector + button
//                                state. Returns the world-space position
//                                the player.pos should be synced to.
//   damagePilotedMech(dmg)     — damage applied to currently-piloted mech
//   clearMechs()               — wipe all (game reset)

import * as THREE from 'three';
import { scene } from './scene.js';
import { hitBurst } from './effects.js';
import { enemies } from './enemies.js';

// =====================================================================
// TUNING
// =====================================================================
const MECH_HP_MAX        = 600;
const MECH_SPEED         = 6.0;        // slightly slower than player
const MECH_DASH_SPEED    = 22.0;
const MECH_DASH_DUR      = 0.35;
const MECH_DASH_COOLDOWN = 2.2;
const MECH_STOMP_RADIUS  = 5.5;
const MECH_STOMP_DAMAGE  = 250;
const MECH_STOMP_COOLDOWN= 1.6;
const MECH_ROCKET_SPEED  = 38.0;
const MECH_ROCKET_DAMAGE = 220;
const MECH_ROCKET_RADIUS = 4.0;
const MECH_ROCKET_INTERVAL = 0.20;     // seconds between rockets in a salvo
const MECH_ROCKET_SALVO  = 4;          // rockets per LMB press
const MECH_MG_INTERVAL   = 0.08;       // seconds between MG pulses
const MECH_MG_DAMAGE     = 22;
const MECH_MG_RANGE      = 28.0;
const MECH_ENTER_RANGE   = 2.8;        // walk this close to enter
const MECH_PILOT_RADIUS  = 1.8;        // collision radius while piloting
const MECH_DROP_HEIGHT   = 24.0;       // mechs drop from this height
const MECH_DROP_DURATION = 1.0;        // seconds of drop animation

// =====================================================================
// SHARED GEOMETRY
// =====================================================================
const _LEG_GEO       = new THREE.BoxGeometry(0.6, 1.6, 0.6);
const _FOOT_GEO      = new THREE.BoxGeometry(0.85, 0.20, 1.05);
const _HIP_GEO       = new THREE.BoxGeometry(2.3, 0.45, 1.0);
const _TORSO_GEO     = new THREE.BoxGeometry(2.2, 1.8, 1.6);
const _COCKPIT_GEO   = new THREE.BoxGeometry(1.4, 0.9, 1.1);
const _COCKPIT_GLASS_GEO = new THREE.BoxGeometry(1.3, 0.5, 0.05);
const _ARM_GEO       = new THREE.BoxGeometry(0.4, 1.4, 0.4);
const _SHOULDER_GEO  = new THREE.SphereGeometry(0.45, 12, 8);
// Right shoulder: missile pod (visible cluster of rocket tubes).
const _MISSILE_POD_GEO = new THREE.BoxGeometry(1.0, 0.7, 1.4);
const _MISSILE_TUBE_GEO = new THREE.CylinderGeometry(0.10, 0.10, 1.2, 8);
// Left arm: heavy MG barrel.
const _MG_BARREL_GEO  = new THREE.CylinderGeometry(0.16, 0.16, 1.6, 12);
const _MG_HOUSING_GEO = new THREE.BoxGeometry(0.6, 0.6, 0.9);
// Rocket projectile.
const _ROCKET_GEO    = new THREE.CylinderGeometry(0.08, 0.12, 0.8, 8);
// MG tracer (thin elongated cylinder).
const _TRACER_GEO    = new THREE.CylinderGeometry(0.04, 0.04, 1.0, 6);

const _activeMechs = [];

// =====================================================================
// SPAWN
// =====================================================================
export function spawnMech(pos, tint) {
  const root = new THREE.Group();
  // Drop from height; tickMechDrop animates Y down to 0 over MECH_DROP_DURATION.
  root.position.set(pos.x, MECH_DROP_HEIGHT, pos.z);

  const tintColor = new THREE.Color(tint || 0xff5520);
  const hullMat = new THREE.MeshStandardMaterial({
    color: 0x4a4d54,
    emissive: tintColor,
    emissiveIntensity: 0.20,
    roughness: 0.40,
    metalness: 0.85,
  });
  const trimMat = new THREE.MeshStandardMaterial({
    color: 0x2a2c34,
    emissive: tintColor,
    emissiveIntensity: 0.30,
    roughness: 0.55,
    metalness: 0.75,
  });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0xfff3d0,
    emissive: tintColor,
    emissiveIntensity: 1.6,
    transparent: true,
    opacity: 0.75,
    roughness: 0.20,
  });
  const accentMat = new THREE.MeshBasicMaterial({
    color: tintColor,
    transparent: true,
    opacity: 0.95,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });

  // ---- LEGS ----
  // Bipedal stance. Legs animate during walk via per-frame tickLegs.
  const legL = new THREE.Group();
  const legLMesh = new THREE.Mesh(_LEG_GEO, hullMat);
  legLMesh.position.y = 0.0;
  legL.add(legLMesh);
  const footL = new THREE.Mesh(_FOOT_GEO, trimMat);
  footL.position.y = -0.85;
  legL.add(footL);
  legL.position.set(-0.55, 1.0, 0);
  root.add(legL);

  const legR = new THREE.Group();
  const legRMesh = new THREE.Mesh(_LEG_GEO, hullMat);
  legR.add(legRMesh);
  const footR = new THREE.Mesh(_FOOT_GEO, trimMat);
  footR.position.y = -0.85;
  legR.add(footR);
  legR.position.set(0.55, 1.0, 0);
  root.add(legR);

  // ---- HIPS ----
  const hip = new THREE.Mesh(_HIP_GEO, trimMat);
  hip.position.y = 1.95;
  root.add(hip);

  // ---- TORSO ----
  // Torso is a separate group so it can rotate independently of the
  // legs (aim direction = torso yaw).
  const torso = new THREE.Group();
  torso.position.y = 3.05;
  root.add(torso);

  const torsoMesh = new THREE.Mesh(_TORSO_GEO, hullMat);
  torso.add(torsoMesh);

  // Cockpit on top of torso — chapter-tinted glass for the canopy.
  const cockpit = new THREE.Mesh(_COCKPIT_GEO, trimMat);
  cockpit.position.set(0, 1.05, 0.1);
  torso.add(cockpit);
  // Glass plate.
  const glass = new THREE.Mesh(_COCKPIT_GLASS_GEO, glassMat);
  glass.position.set(0, 1.05, 0.65);
  torso.add(glass);

  // ---- LEFT ARM: MG ----
  const armL = new THREE.Group();
  armL.position.set(-1.40, 0.2, 0);
  torso.add(armL);
  const armLMesh = new THREE.Mesh(_ARM_GEO, hullMat);
  armL.add(armLMesh);
  const shoulderL = new THREE.Mesh(_SHOULDER_GEO, trimMat);
  shoulderL.position.y = 0.7;
  armL.add(shoulderL);
  // MG housing at the wrist.
  const mgHousing = new THREE.Mesh(_MG_HOUSING_GEO, trimMat);
  mgHousing.position.set(0, -1.0, 0.2);
  armL.add(mgHousing);
  const mgBarrel = new THREE.Mesh(_MG_BARREL_GEO, trimMat);
  mgBarrel.position.set(0, -1.0, 1.0);
  mgBarrel.rotation.x = Math.PI / 2;
  armL.add(mgBarrel);
  // Muzzle marker — empty group at barrel tip used as MG fire origin.
  const mgMuzzle = new THREE.Group();
  mgMuzzle.position.set(0, -1.0, 1.7);
  armL.add(mgMuzzle);

  // ---- RIGHT ARM: MISSILE POD ----
  const armR = new THREE.Group();
  armR.position.set(1.40, 0.2, 0);
  torso.add(armR);
  const armRMesh = new THREE.Mesh(_ARM_GEO, hullMat);
  armR.add(armRMesh);
  const shoulderR = new THREE.Mesh(_SHOULDER_GEO, trimMat);
  shoulderR.position.y = 0.7;
  armR.add(shoulderR);
  const missilePod = new THREE.Mesh(_MISSILE_POD_GEO, trimMat);
  missilePod.position.set(0, -1.0, 0.3);
  armR.add(missilePod);
  // Visible rocket tubes — 4 in a 2x2 grid on the front of the pod.
  const tubeOffsets = [
    [-0.25,  0.18], [ 0.25,  0.18],
    [-0.25, -0.18], [ 0.25, -0.18],
  ];
  for (const [tx, ty] of tubeOffsets) {
    const tube = new THREE.Mesh(_MISSILE_TUBE_GEO, hullMat);
    tube.position.set(tx, -1.0 + ty, 1.0);
    tube.rotation.x = Math.PI / 2;
    armR.add(tube);
  }
  const rocketMuzzle = new THREE.Group();
  rocketMuzzle.position.set(0, -1.0, 1.6);
  armR.add(rocketMuzzle);

  // ---- ENTER PROMPT ----
  // Floating sprite above the mech that says "PRESS E TO ENTER" when
  // the player is in range. Hidden by default.
  const promptCanvas = document.createElement('canvas');
  promptCanvas.width = 256; promptCanvas.height = 64;
  const promptCtx = promptCanvas.getContext('2d');
  promptCtx.font = 'bold 22px Impact, monospace';
  promptCtx.textAlign = 'center';
  promptCtx.textBaseline = 'middle';
  promptCtx.fillStyle = '#ffd93d';
  promptCtx.shadowColor = '#000';
  promptCtx.shadowBlur = 8;
  promptCtx.fillText('▶ PRESS E TO ENTER', 128, 32);
  const promptTex = new THREE.CanvasTexture(promptCanvas);
  const promptMat = new THREE.SpriteMaterial({
    map: promptTex, transparent: true, depthWrite: false, depthTest: false, toneMapped: false,
  });
  const prompt = new THREE.Sprite(promptMat);
  prompt.scale.set(3.6, 0.9, 1);
  prompt.position.y = 5.6;
  prompt.visible = false;
  root.add(prompt);

  scene.add(root);

  const mech = {
    root, torso,
    legL, legR,
    armL, armR,
    mgMuzzle, rocketMuzzle,
    glass, glassMat,
    hullMat, trimMat, accentMat,
    prompt,
    tint, tintColor,
    hp: MECH_HP_MAX, hpMax: MECH_HP_MAX,
    pos: new THREE.Vector3(pos.x, 0, pos.z),
    facing: 0,
    walkPhase: 0,
    // Drop animation
    dropping: true,
    dropT: 0,
    // Combat state
    rocketSalvoLeft: 0,
    rocketSalvoTimer: 0,
    rocketTargetWorld: new THREE.Vector3(),
    mgFiring: false,
    mgTimer: 0,
    dashLeft: 0, dashCooldown: 0, dashDir: new THREE.Vector3(),
    stompCooldown: 0,
    // Active rocket projectiles
    rockets: [],
    // Active MG tracers
    tracers: [],
    destroyed: false,
    deathT: 0,
  };
  _activeMechs.push(mech);
  return mech;
}

// =====================================================================
// PER-FRAME UPDATE
// =====================================================================
export function updateMechs(dt) {
  for (let i = _activeMechs.length - 1; i >= 0; i--) {
    const m = _activeMechs[i];

    // Drop animation — Y descends from MECH_DROP_HEIGHT to 0 over
    // MECH_DROP_DURATION with an ease-in for "weighty" landing.
    if (m.dropping) {
      m.dropT += dt;
      const f = Math.min(1, m.dropT / MECH_DROP_DURATION);
      const eased = f * f;
      m.root.position.y = MECH_DROP_HEIGHT * (1 - eased);
      if (f >= 1) {
        m.dropping = false;
        m.root.position.y = 0;
        // Landing impact burst.
        hitBurst(m.root.position.clone(), m.tint, 30);
        hitBurst(m.root.position.clone(), 0xffffff, 18);
      }
    }

    // Rocket projectile tick (always — even when piloted).
    _tickMechRockets(m, dt);
    _tickMechTracers(m, dt);

    // Cooldown countdowns.
    if (m.dashCooldown > 0) m.dashCooldown -= dt;
    if (m.stompCooldown > 0) m.stompCooldown -= dt;
    if (m.dashLeft > 0) m.dashLeft = Math.max(0, m.dashLeft - dt);

    // Salvo timer — fires queued rockets on interval (whether piloted
    // or not; we'll just stop queueing when not piloted).
    if (m.rocketSalvoLeft > 0) {
      m.rocketSalvoTimer -= dt;
      if (m.rocketSalvoTimer <= 0) {
        _fireMechRocket(m, m.rocketTargetWorld);
        m.rocketSalvoLeft -= 1;
        m.rocketSalvoTimer = MECH_ROCKET_INTERVAL;
      }
    }

    // MG continuous fire — fires while flag is on (piloted ticks set it).
    if (m.mgFiring) {
      m.mgTimer -= dt;
      if (m.mgTimer <= 0) {
        _fireMechMG(m);
        m.mgTimer = MECH_MG_INTERVAL;
      }
    }

    // Death sequence.
    if (m.destroyed) {
      m.deathT += dt;
      // Sink + spin for 1.0s then remove.
      m.root.rotation.y += dt * 4;
      m.root.position.y -= dt * 1.5;
      if (m.deathT > 1.0) {
        _disposeMech(m);
        _activeMechs.splice(i, 1);
      }
      continue;
    }
  }
}

// =====================================================================
// PILOTING
// =====================================================================
let _pilotedMech = null;

export function isPiloting() { return !!_pilotedMech; }
export function getPilotedMech() { return _pilotedMech; }
export function getMechs() { return _activeMechs.slice(); }

/**
 * Find the closest enterable mech within MECH_ENTER_RANGE of the
 * given player position. Returns null if none in range.
 */
export function findEnterableMech(playerPos) {
  let best = null;
  let bestD2 = MECH_ENTER_RANGE * MECH_ENTER_RANGE;
  for (const m of _activeMechs) {
    if (m.destroyed || m.dropping) continue;
    const dx = m.pos.x - playerPos.x;
    const dz = m.pos.z - playerPos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD2) { bestD2 = d2; best = m; }
  }
  return best;
}

/**
 * Update each mech's enter-prompt visibility based on player range.
 * Called from main.js once per frame so the prompts respond to player
 * position. We accept playerPos rather than reading it directly to
 * keep mech.js free of player.js dependency.
 */
export function updateMechPrompts(playerPos) {
  for (const m of _activeMechs) {
    if (m.destroyed || m.dropping) {
      m.prompt.visible = false;
      continue;
    }
    if (_pilotedMech === m) {
      m.prompt.visible = false;
      continue;
    }
    const dx = m.pos.x - playerPos.x;
    const dz = m.pos.z - playerPos.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    m.prompt.visible = d <= MECH_ENTER_RANGE * 1.4;     // slightly larger than enter range so prompt fades in early
  }
}

export function enterMech(mech) {
  if (!mech || mech.destroyed) return;
  _pilotedMech = mech;
  mech.prompt.visible = false;
}

export function exitMech() {
  if (!_pilotedMech) return null;
  const mp = _pilotedMech.pos.clone();
  _pilotedMech = null;
  return mp;
}

/**
 * Per-frame piloted-mech update. Returns the position that the
 * player.pos should be synced to (so player.js + camera follow keep
 * working without modification). Called from main.js.
 *
 * inputs object:
 *   mx, mz   — normalized movement vector (-1..1)
 *   aimAng   — radians, where the mech should face (atan2 of
 *              cursor world-space delta from mech)
 *   firePrimary  — bool: shoot MG
 *   fireSecondary — bool: launch rocket salvo
 *   stomp    — bool: stomp request
 *   dash     — bool: dash request
 */
export function tickPilotedMech(inputs, dt) {
  if (!_pilotedMech) return null;
  const m = _pilotedMech;
  if (m.destroyed) return m.pos.clone();

  // Movement.
  let speed = MECH_SPEED;
  if (m.dashLeft > 0) {
    speed = MECH_DASH_SPEED;
    // While dashing, travel direction is locked (set when dash began).
    m.pos.x += m.dashDir.x * speed * dt;
    m.pos.z += m.dashDir.z * speed * dt;
  } else {
    m.pos.x += (inputs.mx || 0) * speed * dt;
    m.pos.z += (inputs.mz || 0) * speed * dt;
  }
  // Soft arena clamp — same wall buffer as player.
  // (We don't have ARENA imported here to keep deps clean; the value
  // is propagated through inputs.arenaHalf if the host wants to clamp.)
  if (typeof inputs.arenaHalf === 'number') {
    const ah = inputs.arenaHalf - 2.0;
    m.pos.x = Math.max(-ah, Math.min(ah, m.pos.x));
    m.pos.z = Math.max(-ah, Math.min(ah, m.pos.z));
  }
  m.root.position.x = m.pos.x;
  m.root.position.z = m.pos.z;

  // Walk-cycle leg animation when moving.
  const moving = (inputs.mx || 0) !== 0 || (inputs.mz || 0) !== 0 || m.dashLeft > 0;
  if (moving) {
    m.walkPhase += dt * (m.dashLeft > 0 ? 12 : 6);
    m.legL.rotation.x = Math.sin(m.walkPhase) * 0.45;
    m.legR.rotation.x = -Math.sin(m.walkPhase) * 0.45;
    // Body bob.
    const bob = Math.abs(Math.sin(m.walkPhase * 2)) * 0.08;
    m.torso.position.y = 3.05 + bob;
  } else {
    // Settle legs back to 0.
    m.legL.rotation.x *= 0.85;
    m.legR.rotation.x *= 0.85;
    m.torso.position.y = 3.05;
  }

  // Aim — torso rotates toward inputs.aimAng. Body legs rotate to match
  // movement direction so the mech reads as walking forward, not
  // crab-walking, BUT only when not actively dashing (during dash the
  // legs stay aligned to dashDir).
  if (typeof inputs.aimAng === 'number') {
    m.facing = inputs.aimAng;
    m.torso.rotation.y = inputs.aimAng;
  }
  if (m.dashLeft > 0) {
    const dashAng = Math.atan2(m.dashDir.x, m.dashDir.z);
    m.root.rotation.y = dashAng;
  } else if (moving) {
    const moveAng = Math.atan2(inputs.mx, inputs.mz);
    // Smooth body yaw toward movement direction.
    const cur = m.root.rotation.y;
    let dy = moveAng - cur;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    m.root.rotation.y = cur + dy * Math.min(1, dt * 8);
  }

  // Weapons.
  if (inputs.fireSecondary) _requestRocketSalvo(m);
  m.mgFiring = !!inputs.firePrimary;
  if (inputs.stomp) _doStomp(m);
  if (inputs.dash) _startDash(m, inputs.mx, inputs.mz);

  return m.pos.clone();
}

// =====================================================================
// WEAPONS
// =====================================================================
// Rocket salvo — queue MECH_ROCKET_SALVO rockets to fire on interval.
function _requestRocketSalvo(m) {
  if (m.rocketSalvoLeft > 0) return;       // already firing
  m.rocketSalvoLeft = MECH_ROCKET_SALVO;
  m.rocketSalvoTimer = 0;     // first rocket fires immediately
  // Rocket target = current aim direction × range. Computed at
  // salvo start; subsequent rockets in the salvo all target the
  // same vector (so the player can re-aim mid-salvo for the next
  // salvo, but the current salvo's rockets fly along the vector
  // they were fired along).
  const ang = m.facing;
  m.rocketTargetWorld.set(
    m.pos.x + Math.sin(ang) * 50,
    1.5,
    m.pos.z + Math.cos(ang) * 50,
  );
}

function _fireMechRocket(m, target) {
  // Spawn a rocket at the muzzle world position, velocity along
  // (target - muzzle).
  const muzzleWorld = new THREE.Vector3();
  m.rocketMuzzle.getWorldPosition(muzzleWorld);

  const rocketMat = new THREE.MeshStandardMaterial({
    color: 0xfff3d0,
    emissive: m.tintColor,
    emissiveIntensity: 2.5,
    roughness: 0.30,
  });
  const mesh = new THREE.Mesh(_ROCKET_GEO, rocketMat);
  mesh.position.copy(muzzleWorld);
  // Orient rocket along its velocity direction.
  const dir = new THREE.Vector3().subVectors(target, muzzleWorld).normalize();
  const ang = Math.atan2(dir.x, dir.z);
  mesh.rotation.y = ang;
  mesh.rotation.x = Math.PI / 2;       // align cylinder with travel direction
  scene.add(mesh);

  m.rockets.push({
    mesh, mat: rocketMat,
    pos: muzzleWorld.clone(),
    vel: dir.multiplyScalar(MECH_ROCKET_SPEED),
    life: 0,
    maxLife: 2.0,
  });

  // Muzzle flash burst.
  hitBurst(muzzleWorld, m.tint, 6);
  hitBurst(muzzleWorld, 0xffffff, 4);
}

function _tickMechRockets(m, dt) {
  for (let i = m.rockets.length - 1; i >= 0; i--) {
    const r = m.rockets[i];
    r.pos.x += r.vel.x * dt;
    r.pos.y += r.vel.y * dt;
    r.pos.z += r.vel.z * dt;
    r.mesh.position.copy(r.pos);
    r.life += dt;

    // Hit-test against enemies. Simple radius check against rocket
    // tip; on hit, AoE-damage everything in MECH_ROCKET_RADIUS.
    let hitTarget = null;
    for (let j = 0; j < enemies.length; j++) {
      const e = enemies[j];
      if (!e || !e.pos || e.dying) continue;
      const dx = e.pos.x - r.pos.x;
      const dz = e.pos.z - r.pos.z;
      if (dx * dx + dz * dz < 1.4 * 1.4) {
        hitTarget = e;
        break;
      }
    }
    // Detonate on hit, on lifetime expiry, or on ground impact.
    const groundHit = r.pos.y < 0.4;
    if (hitTarget || groundHit || r.life >= r.maxLife) {
      _detonateMechRocket(m, r.pos);
      _disposeRocket(r);
      m.rockets.splice(i, 1);
    }
  }
}

function _detonateMechRocket(m, pos) {
  // AoE damage in MECH_ROCKET_RADIUS.
  const r2 = MECH_ROCKET_RADIUS * MECH_ROCKET_RADIUS;
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (!e || !e.pos || e.dying) continue;
    const dx = e.pos.x - pos.x;
    const dz = e.pos.z - pos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < r2) {
      const falloff = 1 - Math.sqrt(d2) / MECH_ROCKET_RADIUS;
      e.hp -= MECH_ROCKET_DAMAGE * falloff;
      e.hitFlash = 0.18;
    }
  }
  // FX.
  hitBurst(pos, 0xffffff, 26);
  hitBurst(pos, m.tint, 22);
  setTimeout(() => hitBurst(pos, 0xffaa00, 18), 60);
  setTimeout(() => hitBurst(pos, 0xff5520, 14), 130);
}

function _disposeRocket(r) {
  if (r.mesh.parent) r.mesh.parent.remove(r.mesh);
  if (r.mat) r.mat.dispose();
}

// MG — fast pulsing weapon, single-shot hitscan. Each pulse applies
// damage to the first enemy along the aim ray within MECH_MG_RANGE.
function _fireMechMG(m) {
  const muzzleWorld = new THREE.Vector3();
  m.mgMuzzle.getWorldPosition(muzzleWorld);
  // Aim along torso facing.
  const ang = m.facing;
  const dir = new THREE.Vector3(Math.sin(ang), 0, Math.cos(ang));

  // Find first enemy along the ray.
  let hit = null;
  let bestT = MECH_MG_RANGE;
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (!e || !e.pos || e.dying) continue;
    const dx = e.pos.x - muzzleWorld.x;
    const dz = e.pos.z - muzzleWorld.z;
    const t = dx * dir.x + dz * dir.z;             // projection length
    if (t < 0 || t > bestT) continue;
    // Perpendicular distance from ray.
    const px = muzzleWorld.x + dir.x * t;
    const pz = muzzleWorld.z + dir.z * t;
    const ddx = e.pos.x - px;
    const ddz = e.pos.z - pz;
    const dperp2 = ddx * ddx + ddz * ddz;
    if (dperp2 < 0.9 * 0.9) {                       // ~enemy width
      hit = e; bestT = t;
    }
  }
  // Tracer FX — visible cylinder from muzzle to hit (or max range).
  const tracerEnd = muzzleWorld.clone().add(dir.clone().multiplyScalar(bestT));
  _spawnTracer(m, muzzleWorld, tracerEnd);

  if (hit) {
    hit.hp -= MECH_MG_DAMAGE;
    hit.hitFlash = 0.10;
    hitBurst(tracerEnd, 0xffffff, 3);
    hitBurst(tracerEnd, m.tint, 2);
  }
}

function _spawnTracer(m, from, to) {
  const len = from.distanceTo(to);
  if (len < 0.1) return;
  const mat = new THREE.MeshBasicMaterial({
    color: m.tintColor,
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const tracer = new THREE.Mesh(_TRACER_GEO, mat);
  tracer.scale.set(1, len, 1);
  // Position halfway, oriented along (to - from).
  const mid = from.clone().lerp(to, 0.5);
  tracer.position.copy(mid);
  // Rotate so the cylinder's Y axis aligns with the from→to direction.
  const dir = to.clone().sub(from).normalize();
  const up = new THREE.Vector3(0, 1, 0);
  const quat = new THREE.Quaternion().setFromUnitVectors(up, dir);
  tracer.quaternion.copy(quat);
  scene.add(tracer);
  m.tracers.push({ mesh: tracer, mat, life: 0, ttl: 0.07 });
}

function _tickMechTracers(m, dt) {
  for (let i = m.tracers.length - 1; i >= 0; i--) {
    const t = m.tracers[i];
    t.life += dt;
    const f = t.life / t.ttl;
    if (f >= 1) {
      if (t.mesh.parent) t.mesh.parent.remove(t.mesh);
      if (t.mat) t.mat.dispose();
      m.tracers.splice(i, 1);
      continue;
    }
    t.mat.opacity = 0.85 * (1 - f);
  }
}

// Stomp — AoE around the mech's feet.
function _doStomp(m) {
  if (m.stompCooldown > 0) return;
  m.stompCooldown = MECH_STOMP_COOLDOWN;
  const r2 = MECH_STOMP_RADIUS * MECH_STOMP_RADIUS;
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (!e || !e.pos || e.dying) continue;
    const dx = e.pos.x - m.pos.x;
    const dz = e.pos.z - m.pos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < r2) {
      const falloff = 1 - Math.sqrt(d2) / MECH_STOMP_RADIUS;
      e.hp -= MECH_STOMP_DAMAGE * falloff;
      e.hitFlash = 0.20;
    }
  }
  // Visual: shockwave ring + dust burst.
  hitBurst(m.pos.clone(), 0xffffff, 24);
  hitBurst(m.pos.clone(), m.tint, 18);
  // Ground impact ring.
  _spawnStompRing(m);
}

function _spawnStompRing(m) {
  const ringGeo = new THREE.RingGeometry(0.5, 0.7, 36);
  const ringMat = new THREE.MeshBasicMaterial({
    color: m.tintColor,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(m.pos.x, 0.05, m.pos.z);
  scene.add(ring);
  // Animate via a one-off self-scheduled tick. Cheap; rings are rare.
  const tStart = performance.now();
  function tick() {
    const t = (performance.now() - tStart) / 1000;
    const f = Math.min(1, t / 0.45);
    const s = 1 + f * (MECH_STOMP_RADIUS / 0.6);
    ring.scale.set(s, s, 1);
    ringMat.opacity = 0.85 * (1 - f);
    if (f < 1) requestAnimationFrame(tick);
    else {
      if (ring.parent) ring.parent.remove(ring);
      ringMat.dispose();
      ringGeo.dispose();
    }
  }
  requestAnimationFrame(tick);
}

// Dash — short fast slide that crushes enemies along its line.
function _startDash(m, mx, mz) {
  if (m.dashCooldown > 0 || m.dashLeft > 0) return;
  // Direction defaults to facing if no movement input.
  let dx = mx, dz = mz;
  const len = Math.sqrt(dx * dx + dz * dz);
  if (len < 0.01) {
    dx = Math.sin(m.facing);
    dz = Math.cos(m.facing);
  } else {
    dx /= len; dz /= len;
  }
  m.dashDir.set(dx, 0, dz);
  m.dashLeft = MECH_DASH_DUR;
  m.dashCooldown = MECH_DASH_COOLDOWN;
  // Damage line — anything inside a thin rectangle in front of the
  // mech for the dash distance gets squished.
  const dashLen = MECH_DASH_DUR * MECH_DASH_SPEED;
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (!e || !e.pos || e.dying) continue;
    const ex = e.pos.x - m.pos.x;
    const ez = e.pos.z - m.pos.z;
    // Project onto dash axis.
    const along = ex * dx + ez * dz;
    if (along < 0 || along > dashLen) continue;
    // Perpendicular distance.
    const perpX = ex - dx * along;
    const perpZ = ez - dz * along;
    const perp2 = perpX * perpX + perpZ * perpZ;
    if (perp2 < 1.6 * 1.6) {
      e.hp -= 400;
      e.hitFlash = 0.20;
    }
  }
  hitBurst(m.pos.clone(), 0xffffff, 16);
}

// =====================================================================
// DAMAGE
// =====================================================================
export function damagePilotedMech(dmg) {
  if (!_pilotedMech || _pilotedMech.destroyed) return;
  _pilotedMech.hp -= dmg;
  if (_pilotedMech.hp <= 0) {
    _destroyMech(_pilotedMech);
  }
}

function _destroyMech(m) {
  m.destroyed = true;
  m.hp = 0;
  // Eject pilot.
  if (_pilotedMech === m) {
    _pilotedMech = null;
    // Surface the eject so main.js can re-show the player mesh and
    // restore player.pos to mech.pos.
    if (typeof window !== 'undefined' && window.__mechEjected) {
      window.__mechEjected(m.pos.clone());
    }
  }
  // Big explosion.
  const pos = m.pos.clone();
  pos.y = 1.5;
  hitBurst(pos, 0xffffff, 50);
  hitBurst(pos, m.tint, 40);
  setTimeout(() => hitBurst(pos, 0xffaa00, 30), 60);
  setTimeout(() => hitBurst(pos, 0xff5520, 22), 140);
}

function _disposeMech(m) {
  if (m.root.parent) scene.remove(m.root);
  if (m.hullMat) m.hullMat.dispose();
  if (m.trimMat) m.trimMat.dispose();
  if (m.glassMat) m.glassMat.dispose();
  if (m.accentMat) m.accentMat.dispose();
  // Dispose any in-flight projectiles + tracers.
  for (const r of m.rockets) _disposeRocket(r);
  m.rockets.length = 0;
  for (const t of m.tracers) {
    if (t.mesh.parent) t.mesh.parent.remove(t.mesh);
    if (t.mat) t.mat.dispose();
  }
  m.tracers.length = 0;
}

export function clearMechs() {
  _pilotedMech = null;
  for (const m of _activeMechs) _disposeMech(m);
  _activeMechs.length = 0;
}
