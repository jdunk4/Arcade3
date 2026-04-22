// BONUS WAVE — "THE STAMPEDE"
//
// Triggered as wave 6 of every chapter, right after the boss falls.
// 111 themed Meebits pour into the arena. The player has 30 seconds to
// walk near as many as possible (proximity auto-collect). No enemies.
// No damage. Pure victory lap.
//
// Per-chapter herd (defined in config.CHAPTERS[i].bonusHerd):
//   Ch.1 INFERNO   → PIGS
//   Ch.2 CRIMSON   → ELEPHANTS
//   Ch.3 SOLAR     → SKELETONS
//   Ch.4 TOXIC     → ROBOTS
//   Ch.5 ARCTIC    → VISITORS
//   Ch.6 PARADISE  → DISSECTED
//
// Flow:
//   startBonusWave(chapterIdx)  — loads herd, spawns 111 over ~1.6s, starts 30s timer
//   updateBonusWave(dt, player) — timer tick, proximity checks, wander movement
//   endBonusWave()              — celebrates, clears herd, returns { caught, total }
//   isBonusWaveActive()         — bool

import * as THREE from 'three';
import { scene } from './scene.js';
import { ARENA, BONUS_WAVE_CONFIG, CHAPTERS } from './config.js';
import {
  discoverHerd,
  getHerdMeshByFilename,
  getHerdVoxelFallback,
  prefetchHerd,
} from './herdVrmLoader.js';
import { hitBurst } from './effects.js';
import { attachMixer, animationsReady } from './animation.js';
import { Audio } from './audio.js';

// -- Module state --
const herd = [];                 // live, unrescued pigs
const savedPigs = [];            // pigs who've been fully saved — decorative, standing on ring
let active = false;
let timeLeft = 0;
let caughtCount = 0;
let currentHerdId = null;
let currentHerdLabel = null;
let currentChapterTint = 0xffffff;
let currentChapterIdx = 0;       // which chapter the current bonus wave belongs to
let currentFilenames = [];
let onCaughtCallback = null;
let nextRingSlot = 0;
// Chapter of the most-recently-active bonus wave. Saved pigs from this chapter
// keep animating; older ones freeze (performance — see updateSavedPigs).
let _latestSaveChapter = -1;

// Confetti for the end-of-wave celebration (spawned purely for visuals).
const CATCH_BURST_COLOR = 0xffd93d;

// ---- LASER TAG tuning ----
// Player shoots each pig 3 times to "save" them. First shot triggers panic
// flee (3 second window) — classic chase dynamic. Saved pigs teleport to an
// evenly-spaced square formation around the arena perimeter, facing inward,
// playing a random idle animation.
const SHOTS_TO_SAVE = 3;           // hits required to save a pig
const PANIC_FLEE_DURATION = 3.0;   // seconds pig runs after being grazed
const HIT_FLASH_DURATION = 0.2;    // seconds of red tint on hit

// ---- Saved-pig square formation ----
// Arena is 50x50 (from config.ARENA). Spectator crowd sits at ±58 (ARENA+8).
// Place saved pigs in the 8-unit gap between arena floor edge and crowd, at
// radius ~54 from center. Laid out as a square ring (not a circle) — 4 sides,
// each side is a row of pigs facing inward.
const SAVE_RING_OFFSET = 4;        // distance from arena edge (ARENA + 4 = 54)
const SAVE_SPACING = 2.2;          // units between adjacent pigs in formation
const SAVE_ROW_STEP = 2.4;         // back-to-front row depth (if we need row 2)
// Four slots per side at the corners are reserved so the formation "squares off"
// cleanly. Total base slots per row = 4 sides × (ARENA*2 / SAVE_SPACING) ≈ 180.
// Plenty of room for 6 chapters × 111 = 666 saved pigs in 3-4 rows.
const SAVE_SIDE_HALF = 46;         // pigs fill side from -46 to +46 (leaves corner gap)

// ---- Ambient flee tuning (panic speed when a pig gets grazed) ----
const FLEE_SPEED = 4.5;
const FLEE_EDGE_BOUNCE = 0.85;


// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

