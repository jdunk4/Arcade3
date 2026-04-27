// =====================================================================
// TUTORIAL MODE
// =====================================================================
// A practice arena that mirrors the real game layout but swaps the floor
// for a rainbow grid of numbered tiles (think: Copic-marker color caps).
// Orange sits in the upper-left corner; the gradient sweeps clockwise
// through yellow → green → blue → purple to the opposite corner.
// All enemies in tutorial mode are forced black or white so they read
// clearly against the rainbow floor. Player gets every weapon unlocked
// from the start so they can practice cycling through the arsenal.
//
// Public API:
//   isTutorialActive()   → boolean
//   setTutorialActive(b) → set the flag (called by main.js)
//   applyTutorialFloor() → swap the ground material to the rainbow texture
//   restoreNormalFloor() → restore the original checker texture
//   tutorialEnemyColor(defaultTint) → returns either 0x000000 or 0xffffff
//                                      to override per-spawn enemy tints
//   tutorialSpawnRateOverride(defaultRate) → clamps the spawn rate to 1..2
//                                            for the chill tutorial pace
// =====================================================================

import * as THREE from 'three';
import { ARENA } from './config.js';
import { Scene } from './scene.js';

let _active = false;
let _originalTexture = null;     // saved checker texture so we can restore
let _rainbowTexture = null;      // built once, cached
let _rainbowMaterial = null;     // optional: a parallel material we swap in

export function isTutorialActive() { return _active; }
export function setTutorialActive(b) { _active = !!b; }

// ---------------------------------------------------------------------
// Build the rainbow floor texture — Hues & Cues style, sized to match
// the game arena.
//
// The game floor is square (PlaneGeometry(ARENA*2, ARENA*2) = 100×100
// units) and the engine renders a 40×40 GridHelper overlay on top.
// We build a SQUARE texture with a 20×20 tile grid so:
//   • The texture's aspect ratio matches the floor — no stretching.
//   • Each tutorial tile aligns with a 2×2 block of game grid cells,
//     so the in-game grid lines visibly subdivide every tutorial
//     tile evenly.
//
// Layout:
//   • 20 columns × 20 rows of color tiles. No grayscale strip on top
//     (per user direction: ignore the black/white strip).
//   • Row letters A..T labeled on the LEFT and RIGHT edges.
//   • Column numbers 1..20 labeled on the TOP and BOTTOM edges.
//   • Tiles themselves are unlabeled — like the reference board, only
//     the borders carry labels.
//
// Color computation (unchanged from previous iteration):
//   The reference board flows the rainbow DIAGONALLY. Red top-left,
//   purple top-right, yellow-green bottom-left, cyan bottom-right.
//   Every tile is a bilinear RGB blend of the four corner colors,
//   re-saturated to keep mid-tones vivid (raw bilerp lands on gray),
//   then nudged toward white in the F–J pastel band.
//
// Orange → purple constraint still holds: red/orange dominates the
// left side of the board, purple lives on the right.
// ---------------------------------------------------------------------
const GRID_COLS = 20;
const GRID_ROWS = 20;
// Square texture so it maps 1:1 onto the square floor plane.
// Border eats some pixels for the letter/number rails; cell pixels
// are derived from what's left.
const BORDER_PX = 90;
const CELL_PX = 130;                                  // 20 × 130 = 2600 inner
const TEX_W = GRID_COLS * CELL_PX + BORDER_PX * 2;    // 2780
const TEX_H = GRID_ROWS * CELL_PX + BORDER_PX * 2;    // 2780 (square)

// Four corner colors. Eyeballed from the reference photo.
//   TL = top-left     = deep red
//   TR = top-right    = purple/violet
//   BL = bottom-left  = yellow-green / lemon
//   BR = bottom-right = cyan/sky-blue
// Stored as RGB so we can interpolate linearly and avoid hue-wraparound
// discontinuities that bite us when adjacent corners take different
// short paths around the color wheel. Corners are pumped fairly
// saturated so the bilinear mid-tones don't sink to mud.
const CORNERS = {
  TL: { r: 230, g:  30, b:  60 },   // red
  TR: { r: 175, g:  60, b: 220 },   // purple
  BL: { r: 215, g: 230, b:  50 },   // yellow-green
  BR: { r:  60, g: 210, b: 230 },   // cyan
};

