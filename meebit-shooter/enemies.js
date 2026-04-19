import * as THREE from 'three';
import { scene } from './scene.js';
import { ENEMY_TYPES, BOSSES, ARENA } from './config.js';

export const enemies = [];
export const enemyProjectiles = []; // spitter acid balls

// Colors derive from theme tint so entire arena feels cohesive.
// tintColor is the theme's enemy tint hex.
export function makeEnemy(type, tintColor, pos) {
  const def = ENEMY_TYPES[type];
  if (!def) return null;

  const group = new THREE.Group();

  // Mix base dark with theme tint
  const tint = new THREE.Color(tintColor);
  const bodyColor = new THREE.Color(0x2a1040).lerp(tint, 0.45);
  const headColor = tint.clone().lerp(new THREE.Color(0xffffff), 0.25);
  const limbColor = new THREE.Color(0x1a0828).lerp(tint, 0.3);

  const bodyMat = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.7 });
  const headMat = new THREE.MeshStandardMaterial({
    color: headColor, roughness: 0.6,
    emissive: headColor, emissiveIntensity: 0.3
  });
  const limbMat = new THREE.MeshStandardMaterial({ color: limbColor, roughness: 0.7 });
  const eyeMat = new THREE.MeshStandardMaterial({
    color: 0xff0044, emissive: 0xff0044, emissiveIntensity: 2.5
  });

  // BODY
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.1, 0.5), bodyMat);
  body.position.y = 0.7; body.castShadow = true;
  group.add(body);

  // HEAD (shape varies by type)
  let headGeo;
  if (type === 'brute') headGeo = new THREE.BoxGeometry(1.0, 0.9, 0.9);
  else if (type === 'sprinter') headGeo = new THREE.BoxGeometry(0.65, 0.65, 0.65);
  else if (type === 'spitter') headGeo = new THREE.BoxGeometry(0.9, 0.6, 0.9);
  else if (type === 'phantom') headGeo = new THREE.BoxGeometry(0.75, 0.85, 0.75);
  else headGeo = new THREE.BoxGeometry(0.75, 0.75, 0.75);
  const head = new THREE.Mesh(headGeo, headMat);
  head.position.y = 1.65; head.castShadow = true;
  group.add(head);

  // EYES
  const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.08), eyeMat);
  const eyeR = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.08), eyeMat);
  eyeL.position.set(-0.18, 1.7, 0.36);
  eyeR.position.set(0.18, 1.7, 0.36);
  group.add(eyeL); group.add(eyeR);

  // ARMS & LEGS
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.9, 0.25), limbMat);
  const armR = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.9, 0.25), limbMat);
  armL.position.set(-0.58, 0.9, 0.15); armL.castShadow = true;
  armR.position.set(0.58, 0.9, 0.15); armR.castShadow = true;
  group.add(armL); group.add(armR);

  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.8, 0.3), limbMat);
  const legR = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.8, 0.3), limbMat);
  legL.position.set(-0.2, 0.1, 0); legL.castShadow = true;
  legR.position.set(0.2, 0.1, 0); legR.castShadow = true;
  group.add(legL); group.add(legR);

  group.scale.setScalar(def.scale);
  group.position.copy(pos);
  scene.add(group);

  const enemy = {
    obj: group, body, head, armL, armR, legL, legR,
    bodyMat, headMat, limbMat,
    pos: group.position,
    speed: def.speed * (0.9 + Math.random() * 0.2),
    hp: def.hp, hpMax: def.hp,
    xpVal: def.xp, scoreVal: def.score,
    damage: def.damage,
    walkPhase: Math.random() * Math.PI * 2,
    hitFlash: 0,
    touchCooldown: 0,
    rangedCooldown: 1 + Math.random() * 2,
    type, name: def.name,
    ranged: !!def.ranged, range: def.range || 0,
    phases: !!def.phases,
    phaseTimer: Math.random() * 3,
    isBoss: false,
  };
  enemies.push(enemy);
  return enemy;
}

