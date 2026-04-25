// Galaga ship clone — chapter 2 ally that auto-fires at bugs.
//
// A small flat triangular ship that floats at altitude y=10 and lerps
// toward the player's XZ position with delay (~0.4s) — gives a
// "tethered companion" feel. The ship has no gameplay collision
// (player can walk anywhere, doesn't hit the ship) and doesn't take
// damage. It exists purely to assist by killing bugs.
//
// Targeting:
//   - Each frame, the ship picks the nearest bug (in any phase except
//     ASCENDING — those are already done).
//   - When the cooldown expires, fires a bullet from ship → bug position.
//   - Cooldown 0.6s.
//
// Aiming line:
//   - When a target is acquired, a thin glowing line is drawn from
//     the ship to the bug. The line is dim (low opacity) so it reads
//     as "aim assist" rather than "shot."
//
// Bullets:
//   - Small white tracer with a cyan glow trail.
//   - Travels at 25 u/s in the direction the ship faced when fired.
//   - On reaching a bug (radius check) → applies 1 damage.
//   - Auto-despawns after 1.5s if it never hits anything.
//
// Visual design:
//   - Triangular ship body (flat plane), white with cyan trim.
//   - Scale 0.6 (small).
//   - Body opacity 0.8 (semi-transparent so it doesn't block view).

import * as THREE from 'three';
import { scene } from './scene.js';
import { Audio } from './audio.js';
import { getBugs, applyBugDamage, getBugPos } from './hazardsGalaga.js';

const SHIP_ALTITUDE = 10.0;
const SHIP_FOLLOW_LERP = 2.5;       // higher = ship catches up faster (lower = more delay)
const SHIP_FIRE_COOLDOWN = 0.6;
const BULLET_SPEED = 25.0;
const BULLET_LIFE = 1.5;
const BULLET_HIT_RADIUS = 0.7;
const BULLET_HIT_RADIUS_SQ = BULLET_HIT_RADIUS * BULLET_HIT_RADIUS;

// Ship geometry — a flat triangle pointing forward (+Z direction).
// Three vertices: nose forward, two wings back.
function _buildShipMesh() {
  const shape = new THREE.Shape();
  shape.moveTo(0, 1.0);        // nose
  shape.lineTo(-0.7, -0.7);    // back-left wing
  shape.lineTo(-0.3, -0.4);    // wing inset
  shape.lineTo(0, -0.5);       // tail center
  shape.lineTo(0.3, -0.4);     // wing inset
  shape.lineTo(0.7, -0.7);     // back-right wing
  shape.closePath();
  const geo = new THREE.ShapeGeometry(shape);
  // Body: white with cyan emissive trim.
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0x55ddff,
    emissiveIntensity: 0.6,
    metalness: 0.5,
    roughness: 0.4,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
  });
  const body = new THREE.Mesh(geo, bodyMat);
  // The shape is in the XY plane facing +Z by default. We want the
  // ship laying FLAT (Z-Y swap) so the triangle is parallel to the
  // ground; rotate around X by -PI/2.
  body.rotation.x = -Math.PI / 2;

  // Cyan trim ring outlining the triangle — purely cosmetic.
  const trimGeo = new THREE.EdgesGeometry(geo);
  const trimMat = new THREE.LineBasicMaterial({
    color: 0x55ddff,
    transparent: true,
    opacity: 0.9,
  });
  const trim = new THREE.LineSegments(trimGeo, trimMat);
  trim.rotation.x = -Math.PI / 2;

  const group = new THREE.Group();
  group.add(body);
  group.add(trim);
  group.scale.setScalar(0.6);   // smaller so it doesn't dominate the camera
  return { group, body, trim };
}

