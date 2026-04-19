import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PLAYER } from './config.js';
import { scene } from './scene.js';

export const player = {
  obj: null,
  skinnedMeshes: [],
  bones: {},              // name -> THREE.Bone
  restQuat: {},           // name -> THREE.Quaternion (rest pose quaternion)
  restPos: {},            // name -> THREE.Vector3 (rest pose position)
  pos: new THREE.Vector3(0, 0, 0),
  vel: new THREE.Vector3(),
  facing: 0,
  walkPhase: 0,
  gun: null,
  gunMat: null,
  muzzle: null,
  ready: false,
};

// Reusable quaternions to avoid GC
const _qDelta = new THREE.Quaternion();
const _euler = new THREE.Euler();

export function loadPlayer(onProgress, onReady, onError) {
  const loader = new GLTFLoader();
  loader.load('assets/meebit.glb',
    (gltf) => {
      const meebit = gltf.scene;
      meebit.scale.setScalar(PLAYER.scale);

      let skeleton = null;
      meebit.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
          if (o.material) {
            o.material.roughness = 0.75;
            o.material.metalness = 0.1;
          }
        }
        if (o.isSkinnedMesh) {
          player.skinnedMeshes.push(o);
          if (!skeleton) skeleton = o.skeleton;
          o.frustumCulled = false;
        }
      });

      if (skeleton) {
        // Store REST POSE as quaternions (axis-agnostic)
        for (const bone of skeleton.bones) {
          player.bones[bone.name] = bone;
          player.restQuat[bone.name] = bone.quaternion.clone();
          player.restPos[bone.name] = bone.position.clone();
          bone.matrixAutoUpdate = true;
        }
        console.log(`[meebit] skeleton ready — ${skeleton.bones.length} bones`);
        const keys = ['thigh_l','thigh_r','calf_l','calf_r','upperarm_l','upperarm_r','spine_03','head','pelvis'];
        console.log(`[meebit] key bones found:`, keys.filter(n => player.bones[n]).join(', '));
      } else {
        console.warn('[meebit] NO SKELETON — model will not animate');
      }

      player.obj = meebit;
      scene.add(meebit);

      // Gun
      const gunGeo = new THREE.BoxGeometry(0.1, 0.1, 0.4);
      const gunMat = new THREE.MeshStandardMaterial({
        color: 0x111111, emissive: 0x4ff7ff, emissiveIntensity: 0.6
      });
      const gun = new THREE.Mesh(gunGeo, gunMat);
      gun.position.set(0, -0.05, 0.2);
      gun.castShadow = true;
      if (player.bones['hand_r']) {
        player.bones['hand_r'].add(gun);
      } else {
        gun.position.set(0.35 * PLAYER.scale, 1.2 * PLAYER.scale, 0.3 * PLAYER.scale);
        meebit.add(gun);
      }
      player.gun = gun;
      player.gunMat = gunMat;

      const muzzle = new THREE.PointLight(0x4ff7ff, 0, 6, 2);
      gun.add(muzzle);
      muzzle.position.set(0, 0, 0.3);
      player.muzzle = muzzle;

      player.ready = true;
      onReady && onReady();
    },
    onProgress,
    onError
  );
}

/**
 * Rotate a bone by (dx, dy, dz) Euler radians RELATIVE TO ITS REST POSE.
 * Uses quaternion multiplication so axis ordering doesn't matter.
 */
function rotateBone(name, dx, dy, dz) {
  const b = player.bones[name];
  if (!b) return;
  const rest = player.restQuat[name];
  _euler.set(dx, dy, dz, 'XYZ');
  _qDelta.setFromEuler(_euler);
  // b.quaternion = restQuat * delta  (delta applied in local space)
  b.quaternion.copy(rest).multiply(_qDelta);
}

function offsetBone(name, dx, dy, dz) {
  const b = player.bones[name];
  if (!b) return;
  const rest = player.restPos[name];
  b.position.set(rest.x + dx, rest.y + dy, rest.z + dz);
}

export function animatePlayer(dt, moving, timeElapsed) {
  if (!player.ready) return;

  player.walkPhase += dt * (moving ? 10 : 3);
  const target = moving ? 1 : 0;
  const swing = Math.sin(player.walkPhase);

  const legSwing = swing * target * 1.1;
  const armSwing = swing * target * 0.5;

  // LEGS
  rotateBone('thigh_l', legSwing, 0, 0);
  rotateBone('thigh_r', -legSwing, 0, 0);
  rotateBone('calf_l', Math.max(0, -legSwing) * 1.1, 0, 0);
  rotateBone('calf_r', Math.max(0, legSwing) * 1.1, 0, 0);
  rotateBone('foot_l', legSwing * 0.3, 0, 0);
  rotateBone('foot_r', -legSwing * 0.3, 0, 0);

  // LEFT ARM — counter-swing
  rotateBone('upperarm_l', -armSwing, 0, 0);
  rotateBone('lowerarm_l', Math.abs(armSwing) * 0.8, 0, 0);

  // RIGHT ARM — shooting stance
  rotateBone('upperarm_r', -1.35, 0, 0);
  rotateBone('lowerarm_r', 0.15, 0, 0);

  // SPINE + HEAD idle
  rotateBone('spine_03', 0, 0, Math.sin(timeElapsed * 2) * 0.04);
  rotateBone('spine_01', 0, Math.sin(player.walkPhase) * target * 0.08, 0);
  rotateBone('head', 0, Math.sin(timeElapsed * 1.2) * 0.08, 0);
  rotateBone('neck_01', 0, 0, Math.sin(timeElapsed * 0.9) * 0.02);

  // PELVIS bob
  const bob = target * Math.abs(Math.sin(player.walkPhase * 2)) * 0.05;
  offsetBone('pelvis', 0, -bob, 0);
  rotateBone('pelvis', 0, 0, Math.sin(player.walkPhase) * target * 0.05);

  // Force skeleton recompute
  for (const skin of player.skinnedMeshes) {
    skin.skeleton.update();
  }
}

export function recolorGun(hex) {
  if (player.gunMat) {
    player.gunMat.emissive.setHex(hex);
    if (player.muzzle) player.muzzle.color.setHex(hex);
  }
}

export function resetPlayer() {
  player.pos.set(0, 0, 0);
  player.vel.set(0, 0, 0);
  player.facing = 0;
  player.walkPhase = 0;
  if (player.obj) player.obj.position.set(0, 0, 0);
}