/**
 * Kick off the bonus wave for the given chapter. Spawns `herdSize` meebits
 * scattered across the arena, starts the 30-second timer, and returns the
 * herd info so the caller (waves.js) can drive UI.
 *
 * Now async — awaits a one-time herd-size discovery (HEAD-probes the asset
 * folder to see how many VRMs are actually present). If the folder has
 * fewer than herdSize files, the wave CYCLES through them to keep the
 * stampede at full density.
 */
export async function startBonusWave(chapterIdx, chapterTintHex, onCaught) {
  clearBonusWave();

  active = true;
  timeLeft = BONUS_WAVE_CONFIG.duration;
  caughtCount = 0;
  currentChapterTint = chapterTintHex;
  currentChapterIdx = chapterIdx;
  _latestSaveChapter = chapterIdx;    // newest chapter's pigs will animate live
  onCaughtCallback = onCaught || null;

  const chapter = CHAPTERS[chapterIdx % CHAPTERS.length];
  const herdDef = chapter.bonusHerd;
  currentHerdId = herdDef.id;
  currentHerdLabel = herdDef.label;

  console.info(`[bonusWave] start — chapter ${chapterIdx}, herd: ${currentHerdId}`);

  // Discover the actual VRM filenames in the herd folder. Tries manifest.json
  // first, falls back to sequential 00001.vrm probe. 3s deadline so we can't
  // hang here.
  currentFilenames = await discoverHerd(currentHerdId);
  console.info(`[bonusWave] discovered ${currentFilenames.length} VRMs; will cycle to fill ${BONUS_WAVE_CONFIG.herdSize}`);

  // Wave may have been cancelled during discovery.
  if (!active) {
    console.info('[bonusWave] cancelled during discovery');
    return { herdId: currentHerdId, label: currentHerdLabel, icon: herdDef.icon };
  }

  // Spawn herdSize meebits. CRITICAL: stagger + concurrency gate, otherwise
  // 111 simultaneous material compiles freeze the browser.
  const size = BONUS_WAVE_CONFIG.herdSize;
  const stagger = BONUS_WAVE_CONFIG.spawnStagger;
  for (let slotIdx = 1; slotIdx <= size; slotIdx++) {
    // Pick the filename to use for this slot. Cycle through available files
    // if the herd has fewer VRMs than slots. If zero files available,
    // filename is null → voxel fallback path.
    const filename = currentFilenames.length > 0
      ? currentFilenames[(slotIdx - 1) % currentFilenames.length]
      : null;
    setTimeout(() => { _spawnOneGated(slotIdx, filename); }, (slotIdx - 1) * stagger);
  }

  return { herdId: currentHerdId, label: currentHerdLabel, icon: herdDef.icon };
}

// ----------------------------------------------------------------------------
// Concurrency-gated spawn pool
// ----------------------------------------------------------------------------
// Each spawn does: HEAD-probe (free if cached) → fetch VRM → parse GLTF →
// scene.add() which forces a material compile. The compile is the expensive
// step; doing N of them in the same frame ruins everything. We cap how many
// spawns can be running their async path at once.

let _inFlightSpawns = 0;
const _spawnWaitQueue = [];  // FIFO of pending spawn tickets

function _acquireSpawnSlot() {
  return new Promise(resolve => {
    if (_inFlightSpawns < BONUS_WAVE_CONFIG.maxConcurrentSpawns) {
      _inFlightSpawns++;
      resolve();
    } else {
      _spawnWaitQueue.push(resolve);
    }
  });
}

function _releaseSpawnSlot() {
  if (_spawnWaitQueue.length > 0) {
    const next = _spawnWaitQueue.shift();
    next();  // keeps _inFlightSpawns the same (hands off the slot)
  } else {
    _inFlightSpawns = Math.max(0, _inFlightSpawns - 1);
  }
}

async function _spawnOneGated(slotIdx, filename) {
  if (!active) return;
  await _acquireSpawnSlot();
  if (!active) { _releaseSpawnSlot(); return; }
  try {
    await _spawnOne(slotIdx, filename);
  } catch (err) {
    console.warn('[bonusWave] spawn ticket error:', err);
  } finally {
    _releaseSpawnSlot();
  }
}

