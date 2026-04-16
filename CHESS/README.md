# Chess piece assets

This folder holds the 3D model files used for chess pieces in the MML scene. When populated, the server serves them at `https://<your-host>/assets/<filename>.glb`.

**Status:** Empty — the server uses MML primitives by default (no files needed). Fill this folder with GLBs if you want real 3D pieces.

---

## Download instructions (Jarlan Perez's CC-BY set, ~5 minutes)

The project is pre-wired to use these 6 specific filenames from a matched set on Poly Pizza. The artist is **Jarlan Perez**, the license is **Creative Commons Attribution (CC-BY)** — you can use them commercially as long as you credit him.

For each piece below:
1. Click the Poly Pizza link
2. Click the blue **Download** button on the page
3. Choose **glTF** format (this downloads a `.glb` file)
4. Rename the downloaded file to the target filename listed below
5. Place the file in this folder (`chess-mml/assets/`)

| Piece   | Poly Pizza link                                                  | Save as        |
|---------|------------------------------------------------------------------|----------------|
| Pawn    | https://poly.pizza/m/0xRVhzfseb3                                 | `pawn.glb`     |
| Rook    | https://poly.pizza/m/417Xec_xlU0                                 | `rook.glb`     |
| Knight  | https://poly.pizza/m/fMIykP6ncx7                                 | `knight.glb`   |
| Bishop  | https://poly.pizza/m/7xay8UYqePI                                 | `bishop.glb`   |
| Queen   | https://poly.pizza/m/0EE-Yj8eu2c                                 | `queen.glb`    |
| King    | https://poly.pizza/m/4TP6oa34Fp-                                 | `king.glb`     |

When you're done this folder should contain:

```
assets/
├── README.md       (this file)
├── pawn.glb
├── rook.glb
├── knight.glb
├── bishop.glb
├── queen.glb
└── king.glb
```

## After the files are in place

Set two environment variables in Render (Settings → Environment):

| Variable       | Value                                |
|----------------|--------------------------------------|
| `USE_GLB_PIECES` | `true`                             |
| `PUBLIC_HOST`    | `<your-service>.onrender.com` (no protocol, no path) |

Redeploy. The server will now produce MML that references `https://<your-service>.onrender.com/assets/king.glb` etc. in the `<m-model>` tags. Otherside will fetch them directly from your server.

For local development:

```
USE_GLB_PIECES=true PUBLIC_HOST=localhost:8080 npm start
```

(Note: for the MML to work with Otherside across the internet, you need an HTTPS host — localhost only works for the mmleditor.com web preview when you're on the same machine.)

---

## Attribution (required by CC-BY)

Somewhere visible in your project — credits screen, README, about page — include:

> Chess piece models by [Jarlan Perez](https://poly.pizza/u/Jarlan%20Perez), licensed under [CC BY](https://creativecommons.org/licenses/by/3.0/), sourced via [Poly Pizza](https://poly.pizza/).

This project's top-level `README.md` already includes this line. If you remix the pieces or redistribute, keep the attribution with them.

---

## Color note

All six GLBs are the same light-cream color. The current setup uses the same model file for both white and black pieces, which means both sides will look identical in 3D — that's fine in the MML editor and web viewer where the game is readable from piece shape + position, but it may confuse players in Otherside.

If you want visually distinct black pieces, two options:

1. **Re-color the GLBs in Blender**: open each `.glb`, change the material base color to dark slate, export as `king-black.glb` etc. Then update `src/server.js` → `PIECE_MODELS` so the `b*` keys point at the `-black` variants.

2. **Apply a material tint in Unreal**: this requires deeper Blueprint work inside the Otherside project, outside the scope of the MML document itself.

Option 1 is simpler. If you skip both, the game still works — you just tell who's who by square color and piece position.

---

## Why we don't download these automatically

Poly Pizza's download endpoint requires a user gesture (the Download button) and doesn't expose direct CDN URLs. You have to click through once per piece. After that, the files live in your git repo and deploy anywhere.

## Swapping in your own set

If you have your own GLBs, just rename them to match the filenames above and drop them in. No code changes needed. If you want to mix and match (e.g. primitive pawns + real knights), edit `src/server.js` — `USE_GLB_PIECES` is all-or-nothing, but you can hand-edit the `PIECE_MODELS` object to override individual keys.
