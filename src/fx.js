// Post-processing: bloom, then one "speed" pass that does, in order,
// glitch -> spacetime swirl + gravitational lens -> shockwave -> heat haze ->
// radial motion blur with chromatic split -> feedback echo -> doppler tint ->
// event horizon -> vignette / flash / grain.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { CopyShader } from 'three/addons/shaders/CopyShader.js';

const SPEED_FRAG = /* glsl */ `
uniform sampler2D tDiffuse, tPrev;
uniform vec2 uRes, uFocus, uShockC;
uniform float uTime, uBlur, uMirage, uChroma, uWarp, uLens, uEcho, uPulse, uGlitch, uFlash, uShockR, uShockAmp, uVig, uSing, uWaveR, uWaveAmp, uWaveGlow, uSat, uPinch, uTaps;
varying vec2 vUv;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

void main() {
  vec2 uv = vUv;
  vec2 asp = vec2(uRes.x / uRes.y, 1.0);

  // crash glitch: torn horizontal slices
  if (uGlitch > 0.001) {
    float row = floor(uv.y * 26.0);
    float g = step(1.0 - uGlitch * 0.7, hash(vec2(row, floor(uTime * 30.0))));
    uv.x += (hash(vec2(row, floor(uTime * 60.0))) - 0.5) * 0.14 * g * uGlitch;
  }

  // beat punch-in
  uv = uFocus + (uv - uFocus) * (1.0 - uPulse * 0.014);

  // drop pull-in: the hang drags the picture towards the centre, the impact bulges it outward
  vec2 pv = (uv - uFocus) * asp;
  uv = uFocus + (uv - uFocus) * (1.0 + uPinch * (0.6 + dot(pv, pv) * 0.9));

  vec2 v = (uv - uFocus) * asp;
  float r0 = length(v);
  vec2 dir = v / max(r0, 1e-4);

  // spacetime swirl around the vanishing point
  float sw = uWarp * 0.35 * exp(-r0 * 2.5) * sin(uTime * 0.6) + uSing * 0.9 * exp(-r0 * 3.5);
  float cs = cos(sw), sn = sin(sw);
  v = vec2(v.x * cs - v.y * sn, v.x * sn + v.y * cs);

  // gravitational lensing: beta = theta - thetaE^2 / theta
  v -= dir * (uLens * uLens) / max(r0, 0.015);

  // time ripples
  v += dir * sin(r0 * 38.0 - uTime * 18.0) * 0.0035 * uWarp;

  // shockwave ring from the craft
  vec2 sv = (uv - uShockC) * asp;
  float sr = length(sv);
  float sd = sr - uShockR;
  vec2 shockOff = (sv / max(sr, 1e-4)) * uShockAmp * exp(-sd * sd * 300.0) * 0.05;
  v -= shockOff;

  // warp wave: on every beat a ring of compressed space bursts out of the
  // vanishing point and sweeps past the camera
  float wd = r0 - uWaveR;
  float wave = exp(-wd * wd * 500.0) * uWaveAmp;
  v += dir * wave * 0.025;

  vec2 suv = uFocus + v / asp;

  // heat haze: strongest on the horizon and the ground right in front
  float hy = (uv.y - uFocus.y) * 7.0;
  float band = exp(-hy * hy) + smoothstep(0.45, 0.0, uv.y) * 0.7;
  float n1 = noise(vec2(uv.x * 28.0, uv.y * 10.0 - uTime * 3.2));
  float n2 = noise(vec2(uv.x * 60.0 + 3.0, uv.y * 25.0 - uTime * 5.0));
  suv += vec2(n1 - 0.5, (n2 - 0.5) * 0.6) * 0.012 * uMirage * band;

  // radial motion blur + chromatic split
  vec2 rel = suv - uFocus;
  // the craft stays crisp while the world smears past it
  float craftMask = smoothstep(0.07, 0.3, length((vUv - uShockC) * asp));
  float amt = uBlur * 0.11 * smoothstep(0.03, 0.5, r0) * mix(0.15, 1.0, craftMask);
  vec2 ca = rel * uChroma * 0.025;
  vec3 col = vec3(0.0);
  float wsum = 0.0;
  for (int i = 0; i < 16; i++) {
    if (float(i) >= uTaps) break; // fewer samples at low quality
    float t = float(i) / (uTaps - 1.0);
    vec2 p = uFocus + rel * (1.0 - amt * t);
    float w = 1.0 - t * 0.55;
    col.r += texture2D(tDiffuse, p + ca * (1.0 + t)).r * w;
    col.g += texture2D(tDiffuse, p).g * w;
    col.b += texture2D(tDiffuse, p - ca * (1.0 + t)).b * w;
    wsum += w;
  }
  col /= wsum;

  col += vec3(0.45, 0.6, 1.0) * wave * (0.25 + uSing * 0.3) * uWaveGlow;

  // doppler: blue-shift ahead, red-shift at the edges
  vec3 dop = mix(vec3(0.7, 0.9, 1.45), vec3(1.45, 0.75, 0.65), smoothstep(0.0, 0.75, r0));
  col *= mix(vec3(1.0), dop, uWarp * 0.75);

  // event horizon + photon ring in the singularity
  float rh = uSing * 0.025;
  if (rh > 0.0) {
    col *= smoothstep(rh * 0.85, rh * 1.05, r0);
    float pr = (r0 - rh * 1.2) / (rh * 0.18);
    col += vec3(1.4, 0.7, 1.1) * exp(-pr * pr) * uSing * 2.5;
  }

  // feedback echo: last frame, zoomed outward + twisted, keeps the brightest.
  // Must come after every colour multiply so the loop gain stays below 1.
  if (uEcho > 0.001) {
    vec2 pv = vUv - uFocus;
    float ta = uWarp * 0.012 + uSing * 0.03;
    pv = vec2(pv.x * cos(ta) - pv.y * sin(ta), pv.x * sin(ta) + pv.y * cos(ta));
    pv = uFocus + pv * (1.0 - 0.02 * uEcho);
    vec3 prev = min(texture2D(tPrev, pv).rgb, vec3(1.5));
    col = max(col, prev * uEcho * 0.85);
  }

  // colour drains away in a drop's hang
  col = mix(vec3(dot(col, vec3(0.299, 0.587, 0.114))), col, uSat);

  // speed vignette, flash, grain
  col *= 1.0 - uVig * smoothstep(0.35, 1.05, r0);
  col += uFlash * vec3(1.0, 0.95, 1.1);
  col += (hash(vUv * uRes + fract(uTime) * 100.0) - 0.5) * 0.025;

  gl_FragColor = vec4(max(col, 0.0), 1.0);
}`;

