// cockroachBoss.js — Chapter 2 wave 3 dual-roach boss.
//
// Two giant cockroaches each carry 2 of the existing chapter-2 hive
// portals as their wings. The hives were spawned by the standard
// chapter prep (in dormantProps.js → spawnAllPortals) and have been
// shieldless since the wave-2 laser blast dropped all hive shields.
// On wave 3 init we DON'T spawn new hives — we re-purpose the existing
// 4 hives by pairing them and parenting each pair onto a roach's back.
//
// Visual:
//   Per-roach floor decal (flat planes at Y ≈ 0.04):
//     - Body oval (5u × 14u)
//     - Head oval at +Z front
//     - 2 antennae extending forward
//     - 6 legs (3 per side, splayed)
//     - Chapter-tinted body rim glow
//   Hives sit slightly above the floor on the roach's "wings" (left and
//   right of body axis) and follow the roach as it moves.
//
// Behavior:
//   - Each roach is stationary while its 2 hives are alive
//   - When a roach's 2 hives both die: that roach starts a short
//     crawl (~3s) then fades out into the tiles
//   - Each roach is independent — one can be fading while the other is
//     still being attacked
//   - Wave ends when BOTH roaches are done fading
//
// Public API:
//   spawnCockroachBoss(chapterIdx)
//   updateCockroach(dt)
//   isCockroachDeadAndDone()
//   getCockroachHives()
//   hasCockroach()
//   clearCockroachBoss()

import * as THREE from 'three';
import { scene } from './scene.js';
import { CHAPTERS } from './config.js';
import { hitBurst } from './effects.js';
import { spawners } from './spawners.js';

// ---- Tunables ----
const ROACH_SHORT_CRAWL_DURATION = 3.0;   // seconds of crawling before fade
const ROACH_CRAWL_SPEED = 1.5;            // u/s during crawl phase
const ROACH_TURN_RADIUS = 8.0;            // tight orbit radius during crawl
const FADE_DURATION = 2.5;                // seconds for decal fade-out

// Hive offsets in roach-local space — symmetric wing pair
//   +X = right wing, -X = left wing
//   Z = 0 (centered along body axis)
const HIVE_LOCAL_OFFSETS = [
  { x: -4.5, z: 0.0 },     // left wing
  { x:  4.5, z: 0.0 },     // right wing
];

// ---- Geometry (shared across both roaches) ----
const BODY_GEO    = new THREE.PlaneGeometry(5.0, 14.0);
const HEAD_GEO    = new THREE.PlaneGeometry(3.5, 3.0);
const ANTENNA_GEO = new THREE.PlaneGeometry(0.18, 4.0);
const LEG_GEO     = new THREE.PlaneGeometry(0.45, 5.5);
const BODY_RIM_GEO = new THREE.RingGeometry(2.4, 2.55, 24);
const SEGMENT_GEO = new THREE.PlaneGeometry(4.6, 0.18);

