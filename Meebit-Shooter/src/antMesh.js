// antMesh.js — chapter-1 ant mesh loader.
//
// Loads assets/enemies/ant.glb once at startup. The GLB is the
// TRELLIS-generated ant figurine, sliced into 7 sub-meshes:
//   - body (head + thorax + abdomen + antennae fused together)
//   - Leg_FL, Leg_FR, Leg_RL, Leg_RR — 4 corner legs
//   - Leg_FC, Leg_RC — 2 axial appendages (front/rear)
//
// Each leg mesh has its origin at its hip joint, so rotating the
// leg group on its X axis pivots the leg from the hip — matches
// the spider-leg walk-anim path in main.js.
//
// Public API:
//   loadAntMesh()      — kicks off async load, called at startup
//   hasAntLoaded()     — true once the GLB has parsed successfully
//   makeAntFromGLB(scale) — clones the cached scene and returns
//                           the same shape makeSpider/makeHumanoid do.
//                           Returns null if loading hasn't finished
//                           or failed; caller should fall back.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { getAntSpottedTexture } from './tutorial.js';

const GLB_PATH = 'assets/enemies/ant.glb';

// Names of the 6 leg meshes we expect inside the GLB. Order MATTERS —
// the spider-leg walk anim in main.js applies a phase offset of 0.8
// per leg index, so the 4 corner legs go first (so opposite corners
// alternate naturally) and the 2 axial appendages come last.
const LEG_NAMES = ['Leg_FL', 'Leg_FR', 'Leg_RL', 'Leg_RR', 'Leg_FC', 'Leg_RC'];

// Cached parsed GLB scene root. Cloned per spawn (cheap — Three.js
// SkinnedMesh.clone() / Mesh.clone() share geometry + material).
let _cachedScene = null;
let _loadPromise = null;
let _loadFailed = false;

export function loadAntMesh() {
  if (_loadPromise) return _loadPromise;
  const loader = new GLTFLoader();
  _loadPromise = new Promise((resolve) => {
    loader.load(
      GLB_PATH,
      (gltf) => {
        // Cache the scene root. The scene is a Group containing one
        // child node "ant" which contains the body + 6 legs.
        _cachedScene = gltf.scene;
        // Sanity check — make sure all expected meshes are findable.
        const missing = [];
        if (!_cachedScene.getObjectByName('body')) missing.push('body');
        for (const n of LEG_NAMES) {
          if (!_cachedScene.getObjectByName(n)) missing.push(n);
        }
        if (missing.length > 0) {
          console.warn('[antMesh] GLB loaded but missing meshes:', missing.join(', '));
          _loadFailed = true;
        } else {
          console.log('[antMesh] loaded ant.glb — body + 6 legs ready');
        }
        resolve();
      },
      undefined,
      (err) => {
        console.warn('[antMesh] failed to load ant.glb:', err);
        _loadFailed = true;
        resolve();    // resolve anyway so callers don't hang
      }
    );
  });
  return _loadPromise;
}

export function hasAntLoaded() {
  return !!_cachedScene && !_loadFailed;
}

/**
 * Clone the cached ant scene and return it shaped like makeSpider's
 * output so makeEnemy can consume it without changes.
 *
 * The returned `group` is the new clone. Each leg is a child of the
 * group, accessible by name. spiderLegs[] orders them as defined by
 * LEG_NAMES so the per-leg phase offsets in main.js produce a
 * coherent scuttle pattern (opposite corners alternate).
 *
 * scale is applied to the group via group.scale.setScalar(scale) —
 * this matches how the procedural makeSpider returns its mesh.
 *
 * Returns null if the GLB hasn't loaded yet — caller falls back.
 */
