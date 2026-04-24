// Gamepad / controller support.
//
// Polls the Gamepad API every frame (controllers don't dispatch events the
// way keyboards do — you have to poll navigator.getGamepads() from the game
// loop). Feeds state into the same `mouse`/`keys`/`joyState` structures the
// existing input handlers read from so the rest of the game doesn't need
// to know a gamepad exists.
//
// Mapping (standard xbox-style layout):
//   Left stick    → movement (joyState-style dx/dy)
//   Right stick   → aim direction (screen-space), sets mouse.worldX/worldZ
//                   projected forward from the player
//   Right trigger → fire (mouse.down)
//   A button      → dash (Space)
//   X button      → toggle pickaxe (Q)
//   B button      → throw grenade (G)
//   Y button      → swap weapon forward
//   LB / RB       → previous / next weapon in owned list
//   Start         → pause (Escape)
//
// Also manages a small on-screen indicator that appears briefly the first
// time a controller is connected, so the player knows the game saw it.

import * as THREE from 'three';
import { keys, mouse, joyState, S } from './state.js';

const DEADZONE = 0.18;            // ignore tiny stick drift
const TRIGGER_THRESHOLD = 0.35;   // how far the trigger must press to count as "down"
const AIM_DISTANCE = 12;          // how far in front of the player the aim point lives

let _connected = false;
let _prevButtons = [];            // edge-detection for button presses
let _indicatorEl = null;
let _indicatorTimer = 0;
let _player = null;               // injected reference so we can compute aim world position
let _onDash = null;
let _onTogglePickaxe = null;
let _onGrenade = null;
let _onCycleWeapon = null;        // (direction) => void, 1 or -1
let _onPause = null;
let _onDirectWeapon = null;       // (slotKey) => void — A/B/X/Y could map if we wanted

/**
 * Initialize gamepad support. Wires up the connect/disconnect events and
 * creates the on-screen indicator DOM. Call once at startup.
 *
 * @param {object} opts
 *   player         — the player object (read pos/facing for aim projection)
 *   onDash         — callback when A is pressed
 *   onTogglePickaxe — callback when X is pressed
 *   onGrenade      — callback when B is pressed
 *   onCycleWeapon  — callback (dir) for LB/RB
 *   onPause        — callback for Start
 */
export function initGamepad(opts = {}) {
  _player = opts.player || null;
  _onDash = opts.onDash || null;
  _onTogglePickaxe = opts.onTogglePickaxe || null;
  _onGrenade = opts.onGrenade || null;
  _onCycleWeapon = opts.onCycleWeapon || null;
  _onPause = opts.onPause || null;
  _onDirectWeapon = opts.onDirectWeapon || null;

  window.addEventListener('gamepadconnected', (e) => {
    console.info('[gamepad] connected:', e.gamepad.id);
    _connected = true;
    _showIndicator('CONTROLLER CONNECTED', 2.5);
  });
  window.addEventListener('gamepaddisconnected', (e) => {
    console.info('[gamepad] disconnected:', e.gamepad.id);
    // If no other pad is plugged in, mark us as disconnected.
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let anyStill = false;
    for (const p of pads) if (p && p.connected) { anyStill = true; break; }
    _connected = anyStill;
    if (!anyStill) _showIndicator('CONTROLLER DISCONNECTED', 2.0);
  });

  _ensureIndicator();
}

/**
 * Call once per frame from the main game loop BEFORE input-consuming code
 * runs. Reads the first connected pad, writes into joyState/mouse/keys and
 * fires edge-triggered callbacks for the buttons.
 */
