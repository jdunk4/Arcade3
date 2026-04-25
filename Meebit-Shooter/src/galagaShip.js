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

// Ship sprite — pixel-art rendering of the classic Galaga player ship.
// Drawn to a small canvas with crisp NEAREST-filtered scaling so the
// sprite reads as authentic 2D pixel art when rendered on a flat plane
// at altitude. Color palette matches the original arcade:
//   - White fuselage + wing tips
//   - Red wing body (the "Galaga red")
//   - Blue cockpit dot
//   - Black detail outline
//
// Approach: 32x32 pixel grid. We use fillRect on individual pixels to
// build the sprite, top-down view (ship pointing UP in canvas space).
// On the flat plane in the scene this becomes "nose pointing forward."

const SHIP_SPRITE_SIZE = 1.8;       // world units — slightly bigger than bugs

function _buildShipCanvas() {
  const PX = 32;             // logical pixel grid
  const SCALE = 4;            // canvas px per logical px (128x128 final)
  const canvas = document.createElement('canvas');
  canvas.width = PX * SCALE;
  canvas.height = PX * SCALE;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Helper to set a single logical pixel.
  function px(x, y, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x * SCALE, y * SCALE, SCALE, SCALE);
  }
  // Helper to fill a rectangle of logical pixels.
  function rect(x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x * SCALE, y * SCALE, w * SCALE, h * SCALE);
  }

  const W = '#f8f8f8';   // white
  const R = '#ee2030';   // red
  const B = '#3060f0';   // blue
  const K = '#000000';   // black outline

  // Body — vertical fuselage spire from top (nose) to mid (cockpit).
  // Centered at x=15-16. Symmetric design.
  // Nose tip (single pixel)
  px(15, 5, W); px(16, 5, W);
  // Fuselage column (rows 6-12)
  rect(14, 6, 4, 7, W);
  // Black outline along fuselage edges
  px(13, 6, K); px(18, 6, K);
  px(13, 7, K); px(18, 7, K);
  px(13, 8, K); px(18, 8, K);
  px(13, 9, K); px(18, 9, K);
  px(13, 10, K); px(18, 10, K);
  px(13, 11, K); px(18, 11, K);
  px(13, 12, K); px(18, 12, K);
  // Black nose outline
  px(14, 4, K); px(15, 4, K); px(16, 4, K); px(17, 4, K);
  px(14, 5, K); px(17, 5, K);

  // Cockpit — blue square in the middle of the fuselage
  rect(14, 9, 4, 2, B);
  // Cockpit outline
  px(14, 9, K); px(17, 9, K);
  px(14, 10, K); px(17, 10, K);

  // Wings — left + right red triangular wings extending from row 9-15
  // Left wing
  rect(7, 12, 7, 3, R);
  // Right wing (mirror)
  rect(18, 12, 7, 3, R);
  // White wing tips (outermost)
  rect(5, 13, 2, 2, W);
  rect(25, 13, 2, 2, W);
  // Wing outlines
  // Left wing top edge
  for (let x = 7; x <= 13; x++) px(x, 11, K);
  // Right wing top edge
  for (let x = 18; x <= 24; x++) px(x, 11, K);
  // Wing bottoms
  for (let x = 7; x <= 13; x++) px(x, 15, K);
  for (let x = 18; x <= 24; x++) px(x, 15, K);
  // Wing tips outlines
  px(5, 12, K); px(6, 12, K);
  px(4, 13, K); px(7, 13, K);
  px(4, 14, K); px(7, 14, K);
  px(5, 15, K); px(6, 15, K);
  px(25, 12, K); px(26, 12, K);
  px(24, 13, K); px(27, 13, K);
  px(24, 14, K); px(27, 14, K);
  px(25, 15, K); px(26, 15, K);

  // Tail — small red flares at bottom
  rect(13, 14, 2, 4, R);
  rect(17, 14, 2, 4, R);
  // Tail outlines
  px(12, 14, K); px(15, 14, K);
  px(12, 15, K); px(15, 15, K);
  px(12, 16, K); px(15, 16, K);
  px(12, 17, K); px(13, 18, K); px(14, 18, K);
  px(16, 14, K); px(19, 14, K);
  px(16, 15, K); px(19, 15, K);
  px(16, 16, K); px(19, 16, K);
  px(19, 17, K); px(17, 18, K); px(18, 18, K);

  return canvas;
}

