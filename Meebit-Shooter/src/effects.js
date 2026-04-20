import * as THREE from 'three';
import { scene } from './scene.js';
import { CAPTURE_RADIUS, RAIN_CONFIG, GOO_CONFIG, rainIntensity } from './config.js';

// ============================================================
//  BULLETS
// ============================================================
export const bullets = [];
const BULLET_GEO = new THREE.BoxGeometry(0.12, 0.12, 0.6);

export function spawnBullet(origin, facing, weapon) {
  const count = Math.max(1, weapon.bullets);
  for (let i = 0; i < count; i++) {
    const spread = weapon.spread;
    const angleOffset = count === 1
      ? (Math.random() - 0.5) * spread
      : (i / (count - 1) - 0.5) * spread * 2 + (Math.random() - 0.5) * spread * 0.3;
    const angle = facing + angleOffset;

    const mat = new THREE.MeshStandardMaterial({
      color: weapon.color, emissive: weapon.color, emissiveIntensity: 2.5,
    });
    const bullet = new THREE.Mesh(BULLET_GEO, mat);
    bullet.position.copy(origin);
    bullet.userData = {
      vel: new THREE.Vector3(Math.sin(angle) * weapon.speed, 0, Math.cos(angle) * weapon.speed),
      life: 1.5,
      damage: weapon.damage,
    };
    bullet.lookAt(origin.x + Math.sin(angle), origin.y, origin.z + Math.cos(angle));
    scene.add(bullet);
    bullets.push(bullet);
  }
}

export function clearBullets() {
  for (const b of bullets) scene.remove(b);
  bullets.length = 0;
}

// ============================================================
//  ROCKETS — homing missiles
// ============================================================
export const rockets = [];

export function spawnRocket(origin, facing, weapon, targetRef) {
  const mat = new THREE.MeshStandardMaterial({
    color: weapon.color, emissive: weapon.color, emissiveIntensity: 2.2,
  });
  // Rocket body — elongated capsule-like box
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.7), mat);
  group.add(body);
  // Fins
  const finMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.6 });
  const finL = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.28, 0.15), finMat);
  finL.position.set(-0.15, 0, -0.25); group.add(finL);
  const finR = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.28, 0.15), finMat);
  finR.position.set(0.15, 0, -0.25); group.add(finR);
  const finT = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.05, 0.15), finMat);
  finT.position.set(0, 0.15, -0.25); group.add(finT);
  // Exhaust glow
  const exhaustMat = new THREE.MeshStandardMaterial({
    color: 0xffee00, emissive: 0xffaa00, emissiveIntensity: 4, transparent: true, opacity: 0.9,
  });
  const exhaust = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.25), exhaustMat);
  exhaust.position.set(0, 0, -0.45); group.add(exhaust);

  group.position.copy(origin);
  group.position.y = 1.2;
  const vx = Math.sin(facing) * weapon.speed;
  const vz = Math.cos(facing) * weapon.speed;
  group.userData = {
    vel: new THREE.Vector3(vx, 0, vz),
    speed: weapon.speed,
    life: 4.0,
    damage: weapon.damage,
    explosionRadius: weapon.explosionRadius,
    explosionDamage: weapon.explosionDamage,
    homingStrength: weapon.homingStrength,
    target: targetRef,         // may be null; auto-acquires
    color: weapon.color,
    exhaust,
    trailTimer: 0,
  };
  scene.add(group);
  rockets.push(group);
  return group;
}

export function clearRockets() {
  for (const r of rockets) scene.remove(r);
  rockets.length = 0;
}

// ============================================================
//  PICKUPS
// ============================================================
export const pickups = [];
const PICKUP_GEO = new THREE.OctahedronGeometry(0.28, 0);

const PICKUP_COLORS = {
  xp: 0xffd93d, health: 0x00ff66, speed: 0x4ff7ff, shield: 0xe63aff,
};

