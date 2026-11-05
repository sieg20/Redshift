// Space-bending shared by every world shader (and mirrored in JS for things
// we place by hand: the craft, its afterimages, the camera).
//
// The flat world: track along -z, player near the origin, x = sideways, y = up.
// At high speed the floor curls up into a tube (curl), the tube twists along its
// length (twist), snakes (bend/sway), and ripples in time with the music.

import * as THREE from 'three';

export const U = {
  // warp
  uInvR: { value: 1 / 400 },
  uTwist: { value: 0 },
  uBend: { value: 0 },
  uSway: { value: 0 },
  uRipple: { value: 0 },
  // environment / music
  uTime: { value: 0 },
  uBeat: { value: 0 },
  uPulse: { value: 0 },
  uBeatGlow: { value: 1 }, // FLASHES setting: scales beat-locked light (floor wave, pylon chase)
  uBass: { value: 0 },
  uScroll: { value: 0 },
  uSpeedN: { value: 0 },
  uMirage: { value: 0 },
  uSonic: { value: 0 },
  uSpace: { value: 0 },
  uSing: { value: 0 },
  uFogColor: { value: new THREE.Color('#ff7a59') },
  uFogFar: { value: 900 },
  uCamPos: { value: new THREE.Vector3() },
  // a drop's shockwave rolling down the track: front distance ahead of the craft, strength
  uDropWave: { value: 0 },
  uDropWaveAmp: { value: 0 },
  // the sky breaking on a drop: sun-burst ring (angle from the sun, strength) and the crack
  uSkyRing: { value: 0 },
  uSkyRingAmp: { value: 0 },
  uSkyCrack: { value: 0 },
};

export const warpGLSL = /* glsl */ `
uniform float uInvR, uTwist, uBend, uSway, uRipple, uTime, uBeat, uPulse, uBeatGlow, uBass, uScroll, uSpeedN, uMirage, uSonic, uSpace, uSing, uFogFar, uDropWave, uDropWaveAmp, uSkyRing, uSkyRingAmp, uSkyCrack;
uniform vec3 uFogColor, uCamPos;

vec3 warpPos(vec3 p, out float roll) {
  float R = 1.0 / uInvR;
  float a = p.x * uInvR;
  float r = R - p.y;
  vec3 q = vec3(sin(a) * r, R - cos(a) * r, p.z);
  float d = max(-p.z, 0.0);
  float tw = uTwist * d;
  float cs = cos(tw), sn = sin(tw);
  vec2 rel = vec2(q.x, q.y - R);
  rel = vec2(rel.x * cs - rel.y * sn, rel.x * sn + rel.y * cs);
  q.xy = vec2(rel.x, rel.y + R);
  q.y += uBend * d * d * 0.0004;
  q.x += uSway * d * d * 0.0004;
  q.y += uRipple * sin(d * 0.12 - uTime * 14.0) * smoothstep(0.0, 30.0, d);
  roll = a + tw;
  return q;
}

// The drop shockwave at a point "ahead" units in front of the craft: a bright front plus a
// fading wake behind it. Inside the wormhole the tube wraps round the camera, so only the
// front shows there.
float dropWave(float ahead) {
  if (uDropWaveAmp < 0.001) return 0.0;
  float front = exp(-abs(ahead - uDropWave) * 0.06);
  float wake = step(ahead, uDropWave) * exp(-(uDropWave - ahead) * 0.012) * 0.3 * (1.0 - uSpace);
  return (front + wake) * uDropWaveAmp;
}

vec3 fogIt(vec3 col, float dist) {
  float f = smoothstep(uFogFar * 0.25, uFogFar, dist);
  return mix(col, uFogColor, f);
}
`;

// Standard vertex shader for warped meshes (instanced or not).
export const warpVertex = /* glsl */ `
${warpGLSL}
varying vec3 vFlat;
varying vec3 vLocal;
varying vec3 vN;
varying vec3 vView;
varying float vDist;
varying vec2 vUv;
void main() {
  vec4 lp = vec4(position, 1.0);
  vec3 n = normal;
  #ifdef USE_INSTANCING
    lp = instanceMatrix * lp;
    n = mat3(instanceMatrix) * n;
  #endif
  vec4 wp = modelMatrix * lp;
  n = mat3(modelMatrix) * n;
  float roll;
  vec3 q = warpPos(wp.xyz, roll);
  float c = cos(roll), s = sin(roll);
  n = vec3(n.x * c - n.y * s, n.x * s + n.y * c, n.z);
  vFlat = wp.xyz;
  vLocal = position;
  vUv = uv;
  vN = normalize(n);
  vView = normalize(uCamPos - q);
  vec4 mv = viewMatrix * vec4(q, 1.0);
  vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

// JS mirror of warpPos (only the parts that matter near the player).
export function warpPoint(x, y, z, out) {
  const invR = U.uInvR.value;
  const R = 1 / invR;
  const a = x * invR;
  const r = R - y;
  let qx = Math.sin(a) * r;
  let qy = R - Math.cos(a) * r;
  const d = Math.max(-z, 0);
  const tw = U.uTwist.value * d;
  const cs = Math.cos(tw), sn = Math.sin(tw);
  const rx = qx, ry = qy - R;
  qx = rx * cs - ry * sn;
  qy = rx * sn + ry * cs + R;
  qy += U.uBend.value * d * d * 0.0004;
  qx += U.uSway.value * d * d * 0.0004;
  out.set(qx, qy, z);
  out.roll = a + tw;
  return out;
}

export function makeWarpMaterial(fragmentShader, extra = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { ...U, ...(extra.uniforms || {}) },
    vertexShader: warpVertex,
    fragmentShader: `${warpGLSL}\n${fragmentShader}`,
    transparent: !!extra.transparent,
    depthWrite: extra.depthWrite ?? true,
    blending: extra.blending ?? THREE.NormalBlending,
    side: extra.side ?? THREE.FrontSide,
  });
}
