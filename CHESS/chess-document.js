/**
 * chess-document.js
 *
 * Builds the MML document that represents the chess board in 3D.
 * All tags used here are confirmed supported in the Otherside/Unreal MML plugin
 * per https://docs.otherside.xyz/ (as of 3 Mar 2026):
 *   <m-group>, <m-cube>, <m-cylinder>, <m-sphere>, <m-label>, <m-attr-anim>
 *
 * We deliberately avoid <m-attr-lerp> and <m-interaction> which are NOT supported
 * in the Unreal renderer.
 *
 * Pieces are constructed from primitives (no external GLB dependencies):
 *   Pawn   = short cylinder base + sphere head
 *   Rook   = cylinder + cube battlements
 *   Bishop = cylinder + sphere + small sphere tip (mitre look)
 *   Knight = cylinder base + tilted cube (shorthand for horse silhouette)
 *   Queen  = tall cylinder + sphere + ring of small spheres (crown)
 *   King   = tall cylinder + sphere + cross on top (two cubes)
 *
 * If you later want photo-real pieces, fill in PIECE_MODELS in server.js with
 * GLB URLs and renderPiece() will prefer those over the primitive shapes.
 *
 * Coordinate system (1 square = 1 meter):
 *   file a..h  -> x 0..7
 *   rank 1..8  -> z 0..7   (z=0 is White's back rank)
 *   board top  -> y = 0 (board surface sits just above y=0)
 *   piece base -> y = 0 (primitives sit on the board, not floating)
 */

// Optional GLB override map — leave empty and pieces will be built from
// primitives. Fill this in server.js only if you've sourced real chess GLBs.
const DEFAULT_PIECE_MODELS = {};

const SQUARE_SIZE = 1.0; // meters per square
const BOARD_ORIGIN_X = -3.5; // center the 8x8 board around 0,0
const BOARD_ORIGIN_Z = -3.5;
const MOVE_DURATION_MS = 400; // how long a slide animation takes

// Colors for the primitive pieces.
const WHITE_COLOR = '#f2ecd4';
const BLACK_COLOR = '#252525';

// Converts "e4" -> { x, z } in world space.
function squareToXZ(square) {
  const file = square.charCodeAt(0) - 'a'.charCodeAt(0); // 0..7
  const rank = parseInt(square[1], 10) - 1; // 0..7
  return {
    x: BOARD_ORIGIN_X + file * SQUARE_SIZE,
    z: BOARD_ORIGIN_Z + rank * SQUARE_SIZE,
  };
}

// Stable ids for pieces (e.g. "wP_0") so m-group identity is preserved across moves.
function buildInitialPieces(chess) {
  const pieces = [];
  const counters = {};
  const board = chess.board();
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const cell = board[r][f];
      if (!cell) continue;
      const rank = 8 - r;
      const file = String.fromCharCode('a'.charCodeAt(0) + f);
      const square = `${file}${rank}`;
      const key = cell.color + cell.type.toUpperCase();
      counters[key] = (counters[key] || 0) + 1;
      const id = `${key}_${counters[key] - 1}`;
      pieces.push({
        id,
        key,
        color: cell.color,
        type: cell.type,
        square,
        captured: false,
      });
    }
  }
  return pieces;
}

function renderBoardSquares() {
  const out = [];
  for (let f = 0; f < 8; f++) {
    for (let r = 0; r < 8; r++) {
      const isLight = (f + r) % 2 === 1;
      const color = isLight ? '#EEEED2' : '#769656';
      const x = BOARD_ORIGIN_X + f * SQUARE_SIZE;
      const z = BOARD_ORIGIN_Z + r * SQUARE_SIZE;
      out.push(
        `<m-cube x="${x}" y="-0.05" z="${z}" sx="${SQUARE_SIZE}" sy="0.1" sz="${SQUARE_SIZE}" color="${color}"></m-cube>`
      );
    }
  }
  for (let f = 0; f < 8; f++) {
    const file = String.fromCharCode('a'.charCodeAt(0) + f);
    const x = BOARD_ORIGIN_X + f * SQUARE_SIZE;
    out.push(
      `<m-label x="${x}" y="0.02" z="${BOARD_ORIGIN_Z - 0.7}" rx="-90" content="${file}" font-size="30" width="0.4" height="0.4" color="white" font-color="black"></m-label>`
    );
  }
  for (let r = 0; r < 8; r++) {
    const rank = r + 1;
    const z = BOARD_ORIGIN_Z + r * SQUARE_SIZE;
    out.push(
      `<m-label x="${BOARD_ORIGIN_X - 0.7}" y="0.02" z="${z}" rx="-90" content="${rank}" font-size="30" width="0.4" height="0.4" color="white" font-color="black"></m-label>`
    );
  }
  return out.join('\n    ');
}

