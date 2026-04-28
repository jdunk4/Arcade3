// heroHexagons.js — Three small pointy-top hexagonal HUD tiles in the
// top-left of the screen, each holding a hero portrait. Categories
// are PIXL PAL, FLINGER, and GOB — three NPC archetypes the player
// "encounters" thematically each chapter. Tiles refresh on chapter
// transitions; portraits change to that chapter's palette color.
//
// Per spec:
//   - Pointy-top hexagons (point on top/bottom, flat left/right)
//   - Small footprint (52×60 each, 3 across with gaps ≈ 180×60 total)
//   - Anchored top-left at the very top of the screen
//   - Decorative only (no click/hover interactions)
//   - Updates on chapter transition, persists for the chapter
//   - Image asset paths pulled from the repo's PNGs/ structure:
//       /assets/PNGs/PIXL%20PALs/PIXL%20{COLOR}.png
//       /assets/PNGs/Flingers/FLINGER%20{COLOR}.jpg   (note: jpg)
//       /assets/PNGs/Gobs/{COLOR}%20GOB.png
//   - Filename casing/spacing varies by category so each is encoded
//     individually below.
//   - Spec note: Gobs has no PURP variant yet; chapter 6 (PARADISE)
//     falls back to BLUE GOB until a PURP GOB asset is added.

// Chapter index → color name lookup. Matches the chapter palette
// theming as closely as possible:
//   0 INFERNO  → ORANGE
//   1 CRIMSON  → RED
//   2 SOLAR    → YELLOW
//   3 TOXIC    → GREEN
//   4 ARCTIC   → BLUE
//   5 PARADISE → PURP (Pixl Pals + Flingers); BLUE for Gobs (no PURP yet)
const _CHAPTER_TO_COLOR = ['ORANGE', 'RED', 'YELLOW', 'GREEN', 'BLUE', 'PURP'];

// Per-category fallback when the chapter color doesn't exist in that
// category's asset set. Currently only Gobs needs this (no PURP).
const _GOB_COLOR_FALLBACK = { 'PURP': 'BLUE' };

function _gobColor(chapterIdx) {
  const c = _CHAPTER_TO_COLOR[chapterIdx % _CHAPTER_TO_COLOR.length];
  return _GOB_COLOR_FALLBACK[c] || c;
}

// Build the asset URL for each category. URL-encode the spaces.
function _pixlSrc(chapterIdx) {
  const c = _CHAPTER_TO_COLOR[chapterIdx % _CHAPTER_TO_COLOR.length];
  return `assets/PNGs/PIXL%20PALs/PIXL%20${c}.png`;
}
function _flingerSrc(chapterIdx) {
  const c = _CHAPTER_TO_COLOR[chapterIdx % _CHAPTER_TO_COLOR.length];
  return `assets/PNGs/Flingers/FLINGER%20${c}.jpg`;
}
function _gobSrc(chapterIdx) {
  const c = _gobColor(chapterIdx);
  return `assets/PNGs/Gobs/${c}%20GOB.png`;
}

// Flat-top hexagonal clip-path. Flat top edge (25%-75%), points at
// left (0%, 50%) and right (100%, 50%), flat bottom edge (25%-75%).
// This matches image 2's reference cluster — earlier version used
// pointy-top by mistake (I confused myself reading the reference).
const _HEX_CLIP = 'polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)';

// Single hex cell dimensions — flat-top, point-to-point WIDTH 60px,
// flat-to-flat HEIGHT ≈ 52px (regular hex ratio H = W × √3/2).
// Note this is the OPPOSITE aspect from pointy-top: flat-top is
// wider than tall.
const _CELL_W = 60;
const _CELL_H = 52;

// Honeycomb cluster layout — 3 hexes touching at edges per image 2
// reference. For FLAT-top hexes, two diagonally-adjacent hexes nest
// when the second is offset by (W*0.75, H*0.5) from the first.
// Vertically-adjacent hexes (sharing a horizontal edge) offset by
// (0, H). Cluster shape from image 2:
//
//    ●         ← cell 0 (top-left), at (0, 0)
//      ●       ← cell 1 (middle-right), at (W*0.75, H*0.5)
//    ●         ← cell 2 (bottom-left), at (0, H)
//
// Container size: width = W + W*0.75 = W*1.75, height = H + H*0.5 = H*1.5.
const _CLUSTER_W = Math.round(_CELL_W * 1.75);
const _CLUSTER_H = Math.round(_CELL_H * 1.5);

