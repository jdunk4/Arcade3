// shieldShader.js — Classic GLSL ShaderMaterial port of the Three.js
// Journey procedural shield asset. Runs in plain WebGLRenderer with
// no TSL, no WebGPU, no async init. Visual fidelity: ~90% of the
// reference asset (we lose the deepest TSL niceties like ground
// junction nodes, but the hex pattern + Fresnel rim + 5-slot impact
// ripples + chapter tint all carry over).
//
// Public API:
//   loadShieldTexture()        → Promise (kicks off lazy load)
//   isShieldTextureLoaded()    → boolean
//   buildShield(tintHex, opts) → { mesh, impacts: { add }, ... } | null
//   updateShieldsTick(elapsed, dt) → per-frame (drives time uniform + impact ramps)
//   disposeShield(handle)       → cleanup
//
// Each impact: shield.impacts.add(worldPos, radius=1) ramps up the
// impact radius over 0.10s (ease-out) then back to 0 over 1s (ease-in).
// Up to 5 impacts can be active simultaneously per shield.
//
// Performance: per-frame cost = 1 uniform write per shield (time) +
// O(impacts active) ramp math + 1 GLSL fragment shader compile per
// material instance (one-time at construction). No per-frame allocations.

import * as THREE from 'three';

const HEX_TEXTURE_URL = 'assets/shield/hexagons.png';
const IMPACT_COUNT = 5;

// ---- Texture loader (lazy, cached) ----
let _hexTexture = null;
let _hexLoadPromise = null;
let _hexLoadFailed = false;

export function loadShieldTexture() {
  if (_hexLoadPromise) return _hexLoadPromise;
  const loader = new THREE.TextureLoader();
  _hexLoadPromise = new Promise((resolve) => {
    loader.load(
      HEX_TEXTURE_URL,
      (tex) => {
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = true;
        _hexTexture = tex;
        resolve();
      },
      undefined,
      (err) => {
        console.warn('[shieldShader] hex texture failed to load', err);
        _hexLoadFailed = true;
        resolve();
      }
    );
  });
  return _hexLoadPromise;
}

export function isShieldTextureLoaded() {
  return !!_hexTexture && !_hexLoadFailed;
}

// ---- Active shield tracker (for time uniform + impact ramps) ----
const _activeShields = [];

// ---- GLSL ----
//
// Vertex: Standard transform with one twist — we multiply position by
// uRadius before transforming, so the unit-sphere geometry can be
// scaled up via uniform without resizing the mesh. Pass worldPos,
// viewNormal, localPos, uv to the fragment for use in the lighting
// calculation.

const VERT = /* glsl */ `
  uniform float uRadius;

  varying vec3 vWorldPos;
  varying vec3 vLocalPos;
  varying vec3 vViewNormal;
  varying vec3 vViewDir;
  varying vec2 vUv;

  void main() {
    // Scale the unit sphere up by radius. position is on the unit
    // sphere; this gives us the shield surface in local space.
    vec3 scaledPos = position * uRadius;

    // Local position of this fragment — used for impact distance
    // fields (impacts are stored in mesh-local coords).
    vLocalPos = scaledPos;

    vec4 worldPos = modelMatrix * vec4(scaledPos, 1.0);
    vWorldPos = worldPos.xyz;
    vec4 viewPos = viewMatrix * worldPos;

    // Normal in view space, normalized — used for Fresnel rim.
    // For a sphere centered at the origin, the local normal IS the
    // local position direction. modelViewMatrix may have non-uniform
    // scale (we don't, but be safe) so use normalMatrix.
    vViewNormal = normalize(normalMatrix * normal);

    // View direction (from fragment to camera) in view space.
    // Camera is at view-space origin, so it's just -viewPos.xyz normalized.
    vViewDir = normalize(-viewPos.xyz);

    vUv = uv;

    gl_Position = projectionMatrix * viewPos;
  }
`;