/**
 * Tick. Call once per frame with dt (sec) and the player object (needs .pos).
 * Returns:
 *   { active, timeLeft, caught, total, finished }
 * When finished === true, the caller should invoke endBonusWave() and
 * transition out.
 */
export function updateBonusWave(dt, player) {
  // If the wave was ended externally (e.g. game reset) but updateWaves is
  // still calling us because waveDef hasn't been cleared yet, report
  // `finished: true` so the caller triggers a normal endWave transition.
  if (!active) {
    return {
      active: false,
      timeLeft: 0,
      caught: caughtCount,
      total: BONUS_WAVE_CONFIG.herdSize,
      finished: true,
      herdLabel: currentHerdLabel || 'HERD',
    };
  }

  timeLeft = Math.max(0, timeLeft - dt);

  const wanderSpeed = BONUS_WAVE_CONFIG.wanderSpeed;
  const wanderChange = BONUS_WAVE_CONFIG.wanderChangeSec;
  const limit = ARENA - 2;

  // --- Live herd update (unsaved pigs) ---
  for (let i = herd.length - 1; i >= 0; i--) {
    const h = herd[i];
    if (h.caught || !h.obj) continue;

    try {
      // Decrement hit-flash and panic timers regardless of state.
      if (h.hitFlashTimer > 0) {
        h.hitFlashTimer = Math.max(0, h.hitFlashTimer - dt);
      }
      if (h.panicTimer > 0) {
        h.panicTimer = Math.max(0, h.panicTimer - dt);
        if (h.panicTimer === 0) {
          // Panic wore off — back to wander.
          h.state = 'wander';
          if (h.mixer) { try { h.mixer.playWalk(); } catch (e) {} }
        }
      }

      // Laser tag mode: pigs do NOT passively flee from the player. They
      // only panic after being shot. Panic timer drives flee behavior.
      const panicking = h.state === 'panic' && h.panicTimer > 0;

      let movingSpeed;
      if (panicking) {
        // Flee directly away from the player (direction captured at shot time).
        const pdx = player.pos.x - h.pos.x;
        const pdz = player.pos.z - h.pos.z;
        const distToPlayer = Math.sqrt(pdx * pdx + pdz * pdz) || 1;
        let fx = -pdx / distToPlayer;
        let fz = -pdz / distToPlayer;

        // Edge bounce — if fleeing would hit the wall, divert to a tangent.
        const projX = h.pos.x + fx * FLEE_SPEED * dt * 2;
        const projZ = h.pos.z + fz * FLEE_SPEED * dt * 2;
        if (Math.abs(projX) > limit || Math.abs(projZ) > limit) {
          const sign = (h.slotIdx % 2 === 0) ? 1 : -1;
          const nx = -fz * sign;
          const nz =  fx * sign;
          fx = nx * FLEE_EDGE_BOUNCE + fx * (1 - FLEE_EDGE_BOUNCE);
          fz = nz * FLEE_EDGE_BOUNCE + fz * (1 - FLEE_EDGE_BOUNCE);
          const nrm = Math.sqrt(fx * fx + fz * fz) || 1;
          fx /= nrm; fz /= nrm;
        }

        h.pos.x = Math.max(-limit, Math.min(limit, h.pos.x + fx * FLEE_SPEED * dt));
        h.pos.z = Math.max(-limit, Math.min(limit, h.pos.z + fz * FLEE_SPEED * dt));

        const targetAngle = Math.atan2(fx, fz);
        let diff = targetAngle - h.obj.rotation.y;
        while (diff >  Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        h.obj.rotation.y += diff * Math.min(1, dt * 8);

        movingSpeed = FLEE_SPEED;
        h.wanderTimer = 0;  // invalidate stale wander target
      } else {
        // Wander (slow roam around a drifting target)
        h.wanderTimer -= dt;
        if (h.wanderTimer <= 0) {
          h.wanderTimer = wanderChange + Math.random() * 1.5;
          const a = Math.random() * Math.PI * 2;
          const r = 3 + Math.random() * 6;
          h.wanderTarget.set(
            Math.max(-limit, Math.min(limit, h.pos.x + Math.cos(a) * r)),
            0,
            Math.max(-limit, Math.min(limit, h.pos.z + Math.sin(a) * r)),
          );
        }
        const dx = h.wanderTarget.x - h.pos.x;
        const dz = h.wanderTarget.z - h.pos.z;
        const d = Math.sqrt(dx * dx + dz * dz) || 1;
        if (d > 0.4) {
          h.pos.x += (dx / d) * wanderSpeed * dt;
          h.pos.z += (dz / d) * wanderSpeed * dt;
          const targetAngle = Math.atan2(dx, dz);
          let diff = targetAngle - h.obj.rotation.y;
          while (diff >  Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          h.obj.rotation.y += diff * Math.min(1, dt * 5);
        }
        movingSpeed = wanderSpeed;
      }

      // Animation tempo
      if (h.mixer) {
        h.mixer.setSpeed(Math.max(0.4, movingSpeed / 2.0));
        h.mixer.update(dt);
      } else if (h.animRefs) {
        h.walkPhase += dt * (panicking ? 14 : 9);
        const sw = Math.sin(h.walkPhase) * (panicking ? 0.7 : 0.5);
        if (h.animRefs.legL) h.animRefs.legL.rotation.x = sw;
        if (h.animRefs.legR) h.animRefs.legR.rotation.x = -sw;
        if (h.animRefs.armL) h.animRefs.armL.rotation.x = -sw * 0.6;
        if (h.animRefs.armR) h.animRefs.armR.rotation.x = sw * 0.6;
      } else if (h.obj) {
        h.walkPhase += dt * movingSpeed * 2;
        const bob = Math.sin(h.walkPhase * 2) * 0.08;
        h.obj.position.y = bob;
      }
    } catch (err) {
      console.warn('[bonusWave] per-herd update error, skipping:', err);
      h.caught = true;
      if (h.obj && h.obj.parent) scene.remove(h.obj);
    }
  }

  // Saved pigs are updated by updateSavedPigs() in main.js every frame
  // regardless of wave type — not here. They persist across waves/chapters.

  const finished = timeLeft <= 0 || caughtCount >= BONUS_WAVE_CONFIG.herdSize;
  return {
    active: true,
    timeLeft,
    caught: caughtCount,
    total: BONUS_WAVE_CONFIG.herdSize,
    finished,
    herdLabel: currentHerdLabel,
  };
}

/**
 * End the bonus wave. Fires a celebratory burst volley, clears any remaining
 * herd meebits from the scene, and returns the final tally.
 */
export function endBonusWave() {
  if (!active) return { caught: 0, total: 0 };

  active = false;
  const final = { caught: caughtCount, total: BONUS_WAVE_CONFIG.herdSize, herdLabel: currentHerdLabel };

  // Celebratory confetti across the arena (replaces the normal nuke effect).
  // Eight bursts at random positions in the chapter color — cheap and sells
  // the "you made it" moment.
  for (let i = 0; i < 8; i++) {
    setTimeout(() => {
      const a = Math.random() * Math.PI * 2;
      const r = 8 + Math.random() * 18;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      hitBurst(new THREE.Vector3(x, 3 + Math.random() * 2, z), currentChapterTint, 16);
    }, i * 90);
  }

  clearBonusWave();
  return final;
}

/**
 * Rip everything down. Called from endBonusWave (clean completion) and
 * from resetWaves (game over / restart).
 */
/**
 * Clear the current bonus wave but PRESERVE the saved-pig formation.
 * Saved pigs are persistent — they remain visible through subsequent waves
 * and chapters as a growing perimeter of "freed" Meebits. Only cleared on
 * full game restart (see clearSavedPigs below).
 */
export function clearBonusWave() {
  for (const h of herd) {
    if (h.mixer) { try { h.mixer.stop(); } catch (e) {} }
    if (h.obj && h.obj.parent) scene.remove(h.obj);
  }
  herd.length = 0;
  // Saved pigs deliberately NOT cleared — they persist across waves.
  active = false;
  timeLeft = 0;
  caughtCount = 0;
  currentHerdId = null;
  currentHerdLabel = null;
  onCaughtCallback = null;
  while (_spawnWaitQueue.length > 0) {
    const resolve = _spawnWaitQueue.shift();
    try { resolve(); } catch (e) {}
  }
  _inFlightSpawns = 0;
}

/**
 * Nuke every saved pig from the scene and reset the formation counter.
 * Called on full game reset (player died → restart). The visual trophy
 * wall of freed pigs should only accumulate within a single run.
 */
export function clearSavedPigs() {
  for (const s of savedPigs) {
    if (s.mixer) { try { s.mixer.stop(); } catch (e) {} }
    if (s.obj && s.obj.parent) scene.remove(s.obj);
  }
  savedPigs.length = 0;
  nextRingSlot = 0;
}

/**
 * Per-frame tick for the saved-pig idle animations. Called every frame from
 * main.js regardless of wave type, so the trophy wall keeps breathing during
 * combat waves 1-5 of subsequent chapters.
 *
 * PERFORMANCE: only the most-recently-active chapter's saved pigs actually
 * get their mixers ticked. Pigs from older chapters are "frozen in pose" —
 * they stay on the perimeter looking like statues, but don't cost CPU/GPU
 * per frame. With 6 chapters × 111 pigs = 666 possible saved pigs, animating
 * them all would cost 5-10 ms/frame; freezing old ones keeps it cheap.
 */
export function updateSavedPigs(dt) {
  for (const s of savedPigs) {
    // Only animate pigs from the most recently completed bonus wave's chapter.
    if (s.mixer && s.chapterIdx === _latestSaveChapter) {
      s.mixer.update(dt);
    }
  }
}

export function isBonusWaveActive() { return active; }

/**
 * Optional: warm the cache for the NEXT chapter's herd while the player
 * is still on the current chapter's boss. Non-blocking, errors suppressed.
 * Call this from waves.js when localWave === 5 starts.
 */
export function prefetchNextHerd(nextChapterIdx) {
  const chapter = CHAPTERS[nextChapterIdx % CHAPTERS.length];
  if (!chapter || !chapter.bonusHerd) return;
  // Prefetch a sample (first 30 of the herd). Loading all 111 eagerly would
  // over-commit the network; 30 is enough to guarantee some visible herd
  // meebits render instantly when the wave starts — the remaining 81 stream
  // in while the player is already catching the first batch.
  const sample = [];
  for (let i = 1; i <= 30; i++) sample.push(i);
  prefetchHerd(chapter.bonusHerd.id, sample);
}

// ----------------------------------------------------------------------------
// Internals
// ----------------------------------------------------------------------------

async function _spawnOne(slotIdx, filename) {
  if (!active) return;

  // Scatter across the arena in a ring around the center.
  const angle = Math.random() * Math.PI * 2;
  const minR = BONUS_WAVE_CONFIG.spawnRingMin;
  const maxR = BONUS_WAVE_CONFIG.spawnRingMax;
  const dist = minR + Math.random() * (maxR - minR);
  const x = Math.cos(angle) * dist;
  const z = Math.sin(angle) * dist;

  // No placeholder needed — we either build a voxel fallback synchronously
  // (zero files available) or await the VRM load and add it when ready.
  // Previously we used a placeholder Group but the async swap introduced a
  // stale-`h.pos` race where the update loop could write to the orphaned
  // placeholder after the mesh was swapped in. Simpler and safer to just
  // wait for the final mesh before registering it in the herd[] array.

  let mesh;
  if (!filename) {
    // Discovery found zero VRMs — go straight to voxel fallback, no network.
    mesh = getHerdVoxelFallback(currentChapterTint);
  } else {
    try {
      // getHerdMeshByFilename already returns a voxel fallback on its own
      // error path, so this try/catch is belt-and-suspenders.
      mesh = await getHerdMeshByFilename(currentHerdId, filename, currentChapterTint);
    } catch (err) {
      console.warn('[bonusWave] unexpected load error for', currentHerdId, filename, err);
      mesh = getHerdVoxelFallback(currentChapterTint);
    }
  }

  // Wave may have ended while we awaited.
  if (!active) {
    if (mesh && mesh.traverse) {
      mesh.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          if (Array.isArray(o.material)) o.material.forEach(m => m.dispose());
          else o.material.dispose();
        }
      });
    }
    return;
  }

  mesh.position.set(x, 0, z);
  scene.add(mesh);

  const h = {
    obj: mesh,
    pos: mesh.position,
    slotIdx,
    filename: filename || '__voxel__',
    herdId: currentHerdId,
    caught: false,
    state: 'wander',           // 'wander' | 'panic' — drives flee behavior
    // --- Laser tag ---
    hp: SHOTS_TO_SAVE,         // shots remaining before saved
    hitFlashTimer: 0,          // red tint countdown on hit
    panicTimer: 0,             // flee timer (set to PANIC_FLEE_DURATION on each shot)
    // --- Wander state ---
    wanderTarget: new THREE.Vector3(x, 0, z),
    wanderTimer: Math.random() * BONUS_WAVE_CONFIG.wanderChangeSec,
    walkPhase: Math.random() * Math.PI * 2,
    mixer: null,
    animRefs: null,
  };

  if (mesh.userData && mesh.userData.isFallback && mesh.userData.animRefs) {
    h.animRefs = mesh.userData.animRefs;
  } else if (animationsReady()) {
    try {
      h.mixer = attachMixer(mesh);
      h.mixer.playWalk();
    } catch (err) {
      h.mixer = null;
    }
  }

  herd.push(h);
}

