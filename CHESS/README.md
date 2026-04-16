# Chess · Otherside / MML / Unreal

A real-time chess board rendered in MML that stays in sync across:

1. **Otherside** — players walk up to the board and watch the game unfold in-world
2. **MML Editor** (mmleditor.com) — for previewing the MML document during development
3. **Browser** — the 2D chessboard UI where players actually make moves

All three are just clients of the same WebSocket document. Move a piece in the browser, and every viewer — in Otherside, in the MML editor, in the standalone MML viewer — sees the piece slide to its new square simultaneously.

---

## Architecture

```
  ┌─────────────────────┐       wss://host/play        ┌──────────────────────┐
  │  Browser (play.html)│ ──── { from:"e2", to:"e4" } ▶│                      │
  │  chessboard.js      │                              │  Node server         │
  │  2D drag-and-drop   │ ◀──── { fen, status, ...} ──│  - chess.js rules    │
  └─────────────────────┘                              │  - authoritative DOM │
                                                       │                      │
  ┌─────────────────────┐       wss://host/mml          │                      │
  │  Otherside MML      │ ◀──── MML snapshot   ──────  │                      │
  │  (Vibe Maker)       │                              │                      │
  │  MML Editor         │                              │                      │
  │  MML Viewer         │                              │                      │
  └─────────────────────┘                              └──────────────────────┘
```

The server is the single source of truth. Clients connect and receive a snapshot of the MML document; every move produces a new snapshot containing updated piece positions and a fresh `<m-attr-anim>` that slides the piece from its old square to its new square.

---

## Why this shape

**`m-attr-lerp` is not supported in Unreal**, per the Otherside supported-tags table. That ruled out the "obvious" choice of lerping piece positions. Instead, each move generates a short, non-looping `<m-attr-anim>` on the piece's `<m-group>` for both `x` and `z`. `m-attr-anim` **is** supported in Unreal, and the animation locks in its end value when the duration completes, so the piece stays on its destination square afterwards.

**Only Unreal-compatible tags** are used:

| Tag used             | Unreal support (per Otherside docs)              |
|----------------------|--------------------------------------------------|
| `<m-group>`          | ✅                                               |
| `<m-cube>`           | ✅ (board base, squares)                         |
| `<m-model>`          | ✅ (pieces - pass your GLB URLs)                 |
| `<m-label>`          | ✅ (file/rank labels + status text)              |
| `<m-attr-anim>`      | ✅ (piece slide animation)                       |

We deliberately avoid: `m-attr-lerp`, `m-interaction`, `m-link`, `m-position-probe`, `m-audio`.

---

## Deploying

See [`DEPLOY.md`](./DEPLOY.md) for the full deployment guide. Short version:

- **Render** (free tier works, spins down when idle) — recommended default
- **Railway** (~$5/mo, always on, fastest setup)
- **Local + ngrok** for dev only

Once deployed, you'll have:
- Browser UI: `https://<your-host>/play`
- **MML URL for Otherside:** `wss://<your-host>/mml`

Paste the `wss://` URL into:
- **MML Editor** (mmleditor.com) — "View URL" field
- **MML Viewer** — `https://viewer.mml.io/?url=wss://<your-host>/mml`
- **Otherside Vibe Maker** — MML object source

## Run locally

```
npm install
npm start
```