const _shipPlaneGeo = new THREE.PlaneGeometry(SHIP_SPRITE_SIZE, SHIP_SPRITE_SIZE);
let _shipTextureCache = null;
function _getShipTexture() {
  if (_shipTextureCache) return _shipTextureCache;
  const canvas = _buildShipCanvas();
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  _shipTextureCache = tex;
  return tex;
}

function _buildShipMesh() {
  const mat = new THREE.MeshBasicMaterial({
    map: _getShipTexture(),
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(_shipPlaneGeo, mat);
  // Lay flat — sprite faces up so camera (looking down) sees it.
  mesh.rotation.x = -Math.PI / 2;
  // Wrap in a group so callers can set group.rotation.y to spin the
  // ship's heading without conflicting with the lay-flat rotation
  // applied to the mesh itself.
  const group = new THREE.Group();
  group.add(mesh);
  return { group, body: mesh, trim: null };
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
}

/**
 * Despawn the ship + cleanup all bullets + hide aim line. Called
 * when chapter changes away from chapter 2.
 */
export function despawnGalagaShip() {
  if (_ship && _ship.group.parent) scene.remove(_ship.group);
  _ship = null;
  for (const b of _bullets) {
    if (b.mesh.parent) scene.remove(b.mesh);
  }
  _bullets.length = 0;
}

/**
 * Trigger fly-away exit animation. Called at end of wave 3 (chapter 2)
 * so the chapter mascot peaces out before the boss/bonus waves rather
 * than just disappearing. Ship picks a direction toward the nearest
 * arena edge, accelerates that way at boosted speed, fades opacity to
 * zero over EXIT_DURATION seconds, then despawns.
 *
 * Idempotent — calling it twice in a row only triggers once.
 */
export function flyAwayGalagaShip() {
  if (!_ship || _ship.exitMode) return;
  _ship.exitMode = true;
  _ship.exitTimer = 0;
  // Pick exit direction: away from current position toward the nearest
  // arena edge. With ARENA=50 the edges are at ±50, so pick the largest
  // component to determine which axis to exit along.
  const px = _ship.group.position.x;
  const pz = _ship.group.position.z;
  if (Math.abs(px) > Math.abs(pz)) {
    _ship.exitDirX = Math.sign(px) || 1;
    _ship.exitDirZ = 0;
  } else {
    _ship.exitDirX = 0;
    _ship.exitDirZ = Math.sign(pz) || 1;
  }
  // Mark material transparent so opacity fade works.
  if (_ship.body && _ship.body.material) {
    _ship.body.material.transparent = true;
  }
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

  // EXIT MODE — ship is flying away to despawn. Override the normal
  // player-follow / target / fire behavior. Fly toward arena edge at
  // EXIT_SPEED, fade opacity to zero, then despawn cleanly.
  if (_ship.exitMode) {
    const EXIT_DURATION = 1.6;       // total time before despawn
    const EXIT_SPEED = 32;           // u/sec — well above normal follow speed
    _ship.exitTimer += dt;
    _ship.group.position.x += _ship.exitDirX * EXIT_SPEED * dt;
    _ship.group.position.z += _ship.exitDirZ * EXIT_SPEED * dt;
    // Climb slightly as ship escapes the arena (looks cooler than
    // pure horizontal flight).
    _ship.group.position.y = SHIP_ALTITUDE + _ship.exitTimer * 4;
    // Rotate ship's nose toward exit direction
    if (_ship.exitDirX !== 0 || _ship.exitDirZ !== 0) {
      const exitYaw = Math.atan2(_ship.exitDirX, _ship.exitDirZ);
      _ship.group.rotation.y = exitYaw;
    }
    // Fade opacity over EXIT_DURATION
    const fadeOpacity = Math.max(0, 1 - _ship.exitTimer / EXIT_DURATION);
    if (_ship.body && _ship.body.material) {
      _ship.body.material.opacity = fadeOpacity;
    }
    if (_ship.exitTimer >= EXIT_DURATION) {
      despawnGalagaShip();
    }
    return;
  }

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
