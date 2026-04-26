// hiveLasers.js — Chapter 2 wave 2 per-hive sky beams.
//
// At the climax of wave 2, after the pod has been charged, vertical
// laser beams descend from the sky and strike each surviving hive
// individually. This is the "soft warm-up" that telegraphs the
// incoming arena-wide blast which will destroy the hive shields.
//
// Each beam is a tall thin chapter-tinted cylinder positioned over
// a hive, pointing down. Y=40 (sky) to Y=0.5 (hive height).
// Phases:
//   idle    — no beams visible
//   ramp    — beams fade in over 0.3s (opacity 0 → 0.85, scale 0.5 → 1)
//   hold    — beams pulse for 1.5s at full intensity, slight bob
//   fade    — beams shrink + fade over 0.5s
//   done    — auto-cleared
//
// Public API:
//   spawnHiveLasers(chapterIdx, hivePositions) — array of {x, z}
//   updateHiveLasers(dt)
//   isHiveLasersActive()
//   isHiveLasersDone()
//   clearHiveLasers()

import * as THREE from 'three';
import { scene } from './scene.js';
import { CHAPTERS } from './config.js';
import { hitBurst } from './effects.js';

// Tunables
const BEAM_SKY_Y = 40;
const BEAM_RADIUS = 0.4;             // narrow vertical beam
const BEAM_HEIGHT = BEAM_SKY_Y;     // beam length top-to-floor
const RAMP_DURATION = 0.3;
const HOLD_DURATION = 1.5;
const FADE_DURATION = 0.5;

const BEAM_GEO = new THREE.CylinderGeometry(BEAM_RADIUS, BEAM_RADIUS, BEAM_HEIGHT, 12, 1, true);

let _beams = [];
let _phase = 'idle';
let _phaseT = 0;
let _tint = 0xffffff;

function _beamMat(tint) {
  return new THREE.MeshBasicMaterial({
    color: tint,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

/** Spawn a vertical sky beam over each hive position. Beams are
 *  invisible at first and ramp in via updateHiveLasers. */
export function spawnHiveLasers(chapterIdx, hivePositions) {
  clearHiveLasers();
  if (!hivePositions || !hivePositions.length) return;
  _tint = CHAPTERS[chapterIdx % CHAPTERS.length].full.grid1;
  _phase = 'ramp';
  _phaseT = 0;
  for (const p of hivePositions) {
    if (!p) continue;
    const mat = _beamMat(_tint);
    const beam = new THREE.Mesh(BEAM_GEO, mat);
    // Cylinder default axis is Y, so position center at half-height.
    beam.position.set(p.x, BEAM_SKY_Y / 2, p.z);
    scene.add(beam);
    _beams.push({ mesh: beam, mat, x: p.x, z: p.z, bobSeed: Math.random() * Math.PI * 2 });
  }
}

export function updateHiveLasers(dt) {
  if (_phase === 'idle') return;
  _phaseT += dt;

  if (_phase === 'ramp') {
    const f = Math.min(1, _phaseT / RAMP_DURATION);
    for (const b of _beams) {
      b.mat.opacity = 0.85 * f;
      const s = 0.5 + 0.5 * f;
      b.mesh.scale.set(s, 1, s);
    }
    if (f >= 1) {
      _phase = 'hold';
      _phaseT = 0;
      // Impact bursts at each hive when beams "land"
      for (const b of _beams) {
        try {
          for (let k = 0; k < 6; k++) {
            hitBurst(
              new THREE.Vector3(b.x + (Math.random() - 0.5) * 1.6, 1.0 + Math.random() * 0.6, b.z + (Math.random() - 0.5) * 1.6),
              _tint, 14,
            );
          }
        } catch (e) {}
      }
    }
  } else if (_phase === 'hold') {
    // Pulse + bob during hold
    for (const b of _beams) {
      b.bobSeed += dt * 6;
      const pulse = 0.85 + 0.10 * Math.sin(b.bobSeed);
      b.mat.opacity = pulse;
    }
    if (_phaseT >= HOLD_DURATION) {
      _phase = 'fade';
      _phaseT = 0;
    }
  } else if (_phase === 'fade') {
    const f = Math.min(1, _phaseT / FADE_DURATION);
    for (const b of _beams) {
      b.mat.opacity = 0.85 * (1 - f);
      const s = 1 - f * 0.6;
      b.mesh.scale.set(s, 1, s);
    }
    if (f >= 1) {
      _phase = 'done';
      _phaseT = 0;
    }
  }
}

export function isHiveLasersActive() {
  return _phase === 'ramp' || _phase === 'hold' || _phase === 'fade';
}

export function isHiveLasersDone() {
  return _phase === 'done';
}

export function clearHiveLasers() {
  for (const b of _beams) {
    if (b.mesh && b.mesh.parent) scene.remove(b.mesh);
    if (b.mat && b.mat.dispose) b.mat.dispose();
  }
  _beams = [];
  _phase = 'idle';
  _phaseT = 0;
}
