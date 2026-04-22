// ============================================================================
// src/waveProps.js — central wave-2 compound layout + dormant prop geometry.
//
// Scope (Stage 3a):
//   - Defines LAYOUT, the single source of truth for WHERE the silo, 3
//     turrets, powerplant, and radio tower sit in the arena.
//   - Exports buildCentralCompound() which spawns the dormant silo,
//     powerplant, and radio tower geometry at chapter start. (Turrets are
//     still built by turrets.js — they just consume LAYOUT.turrets to
//     pick their positions.)
//   - Exports clearCentralCompound() to tear it all down on chapter end.
//
// Not implemented here yet (Stage 3b):
//   - Powerplant "mini city" light-up on POWER completion
//   - Wires from powerplant → turrets + silo
//   - Silo opening / missile raising animation
//   - Generator on the rocket that you shoot
//
// Not implemented here yet (Stage 3c):
//   - Missile launch arc, DOM flash overlay, 20s countdown
//   - Screen darken + shockwave at detonation
// ============================================================================

import * as THREE from 'three';
import { scene } from './scene.js';
import { CHAPTERS } from './config.js';

// ---------------------------------------------------------------------------
// LAYOUT — the canonical compound composition.
//
// Silo sits at arena center. The three turrets cluster tight around it in
// an equilateral triangle at radius 8. The powerplant + radio tower are
// placed flanking the compound so the zone disks aren't overlapping the
// turret ring. All positions in world-space (XZ plane).
// ---------------------------------------------------------------------------
export const LAYOUT = {
  silo: { x: 0, z: 0 },

  // Three turrets, 120° apart, pointing north / southwest / southeast. Each
  // turret's POWER-UP zone sits directly on top of its turret — coordinates
  // are mirrored into the zone defs below.
  turrets: [
    { x: 0,                            z: -8 },   // north of silo
    { x: -8 * Math.sin(Math.PI / 3),   z:  8 * Math.cos(Math.PI / 3) },  // SW  (≈ -6.93,  4)
    { x:  8 * Math.sin(Math.PI / 3),   z:  8 * Math.cos(Math.PI / 3) },  // SE  (≈  6.93,  4)
  ],

  // New props introduced in Stage 3a. Placed outside the turret ring (r=8)
  // so their zone disks don't overlap turret footprints, but close enough
  // to the silo that the whole compound reads as one installation.
  powerplant: { x: -14, z: -12 },
  radioTower: { x:  14, z: -12 },
};

// ---------------------------------------------------------------------------
// DORMANT GEOMETRY — silo, powerplant, radio tower.
//
// Everything here is intentionally low-cost: cached materials per chapter
// tint, shared geometries across all three props where possible. Every
// mesh is dormant-dim at chapter start; Stage 3b will add "activate"
// helpers that brighten emissives + add moving parts.
// ---------------------------------------------------------------------------

// Shared geometries.
const SILO_BASE_GEO   = new THREE.CylinderGeometry(2.4, 2.6, 0.5, 10);
const SILO_TUBE_GEO   = new THREE.CylinderGeometry(1.8, 1.8, 4.5, 10, 1, true);
const SILO_CAP_GEO    = new THREE.CylinderGeometry(1.85, 1.85, 0.3, 10);
const SILO_RIM_GEO    = new THREE.TorusGeometry(1.85, 0.16, 6, 16);

const PP_BASE_GEO     = new THREE.BoxGeometry(4.0, 0.4, 3.0);
const PP_STACK_GEO    = new THREE.CylinderGeometry(0.5, 0.6, 3.2, 8);
const PP_BLOCK_GEO    = new THREE.BoxGeometry(1.2, 1.2, 1.2);
const PP_WINDOW_GEO   = new THREE.PlaneGeometry(0.4, 0.4);

const RT_BASE_GEO     = new THREE.BoxGeometry(2.2, 0.4, 2.2);
const RT_MAST_GEO     = new THREE.CylinderGeometry(0.12, 0.18, 5.5, 6);
const RT_STRUT_GEO    = new THREE.BoxGeometry(1.6, 0.08, 0.08);
const RT_BULB_GEO     = new THREE.SphereGeometry(0.22, 8, 6);

// Cached materials keyed by chapter tint.
const _bodyMatCache    = new Map();  // dark metal — same for every chapter
const _accentDimCache  = new Map();  // dim chapter-tint emissive (dormant)
const _rimCache        = new Map();  // small bright accent edges
const _windowDimCache  = new Map();  // powerplant windows when dormant

function _getBodyMat() {
  if (_bodyMatCache.has('_')) return _bodyMatCache.get('_');
  const m = new THREE.MeshStandardMaterial({
    color: 0x2a2a3a,
    roughness: 0.55,
    metalness: 0.6,
  });
  _bodyMatCache.set('_', m);
  return m;
}

function _getAccentDim(tint) {
  let m = _accentDimCache.get(tint);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color: 0x1a1a2a,
      emissive: tint,
      emissiveIntensity: 0.20,
      metalness: 0.4, roughness: 0.55,
    });
    _accentDimCache.set(tint, m);
  }
  return m;
}

function _getRimMat(tint) {
  let m = _rimCache.get(tint);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color: 0x2a2a40,
      emissive: tint,
      emissiveIntensity: 0.6,
      metalness: 0.7, roughness: 0.35,
    });
    _rimCache.set(tint, m);
  }
  return m;
}

