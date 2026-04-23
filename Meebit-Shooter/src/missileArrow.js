// src/missileArrow.js
//
// GTA-style screen-edge waypoint that points at a world-space target
// (the missile impact site). When the target is on-screen, the arrow sits
// above it. When the target is off-screen, the arrow clamps to the screen
// edge and rotates to point toward it.
//
// The arrow is a flashing DOM overlay (big, bright, hard to miss) with a
// missile icon and a pulsing label. It's intentionally loud — the player
// should feel pulled toward the impact zone.
//
// Public API:
//   showMissileArrow(worldX, worldZ, label)  — start/update the arrow
//   hideMissileArrow()                       — tear it down
//   updateMissileArrow(camera)               — call once per frame while
//                                              the arrow is visible; this
//                                              projects world→screen and
//                                              positions the element.
//
// waves.js calls showMissileArrow while the auto-launch countdown is
// active and while the missile is in flight / counting down. The detonation
// handler calls hideMissileArrow to clear it.

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let _el = null;               // root container
let _arrowEl = null;          // rotating arrow chevron
let _iconEl = null;           // flashing missile icon
let _labelEl = null;          // "INCOMING STRIKE" text
let _distEl = null;           // distance readout
let _targetX = 0;
let _targetZ = 0;
let _visible = false;
let _blinkT = 0;              // drives flash/pulse animation

// Reusable scratch vector for world→screen projection.
const _proj = new THREE.Vector3();

// ---------------------------------------------------------------------------
// DOM construction
// ---------------------------------------------------------------------------

