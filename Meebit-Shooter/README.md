# Meebit Shooter — v6 Mod Pack

This mod pack adds 7 major features to your Meebit Shooter game:

1. **Diagonal rain** that follows the player and tints to the chapter theme
2. **Themed goo splats** that persist for 60 seconds and fade out
3. **Pumpkinheads** restricted to Chapter 1 (waves 1–5, orange)
4. **Vampires + Red Devils** restricted to Chapter 2 (waves 6–10, red)
5. **Wizards** with triangle projectiles in Chapter 3 (waves 11–15, yellow)
6. **Goo Spitters** (tall, lanky, green, ranged) in Chapter 4 (waves 16–20)
7. **Boss attack variety** — summoner bosses and cube-storm bosses
8. **Ray Gun** (constant beam, replaces sniper) and **Rocket Launcher** (homing missiles)

---

## Install

Five files in `src/` are drop-in replacements for your existing files:

```
Meebit-Shooter/src/config.js       ← full rewrite
Meebit-Shooter/src/enemies.js      ← full rewrite
Meebit-Shooter/src/effects.js      ← full rewrite
Meebit-Shooter/src/waves.js        ← full rewrite
Meebit-Shooter/src/main.js         ← full rewrite
```

Also see `INDEX_HTML_CHANGES.txt` for the inventory slot markup updates.

**Files you should NOT need to change:** `scene.js`, `state.js`, `ui.js`, `player.js`,
`audio.js`, `blocks.js`, `spawners.js`, `orbs.js`, `meebits.js`, `save.js`, `wallet.js`,
`meebitsApi.js`, `styles.css`.

> If `state.js` does not already initialize `S._lastTintedChapter`, it'll just be
> `undefined` on first frame — harmless, it'll pick up the chapter on the next tick.

---

## Feature details

### Diagonal rain
- 300 drops, each a tall thin box tilted 20° off vertical, falling at ~24 u/s vertical
  + 10 u/s lateral.
- The rain follows the player (its parent group is re-positioned every frame) so you
  never see an edge where rain stops.
- Re-tinted every time the chapter changes: orange in Inferno, red in Crimson, etc.
- Toggle with `initRain()` / `disposeRain()` if you want a menu setting later.

### Goo splats
- Flat circles on the ground, randomly rotated and scaled, colored to the chapter's
  `grid1` theme color.
- Spawn rules:
  - Goo Spitter kills → 1 guaranteed splat.
  - Other enemy kills → 35% chance (tunable in `GOO_CONFIG.spawnChance`).
  - Boss kills → 3 splats in a small cluster.
  - Goo Spitter projectile hit on player → 1 splat where it hit.
- 60-second lifetime with a 20%-of-life fade-out.

### New enemies

| Enemy | Appears in | Behavior |
|-------|-----------|----------|
| Pumpkinhead | Ch.1 only (orange, waves 1–5) | Slow, explodes on death, AoE damage |
| Vampire | Ch.2 (red, waves 6–10) | Blinks ~every 3.5s toward the player (teleport) |
| Red Devil | Ch.2 (red, waves 6–10) | Horned, shoots red fireballs from flaming hand |
| Wizard | Ch.3 (yellow, waves 11–15) | Pointed hat, staff, throws spinning gold triangles |
| Goo Spitter | Ch.4 (green, waves 16–20) | Tall lanky, ranged, leaves goo where it dies/hits |

The mix is enforced in `waveEnemyMix()` in `config.js` — each chapter only spawns its
signature enemies alongside zomeeb/sprinter/brute baseline.

### Boss patterns

Every boss has `pattern: 'summoner'` or `pattern: 'cubestorm'` set in `BOSSES`:

- **Summoner** (Mega Zomeeb + Void Lord):
  - Every 6–8 seconds, spawns 2 chapter-appropriate minions at its feet.
  - At 50% HP, spawns 4 extra minions in a "panic" burst.
