// =====================================================================
// TUTORIAL MAGNET TILES
// =====================================================================
// Adds a layer of 3D colored cubes (one per rainbow tile, 20×20 = 400)
// that sit BELOW the floor at rest. As the player walks across the
// tutorial arena, tiles within a magnet radius rise up toward the
// player-walking level — the closer the player, the higher they sit.
// Reads as the player being a magnet pulling the colored tiles up.
//
// Visual layering:
//   - The existing rainbow floor texture stays in place. The black
//     border / grout pattern between tiles remains flush at y≈0.
//   - The colored tiles are 3D cubes, sized to match each rainbow
//     cell's interior (just inside the bevel), so when raised they
//     sit cleanly atop their rainbow tile slot — and when sunk, the
//     player sees the rainbow tile in place with the cube hidden
//     below.
//   - Cubes use the same getTutorialGlowColorAt() sampler the under-
//     foot highlight uses, so colors match exactly.
//
// Public API:
//   buildMagnetTiles()    — create cube grid (idempotent)
//   updateMagnetTiles(playerPos, dt)
//                          — per-frame position update
//   destroyMagnetTiles()  — tear down on tutorial exit
// =====================================================================

import * as THREE from 'three';
import { ARENA } from './config.js';
import { scene } from './scene.js';
import { getTutorialGlowColorAt } from './tutorial.js';

// Layout constants — must match tutorial.js's BORDER_PX / TEX_W / GRID_*
// so the cubes line up with the rainbow texture's tile centers.
const GRID_COLS  = 20;
const GRID_ROWS  = 20;
const BORDER_PX  = 90;
const TEX_W      = GRID_COLS * 130 + BORDER_PX * 2;   // 2780, matches tutorial.js
const INNER_HALF = ARENA - (BORDER_PX / TEX_W) * (2 * ARENA);
const CELL_SIZE  = (2 * INNER_HALF) / GRID_COLS;

// How tall each cube is. Tall enough that when sunk it's clearly
// "below the floor" but the top face still peeks up faintly so the
// player gets a hint there's something down there waiting to rise.
const CUBE_HEIGHT = 4.0;

// Resting Y position (CENTER of cube) when the tile is fully sunk.
// Negative = below the floor plane. Top of cube at this Y is
// REST_Y + CUBE_HEIGHT/2 = a little below floor level. Player only
// sees a faint hint of color from the depths.
const REST_Y_CENTER = -3.6;

// Lifted Y position (CENTER of cube) when the tile is fully raised
// to player walking level. Top of cube sits at LIFT_Y_CENTER +
// CUBE_HEIGHT/2. We want the top face just barely above floor (y=0)
// so the player visually steps up onto the cube. ~0.05 above floor
// reads cleanly without z-fighting with floor mesh.
const LIFT_Y_CENTER = 0.05 - CUBE_HEIGHT / 2;   // top face at y = 0.05

// Magnet falloff in WORLD units. Tiles inside MAGNET_RADIUS rise
// fully to LIFT_Y_CENTER. Tiles between MAGNET_RADIUS and
// MAGNET_FADE_END interpolate down to REST_Y_CENTER. Beyond
// MAGNET_FADE_END they stay sunk.
const MAGNET_RADIUS   = 4.0;     // ~one cell from player = fully up
const MAGNET_FADE_END = 14.0;    // ~3 cells out = fully sunk

// Per-tile spring smoothing. Higher = snappier, lower = floatier.
// We want a satisfying snap-up but a slightly softer settle when
// they sink back down, so the rise feels magnetic and the fall
// feels gentle.
const SPRING_UP   = 14.0;        // rate constant when target > current
const SPRING_DOWN = 6.0;         // rate constant when target < current

// Internal state.
let _root = null;                // THREE.Group holding all cubes
let _tiles = null;               // flat array, length GRID_COLS*GRID_ROWS
let _built = false;

