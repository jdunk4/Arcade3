// slimeMelt.js — Death animation for wasp-nest hives. The hive sags
// downward and outward, its papery material shifts to a glossy
// chapter-tinted slime, then collapses into a flat puddle on the
// ground that fades away.
//
// Replaces the standard scale-down + spin collapse for spawners with
// structureType==='hive' (wasp-nest). UFOs and pyramids have their
// own destruction sequences (mushroom cloud, takeoff respectively).
//
// Visual phases (per-hive timer, ~2.4s total):
//   PHASE A  0.00 – 1.20s   SAG       — nestBody Y-scale 1.0 → 0.0,
//                                       X/Z-scale 1.0 → 1.5. Eggs/caps
//                                       get absorbed (Y-scale to 0).
//                                       nestMat color lerps to tint,
//                                       emissive climbs, roughness
//                                       drops, metalness rises so the
//                                       surface reads as glossy slime.
//                                       Body sinks slightly into the
//                                       ground (-0.05u/sec) so the
//                                       puddle reads as flush with
//                                       the floor.
//   PHASE B  1.20 – 2.40s   PUDDLE    — body removed. A flat slime
//                                       disc grows briefly to peak
//                                       size, holds, then fades to 0
//                                       opacity. The disc is glossy,
//                                       chapter-tinted, with a wobbly
//                                       breathing ripple.
//
// Public API:
//   startHiveMelt(spawner)   — initiate melt; spawner.obj.userData._melting = true
//   tickHiveMelts(dt)        — advance all active melts; remove finished
//   clearHiveMelts()         — tear down all (level reset)

import * as THREE from 'three';
import { scene } from './scene.js';

// ---- TUNABLES ----
const PHASE_A_DUR = 1.20;     // seconds the sag takes
const PHASE_B_DUR = 1.20;     // seconds the puddle lingers + fades
const TOTAL_DUR   = PHASE_A_DUR + PHASE_B_DUR;
// How far horizontally the body spreads as it sags. 1.0 = no spread,
// 1.5 = spreads to 150% width. Reads as the slime "puddling" outward.
const SPREAD_MAX  = 1.55;
// How far into the ground the body sinks during sag. Negative = down.
const SINK_DEPTH  = -0.4;

// Active melts list — caller-agnostic, ticked by tickHiveMelts(dt).
const _activeMelts = [];

// Shared puddle geometry — a thin disc. One geometry, many puddles.
// Slightly subdivided radial segments so the breathing ripple reads
// without being polygonal.
const _PUDDLE_GEO = new THREE.CylinderGeometry(2.1, 2.1, 0.08, 28);

/**
 * Start a slime melt on the given hive spawner. The spawner's
 * destroyed flag must already be set by the caller (destroySpawner
 * in spawners.js does this). We take over the per-frame animation
 * of nestBody and its material until the melt completes.
 *
 * @param {object} spawner Spawner record (from spawnPortal); needs:
 *                         - obj      (THREE.Group, outer)
 *                         - nestBody (THREE.Group, inner — the sagging dome)
 *                         - nestMat  (material to mutate during sag)
 *                         - eggs     (array of egg meshes to absorb)
 *                         - tint     (chapter color hex)
 *                         - pos      (world position)
 */
