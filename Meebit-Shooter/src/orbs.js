import * as THREE from 'three';
import { scene } from './scene.js';
import { ARENA, CHAPTERS, orbCountForWave } from './config.js';

// Ambient glow orbs that drift around the arena. Count and speed scale with
// the wave index inside the current chapter.

const orbs = [];

export function spawnOrbs(chapterIdx, localWave) {
  clearAllOrbs();
  const count = orbCountForWave(localWave);
  if (count === 0) return;

  const theme = CHAPTERS[chapterIdx % CHAPTERS.length].full;
  const orbColor = theme.orb || theme.lamp;

  for (let i = 0; i < count; i++) {
    const geo = new THREE.SphereGeometry(0.3 + Math.random() * 0.3, 8, 6);
    const mat = new THREE.MeshBasicMaterial({
      color: orbColor,
      transparent: true,
      opacity: 0.75,
    });
    const orb = new THREE.Mesh(geo, mat);

    // Soft glow shell
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(0.9, 8, 6),
      new THREE.MeshBasicMaterial({
        color: orbColor, transparent: true, opacity: 0.12, depthWrite: false,
      })
    );
    orb.add(glow);

    // Place somewhere in the arena, at varying heights
    const r = 10 + Math.random() * (ARENA - 15);
    const a = Math.random() * Math.PI * 2;
    orb.position.set(
      Math.cos(a) * r,
      2 + Math.random() * 6,
      Math.sin(a) * r
    );

    orb.userData = {
      orbitCenter: new THREE.Vector3(0, orb.position.y, 0),
      orbitRadius: r,
      orbitAngle: a,
      orbitSpeed: (0.05 + Math.random() * 0.1) * (localWave / 5) * (Math.random() < 0.5 ? 1 : -1),
      bobPhase: Math.random() * Math.PI * 2,
      bobSpeed: 0.6 + Math.random() * 0.8,
      baseY: orb.position.y,
    };
    scene.add(orb);
    orbs.push(orb);
  }
}

export function updateOrbs(dt) {
  for (const orb of orbs) {
    const u = orb.userData;
    u.orbitAngle += u.orbitSpeed * dt;
    orb.position.x = Math.cos(u.orbitAngle) * u.orbitRadius;
    orb.position.z = Math.sin(u.orbitAngle) * u.orbitRadius;
    u.bobPhase += u.bobSpeed * dt;
    orb.position.y = u.baseY + Math.sin(u.bobPhase) * 0.7;
    // Subtle twinkle
    orb.material.opacity = 0.6 + Math.sin(u.bobPhase * 2) * 0.2;
  }
}

export function clearAllOrbs() {
  for (const orb of orbs) scene.remove(orb);
  orbs.length = 0;
}
