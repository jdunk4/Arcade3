/**
 * server.js (FLAT LAYOUT VERSION)
 *
 * Use this version when your files all sit at the same level on GitHub
 * (server.js, chess-document.js, play.html, package.json all in CHESS/).
 *
 * Runs the chess session.
 *
 *   - Holds the authoritative board state (chess.js)
 *   - Exposes wss://host/mml  -> the MML document rendered from board state
 *                                (this URL is what you paste into Otherside
 *                                 / MML editor / MML Viewer)
 *   - Exposes wss://host/play -> the browser UI <-> server channel for moves
 *   - Serves http://host/play -> the 2D chessboard web page
 */

const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const { Chess } = require('chess.js');
const path = require('path');

const {
  DEFAULT_PIECE_MODELS,
  buildInitialPieces,
  buildMML,
} = require('./chess-document');

// -----------------------------------------------------------------------------
// PIECE MODELS (optional GLB override)
// -----------------------------------------------------------------------------
// By default, pieces are built from MML primitives (m-cylinder, m-sphere,
// m-cube) and need no external files. They render correctly in Otherside today
// with zero dependencies.
//
// To swap in real 3D chess pieces: drop GLB files next to this server.js file
// (since everything is flat) and flip USE_GLB_PIECES to true.
// -----------------------------------------------------------------------------
const USE_GLB_PIECES = process.env.USE_GLB_PIECES === 'true';
const PUBLIC_HOST = process.env.PUBLIC_HOST || `localhost:${process.env.PORT || 8080}`;
const ASSET_PROTO = process.env.PUBLIC_HOST ? 'https' : 'http';
const ASSET_BASE = `${ASSET_PROTO}://${PUBLIC_HOST}/assets`;

const PIECE_MODELS = USE_GLB_PIECES ? {
  wK: `${ASSET_BASE}/king.glb`,
  wQ: `${ASSET_BASE}/queen.glb`,
  wR: `${ASSET_BASE}/rook.glb`,
  wB: `${ASSET_BASE}/bishop.glb`,
  wN: `${ASSET_BASE}/knight.glb`,
  wP: `${ASSET_BASE}/pawn.glb`,
  bK: `${ASSET_BASE}/king.glb`,
  bQ: `${ASSET_BASE}/queen.glb`,
  bR: `${ASSET_BASE}/rook.glb`,
  bB: `${ASSET_BASE}/bishop.glb`,
  bN: `${ASSET_BASE}/knight.glb`,
  bP: `${ASSET_BASE}/pawn.glb`,
} : {
  ...DEFAULT_PIECE_MODELS,
};

// -----------------------------------------------------------------------------
// GAME STATE
// -----------------------------------------------------------------------------
const chess = new Chess();
let pieces = buildInitialPieces(chess);
let lastMove = null;
let statusText = 'White to move';
const docStartMs = Date.now();

function pieceAt(square) {
  return pieces.find((p) => !p.captured && p.square === square);
}

function applyMoveToPieces(move) {
  const mover = pieceAt(move.from);
  if (!mover) {
    console.warn('No piece found at', move.from, '- state desync?');
    return null;
  }

  if (move.captured) {
    let victimSquare = move.to;
    if (move.flags.includes('e')) {
      const epRank = move.color === 'w'
        ? parseInt(move.to[1], 10) - 1
        : parseInt(move.to[1], 10) + 1;
      victimSquare = `${move.to[0]}${epRank}`;
    }
    const victim = pieceAt(victimSquare);
    if (victim) victim.captured = true;
  }

  mover.square = move.to;

  if (move.promotion) {
    mover.type = move.promotion;
    mover.key = mover.color + move.promotion.toUpperCase();
  }

  if (move.flags.includes('k') || move.flags.includes('q')) {
    const rank = move.color === 'w' ? '1' : '8';
    const rookFromFile = move.flags.includes('k') ? 'h' : 'a';
    const rookToFile = move.flags.includes('k') ? 'f' : 'd';
    const rook = pieceAt(`${rookFromFile}${rank}`);
    if (rook) rook.square = `${rookToFile}${rank}`;
  }

  return { fromSquare: move.from, toSquare: move.to, pieceId: mover.id };
}

function updateStatusText() {
  if (chess.isCheckmate()) {
    statusText = `Checkmate - ${chess.turn() === 'w' ? 'Black' : 'White'} wins`;
  } else if (chess.isStalemate()) {
    statusText = 'Stalemate - draw';
  } else if (chess.isDraw()) {
    statusText = 'Draw';
  } else if (chess.inCheck()) {
    statusText = `${chess.turn() === 'w' ? 'White' : 'Black'} to move (check)`;
  } else {
    statusText = `${chess.turn() === 'w' ? 'White' : 'Black'} to move`;
  }
}