- **Cubestorm** (Brute King + Solar Tyrant):
  - Every 5 seconds, drops 2–3 cubes from the sky near the player.
  - Each cube has a ground warning ring (yellow = will hatch, red = will explode).
  - 60% hatch into a chapter-appropriate enemy; 40% explode and damage the player
    (25 dmg, 2.5u radius).
  - At 50% HP, drops 5 cubes at once.

### Ray Gun (slot 4)
- `weapon.isBeam: true`
- Continuous beam rendered from the player's gun forward.
- Beam length auto-clips at the first wall/block OR extends to `beamRange` (30u).
- While held, damage ticks every 50ms to every enemy intersecting the beam cylinder
  (0.35u width + enemy hit radius).
- **Penetrates through enemies** (it's a ray!) so you can hit multiple in a line.
- Also damages portals during spawner waves.

### Rocket Launcher (slot 5)
- `weapon.isHoming: true`
- Locks onto the nearest enemy in a 90° cone in front of the player on fire.
- Steers toward the target with a 6.0 rad/sec turn rate.
- Re-acquires a new target if the original dies mid-flight.
- On impact: 120 direct damage + 80 falloff AoE over a 4u radius.
- AoE damages portals at reduced (60%) effectiveness.
- Leaves a smoke trail (tiny hitBurst puffs every 30ms).

### Weapon unlock order
Boss rewards and capture-zone rewards now progress through:
`shotgun → smg → raygun → rocket`

So the raygun arrives around the 3rd-4th chapter and rocket around the 5th boss kill.
If you want the rocket to gate on wave 20 specifically, edit `grantBossReward()` in
`waves.js`.

---

## Key bindings
```
1 → pistol
2 → shotgun
3 → smg
4 → raygun    (was: sniper)
5 → rocket    (NEW)
Q → pickaxe
Space → dash
Esc → pause
```

The mobile fire button works with every weapon. The ray gun specifically needs
`mouse.down` (or `fireBtn` touchdown) held — releasing stops the beam.

---

## Save migration
Old saves that had `sniper` in `ownedWeapons` get automatically converted to `raygun`
the first time `startGame()` is called in main.js. No data loss; you keep whatever
you'd unlocked.

---

## Tunable constants (all in `config.js`)

```js
// Rain
RAIN_CONFIG = {
  dropCount: 300,    // bump to 500 for heavier storms
  area: 60,          // half-extent of spawn square
  speedY: -24,       // negative = falling
  speedX: 10,        // diagonal drift (wind)
  height: 30,        // spawn height
}

// Goo splats
GOO_CONFIG = {
  lifetimeSec: 60,   // 1 minute
  size: 0.9,         // base radius
  spawnChance: 0.35, // chance per non-spitter kill
}

// Ray gun
WEAPONS.raygun = {
  fireRate: 0.05,    // 20 ticks/sec
  damage: 12,        // per tick → 240 dps sustained
  beamRange: 30,
  beamWidth: 0.35,
}

// Rocket
WEAPONS.rocket = {
  fireRate: 0.85,
  damage: 120,             // direct-hit
  speed: 28,
  homingStrength: 6.0,     // rad/sec turn
  explosionRadius: 4.0,
  explosionDamage: 80,
}
```

---

## Known rough edges

- **Beam + capture zone interaction**: the beam doesn't currently count as "kills in
  zone" for capture progress. If you want that, wrap the `if (e.hp <= 0) killEnemy(j)`
  call in `applyBeamDamage` to check `isInCaptureZone(e.pos)` before decrement.
- **Rocket target prediction**: the homing math aims at the enemy's current position,
  not predicted. Fast enemies can out-run a rocket at close range. If you want lead,
  compute `target.pos + target.vel * 0.2` before steering.
- **Rain visibility in bright chapters** (Solar): the rain color matches `grid1` which
  in Solar is yellow. You might prefer to force the rain color to always stay a cool
  hue. Call `setRainTint(0xaaccff)` after `applyTheme` in `startWave` to override.
- **Vampire blink + walls**: blink currently ignores block collision. Usually fine
  because it lands near the player in open arena, but edge-case spawns might put it
  behind a block. Add `resolveCollision(e.pos, 0.5)` after the blink teleport if that
  bothers you.
