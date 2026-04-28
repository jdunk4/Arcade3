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

// Pointy-top hexagonal clip-path. Points at top (50%, 0%) and bottom
// (50%, 100%); flat sides at left (0%, 25% / 0%, 75%) and right
// (100%, 25% / 100%, 75%). Pure CSS — no SVG masking needed.
const _HEX_CLIP = 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)';

// Tile dimensions — point-to-point height 60px, flat-to-flat width 52px.
// For a regular pointy-top hex, height = width × (2 / √3) ≈ width × 1.155;
// using 52 × 60 keeps the hex very nearly regular while staying clean
// integer pixel sizes.
const _TILE_W = 52;
const _TILE_H = 60;
const _TILE_GAP = 8;

// Module state
let _root = null;
let _tiles = null;     // { pixl: {wrap, img}, flinger: {...}, gob: {...} }
let _currentChapter = -1;

/**
 * Build the DOM scaffold once. Idempotent — second call is a no-op.
 * Tiles start hidden; first call to updateHeroHexagons() reveals them.
 */
export function initHeroHexagons() {
  if (_root) return;
  _root = document.createElement('div');
  _root.id = 'hero-hexagons';
  _root.style.cssText = [
    'position: fixed',
    'top: 12px',
    'left: 16px',
    'display: flex',
    'flex-direction: row',
    `gap: ${_TILE_GAP}px`,
    'pointer-events: none',
    'z-index: 25',                   // above HUD chips, below modals
    'opacity: 0',                     // fade in once first chapter is set
    'transition: opacity 0.4s ease-out',
  ].join(';');

  _tiles = {
    pixl:    _makeTile('pixl'),
    flinger: _makeTile('flinger'),
    gob:     _makeTile('gob'),
  };
  _root.appendChild(_tiles.pixl.wrap);
  _root.appendChild(_tiles.flinger.wrap);
  _root.appendChild(_tiles.gob.wrap);
  document.body.appendChild(_root);
}

function _makeTile(category) {
  // Outer wrap — provides the hexagonal clip + a glowing border via
  // a pseudo-element trick. We use TWO stacked clipped divs:
  //   - Outer (wrap): slightly larger, tinted background — acts as
  //     the visible "border" once the inner is masked.
  //   - Inner (imgBox): clipped one pixel smaller, contains the IMG.
  // Result: a thin tinted rim around the portrait.
  const wrap = document.createElement('div');
  wrap.className = 'hero-hex hero-hex-' + category;
  wrap.style.cssText = [
    `width: ${_TILE_W}px`,
    `height: ${_TILE_H}px`,
    `clip-path: ${_HEX_CLIP}`,
    'background: rgba(255, 255, 255, 0.85)',   // border color, retinted in update
    'position: relative',
    'flex-shrink: 0',
    'transition: background-color 0.5s ease-out',
  ].join(';');

  const imgBox = document.createElement('div');
  imgBox.style.cssText = [
    'position: absolute',
    'inset: 2px',                              // 2px inset = visible rim
    `clip-path: ${_HEX_CLIP}`,
    'background: rgba(0, 0, 0, 0.55)',          // dark backdrop behind portrait
    'overflow: hidden',
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
  return { wrap, imgBox, img };
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
 * Show or hide the hexagon row. Use to suppress during cinematics,
 * boss intros, etc.
 */
export function setHeroHexagonsVisible(visible) {
  if (!_root) return;
  _root.style.display = visible ? 'flex' : 'none';
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
