/**
 * Generate a static starting-position MML file you can drop straight
 * into the MML editor (mmleditor.com) or MML viewer to preview the
 * board without the live server.
 *
 *   node tools/gen-static.js
 *
 * Writes ./static-starting-position.html
 */
const fs = require('fs');
const path = require('path');
const { Chess } = require('chess.js');
const {
  DEFAULT_PIECE_MODELS,
  buildInitialPieces,
  buildMML,
} = require('../src/chess-document');

const chess = new Chess();
const pieces = buildInitialPieces(chess);
const mml = buildMML({
  pieces,
  lastMove: null,
  statusText: 'White to move',
  pieceModels: DEFAULT_PIECE_MODELS,
  docStartMs: Date.now(),
});

const out = path.join(__dirname, '..', 'static-starting-position.html');
fs.writeFileSync(out, mml);
console.log('Wrote', out, '(' + mml.length + ' chars)');
console.log('Paste this file\'s contents into mmleditor.com to preview the starting board.');