Then open `http://localhost:8080/play`. To let Otherside see it, expose the server to the internet with [ngrok](https://ngrok.com):

```
ngrok http 8080
```

Use the `https://` URL ngrok prints, but swap `https` for `wss` and append `/mml`.

---

## How to play

1. Open the browser URL (`/play`). This is the drag-and-drop 2D board.
2. Anyone with the URL can make moves. White moves first; the server enforces turn order and legality via `chess.js`.
3. Watch the MML viewer (or Otherside) — each move triggers a 400ms slide animation.
4. Use the **Reset game** button to clear the board for everyone.

## Pieces

Piece models are configured in `src/server.js`:

```js
const PIECE_MODELS = {
  wK: 'https://your-cdn.example.com/chess/white-king.glb',
  wQ: '...',
  // etc. Keys: wK wQ wR wB wN wP bK bQ bR bB bN bP
};
```

Until you provide GLBs, the default is the public MML duck model at `https://public.mml.io/duck.glb` — useful for geometry testing, funny for everything else. Swap them in when you've hosted your pieces (any HTTPS-accessible GLB works). The models are scaled to `0.35` and placed on each square; adjust the `sx/sy/sz` in `chess-document.js → renderPiece()` if your pieces are a different base size.

---

## Otherside integration (Unreal blueprints)

Follow the interaction recipe from the Otherside docs you shared:

1. In your ODK project, open your chess-board actor (or create a new `BP_ChessBoard` actor).
2. **Add a `BPC_ODK_InteractableComponent_WidgetPopup` component.** Position it above the board where the camera should focus during interaction.
3. Configure the component:
   - **Interaction Distance:** `300` (3 m, tweak for your scale)
   - **Priority:** `1`
   - **Widget Transform:** above the board, facing the player
4. Hook the `OnInteract` event to open the browser UI:
   - Drop an `ODK Web Browser → Open URL` node
   - Set URL to your `/play` page (e.g. `https://chess-mml.onrender.com/play`)
5. **Spawn the MML object in the world at the board location.** Use the blueprint pattern from [MSquared's MML docs](https://docs.msquared.io/creation/unreal-development/features-and-tutorials/mml) — the "blueprint that spawns an MML object" example. Point it at your `wss://…/mml` URL. Position the spawned MML right on top of your physical board so the pieces appear on the board surface.

**Result:** A player approaches the board, sees the interact prompt, presses the key, and the play UI opens in their in-game browser. They can move pieces. Every player around the board — and anyone watching in the MML editor — sees the pieces slide in real time.

### Optional: Task Flow integration

If you want the board tied into the Otherside quest system (e.g. "complete a chess game"), wire the server's `isGameOver` broadcast to a backend webhook that fires a Task Flow **Task Trigger Execution Complete** event. That's beyond Phase 1 but the plumbing is in place — the server already tracks game-over state and broadcasts it on `/play`.

---

## Phase 2 — interacting with the board in-world

You asked about eventually letting players move pieces directly in Otherside, not just in the browser. The hooks are ready:

- `<m-model>` in Unreal supports `onclick`.
- Give each piece an `onclick` attribute that pings the server with `{ type: "select", piece: "wP_0" }`.
- Give each square an `<m-cube>` with `onclick` that sends `{ type: "target", square: "e4" }`.
- The server already validates moves — just add a `select → target` state per connection.

The reason we didn't do this in Phase 1 is that you asked for "watch it execute in real time" first, and the browser UI is a much faster testbed for proving the sync pipeline works. Once you've seen pieces move in Otherside, toggling on the click handlers is a one-day change.

---

## Files

```
chess-mml/
├── package.json               deps (chess.js, express, ws)
├── README.md                  this file
├── DEPLOY.md                  deployment guide (Render / Railway / ngrok)
└── src/
    ├── server.js              HTTP + WS server, chess rules, broadcast
    ├── chess-document.js      MML document builder (the 3D scene)
    └── public/
        └── play.html          browser 2D chessboard UI
```

---

## Troubleshooting

**The pieces don't show up in Otherside but do show in the web viewer.**
Check that your GLB URLs are HTTPS and CORS-permissive. The default `public.mml.io/duck.glb` works from anywhere.

**Pieces teleport instead of sliding in Unreal.**
`m-attr-anim` in Unreal needs the `start-time` to be in the future *or* the present. The server uses `Date.now() - docStartMs`, which is always "now" relative to the document lifecycle — this is correct. If you're seeing teleports, check the Unreal plugin version supports `m-attr-anim` (it should, per the 3 Mar 2026 tags table).

**I moved a piece in the browser but nothing happened in Otherside.**
Confirm the MML URL in Otherside is `wss://` (not `ws://`) and the path is exactly `/mml`. The Otherside plugin requires secure WebSockets for remote origins.

**Host is HTTPS but WebSocket connects as WS.**
Look at `play.html` — it auto-detects from `location.protocol`. If you embedded the board elsewhere, use `wss://` explicitly.