function lerp(a, b, t) { return a + (b - a) * t; }

function bilerpRGB(u, v) {
  const r = lerp(lerp(CORNERS.TL.r, CORNERS.TR.r, u),
                 lerp(CORNERS.BL.r, CORNERS.BR.r, u), v);
  const g = lerp(lerp(CORNERS.TL.g, CORNERS.TR.g, u),
                 lerp(CORNERS.BL.g, CORNERS.BR.g, u), v);
  const b = lerp(lerp(CORNERS.TL.b, CORNERS.TR.b, u),
                 lerp(CORNERS.BL.b, CORNERS.BR.b, u), v);
  return { r, g, b };
}

// Push a color toward white by amount t in [0..1]. Used for the
// pastel mid-band.
function tintWhite(rgb, t) {
  return {
    r: rgb.r + (255 - rgb.r) * t,
    g: rgb.g + (255 - rgb.g) * t,
    b: rgb.b + (255 - rgb.b) * t,
  };
}

// Push a color away from gray to keep saturation up. amount in [0..1].
// Boosts the distance from the per-pixel grayscale value.
function saturate(rgb, amount) {
  const gray = (rgb.r + rgb.g + rgb.b) / 3;
  return {
    r: Math.max(0, Math.min(255, gray + (rgb.r - gray) * (1 + amount))),
    g: Math.max(0, Math.min(255, gray + (rgb.g - gray) * (1 + amount))),
    b: Math.max(0, Math.min(255, gray + (rgb.b - gray) * (1 + amount))),
  };
}