// ---- Materials (factory functions; each roach owns its own clones) ----
function _bodyMat() {
  return new THREE.MeshBasicMaterial({
    color: 0x0d0e10, transparent: true, opacity: 0.85,
    side: THREE.DoubleSide, depthWrite: false,
  });
}
function _bodyEdgeMat(tint) {
  return new THREE.MeshBasicMaterial({
    color: tint, transparent: true, opacity: 0.55,
    side: THREE.DoubleSide, depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}
function _legMat() {
  return new THREE.MeshBasicMaterial({
    color: 0x080a0c, transparent: true, opacity: 0.75,
    side: THREE.DoubleSide, depthWrite: false,
  });
}
function _antennaMat(tint) {
  return new THREE.MeshBasicMaterial({
    color: tint, transparent: true, opacity: 0.6,
    side: THREE.DoubleSide, depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

// ---- Module state ----
let _roaches = [];        // array of roach instances

/**
 * Build a single roach floor-decal mesh group at the origin of its
 * local coordinate space. Returns { group, fadeMats } so callers can
 * drive opacity later.
 */
function _buildRoachMesh(tint) {
  const group = new THREE.Group();
  const fadeMats = [];

  // --- BODY (long oval — main thorax/abdomen) ---
  const bodyMat = _bodyMat();
  const body = new THREE.Mesh(BODY_GEO, bodyMat);
  body.rotation.x = -Math.PI / 2;
  group.add(body);
  fadeMats.push(bodyMat);

  // Body rim — chapter-tinted glow ring around the abdomen
  const rimMat = _bodyEdgeMat(tint);
  const rim = new THREE.Mesh(BODY_RIM_GEO, rimMat);
  rim.rotation.x = -Math.PI / 2;
  rim.position.set(0, 0.001, -2.5);
  rim.scale.set(1.0, 1.0, 2.4);
  group.add(rim);
  fadeMats.push(rimMat);

  // Body segment lines
  for (let i = 0; i < 3; i++) {
    const segMat = _bodyMat();
    const seg = new THREE.Mesh(SEGMENT_GEO, segMat);
    seg.rotation.x = -Math.PI / 2;
    seg.position.set(0, 0.005, -3.5 + i * 1.6);
    group.add(seg);
    fadeMats.push(segMat);
  }

  // --- HEAD (smaller oval at front +Z) ---
  const headMat = _bodyMat();
  const head = new THREE.Mesh(HEAD_GEO, headMat);
  head.rotation.x = -Math.PI / 2;
  head.position.set(0, 0.003, 7.5);
  group.add(head);
  fadeMats.push(headMat);

  // --- ANTENNAE (2 thin lines extending forward) ---
  const ant1Mat = _antennaMat(tint);
  const ant1 = new THREE.Mesh(ANTENNA_GEO, ant1Mat);
  ant1.rotation.x = -Math.PI / 2;
  ant1.rotation.z = 0.3;
  ant1.position.set(-0.7, 0.005, 10.5);
  group.add(ant1);
  fadeMats.push(ant1Mat);

  const ant2Mat = _antennaMat(tint);
  const ant2 = new THREE.Mesh(ANTENNA_GEO, ant2Mat);
  ant2.rotation.x = -Math.PI / 2;
  ant2.rotation.z = -0.3;
  ant2.position.set(0.7, 0.005, 10.5);
  group.add(ant2);
  fadeMats.push(ant2Mat);

  // --- LEGS (6 legs, 3 per side) ---
  const legZs = [3.5, 0.5, -3.0];
  const splayAngles = [Math.PI / 6, 0, -Math.PI / 6];
  for (let i = 0; i < 3; i++) {
    const z = legZs[i];
    const splay = splayAngles[i];

    const legLMat = _legMat();
    const legL = new THREE.Mesh(LEG_GEO, legLMat);
    legL.rotation.x = -Math.PI / 2;
    legL.rotation.z = Math.PI / 2 + splay;
    legL.position.set(-3.2, 0.002, z);
    group.add(legL);
    fadeMats.push(legLMat);

    const legRMat = _legMat();
    const legR = new THREE.Mesh(LEG_GEO, legRMat);
    legR.rotation.x = -Math.PI / 2;
    legR.rotation.z = -Math.PI / 2 - splay;
    legR.position.set(3.2, 0.002, z);
    group.add(legR);
    fadeMats.push(legRMat);
  }

  return { group, fadeMats };
}

/**
 * Pair the 4 chapter-2 hives by spatial halves. Sort by X — the
 * leftmost 2 become roach A's wings, the rightmost 2 become roach B's.
 * If there are fewer than 4 live hives, pair what's available.
 */
function _pairHivesByX(liveHives) {
  if (liveHives.length === 0) return [];
  const sorted = [...liveHives].sort((a, b) => {
    const ax = a.pos ? a.pos.x : 0;
    const bx = b.pos ? b.pos.x : 0;
    return ax - bx;
  });
  if (sorted.length === 1) return [[sorted[0]]];
  if (sorted.length === 2) return [sorted];
  if (sorted.length === 3) return [[sorted[0], sorted[1]], [sorted[2]]];
  // 4 hives — split in half
  return [
    [sorted[0], sorted[1]],
    [sorted[2], sorted[3]],
  ];
}

/**
 * Build the dual-roach boss. Reads existing hives from spawners[],
 * pairs them by spatial halves, and creates a roach for each pair.
 * Re-positions each pair's hives to sit on the roach's wings.
 */
export function spawnCockroachBoss(chapterIdx) {
  if (_roaches && _roaches.length) clearCockroachBoss();
  const tint = CHAPTERS[chapterIdx % CHAPTERS.length].full.grid1;

  // Collect live hives from spawners (chapter-2 already populated)
  const liveHives = [];
  for (const s of spawners) {
    if (!s) continue;
    if (s.destroyed) continue;
    if ((s.hp || 0) <= 0) continue;
    liveHives.push(s);
  }
  if (liveHives.length === 0) {
    // No hives to pair — wave will end immediately. Nothing to build.
    return null;
  }

  // Pair hives spatially
  const pairs = _pairHivesByX(liveHives);

  _roaches = [];
  for (const pair of pairs) {
    // Compute pair midpoint as the roach center
    let mx = 0, mz = 0;
    for (const h of pair) {
      mx += h.pos ? h.pos.x : 0;
      mz += h.pos ? h.pos.z : 0;
    }
    mx /= pair.length;
    mz /= pair.length;
    // Roach center = hive pair midpoint. Hives don't teleport — the
    // roach appears directly beneath them as the laser-fried shields
    // drop. Per spec: "we see the two corresponding roaches underneath."
    const cx = mx;
    const cz = mz;

    const built = _buildRoachMesh(tint);
    built.group.position.set(cx, 0.04, cz);
    // Yaw — face away from arena center so the head points outward
    const facingAng = Math.atan2(mx - cx, mz - cz);
    built.group.rotation.y = facingAng;
    scene.add(built.group);

    // Reposition the 2 (or fewer) hives onto the wing offsets.
    const hiveBindings = [];
    for (let i = 0; i < pair.length; i++) {
      const h = pair[i];
      h.kind = 'roach-wing';
      h.shielded = false;
      const off = HIVE_LOCAL_OFFSETS[i] || HIVE_LOCAL_OFFSETS[0];
      hiveBindings.push({ portal: h, localOffset: off });
      // Float the hive slightly above the floor so it reads as "sitting on roach back"
      if (h.obj) {
        h.obj.position.y = (h.obj.position.y || 0) + 0.4;
      }
    }

    _roaches.push({
      group: built.group,
      fadeMats: built.fadeMats,
      hives: hiveBindings,
      tint,
      yaw: facingAng,
      crawlAngle: Math.random() * Math.PI * 2,
      orbitCenterX: cx,
      orbitCenterZ: cz,
      crawling: false,
      crawlT: 0,
      fadeStartT: -1,
      fadeT: 0,
      done: false,
      legBobT: Math.random() * Math.PI * 2,
    });
  }

  return _roaches;
}

/** Count surviving hives for a given roach. */
function _liveHiveCountFor(roach) {
  let n = 0;
  for (const h of roach.hives) {
    const p = h.portal;
    if (p && !p.destroyed && (p.hp || 0) > 0) n++;
  }
  return n;
}

/** Returns the roach's hive portals (for wave-end checks across all roaches). */
export function getCockroachHives() {
  if (!_roaches || !_roaches.length) return [];
  const out = [];
  for (const r of _roaches) {
    for (const h of r.hives) {
      if (h.portal) out.push(h.portal);
    }
  }
  return out;
}

/** True when ALL roaches have completed their fade-out. Caller can endWave. */
export function isCockroachDeadAndDone() {
  if (!_roaches || !_roaches.length) return true;
  for (const r of _roaches) {
    if (!r.done) return false;
  }
  return true;
}

/** True if any roach instance still exists (visible or fading). */
export function hasCockroach() {
  return !!(_roaches && _roaches.length);
}

/** Per-frame update — animate each roach independently. Hives reposition
 *  to follow their roach's body. */
export function updateCockroach(dt) {
  if (!_roaches || !_roaches.length) return;

  for (const roach of _roaches) {
    roach.legBobT += dt * 1.5;

    const hivesAlive = _liveHiveCountFor(roach);
    const allDeadForThisRoach = hivesAlive === 0;

    if (allDeadForThisRoach && !roach.crawling && roach.fadeStartT < 0) {
      // This roach's hives just died — start short crawl
      roach.crawling = true;
      // Initial body burst — chapter-tinted dust to signal "this roach falling"
      try {
        for (let k = 0; k < 10; k++) {
          hitBurst(
            new THREE.Vector3(
              roach.group.position.x + (Math.random() - 0.5) * 7.0,
              0.4 + Math.random() * 0.5,
              roach.group.position.z + (Math.random() - 0.5) * 7.0,
            ),
            roach.tint, 10,
          );
        }
      } catch (e) {}
    }

    // Movement: tight circular crawl around this roach's spawn point
    if (roach.crawling && roach.fadeStartT < 0) {
      roach.crawlT += dt;
      const angularSpeed = ROACH_CRAWL_SPEED / ROACH_TURN_RADIUS;
      roach.crawlAngle += angularSpeed * dt;
      const newX = roach.orbitCenterX + Math.cos(roach.crawlAngle) * ROACH_TURN_RADIUS;
      const newZ = roach.orbitCenterZ + Math.sin(roach.crawlAngle) * ROACH_TURN_RADIUS;
      const tx = -Math.sin(roach.crawlAngle);
      const tz =  Math.cos(roach.crawlAngle);
      roach.yaw = Math.atan2(tx, tz);
      roach.group.position.x = newX;
      roach.group.position.z = newZ;
      roach.group.rotation.y = roach.yaw;

      if (roach.crawlT > ROACH_SHORT_CRAWL_DURATION) {
        roach.fadeStartT = 0;
      }
    }

    // Fade phase
    if (roach.fadeStartT >= 0) {
      roach.fadeStartT += dt;
      const f = Math.min(1, roach.fadeStartT / FADE_DURATION);
      const opacityMul = 1 - f;
      for (const m of roach.fadeMats) {
        if (m._origOpacity === undefined) m._origOpacity = m.opacity;
        m.opacity = m._origOpacity * opacityMul;
      }
      if (f >= 1 && !roach.done) {
        roach.done = true;
      }
    }

    // Reposition hives to follow this roach's body
    const yaw = roach.group.rotation.y;
    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);
    const cx = roach.group.position.x;
    const cz = roach.group.position.z;
    for (const h of roach.hives) {
      const off = h.localOffset;
      const wx = cx + off.x * cosY + off.z * sinY;
      const wz = cz - off.x * sinY + off.z * cosY;
      if (h.portal && !h.portal.destroyed) {
        if (h.portal.pos) {
          h.portal.pos.x = wx;
          h.portal.pos.z = wz;
        }
        if (h.portal.obj) {
          h.portal.obj.position.x = wx;
          h.portal.obj.position.z = wz;
        }
      }
    }
  }
}

export function clearCockroachBoss() {
  if (!_roaches || !_roaches.length) return;
  for (const roach of _roaches) {
    if (roach.group && roach.group.parent) scene.remove(roach.group);
    for (const m of roach.fadeMats) {
      if (m && m.dispose) m.dispose();
    }
  }
  _roaches = [];
}