/**
 * Compute the world position + inward-facing rotation for a saved pig, given
 * its slot index in the perimeter square. Slots are distributed:
 *   - North (top) side: slots 0..N-1, left-to-right at z = +radius
 *   - East side: slots N..2N-1, front-to-back at x = +radius
 *   - South side: slots 2N..3N-1, right-to-left at z = -radius
 *   - West side: slots 3N..4N-1, back-to-front at x = -radius
 * When we run out of slots in row 1, we wrap to row 2 (one deeper outward).
 */
function _placeInSquare(slotIdx) {
  const sideHalf = SAVE_SIDE_HALF;
  const sideLen = sideHalf * 2;
  // How many pigs fit along one side of a row
  const slotsPerSide = Math.max(1, Math.floor(sideLen / SAVE_SPACING));
  const slotsPerRow = slotsPerSide * 4;

  const row = Math.floor(slotIdx / slotsPerRow);
  const withinRow = slotIdx % slotsPerRow;
  const side = Math.floor(withinRow / slotsPerSide);   // 0..3
  const alongSlot = withinRow % slotsPerSide;          // 0..slotsPerSide-1

  // Position along the side: spread evenly from -sideHalf to +sideHalf.
  const alongPos = -sideHalf + (alongSlot + 0.5) * (sideLen / slotsPerSide);
  // Perpendicular distance from arena edge — rows step outward.
  const perpDist = ARENA + SAVE_RING_OFFSET + row * SAVE_ROW_STEP;

  let x, z, facingY;
  switch (side) {
    case 0:  // North side: z = +perp, pigs face -z (toward center)
      x = alongPos;  z =  perpDist;  facingY = Math.PI;   break;
    case 1:  // East side: x = +perp, pigs face -x
      x =  perpDist; z = alongPos;   facingY = -Math.PI / 2; break;
    case 2:  // South side: z = -perp, pigs face +z
      x = alongPos;  z = -perpDist;  facingY = 0;         break;
    case 3:  // West side: x = -perp, pigs face +x
    default:
      x = -perpDist; z = alongPos;   facingY = Math.PI / 2; break;
  }
  return { x, z, facingY };
}