export function makePickup(type, x, z) {
  const color = PICKUP_COLORS[type] || 0xffffff;
  const mat = new THREE.MeshStandardMaterial({
    color, emissive: color, emissiveIntensity: 1.8, roughness: 0.3,
  });
  const mesh = new THREE.Mesh(PICKUP_GEO, mat);
  mesh.castShadow = true;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.45, 0.55, 12),
    new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.5, side: THREE.DoubleSide,
    })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.04;

  const obj = new THREE.Group();
  obj.position.set(x, 0, z);
  obj.add(mesh); obj.add(ring);
  mesh.position.y = 0.6;
  scene.add(obj);

  const p = { obj, mesh, ring, type, value: type === 'xp' ? 1 : 0, life: 12 };
  pickups.push(p);
  return p;
}

export function clearPickups() {
  for (const p of pickups) scene.remove(p.obj);
  pickups.length = 0;
}

// ============================================================
//  PARTICLES
// ============================================================
const particles = [];

export function hitBurst(pos, color, count = 8) {
  for (let i = 0; i < count; i++) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 });
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), mat);
    p.position.copy(pos);
    const a = Math.random() * Math.PI * 2;
    const s = 4 + Math.random() * 6;
    p.userData = {
      vel: new THREE.Vector3(Math.cos(a) * s, Math.random() * 4 + 1, Math.sin(a) * s),
      life: 0.5 + Math.random() * 0.3,
      ageMax: 0.8,
    };
    scene.add(p);
    particles.push(p);
  }
}

export function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.position.addScaledVector(p.userData.vel, dt);
    p.userData.vel.y -= 12 * dt;
    p.userData.life -= dt;
    p.material.opacity = Math.max(0, p.userData.life / p.userData.ageMax);
    if (p.userData.life <= 0) {
      scene.remove(p);
      particles.splice(i, 1);
    }
  }
}

export function clearParticles() {
  for (const p of particles) scene.remove(p);
  particles.length = 0;
}

// ============================================================
//  RAIN — per-wave intensity with chapter-themed color
//  Chapter sets the HUE (orange / red / yellow / green / blue / purple)
//  Wave sets the INTENSITY (drizzle → steady → downpour → torrential → typhoon)
// ============================================================
let rainGroup = null;
const rainDrops = [];
let rainTintHex = 0xaaccff;
let currentRainCfg = rainIntensity(1);
let windPhase = 0;
let nextLightningIn = 0;
let lightningFlashT = 0;
let lightningLight = null;       // THREE.DirectionalLight — chapter-tinted
let cssFlashEl = null;           // DOM overlay for the camera flash
let lightningTintHex = 0xc5d8ff; // current lightning color (chapter-tinted)

const RAIN_DROP_GEO = new THREE.BoxGeometry(0.04, 0.7, 0.04);

function ensureLightningLight() {
  if (lightningLight) return;
  lightningLight = new THREE.DirectionalLight(lightningTintHex, 0);
  lightningLight.position.set(0, 40, 0);
  scene.add(lightningLight);
}

function ensureCssFlash() {
  if (cssFlashEl || typeof document === 'undefined') return;
  cssFlashEl = document.createElement('div');
  cssFlashEl.id = 'lightning-flash';
  Object.assign(cssFlashEl.style, {
    position: 'fixed', inset: '0',
    background: '#cfd8ff',
    opacity: '0',
    pointerEvents: 'none',
    zIndex: '3',
    mixBlendMode: 'screen',
    transition: 'opacity 60ms linear',
  });
  document.body.appendChild(cssFlashEl);
}

// Lighten a hex color toward white — used to keep chapter-tinted lightning
// from looking like a colored filter. Gives a pale version of the chapter hue.
function _lightenHex(hex, amount) {
  const c = new THREE.Color(hex);
  c.lerp(new THREE.Color(0xffffff), amount);
  return c.getHex();
}

