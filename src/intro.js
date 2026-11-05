// Level intro: a short scripted fly-by before every run.
//
//   shot 1  front three-quarter view of the craft cruising; it boosts and rips past the camera
//   shot 2  cut to a far side view: the craft crosses in front of a black hole, and the song's
//           name appears inside the event horizon
//   shot 3  the camera swings round behind the craft as a portal rushes in; the craft flies
//           through it and the run (and the music) starts
//
// It all happens out in space: the ground and pylons are hidden, the sky switches to its deep
// space look, and a field of star streaks rushes past to show the speed. The intro moves the
// craft along z, drives the camera, and overrides a few world/post uniforms after the normal
// visuals update.

import * as THREE from 'three';
import { U } from './warp.js';

// shot timings, seconds from the start of the intro
const BOOST_AT = 3.8;
const SHOT2 = 5.0;
const SHOT3 = 10.5;
const ENTER = 14.0;
const SWELL_AT = ENTER - 1.15; // the reverse swell peaks as the craft hits the portal
export const DRONE_LEN = SHOT3 - SHOT2 + 1.5; // the black hole's drone, fading out into shot 3

const HOLE_POS = new THREE.Vector3(-820, 95, -20);
const HOLE_R = 135;
const CAM2 = new THREE.Vector3(42, 3, 6);
const SHIP2_FROM = 55; // shot 2: the craft crosses from z = +55 to -55 past a still camera
const SHIP2_TO = -55;
const STARS = 1800;
const PORTAL_SPEED = 95; // how fast the portal closes in during shot 3
const PORTAL_Y = 1.2;

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const ADD = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide };

function holeGroup(time) {
  const g = new THREE.Group();

  const sphere = new THREE.Mesh(new THREE.SphereGeometry(HOLE_R, 48, 32), new THREE.MeshBasicMaterial({ color: '#000' }));
  sphere.renderOrder = 1;
  g.add(sphere);

  // accretion disk, tilted so its near side passes below the middle of the hole
  const disk = new THREE.Mesh(
    new THREE.RingGeometry(HOLE_R * 1.25, HOLE_R * 3.2, 160, 4),
    new THREE.ShaderMaterial({
      uniforms: { uTime: time },
      vertexShader: /* glsl */ `
        varying vec2 vP;
        void main() { vP = position.xy / ${HOLE_R.toFixed(1)}; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        varying vec2 vP;
        void main() {
          float r = length(vP);
          float ang = atan(vP.y, vP.x);
          float hot = smoothstep(3.2, 1.25, r);
          vec3 col = mix(vec3(0.9, 0.18, 0.55), vec3(1.7, 0.95, 0.45), hot) + vec3(1.2) * smoothstep(1.6, 1.25, r);
          float streak = 0.55 + 0.45 * sin(ang * 3.0 - uTime * 1.3 + r * 9.0) * sin(r * 37.0 - uTime * 0.6);
          float doppler = 1.0 + 0.7 * sin(ang);
          float a = smoothstep(1.25, 1.45, r) * smoothstep(3.2, 2.0, r) * streak * doppler;
          gl_FragColor = vec4(col * a * 1.4, a);
        }`,
      ...ADD,
    })
  );
  // flat, then tipped towards the side camera (+x) so it opens up a little
  disk.rotation.x = -Math.PI / 2;
  disk.rotateOnWorldAxis(new THREE.Vector3(0, 0, 1), -0.45);
  disk.renderOrder = 2;
  g.add(disk);

  // camera-facing halo: photon ring hugging the horizon, the far side of the disk bent up and
  // over the top by the hole's gravity, and a soft glow
  const halo = new THREE.Mesh(
    new THREE.PlaneGeometry(HOLE_R * 7, HOLE_R * 7),
    new THREE.ShaderMaterial({
      uniforms: { uTime: time },
      vertexShader: /* glsl */ `
        varying vec2 vP;
        void main() { vP = position.xy / ${HOLE_R.toFixed(1)}; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        varying vec2 vP;
        void main() {
          float r = length(vP);
          if (r < 1.0) discard;
          float ang = atan(vP.y, vP.x);
          float ring = exp(-pow((r - 1.04) / 0.025, 2.0)) * 1.8;
          float arc = smoothstep(1.05, 1.15, r) * smoothstep(1.75, 1.25, r) * smoothstep(-0.25, 0.45, vP.y / r);
          arc *= 0.55 + 0.45 * sin(ang * 4.0 + uTime * 1.1 + r * 11.0);
          float glow = exp(-(r - 1.0) * 1.6) * 0.18;
          vec3 col = vec3(1.5, 0.95, 0.6) * ring + vec3(1.4, 0.6, 0.55) * arc + vec3(0.8, 0.3, 0.9) * glow;
          float a = clamp(ring + arc + glow, 0.0, 1.0);
          gl_FragColor = vec4(col, a);
        }`,
      ...ADD,
    })
  );
  halo.renderOrder = 3;
  g.add(halo);

  g.position.copy(HOLE_POS);
  g.visible = false;
  return { group: g, halo };
}