export function makeAntFromGLB(scale, tutorialMode = false) {
  if (!_cachedScene) return null;
  // Clone the entire scene tree. Three.js's clone() shares geometry
  // and materials by default, so this is cheap — a few hundred bytes
  // per clone, not a few hundred kilobytes.
  const cloned = _cachedScene.clone(true);

  // The GLB's structure is: scene Group → "ant" node → [body + legs].
  // We want a single Group at the spawn point holding the body and
  // legs as direct children, matching how makeSpider returns. Pull
  // the "ant" node out of the scene root and use IT as the group.
  let antRoot = cloned.getObjectByName('ant');
  if (!antRoot) {
    // Fallback: if the scene wraps differently, just use the cloned
    // scene root.
    antRoot = cloned;
  }

  // Find the body mesh and the 6 leg meshes by name.
  const body = antRoot.getObjectByName('body');
  const legs = LEG_NAMES.map(n => antRoot.getObjectByName(n)).filter(Boolean);

  // The TRELLIS-generated mesh is normalized to roughly 1 unit
  // tall (Y range -0.5 to +0.5). The procedural enemies in the game
  // use a scale where the humanoid is about 2.5 units tall at scale
  // = 1.0 (which is then multiplied by spec.scale * 0.55 in makeEnemy).
  // To make the GLB ant land at the same visible size as the
  // procedural ant did, we apply a base multiplier here. 2.5 lifts
  // the 1u-tall normalized mesh to 2.5u tall — same ballpark as the
  // procedural humanoid silhouette.
  const NORMALIZED_SCALE = 2.5;
  // The TRELLIS mesh is centered vertically (y from -0.5 to +0.5)
  // but the game expects the enemy's feet at y=0. Lift the antRoot
  // so the lowest point of the mesh sits at y=0.
  const FEET_LIFT = 0.5 * NORMALIZED_SCALE;     // half-height before scale, times scale

  // Wrap antRoot in a fresh Group so we own the transform without
  // disturbing the GLB's internal hierarchy. This matches how the
  // other makeX functions return.
  const group = new THREE.Group();
  antRoot.position.y = FEET_LIFT;
  group.add(antRoot);
  group.scale.setScalar(scale * NORMALIZED_SCALE);

  // Cast shadows on body + legs.
  if (body) body.castShadow = true;
  for (const leg of legs) leg.castShadow = true;

  // Material setup. Two paths depending on whether the ant is being
  // built for the tutorial or a normal chapter-1 wave.
  //
  // Normal: clone ONLY the body's material so each ant instance owns
  // its own bodyMat (lets hit-flash etc. mutate one ant without
  // affecting all of them). Legs continue to share the GLB's original
  // material — they don't need per-instance state.
  //
  // Tutorial: walk all 7 sub-meshes (body + 6 legs) and replace each
  // material with a fresh clone whose `map` is the spotted texture
  // and whose color is white. This swaps the entire ant from the
  // baked orange-figurine look to a uniform black-and-white spotted
  // dazzle pattern — body, head, and legs all match. Per-mesh clones
  // mean tinting / hit-flash on one ant doesn't bleed to others.
  let bodyMat = null;
  if (tutorialMode) {
    const spottedTex = getAntSpottedTexture();
    const allMeshes = [body, ...legs].filter(Boolean);
    for (const mesh of allMeshes) {
      if (!mesh.material) continue;
      const m = mesh.material.clone();
      // Override the GLB's baked orange colors with the spotted
      // texture. Color stays white so the texture shows true (no
      // multiply tint).
      m.map = spottedTex;
      m.color = new THREE.Color(0xffffff);
      // Also clear emissive so the spots don't get washed by the
      // chapter tint emissive that may have been baked in.
      if (m.emissive) m.emissive.setHex(0x000000);
      m.emissiveIntensity = 0;
      m.needsUpdate = true;
      mesh.material = m;
      // Capture the body's material specifically so hit-flash and
      // other systems can find it via enemy.bodyMat.
      if (mesh === body) bodyMat = m;
    }
  } else {
    // Normal path: clone only the body's material.
    if (body && body.material) {
      bodyMat = body.material.clone();
      body.material = bodyMat;
    }
  }

  // ---- WINGS ----
  // Two translucent insect-style wings on the upper back. Each wing
  // is a teardrop shape (two triangles forming a leaf) attached to
  // a small Group "hinge" at the wing's root. Rotating the hinge
  // on its Z axis flaps the wing — outer tip swings up/down while
  // the root stays fixed at the body, the natural flap motion.
  //
  // Geometry uses ShapeGeometry from a 2D path swept once — gives
  // a flat wing without billboard tricks. Material is double-sided
  // translucent with low opacity so the wings catch the chapter
  // light without dominating the silhouette.
  //
  // The wings ride INSIDE antRoot (the GLB's coordinate space)
  // BEFORE we apply FEET_LIFT and group.scale — that way they sit
  // attached to the body geometry and scale with the rest of the
  // model. Wing positions are in the GLB's normalized 1u-tall
  // coordinate space.
  const wingShape = new THREE.Shape();
  // Teardrop / leaf path. Origin is at the root (wing hinge).
  // Tip extends along +X (the wing's "out" direction).
  wingShape.moveTo(0, 0);
  wingShape.bezierCurveTo(0.05, 0.06, 0.20, 0.05, 0.32, 0);
  wingShape.bezierCurveTo(0.20, -0.05, 0.05, -0.04, 0, 0);
  const wingGeo = new THREE.ShapeGeometry(wingShape);
  const wingMat = new THREE.MeshStandardMaterial({
    color: 0xffeedd,            // warm pearlescent base
    transparent: true,
    opacity: 0.42,
    roughness: 0.30,
    metalness: 0.10,
    side: THREE.DoubleSide,
    depthWrite: false,           // don't z-block other wings or body bits
  });

  // Wing hinges — small empty groups, one per wing. The hinge
  // anchors at the wing's root on the back of the thorax. Rotating
  // the hinge group on Z flaps the wing.
  // Position is in the GLB's normalized space:
  //   y = +0.20  → just above the thorax top (body Y range -0.5..+0.5)
  //   z = -0.05  → slightly behind body center, where wings naturally sit
  //   x = ±0.05  → small offset from spine
  const wingL = new THREE.Group();
  wingL.position.set(-0.05, 0.20, -0.05);
  // Wing tilts up slightly at rest so the leaf sits at a natural
  // resting angle rather than perfectly flat horizontal.
  wingL.rotation.set(-0.30, 0, 0);
  const wingLMesh = new THREE.Mesh(wingGeo, wingMat);
  // Mirror the leaf to face left — negate X scale on the mesh.
  wingLMesh.scale.x = -1;
  wingL.add(wingLMesh);
  antRoot.add(wingL);

  const wingR = new THREE.Group();
  wingR.position.set(0.05, 0.20, -0.05);
  wingR.rotation.set(-0.30, 0, 0);
  const wingRMesh = new THREE.Mesh(wingGeo, wingMat);
  antRoot.add(wingR);
  wingR.add(wingRMesh);

  // Return shape mirrors makeSpider's. The walk-anim path in main.js
  // reads spiderLegs[] when isSpider=true, so the corner + axial legs
  // all animate. armL/armR/legL/legR aliases are defensive defaults.
  // wings[] is consumed by the per-frame flutter loop in main.js.
  return {
    group,
    body,
    bodyMat,
    armL: legs[0],
    armR: legs[1],
    legL: legs[2],
    legR: legs[3],
    head: body,           // no separate head mesh — body is the head+thorax+abdomen fused
    spiderLegs: legs,
    wings: [wingL, wingR],
  };
}