// Aiming line — single thin line from ship to current target.
// We allocate a 2-vertex BufferGeometry once and update vertex positions
// per frame. mode = LineSegments avoids any line-drawing inconsistencies.
function _buildAimLine() {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const mat = new THREE.LineDashedMaterial({
    color: 0x55ddff,
    transparent: true,
    opacity: 0.45,
    dashSize: 0.6,
    gapSize: 0.4,
  });
  const line = new THREE.Line(geo, mat);
  line.computeLineDistances();
  line.frustumCulled = false;
  line.visible = false;
  return { line, geo, mat };
}

// Bullet pool — small white sphere with a cyan glow.
const BULLET_GEO = new THREE.SphereGeometry(0.12, 6, 6);
const _bulletMat = new THREE.MeshBasicMaterial({
  color: 0xeaffff,
  transparent: true,
  opacity: 0.95,
});

// Module state — only one ship can be active at a time.
let _ship = null;
let _aim = null;
const _bullets = [];

/**
 * Spawn the ship at the given XZ position. If a ship already exists
 * this is a no-op (idempotent so callers can spam this safely on
 * chapter start).
 */
export function spawnGalagaShip(initialX, initialZ) {
  if (_ship) return;
  const built = _buildShipMesh();
  built.group.position.set(initialX, SHIP_ALTITUDE, initialZ);
  scene.add(built.group);
  _ship = {
    group: built.group,
    body: built.body,
    trim: built.trim,
    fireCooldown: 0,
    targetBug: null,
    facingY: 0,             // current rotation around Y axis (heading)
  };
  _aim = _buildAimLine();
  scene.add(_aim.line);
}

/**
 * Despawn the ship + cleanup all bullets + hide aim line. Called
 * when chapter changes away from chapter 2.
 */
export function despawnGalagaShip() {
  if (_ship && _ship.group.parent) scene.remove(_ship.group);
  _ship = null;
  if (_aim && _aim.line.parent) scene.remove(_aim.line);
  _aim = null;
  for (const b of _bullets) {
    if (b.mesh.parent) scene.remove(b.mesh);
  }
  _bullets.length = 0;
}

/**
 * Find the nearest bug to a given position. Skips bugs in the
 * ASCENDING phase since they've already placed their tile and will
 * despawn momentarily. Returns null if no eligible bug.
 */
function _findNearestBug(x, z) {
  const bugs = getBugs();
  let best = null;
  let bestDist = Infinity;
  for (const bug of bugs) {
    if (bug.phase === 'ASCENDING') continue;
    const p = getBugPos(bug);
    if (!p) continue;
    const dx = p.x - x, dz = p.z - z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestDist) { bestDist = d2; best = bug; }
  }
  return best;
}

/**
 * Tick the ship: follow player, acquire/fire at bugs, update bullets.
 * Called from main.js per frame.
 */