class SpeedPass extends Pass {
  constructor(w, h) {
    super();
    this.needsSwap = true;
    const mk = () => new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType });
    this.fb = [mk(), mk()];
    this.cur = 0;
    this.uniforms = {
      tDiffuse: { value: null },
      tPrev: { value: null },
      uRes: { value: new THREE.Vector2(w, h) },
      uFocus: { value: new THREE.Vector2(0.5, 0.55) },
      uShockC: { value: new THREE.Vector2(0.5, 0.3) },
      uTime: { value: 0 },
      uBlur: { value: 0 },
      uMirage: { value: 0 },
      uChroma: { value: 0 },
      uWarp: { value: 0 },
      uLens: { value: 0 },
      uEcho: { value: 0 },
      uPulse: { value: 0 },
      uWaveGlow: { value: 1 },
      uGlitch: { value: 0 },
      uFlash: { value: 0 },
      uShockR: { value: 2 },
      uShockAmp: { value: 0 },
      uVig: { value: 0.3 },
      uSat: { value: 1 },
      uPinch: { value: 0 },
      uTaps: { value: 16 },
      uSing: { value: 0 },
      uWaveR: { value: 2 },
      uWaveAmp: { value: 0 },
    };
    this.quad = new FullScreenQuad(
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: CopyShader.vertexShader,
        fragmentShader: SPEED_FRAG,
      })
    );
    this.copyMat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(CopyShader.uniforms),
      vertexShader: CopyShader.vertexShader,
      fragmentShader: CopyShader.fragmentShader,
    });
    this.copy = new FullScreenQuad(this.copyMat);
  }

  setSize(w, h) {
    this.fb.forEach((r) => r.setSize(w, h));
    this.uniforms.uRes.value.set(w, h);
  }

  render(renderer, writeBuffer, readBuffer) {
    const prev = this.fb[this.cur];
    const next = this.fb[1 - this.cur];
    this.uniforms.tDiffuse.value = readBuffer.texture;
    this.uniforms.tPrev.value = prev.texture;
    renderer.setRenderTarget(next);
    this.quad.render(renderer);
    this.copyMat.uniforms.tDiffuse.value = next.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.copy.render(renderer);
    this.cur = 1 - this.cur;
  }
}

export class FX {
  constructor(renderer, scene, craftScene, camera) {
    this.renderer = renderer;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.composer = new EffectComposer(renderer); // HalfFloat targets, follows renderer pixel ratio
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.6, 0.5, 0.92);
    this.composer.addPass(this.bloom);
    this.speed = new SpeedPass(size.x, size.y);
    this.composer.addPass(this.speed);
    const craftPass = new RenderPass(craftScene, camera);
    craftPass.clear = false;
    craftPass.clearDepth = true;
    this.composer.addPass(craftPass);
    this.composer.addPass(new OutputPass());
    this.u = this.speed.uniforms;
  }

  setSize(w, h) {
    this.composer.setSize(w, h);
  }

  render() {
    this.composer.render();
  }
}