/**
 * Called from main.js when a bullet/rocket/beam touches any point in the arena.
 * Walks the herd, damages any pig within `radius` of (x, z), and returns true
 * if at least one was hit (so the caller can consume the bullet).
 *
 * Each hit:
 *   - decrements pig hp by 1
 *   - applies a hit flash
 *   - triggers panic flee for PANIC_FLEE_DURATION seconds
 *   - at hp=0, calls _save() to move the pig to the perimeter ring
 */
export function damageHerdAt(x, z, radius) {
  if (!active) return false;
  const r2 = radius * radius;
  let anyHit = false;
  for (let i = herd.length - 1; i >= 0; i--) {
    const h = herd[i];
    if (h.caught || !h.obj) continue;
    const dx = h.pos.x - x;
    const dz = h.pos.z - z;
    if (dx * dx + dz * dz >= r2) continue;

    // HIT!
    anyHit = true;
    h.hp = Math.max(0, h.hp - 1);
    h.hitFlashTimer = HIT_FLASH_DURATION;
    h.panicTimer = PANIC_FLEE_DURATION;

    // Switch to run animation on first grazed shot (if not already).
    if (h.state !== 'panic') {
      h.state = 'panic';
      if (h.mixer) { try { h.mixer.playRun(); } catch (e) {} }
    }

    // Small hit burst so the player can see they hit.
    hitBurst(new THREE.Vector3(h.pos.x, 1.5, h.pos.z), 0xff6a1a, 4);

    if (h.hp <= 0) {
      _save(h, i);
    }
  }
  return anyHit;
}

