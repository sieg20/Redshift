// Beat-locked obstacle course. Every object belongs to a beat and is steered so it
// reaches the craft exactly on that beat, whatever speed you're doing.

import * as THREE from 'three';
import { U, makeWarpMaterial } from './warp.js';
import { SURGE_BEATS } from './drop.js';

export const LANES = [-7.5, -3.75, 0, 3.75, 7.5];

// Ring forgiveness: you collect a ring if the craft is within GATE_R of its centre at any
// moment inside +-HIT_WINDOW seconds of the ring's beat (the visual ring is 2.0 wide).
const GATE_R = 2.6;
const HIT_WINDOW = 0.07;

// Build-up before a drop: a straight, wall-free run of rings that speeds up into 8ths,
// ending in a big drop ring on the drop beat. The course stays denser for a while after.
export const BUILD_BEATS = 16;

// accent: 0 ring, 1 accent ring, 2 drop ring (a portal into the wormhole), 3 exit portal
const GATE_SCALE = [1, 1.25, 1.7, 3.6];
const GATE_POINTS = [100, 250, 500, 300];

// Rings and walls are drawn in the overlay pass (after the distortion), so they
// only get a light fog-in at the far end and must clip themselves at the floor.
const GAMEPLAY_FOG = /* glsl */ `
vec3 fadeIn(vec3 col, float dist) {
  return mix(col, uFogColor, smoothstep(uFogFar * 0.55, uFogFar, dist));
}`;

// Cyan on the salt flat, gold in the wormhole so it never blends into the violet tunnel.
const GATE_FRAG = /* glsl */ `
${GAMEPLAY_FOG}
varying vec3 vFlat; varying vec3 vLocal; varying vec3 vN; varying vec3 vView; varying float vDist;
void main() {
  if (vFlat.y < 0.0) discard;
  float near = smoothstep(260.0, 20.0, vDist);
  float ang = atan(vLocal.y, vLocal.x);
  float chase = 0.5 + 0.5 * sin(ang * 6.0 - uTime * 12.0);
  vec3 base = mix(vec3(0.2, 1.3, 1.8), vec3(2.0, 1.45, 0.35), uSpace);
  // keep the gold saturated in the wormhole instead of tone-mapping to white
  vec3 col = base * mix(1.6 + chase * 1.4 + near * 2.0 + uPulse * 2.5, 1.0 + chase * 0.5 + near * 0.6 + uPulse, uSpace);
  gl_FragColor = vec4(fadeIn(col, vDist), 1.0);
}`;

const MEMBRANE_FRAG = /* glsl */ `
uniform float uPortal;
varying vec3 vFlat; varying vec3 vLocal; varying float vDist;
void main() {
  if (vFlat.y < 0.0) discard;
  float r = length(vLocal.xy) / 1.9;
  if (uPortal > 0.5) {
    // a swirling vortex, visible from far off: the way into (or out of) the wormhole
    float ang = atan(vLocal.y, vLocal.x);
    float spiral = 0.5 + 0.5 * sin(ang * 5.0 + log(r + 0.02) * 9.0 - uTime * 7.0);
    vec3 col = mix(vec3(1.6, 1.7, 2.0), mix(vec3(0.3, 1.4, 2.0), vec3(1.6, 0.3, 1.5), r), smoothstep(0.0, 0.5, r));
    float a = ((0.25 + 0.55 * spiral) * smoothstep(1.0, 0.8, r) + smoothstep(0.35, 0.0, r) * 0.8) * smoothstep(1100.0, 80.0, vDist);
    gl_FragColor = vec4(col * a, a);
    return;
  }
  float rings = 0.5 + 0.5 * sin(r * 18.0 - uTime * 10.0);
  float a = (0.08 + 0.25 * pow(r, 3.0) + rings * 0.06) * (1.0 + uPulse + uSpace) * smoothstep(700.0, 60.0, vDist);
  vec3 tint = mix(vec3(0.3, 0.9, 1.2), vec3(1.3, 0.9, 0.25), uSpace);
  gl_FragColor = vec4(tint * a, a);
}`;