function buildRainbowTexture() {
  const c = document.createElement('canvas');
  c.width = TEX_W;
  c.height = TEX_H;
  const ctx = c.getContext('2d');

  // Black border for the letter/number rails.
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, TEX_W, TEX_H);

  // Build the color cells.
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const u = col / (GRID_COLS - 1);   // horizontal: 0=left, 1=right
      const v = row / (GRID_ROWS - 1);   // vertical:   0=top,  1=bottom

      // Bilinear RGB blend between the four corner colors. This keeps
      // the gradient smooth across the whole board — no hue-wraparound
      // jumps you'd get from interpolating in HSL space.
      let color = bilerpRGB(u, v);

      // Re-saturate. RGB bilinear interpolation produces muddy mid-
      // tones because complementary corner colors average toward gray.
      // Push the result back out from gray so the middle band stays
      // vivid pinks/mauves/pale-greens like the reference.
      color = saturate(color, 0.35);

      // Pastel band: push toward white in the F–J row range (v ≈
      // 0.33–0.6). The reference shows a clear bright belt across the
      // middle of the board; this mimics that without flattening the
      // dark top rows or deep bottom rows.
      const peak = 0.45;
      const dist = Math.abs(v - peak);
      const whiteAmt = Math.max(0, 0.35 - dist * 0.95);
      color = tintWhite(color, whiteAmt);

      const rr = Math.round(color.r);
      const gg = Math.round(color.g);
      const bb = Math.round(color.b);
      ctx.fillStyle = `rgb(${rr},${gg},${bb})`;
      const px = BORDER_PX + col * CELL_PX;
      const py = BORDER_PX + row * CELL_PX;
      ctx.fillRect(px, py, CELL_PX, CELL_PX);
    }
  }

  // Border labels — column numbers (top + bottom) and row letters
  // (left + right). White on the black border, just like the
  // reference.
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Column numbers, top + bottom.
  ctx.font = `bold ${Math.floor(BORDER_PX * 0.45)}px "Impact", "Arial Black", sans-serif`;
  for (let col = 0; col < GRID_COLS; col++) {
    const cx = BORDER_PX + (col + 0.5) * CELL_PX;
    const label = String(col + 1);
    ctx.fillText(label, cx, BORDER_PX / 2);
    ctx.fillText(label, cx, TEX_H - BORDER_PX / 2);
  }

  // Row letters, left + right.
  const LETTERS = 'ABCDEFGHIJKLMNOPQRST';
  ctx.font = `bold ${Math.floor(BORDER_PX * 0.55)}px "Impact", "Arial Black", sans-serif`;
  for (let row = 0; row < GRID_ROWS; row++) {
    const cy = BORDER_PX + (row + 0.5) * CELL_PX;
    const ch = LETTERS[row];
    ctx.fillText(ch, BORDER_PX / 2, cy);
    ctx.fillText(ch, TEX_W - BORDER_PX / 2, cy);
  }

  // Thin grid lines between cells so the tiles still read as a grid
  // even in low-light wave themes.
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= GRID_COLS; i++) {
    const x = BORDER_PX + i * CELL_PX;
    ctx.beginPath();
    ctx.moveTo(x, BORDER_PX);
    ctx.lineTo(x, TEX_H - BORDER_PX);
    ctx.stroke();
  }
  for (let i = 0; i <= GRID_ROWS; i++) {
    const y = BORDER_PX + i * CELL_PX;
    ctx.beginPath();
    ctx.moveTo(BORDER_PX, y);
    ctx.lineTo(TEX_W - BORDER_PX, y);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(c);
  // No tiling — one giant texture maps 1:1 onto the floor plane so each
  // canvas cell is one arena cell.
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.repeat.set(1, 1);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------
// Apply / restore the floor material. We don't replace the mesh — just
// swap the texture on the existing groundMat. That keeps shadows, fog,
// and lighting all unchanged.
// ---------------------------------------------------------------------
export function applyTutorialFloor() {
  if (!Scene || !Scene.groundMat) return;
  if (!_rainbowTexture) _rainbowTexture = buildRainbowTexture();
  if (!_originalTexture) _originalTexture = Scene.groundMat.map;
  Scene.groundMat.map = _rainbowTexture;
  // Reset the base color tint so the rainbow shows true to its hues
  // instead of being multiplied by the chapter's lamp color.
  Scene.groundMat.color.setHex(0xffffff);
  Scene.groundMat.needsUpdate = true;

  // Leave the chapter grid overlay at its native opacity. The texture
  // is now sized so each rainbow tile is a 2×2 block of game grid
  // cells — letting the overlay draw on top adds a subtle subdivision
  // that visually anchors the floor to the same grid the rest of the
  // game uses for collisions and movement.
}

export function restoreNormalFloor() {
  if (!Scene || !Scene.groundMat) return;
  if (_originalTexture) {
    Scene.groundMat.map = _originalTexture;
    Scene.groundMat.needsUpdate = true;
    _originalTexture = null;
  }
  if (Scene.gridHelper && Scene.gridHelper.material) {
    Scene.gridHelper.material.opacity = 0.15;
    Scene.gridHelper.material.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------
// Enemy color override — every tutorial enemy is either black or white,
// alternating randomly so they pop on every region of the rainbow floor.
// ---------------------------------------------------------------------
export function tutorialEnemyColor(_defaultTint) {
  // Even split. Black reads strongly on the lighter (yellow/green) tiles;
  // white reads strongly on the deeper (blue/purple/orange) ones.
  return Math.random() < 0.5 ? 0x000000 : 0xffffff;
}

// ---------------------------------------------------------------------
// Spawn rate clamp — keep tutorial chill at 1..2 spawns/sec regardless
// of what the underlying wave def asks for.
// ---------------------------------------------------------------------
export function tutorialSpawnRateOverride(defaultRate) {
  // Always return something in [1, 2]. If the wave's native rate is
  // already in that band we leave it alone; otherwise we clamp.
  if (defaultRate >= 1 && defaultRate <= 2) return defaultRate;
  return Math.max(1, Math.min(2, defaultRate || 1.5));
}