function _hexToCss(hex) {
  return '#' + hex.toString(16).padStart(6, '0');
}

function buildRainGroup(tintHex, cfg) {
  disposeRainGroupOnly();
  rainTintHex = tintHex;
  rainGroup = new THREE.Group();
  scene.add(rainGroup);

  const mat = new THREE.MeshBasicMaterial({
    color: tintHex, transparent: true, opacity: cfg.opacity,
  });

  for (let i = 0; i < cfg.dropCount; i++) {
    const drop = new THREE.Mesh(RAIN_DROP_GEO, mat);
    resetRainDrop(drop, true);
    drop.rotation.z = 0.35 + cfg.wind * 0.4;
    rainGroup.add(drop);
    rainDrops.push(drop);
  }
}

export function initRain(tintHex, localWave = 1) {
  currentRainCfg = rainIntensity(localWave);
  buildRainGroup(tintHex, currentRainCfg);
  // Lightning tint tracks chapter color, lightened toward white for flash feel
  lightningTintHex = _lightenHex(tintHex, 0.55);
  if (currentRainCfg.lightning) {
    ensureLightningLight();
    if (lightningLight) lightningLight.color.setHex(lightningTintHex);
    ensureCssFlash();
    if (cssFlashEl) cssFlashEl.style.background = _hexToCss(_lightenHex(tintHex, 0.7));
    nextLightningIn = 3 + Math.random() * 5;
  }
}

/**
 * Called at each wave start. Chapter tint sets color, localWave sets intensity.
 * Only rebuilds the drop group if the drop count changed materially.
 */
export function applyRainTo(chapterTintHex, localWave) {
  const next = rainIntensity(localWave);
  const needRebuild = !rainGroup || Math.abs(next.dropCount - rainDrops.length) > 40;

  // Lightning color always follows chapter (lightened)
  lightningTintHex = _lightenHex(chapterTintHex, 0.55);
  if (lightningLight) lightningLight.color.setHex(lightningTintHex);
  if (cssFlashEl) cssFlashEl.style.background = _hexToCss(_lightenHex(chapterTintHex, 0.7));

  if (needRebuild) {
    buildRainGroup(chapterTintHex, next);
  } else {
    rainTintHex = chapterTintHex;
    for (const drop of rainDrops) {
      drop.material.color.setHex(chapterTintHex);
      drop.material.opacity = next.opacity;
      drop.rotation.z = 0.35 + next.wind * 0.4;
    }
  }
  currentRainCfg = next;

  if (next.lightning) {
    ensureLightningLight();
    if (lightningLight) lightningLight.color.setHex(lightningTintHex);
    ensureCssFlash();
    nextLightningIn = 2 + Math.random() * 4;
  } else {
    lightningFlashT = 0;
    if (lightningLight) lightningLight.intensity = 0;
    if (cssFlashEl) cssFlashEl.style.opacity = '0';
  }
}

function resetRainDrop(drop, initialSpawn = false) {
  const r = RAIN_CONFIG.area;
  drop.position.x = (Math.random() - 0.5) * r * 2;
  drop.position.z = (Math.random() - 0.5) * r * 2;
  drop.position.y = initialSpawn
    ? Math.random() * RAIN_CONFIG.height
    : RAIN_CONFIG.height;
}