export function updateGalagaShip(dt, playerPos) {
  // Always update bullets even if ship is gone (in-flight bullets
  // should land cleanly).
  _updateBullets(dt);
  if (!_ship) return;

  // FOLLOW PLAYER — exponential lerp toward (player.x, ALTITUDE, player.z).
  const targetX = playerPos.x;
  const targetZ = playerPos.z;
  const lerpFactor = 1 - Math.exp(-SHIP_FOLLOW_LERP * dt);
  _ship.group.position.x += (targetX - _ship.group.position.x) * lerpFactor;
  _ship.group.position.z += (targetZ - _ship.group.position.z) * lerpFactor;
  _ship.group.position.y = SHIP_ALTITUDE;

  // ACQUIRE TARGET — pick nearest bug each frame (cheap, <= 5 bugs).
  _ship.targetBug = _findNearestBug(_ship.group.position.x, _ship.group.position.z);

  // FACE TARGET — rotate ship's group.rotation.y so the nose points
  // at the bug. Smooth via shortest-arc lerp toward target heading.
  if (_ship.targetBug) {
    const bp = getBugPos(_ship.targetBug);
    const dx = bp.x - _ship.group.position.x;
    const dz = bp.z - _ship.group.position.z;
    const targetAngle = Math.atan2(dx, dz);
    // Shortest-arc: bring delta into [-PI, PI].
    let delta = targetAngle - _ship.facingY;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    _ship.facingY += delta * (1 - Math.exp(-8 * dt));
    _ship.group.rotation.y = _ship.facingY;
  }

  // AIMING LINE — show line from ship to target while target exists.
  if (_aim) {
    if (_ship.targetBug) {
      const bp = getBugPos(_ship.targetBug);
      const positions = _aim.geo.attributes.position.array;
      positions[0] = _ship.group.position.x;
      positions[1] = _ship.group.position.y;
      positions[2] = _ship.group.position.z;
      positions[3] = bp.x;
      positions[4] = bp.y;
      positions[5] = bp.z;
      _aim.geo.attributes.position.needsUpdate = true;
      _aim.line.computeLineDistances();
      _aim.line.visible = true;
    } else {
      _aim.line.visible = false;
    }
  }

  // FIRE — when cooldown expires AND we have a target.
  _ship.fireCooldown -= dt;
  if (_ship.targetBug && _ship.fireCooldown <= 0) {
    const bp = getBugPos(_ship.targetBug);
    _spawnBullet(_ship.group.position, bp);
    _ship.fireCooldown = SHIP_FIRE_COOLDOWN;
    try { Audio.galagaShipFire && Audio.galagaShipFire(); } catch (e) {}
  }
}

/**
 * Spawn a bullet from the ship aimed at the target's current position.
 * Bullet velocity is fixed at spawn (not homing) — keeps the targeting
 * mechanic readable: ship aims, fires, bug might dodge by moving.
 */
function _spawnBullet(fromPos, targetPos) {
  const dx = targetPos.x - fromPos.x;
  const dy = targetPos.y - fromPos.y;
  const dz = targetPos.z - fromPos.z;
  const len = Math.max(0.001, Math.sqrt(dx * dx + dy * dy + dz * dz));
  const vx = (dx / len) * BULLET_SPEED;
  const vy = (dy / len) * BULLET_SPEED;
  const vz = (dz / len) * BULLET_SPEED;
  const mesh = new THREE.Mesh(BULLET_GEO, _bulletMat);
  mesh.position.copy(fromPos);
  scene.add(mesh);
  _bullets.push({ mesh, vx, vy, vz, life: BULLET_LIFE });
}

/**
 * Update all in-flight bullets. Each frame:
 *   - Advance position by velocity * dt
 *   - Check collision with bugs (radius BULLET_HIT_RADIUS)
 *   - Despawn on hit, on bug-applied damage, or after BULLET_LIFE
 */
function _updateBullets(dt) {
  for (let i = _bullets.length - 1; i >= 0; i--) {
    const b = _bullets[i];
    b.mesh.position.x += b.vx * dt;
    b.mesh.position.y += b.vy * dt;
    b.mesh.position.z += b.vz * dt;
    b.life -= dt;
    if (b.life <= 0) {
      if (b.mesh.parent) scene.remove(b.mesh);
      _bullets.splice(i, 1);
      continue;
    }
    // Bug collision check
    const bugs = getBugs();
    let hit = false;
    for (const bug of bugs) {
      if (bug.phase === 'ASCENDING') continue;
      const p = getBugPos(bug);
      if (!p) continue;
      const dx = p.x - b.mesh.position.x;
      const dy = p.y - b.mesh.position.y;
      const dz = p.z - b.mesh.position.z;
      if (dx * dx + dy * dy + dz * dz < BULLET_HIT_RADIUS_SQ) {
        applyBugDamage(bug, 1);
        hit = true;
        break;
      }
    }
    if (hit) {
      if (b.mesh.parent) scene.remove(b.mesh);
      _bullets.splice(i, 1);
    }
  }
}

/** True if the ship is currently active. */
export function isGalagaShipActive() {
  return _ship != null;
}