// Per-cell positions (top-left corner of each hex, in container coords).
const _CELL_POSITIONS = [
  { left: 0,                          top: 0 },                      // top-left
  { left: Math.round(_CELL_W * 0.75), top: Math.round(_CELL_H * 0.5) }, // middle-right
  { left: 0,                          top: _CELL_H },                  // bottom-left
];

// Module state
let _root = null;
let _tiles = null;     // { pixl: {wrap, img, active}, flinger: {...}, gob: {...} }
let _currentChapter = -1;

// Active-state CSS — applied to the wrap (rim) and imgBox (portrait
// container). Inactive = desaturated grey-out filter on the IMG +
// dimmed rim opacity. Active = full saturation + full bright rim +
// pulsing glow.
const _ACTIVE_FILTER   = 'none';
const _INACTIVE_FILTER = 'grayscale(0.95) brightness(0.55) contrast(0.85)';
const _ACTIVE_RIM_OPACITY   = '1';
const _INACTIVE_RIM_OPACITY = '0.4';

/**
 * Build the DOM scaffold once. Idempotent — second call is a no-op.
 * Tiles start hidden; first call to updateHeroHexagons() reveals them.
 */
export function initHeroHexagons() {
  if (_root) return;
  _root = document.createElement('div');
  _root.id = 'hero-hexagons';
  // Position to the RIGHT of the potion/grenade chip stack (which sits
  // at left:16px and is roughly 140px wide). Aligned to the top of
  // that stack (top:80px) so the cluster sits flush with it.
  // Critically: NOT overlapping the killstreak counter (top:16px,
  // left:16px) which sits above the inventory widgets.
  _root.style.cssText = [
    'position: fixed',
    'top: 80px',
    'left: 160px',
    `width: ${_CLUSTER_W}px`,
    `height: ${_CLUSTER_H}px`,
    'pointer-events: none',
    'z-index: 25',                   // above HUD chips, below modals
    'opacity: 0',                     // fade in once first chapter is set
    'transition: opacity 0.4s ease-out',
  ].join(';');

  _tiles = {
    pixl:    _makeTile('pixl',    _CELL_POSITIONS[0]),
    flinger: _makeTile('flinger', _CELL_POSITIONS[1]),
    gob:     _makeTile('gob',     _CELL_POSITIONS[2]),
  };
  _root.appendChild(_tiles.pixl.wrap);
  _root.appendChild(_tiles.flinger.wrap);
  _root.appendChild(_tiles.gob.wrap);
  document.body.appendChild(_root);
}

function _makeTile(category, pos) {
  // Outer wrap — provides the hexagonal clip + a glowing border via
  // a pseudo-element trick. We use TWO stacked clipped divs:
  //   - Outer (wrap): slightly larger, tinted background — acts as
  //     the visible "border" once the inner is masked.
  //   - Inner (imgBox): clipped one pixel smaller, contains the IMG.
  // Result: a thin tinted rim around the portrait.
  //
  // Active vs inactive state controlled via .filter on the imgBox
  // (greyscale+dim when inactive) and .opacity on the wrap rim.
  // Transitions tied to a 0.4s ease-out so the "charge up" reads as
  // animated when the corresponding ally activates.
  const wrap = document.createElement('div');
  wrap.className = 'hero-hex hero-hex-' + category;
  wrap.style.cssText = [
    'position: absolute',                     // honeycomb cluster cell
    `left: ${pos.left}px`,
    `top: ${pos.top}px`,
    `width: ${_CELL_W}px`,
    `height: ${_CELL_H}px`,
    `clip-path: ${_HEX_CLIP}`,
    'background: rgba(255, 255, 255, 0.85)',   // border color, retinted in update
    `opacity: ${_INACTIVE_RIM_OPACITY}`,        // start dim (charging)
    'transition: background-color 0.5s ease-out, opacity 0.4s ease-out',
  ].join(';');

  const imgBox = document.createElement('div');
  imgBox.style.cssText = [
    'position: absolute',
    'inset: 2px',                              // 2px inset = visible rim
    `clip-path: ${_HEX_CLIP}`,
    'background: rgba(0, 0, 0, 0.55)',          // dark backdrop behind portrait
    'overflow: hidden',
    `filter: ${_INACTIVE_FILTER}`,              // start desaturated (charging)
    'transition: filter 0.4s ease-out',
  ].join(';');

  const img = document.createElement('img');
  img.style.cssText = [
    'width: 100%',
    'height: 100%',
    'object-fit: cover',                        // crop to hex shape
    'display: block',
    'pointer-events: none',
    'user-select: none',
  ].join(';');
  img.alt = '';
  img.draggable = false;

  imgBox.appendChild(img);
  wrap.appendChild(imgBox);
  return { wrap, imgBox, img, active: false };
}