function portalGroup(time) {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(5.2, 0.22, 16, 96), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.7, 2.4, 2.8) }));
  g.add(ring);
  const vortex = new THREE.Mesh(
    new THREE.CircleGeometry(5.2, 72),
    new THREE.ShaderMaterial({
      uniforms: { uTime: time },
      vertexShader: /* glsl */ `
        varying vec2 vP;
        void main() { vP = position.xy / 5.2; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        varying vec2 vP;
        void main() {
          float r = length(vP);
          float ang = atan(vP.y, vP.x);
          float spiral = 0.5 + 0.5 * sin(ang * 5.0 + log(r + 0.02) * 9.0 - uTime * 7.0);
          vec3 col = mix(vec3(1.6, 1.7, 2.0), mix(vec3(0.3, 1.4, 2.0), vec3(1.6, 0.3, 1.5), r), smoothstep(0.0, 0.5, r));
          float a = (0.25 + 0.55 * spiral) * smoothstep(1.0, 0.8, r) + smoothstep(0.35, 0.0, r) * 0.8;
          gl_FragColor = vec4(col * a, a);
        }`,
      ...ADD,
    })
  );
  g.add(vortex);
  const halo = new THREE.Mesh(
    new THREE.PlaneGeometry(30, 30),
    new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        varying vec2 vP;
        void main() { vP = position.xy / 5.2; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        varying vec2 vP;
        void main() {
          float r = length(vP);
          float a = exp(-abs(r - 1.0) * 3.0) * 0.5;
          gl_FragColor = vec4(vec3(0.5, 0.9, 1.6) * a, a);
        }`,
      ...ADD,
    })
  );
  g.add(halo);
  g.visible = false;
  return g;
}

// Star streaks in a box around the craft's path, rushing towards +z like the world does.
// A tunnel around the path itself is kept clear so nothing whips through the camera.
function starField() {
  const pts = new Float32Array(STARS * 3);
  for (let i = 0; i < STARS; i++) {
    let x, y;
    do {
      x = (Math.random() - 0.5) * 500;
      y = (Math.random() - 0.5) * 320;
    } while (Math.hypot(x, y) < 9);
    pts.set([x, y, -600 + Math.random() * 900], i * 3);
  }
  const pos = new Float32Array(STARS * 6);
  const col = new Float32Array(STARS * 6);
  for (let i = 0; i < STARS; i++) {
    const b = 0.4 + Math.random() * 1.4;
    const blue = Math.random();
    col.set([b * (0.8 + 0.2 * blue), b * 0.9, b * 1.3, 0, 0, 0], i * 6); // bright head, dark tail
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, ...ADD }));
  lines.frustumCulled = false;
  lines.visible = false;
  return { lines, pts, pos };
}

export class Intro {
  constructor(scene, world, player, camera, fx) {
    this.world = world;
    this.player = player;
    this.camera = camera;
    this.fx = fx;
    this.time = { value: 0 };
    const hole = holeGroup(this.time);
    this.hole = hole.group;
    this.holeHalo = hole.halo;
    this.portal = portalGroup(this.time);
    this.stars = starField();
    scene.add(this.hole, this.portal, this.stars.lines);

    this.el = document.getElementById('intro');
    this.titleEl = document.getElementById('intro-title');
    this.nameEl = this.titleEl.querySelector('b');
    this.subEl = this.titleEl.querySelector('span');
    this.fadeEl = document.getElementById('intro-fade');

    this.t = 0;
    this.active = false;
    this.fired = new Set();
    this._v = new THREE.Vector3();
    this._ship = new THREE.Vector3();
    this._look = new THREE.Vector3();
  }

  start(name, sub) {
    this.t = 0;
    this.active = true;
    this.fired.clear();
    this.nameEl.textContent = name;
    this.subEl.textContent = sub;
    this.el.classList.remove('hidden', 'out');
    this.titleEl.classList.remove('show');
    this.fadeEl.classList.remove('on', 'out');
    this.hole.visible = true;
    this.portal.visible = false;
    this.stars.lines.visible = true;
    this.world.floor.visible = false;
    this.world.dust.visible = false;
  }

  // Jump to the moment the craft hits the portal.
  skip() {
    if (this.active && this.t < ENTER - 0.25) {
      this.t = ENTER - 0.25;
      this.fired.add('boost').add('cut').add('swell');
    }
  }

  // Called once the run has started: tidy up and let the fade clear.
  end() {
    this.active = false;
    this.hole.visible = false;
    this.portal.visible = false;
    this.stars.lines.visible = false;
    this.world.floor.visible = true;
    this.world.dust.visible = true;
    this.el.classList.add('out');
    this.fadeEl.classList.add('out');
    setTimeout(() => this.el.classList.add('hidden'), 900);
  }

  // Craft speed to show for the current moment of the intro.
  get speed() {
    const t = this.t;
    if (t < BOOST_AT) return 75;
    if (t < SHOT2) return 75 + 120 * smoothstep(BOOST_AT, BOOST_AT + 0.3, t);
    return 150 - 20 * smoothstep(SHOT3, ENTER, t);
  }

  // Advance the script; returns the cues that fire this frame. `worldSpd` moves the stars.
  update(dt, worldSpd) {
    this.t += dt;
    this.time.value += dt;
    const t = this.t;
    const cues = [];
    const cue = (name, at) => {
      if (t >= at && !this.fired.has(name)) {
        this.fired.add(name);
        cues.push(name);
      }
    };
    cue('boost', BOOST_AT);
    cue('cut', SHOT2);
    cue('swell', SWELL_AT);
    cue('enter', ENTER);

    const p = this.player;
    if (t < SHOT2) {
      const b = Math.max(0, t - BOOST_AT);
      p.z = -b * b * 70;
    } else if (t < SHOT3) {
      p.z = SHIP2_FROM + (SHIP2_TO - SHIP2_FROM) * ((t - SHOT2) / (SHOT3 - SHOT2));
    } else p.z = SHIP2_TO;

    // star streaks: stretch with speed, wrap round once they pass behind
    const { pts, pos } = this.stars;
    const len = Math.min(14, 0.6 + worldSpd * 0.05);
    for (let i = 0; i < STARS; i++) {
      let z = pts[i * 3 + 2] + worldSpd * dt;
      if (z > 300) z -= 900;
      pts[i * 3 + 2] = z;
      const x = pts[i * 3], y = pts[i * 3 + 1];
      pos.set([x, y, z, x, y, z + len], i * 6);
    }
    this.stars.lines.geometry.attributes.position.needsUpdate = true;
    return cues;
  }

  // After the normal visuals update: camera, world and post-effect overrides for this shot.
  apply(fadeDark) {
    const t = this.t;
    const cam = this.camera;
    const p = this.player;
    const ship = this._ship.set(0, p.y, p.z);
    const u = this.fx.u;

    // open space: deep-space sky, no ground or pylons, nothing curled
    U.uSpace.value = 1;
    U.uSing.value = 0;
    U.uInvR.value = 1 / 6000;
    for (const m of [this.world.pylons, this.world.lines, this.world.phantoms]) m.visible = false;

    let fov, focus = null;
    u.uLens.value = 0;
    u.uBlur.value = 0;
    if (t < SHOT2) {
      // shot 1: low, ahead and to the side, slowly drifting; follows the craft as it shoots past
      const d = t / SHOT2;
      cam.position.set(3.6 - d * 1.2, 1.2 + d * 0.3, -5.6 - d * 1.6);
      this._look.set(0, 0.7, ship.z * 0.85 - 0.5);
      fov = 50;
      u.uBlur.value = smoothstep(BOOST_AT, BOOST_AT + 0.2, t) * 0.25;
      this.hole.visible = false;
    } else if (t < SHOT3) {
      // shot 2: a still camera off to the side, the black hole hanging behind the craft's path
      const d = (t - SHOT2) / (SHOT3 - SHOT2);
      cam.position.copy(CAM2);
      this._look.set(0, 8, 0);
      fov = 38;
      this.hole.visible = true;
      focus = HOLE_POS;
      u.uLens.value = 0.04 * smoothstep(0, 0.15, d);
      u.uBlur.value = 0.1;
    } else {
      // shot 3: swing round from the side to the chase position as the portal comes in
      const d = smoothstep(SHOT3, ENTER - 0.3, t);
      const rel0 = this._look.copy(CAM2).sub(new THREE.Vector3(0, p.y, SHIP2_TO));
      const th0 = Math.atan2(rel0.x, rel0.z), r0 = Math.hypot(rel0.x, rel0.z), h0 = rel0.y;
      const th = th0 * (1 - d), r = r0 * Math.pow(7 / r0, d), h = h0 + (2.0 - h0) * d;
      cam.position.set(ship.x + Math.sin(th) * r, ship.y + h, ship.z + Math.cos(th) * r);
      this._look.set(0, ship.y + 0.5 * d, ship.z - 30 * d);
      fov = 38 + 26 * d;
      this.hole.visible = d < 0.6;
      this.portal.visible = true;
      this.portal.position.set(0, PORTAL_Y, ship.z - PORTAL_SPEED * (ENTER - t));
      this.portal.scale.setScalar(1 + smoothstep(ENTER - 0.4, ENTER, t) * 0.3);
      focus = this.portal.position;
      u.uBlur.value = 0.25 * d;
    }

    cam.fov = fov;
    cam.updateProjectionMatrix();
    cam.up.set(0, 1, 0);
    cam.lookAt(this._look);
    cam.updateMatrixWorld();
    U.uCamPos.value.copy(cam.position);
    this.world.followCamera(cam);
    this.holeHalo.quaternion.copy(cam.quaternion);

    // post effects centred on whatever the shot is about
    const proj = (v) => this._v.copy(v).project(cam);
    if (focus) {
      proj(focus);
      u.uFocus.value.set(THREE.MathUtils.clamp(this._v.x * 0.5 + 0.5, 0, 1), THREE.MathUtils.clamp(this._v.y * 0.5 + 0.5, 0, 1));
    }
    proj(ship);
    u.uShockC.value.set(this._v.x * 0.5 + 0.5, this._v.y * 0.5 + 0.5);
    u.uMirage.value = 0;
    u.uWarp.value = 0;
    u.uEcho.value = 0;
    u.uSing.value = 0;
    u.uChroma.value = t >= SHOT2 && t < SHOT3 ? 0.08 : 0.25 + u.uBlur.value;
    u.uVig.value = 0.55;

    // song title inside the event horizon: placed where the hole sits in the still side shot,
    // then simply faded in and out
    const d2 = (t - SHOT2) / (SHOT3 - SHOT2);
    this.titleEl.classList.toggle('show', d2 >= 0.1 && d2 < 0.85);
    if (t >= SHOT2 && t < SHOT3) {
      proj(HOLE_POS);
      const dist = cam.position.distanceTo(HOLE_POS);
      const focal = innerHeight / 2 / Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
      const rpx = (HOLE_R / dist) * focal;
      const s = this.titleEl.style;
      s.left = `${(this._v.x * 0.5 + 0.5) * innerWidth}px`;
      s.top = `${(0.5 - this._v.y * 0.5) * innerHeight - rpx * 0.12}px`;
      s.width = `${rpx * 1.6}px`;
      s.fontSize = `${Math.max(14, Math.min(64, rpx * 0.17))}px`;
    }

    // the portal floods the screen as the craft goes through
    if (t > ENTER - 0.18) this.fadeEl.classList.add('on');
    this.fadeEl.classList.toggle('dark', fadeDark);
  }
}
