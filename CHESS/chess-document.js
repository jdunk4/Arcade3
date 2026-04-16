/**
 * chess-document.js
 *
 * Builds the MML document that represents the chess board in 3D.
 * All tags used here are confirmed supported in the Otherside/Unreal MML plugin
 * per https://docs.otherside.xyz/ (as of 3 Mar 2026):
 *   <m-group>, <m-cube>, <m-model>, <m-plane>, <m-label>, <m-attr-anim>
 *
 * We deliberately avoid <m-attr-lerp> and <m-interaction> which are NOT supported
 * in the Unreal renderer.
 *
 * Coordinate system (1 square = 1 meter):
 *   file a..h  -> x 0..7
 *   rank 1..8  -> z 0..7   (z=0 is White's back rank)
 *   board top  -> y = 0 (board surface sits just above y=0)
 *   piece base -> y = 0.55
 */

// Default piece GLB URLs. Replace these in server.js with your own URLs once
// you've sourced / hosted your preferred chess piece models.
const DEFAULT_PIECE_MODELS = {
  // White
  wK: 'https://public.mml.io/duck.glb', // placeholder
  wQ: 'https://public.mml.io/duck.glb',
  wR: 'https://public.mml.io/duck.glb',
  wB: 'https://public.mml.io/duck.glb',
  wN: 'https://public.mml.io/duck.glb',
  wP: 'https://public.mml.io/duck.glb',
  // Black
  bK: 'https://public.mml.io/duck.glb',
  bQ: 'https://public.mml.io/duck.glb',
  bR: 'https://public.mml.io/duck.glb',
  bB: 'https://public.mml.io/duck.glb',
  bN: 'https://public.mml.io/duck.glb',
  bP: 'https://public.mml.io/duck.glb',
};

const SQUARE_SIZE = 1.0; // meters per square
const BOARD_ORIGIN_X = -3.5; // center the 8x8 board around 0,0
const BOARD_ORIGIN_Z = -3.5;
const PIECE_Y = 0.55;
const MOVE_DURATION_MS = 400; // how long a slide animation takes

// Converts "e4" -> { x, z } in world space.
function squareToXZ(square) {
  const file = square.charCodeAt(0) - 'a'.charCodeAt(0); // 0..7
  const rank = parseInt(square[1], 10) - 1; // 0..7
  return {
    x: BOARD_ORIGIN_X + file * SQUARE_SIZE,
    z: BOARD_ORIGIN_Z + rank * SQUARE_SIZE,
  };
}

// Given a chess.js piece object ({type, color}) and a running index counter,
// return a stable piece id like "wP_0", "bN_1", etc.
// We assign stable ids at game-start from the initial board layout so that
// m-model elements keep their identity across moves (enabling animation).
function buildInitialPieces(chess) {
  const pieces = [];
  const counters = {};
  const board = chess.board(); // 8x8 array, board[0] is rank 8, board[7] is rank 1
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const cell = board[r][f];
      if (!cell) continue;
      const rank = 8 - r; // rank number 1..8
      const file = String.fromCharCode('a'.charCodeAt(0) + f);
      const square = `${file}${rank}`;
      const key = cell.color + cell.type.toUpperCase(); // e.g. "wP"
      counters[key] = (counters[key] || 0) + 1;
      const id = `${key}_${counters[key] - 1}`;
      pieces.push({
        id,
        key,              // "wP" etc.
        color: cell.color, // "w" or "b"
        type: cell.type,   // "p" "n" "b" "r" "q" "k"
        square,            // current square, e.g. "e2"
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
  // File labels (a-h) along the front edge
  for (let f = 0; f < 8; f++) {
    const file = String.fromCharCode('a'.charCodeAt(0) + f);
    const x = BOARD_ORIGIN_X + f * SQUARE_SIZE;
    out.push(
      `<m-label x="${x}" y="0.02" z="${BOARD_ORIGIN_Z - 0.7}" rx="-90" content="${file}" font-size="30" width="0.4" height="0.4" color="white" font-color="black"></m-label>`
    );
  }
  // Rank labels (1-8) along the left edge
  for (let r = 0; r < 8; r++) {
    const rank = r + 1;
    const z = BOARD_ORIGIN_Z + r * SQUARE_SIZE;
    out.push(
      `<m-label x="${BOARD_ORIGIN_X - 0.7}" y="0.02" z="${z}" rx="-90" content="${rank}" font-size="30" width="0.4" height="0.4" color="white" font-color="black"></m-label>`
    );
  }
  return out.join('\n    ');
}

/**
 * Render one piece as an <m-group> wrapping an <m-model>.
 * The group holds the x/z position so we can animate it with <m-attr-anim>.
 *
 *   animation: optional { attr, start, end, startTime }
 *     When set, a child <m-attr-anim> drives the transition from start->end.
 */
function renderPiece(piece, pieceModels, animation = null) {
  if (piece.captured) {
    // Park captured pieces off-board and hide them.
    return `<m-group id="${piece.id}" x="-10" y="${PIECE_Y}" z="-10" visible="false">
      <m-model src="${pieceModels[piece.key]}" sx="0.35" sy="0.35" sz="0.35"></m-model>
    </m-group>`;
  }

  const { x, z } = squareToXZ(piece.square);
  const ry = piece.color === 'b' ? 180 : 0;

  // Build anim children for x and z if an animation was requested this tick.
  let animChildren = '';
  if (animation) {
    const { fromX, fromZ, toX, toZ, startTime } = animation;
    // Two non-looping animations: one on x, one on z.
    // When they finish, the values stay at "end" (since loop=false).
    animChildren += `
      <m-attr-anim attr="x" start="${fromX}" end="${toX}" start-time="${startTime}" duration="${MOVE_DURATION_MS}" loop="false" easing="easeInOutQuad"></m-attr-anim>
      <m-attr-anim attr="z" start="${fromZ}" end="${toZ}" start-time="${startTime}" duration="${MOVE_DURATION_MS}" loop="false" easing="easeInOutQuad"></m-attr-anim>`;
  }

  return `<m-group id="${piece.id}" x="${x}" y="${PIECE_Y}" z="${z}" ry="${ry}">
      <m-model src="${pieceModels[piece.key]}" sx="0.35" sy="0.35" sz="0.35"></m-model>${animChildren}
    </m-group>`;
}

/**
 * Produce the full MML document as a string.
 *
 *   pieces: array of piece objects (see buildInitialPieces)
 *   lastMove: { fromSquare, toSquare, pieceId } OR null
 *   statusText: optional string shown on an m-label above the board
 */
function buildMML({ pieces, lastMove, statusText, pieceModels, docStartMs }) {
  const now = Date.now();
  const animStartTime = now - docStartMs; // m-attr-anim uses doc-lifecycle-relative ms

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