// Fragment: This is where the hex shield magic happens.
//
// Inputs (uniforms):
//   uTime: elapsed seconds, drives hex pulse + line scroll
//   uTexture: hexagons.png (R=brightness, G=phase offset, B=mask)
//   uColorA: chapter tint (RGB)
//   uColorB: bright accent (RGB) — used at peak emissive strength
//   uStrength: overall emissive multiplier (drives breathing pulse + drop animation)
//   uImpacts: vec4[5] — xyz = local impact center, w = current radius
//
// Output: vec4(emissive_color * emissive_strength, alpha)
//   alpha is derived from emissiveStrength so dark regions of the
//   shield go transparent — combined with additive blending this
//   gives a clean "force field, only visible where energized" look.

const FRAG = /* glsl */ `
  #define IMPACT_COUNT ${IMPACT_COUNT}

  uniform float uTime;
  uniform sampler2D uTexture;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform float uStrength;
  uniform vec4 uImpacts[IMPACT_COUNT];

  varying vec3 vWorldPos;
  varying vec3 vLocalPos;
  varying vec3 vViewNormal;
  varying vec3 vViewDir;
  varying vec2 vUv;

  // Smooth remap of x from [in0, in1] to [out0, out1], clamped.
  float remap(float x, float in0, float in1, float out0, float out1) {
    float t = clamp((x - in0) / (in1 - in0), 0.0, 1.0);
    return out0 + t * (out1 - out0);
  }

  void main() {
    // ============================================================
    // 1. IMPACT FIELD — compute the brightest active impact at this
    //    fragment. Each impact's .w is its current expanding radius;
    //    we measure local-space distance from the impact center to
    //    this fragment, subtract from the radius, max with 0 to
    //    get a "how far inside the impact ripple" value.
    // ============================================================
    float finalImpact = 0.0;
    for (int i = 0; i < IMPACT_COUNT; i++) {
      vec4 imp = uImpacts[i];
      // Skip empty slots (radius 0).
      if (imp.w > 0.0) {
        float d = distance(imp.xyz, vLocalPos);
        float inside = max(imp.w - d, 0.0);
        finalImpact = max(finalImpact, inside);
      }
    }
    // Sharpen the impact value so it reads as a bright pulse rather
    // than a soft wash. Original asset uses remap(impact, 0.4, 0, 1, 0)
    // which makes only the strongest impact regions visible.
    finalImpact = remap(finalImpact, 0.0, 0.4, 0.0, 1.0);

    // ============================================================
    // 2. FRESNEL — 1 - |dot(viewDir, normal)|. Bright at silhouette,
    //    dark when the surface faces the camera directly. Drives the
    //    "force field rim glow" look.
    // ============================================================
    float fresnel = 1.0 - abs(dot(vViewDir, vViewNormal));

    // ============================================================
    // 3. HEXAGONS — sample the data-encoded texture. The texture
    //    encodes 3 channels per hex:
    //      R = base brightness gradient (0 at hex center → 1 at edges)
    //      G = per-hex random phase offset (so each hex pulses at a
    //          different time)
    //      B = "this hex is on" mask (handles non-rectangular tiling
    //          bleed at the texture edges)
    //    UV is multiplied by (6, 4) so 6 hexes wrap horizontally and
    //    4 vertically around the sphere — same density as the asset.
    // ============================================================
    vec4 hexColor = texture2D(uTexture, vUv * vec2(6.0, 4.0));

    // Per-hex animated pulse. sin(time + G*2π) gives each hex its
    // own phase. Remap from [-1,1] to [0,1]. Combine with finalImpact
    // so impacts force every hex they touch to be fully visible.
    float TWO_PI = 6.283185307179586;
    float pulse = (sin(uTime + hexColor.g * TWO_PI) + 1.0) * 0.5;
    float hexStep = max(pulse, finalImpact);

    // Mask: only show this hex where its R brightness > pulse threshold.
    // step(edge, x) = 1 if x > edge, else 0.
    float hexMask = step(hexStep, hexColor.r);

    // Polar fade: hex texture distorts hard near v=0 / v=1 (sphere
    // poles). Smooth-fade hexes out there. abs(uv.y - 0.5) gives 0
    // at equator, 0.5 at poles. remapClamp from 0.35 (full bright)
    // to 0.20 (fade to dark) gives a soft attenuation near the poles.
    float polarFade = 1.0 - smoothstep(0.20, 0.35, abs(vUv.y - 0.5));

    // Fresnel modulator — hexes appear stronger at silhouette + during impact.
    // pow(fresnel, 2) sharpens the silhouette emphasis.
    float fresnelFade = max(pow(fresnel, 2.0), finalImpact);

    // Fill: combine R brightness with impact field.
    float hexFill = max(hexColor.r, finalImpact);

    // Final hex contribution.
    float hexagons = hexMask * hexColor.b * polarFade * fresnelFade * hexFill;

    // ============================================================
    // 4. VERTICAL SCROLLING LINES — subtle bright stripes scroll up
    //    the shield over time. Adds an "energy" feel to the surface
    //    between hex pulses. Bumped strength from 0.05 to 0.10 so
    //    the lines stay visible at distance.
    // ============================================================
    float linesStrength = (sin(vWorldPos.y * 3.0 - uTime) + 1.0) * 0.5 * 0.10;
    float lines = pow(fract(vWorldPos.y * 20.0 + uTime), 3.0) * linesStrength;

    // ============================================================
    // 5. COMBINE.
    //    The shield needs to be visible at any camera distance — a
    //    pure Fresnel + hex pulse setup goes nearly invisible when
    //    the player walks back because Fresnel is direction-dependent
    //    and the hex pulses are time-gated. We add a CONSTANT base
    //    term (0.22) so every fragment has a minimum chapter-tinted
    //    glow regardless of angle, time, or impact state. Tuned so
    //    the shield reads as a soft tinted bubble even at idle, with
    //    the hex/Fresnel/lines piling on top for the "active force
    //    field" feel.
    // ============================================================
    float baseGlow = 0.22;
    float emissiveStrength = (hexagons + pow(fresnel, 5.0) + lines + baseGlow) * uStrength;
    vec3 emissive = mix(uColorA, uColorB, clamp(emissiveStrength, 0.0, 1.0)) * emissiveStrength;

    // Alpha: tied to emissive brightness with a small floor so the
    // shield never fully disappears. With additive blending the
    // absolute alpha mostly affects how the shield reads against
    // bright backgrounds; the floor keeps the silhouette always
    // showing at least a hint.
    float alpha = clamp(emissiveStrength, 0.05, 1.0);

    gl_FragColor = vec4(emissive, alpha);
  }
`;

