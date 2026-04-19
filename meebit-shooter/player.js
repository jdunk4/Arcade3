import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PLAYER } from './config.js';
import { scene } from './scene.js';

export const player = {
  obj: null,
  skinnedMeshes: [],
  bones: {},             // name -> THREE.Bone
  restPose: {},          // name -> { rx, ry, rz, px, py, pz }
  pos: new THREE.Vector3(0, 0, 0),
  vel: new THREE.Vector3(),
  facing: 0,
  walkPhase: 0,
  gun: null,
  gunMat: null,          // so we can recolor per weapon
  muzzle: null,
  ready: false,
};

export function loadPlayer(onProgress, onReady, onError) {
  const loader = new GLTFLoader();
  loader.load('assets/meebit.glb',
    (gltf) => {
      const meebit = gltf.scene;
      meebit.scale.setScalar(PLAYER.scale);

      // Find skinned meshes & grab skeleton
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
          // CRITICAL: ensure skeleton updates each frame
          o.frustumCulled = false;
        }
      });

      if (!skeleton) {
        console.warn('[meebit] NO SKELETON FOUND — model will not animate');
      } else {
        // Map bones by name and snapshot rest pose
        for (const bone of skeleton.bones) {
          player.bones[bone.name] = bone;
          player.restPose[bone.name] = {
            rx: bone.rotation.x, ry: bone.rotation.y, rz: bone.rotation.z,
            px: bone.position.x, py: bone.position.y, pz: bone.position.z,
          };
        }
        console.log(`[meebit] skeleton ready — ${skeleton.bones.length} bones, ${Object.keys(player.bones).length} named`);
      }

      player.obj = meebit;
      scene.add(meebit);

      // Gun — attached to right hand bone if possible
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

// Helper: set a bone's rotation as rest + delta
function setBone(name, dx, dy, dz) {
  const b = player.bones[name];
  if (!b) return;
  const r = player.restPose[name];
  b.rotation.x = r.rx + dx;
  b.rotation.y = r.ry + dy;
  b.rotation.z = r.rz + dz;
}

/**
 * Called every frame to drive the procedural animation.
 * @param {number} dt delta time
 * @param {boolean} moving whether player is moving
 * @param {number} timeElapsed total game time
 */
export function animatePlayer(dt, moving, timeElapsed) {
  if (!player.ready) return;

  // Advance walk phase
  player.walkPhase += dt * (moving ? 10 : 3);
  const target = moving ? 1 : 0;

  const swing = Math.sin(player.walkPhase);
  const legSwing = swing * target * 1.0;
  const armSwing = swing * target * 0.5;

  // LEGS: thighs swing fwd/back, calves bend
  setBone('thigh_l', legSwing, 0, 0);
  setBone('thigh_r', -legSwing, 0, 0);
  // Calves bend on the trailing leg
  setBone('calf_l', Math.max(0, -legSwing) * 1.0, 0, 0);
  setBone('calf_r', Math.max(0, legSwing) * 1.0, 0, 0);

  // FEET keep flat-ish
  setBone('foot_l', legSwing * 0.3, 0, 0);
  setBone('foot_r', -legSwing * 0.3, 0, 0);

  // LEFT ARM: natural counter-swing
  setBone('upperarm_l', -armSwing, 0, 0.12);
  setBone('lowerarm_l', Math.abs(armSwing) * 0.6, 0, 0);

  // RIGHT ARM: raised shooting stance (always)
  // These are deltas from rest pose. UE rig has arms down at rest, so we raise significantly.
  setBone('upperarm_r', -1.3, 0, -0.15);
  setBone('lowerarm_r', 0.1, -0.3, 0);
  setBone('hand_r', 0, 0, 0);

  // SPINE + HEAD: subtle idle sway
  const t = timeElapsed;
  setBone('spine_03', 0, 0, Math.sin(t * 2) * 0.03);
  setBone('spine_02', 0, 0, Math.sin(t * 2 + 0.3) * 0.02);
  setBone('spine_01', 0, Math.sin(player.walkPhase) * target * 0.08, 0);
  setBone('head', 0, Math.sin(t * 1.2) * 0.08, 0);
  setBone('neck_01', 0, 0, Math.sin(t * 0.9) * 0.02);

  // PELVIS: small vertical bob
  const pelvis = player.bones['pelvis'];
  if (pelvis) {
    const rest = player.restPose['pelvis'];
    const bob = target * Math.abs(Math.sin(player.walkPhase * 2)) * 0.05;
    pelvis.position.set(rest.px, rest.py - bob, rest.pz);
    // pelvis tilt on footstep
    pelvis.rotation.z = player.restPose['pelvis'].rz + Math.sin(player.walkPhase) * target * 0.04;
  }

  // Force skeleton to recompute. Three.js normally does this automatically
  // during rendering, but being explicit here guarantees the bones take.
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