// -----------------------------------------------------------------------------
// PIECE SHAPE BUILDERS
// -----------------------------------------------------------------------------
// Each function returns the inner markup of an <m-group>, i.e. the geometry
// relative to (0,0,0) sitting on the board. The outer <m-group> handles
// position and rotation.
// -----------------------------------------------------------------------------

function pawnShape(color) {
  return `
      <m-cylinder y="0.15" radius="0.18" height="0.3" color="${color}"></m-cylinder>
      <m-cylinder y="0.33" radius="0.14" height="0.05" color="${color}"></m-cylinder>
      <m-sphere y="0.47" sx="0.16" sy="0.16" sz="0.16" color="${color}"></m-sphere>`;
}

function rookShape(color) {
  return `
      <m-cylinder y="0.2" radius="0.2" height="0.4" color="${color}"></m-cylinder>
      <m-cube y="0.5" sx="0.42" sy="0.2" sz="0.42" color="${color}"></m-cube>
      <m-cube y="0.62" sx="0.1" sy="0.08" sz="0.1" x="-0.13" z="-0.13" color="${color}"></m-cube>
      <m-cube y="0.62" sx="0.1" sy="0.08" sz="0.1" x="0.13" z="-0.13" color="${color}"></m-cube>
      <m-cube y="0.62" sx="0.1" sy="0.08" sz="0.1" x="-0.13" z="0.13" color="${color}"></m-cube>
      <m-cube y="0.62" sx="0.1" sy="0.08" sz="0.1" x="0.13" z="0.13" color="${color}"></m-cube>`;
}

function bishopShape(color) {
  return `
      <m-cylinder y="0.18" radius="0.18" height="0.36" color="${color}"></m-cylinder>
      <m-cylinder y="0.4" radius="0.13" height="0.08" color="${color}"></m-cylinder>
      <m-sphere y="0.58" sx="0.22" sy="0.3" sz="0.22" color="${color}"></m-sphere>
      <m-sphere y="0.8" sx="0.08" sy="0.08" sz="0.08" color="${color}"></m-sphere>`;
}

function knightShape(color) {
  return `
      <m-cylinder y="0.18" radius="0.2" height="0.36" color="${color}"></m-cylinder>
      <m-cylinder y="0.4" radius="0.15" height="0.06" color="${color}"></m-cylinder>
      <m-cube y="0.6" z="-0.06" rx="-20" sx="0.2" sy="0.36" sz="0.36" color="${color}"></m-cube>
      <m-cube y="0.78" z="-0.18" rx="-25" sx="0.16" sy="0.12" sz="0.2" color="${color}"></m-cube>`;
}

function queenShape(color) {
  const crownPoints = [];
  const ringRadius = 0.15;
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const cx = Math.cos(angle) * ringRadius;
    const cz = Math.sin(angle) * ringRadius;
    crownPoints.push(
      `<m-sphere y="0.92" x="${cx.toFixed(3)}" z="${cz.toFixed(3)}" sx="0.08" sy="0.08" sz="0.08" color="${color}"></m-sphere>`
    );
  }
  return `
      <m-cylinder y="0.21" radius="0.2" height="0.42" color="${color}"></m-cylinder>
      <m-cylinder y="0.46" radius="0.14" height="0.06" color="${color}"></m-cylinder>
      <m-sphere y="0.66" sx="0.26" sy="0.32" sz="0.26" color="${color}"></m-sphere>
      <m-cylinder y="0.85" radius="0.15" height="0.08" color="${color}"></m-cylinder>
      ${crownPoints.join('\n      ')}
      <m-sphere y="1.02" sx="0.09" sy="0.09" sz="0.09" color="${color}"></m-sphere>`;
}

