# MEEBIT :: SURVIVAL PROTOCOL — v3

## Running locally

You need a local HTTP server because the game loads modules and assets via `fetch`. From the project folder:

```
python -m http.server 8000
```

Then open `http://localhost:8000` and **hard refresh** (Ctrl+Shift+R) if you're updating.

## File structure

```
meebit-shooter/
  index.html            ← entry point
  assets/
    meebit.glb          ← the rigged Meebit model
    phone_ring.mp3      ← intro phone ring
  src/
    styles.css          ← all UI styling
    main.js             ← game loop, input, wiring
    config.js           ← tune values here: weapons, enemies, waves, themes
    state.js            ← single source of truth for game state
    scene.js            ← Three.js renderer, lights, arena, themes
    player.js           ← Meebit load + procedural skeleton animation
    enemies.js          ← enemy types, boss, projectiles
    effects.js          ← pooled particles, bullets, pickups
    waves.js            ← wave flow: combat / capture / boss, intermissions, nuke
    ui.js               ← HUD updates, toasts, banners, boss bar
    audio.js            ← procedural WebAudio sfx + music
```

## What's in v3

**Architecture:** Split into focused modules. No more 1600-line god file.

**Fixed:**
- Freezing on hit: particles now use a pre-allocated pool (no GC spikes on rapid hits)
- Pillar count: border is now a single InstancedMesh (was 100+ separate meshes)
- Point light count: halved (was causing WebGL stalls)
- T-pose: skeleton is now guaranteed to update each frame via explicit `skeleton.update()`

**New features:**
- Incoming call intro with phone ring
- Checkered spotlight pattern under player (rotates, glows)
- Theme-tinted enemies that match each zone's color
- "Zomeebs" official naming, plus 4 other enemy types: Sprinters, Brutes, Spitters (ranged), Phantoms (phase in/out)
- 4 bosses every 5 waves with full health bar: Mega Zomeeb, Brute King, Void Lord, Solar Tyrant
- Capture-the-drop waves every 3rd wave: navigate to a glowing zone, hold it, earn a weapon
- 4 weapons: Pistol (start) → Shotgun → SMG → Sniper. Switch with 1-4 keys
- Wave-end nuke explosion clears floor, 3-2-1 countdown to next wave
- Theme cycles every wave (not just level-up) for dramatic zone changes
- Per-weapon fire sound

**Controls:**
- WASD / arrows — move
- Mouse — aim
- Hold LMB — fire
- Space — dash
- 1/2/3/4 — switch weapons (owned ones only)
- Esc — pause

## Deploying

Copy the entire `meebit-shooter/` folder to your host (GitHub Pages, Netlify, Railway static site, itch.io, etc). The folder structure must stay intact — `index.html` looks for files in `src/` and `assets/`.

For your existing `ARCADE3/SHOOTER/` repo: replace the old `index.html` and `meebit.glb` with this entire folder's contents.