const WALL_FRAG = /* glsl */ `
${GAMEPLAY_FOG}
varying vec3 vFlat; varying vec3 vLocal; varying vec3 vN; varying vec3 vView; varying float vDist;
void main() {
  vec3 h = vec3(1.7, 1.0, 0.25);
  vec3 lp = vLocal - vec3(0.0, 1.0, 0.0);
  vec3 e = h - abs(lp);
  float edge = smoothstep(0.12, 0.0, min(e.x, e.y));
  float stripe = step(0.5, fract((vLocal.x + vLocal.y) * 0.9 - uTime * 1.5));
  float front = smoothstep(0.5, 0.9, abs(vN.z));
  float near = smoothstep(200.0, 15.0, vDist);
  vec3 col = vec3(0.04, 0.01, 0.02);
  col += vec3(1.0, 0.12, 0.18) * stripe * front * (0.35 + near * 0.6);
  col += vec3(2.4, 0.3, 0.35) * edge * (1.0 + uPulse * 1.5 + near);
  col += vec3(1.0, 0.2, 0.3) * pow(1.0 - max(dot(vN, vView), 0.0), 3.0) * 0.6;
  gl_FragColor = vec4(fadeIn(col, vDist), 1.0);
}`;

const ARCH_FRAG = /* glsl */ `
varying vec3 vFlat; varying vec3 vLocal; varying float vDist;
void main() {
  float ang = atan(vLocal.y, vLocal.x);
  float hue = ang * 1.5 + uTime * 3.0;
  vec3 col = 0.6 + 0.6 * cos(hue + vec3(0.0, 2.1, 4.2));
  col *= 2.0 + uPulse * 3.0;
  gl_FragColor = vec4(fogIt(col, vDist), 1.0);
}`;

export { GATE_POINTS };

export class Spawner {
  // Arches are pure scenery and warp with the world; rings and walls go in
  // `overlay`, drawn after the distortion so they stay readable at any speed.
  constructor(scene, overlay) {
    this.scene = scene;
    this.overlay = overlay;
    this.active = [];
    this.warp = null; // optional { scaleAt(beat), span(a, b) } time warp, see drop.js
    this.free = { gate: [], wall: [], arch: [] };
    this.gateGeo = new THREE.TorusGeometry(2.0, 0.14, 10, 48);
    this.memGeo = new THREE.CircleGeometry(1.9, 40);
    this.wallGeo = new THREE.BoxGeometry(3.4, 2.0, 0.5);
    this.wallGeo.translate(0, 1.0, 0);
    this.archGeo = new THREE.TorusGeometry(13, 0.35, 8, 96, Math.PI);
    this.reset();
  }

  reset() {
    for (const o of this.active) this._release(o);
    this.active.length = 0;
    this.nextBeat = 8;
    this.gateLane = 2;
    this.lastGate = -99;
    this.motif = [];
    this.motifI = 0;
    this.sector = 0;
    this.drops = [];
  }

  setDrops(drops) {
    this.drops = drops || [];
  }

