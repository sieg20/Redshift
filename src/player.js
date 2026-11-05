// The craft, its light trails, the mirage afterimages it sheds, and the
// vapor cone it punches through at the sound barrier.

import * as THREE from 'three';
import { U, warpGLSL, warpPoint } from './warp.js';

const TRAIL_N = 70;

function craftGeometry() {
  const N = [0, 0.05, -2.4], L = [-1.5, -0.05, 0.9], R = [1.5, -0.05, 0.9];
  const T = [0, 0.42, 0.25], B = [0, 0.12, 1.0], D = [0, -0.25, 0.2];
  const F1 = [0, 0.4, 0.35], F2 = [0, 0.95, 1.1], F3 = [0, 0.2, 1.05];
  const tris = [N, L, T, N, T, R, L, B, T, T, B, R, N, D, L, N, R, D, L, D, B, D, R, B, F1, F2, F3];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(tris.flat(), 3));
  g.computeVertexNormals();
  return g;
}

const _gold = new THREE.Color();

// soft round dot for point sprites
function dotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

export class Player {
  // `craftScene` is drawn after the distortion passes so the craft stays crisp;
  // trails and afterimages live in the world `scene` and smear with everything else.
  constructor(scene, craftScene) {
    this.scene = scene;
    this.x = 0;
    this.vx = 0;
    this.y = 0.6;
    this.z = 0; // only the level intro moves the craft along the track
    this.bank = 0;
    this.t = 0;
    this.flash = 0;
    this.invuln = 0;
    this._tmp = new THREE.Vector3();

    const geo = craftGeometry();
    this.body = new THREE.Group();
    this.hull = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ color: '#4a4380', metalness: 0.7, roughness: 0.3, flatShading: true, side: THREE.DoubleSide, emissive: '#000000' })
    );
    this.body.add(this.hull);
    this.edgeMat = new THREE.LineBasicMaterial({ color: new THREE.Color(0.4, 2.2, 2.6) });
    this.body.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 1), this.edgeMat));

    // engine core (the exhaust itself is the centre light trail)
    this.coreMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2, 3, 4), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.core = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), this.coreMat);
    this.core.position.set(0, 0.15, 1.05);
    this.body.add(this.core);

    // vapor cone (sound barrier)
    const coneGeo = new THREE.ConeGeometry(2.6, 4.2, 40, 1, true);
    coneGeo.translate(0, -2.1, 0);
    coneGeo.rotateX(-Math.PI / 2);
    this.coneAmt = { value: 0 };
    this.cone = new THREE.Mesh(
      coneGeo,
      new THREE.ShaderMaterial({
        uniforms: { uAmt: this.coneAmt, uTime: U.uTime },
        vertexShader: /* glsl */ `
          varying vec3 vN; varying vec3 vV; varying vec3 vP;
          void main() {
            vP = position;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vN = normalize(normalMatrix * normal);
            vV = normalize(-mv.xyz);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          uniform float uAmt, uTime;
          varying vec3 vN; varying vec3 vV; varying vec3 vP;
          void main() {
            // from the chase cam the cone reads as a ring of vapor around the craft
            float streak = 0.55 + 0.45 * sin(atan(vP.x, vP.y) * 26.0 + uTime * 30.0);
            float ring = smoothstep(2.6, 3.9, vP.z) * smoothstep(4.2, 3.8, vP.z);
            float body = smoothstep(0.4, 1.5, vP.z) * smoothstep(4.2, 2.0, vP.z) * 0.12;
            float a = (ring + body) * streak * uAmt;
            gl_FragColor = vec4(vec3(0.7, 0.8, 0.95) * a, a);
          }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      })
    );
    this.cone.position.set(0, 0.1, -2.2);
    this.body.add(this.cone);

    this.light = new THREE.PointLight('#5ff', 6, 12, 2);
    this.light.position.set(0, 0.4, 1.6);
    this.body.add(this.light);
    craftScene.add(this.body);

    // drop charge-up: sparks drawn in from all around and swallowed by the engine
    this.sparkN = 70;
    this.sparks = [];
    const sp = new THREE.BufferGeometry();
    sp.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.sparkN * 3), 3));
    sp.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.sparkN * 3), 3));
    this.sparkPts = new THREE.Points(
      sp,
      new THREE.PointsMaterial({ size: 0.22, map: dotTexture(), vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
    );
    this.sparkPts.frustumCulled = false;
    this.body.add(this.sparkPts);
    this.sparkAcc = 0;

    this._trails();
    this._ghosts(geo);
  }

  _trails() {
    this.trails = [];
    const tipOffsets = [[-1.45, -0.02, 0.9], [1.45, -0.02, 0.9], [0, 0.15, 1.1]];
    tipOffsets.forEach((off, k) => {
      const pts = [];
      for (let i = 0; i < TRAIL_N; i++) pts.push(new THREE.Vector3(off[0], 0.6 + off[1], off[2] + i * 0.5));
      const pos = new Float32Array(TRAIL_N * 2 * 3);
      const age = new Float32Array(TRAIL_N * 2);
      const idx = [];
      for (let i = 0; i < TRAIL_N - 1; i++) {
        const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
        idx.push(a, b, c, b, d, c);
      }
      for (let i = 0; i < TRAIL_N; i++) age[i * 2] = age[i * 2 + 1] = i / (TRAIL_N - 1);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('aAge', new THREE.BufferAttribute(age, 1));
      geo.setIndex(idx);
      const center = k === 2;
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          ...U,
          uColA: { value: center ? new THREE.Color(1.0, 1.0, 1.4) : new THREE.Color(0.2, 1.6, 2.2) },
          uColB: { value: center ? new THREE.Color(1.6, 0.3, 1.4) : new THREE.Color(1.6, 0.2, 1.2) },
          uAmt: { value: center ? 0 : 1 },
        },
        vertexShader: /* glsl */ `
          ${warpGLSL}
          attribute float aAge;
          varying float vAge;
          void main() {
            vAge = aAge;
            float roll;
            vec3 q = warpPos(position, roll);
            gl_Position = projectionMatrix * viewMatrix * vec4(q, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uColA, uColB; uniform float uAmt;
          varying float vAge;
          void main() {
            float a = pow(1.0 - vAge, 1.5) * uAmt;
            gl_FragColor = vec4(mix(uColA, uColB, vAge) * a, a);
          }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      this.trails.push({ off, pts, geo, mat, mesh, center });
    });
  }

  _ghosts(geo) {
    this.ghosts = [];
    for (let i = 0; i < 18; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: '#fff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const m = new THREE.Mesh(geo, mat);
      m.visible = false;
      this.scene.add(m);
      this.ghosts.push({ mesh: m, life: 0, x: 0, y: 0, z: 0, drift: 0, bank: 0, scale: 1 });
    }
    this.ghostIdx = 0;
    this.ghostAcc = 0;
  }

  spawnGhost(x, y, z, drift, color, bank) {
    const g = this.ghosts[this.ghostIdx];
    this.ghostIdx = (this.ghostIdx + 1) % this.ghosts.length;
    Object.assign(g, { life: 1, x, y, z, drift, bank, scale: 1 });
    g.mesh.material.color.copy(color);
    g.mesh.visible = true;
  }

  update(dt, steer, fx, worldSpd) {
    this.t += dt;
    // drop build-up: charge (0..1) is set from outside, chargeBeat kicks on each beat of it
    const ch = this.charge || 0;
    this.chargeBeat = (this.chargeBeat || 0) * Math.exp(-dt * 6);
    const cb = this.chargeBeat;
    this.flash = Math.max(0, this.flash - dt * 3);
    this.invuln = Math.max(0, this.invuln - dt);

    // lateral handling gets tighter as you go faster
    const accel = 70 + 40 * fx.blur;
    const maxV = 16 + 8 * fx.blur;
    this.vx += steer * accel * dt;
    if (!steer) this.vx *= Math.pow(0.0008, dt);
    this.vx = THREE.MathUtils.clamp(this.vx, -maxV, maxV);
    this.x += this.vx * dt;
    if (Math.abs(this.x) > 9.2) {
      this.x = Math.sign(this.x) * 9.2;
      this.vx *= -0.3;
    }
    this.bank += (-this.vx * 0.035 - this.bank) * Math.min(1, dt * 10);
    this.y = 0.6 + Math.sin(this.t * 3) * 0.05 + fx.space * 0.25;

    this._place(this.body, this.x, this.y, this.z, this.bank);
    // holding back power: a shake that grows through the build and jolts on each beat
    if (ch > 0) {
      const j = (0.02 + cb * 0.05) * ch;
      this.body.position.x += (Math.random() - 0.5) * j * 2;
      this.body.position.y += (Math.random() - 0.5) * j * 2;
      this.body.rotation.z += (Math.random() - 0.5) * j;
    }
    const blink = this.invuln > 0 ? (Math.sin(this.t * 50) > 0 ? 1 : 0.2) : 1;
    // the hull warms to gold through a drop's build and flares on each beat
    const warm = ch * 0.15 + cb * ch * 0.35;
    this.hull.material.emissive.setRGB(0.04 + this.flash * 2 + warm, 0.03 + this.flash * 0.2 + warm * 0.65, 0.1 + this.flash * 0.6);
    this.body.visible = blink > 0.5 || this.invuln <= 0;

    // engine
    const heat = fx.speedN;
    const boost = 1 + ch * 0.6 + cb * 1.0;
    this.coreMat.color.setRGB((0.8 + heat * 0.4) * boost, (1.2 + heat * 0.3) * boost, (1.8 + fx.space * 0.6) * boost);
    this.core.scale.setScalar(0.8 + heat * 0.3 + fx.pulse * 0.3 + ch * 0.25 + cb * 0.35);
    this.edgeMat.color.setRGB(0.4 + fx.space * 2 + fx.sing * 2, 2.2 - fx.space * 1.0, 2.6);
    // charging: the outline turns gold and flashes on each beat
    const gold = Math.min(1, ch * 0.75 + cb * 0.5);
    this.edgeMat.color.lerp(_gold.setRGB(2.8 + cb * 1.5, 1.9 + cb * 1.0, 0.45), gold);
    this.light.intensity = 4 + heat * 10 + fx.pulse * 6 + ch * 8 + cb * 14;

    // vapor cone: flares right at the barrier, settles to a shimmer above it
    this.coneAmt.value = fx.sonicBand * 0.8 + fx.sonic * 0.15 * (1 - fx.space) + fx.boomFlash * 1.2;
    this.cone.visible = this.coneAmt.value > 0.01;
    this.cone.scale.set(1, 1, 1 + fx.sonic * 0.6);

    this._updateTrails(dt, worldSpd, fx);
    this._updateGhosts(dt, fx);
    this._updateSparks(dt, ch, cb);
  }

  // Sparks spawn on a shell around the craft and accelerate into the engine core, more of
  // them the closer the drop, with a burst on every beat.
  _updateSparks(dt, ch, cb) {
    const core = this.core.position;
    if (ch > 0) {
      this.sparkAcc += dt * (15 + 70 * ch);
      if (cb > 0.85 && !this._sparkBurst) {
        this.sparkAcc += 10 * ch;
        this._sparkBurst = true;
      } else if (cb < 0.5) this._sparkBurst = false;
    }
    while (this.sparkAcc >= 1 && this.sparks.length < this.sparkN) {
      this.sparkAcc--;
      const dir = new THREE.Vector3(Math.random() - 0.5, (Math.random() - 0.3) * 0.8, Math.random() - 0.7).normalize();
      this.sparks.push({
        from: core.clone().addScaledVector(dir, 2.2 + Math.random() * 2.2),
        life: 0,
        max: 0.3 + Math.random() * 0.3,
        gold: Math.random() < 0.65,
      });
    }
    this.sparkAcc = Math.min(this.sparkAcc, 3);
    const pos = this.sparkPts.geometry.attributes.position;
    const col = this.sparkPts.geometry.attributes.color;
    let n = 0;
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.life += dt;
      if (s.life >= s.max) {
        this.sparks.splice(i, 1);
        continue;
      }
      const k = s.life / s.max;
      const e = k * k; // accelerate in
      const b = Math.sin(k * Math.PI);
      pos.setXYZ(n, s.from.x + (core.x - s.from.x) * e, s.from.y + (core.y - s.from.y) * e, s.from.z + (core.z - s.from.z) * e);
      if (s.gold) col.setXYZ(n, 2.4 * b, 1.6 * b, 0.4 * b);
      else col.setXYZ(n, 0.6 * b, 1.6 * b, 2.2 * b);
      n++;
    }
    this.sparkPts.geometry.setDrawRange(0, n);
    pos.needsUpdate = true;
    col.needsUpdate = true;
  }

  _place(obj, x, y, z, bank) {
    const p = warpPoint(x, y, z, this._tmp);
    obj.position.set(p.x, p.y, p.z);
    obj.rotation.set(0, 0, p.roll + bank);
  }

  _updateTrails(dt, worldSpd, fx) {
    const cb = Math.cos(this.bank), sb = Math.sin(this.bank);
    for (const tr of this.trails) {
      const { pts, off } = tr;
      for (let i = TRAIL_N - 1; i > 0; i--) {
        pts[i].copy(pts[i - 1]);
        pts[i].z += worldSpd * dt;
      }
      // wingtip in flat space (bank rotates around the craft's z axis)
      const ox = off[0] * cb - off[1] * sb;
      const oy = off[0] * sb + off[1] * cb;
      pts[0].set(this.x + ox, this.y + oy, off[2] + this.z);

      // the drop build-up thickens and brightens the trails a little; the engine core carries most of it
      const charge = 1 + (this.charge || 0) * 0.45 + this.chargeBeat * 0.55;
      const width = (tr.center ? 0.1 + fx.speedN * 0.2 : 0.05 + fx.speedN * 0.12) * charge;
      const arr = tr.geo.attributes.position.array;
      for (let i = 0; i < TRAIL_N; i++) {
        const w = width * (1 - i / TRAIL_N);
        const p = pts[i];
        arr[i * 6] = p.x;
        arr[i * 6 + 1] = p.y + w;
        arr[i * 6 + 2] = p.z;
        arr[i * 6 + 3] = p.x;
        arr[i * 6 + 4] = p.y - w;
        arr[i * 6 + 5] = p.z;
      }
      tr.geo.attributes.position.needsUpdate = true;
      tr.mat.uniforms.uAmt.value = (tr.center ? fx.sonic * 0.5 + fx.space * 0.2 : 0.5 + fx.speedN * 0.4) + (charge - 1) * 0.4;
    }
  }

  _updateGhosts(dt, fx) {
    // mirage afterimages: shed faster the hotter you run
    const rate = fx.mirage > 0.02 ? 4 + fx.mirage * 9 + fx.space * 6 : 0;
    this.ghostAcc += rate * dt;
    const c = new THREE.Color();
    while (this.ghostAcc >= 1) {
      this.ghostAcc--;
      const k = this.ghostIdx;
      if (fx.space > 0.3 && k % 2 === 0) {
        // time echo from the near future: appears ahead and falls back into you
        c.setRGB(0.6, 0.4, 1.4);
        this.spawnGhost(this.x + (Math.random() - 0.5) * 0.6, this.y, -5 - Math.random() * 6, 14, c, this.bank);
      } else {
        if (k % 2) c.setRGB(0.15, 0.9, 1.2);
        else c.setRGB(1.2, 0.2, 0.9);
        const lat = (Math.random() - 0.5) * 0.5 * fx.mirage;
        this.spawnGhost(this.x + lat, this.y, 0.2, 10 + fx.sonic * 30, c, this.bank);
      }
    }
    for (const g of this.ghosts) {
      if (g.life <= 0) {
        g.mesh.visible = false;
        continue;
      }
      g.life -= dt * (2.4 - fx.space * 0.8);
      g.z += g.drift * dt;
      g.scale += dt * 0.25;
      this._place(g.mesh, g.x, g.y, g.z, g.bank);
      g.mesh.scale.setScalar(g.scale);
      g.mesh.material.opacity = Math.max(0, g.life) * 0.2 * (0.7 + 0.3 * Math.sin(this.t * 40 + g.z));
    }
  }

  // Collapse the trails onto the craft, so a camera cut doesn't draw a streak from where it was.
  resetTrails() {
    for (const tr of this.trails) tr.pts.forEach((p, i) => p.set(this.x + tr.off[0], this.y + tr.off[1], this.z + tr.off[2] + i * 0.05));
  }

  reset() {
    this.x = 0;
    this.z = 0;
    this.charge = this.chargeBeat = 0;
    this.sparks.length = 0;
    this.vx = 0;
    this.invuln = 0;
    this.flash = 0;
    for (const g of this.ghosts) {
      g.life = 0;
      g.mesh.visible = false;
    }
  }
}
