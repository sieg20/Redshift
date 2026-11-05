// Shards of a shattered portal ring: flat, tumbling slivers of glass that burst outward from the
// ring, with a share of them flung straight past the camera. They live in the main scene, so
// bloom and the speed blur smear them into streaks.

import * as THREE from 'three';

const MAX = 220;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _c = new THREE.Color();

// a long, thin, flat triangle: reads as a sliver of broken glass
function shardGeometry() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, -0.5, 0.5, 0, -0.35, 0, 0, 0.9], 3));
  g.computeVertexNormals();
  return g;
}

export class Shards {
  constructor(scene) {
    const mat = new THREE.MeshBasicMaterial({
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.mesh = new THREE.InstancedMesh(shardGeometry(), mat, MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.setColorAt(0, new THREE.Color());
    scene.add(this.mesh);
    this.p = [];
  }

  // Shatter a ring of radius r centred on `c`. `color` tints the shards, `n` is how many, and
  // `cam` (the camera position) is where a share of them get flung.
  burst(c, r, color, n, cam) {
    for (let i = 0; i < n && this.p.length < MAX; i++) {
      const a = Math.random() * Math.PI * 2;
      const out = new THREE.Vector3(Math.cos(a), Math.sin(a), 0);
      const pos = c.clone().addScaledVector(out, r * (0.85 + Math.random() * 0.3));
      let vel;
      if (cam && i % 4 === 0) {
        // straight at the lens, just missing it
        const aim = cam.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 2, 0));
        vel = aim.sub(pos).normalize().multiplyScalar(45 + Math.random() * 35);
      } else {
        vel = out.multiplyScalar(7 + Math.random() * 20).add(new THREE.Vector3(0, 0, 20 + Math.random() * 50));
      }
      const big = Math.random() < 0.25;
      this.p.push({
        pos,
        vel,
        axis: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(),
        rot: Math.random() * 6,
        spin: (Math.random() - 0.5) * 16,
        life: 0,
        max: 0.8 + Math.random() * 0.8,
        size: big ? 0.5 + Math.random() * 0.5 : 0.15 + Math.random() * 0.25,
        stretch: 1 + Math.random() * 1.5,
        color: color.clone().lerp(new THREE.Color(1.6, 1.5, 1.4), Math.random() * 0.4).multiplyScalar(0.7 + Math.random() * 0.6),
      });
    }
  }

  clear() {
    this.p.length = 0;
    this.mesh.count = 0;
  }

  // dt is already scaled by the drop's time warp, so shards freeze with the picture.
  update(dt) {
    const p = this.p;
    for (let i = p.length - 1; i >= 0; i--) {
      const s = p[i];
      s.life += dt;
      if (s.life >= s.max) {
        p.splice(i, 1);
        continue;
      }
      s.pos.addScaledVector(s.vel, dt);
      s.vel.multiplyScalar(Math.exp(-dt * 1.1));
      s.rot += s.spin * dt;
    }
    for (let i = 0; i < p.length; i++) {
      const s = p[i];
      const k = 1 - s.life / s.max;
      _q.setFromAxisAngle(_axis.copy(s.axis), s.rot);
      const sz = s.size * (0.4 + 0.6 * k);
      _s.set(sz, sz, sz * s.stretch);
      _m.compose(s.pos, _q, _s);
      this.mesh.setMatrixAt(i, _m);
      // glints as it tumbles
      const glint = 0.6 + 0.6 * Math.abs(Math.sin(s.rot * 1.7));
      this.mesh.setColorAt(i, _c.copy(s.color).multiplyScalar(k * glint));
    }
    this.mesh.count = p.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