export function updateRain(dt, playerPos) {
  if (!rainGroup) return;
  const cfg = currentRainCfg;

  // Follow the player so rain appears everywhere
  rainGroup.position.x = playerPos.x;
  rainGroup.position.z = playerPos.z;

  // Wind gusting — stronger at higher waves. Typhoon adds violent swings.
  windPhase += dt * (cfg.typhoon ? 2.2 : 1.2);
  const gust = cfg.typhoon
    ? Math.sin(windPhase) * 18 + Math.sin(windPhase * 2.7) * 10
    : Math.sin(windPhase) * (cfg.wind * 8);

  const vX = cfg.speedX + gust;
  const vY = cfg.speedY * (cfg.typhoon ? 1.15 : 1.0);

  for (const drop of rainDrops) {
    drop.position.x += vX * dt;
    drop.position.y += vY * dt;
    if (drop.position.y < 0) resetRainDrop(drop);
    const r = RAIN_CONFIG.area;
    if (drop.position.x > r) drop.position.x -= r * 2;
    if (drop.position.x < -r) drop.position.x += r * 2;
  }

  // Lightning (waves 4 and 5)
  if (cfg.lightning) {
    nextLightningIn -= dt;
    if (nextLightningIn <= 0) {
      lightningFlashT = 1.0;
      nextLightningIn = cfg.typhoon
        ? 1.5 + Math.random() * 2.5
        : 4 + Math.random() * 6;
      // Typhoon double-strike
      if (cfg.typhoon && Math.random() < 0.4) {
        setTimeout(() => { lightningFlashT = Math.max(lightningFlashT, 0.9); }, 90);
      }
      // Thunder SFX hook — audio module can subscribe via window.__onLightning
      if (typeof window !== 'undefined' && window.__onLightning) {
        try { window.__onLightning(cfg.typhoon); } catch (e) {}
      }
    }
    if (lightningFlashT > 0) {
      lightningFlashT = Math.max(0, lightningFlashT - dt * 4.5);
      if (lightningLight) lightningLight.intensity = lightningFlashT * 2.0;
      if (cssFlashEl) cssFlashEl.style.opacity = String(lightningFlashT * 0.55);
    }
  }
}

export function setRainTint(tintHex) {
  if (!rainGroup) return;
  rainTintHex = tintHex;
  for (const drop of rainDrops) drop.material.color.setHex(tintHex);
  // Keep lightning in sync with chapter tint
  lightningTintHex = _lightenHex(tintHex, 0.55);
  if (lightningLight) lightningLight.color.setHex(lightningTintHex);
  if (cssFlashEl) cssFlashEl.style.background = _hexToCss(_lightenHex(tintHex, 0.7));
}

function disposeRainGroupOnly() {
  if (rainGroup) {
    for (const d of rainDrops) rainGroup.remove(d);
    scene.remove(rainGroup);
  }
  rainGroup = null;
  rainDrops.length = 0;
}

export function disposeRain() {
  disposeRainGroupOnly();
  lightningFlashT = 0;
  if (lightningLight) lightningLight.intensity = 0;
  if (cssFlashEl) cssFlashEl.style.opacity = '0';
}

// ============================================================
//  GOO SPLATS — themed, decay over 60s
// ============================================================
export const gooSplats = [];
const GOO_GEO = new THREE.CircleGeometry(GOO_CONFIG.size, 12);

export function spawnGooSplat(x, z, tintHex) {
  const mat = new THREE.MeshBasicMaterial({
    color: tintHex, transparent: true, opacity: 0.75, side: THREE.DoubleSide,
  });
  const splat = new THREE.Mesh(GOO_GEO, mat);
  splat.rotation.x = -Math.PI / 2;
  splat.position.set(x, 0.03 + Math.random() * 0.02, z);
  // Slight scale variation
  const s = 0.7 + Math.random() * 0.8;
  splat.scale.setScalar(s);
  // Random rotation
  splat.rotation.z = Math.random() * Math.PI * 2;
  scene.add(splat);
  const g = {
    mesh: splat,
    mat,
    life: GOO_CONFIG.lifetimeSec,
    lifeMax: GOO_CONFIG.lifetimeSec,
  };
  gooSplats.push(g);
  return g;
}

export function updateGooSplats(dt) {
  for (let i = gooSplats.length - 1; i >= 0; i--) {
    const g = gooSplats[i];
    g.life -= dt;
    const t = Math.max(0, g.life / g.lifeMax);
    // Fade out over the last 20% of life
    if (t < 0.2) g.mat.opacity = 0.75 * (t / 0.2);
    if (g.life <= 0) {
      scene.remove(g.mesh);
      gooSplats.splice(i, 1);
    }
  }
}