// ---- Halo overlay material ----
//
// A simpler shader that produces a chapter-tinted Fresnel halo around
// the shield. Renders on a slightly-larger sphere so the silhouette
// extends beyond the hex shield, giving the appearance of a tinted
// glow surrounding the surface. Pure additive blend; no hex pattern.
// This is what makes the shield read at distance — the hex pattern
// alone goes nearly invisible far from camera, but the halo's smooth
// gradient stays.

const HALO_VERT = /* glsl */ `
  uniform float uRadius;
  varying vec3 vViewNormal;
  varying vec3 vViewDir;
  void main() {
    vec3 scaledPos = position * uRadius;
    vec4 viewPos = viewMatrix * modelMatrix * vec4(scaledPos, 1.0);
    vViewNormal = normalize(normalMatrix * normal);
    vViewDir = normalize(-viewPos.xyz);
    gl_Position = projectionMatrix * viewPos;
  }
`;

const HALO_FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColorA;
  uniform float uStrength;
  varying vec3 vViewNormal;
  varying vec3 vViewDir;
  void main() {
    // Strong rim Fresnel — peaks at silhouette, falls off toward
    // surface front. Higher exponent = tighter rim.
    float fresnel = 1.0 - abs(dot(vViewDir, vViewNormal));
    float rim = pow(fresnel, 2.5);
    // Slight breathing pulse on the rim brightness so the halo feels
    // alive even when no impacts are active.
    float pulse = 0.8 + 0.2 * (sin(uTime * 1.4) * 0.5 + 0.5);
    float intensity = rim * pulse * uStrength * 0.18;
    gl_FragColor = vec4(uColorA * intensity, intensity);
  }