export function startHiveMelt(spawner) {
  if (!spawner) return;
  // Snapshot the original material parameters so we can drive smooth
  // transitions (and so a future cleanup could restore them — though
  // since the hive dies, restoration isn't strictly required).
  const m = spawner.nestMat;
  const initial = {
    color: m && m.color ? m.color.getHex() : 0xffffff,
    emissive: m && m.emissive ? m.emissive.getHex() : 0x000000,
    emissiveIntensity: m ? (m.emissiveIntensity || 0) : 0,
    roughness: m ? (m.roughness != null ? m.roughness : 1.0) : 1.0,
    metalness: m ? (m.metalness != null ? m.metalness : 0.0) : 0.0,
  };

  // Build the slime puddle now (invisible until phase B). Two layers:
  //   floor: glossy chapter-tinted disc with metalness → reflects
  //          ambient like a wet surface.
  //   sheen: brighter additive overlay for the highlight rim.
  const tintColor = new THREE.Color(spawner.tint);
  const puddleMat = new THREE.MeshStandardMaterial({
    color: tintColor,
    emissive: tintColor,
    emissiveIntensity: 1.4,
    roughness: 0.10,                // glossy
    metalness: 0.55,                // wet-look reflection
    transparent: true,
    opacity: 0.0,                   // ramps in during phase B
    depthWrite: false,
  });
  const puddle = new THREE.Mesh(_PUDDLE_GEO, puddleMat);
  // Place puddle at hive base, in world space (not parented to obj
  // so the obj-removal during phase B doesn't take the puddle with it).
  puddle.position.set(spawner.pos.x, 0.04, spawner.pos.z);
  puddle.scale.setScalar(0.2);     // starts small, grows to full size
  scene.add(puddle);

  // Sheen overlay — a slightly larger, additive-blended disc on top
  // of the puddle for the wet highlight. Sized so its rim creates a
  // bright halo just outside the main puddle.
  const sheenMat = new THREE.MeshBasicMaterial({
    color: tintColor,
    transparent: true,
    opacity: 0.0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const sheen = new THREE.Mesh(_PUDDLE_GEO, sheenMat);
  sheen.position.set(spawner.pos.x, 0.06, spawner.pos.z);
  sheen.scale.set(0.2, 0.5, 0.2);  // thinner Y so the additive layer reads as a glow ring
  scene.add(sheen);

  // Cache the egg list — we want to absorb eggs into the goop as the
  // body sags. Capture initial Y so the absorption looks like they
  // sink, not get squished from above.
  const eggSnapshots = [];
  if (spawner.eggs) {
    for (const e of spawner.eggs) {
      // Skip eggs already detached/popped (parent is the hive's body
      // group; once .parent is null they've been removed).
      if (!e || !e.parent) continue;
      eggSnapshots.push({
        mesh: e,
        y0: e.position.y,
        // Capture original scale (eggs may have been mid-pulse-pop,
        // so scale isn't necessarily 1.0).
        s0: e.scale.x,
        // Material: lerp eggs to slime-tint as they sink, so they
        // visibly dissolve rather than just shrink.
        mat: e.material,
        matInitial: e.material ? {
          color: e.material.color ? e.material.color.getHex() : 0xffffff,
          opacity: e.material.opacity != null ? e.material.opacity : 1.0,
        } : null,
      });
    }
  }

  // Same for caps — they're parented as siblings in nestBody, not
  // children of the egg, so we walk them via egg.userData.cap.
  const capSnapshots = [];
  if (spawner.eggs) {
    for (const e of spawner.eggs) {
      const cap = e && e.userData && e.userData.cap;
      if (!cap || !cap.parent) continue;
      capSnapshots.push({
        mesh: cap,
        y0: cap.position.y,
        s0: cap.scale.x,
      });
    }
  }

  const melt = {
    spawner,
    t: 0,
    initial,
    tintColor,
    puddle, puddleMat,
    sheen, sheenMat,
    eggSnapshots,
    capSnapshots,
    bodyRemoved: false,    // flag once we've removed the obj from scene
  };
  _activeMelts.push(melt);
}

// Smoothstep helper — eases scale + opacity ramps cleanly.
function _smooth(t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * (3 - 2 * t);
}

/**
 * Per-frame tick. Walks the active melts list, advances each through
 * its phase curves, removes finished melts.
 */
export function tickHiveMelts(dt) {
  for (let i = _activeMelts.length - 1; i >= 0; i--) {
    const m = _activeMelts[i];
    m.t += dt;
    const t = m.t;

    if (t >= TOTAL_DUR) {
      _disposeMelt(m);
      _activeMelts.splice(i, 1);
      continue;
    }

    const sp = m.spawner;

    // ---- PHASE A — SAG (0..PHASE_A_DUR) ----
    if (t < PHASE_A_DUR) {
      const f = _smooth(t / PHASE_A_DUR);

      if (sp.nestBody) {
        // Y squishes down to 0; X/Z spread outward.
        const ySq = 1.0 - f;
        const xzSq = 1.0 + (SPREAD_MAX - 1.0) * f;
        sp.nestBody.scale.set(xzSq, ySq, xzSq);
        // Sink slightly into the ground so the bottom of the spread
        // doesn't perch above floor level when the dome is mostly flat.
        sp.nestBody.position.y = 0.2 + SINK_DEPTH * f;
        // Kill the wobble rotations the standard sway code may have
        // left in. (updateSpawners early-returns for destroyed
        // spawners so it shouldn't be writing them, but the residual
        // tilt from the moment of death looks weird as the body sags
        // — zero it out so the puddle reads as flat.)
        sp.nestBody.rotation.x *= (1 - f);
        sp.nestBody.rotation.z *= (1 - f);
      }

      // Material melt — paper goes glossy, color lerps to chapter tint.
      const mat = sp.nestMat;
      if (mat) {
        // Color: lerp from initial paper tone toward chapter tint.
        const init = m.initial;
        const initCol = _scratchCol1.setHex(init.color);
        mat.color.copy(initCol).lerp(m.tintColor, f * 0.85);
        // Emissive: also lerp toward tint, intensity climbs.
        if (mat.emissive) {
          const initEm = _scratchCol2.setHex(init.emissive);
          mat.emissive.copy(initEm).lerp(m.tintColor, f);
          mat.emissiveIntensity = init.emissiveIntensity + f * 1.6;
        }
        // Surface params shift toward wet/glossy.
        if (mat.roughness != null) {
          mat.roughness = init.roughness + (0.15 - init.roughness) * f;
        }
        if (mat.metalness != null) {
          mat.metalness = init.metalness + (0.50 - init.metalness) * f;
        }
      }

      // Absorb eggs — sink + fade as the body sags.
      for (const es of m.eggSnapshots) {
        if (!es.mesh.parent) continue;     // already removed by pop animation
        // Sink Y toward 0, scale Y to 0 first then X/Z. Reads as
        // dissolving into the goop rather than shrinking uniformly.
        es.mesh.position.y = es.y0 * (1 - f);
        const ys = (1 - f);
        const xzs = es.s0 * (1 - f * 0.7);
        es.mesh.scale.set(xzs, es.s0 * ys, xzs);
        // Fade the egg's emissive/opacity so it visually melts.
        if (es.mat && es.matInitial) {
          if (es.mat.opacity != null) {
            es.mat.opacity = es.matInitial.opacity * (1 - f);
          }
          if (es.mat.color) {
            const ic = _scratchCol3.setHex(es.matInitial.color);
            es.mat.color.copy(ic).lerp(m.tintColor, f);
          }
        }
      }
      // Caps — same treatment, shrink + sink as everything dissolves.
      for (const cs of m.capSnapshots) {
        if (!cs.mesh.parent) continue;
        cs.mesh.position.y = cs.y0 * (1 - f);
        const ys = (1 - f);
        cs.mesh.scale.set(cs.s0 * (1 - f * 0.7), cs.s0 * ys, cs.s0 * (1 - f * 0.7));
      }

      // Puddle starts forming during the second half of phase A —
      // begins ramping in opacity + scale before the body finishes
      // sagging, so the transition to phase B is seamless.
      if (f > 0.5) {
        const pf = (f - 0.5) / 0.5;       // 0..1 over the back half of phase A
        m.puddleMat.opacity = pf * 0.85;
        const ps = 0.2 + pf * 0.8;        // 0.2 → 1.0
        m.puddle.scale.set(ps, 1, ps);
        m.sheenMat.opacity = pf * 0.40;
        m.sheen.scale.set(ps * 1.05, 0.5, ps * 1.05);
      }
    }
    // ---- PHASE B — PUDDLE (PHASE_A_DUR..TOTAL_DUR) ----
    else {
      // Body cleanup — remove obj from scene the moment phase B starts.
      if (!m.bodyRemoved) {
        if (sp.obj && sp.obj.parent) scene.remove(sp.obj);
        m.bodyRemoved = true;
      }

      const bt = (t - PHASE_A_DUR) / PHASE_B_DUR;     // 0..1 across phase B
      // Puddle peaks slightly larger then settles + fades.
      // Scale curve: 1.0 → 1.15 → 0.95 (sigmoid-ish via two smooths)
      let ps;
      if (bt < 0.25) {
        ps = 1.0 + _smooth(bt / 0.25) * 0.15;
      } else {
        ps = 1.15 - (bt - 0.25) / 0.75 * 0.20;
      }
      m.puddle.scale.set(ps, 1, ps);
      m.sheen.scale.set(ps * 1.05, 0.5, ps * 1.05);

      // Subtle breathing ripple — small Y-scale + emissive pulse so
      // the puddle reads as alive/oozing for a moment before fading.
      const rip = Math.sin(t * 6.0) * 0.5 + 0.5;
      m.puddle.scale.y = 1.0 + rip * 0.15;
      m.puddleMat.emissiveIntensity = 1.4 + rip * 0.5;

      // Opacity: holds for first half of phase B, fades out over
      // second half.
      let op;
      if (bt < 0.5) {
        op = 0.85;
      } else {
        op = 0.85 * (1 - (bt - 0.5) / 0.5);
      }
      m.puddleMat.opacity = op;
      m.sheenMat.opacity = op * 0.45;
    }
  }
}

// Reusable scratch THREE.Color instances — avoids per-frame allocation
// in the hot melt-update loop. Three needed because we lerp three
// independent color pairs in phase A.
const _scratchCol1 = new THREE.Color();
const _scratchCol2 = new THREE.Color();
const _scratchCol3 = new THREE.Color();

function _disposeMelt(m) {
  // Make sure body is gone (in case phase B never started — shouldn't
  // happen, but defensive).
  if (!m.bodyRemoved && m.spawner.obj && m.spawner.obj.parent) {
    scene.remove(m.spawner.obj);
    m.bodyRemoved = true;
  }
  if (m.puddle.parent) scene.remove(m.puddle);
  if (m.sheen.parent) scene.remove(m.sheen);
  if (m.puddleMat) m.puddleMat.dispose();
  if (m.sheenMat) m.sheenMat.dispose();
}

/**
 * Tear down all active melts. Called from clearAllPortals on game
 * reset so leftover puddles don't persist into the next run.
 */
export function clearHiveMelts() {
  for (const m of _activeMelts) _disposeMelt(m);
  _activeMelts.length = 0;
}