function kingShape(color) {
  return `
      <m-cylinder y="0.22" radius="0.2" height="0.44" color="${color}"></m-cylinder>
      <m-cylinder y="0.48" radius="0.14" height="0.06" color="${color}"></m-cylinder>
      <m-sphere y="0.68" sx="0.26" sy="0.32" sz="0.26" color="${color}"></m-sphere>
      <m-cylinder y="0.88" radius="0.14" height="0.06" color="${color}"></m-cylinder>
      <m-cube y="1.02" sx="0.07" sy="0.18" sz="0.07" color="${color}"></m-cube>
      <m-cube y="1.0" sx="0.16" sy="0.05" sz="0.05" color="${color}"></m-cube>`;
}

const SHAPE_BUILDERS = {
  P: pawnShape,
  R: rookShape,
  B: bishopShape,
  N: knightShape,
  Q: queenShape,
  K: kingShape,
};

function buildPieceBody(piece, pieceModels) {
  const modelUrl = pieceModels && pieceModels[piece.key];
  if (modelUrl) {
    return `<m-model src="${modelUrl}" sx="0.35" sy="0.35" sz="0.35"></m-model>`;
  }
  const typeLetter = piece.key[1];
  const color = piece.color === 'w' ? WHITE_COLOR : BLACK_COLOR;
  const builder = SHAPE_BUILDERS[typeLetter];
  return builder ? builder(color) : pawnShape(color);
}

function renderPiece(piece, pieceModels, animation = null) {
  const body = buildPieceBody(piece, pieceModels);

  if (piece.captured) {
    return `<m-group id="${piece.id}" x="-10" y="0" z="-10" visible="false">
      ${body}
    </m-group>`;
  }

  const { x, z } = squareToXZ(piece.square);
  const ry = piece.color === 'b' ? 180 : 0;

  let animChildren = '';
  if (animation) {
    const { fromX, fromZ, toX, toZ, startTime } = animation;
    animChildren += `
      <m-attr-anim attr="x" start="${fromX}" end="${toX}" start-time="${startTime}" duration="${MOVE_DURATION_MS}" loop="false" easing="easeInOutQuad"></m-attr-anim>
      <m-attr-anim attr="z" start="${fromZ}" end="${toZ}" start-time="${startTime}" duration="${MOVE_DURATION_MS}" loop="false" easing="easeInOutQuad"></m-attr-anim>`;
  }

  return `<m-group id="${piece.id}" x="${x}" y="0" z="${z}" ry="${ry}">
      ${body}${animChildren}
    </m-group>`;
}

function buildMML({ pieces, lastMove, statusText, pieceModels, docStartMs }) {
  const now = Date.now();
  const animStartTime = now - docStartMs;

  const pieceEls = pieces.map((p) => {
    let anim = null;
    if (lastMove && lastMove.pieceId === p.id && !p.captured) {
      const from = squareToXZ(lastMove.fromSquare);
      const to = squareToXZ(lastMove.toSquare);
      anim = {
        fromX: from.x,
        fromZ: from.z,
        toX: to.x,
        toZ: to.z,
        startTime: animStartTime,
      };
    }
    return renderPiece(p, pieceModels, anim);
  });

  const status = statusText
    ? `<m-label x="0" y="3.5" z="0" content="${statusText}" font-size="48" width="6" height="0.6" color="black" font-color="white" alignment="center"></m-label>`
    : '';

  return `<m-group id="chess-scene">
    <!-- Board base -->
    <m-cube x="0" y="-0.2" z="0" sx="9" sy="0.2" sz="9" color="#3b2a1a"></m-cube>
    <!-- 64 squares -->
    ${renderBoardSquares()}
    <!-- Pieces -->
    ${pieceEls.join('\n    ')}
    ${status}
  </m-group>`;
}

module.exports = {
  DEFAULT_PIECE_MODELS,
  SQUARE_SIZE,
  MOVE_DURATION_MS,
  squareToXZ,
  buildInitialPieces,
  buildMML,
};