/**
 * Save a pig — teleport it to the next available ring slot at the arena
 * perimeter, rotate to face inward (toward center), swap to a random idle
 * animation, and park it there for the rest of the wave.
 */
function _save(h, idx) {
  h.caught = true;
  caughtCount++;

  // Remove from live herd; it now lives in savedPigs for the rest of the run.
  herd.splice(idx, 1);

  // Pick the next available square-formation slot. nextRingSlot is the
  // running total of all pigs ever saved this run (across all chapters).
  const placement = _placeInSquare(nextRingSlot);
  nextRingSlot++;

  // Small position jitter so the square doesn't look mechanically perfect —
  // ±0.25u along the line, ±0.15u in depth. Preserves the grid feel while
  // adding life.
  const jitterAlong = (Math.random() - 0.5) * 0.5;
  const jitterDepth = (Math.random() - 0.5) * 0.3;
  const isNSside = Math.abs(placement.z) > Math.abs(placement.x);
  const finalX = placement.x + (isNSside ? jitterAlong : jitterDepth);
  const finalZ = placement.z + (isNSside ? jitterDepth : jitterAlong);

  // Celebratory burst at the ORIGINAL position before teleporting.
  hitBurst(new THREE.Vector3(h.pos.x, 2, h.pos.z), CATCH_BURST_COLOR, 10);
  try { if (Audio && Audio.bonusCatch) Audio.bonusCatch(); } catch (e) {}

  // Teleport to the formation slot.
  h.pos.set(finalX, 0, finalZ);
  h.obj.rotation.y = placement.facingY;

  // Switch to a random idle animation (variants 2/3/4 from your Standing Idle GLBs).
  if (h.mixer) {
    const variant = 2 + Math.floor(Math.random() * 3);
    try { h.mixer.playIdle(variant); } catch (e) {}
    h.mixer.setSpeed(1.0);
  } else if (h.animRefs) {
    if (h.animRefs.legL) h.animRefs.legL.rotation.x = 0;
    if (h.animRefs.legR) h.animRefs.legR.rotation.x = 0;
    if (h.animRefs.armL) h.animRefs.armL.rotation.x = 0;
    if (h.animRefs.armR) h.animRefs.armR.rotation.x = 0;
  }

  // Move into the persistent savedPigs pool. These survive across wave
  // transitions within a run — only cleared on full game reset.
  const saved = {
    obj: h.obj,
    pos: h.pos,
    mixer: h.mixer,
    slotIdx: h.slotIdx,
    formationSlot: nextRingSlot - 1,
    filename: h.filename,
    herdId: h.herdId,
    chapterIdx: currentChapterIdx,   // which chapter saved this pig (for anim freeze policy)
  };
  savedPigs.push(saved);

  // Notify waves.js.
  if (onCaughtCallback) {
    onCaughtCallback({
      herdId: h.herdId,
      filename: h.filename,
      slotIdx: h.slotIdx,
      herdLabel: currentHerdLabel,
    });
  }
}