  _make(type) {
    const pool = this.free[type];
    if (pool.length) {
      const o = pool.pop();
      o.group.visible = true;
      return o;
    }
    const group = new THREE.Group();
    const o = { type, group };
    if (type === 'gate') {
      const ring = new THREE.Mesh(this.gateGeo, makeWarpMaterial(GATE_FRAG));
      const mem = new THREE.Mesh(
        this.memGeo,
        makeWarpMaterial(MEMBRANE_FRAG, { uniforms: { uPortal: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })
      );
      ring.frustumCulled = mem.frustumCulled = false;
      group.add(ring, mem);
      o.portal = mem.material.uniforms.uPortal;
    } else if (type === 'wall') {
      const m = new THREE.Mesh(this.wallGeo, makeWarpMaterial(WALL_FRAG));
      m.frustumCulled = false;
      group.add(m);
    } else {
      const m = new THREE.Mesh(this.archGeo, makeWarpMaterial(ARCH_FRAG));
      m.frustumCulled = false;
      group.add(m);
    }
    (type === 'arch' ? this.scene : this.overlay).add(group);
    return o;
  }

  _release(o) {
    o.group.visible = false;
    this.free[o.type].push(o);
  }

  _spawn(type, beat, x, accent = 0) {
    const o = this._make(type);
    o.beat = beat;
    o.x = x;
    o.z = null;
    o.done = false;
    o.hit = false;
    o.accent = accent; // see GATE_SCALE
    if (o.portal) o.portal.value = accent >= 2 ? 1 : 0;
    o.group.position.set(x, type === 'gate' ? 1.0 : 0, -9999);
    this.active.push(o);
    return o;
  }

  // Lane shape for a 2-bar phrase: bar A plays the motif, bar B answers with its mirror,
  // so the slalom repeats with the music instead of wandering at random.
  _laneStep(bar) {
    if (this.motifI === 0 && bar % 2 === 0) this.motif = [0, 1, 2, 3].map(() => (Math.random() < 0.6 ? (Math.random() < 0.5 ? -1 : 1) : 0));
    const k = this.motif[this.motifI % 4] || 0;
    this.motifI++;
    let d = bar % 2 === 0 ? k : -k;
    if (this.gateLane + d < 0 || this.gateLane + d > 4) d = -d;
    this.gateLane += d;
  }

  // hits = [[offset in beats, weight 0..1], ...]: where the music hits inside beat b.
  _plan(b, d, lastBeat, hits) {
    if (b > lastBeat) return;
    const inBar = b % 4;
    const bar = Math.floor(b / 4);
    if (inBar === 0) this.motifI = 0;

    if (inBar === 0 && bar % 4 === 0) this._spawn('arch', b, 0);

    // the way back out of the wormhole: a portal wide enough to span every lane
    if (this.drops.some((x) => b === x + SURGE_BEATS)) {
      this.gateLane = 2;
      this._spawn('gate', b, LANES[2], 3);
      this.lastGate = b;
      return;
    }
    const drop = this.drops.find((x) => b < x && b >= x - BUILD_BEATS);
    if (drop !== undefined) {
      this._planBuild(b, drop);
      return;
    }
    if (this.drops.includes(b)) {
      this._spawn('gate', b, LANES[this.gateLane], 2);
      this.lastGate = b;
      return;
    }
    if (this.drops.some((x) => b > x && b < x + SURGE_BEATS)) d = Math.min(1, d + 0.25);

    // every 8th bar: a straight runway of rings to build speed on
    if (bar % 8 === 7) {
      this._spawn('gate', b, LANES[this.gateLane]);
      if (d > 0.4) this._spawn('gate', b + 0.5, LANES[this.gateLane]);
      this.lastGate = b + 0.5;
      return;
    }

    let walled = false;
    for (const [at, w] of hits) {
      const t = b + at;
      // the craft needs about a beat to cross a lane, so closer rings stay in line
      if (t - this.lastGate >= 1) this._laneStep(bar);
      const gl = this.gateLane;
      if (Math.random() < w * (0.75 + 0.25 * d)) {
        // the downbeat after a drum fill gets a bigger accent ring
        this._spawn('gate', t, LANES[gl], inBar === 0 && bar % 4 === 0 && b > 8 ? 1 : 0);
        this.lastGate = t;
      }

      // walls land on the same drum hits, at least two lanes away from the ring line
      const far = [0, 1, 2, 3, 4].filter((l) => Math.abs(l - gl) >= 2);
      if (!walled && Math.random() < 0.3 + 0.5 * d && far.length) {
        walled = true;
        const n = 1 + (Math.random() < d ? 1 : 0) + (Math.random() < d * 0.5 ? 1 : 0);
        shuffle(far)
          .slice(0, n)
          .forEach((l) => this._spawn('wall', t, LANES[l]));
      } else if (walled && d > 0.55 && Math.random() < (d - 0.55) * 1.4 && far.length) {
        this._spawn('wall', t, LANES[far[Math.floor(Math.random() * far.length)]]);
      }
    }
  }

  // First half of the build: a gentle slalom, a lane every 2 beats. Second half: one
  // straight line, a ring every beat, then every half beat for the last 4.
  _planBuild(b, drop) {
    const left = drop - b;
    if (left > BUILD_BEATS / 2) {
      if (left % 2 === 0) {
        let k = Math.random() < 0.5 ? -1 : 1;
        if (this.gateLane + k < 1 || this.gateLane + k > 3) k = -k;
        this.gateLane += k;
      }
      this._spawn('gate', b, LANES[this.gateLane]);
    } else {
      this._spawn('gate', b, LANES[this.gateLane]);
      if (left <= 4) this._spawn('gate', b + 0.5, LANES[this.gateLane]);
    }
    this.lastGate = b + (left <= 4 ? 0.5 : 0);
  }

  // Returns a list of events that happened this frame.
  update(dt, beatNow, spb, worldSpd, playerX, invuln, difficulty, lastBeat, hitsAt) {
    const events = [];
    const look = Math.max(10, Math.ceil(480 / (spb * worldSpd)));
    while (this.nextBeat < beatNow + look) {
      this._plan(this.nextBeat, difficulty, lastBeat, hitsAt(this.nextBeat));
      this.nextBeat++;
    }

    // rings grow in the wormhole so they read through the chaos; the hit box grows a little too
    const gateScale = 1 + U.uSpace.value * 0.45;
    const gateR = GATE_R + U.uSpace.value * 0.6;
    // a time warp (the drop's slow-motion hang) can slow the picture; objects then sit closer
    // and move slower, so they still arrive on their beat
    const w = this.warp;
    const moveSpd = worldSpd * (w ? w.scaleAt(beatNow) : 1);
    for (let i = this.active.length - 1; i >= 0; i--) {
      const o = this.active[i];
      if (o.type === 'gate') o.group.scale.setScalar(gateScale * GATE_SCALE[o.accent]);
      const target = -(w ? w.span(beatNow, o.beat) : o.beat - beatNow) * spb * worldSpd;
      if (o.z === null) o.z = target;
      o.z += moveSpd * dt;
      o.z += (target - o.z) * Math.min(1, dt * 4);
      o.group.position.z = o.z;

      const dx = Math.abs(playerX - o.x);
      if (o.type === 'gate') {
        // judged on the beat clock, not position, so the window is the same at any speed
        const tLeft = (o.beat - beatNow) * spb;
        if (!o.done && tLeft < HIT_WINDOW) {
          if (dx < gateR + [0, 0, 0.8, 12][o.accent]) {
            o.done = o.hit = true;
            events.push({ type: 'gate', x: o.x, beat: o.beat, accent: o.accent });
          } else if (tLeft < -HIT_WINDOW) {
            o.done = true;
            events.push({ type: 'miss', x: o.x });
          }
        }
        if (o.hit && tLeft <= 0) o.group.visible = false;
      } else if (!o.done && o.z >= -0.4) {
        o.done = true;
        if (o.type === 'wall') {
          if (dx < 2.5) {
            if (!invuln) events.push({ type: 'crash', x: o.x });
          } else if (dx < 3.4) events.push({ type: 'close', x: o.x });
          else if (dx < 9) events.push({ type: 'pass', x: o.x });
        } else {
          this.sector++;
          events.push({ type: 'arch', sector: this.sector });
        }
      }
      if (o.z > 30) {
        this._release(o);
        this.active.splice(i, 1);
      }
    }
    return events;
  }
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