/**
 * Update tiles to reflect the current chapter. Called on chapter
 * transition. Idempotent if the chapter hasn't changed.
 *
 * @param {number} chapterIdx 0-based chapter index
 * @param {number} [tintHex]  optional chapter rim color (hex int).
 *                            Defaults to white if not provided.
 */
export function updateHeroHexagons(chapterIdx, tintHex) {
  if (!_root) initHeroHexagons();
  if (chapterIdx === _currentChapter) return;
  _currentChapter = chapterIdx;

  // Swap sources. Browser caches identical URLs so flicker is
  // minimal; the .src assignment triggers a fresh fetch only when
  // the URL actually changes (chapter transition).
  _tiles.pixl.img.src    = _pixlSrc(chapterIdx);
  _tiles.flinger.img.src = _flingerSrc(chapterIdx);
  _tiles.gob.img.src     = _gobSrc(chapterIdx);

  // Retint the rim to the chapter color if provided. Convert hex
  // int to a CSS color string. Without a tint, fall back to a
  // neutral white-ish rim so the hex is still visible.
  if (typeof tintHex === 'number') {
    const cssColor = '#' + tintHex.toString(16).padStart(6, '0');
    for (const t of [_tiles.pixl, _tiles.flinger, _tiles.gob]) {
      t.wrap.style.background = cssColor;
      // Adds a subtle outer glow that matches the rim, tying the
      // tile into the chapter palette without overpowering.
      t.wrap.style.boxShadow = `0 0 10px ${cssColor}88`;
    }
  }

  // Reveal on first update. Does nothing on subsequent calls.
  _root.style.opacity = '1';
}

/**
 * Show or hide the hexagon cluster. Use to suppress during cinematics,
 * boss intros, etc.
 */
export function setHeroHexagonsVisible(visible) {
  if (!_root) return;
  _root.style.display = visible ? 'block' : 'none';
}

/**
 * Tear down completely (e.g., on game restart). After clearing, the
 * next initHeroHexagons() will rebuild from scratch.
 */
export function clearHeroHexagons() {
  if (_root && _root.parentNode) _root.parentNode.removeChild(_root);
  _root = null;
  _tiles = null;
  _currentChapter = -1;
}

/**
 * Set whether a given hex is "active" (lit, full color) or "charging"
 * (greyscale + dim rim). Idempotent — re-setting the same state is
 * a no-op so this is cheap to call every wave/chapter transition.
 *
 * @param {'pixl'|'flinger'|'gob'} category
 * @param {boolean} active
 */
export function setHeroHexActive(category, active) {
  if (!_tiles) return;
  const t = _tiles[category];
  if (!t) return;
  if (t.active === active) return;
  t.active = active;
  t.imgBox.style.filter = active ? _ACTIVE_FILTER : _INACTIVE_FILTER;
  t.wrap.style.opacity  = active ? _ACTIVE_RIM_OPACITY : _INACTIVE_RIM_OPACITY;
}

/**
 * Drive all three hex active states based on the local wave index
 * (1..5 within the current chapter). Activation rules:
 *   - FLINGER  : wave >= 2  (player gets flinger charges from wave 2)
 *   - PIXL PAL : wave >= 5  (auto-deploys during the boss fight)
 *   - GOB      : TBD — stays inactive (charging) for now
 *
 * Called from waves.js startWave() after updateChapterFromWave so
 * S.localWave is current. Cheap — no work if states haven't changed.
 *
 * @param {number} localWave 1-based local wave index within chapter
 */
export function updateHeroHexagonStates(localWave) {
  if (!_tiles) return;
  setHeroHexActive('flinger', localWave >= 2);
  setHeroHexActive('pixl',    localWave >= 5);
  // GOB activation rule TBD per spec — leave inactive until decided.
  setHeroHexActive('gob',     false);
}
