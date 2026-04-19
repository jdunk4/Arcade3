import * as THREE from 'three';
import { ARENA, THEMES } from './config.js';

export const scene = new THREE.Scene();
scene.background = new THREE.Color(THEMES[0].sky);
scene.fog = new THREE.Fog(THEMES[0].fog, 30, 85);

export const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 300);
export const CAMERA_OFFSET = new THREE.Vector3(0, 17, 11);
camera.position.copy(CAMERA_OFFSET);
camera.lookAt(0, 0, 0);

export const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---- LIGHTS (kept minimal to avoid stalls) ----
const ambient = new THREE.AmbientLight(0x3a2850, 0.55);
scene.add(ambient);

const hemi = new THREE.HemisphereLight(THEMES[0].hemi1, THEMES[0].hemi2, 0.45);
scene.add(hemi);

const moon = new THREE.DirectionalLight(0xb4a8ff, 1.0);
moon.position.set(-18, 30, 18);
moon.castShadow = true;
moon.shadow.mapSize.width = 1024; // reduced for perf
moon.shadow.mapSize.height = 1024;
moon.shadow.camera.near = 1;
moon.shadow.camera.far = 90;
moon.shadow.camera.left = -35;
moon.shadow.camera.right = 35;
moon.shadow.camera.top = 35;
moon.shadow.camera.bottom = -35;
moon.shadow.bias = -0.0008;
scene.add(moon);

const rimLight = new THREE.PointLight(THEMES[0].lamp, 1.6, 20, 1.5);
scene.add(rimLight);

// ---- GROUND ----
const groundMat = new THREE.MeshStandardMaterial({
  color: THEMES[0].ground, roughness: 0.85, metalness: 0.05
});
const ground = new THREE.Mesh(new THREE.PlaneGeometry(ARENA * 2, ARENA * 2, 1, 1), groundMat);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// ---- CHECKERED PATTERN UNDER PLAYER ----
// Uses a canvas texture for the checker. Moves with player to create a "spotlight" effect.
function makeCheckerTexture() {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  const step = size / 8;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.12)';
      ctx.fillRect(x * step, y * step, step, step);
    }
  }
  // subtle border glow
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.lineWidth = 4;
  ctx.strokeRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearFilter;
  return tex;
}

const checkerTex = makeCheckerTexture();
const checkerMat = new THREE.MeshBasicMaterial({
  map: checkerTex,
  transparent: true,
  opacity: 0.35,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
});
export const playerSpot = new THREE.Mesh(new THREE.PlaneGeometry(5, 5), checkerMat);
playerSpot.rotation.x = -Math.PI / 2;
playerSpot.position.y = 0.02;
scene.add(playerSpot);

// ---- GRID ----
let gridHelper = new THREE.GridHelper(ARENA * 2, 40, THEMES[0].grid1, THEMES[0].grid2);
gridHelper.material.opacity = 0.4;
gridHelper.material.transparent = true;
gridHelper.position.y = 0.015;
scene.add(gridHelper);

// ---- BORDER PILLARS (instanced for perf!) ----
// Instead of hundreds of individual meshes, one InstancedMesh with shared geometry/material.
const pillarPositions = [];
for (let i = -ARENA; i <= ARENA; i += 4) {
  pillarPositions.push([i, -ARENA], [i, ARENA], [-ARENA, i], [ARENA, i]);
}
const pillarGeo = new THREE.BoxGeometry(1.2, 2.2, 1.2);
const pillarMat = new THREE.MeshStandardMaterial({ color: 0x5a2a80, roughness: 0.7, emissive: 0x2a1044, emissiveIntensity: 0.3 });
const pillarMesh = new THREE.InstancedMesh(pillarGeo, pillarMat, pillarPositions.length);
pillarMesh.castShadow = true;
pillarMesh.receiveShadow = true;
{
  const dummy = new THREE.Object3D();
  pillarPositions.forEach(([x, z], i) => {
    dummy.position.set(x, 1.1, z);
    dummy.updateMatrix();
    pillarMesh.setMatrixAt(i, dummy.matrix);
  });
  pillarMesh.instanceMatrix.needsUpdate = true;
}
scene.add(pillarMesh);