export function updateGamepad(dt) {
  if (_indicatorTimer > 0) {
    _indicatorTimer -= dt;
    if (_indicatorTimer <= 0 && _indicatorEl) _indicatorEl.style.opacity = '0';
  }

  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  if (!pads) return;

  let pad = null;
  for (const p of pads) {
    if (p && p.connected) { pad = p; break; }
  }
  if (!pad) {
    // No pad — leave everything alone. If we had been feeding joyState, clear
    // it so residual stick values don't keep the player walking.
    if (joyState._gamepadDriven) {
      joyState.active = false;
      joyState.dx = 0;
      joyState.dy = 0;
      joyState._gamepadDriven = false;
    }
    return;
  }

  // --- Left stick → movement ---
  // Standard mapping: axes[0]=LX, axes[1]=LY, axes[2]=RX, axes[3]=RY
  const lx = _deadzone(pad.axes[0] || 0);
  const ly = _deadzone(pad.axes[1] || 0);
  if (lx !== 0 || ly !== 0) {
    // Drive the existing joyState so updatePlayer() picks it up for free.
    joyState.active = true;
    joyState.dx = lx;
    joyState.dy = ly;
    joyState._gamepadDriven = true;
  } else if (joyState._gamepadDriven) {
    joyState.active = false;
    joyState.dx = 0;
    joyState.dy = 0;
    joyState._gamepadDriven = false;
  }

  // --- Right stick → aim ---
  // If the right stick is pushed, project an aim point ahead of the player
  // along the stick direction and write it into mouse.worldX/Z. The rest of
  // the game reads those for facing + firing direction.
  const rx = _deadzone(pad.axes[2] || 0);
  const ry = _deadzone(pad.axes[3] || 0);
  if ((rx !== 0 || ry !== 0) && _player && _player.pos) {
    // Normalize so aim doesn't vary with push magnitude — we just want a
    // direction. Magnitude is used only to tell "is the player aiming at all".
    const mag = Math.sqrt(rx * rx + ry * ry);
    const dx = rx / mag;
    const dz = ry / mag;       // down-stick is +Y which corresponds to +Z in world (toward camera)
    mouse.worldX = _player.pos.x + dx * AIM_DISTANCE;
    mouse.worldZ = _player.pos.z + dz * AIM_DISTANCE;
    mouse._gamepadAiming = true;
  }
  // When the right stick is released we *don't* clear the aim — the player
  // (or the auto-aim in updatePlayer for touch/joystick) will keep using
  // whatever target was last set. Auto-aim onto nearest enemy kicks in in
  // updatePlayer() whenever joyState.active is true, so release of the stick
  // cleanly transitions to snap-to-nearest without extra work here.

  // --- Right trigger → fire ---
  // Xbox-style: buttons[7] is RT with a value 0..1.
  const rt = pad.buttons[7] ? pad.buttons[7].value : 0;
  const rtDown = rt > TRIGGER_THRESHOLD;
  // Don't stomp the mouse button — only raise mouse.down. If mouse was
  // already held via the left mouse button, we OR with that (we never
  // clear it unless the trigger release is the one that pushed it down).
  if (rtDown) {
    mouse.down = true;
    mouse._gamepadFire = true;
  } else if (mouse._gamepadFire) {
    // The gamepad was holding it last frame but released now.
    mouse.down = false;
    mouse._gamepadFire = false;
  }

  // --- Buttons (edge-triggered) ---
  // Standard mapping:
  //   0=A 1=B 2=X 3=Y 4=LB 5=RB 6=LT 7=RT 8=Back 9=Start 10=LS 11=RS
  //   12=Up 13=Down 14=Left 15=Right
  const btn = pad.buttons;
  const pressedThisFrame = (i) => btn[i] && btn[i].pressed && !_prevButtons[i];

  if (pressedThisFrame(0) && _onDash) _onDash();            // A → dash
  if (pressedThisFrame(1) && _onGrenade) _onGrenade();      // B → grenade
  if (pressedThisFrame(2) && _onTogglePickaxe) _onTogglePickaxe(); // X → pickaxe
  if (pressedThisFrame(9) && _onPause) _onPause();          // Start → pause
  if (pressedThisFrame(4) && _onCycleWeapon) _onCycleWeapon(-1); // LB
  if (pressedThisFrame(5) && _onCycleWeapon) _onCycleWeapon(+1); // RB

  // D-pad — also cycles weapons for players who prefer it.
  if (pressedThisFrame(14) && _onCycleWeapon) _onCycleWeapon(-1);
  if (pressedThisFrame(15) && _onCycleWeapon) _onCycleWeapon(+1);

  // Save button states for next frame's edge detection.
  for (let i = 0; i < btn.length; i++) {
    _prevButtons[i] = btn[i] && btn[i].pressed;
  }
}

export function gamepadConnected() {
  return _connected;
}

// ----------------------------------------------------------------------------
//  HELPERS
// ----------------------------------------------------------------------------

function _deadzone(v) {
  if (Math.abs(v) < DEADZONE) return 0;
  // Rescale so stick response starts at 0 just past the deadzone instead of
  // jumping from 0 to DEADZONE. Keeps precise walking feel.
  const sign = v < 0 ? -1 : 1;
  return sign * ((Math.abs(v) - DEADZONE) / (1 - DEADZONE));
}

function _ensureIndicator() {
  if (_indicatorEl) return;
  _indicatorEl = document.createElement('div');
  _indicatorEl.id = 'gamepad-indicator';
  _indicatorEl.style.cssText = [
    'position: fixed',
    'left: 50%',
    'top: 80px',
    'transform: translateX(-50%)',
    'padding: 8px 18px',
    'background: rgba(0,20,10,0.85)',
    'border: 2px solid #00ff66',
    'color: #00ff66',
    'font-family: "Impact", monospace',
    'font-size: 14px',
    'letter-spacing: 3px',
    'text-shadow: 0 0 6px #00ff66',
    'box-shadow: 0 0 20px rgba(0,255,102,0.4)',
    'z-index: 50',
    'opacity: 0',
    'transition: opacity 0.3s',
    'pointer-events: none',
  ].join(';');
  document.body.appendChild(_indicatorEl);
}

function _showIndicator(text, seconds) {
  _ensureIndicator();
  _indicatorEl.textContent = '🎮 ' + text;
  _indicatorEl.style.opacity = '1';
  _indicatorTimer = seconds;
}