function _build() {
  if (_el) return;

  // Inject stylesheet once — keeps the module self-contained so host HTML
  // doesn't need to know about arrow styling.
  if (!document.getElementById('missile-arrow-styles')) {
    const style = document.createElement('style');
    style.id = 'missile-arrow-styles';
    style.textContent = `
      #missile-arrow-root {
        position: fixed;
        top: 0;
        left: 0;
        width: 80px;
        height: 80px;
        pointer-events: none;
        z-index: 50;
        transform: translate(-50%, -50%);
        display: none;
        font-family: Impact, 'Arial Black', sans-serif;
      }
      #missile-arrow-root.visible { display: block; }
      #missile-arrow-chevron {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        animation: missileArrowPulse 0.45s ease-in-out infinite alternate;
        filter: drop-shadow(0 0 12px #ffd93d) drop-shadow(0 0 24px #ff4444);
      }
      #missile-arrow-chevron svg {
        width: 80px;
        height: 80px;
      }
      #missile-arrow-icon {
        position: absolute;
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%);
        font-size: 36px;
        animation: missileIconBlink 0.55s steps(2) infinite;
        text-shadow:
          0 0 8px #ffd93d,
          0 0 16px #ff6a1a,
          0 0 24px #ff2222,
          2px 2px 0 #000;
      }
      #missile-arrow-label {
        position: absolute;
        top: -34px;
        left: 50%;
        transform: translateX(-50%);
        white-space: nowrap;
        font-size: 14px;
        letter-spacing: 3px;
        color: #ffd93d;
        text-shadow: 0 0 10px #ff4444, 2px 2px 0 #000;
        animation: missileLabelBlink 0.8s ease-in-out infinite alternate;
      }
      #missile-arrow-dist {
        position: absolute;
        bottom: -24px;
        left: 50%;
        transform: translateX(-50%);
        white-space: nowrap;
        font-size: 12px;
        letter-spacing: 2px;
        color: #fff;
        text-shadow: 0 0 8px #000, 1px 1px 0 #000;
        opacity: 0.9;
      }
      @keyframes missileArrowPulse {
        0%   { transform: scale(1.0);   filter: drop-shadow(0 0 12px #ffd93d) drop-shadow(0 0 24px #ff4444); }
        100% { transform: scale(1.15);  filter: drop-shadow(0 0 22px #ffdd55) drop-shadow(0 0 40px #ff6a1a); }
      }
      @keyframes missileIconBlink {
        0%   { opacity: 1;    color: #ffd93d; }
        100% { opacity: 0.25; color: #ff6a1a; }
      }
      @keyframes missileLabelBlink {
        0%   { opacity: 0.7; }
        100% { opacity: 1.0; }
      }
    `;
    document.head.appendChild(style);
  }

  _el = document.createElement('div');
  _el.id = 'missile-arrow-root';
  _el.innerHTML = `
    <div id="missile-arrow-label">INCOMING STRIKE</div>
    <div id="missile-arrow-chevron">
      <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        <!-- Outer arrow shape (big flashy chevron pointing up; we rotate
             the whole chevron via transform to point at the target). -->
        <polygon points="50,8 88,62 64,62 64,92 36,92 36,62 12,62"
                 fill="#ffd93d"
                 stroke="#000"
                 stroke-width="4"
                 stroke-linejoin="round" />
        <polygon points="50,18 78,58 60,58 60,82 40,82 40,58 22,58"
                 fill="#ff6a1a"
                 stroke="none" />
      </svg>
    </div>
    <div id="missile-arrow-icon">🚀</div>
    <div id="missile-arrow-dist"></div>
  `;
  document.body.appendChild(_el);
  _arrowEl = _el.querySelector('#missile-arrow-chevron');
  _iconEl = _el.querySelector('#missile-arrow-icon');
  _labelEl = _el.querySelector('#missile-arrow-label');
  _distEl = _el.querySelector('#missile-arrow-dist');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Show or update the missile arrow. Safe to call every frame — the call
 * is cheap once the DOM is built. `label` sets the headline text above
 * the arrow (defaults to "INCOMING STRIKE").
 */
export function showMissileArrow(worldX, worldZ, label) {
  _build();
  _targetX = worldX;
  _targetZ = worldZ;
  if (label && _labelEl && _labelEl.textContent !== label) {
    _labelEl.textContent = label;
  }
  if (!_visible) {
    _el.classList.add('visible');
    _visible = true;
  }
}

/** Tear down the arrow (hide + leave DOM in place for next activation). */
export function hideMissileArrow() {
  if (!_el) return;
  _el.classList.remove('visible');
  _visible = false;
}

/**
 * Position the arrow on-screen. Call every frame the arrow is visible
 * (main.js renders loop). `camera` is the active THREE camera, `player`
 * is the player object with `.pos.x/.z` (used for the distance readout).
 */
export function updateMissileArrow(camera, player, dt) {
  if (!_visible || !_el || !camera) return;

  _blinkT += dt || 0;

  // World point at ground level above the impact site.
  _proj.set(_targetX, 2.0, _targetZ);
  _proj.project(camera);

  // NDC (-1..1) → normalized 0..1 screen coords.
  let nx = (_proj.x * 0.5) + 0.5;
  let ny = (-_proj.y * 0.5) + 0.5;
  const behind = _proj.z > 1; // past the camera's far plane = offscreen behind

  const w = window.innerWidth;
  const h = window.innerHeight;

  // Margin from screen edge (in px) when clamping.
  const margin = 60;

  // Is the projected point inside the visible viewport?
  const onscreen = !behind && nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1;

  let screenX, screenY, rotationDeg;

  if (onscreen) {
    // Arrow hovers above the impact point. Pointing straight down
    // at the target is conceptually cleaner, but an up-pointing
    // chevron *above* the target reads better ("look here!").
    screenX = nx * w;
    screenY = ny * h - 70; // offset upward so arrow sits above the target
    rotationDeg = 180;     // arrow points downward (toward the target)
  } else {
    // Off-screen: clamp to the screen edge along a ray from screen
    // center to the target, and rotate the arrow to point outward
    // toward the target.
    //
    // If the target is behind the camera, flip the direction so the
    // arrow points the shortest way around to face it.
    let dx = nx - 0.5;
    let dy = ny - 0.5;
    if (behind) { dx = -dx; dy = -dy; }
    // Prevent zero-length direction.
    if (Math.abs(dx) < 1e-4 && Math.abs(dy) < 1e-4) dx = 0.01;

    // Scale the direction so its longest axis just reaches the edge
    // (accounting for margin). This keeps the arrow anchored to the
    // screen boundary closest to the target.
    const scaleX = (0.5 - margin / w) / Math.max(Math.abs(dx), 1e-4);
    const scaleY = (0.5 - margin / h) / Math.max(Math.abs(dy), 1e-4);
    const s = Math.min(scaleX, scaleY);
    const edgeX = 0.5 + dx * s;
    const edgeY = 0.5 + dy * s;
    screenX = edgeX * w;
    screenY = edgeY * h;

    // Rotation: the chevron's natural orientation is "up" (pointing
    // toward screen-top). We want it to point from screen-center
    // outward along (dx, dy). atan2 of (dx, -dy) gives the angle for
    // that direction with 0° = up.
    rotationDeg = Math.atan2(dx, -dy) * 180 / Math.PI;
  }

  // Apply position. translate(-50%, -50%) is baked into the CSS so the
  // element is centered on (screenX, screenY).
  _el.style.left = screenX + 'px';
  _el.style.top = screenY + 'px';
  if (_arrowEl) {
    _arrowEl.style.transform = `rotate(${rotationDeg}deg)`;
  }

  // Distance readout — in world units, which reads as meters. Computed
  // from the player (not the camera) so it matches what the player is
  // actually chasing.
  if (_distEl && player && player.pos) {
    const dxw = _targetX - player.pos.x;
    const dzw = _targetZ - player.pos.z;
    const dist = Math.sqrt(dxw * dxw + dzw * dzw);
    _distEl.textContent = Math.round(dist) + 'm';
  }
}

/** Is the arrow currently active? */
export function isMissileArrowVisible() {
  return _visible;
}