export function makeBoss(bossType, tintColor, pos) {
  const def = BOSSES[bossType];
  if (!def) return null;

  const tint = new THREE.Color(tintColor);
  const group = new THREE.Group();

  const bodyColor = new THREE.Color(0x220622).lerp(tint, 0.6);
  const headColor = tint.clone();

  const bodyMat = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.6, emissive: bodyColor, emissiveIntensity: 0.15 });
  const headMat = new THREE.MeshStandardMaterial({ color: headColor, roughness: 0.5, emissive: headColor, emissiveIntensity: 0.5 });
  const crownMat = new THREE.MeshStandardMaterial({ color: 0xffd93d, emissive: 0xffd93d, emissiveIntensity: 2.5 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.5, 0.8), bodyMat);
  body.position.y = 0.9; body.castShadow = true; group.add(body);

  const head = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.1, 1.1), headMat);
  head.position.y = 2.2; head.castShadow = true; group.add(head);

  // Crown of spikes
  for (let i = 0; i < 5; i++) {
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.4, 4), crownMat);
    spike.position.set((i - 2) * 0.22, 2.95, 0);
    group.add(spike);
  }

  // Glowing eyes
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xff2e4d, emissiveIntensity: 4 });
  const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.1), eyeMat);
  const eyeR = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.1), eyeMat);
  eyeL.position.set(-0.25, 2.25, 0.55);
  eyeR.position.set(0.25, 2.25, 0.55);
  group.add(eyeL); group.add(eyeR);

  // Big arms & legs
  const limbMat = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.6 });
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.3, 0.4), limbMat);
  const armR = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.3, 0.4), limbMat);
  armL.position.set(-0.9, 1.1, 0.15); armL.castShadow = true;
  armR.position.set(0.9, 1.1, 0.15); armR.castShadow = true;
  group.add(armL); group.add(armR);

  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.0, 0.5), limbMat);
  const legR = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.0, 0.5), limbMat);
  legL.position.set(-0.3, 0.0, 0); legL.castShadow = true;
  legR.position.set(0.3, 0.0, 0); legR.castShadow = true;
  group.add(legL); group.add(legR);

  // Aura point light
  const auraLight = new THREE.PointLight(tint.getHex(), 3, 12, 2);
  auraLight.position.y = 2;
  group.add(auraLight);

  group.scale.setScalar(def.scale);
  group.position.copy(pos);
  scene.add(group);

  const boss = {
    obj: group, body, head, armL, armR, legL, legR,
    bodyMat, headMat, limbMat,
    pos: group.position,
    speed: def.speed,
    hp: def.hp, hpMax: def.hp,
    xpVal: def.xp, scoreVal: def.score,
    damage: def.damage,
    walkPhase: 0,
    hitFlash: 0,
    touchCooldown: 0,
    rangedCooldown: 2,
    type: 'boss',
    name: def.name,
    ranged: true, range: 20,
    phases: false,
    phaseTimer: 0,
    isBoss: true,
  };
  enemies.push(boss);
  return boss;
}

// ---- ENEMY PROJECTILES (spitter/boss) ----
const PROJ_GEO = new THREE.SphereGeometry(0.25, 6, 4);

export function spawnEnemyProjectile(from, targetPos, speed, damage, color = 0x00ff66) {
  const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2 });
  const m = new THREE.Mesh(PROJ_GEO, mat);
  m.position.set(from.x, 1.4, from.z);
  const dx = targetPos.x - from.x;
  const dz = targetPos.z - from.z;
  const dist = Math.sqrt(dx*dx + dz*dz) || 1;
  m.userData = {
    vel: new THREE.Vector3(dx / dist * speed, 0, dz / dist * speed),
    life: 3,
    damage,
  };
  scene.add(m);
  enemyProjectiles.push(m);
}

export function clearAllEnemies() {
  for (const e of enemies) scene.remove(e.obj);
  enemies.length = 0;
  for (const p of enemyProjectiles) scene.remove(p);
  enemyProjectiles.length = 0;
}