`;

function _buildHaloMesh(radius, colorAUniform, strengthUniform) {
  const haloMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColorA: colorAUniform,           // SHARED ref with main shield
      uStrength: strengthUniform,        // SHARED ref with main shield
      uRadius: { value: radius * 1.12 },
    },
    vertexShader: HALO_VERT,
    fragmentShader: HALO_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,           // render only back face — looks like a glow ring
    depthWrite: false,
    toneMapped: false,
  });
  // Same unit sphere geometry as the shield; uRadius scales it.
  const geo = new THREE.SphereGeometry(1, 24, 16);
  return new THREE.Mesh(geo, haloMat);
}

// ---- Builder ----
//
// tintHex: chapter tint as a hex int (e.g. 0xff2e4d)
// opts.radius: shield radius in world units (default 3.8)
// opts.strength: emissive baseline (default 7)
//
// Returns null if the hex texture hasn't loaded yet — caller should
// fall back to the simpler glow shield.

export function buildShield(tintHex, opts = {}) {
  if (!_hexTexture) return null;

  const radius = opts.radius ?? 3.8;
  const strength = opts.strength ?? 7;

  // Derive the two-color palette from the single chapter tint.
  // colorA = the tint itself (mid surface)
  // colorB = the tint pushed bright toward white (rim halo + impact peaks)
  const tintA = new THREE.Color(tintHex);
  const tintB = new THREE.Color(tintHex).lerp(new THREE.Color(0xffffff), 0.45);

  // Initialize 5 empty impact slots. Vec4(0,0,0,0) means "no active impact."
  const impactsArray = [];
  for (let i = 0; i < IMPACT_COUNT; i++) {
    impactsArray.push(new THREE.Vector4(0, 0, 0, 0));
  }

  const uniforms = {
    uTime: { value: 0 },
    uTexture: { value: _hexTexture },
    uColorA: { value: new THREE.Vector3(tintA.r, tintA.g, tintA.b) },
    uColorB: { value: new THREE.Vector3(tintB.r, tintB.g, tintB.b) },
    uStrength: { value: strength },
    uRadius: { value: radius },
    uImpacts: { value: impactsArray },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    depthWrite: false,
    toneMapped: false,
  });

  // Unit sphere — uRadius uniform scales it in the vertex shader.
  // 32×32 segments matches the asset; gives smooth silhouette + good
  // UV resolution for the hex pattern.
  const geo = new THREE.SphereGeometry(1, 32, 32);
  const mesh = new THREE.Mesh(geo, material);

  // Chapter-tint halo overlay — slightly larger sphere with pure
  // Fresnel rim glow. Parented to the shield so it inherits position
  // + scale automatically. Shares the colorA + strength uniforms so
  // breathing/drop animations on the strength uniform affect both.
  const haloMesh = _buildHaloMesh(radius, uniforms.uColorA, uniforms.uStrength);
  mesh.add(haloMesh);
  const haloMaterial = haloMesh.material;

  // ---- Impact API ----
  let impactIndex = 0;
  const impactSlots = [];
  for (let i = 0; i < IMPACT_COUNT; i++) {
    impactSlots.push({
      x: 0, y: 0, z: 0, w: 0,
      target: 1,
      phase: 'idle',     // 'idle' | 'rampup' | 'rampdown'
      t0: 0,
      uniformVec: impactsArray[i],   // shared reference into the uniform
    });
  }

  function addImpact(worldPos, impactRadius = 1) {
    // Convert world position to mesh-local. The mesh must have
    // up-to-date matrices when this is called — we update them to
    // be safe (cheap).
    mesh.updateMatrixWorld(true);
    const local = mesh.worldToLocal(worldPos.clone ? worldPos.clone() : worldPos);
    const slot = impactSlots[impactIndex];
    slot.x = local.x;
    slot.y = local.y;
    slot.z = local.z;
    slot.target = impactRadius;
    slot.phase = 'rampup';
    slot.t0 = 0;
    impactIndex = (impactIndex + 1) % IMPACT_COUNT;
  }

  const tracker = {
    material,
    haloMaterial,
    haloMesh,
    impactSlots,
  };
  _activeShields.push(tracker);

  return {
    mesh,
    material,
    radius: uniforms.uRadius,         // expose so callers can tweak (we don't, but symmetry with old API)
    strength: uniforms.uStrength,     // exposed for breathing pulse / drop animation
    colorA: uniforms.uColorA,
    colorB: uniforms.uColorB,
    impacts: { add: addImpact, slots: impactSlots },
    _tracker: tracker,
  };
}

// ---- Per-frame tick ----
//
// elapsed: total elapsed seconds since game start (from a clock or
//          performance.now() / 1000). Drives the hex pulse animation
//          and line scroll uniformly across all shields.
// dt: seconds since last frame. Drives impact radius ramping.
//
// This is the SOLE per-frame cost of the shield system: walk the
// active shields list, set time uniform on each, advance any active
// impact ramps. Cheap — a few uniform writes per shield per frame.

export function updateShieldsTick(elapsed, dt) {
  for (const sh of _activeShields) {
    // Bump time uniform — drives hex pulse + line scroll.
    sh.material.uniforms.uTime.value = elapsed;
    // Halo also has a uTime uniform (drives breathing pulse on the
    // rim). Same elapsed value keeps them in phase.
    if (sh.haloMaterial) {
      sh.haloMaterial.uniforms.uTime.value = elapsed;
    }

    // Advance any active impact ramps.
    for (const imp of sh.impactSlots) {
      if (imp.phase === 'rampup') {
        imp.t0 += dt;
        const u = Math.min(1, imp.t0 / 0.10);
        // Ease-out (power2.out): 1 - (1-u)^2
        const e = 1 - (1 - u) * (1 - u);
        imp.uniformVec.w = imp.target * e;
        if (u >= 1) {
          imp.phase = 'rampdown';
          imp.t0 = 0;
        }
      } else if (imp.phase === 'rampdown') {
        imp.t0 += dt;
        const u = Math.min(1, imp.t0 / 1.0);
        // Ease-in (power2.in): u^2
        const e = u * u;
        imp.uniformVec.w = imp.target * (1 - e);
        if (u >= 1) {
          imp.phase = 'idle';
          imp.uniformVec.w = 0;
        }
      }
      // Position is set in addImpact and doesn't change during the
      // ramp, so we don't need to write x/y/z here every frame —
      // they were copied into uniformVec at addImpact time. Wait —
      // actually we DON'T copy x/y/z to uniformVec in addImpact;
      // we only set them on the slot. Sync them now so the shader
      // sees the impact position.
      imp.uniformVec.x = imp.x;
      imp.uniformVec.y = imp.y;
      imp.uniformVec.z = imp.z;
    }
  }
}

// ---- Disposal ----

export function disposeShield(handle) {
  if (!handle) return;
  const tracker = handle._tracker;
  if (tracker) {
    const idx = _activeShields.indexOf(tracker);
    if (idx >= 0) _activeShields.splice(idx, 1);
    // Halo material + geometry — allocated per-shield in _buildHaloMesh
    // so they need to be disposed alongside the main shield.
    if (tracker.haloMesh) {
      if (tracker.haloMesh.geometry) tracker.haloMesh.geometry.dispose();
    }
    if (tracker.haloMaterial) tracker.haloMaterial.dispose();
  }
  if (handle.mesh) {
    if (handle.mesh.parent) handle.mesh.parent.remove(handle.mesh);
    if (handle.mesh.geometry) handle.mesh.geometry.dispose();
  }
  if (handle.material) handle.material.dispose();
}
