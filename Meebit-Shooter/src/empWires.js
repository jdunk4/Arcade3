// ============================================================================
// src/empWires.js — powerplant-to-compound wire network.
//
// When POWER completes, wires connecting the powerplant to each of the
// three turrets and the silo energize. Each wire is a thin tube with a
// bright "pulse" traveling along it from powerplant → endpoint, giving a
// visible "energy is flowing" feel. Dormant wires are dim static lines.
//
// Lifecycle:
//   buildWires(chapterIdx) — called from dormantProps.prepareChapter
//                            after LAYOUT is recomputed. Four segments
//                            created: powerplant→turret[0..2] + powerplant→silo.
//   setWiresLit(isLit)     — flipped true from waves.js when POWER zone
//                            completes; flipped false by resetWireAnimations()
//                            when the EMP fires.
//   updateWires(dt, time)  — advances the pulse-travel animation. Called
//                            every frame from main.js.
//   clearWires()           — called from teardownChapter.
// ============================================================================

import * as THREE from 'three';
import { scene } from './scene.js';
import { CHAPTERS } from './config.js';
import { LAYOUT } from './waveProps.js';

// How many individual "pulse" meshes travel along each wire. Each pulse
// is a small glowing sphere that moves from the powerplant end to the
// endpoint, loops back to start when it reaches the end.
const PULSES_PER_WIRE = 3;
const PULSE_TRAVEL_SEC = 1.2;  // seconds for one pulse to cross a wire
const WIRE_HEIGHT = 0.8;       // y-offset so wires don't clip into ground

const WIRE_RADIUS = 0.05;
const WIRE_RADIAL_SEGMENTS = 6;
const PULSE_GEO = new THREE.SphereGeometry(0.22, 8, 6);

// Cached wire/pulse materials per chapter tint.
const _wireDimCache = new Map();
const _wireLitCache = new Map();
const _pulseCache = new Map();

function _getWireDim(tint) {
  let m = _wireDimCache.get(tint);
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      color: tint,
      transparent: true,
      opacity: 0.18,
    });
    _wireDimCache.set(tint, m);
  }
  return m;
}
function _getWireLit(tint) {
  let m = _wireLitCache.get(tint);
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      color: tint,
      transparent: true,
      opacity: 0.9,
    });
    _wireLitCache.set(tint, m);
  }
  return m;
}
function _getPulseMat(tint) {
  let m = _pulseCache.get(tint);
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 1.0,
    });
    // Color tint on the pulse — keep white core + tinted glow via material emissive
    // (MeshBasic doesn't have emissive so we just use the color as-is).
    m.color.setHex(_lerpColor(0xffffff, tint, 0.3));
    _pulseCache.set(tint, m);
  }
  return m;
}

// Returns a hex color blended between a and b (0=a, 1=b). Cheap.
function _lerpColor(a, b, t) {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

export function prewarmWireMats(tint) {
  _getWireDim(tint);
  _getWireLit(tint);
  _getPulseMat(tint);
}

// ---------------------------------------------------------------------------

const wires = [];
let _lit = false;

// Build a straight-line wire from (ax,az) to (bx,bz), elevated at WIRE_HEIGHT.
// The wire is a cylinder oriented along the line; the pulses are small
// spheres that we move along the line each frame.
function _buildWire(ax, az, bx, bz, tint) {
  const dx = bx - ax;
  const dz = bz - az;
  const length = Math.sqrt(dx * dx + dz * dz);
  if (length < 0.001) return null;

  const tube = new THREE.Mesh(
    new THREE.CylinderGeometry(WIRE_RADIUS, WIRE_RADIUS, length, WIRE_RADIAL_SEGMENTS, 1, false),
    _getWireDim(tint),
  );
  // Cylinder default points +Y. Rotate so it lies along the XZ segment.
  const midX = (ax + bx) / 2;
  const midZ = (az + bz) / 2;
  tube.position.set(midX, WIRE_HEIGHT, midZ);
  // Angle in the XZ plane (atan2(dx,dz)) then tilt 90° so cylinder is horizontal.
  tube.rotation.z = Math.PI / 2;
  tube.rotation.y = -Math.atan2(dz, dx);
  scene.add(tube);

  // Build PULSES_PER_WIRE small spheres, staggered along the line's length.
  const pulses = [];
  const pulseMat = _getPulseMat(tint);
  for (let i = 0; i < PULSES_PER_WIRE; i++) {
    const sphere = new THREE.Mesh(PULSE_GEO, pulseMat);
    sphere.visible = false; // hidden until lit
    scene.add(sphere);
    pulses.push(sphere);
  }

  return {
    ax, az, bx, bz, length,
    tube, pulses, tint,
    // Per-pulse phase 0..1 (fraction along the wire), staggered at init.
    pulsePhases: pulses.map((_, i) => i / PULSES_PER_WIRE),
  };
}

/**
 * Build all 4 wires for the current chapter: powerplant→turret0, ...→turret1,
 * ...→turret2, ...→silo. Reads LAYOUT fresh so it picks up the triangulated
 * coordinates.
 */
export function buildWires(chapterIdx) {
  clearWires();
  const tint = CHAPTERS[chapterIdx % CHAPTERS.length].full.grid1;
  const pp = LAYOUT.powerplant;

  for (const t of LAYOUT.turrets) {
    const w = _buildWire(pp.x, pp.z, t.x, t.z, tint);
    if (w) wires.push(w);
  }
  const w = _buildWire(pp.x, pp.z, LAYOUT.silo.x, LAYOUT.silo.z, tint);
  if (w) wires.push(w);
}

export function clearWires() {
  for (const w of wires) {
    if (w.tube && w.tube.parent) scene.remove(w.tube);
    for (const p of w.pulses) if (p.parent) scene.remove(p);
  }
  wires.length = 0;
  _lit = false;
}

/** Flip wires to lit (pulses visible, tube material bright) or back to dim. */
export function setWiresLit(isLit) {
  _lit = !!isLit;
  for (const w of wires) {
    w.tube.material = _lit ? _getWireLit(w.tint) : _getWireDim(w.tint);
    for (const p of w.pulses) p.visible = _lit;
  }
}

/** Reset wires to dormant (called from the EMP teardown path alongside
 *  resetCompoundAnimations). */
export function resetWireAnimations() {
  setWiresLit(false);
}

/** Per-frame pulse travel. */
export function updateWires(dt, time) {
  if (!_lit || wires.length === 0) return;
  const step = dt / PULSE_TRAVEL_SEC;
  for (const w of wires) {
    for (let i = 0; i < w.pulses.length; i++) {
      let ph = w.pulsePhases[i] + step;
      if (ph > 1) ph -= 1;
      w.pulsePhases[i] = ph;
      // Position pulse at (ax,az) + ph*(bx-ax, bz-az)
      const x = w.ax + (w.bx - w.ax) * ph;
      const z = w.az + (w.bz - w.az) * ph;
      const sphere = w.pulses[i];
      sphere.position.set(x, WIRE_HEIGHT, z);
      // Fade at the ends for a softer arrive/leave visual.
      const fade = Math.sin(ph * Math.PI);  // 0→1→0 across the wire
      sphere.material.opacity = 0.5 + fade * 0.5;
    }
  }
}
