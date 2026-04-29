// tutorialSecret.js — Secret unlock on the tutorial completion modal.
//
// When the player finishes wave 11 and the TUTORIAL COMPLETE modal
// shows, instead of clicking "RETURN TO MAIN SCREEN" they can press
// the Helldivers stratagem code:
//                ↑ → ↓ ↓ ↓
// to unlock and immediately start bonus waves 12, 13, 14, which
// teach the stratagem call-in system. The bonus waves grant
// temporary stratagem artifacts so the player can practice without
// having earned them in the main game.
//
// Public API:
//   armSecretListener(onUnlock)
//                              — call when the completion modal is
//                                shown. Listens for arrow key + arrow
//                                button events. onUnlock fires when
//                                the code is matched.
//   disarmSecretListener()     — cleanup; remove key handler.

const SECRET_CODE = ['up', 'right', 'down', 'down', 'down'];

let _entered = [];
let _onUnlock = null;
let _keyHandler = null;
let _hintEl = null;
let _hintTimer = null;

/**
 * Begin listening on the modal. The hint sprite at the bottom of the
 * screen shows the current input progress so the player can correct
 * a mis-key. Mismatch resets the buffer; a matched code calls onUnlock
 * and disarms the listener.
 */
export function armSecretListener(onUnlock) {
  if (_keyHandler) return;     // already armed
  _onUnlock = onUnlock;
  _entered = [];

  _keyHandler = (e) => {
    let dir = null;
    if (e.key === 'ArrowUp')    dir = 'up';
    else if (e.key === 'ArrowDown')  dir = 'down';
    else if (e.key === 'ArrowLeft')  dir = 'left';
    else if (e.key === 'ArrowRight') dir = 'right';
    if (!dir) return;
    e.preventDefault();
    _pushArrow(dir);
  };
  window.addEventListener('keydown', _keyHandler, true);

  _showHint('try anything');
}

export function disarmSecretListener() {
  if (_keyHandler) {
    window.removeEventListener('keydown', _keyHandler, true);
    _keyHandler = null;
  }
  _entered = [];
  _onUnlock = null;
  _hideHint();
}

/**
 * Programmatically push an arrow — used by gamepad d-pad listener
 * wired in main.js so controller players can also enter the code.
 */
export function pushSecretArrow(dir) {
  if (!_keyHandler) return;     // listener not armed
  _pushArrow(dir);
}

function _pushArrow(dir) {
  _entered.push(dir);

  // Match check.
  let isPrefix = true;
  for (let i = 0; i < _entered.length; i++) {
    if (_entered[i] !== SECRET_CODE[i]) { isPrefix = false; break; }
  }
  if (!isPrefix) {
    // Wrong key — reset and give a quick visual cue.
    _entered = [];
    _showHint('reset', 0xff5520);
    return;
  }

  if (_entered.length === SECRET_CODE.length) {
    // Match.
    _showHint('UNLOCKED', 0x00ff66);
    const cb = _onUnlock;
    disarmSecretListener();
    if (cb) {
      try { cb(); } catch (e) { console.warn('[tutorial secret unlock]', e); }
    }
    return;
  }

  // Partial match — show progress.
  _showHint('partial');
}

// =====================================================================
// HINT UI — a faint floating glyph row at the bottom of the modal
// =====================================================================
function _ensureHint() {
  if (_hintEl) return _hintEl;
  const el = document.createElement('div');
  el.style.cssText = [
    'position: fixed',
    'bottom: 30px',
    'left: 50%',
    'transform: translateX(-50%)',
    'z-index: 10003',
    'font-family: Impact, monospace',
    'font-size: 28px',
    'letter-spacing: 16px',
    'color: rgba(255,255,255,0.18)',     // very faint — the hint is for players who already know
    'text-shadow: 0 0 8px rgba(255,255,255,0.10)',
    'pointer-events: none',
    'transition: color 0.25s ease, text-shadow 0.25s ease',
  ].join(';');
  document.body.appendChild(el);
  _hintEl = el;
  return el;
}

function _showHint(_kind, color) {
  const el = _ensureHint();
  const ARROW = { up: '↑', down: '↓', left: '←', right: '→' };
  const slots = SECRET_CODE.length;
  const parts = [];
  for (let i = 0; i < slots; i++) {
    if (i < _entered.length) parts.push(ARROW[_entered[i]]);
    else parts.push('·');
  }
  el.textContent = parts.join(' ');
  if (color != null) {
    const hex = '#' + color.toString(16).padStart(6, '0');
    el.style.color = hex;
    el.style.textShadow = `0 0 12px ${hex}`;
    if (_hintTimer) clearTimeout(_hintTimer);
    _hintTimer = setTimeout(() => {
      // Decay back to faint white if listener still armed.
      if (_hintEl) {
        _hintEl.style.color = 'rgba(255,255,255,0.18)';
        _hintEl.style.textShadow = '0 0 8px rgba(255,255,255,0.10)';
      }
    }, 600);
  }
}

function _hideHint() {
  if (_hintTimer) { clearTimeout(_hintTimer); _hintTimer = null; }
  if (_hintEl && _hintEl.parentNode) {
    _hintEl.parentNode.removeChild(_hintEl);
  }
  _hintEl = null;
}