function _getWindowDim(tint) {
  let m = _windowDimCache.get(tint);
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      color: tint,
      transparent: true,
      opacity: 0.25,
      side: THREE.DoubleSide,
    });
    _windowDimCache.set(tint, m);
  }
  return m;
}

/** Prewarm every chapter's materials so the wave-2 prop spawn is free. */
export function prewarmWavePropsMats(tint) {
  _getBodyMat();
  _getAccentDim(tint);
  _getRimMat(tint);
  _getWindowDim(tint);
}

// ---------------------------------------------------------------------------
// BUILDERS — return a group positioned at the layout coord. All returned
// groups are parented to the scene inside buildCentralCompound().
// ---------------------------------------------------------------------------

function _buildSilo(tint) {
  const g = new THREE.Group();
  g.position.set(LAYOUT.silo.x, 0, LAYOUT.silo.z);

  // Base plate
  const base = new THREE.Mesh(SILO_BASE_GEO, _getAccentDim(tint));
  base.position.y = 0.25;
  base.castShadow = true;
  base.receiveShadow = true;
  g.add(base);

  // Open tube (the silo shaft — double-sided so the interior is visible)
  const tube = new THREE.Mesh(SILO_TUBE_GEO, _getBodyMat());
  tube.position.y = 2.75;
  g.add(tube);

  // Cap (stage 3b will animate this opening)
  const cap = new THREE.Mesh(SILO_CAP_GEO, _getBodyMat());
  cap.position.y = 5.1;
  cap.castShadow = true;
  g.add(cap);

  // Chapter-tinted rim around the opening — easy readable accent
  const rim = new THREE.Mesh(SILO_RIM_GEO, _getRimMat(tint));
  rim.position.y = 5.25;
  rim.rotation.x = Math.PI / 2;
  g.add(rim);

  scene.add(g);
  return { obj: g, cap, tube, rim };
}

function _buildPowerplant(tint) {
  const g = new THREE.Group();
  g.position.set(LAYOUT.powerplant.x, 0, LAYOUT.powerplant.z);

  const base = new THREE.Mesh(PP_BASE_GEO, _getBodyMat());
  base.position.y = 0.2;
  base.castShadow = true;
  base.receiveShadow = true;
  g.add(base);

  // Two stacks (power station chimneys)
  for (const sx of [-1.2, 1.2]) {
    const stack = new THREE.Mesh(PP_STACK_GEO, _getBodyMat());
    stack.position.set(sx, 2.0, -0.8);
    stack.castShadow = true;
    g.add(stack);
  }

  // Central reactor block
  const reactor = new THREE.Mesh(PP_BLOCK_GEO, _getAccentDim(tint));
  reactor.position.set(0, 1.0, 0.3);
  reactor.castShadow = true;
  g.add(reactor);

  // Window grid (faint emissive dots — becomes "mini city" in Stage 3b)
  const windows = [];
  const windowMat = _getWindowDim(tint);
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 3; col++) {
      const w = new THREE.Mesh(PP_WINDOW_GEO, windowMat);
      w.position.set(-0.5 + col * 0.5, 0.4 + row * 0.5, 0.91);
      g.add(w);
      windows.push(w);
    }
  }

  scene.add(g);
  return { obj: g, reactor, windows };
}

function _buildRadioTower(tint) {
  const g = new THREE.Group();
  g.position.set(LAYOUT.radioTower.x, 0, LAYOUT.radioTower.z);

  const base = new THREE.Mesh(RT_BASE_GEO, _getAccentDim(tint));
  base.position.y = 0.2;
  base.castShadow = true;
  base.receiveShadow = true;
  g.add(base);

  // Central mast
  const mast = new THREE.Mesh(RT_MAST_GEO, _getBodyMat());
  mast.position.y = 3.15;
  mast.castShadow = true;
  g.add(mast);

  // Three cross-struts along the mast
  for (let i = 0; i < 3; i++) {
    const y = 1.8 + i * 1.3;
    const strut = new THREE.Mesh(RT_STRUT_GEO, _getBodyMat());
    strut.position.y = y;
    g.add(strut);
    const strutPerp = strut.clone();
    strutPerp.rotation.y = Math.PI / 2;
    g.add(strutPerp);
  }

  // Beacon bulb at the top (chapter tint, dim by default)
  const bulb = new THREE.Mesh(RT_BULB_GEO, _getRimMat(tint));
  bulb.position.y = 6.0;
  g.add(bulb);

  scene.add(g);
  return { obj: g, bulb };
}

// ---------------------------------------------------------------------------
// LIFECYCLE
// ---------------------------------------------------------------------------

let _current = null;

/**
 * Build the silo, powerplant, and radio tower for the given chapter.
 * Idempotent — a second call tears down the previous compound first.
 * Returns handles to every mesh so stage 3b/3c can animate them.
 */
export function buildCentralCompound(chapterIdx) {
  clearCentralCompound();
  const tint = CHAPTERS[chapterIdx % CHAPTERS.length].full.grid1;
  _current = {
    silo: _buildSilo(tint),
    powerplant: _buildPowerplant(tint),
    radioTower: _buildRadioTower(tint),
  };
  return _current;
}

export function clearCentralCompound() {
  if (!_current) return;
  for (const part of [_current.silo, _current.powerplant, _current.radioTower]) {
    if (part && part.obj && part.obj.parent) scene.remove(part.obj);
  }
  _current = null;
}

/** Handle lookup for future stages (3b will light up the powerplant, etc). */
export function getCompound() { return _current; }
