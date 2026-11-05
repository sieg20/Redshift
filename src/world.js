// The environment: dusk sky that decays into deep space, the salt-flat highway,
// chase-lit pylons, mirage towers that dissolve as you approach, and speed lines.

import * as THREE from 'three';
import { U, warpGLSL, makeWarpMaterial } from './warp.js';

const NOISE = /* glsl */ `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float hash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float noise3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash3(i), hash3(i + vec3(1,0,0)), f.x), mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x), mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y),
    f.z);
}
`;

export class World {
  constructor(scene) {
    this.scene = scene;
    this.skyTop = { value: new THREE.Color('#2a1150') };
    this.skyHor = { value: new THREE.Color('#ff7a59') };
    this._sky();
    this._floor();
    this._pylons();
    this._phantoms();
    this._lines();
    this._dust();
  }

  // ---------------------------------------------------------------- sky
  _sky() {
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...U, uSkyTop: this.skyTop, uSkyHor: this.skyHor },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = position;
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }`,
      fragmentShader: /* glsl */ `
        ${warpGLSL}
        ${NOISE}
        uniform vec3 uSkyTop, uSkyHor;
        varying vec3 vDir;

        // jagged height offset of a crack along the sky, by azimuth
        float crackY(float x, float seed) {
          return 0.14 * (noise(vec2(x * 2.5, seed)) - 0.5) + 0.06 * (noise(vec2(x * 9.0, seed + 3.0)) - 0.5)
               + 0.024 * (noise(vec2(x * 31.0, seed + 7.0)) - 0.5);
        }
        // white-hot core and glow of a crack: dy = distance from its line, w = its width
        vec2 crackLight(float dy, float w) {
          float core = w > 0.0002 ? smoothstep(w, w * 0.2, dy) : 0.0;
          return vec2(core, exp(-dy / (0.004 + w * 3.0)));
        }

        void main() {
          vec3 d = normalize(vDir);
          float az = atan(d.x, -d.z);
          float h = d.y;
          // heat shimmer on the horizon line
          h += uMirage * 0.006 * sin(az * 70.0 + uTime * 8.0) * exp(-abs(h) * 30.0);

          vec3 col = mix(uSkyHor, uSkyTop, pow(smoothstep(-0.01, 0.55, h), 0.55));

          // sun
          vec3 sd = normalize(vec3(0.0, 0.075, -1.0));
          float sdot = max(dot(d, sd), 0.0);
          float disc = smoothstep(0.9968, 0.9976, sdot);
          col += vec3(1.0, 0.75, 0.45) * (pow(sdot, 90.0) * 0.7 + pow(sdot, 10.0) * 0.18) * (1.0 + uPulse * 0.3);
          col = mix(col, vec3(1.6, 1.15, 0.8) * (1.0 + uSonic * 0.6), disc);

          // mountains + a floating mirage copy of them above
          float m = 0.004 + 0.03 * (noise(vec2(az * 3.0, 0.0)) * 0.6 + noise(vec2(az * 9.0, 3.0)) * 0.3 + noise(vec2(az * 27.0, 7.0)) * 0.1);
          vec3 mountain = mix(vec3(0.09, 0.03, 0.12), uSkyHor * 0.35, 0.35);
          float above = h - (m + 0.006);
          float ghost = step(0.0, above) * step(above, m * 0.8) * uMirage * (0.35 + 0.25 * sin(az * 40.0 + uTime * 5.0));
          col = mix(col, mountain * 1.6 + uSkyHor * 0.3, ghost);
          float rim = smoothstep(m - 0.003, m, h) * (1.0 - smoothstep(m, m + 0.0015, h));
          if (h < m) col = mountain + uSkyHor * rim * 0.8;
          if (h < 0.0) col = mix(uSkyHor * 0.9, mountain, 0.3);

          // dusk stars
          vec3 cell = floor(d * 260.0);
          float st = step(0.9975, hash3(cell)) * smoothstep(0.15, 0.7, h);
          col += vec3(st) * 0.7;

          // ---- deep space ----
          vec3 space = vec3(0.004, 0.003, 0.016);
          float neb = noise3(d * 3.0 + uTime * 0.02) * 0.6 + noise3(d * 7.0) * 0.3 + noise3(d * 17.0) * 0.1;
          neb = pow(smoothstep(0.35, 0.95, neb), 1.6);
          space += mix(vec3(0.25, 0.05, 0.4), vec3(0.05, 0.25, 0.5), noise3(d * 2.0 + 4.0)) * neb * 0.9;
          vec3 c2 = floor(d * 420.0);
          float s2 = step(0.992, hash3(c2));
          vec3 doppler = mix(vec3(1.0, 0.35, 0.25), vec3(0.45, 0.7, 1.4), smoothstep(-0.6, 0.6, -d.z));
          space += s2 * doppler * (0.6 + 0.8 * hash3(c2 + 3.0)) * (1.0 + uPulse);
          // accretion glow straight ahead in singularity
          float ah = max(dot(d, vec3(0.0, 0.0, -1.0)), 0.0);
          space += vec3(1.0, 0.45, 0.85) * pow(ah, 40.0) * uSing * 1.5;

          col = mix(col, space, uSpace);

          // ---- a drop breaks the sky: the sun bursts into an expanding ring and a crack of
          // light tears across the sky ahead, healing as the surge fades
          if (uSkyRingAmp > 0.001) {
            float sa = acos(clamp(dot(d, sd), -1.0, 1.0));
            float rw = 0.02 + uSkyRing * 0.04;
            float e1 = (sa - uSkyRing) / rw, e2 = (sa - uSkyRing * 0.8) / (rw * 0.6);
            col += vec3(1.9, 1.35, 0.7) * exp(-e1 * e1) * uSkyRingAmp * 2.2;
            col += vec3(0.5, 0.8, 1.7) * exp(-e2 * e2) * uSkyRingAmp;
            col += vec3(2.0, 1.6, 1.1) * pow(sdot, 200.0) * uSkyRingAmp * 3.0;
          }
          if (uSkyCrack > 0.001) {
            float c = uSkyCrack;
            float flick = 0.85 + 0.15 * sin(uTime * 31.0 + az * 17.0);
            // main tear, growing out from straight ahead to both sides
            float along = smoothstep(c * 1.9, c * 1.9 - 0.3, abs(az));
            vec2 m = crackLight(abs(h - (0.3 + crackY(az, 1.7))), c * 0.011 * along * (1.0 - abs(az) / 2.3)) * along;
            // two branches splitting off it
            float b1 = smoothstep(0.25, 0.3, az) * smoothstep(0.25 + c * 0.7, 0.2 + c * 0.7, az);
            vec2 m1 = crackLight(abs(h - (0.3 + crackY(0.25, 1.7) + (az - 0.25) * 0.45 + crackY(az, 11.0) * 0.5)), c * 0.006 * b1) * b1;
            float b2 = smoothstep(-0.2, -0.25, az) * smoothstep(-0.2 - c * 0.6, -0.15 - c * 0.6, az);
            vec2 m2 = crackLight(abs(h - (0.3 + crackY(-0.2, 1.7) + (az + 0.2) * 0.35 + crackY(az, 23.0) * 0.5)), c * 0.005 * b2) * b2;
            float core = max(m.x, max(m1.x, m2.x));
            float glow = (m.y + 0.6 * m1.y + 0.6 * m2.y) * c;
            col += vec3(0.8, 0.55, 1.6) * glow * 0.7;
            col = mix(col, vec3(2.2, 2.0, 2.7) * flick, core);
          }
          gl_FragColor = vec4(col, 1.0);
        }`,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(100, 48, 24), mat);
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
  }

  // -------------------------------------------------------------- floor
  _floor() {
    const geo = new THREE.PlaneGeometry(120, 1100, 160, 320);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0, -1100 / 2 + 40);
    const mat = makeWarpMaterial(
      /* glsl */ `
      ${NOISE}
      varying vec3 vFlat; varying vec3 vN; varying vec3 vView; varying float vDist;
      uniform vec3 uSkyTop;
      void main() {
        float x = vFlat.x;
        float ax = abs(x);
        if (ax * uInvR > 3.1) discard;
        float zz = vFlat.z - uScroll;
        float ahead = -vFlat.z;
        float dist = vDist;

        // salt flat with polygon cracks
        vec2 sp = vec2(x, zz) * 0.08;
        vec2 wob = sp + vec2(noise(sp * 0.7), noise(sp * 0.7 + 9.0)) * 0.7;
        vec2 g = abs(fract(wob) - 0.5);
        float crack = smoothstep(0.035, 0.0, min(g.x, g.y));
        vec3 salt = mix(vec3(0.5, 0.36, 0.52), vec3(0.75, 0.52, 0.55), noise(sp * 0.25));
        salt *= (1.0 - crack * 0.5) * 0.3;
        salt += uFogColor * 0.05;

        // track
        float onTrack = 1.0 - smoothstep(9.9, 10.3, ax);
        vec3 asphalt = vec3(0.02, 0.016, 0.045);
        float fres = pow(1.0 - max(dot(vN, vView), 0.0), 3.0);
        asphalt += uFogColor * fres * 0.35;

        float laneD = min(abs(ax - 1.875), abs(ax - 5.625));
        float dash = mix(step(fract(zz / 7.0), 0.55), 0.8, uSpeedN);
        float lane = smoothstep(0.13, 0.0, laneD) * dash;
        float edge = smoothstep(0.4, 0.0, abs(ax - 10.0));
        float fz = fract(zz / 14.0);
        float cross = smoothstep(0.12, 0.0, min(fz, 1.0 - fz) * 14.0) * 0.35;

        float ph = fract(uBeat);
        // starts a little ahead of the craft and fades in, so the beat never lights up the
        // whole bottom of the screen in one frame
        float wave = exp(-abs(ahead - 18.0 - ph * 240.0) * 0.18) * (1.0 - ph) * smoothstep(0.0, 0.08, ph)
                   * (1.0 + 0.5 * step(fract(uBeat / 4.0), 0.25)) * uBeatGlow;

        vec3 laneCol = mix(vec3(0.25, 0.95, 1.0), vec3(0.75, 0.85, 1.4), uSpace);
        vec3 edgeCol = mix(vec3(1.0, 0.22, 0.86), vec3(0.6, 0.4, 1.4), uSpace);
        vec3 trackCol = asphalt + laneCol * lane * (1.6 - uSpeedN * 0.8) + edgeCol * edge * (2.2 + uPulse * 2.5)
                      + vec3(0.45, 0.2, 0.9) * cross + vec3(0.7, 0.95, 1.3) * wave * 1.6;

        vec3 col = mix(salt, trackCol, onTrack);
        col += edgeCol * edge * 0.6 * (1.0 - onTrack);

        // mirage: sky pooled on the road ahead + glassy band at the horizon
        float shimmer = 0.85 + 0.15 * sin(uTime * 9.0 + x * 0.5 + zz * 0.21);
        float pud = smoothstep(0.58, 0.72, noise(vec2(x * 0.07, zz * 0.011)));
        float mir = uMirage * (pud * smoothstep(35.0, 140.0, dist) * 0.9 + smoothstep(220.0, 650.0, dist) * 0.9);
        vec3 refl = mix(uFogColor * 0.85, uSkyTop, 0.3 * smoothstep(0.0, 400.0, dist)) * shimmer;
        refl += vec3(1.0, 0.8, 0.5) * exp(-ax * 0.06) * smoothstep(300.0, 800.0, dist) * 0.5;
        col = mix(col, refl, clamp(mir, 0.0, 0.8) * (1.0 - uSpace));

        // space: off-track ground becomes a see-through lattice. Motion reads from
        // discrete marks rushing past, so the rails are dashed and bright ribs ring
        // the whole tube every 32 units (several flash by per second at warp).
        float lgx = abs(fract(x / 6.0) - 0.5) * 6.0;
        float rail = smoothstep(0.12, 0.0, lgx) * step(0.45, fract(zz / 9.0));
        float ribPos = fract(zz / 32.0);
        float rib = smoothstep(0.3, 0.0, min(ribPos, 1.0 - ribPos) * 32.0);
        float ribId = floor(zz / 32.0 + 0.5);
        vec3 ribCol = mix(vec3(0.3, 1.1, 1.6), vec3(1.6, 0.35, 1.3), mod(ribId, 2.0)) * (1.1 + uPulse * 1.5);
        float lattice = rail + rib;
        vec3 latCol = vec3(0.35, 0.3, 1.0) * rail * (1.2 + uPulse * 2.0) + ribCol * rib + vec3(0.6, 0.8, 1.2) * wave;
        float alpha = 1.0;
        if (uSpace > 0.0) {
          col = mix(col, mix(latCol, trackCol * vec3(0.6, 0.8, 1.2) + ribCol * rib * 0.6, onTrack), uSpace);
          alpha = mix(1.0, mix(0.08 + min(lattice, 1.0) * 0.92 + wave * 0.5, 0.9, onTrack), uSpace);
        }

        // drop shockwave: a gold front racing away down the track
        float dw = dropWave(ahead);
        col += vec3(2.2, 1.5, 0.55) * dw * (1.0 + onTrack * 1.5) * (1.0 - 0.6 * uSpace);
        alpha = max(alpha, min(1.0, dw) * (1.0 - 0.7 * uSpace));

        col = fogIt(col, dist);
        alpha *= 1.0 - smoothstep(uFogFar * 0.85, uFogFar * 1.05, dist) * uSpace;
        gl_FragColor = vec4(col, alpha);
      }`,
      { uniforms: { uSkyTop: this.skyTop }, transparent: true, side: THREE.DoubleSide }
    );
    this.floor = new THREE.Mesh(geo, mat);
    this.floor.frustumCulled = false;
    this.floor.renderOrder = -5;
    this.scene.add(this.floor);
  }

  // ------------------------------------------------------------- pylons
  _pylons() {
    this.pylonSpacing = 24;
    this.pylonCount = 44;
    const geo = new THREE.BoxGeometry(0.9, 14, 0.9);
    geo.translate(0, 7, 0);
    const mat = makeWarpMaterial(/* glsl */ `
      varying vec3 vFlat; varying vec3 vLocal; varying vec3 vN; varying vec3 vView; varying float vDist;
      void main() {
        float zz = vFlat.z - uScroll;
        float id = floor(zz / 24.0 + 0.5);
        float chase = exp(-6.0 * fract(uBeat * 0.5 - id * 0.125)) * uBeatGlow;
        float seg = step(0.75, fract(vLocal.y * 0.6));
        float top = smoothstep(12.8, 13.2, vLocal.y);
        float rim = pow(1.0 - max(dot(vN, vView), 0.0), 2.0);
        vec3 glow = mix(vec3(0.2, 0.9, 1.0), vec3(1.0, 0.25, 0.85), step(0.0, vFlat.x));
        vec3 col = vec3(0.03, 0.02, 0.06) + uFogColor * rim * 0.25;
        col += glow * (seg * (0.15 + chase * 2.5) + top * (1.5 + chase * 3.0 + uPulse * 2.0));
        // pylons flare gold one after another as the drop shockwave reaches them
        col += vec3(2.4, 1.6, 0.6) * dropWave(-vFlat.z) * (0.6 + seg * 2.0 + top * 3.0);
        gl_FragColor = vec4(fogIt(col, vDist), 1.0);
      }`);
    this.pylons = new THREE.InstancedMesh(geo, mat, this.pylonCount * 2);
    this.pylons.frustumCulled = false;
    this.scene.add(this.pylons);
    this._m = new THREE.Matrix4();
  }

  // ------------------------------------------------- mirage phantom towers
  _phantoms() {
    this.phCount = 26;
    this.phLen = 1300;
    const geo = new THREE.CylinderGeometry(1, 1.6, 1, 6, 1);
    geo.translate(0, 0.5, 0);
    const mat = makeWarpMaterial(
      /* glsl */ `
      varying vec3 vFlat; varying vec3 vLocal; varying vec3 vN; varying vec3 vView; varying float vDist;
      void main() {
        float a = uMirage * (1.0 - uSpace) * smoothstep(140.0, 480.0, vDist) * (1.0 - smoothstep(900.0, 1050.0, vDist));
        float sh = 0.7 + 0.3 * sin(uTime * 11.0 + vLocal.y * 9.0 + vFlat.x);
        vec3 col = mix(uFogColor * 1.4, vec3(1.2, 0.95, 0.8), vLocal.y) * sh;
        gl_FragColor = vec4(col, a * 0.55 * (1.0 - vLocal.y * 0.6));
      }`,
      { transparent: true, depthWrite: false }
    );
    this.phantoms = new THREE.InstancedMesh(geo, mat, this.phCount);
    this.phantoms.frustumCulled = false;
    this.phData = [];
    for (let i = 0; i < this.phCount; i++) {
      const side = i % 2 ? 1 : -1;
      this.phData.push({
        x: side * (45 + Math.random() * 120),
        z0: Math.random() * this.phLen,
        w: 4 + Math.random() * 10,
        h: 25 + Math.random() * 70,
      });
    }
    this.scene.add(this.phantoms);
  }

  // -------------------------------------------------------- speed lines
  _lines() {
    const N = 520;
    const base = new THREE.PlaneGeometry(1, 1);
    base.translate(0, 0.5, 0);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.attributes.position = base.attributes.position;
    geo.instanceCount = N;
    const off = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) {
      const ang = Math.random() * Math.PI * 2;
      const rad = 4 + Math.pow(Math.random(), 0.7) * 40;
      off[i * 4] = Math.cos(ang) * rad;
      off[i * 4 + 1] = 2 + Math.sin(ang) * rad * 0.7;
      off[i * 4 + 2] = Math.random() * 700;
      off[i * 4 + 3] = Math.random();
    }
    geo.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 4));
    this.lineLen = { value: 2 };
    this.lineScroll = { value: 0 };
    this.lineAlpha = { value: 0 };
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...U, uLen: this.lineLen, uAlpha: this.lineAlpha, uLineScroll: this.lineScroll },
      vertexShader: /* glsl */ `
        ${warpGLSL}
        uniform float uLen, uLineScroll;
        attribute vec4 aOff;
        varying float vA; varying float vT; varying vec3 vC;
        void main() {
          float z = mod(aOff.z + uLineScroll * (1.0 + aOff.w * 0.8), 700.0) - 640.0;
          // in the wormhole the streaks hug the tube walls instead of crossing its middle
          vec2 wall = vec2(aOff.x * 0.65, 0.3 + fract(aOff.w * 7.13) * 5.0);
          vec3 b = vec3(mix(aOff.xy, wall, uSpace), z);
          float len = uLen * (0.6 + aOff.w * 0.8);
          vec3 p = b + vec3(0.0, 0.0, -position.y * len);
          vec3 toCam = normalize(uCamPos - b);
          vec3 side = normalize(cross(vec3(0.0, 0.0, 1.0), toCam));
          p += side * position.x * (0.04 + 0.07 * aOff.w + uSpace * 0.03);
          float roll;
          vec3 q = warpPos(p, roll);
          vA = smoothstep(-640.0, -350.0, z) * (1.0 - smoothstep(0.0, 30.0, z));
          vT = position.y;
          vC = mix(vec3(0.6, 0.95, 1.0), vec3(1.0, 0.6, 0.9), aOff.w);
          vC = mix(vC, mix(vec3(1.0, 0.35, 0.3), vec3(0.4, 0.65, 1.5), position.y), uSpace);
          gl_Position = projectionMatrix * viewMatrix * vec4(q, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uAlpha;
        varying float vA; varying float vT; varying vec3 vC;
        void main() {
          float a = vA * uAlpha * sin(vT * 3.14159);
          gl_FragColor = vec4(vC * a, a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.lines = new THREE.Mesh(geo, mat);
    this.lines.frustumCulled = false;
    this.scene.add(this.lines);
  }

  // ---------------------------------------- dust / plasma kicked up behind the craft
  _dust() {
    const N = (this.dustN = 600);
    const geo = new THREE.BufferGeometry();
    this.dPos = new Float32Array(N * 3);
    this.dVel = new Float32Array(N * 3);
    this.dLife = new Float32Array(N);
    this.dCol = new Float32Array(N * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this.dPos, 3));
    geo.setAttribute('aLife', new THREE.BufferAttribute(this.dLife, 1));
    geo.setAttribute('aCol', new THREE.BufferAttribute(this.dCol, 3));
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...U },
      vertexShader: /* glsl */ `
        ${warpGLSL}
        attribute float aLife; attribute vec3 aCol;
        varying float vL; varying vec3 vC;
        void main() {
          float roll;
          vec3 q = warpPos(position, roll);
          vec4 mv = viewMatrix * vec4(q, 1.0);
          vL = aLife; vC = aCol;
          gl_PointSize = (40.0 + 60.0 * (1.0 - aLife)) / max(1.0, -mv.z) * step(0.001, aLife);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying float vL; varying vec3 vC;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d) * vL;
          gl_FragColor = vec4(vC * a, a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.dust = new THREE.Points(geo, mat);
    this.dust.frustumCulled = false;
    this.scene.add(this.dust);
    this.dIdx = 0;
    this.dAcc = 0;
  }

  emitDust(x, y, z, rate, dt, color, spread) {
    this.dAcc += rate * dt;
    while (this.dAcc >= 1) {
      this.dAcc--;
      const i = this.dIdx;
      this.dIdx = (this.dIdx + 1) % this.dustN;
      this.dPos[i * 3] = x + (Math.random() - 0.5) * 1.6;
      this.dPos[i * 3 + 1] = y;
      this.dPos[i * 3 + 2] = z + Math.random();
      this.dVel[i * 3] = (Math.random() - 0.5) * spread * 2;
      this.dVel[i * 3 + 1] = Math.random() * spread;
      this.dVel[i * 3 + 2] = 4 + Math.random() * 8;
      this.dLife[i] = 1;
      this.dCol[i * 3] = color.r;
      this.dCol[i * 3 + 1] = color.g;
      this.dCol[i * 3 + 2] = color.b;
    }
  }

  // ---------------------------------------------------------- per frame
  update(dt, worldSpd, fx) {
    const scroll = U.uScroll.value;

    // pylons
    const total = this.pylonSpacing * this.pylonCount;
    const pyScale = 1 - fx.space * 0.8;
    for (let i = 0; i < this.pylonCount; i++) {
      const z = ((i * this.pylonSpacing + scroll) % total) - total + 40;
      for (let s = 0; s < 2; s++) {
        this._m.makeScale(1, pyScale, 1).setPosition(s ? 13.5 : -13.5, 0, z);
        this.pylons.setMatrixAt(i * 2 + s, this._m);
      }
    }
    this.pylons.instanceMatrix.needsUpdate = true;
    this.pylons.visible = pyScale > 0.05;

    // phantoms
    this.phantoms.visible = fx.mirage > 0.01 && fx.space < 0.99;
    if (this.phantoms.visible) {
      for (let i = 0; i < this.phCount; i++) {
        const p = this.phData[i];
        const z = ((p.z0 + scroll * 0.9) % this.phLen) - this.phLen + 60;
        this._m.makeScale(p.w, p.h, p.w).setPosition(p.x, -0.5, z);
        this.phantoms.setMatrixAt(i, this._m);
      }
      this.phantoms.instanceMatrix.needsUpdate = true;
    }

    // speed lines
    // Long streaks read as static lines, so in warp they get shorter and much faster:
    // particles of space whipping past rather than painted stripes.
    this.lineScroll.value += worldSpd * dt * (1.2 + fx.space * 2.2);
    this.lineLen.value = 1.5 + fx.blur * 32 - fx.space * 10;
    this.lineAlpha.value = Math.min(1, fx.blur * 1.3) * (0.5 + fx.blur * 0.5) * (1 - fx.space * 0.2);
    this.lines.visible = this.lineAlpha.value > 0.01;

    // dust particles drift back with the world
    for (let i = 0; i < this.dustN; i++) {
      if (this.dLife[i] <= 0) continue;
      this.dLife[i] -= dt * 1.6;
      if (this.dLife[i] < 0) this.dLife[i] = 0;
      this.dVel[i * 3 + 1] -= 6 * dt;
      this.dPos[i * 3] += this.dVel[i * 3] * dt;
      this.dPos[i * 3 + 1] = Math.max(0.05, this.dPos[i * 3 + 1] + this.dVel[i * 3 + 1] * dt);
      this.dPos[i * 3 + 2] += (this.dVel[i * 3 + 2] + worldSpd * 0.35) * dt;
    }
    const g = this.dust.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aLife.needsUpdate = true;
    g.attributes.aCol.needsUpdate = true;
  }

  followCamera(camera) {
    this.sky.position.copy(camera.position);
  }
}