// Caps (smaller instanced) — these tint with theme
const capGeo = new THREE.BoxGeometry(0.4, 0.4, 0.4);
const capMat = new THREE.MeshStandardMaterial({ color: THEMES[0].lamp, emissive: THEMES[0].lamp, emissiveIntensity: 1.8 });
const capMesh = new THREE.InstancedMesh(capGeo, capMat, pillarPositions.length);
{
  const dummy = new THREE.Object3D();
  pillarPositions.forEach(([x, z], i) => {
    dummy.position.set(x, 2.4, z);
    dummy.updateMatrix();
    capMesh.setMatrixAt(i, dummy.matrix);
  });
  capMesh.instanceMatrix.needsUpdate = true;
}
scene.add(capMesh);

// ---- TOMBSTONES ----
const tombGeo = new THREE.BoxGeometry(1.0, 1.6, 0.3);
const tombMat = new THREE.MeshStandardMaterial({ color: 0x7a5aa0, roughness: 0.9 });
const tombPositions = [];
for (let i = 0; i < 50; i++) {
  const x = (Math.random() - 0.5) * ARENA * 1.7;
  const z = (Math.random() - 0.5) * ARENA * 1.7;
  if (Math.abs(x) < 6 && Math.abs(z) < 6) continue;
  tombPositions.push([x, z, Math.random() * Math.PI]);
}
const tombMesh = new THREE.InstancedMesh(tombGeo, tombMat, tombPositions.length);
tombMesh.castShadow = true;
tombMesh.receiveShadow = true;
{
  const dummy = new THREE.Object3D();
  tombPositions.forEach(([x, z, r], i) => {
    dummy.position.set(x, 0.8, z);
    dummy.rotation.y = r;
    dummy.updateMatrix();
    tombMesh.setMatrixAt(i, dummy.matrix);
  });
  tombMesh.instanceMatrix.needsUpdate = true;
}
scene.add(tombMesh);

// ---- LAMPS (limited count with point lights) ----
const lampBulbs = [];
const lampPointLights = [];
{
  const poleGeo = new THREE.BoxGeometry(0.2, 3, 0.2);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2a1040, roughness: 0.7 });
  const bulbGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
  // Only 6 lamps (was 10 + random pillar lights before) — keeps point light count low
  for (let i = 0; i < 6; i++) {
    const x = (Math.random() - 0.5) * ARENA * 1.4;
    const z = (Math.random() - 0.5) * ARENA * 1.4;
    if (Math.abs(x) < 10 && Math.abs(z) < 10) continue;
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.set(x, 1.5, z);
    pole.castShadow = true;
    scene.add(pole);
    const bulbMat = new THREE.MeshStandardMaterial({ color: THEMES[0].lamp, emissive: THEMES[0].lamp, emissiveIntensity: 3 });
    const bulb = new THREE.Mesh(bulbGeo, bulbMat);
    bulb.position.set(x, 3.2, z);
    scene.add(bulb);
    lampBulbs.push(bulb);
    const pl = new THREE.PointLight(THEMES[0].lamp, 2.0, 14, 1.4);
    pl.position.set(x, 3.2, z);
    scene.add(pl);
    lampPointLights.push(pl);
  }
}

export const Scene = {
  scene, camera, renderer, rimLight, ground, groundMat, gridHelper,
  capMesh, capMat, lampBulbs, lampPointLights, hemi, playerSpot,
};

// ---- THEME APPLICATION ----
export function applyTheme(idx) {
  const t = THEMES[idx % THEMES.length];
  scene.background.set(t.sky);
  scene.fog.color.set(t.fog);
  groundMat.color.set(t.ground);
  // Rebuild grid (colors are baked at construction)
  scene.remove(gridHelper);
  gridHelper = new THREE.GridHelper(ARENA * 2, 40, t.grid1, t.grid2);
  gridHelper.material.opacity = 0.4;
  gridHelper.material.transparent = true;
  gridHelper.position.y = 0.015;
  scene.add(gridHelper);
  Scene.gridHelper = gridHelper;
  hemi.color.set(t.hemi1);
  hemi.groundColor.set(t.hemi2);
  rimLight.color.set(t.lamp);
  capMat.color.set(t.lamp);
  capMat.emissive.set(t.lamp);
  for (const bulb of lampBulbs) {
    bulb.material.color.set(t.lamp);
    bulb.material.emissive.set(t.lamp);
  }
  for (const pl of lampPointLights) pl.color.set(t.lamp);
  return t;
}