// Build the cube grid. Idempotent — calling twice is a no-op.
export function buildMagnetTiles() {
  if (_built) return;
  if (!scene) return;

  _root = new THREE.Group();
  _root.name = 'tutorialMagnetTiles';
  // Render order below other tutorial overlays so the under-foot
  // highlight (renderOrder = -1, see main.js _updateTutorialFloorGlow)
  // still draws on top of a raised cube's top face cleanly.
  _root.renderOrder = -2;

  _tiles = new Array(GRID_COLS * GRID_ROWS);

  // Slight inset so the cube is a touch smaller than the rainbow
  // tile interior — keeps the painted black grout/bevel visible
  // around each raised cube. Without this the cube would overhang
  // the colored portion and bleed into the gridlines.
  const CUBE_INSET = 0.85;        // 85% of cell size
  const cubeSize   = CELL_SIZE * CUBE_INSET;

  // Reuse one geometry across all 400 cubes — significant memory
  // and draw-call savings, and lets us dispose with one .dispose()
  // call.
  const geo = new THREE.BoxGeometry(cubeSize, CUBE_HEIGHT, cubeSize);

  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      // World-space cell center — matches getTutorialCellInfo's
      // computation in tutorial.js exactly so cubes register with
      // the rainbow tile underneath.
      const cx = -INNER_HALF + (col + 0.5) * CELL_SIZE;
      const cz = -INNER_HALF + (row + 0.5) * CELL_SIZE;

      // Sample tile color from the same source the floor + glow
      // use. Result: cubes are color-faithful to their tile.
      const hex = getTutorialGlowColorAt(cx, cz);
      // Per-tile material: slight emissive boost so the colors
      // stay vivid at any chapter lighting. Matches the rainbow
      // floor's emissive treatment in applyTutorialFloor().
      const mat = new THREE.MeshStandardMaterial({
        color: hex,
        emissive: hex,
        emissiveIntensity: 0.45,
        roughness: 0.85,
        metalness: 0.0,
      });

      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(cx, REST_Y_CENTER, cz);
      mesh.castShadow = false;
      // receiveShadow off — these are dynamic and shadow cost on
      // 400 meshes would eat the frame budget. The bevel on the
      // floor texture below already provides depth cues.
      mesh.receiveShadow = false;

      _root.add(mesh);
      _tiles[row * GRID_COLS + col] = {
        mesh, mat,
        // Current Y center; updated by spring each frame.
        y: REST_Y_CENTER,
        // Cached cell center for distance math; avoids reading
        // mesh.position.x/z each frame.
        cx, cz,
      };
    }
  }

  scene.add(_root);
  _built = true;
}

// Per-frame update. playerPos must have .x and .z (THREE.Vector3 or
// any object with those fields). dt is seconds since last frame —
// clamped by the caller in main.js.
export function updateMagnetTiles(playerPos, dt) {
  if (!_built || !_tiles || !playerPos) return;

  const px = playerPos.x;
  const pz = playerPos.z;
  // Squared falloff thresholds — avoid sqrt per-tile in the hot loop.
  const rIn  = MAGNET_RADIUS;
  const rOut = MAGNET_FADE_END;
  // Skip tiles outside this bounding box from full distance check —
  // most of the 400 are nowhere near the player. Cheap reject.
  const cullRange = rOut + CELL_SIZE;

  // Clamp dt so a stutter doesn't overshoot the spring.
  const stepDt = Math.min(0.05, dt || 0.016);

  for (let i = 0; i < _tiles.length; i++) {
    const t = _tiles[i];
    const dx = t.cx - px;
    const dz = t.cz - pz;
    // Cheap AABB cull before sqrt.
    if (dx > cullRange || dx < -cullRange || dz > cullRange || dz < -cullRange) {
      // Far tile: always settling toward REST. Skip the dist math
      // entirely, just spring down.
      const dy = REST_Y_CENTER - t.y;
      t.y += dy * (1 - Math.exp(-SPRING_DOWN * stepDt));
      t.mesh.position.y = t.y;
      continue;
    }
    const dist = Math.sqrt(dx * dx + dz * dz);

    // Map distance → magnet strength s in [0..1].
    // s = 1 inside rIn, 0 outside rOut, smooth between.
    let s;
    if (dist <= rIn) {
      s = 1;
    } else if (dist >= rOut) {
      s = 0;
    } else {
      // Smoothstep: nicer than linear — gives the lift a soft
      // approach as the player draws closer instead of a sharp
      // crossover at rIn.
      const u = 1 - (dist - rIn) / (rOut - rIn);
      s = u * u * (3 - 2 * u);
    }

    // Target Y = lerp(REST, LIFT, s).
    const targetY = REST_Y_CENTER + (LIFT_Y_CENTER - REST_Y_CENTER) * s;

    // Asymmetric spring: snappy on the way up (player approaching),
    // gentle on the way down (player leaving). Reads as magnetic
    // attraction rather than a uniform bouncy float.
    const dy = targetY - t.y;
    const k = (dy > 0) ? SPRING_UP : SPRING_DOWN;
    // Exponential smoothing — frame-rate independent.
    t.y += dy * (1 - Math.exp(-k * stepDt));
    t.mesh.position.y = t.y;
  }
}

// Tear down all cubes + materials. Called when leaving tutorial mode
// so we don't leak 400 meshes / materials between runs.
export function destroyMagnetTiles() {
  if (!_built) return;
  if (_root) {
    if (scene) scene.remove(_root);
    // Dispose geometries (shared) + each material.
    if (_tiles) {
      // All cubes share one geometry — grab from any tile, dispose once.
      const sharedGeo = _tiles[0] && _tiles[0].mesh && _tiles[0].mesh.geometry;
      if (sharedGeo) sharedGeo.dispose();
      for (let i = 0; i < _tiles.length; i++) {
        const t = _tiles[i];
        if (t && t.mat) t.mat.dispose();
      }
    }
    _root = null;
  }
  _tiles = null;
  _built = false;
}

// Expose for debugging / reuse: returns true if grid is currently up.
export function isMagnetTilesActive() { return _built; }