function resetGame() {
  chess.reset();
  pieces = buildInitialPieces(chess);
  lastMove = null;
  updateStatusText();
  broadcastMML();
  broadcastPlayState();
}

function tryMove({ from, to, promotion }) {
  const move = chess.move({ from, to, promotion: promotion || 'q' });
  if (!move) return { ok: false, error: 'illegal move' };
  const lm = applyMoveToPieces(move);
  lastMove = lm;
  updateStatusText();
  return { ok: true, move };
}

// -----------------------------------------------------------------------------
// MML WEBSOCKET CHANNEL (at wss://host/mml)
// -----------------------------------------------------------------------------
const mmlClients = new Set();

function currentMMLString() {
  return buildMML({
    pieces,
    lastMove,
    statusText,
    pieceModels: PIECE_MODELS,
    docStartMs,
  });
}

function snapshotMessage() {
  return JSON.stringify({
    type: 'snapshot',
    snapshot: currentMMLString(),
    documentTime: Date.now() - docStartMs,
  });
}

function broadcastMML() {
  const msg = snapshotMessage();
  for (const ws of mmlClients) {
    if (ws.readyState === ws.OPEN) ws.send(msg);
  }
}

// -----------------------------------------------------------------------------
// PLAY (browser) WEBSOCKET CHANNEL (at wss://host/play)
// -----------------------------------------------------------------------------
const playClients = new Set();

function broadcastPlayState() {
  const msg = JSON.stringify({
    type: 'state',
    fen: chess.fen(),
    turn: chess.turn(),
    status: statusText,
    isGameOver: chess.isGameOver(),
  });
  for (const ws of playClients) {
    if (ws.readyState === ws.OPEN) ws.send(msg);
  }
}

// -----------------------------------------------------------------------------
// HTTP + WS SETUP  (FLAT LAYOUT: everything at __dirname)
// -----------------------------------------------------------------------------
const app = express();

// Serve everything sitting next to server.js (play.html, assets, etc.) as static files.
app.use(express.static(__dirname));

// Also expose /assets explicitly for GLB files when added.
app.use('/assets', express.static(__dirname));

app.get('/', (req, res) => {
  res.redirect('/play');
});

app.get('/play', (req, res) => {
  res.sendFile(path.join(__dirname, 'play.html'));
});

app.get('/mml.html', (req, res) => {
  res.type('text/html').send(currentMMLString());
});

const server = http.createServer(app);

const mmlWss = new WebSocketServer({ noServer: true });
mmlWss.on('connection', (ws) => {
  mmlClients.add(ws);
  ws.send(snapshotMessage());
  ws.on('close', () => mmlClients.delete(ws));
  ws.on('error', () => mmlClients.delete(ws));
});

const playWss = new WebSocketServer({ noServer: true });
playWss.on('connection', (ws) => {
  playClients.add(ws);
  ws.send(JSON.stringify({
    type: 'state',
    fen: chess.fen(),
    turn: chess.turn(),
    status: statusText,
    isGameOver: chess.isGameOver(),
  }));

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === 'move') {
      const result = tryMove({ from: msg.from, to: msg.to, promotion: msg.promotion });
      if (result.ok) {
        broadcastMML();
        broadcastPlayState();
      } else {
        ws.send(JSON.stringify({ type: 'moveRejected', from: msg.from, to: msg.to, reason: result.error }));
        ws.send(JSON.stringify({
          type: 'state',
          fen: chess.fen(),
          turn: chess.turn(),
          status: statusText,
          isGameOver: chess.isGameOver(),
        }));
      }
    } else if (msg.type === 'reset') {
      resetGame();
    }
  });

  ws.on('close', () => playClients.delete(ws));
  ws.on('error', () => playClients.delete(ws));
});

server.on('upgrade', (req, socket, head) => {
  const url = req.url || '/';
  if (url.startsWith('/mml')) {
    mmlWss.handleUpgrade(req, socket, head, (ws) => mmlWss.emit('connection', ws, req));
  } else if (url.startsWith('/play')) {
    playWss.handleUpgrade(req, socket, head, (ws) => playWss.emit('connection', ws, req));
  } else {
    socket.destroy();
  }
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  updateStatusText();
  console.log('');
  console.log('  Chess-MML server running (flat layout)');
  console.log('  --------------------------------------');
  console.log(`  Browser (play UI):   http://localhost:${PORT}/play`);
  console.log(`  MML WebSocket:       ws://localhost:${PORT}/mml`);
  console.log('');
});