export function clearGooSplats() {
  for (const g of gooSplats) scene.remove(g.mesh);
  gooSplats.length = 0;
}

// ============================================================
//  BOSS CUBES — rain from above, hatch or explode
// ============================================================
export const bossCubes = [];
const BOSS_CUBE_GEO = new THREE.BoxGeometry(1.4, 1.4, 1.4);

export function spawnBossCube(x, z, tintHex, mode /* 'hatch' | 'explode' */) {
  const col = tintHex;
  const mat = new THREE.MeshStandardMaterial({
    color: col, emissive: col, emissiveIntensity: 1.2, roughness: 0.4,
  });
  const cube = new THREE.Mesh(BOSS_CUBE_GEO, mat);
  cube.position.set(x, 25, z);
  cube.castShadow = true;
  scene.add(cube);
  // Ground shadow warning indicator
  const ringMat = new THREE.MeshBasicMaterial({
    color: mode === 'explode' ? 0xff2e4d : 0xffd93d,
    transparent: true, opacity: 0.7, side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.6, 24), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, 0.05, z);
  scene.add(ring);

  const c = {
    mesh: cube,
    ring,
    ringMat,
    pos: cube.position,
    fallSpeed: 15,
    landed: false,
    fuseTimer: 0.8,     // after landing
    mode,               // 'hatch' or 'explode'
    tintHex,
  };
  bossCubes.push(c);
  return c;
}

export function clearBossCubes() {
  for (const c of bossCubes) {
    scene.remove(c.mesh);
    scene.remove(c.ring);
  }
  bossCubes.length = 0;
}

// ============================================================
//  CAPTURE ZONE
// ============================================================
export function makeCaptureZone(x, z) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);

  const inner = new THREE.Mesh(
    new THREE.CircleGeometry(CAPTURE_RADIUS - 0.2, 48),
    new THREE.MeshBasicMaterial({
      color: 0xffd93d, transparent: true, opacity: 0.15, side: THREE.DoubleSide,
    })
  );
  inner.rotation.x = -Math.PI / 2;
  inner.position.y = 0.04;
  group.add(inner);

  const boundary = new THREE.Mesh(
    new THREE.RingGeometry(CAPTURE_RADIUS - 0.1, CAPTURE_RADIUS + 0.2, 64),
    new THREE.MeshBasicMaterial({
      color: 0xffd93d, transparent: true, opacity: 0.8, side: THREE.DoubleSide,
    })
  );
  boundary.rotation.x = -Math.PI / 2;
  boundary.position.y = 0.05;
  group.add(boundary);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(CAPTURE_RADIUS + 0.3, CAPTURE_RADIUS + 0.6, 48, 1, 0, 0.1),
    new THREE.MeshBasicMaterial({
      color: 0xffd93d, transparent: true, opacity: 1.0, side: THREE.DoubleSide,
    })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.06;
  group.add(ring);

  const beamMat = new THREE.MeshBasicMaterial({
    color: 0xffd93d, transparent: true, opacity: 0.3, side: THREE.DoubleSide,
  });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 16, 16, 1, true), beamMat);
  beam.position.y = 8;
  group.add(beam);

  const missile = new THREE.Mesh(
    new THREE.ConeGeometry(0.8, 2.5, 6),
    new THREE.MeshStandardMaterial({ color: 0xffd93d, emissive: 0xffd93d, emissiveIntensity: 0.8 })
  );
  missile.position.y = 1.3;
  group.add(missile);

  scene.add(group);
  return {
    obj: group,
    pos: group.position,
    inner,
    ring,
    boundary,
    beam,
    missile,
  };
}

export function removeCaptureZone(zone) {
  if (zone && zone.obj) scene.remove(zone.obj);
}
