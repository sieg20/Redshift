// Drop cinematics: the camera, letterbox and time-warp choreography around each musical drop.
//
//   build  (last 8 beats)  letterbox bars close in and a riser climbs; over the last 4 the
//                          camera rises and pulls back into a wide shot down the line of rings
//   hang   (last ~1 s)      the world slows to a crawl, colour drains away and the music is
//                          muffled to a distant thump while a reversed cymbal swells; the camera
//                          creeps back as the view narrows (a dolly zoom): the world breathes in
//   impact (the drop beat)  the drop ring is a portal. Fly through it: a split-second freeze,
//                          then the camera slams back in tight with a wide FOV punch and a dutch
//                          tilt, the picture bulges outward, the ring shatters, a shockwave
//                          rolls down the track, the sun bursts into a ring, the sky cracks
//                          open and you're in the wormhole; the letterbox snaps away
//   surge  (16 beats after) inside the wormhole the camera kicks on every strong hit; an exit
//                          portal at the end throws you back out onto the road
//
// Time warp: the hang and the freeze slow the *picture*, not the music, so everything still has
// to reach the craft exactly on its beat. Objects therefore sit at a distance of
// span(now, beat) = integral of the speed scale between now and their beat, and move at
// scaleAt(now) times normal speed. They crawl in close during the hang and arrive on time.
//
// update() returns cues ('build', 'hang', 'exit') and main.js calls impact(); main.js hangs the
// sound and one-off effects off those. More can be added there without touching the timing.

export const SURGE_BEATS = 16;
const SLOW = 0.12; // world speed during the hang
const HITSTOP_S = 0.09; // freeze at the moment of impact, in seconds
const HANG_S = 0.95; // rough length of the hang, in seconds
const CRACK_HEAL_S = 3; // the sky crack heals over this long after the exit portal
const LB_BEATS = 8; // letterbox starts closing this many beats before the drop
const PULL_FROM = 4; // camera pull-back runs from 4 beats out...
const PULL_TO = 1.2; // ...to 1.2 beats out
const KICK_MIN = 0.6; // weakest hit that kicks the camera during the surge

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class DropDirector {
  constructor() {
    this.drops = [];
    this.setTrack([], 0.5);
  }

  setTrack(drops, spb) {
    this.drops = drops.slice().sort((a, b) => a - b);
    this.spb = spb;
    // the hang lasts about a second, rounded to whole beats (3 at 174 BPM, 2 at 128)
    this.hangB = Math.max(1, Math.round(HANG_S / spb));
    // a quick slow-down at the start, so most of the hang is spent at the crawl
    this.easeB = Math.min(this.hangB * 0.4, 0.3 / spb);
    this.stopB = HITSTOP_S / spb;
    this.reset();
  }

  reset() {
    this.lb = 0; // letterbox 0..1
    this.pull = 0; // wide pull-back 0..1
    this.hang = 0; // 0..1 how deep into the hang
    this.punch = 0; // impact punch, decays after the freeze
    this.rollDir = 1;
    this.kick = 0; // surge camera kick
    this.inhale = 0; // 0..1 through the hang: the dolly zoom
    this.portal = 0; // 1 while inside the drop's wormhole
    this.inPortal = null; // the drop whose wormhole we're in
    this.skyT = 99; // seconds since the sun burst (counts once the impact freeze ends)
    this.crack = 0; // 0..1 how far the sky is torn open
    this.frozen = false;
    this.cued = new Set();
    this.kickQ = [];
    this.kickBeat = Infinity;
    this.surgeFor = -1;
  }

  // Speed scale of the picture for a drop, by beats relative to it (x = beat - drop).
  _profile(x) {
    if (x < -this.hangB || x >= this.stopB) return 1;
    if (x >= 0) return 0;
    if (x < -this.hangB + this.easeB) return 1 + (SLOW - 1) * smoothstep(0, 1, (x + this.hangB) / this.easeB);
    return SLOW;
  }

  scaleAt(b) {
    for (const d of this.drops) {
      const x = b - d;
      if (x >= -this.hangB && x < this.stopB) return this._profile(x);
    }
    return 1;
  }

  // Integral of scaleAt over [a, b], in beats. Exact outside the warp windows, numeric inside.
  span(a, b) {
    if (b < a) return -this.span(b, a);
    let s = b - a;
    for (const d of this.drops) {
      const lo = Math.max(a, d - this.hangB);
      const hi = Math.min(b, d + this.stopB);
      if (hi <= lo) continue;
      const n = 24, w = (hi - lo) / n;
      for (let i = 0; i < n; i++) s -= (1 - this._profile(lo + (i + 0.5) * w - d)) * w;
    }
    return s;
  }

  // Called by main on the drop beat.
  impact(d) {
    this.inPortal = d;
    this.skyT = 0;
    this.portal = 1;
    this.inhale = 0;
    this.lb = 0;
    this.pull = 0;
    this.punch = 1;
    this.rollDir = Math.random() < 0.5 ? -1 : 1;
  }

  // hitsAt(b) = the track's [[offset, weight], ...] for beat b. Returns this frame's cues.
  update(dt, beat, hitsAt) {
    const cues = [];
    const scale = this.scaleAt(beat);
    this.frozen = scale === 0;
    const d = this.drops.find((x) => beat < x + SURGE_BEATS);
    let lbT = 0, pullT = 0;
    this.hang = 0;
    this.inhale = 0;

    if (d !== undefined) {
      const left = d - beat;
      if (left > 0) {
        lbT = smoothstep(LB_BEATS, 1, left);
        pullT = smoothstep(PULL_FROM, PULL_TO, left);
        this.hang = (1 - scale) / (1 - SLOW);
        this.inhale = Math.pow(Math.min(1, Math.max(0, 1 - left / this.hangB)), 1.5);
        if (left <= 8.5 && !this.cued.has(d + 0.25)) {
          this.cued.add(d + 0.25);
          cues.push({ type: 'build', drop: d, start: Math.max(beat, d - 8) });
        }
        // a little early, so audio can be scheduled to start exactly on the hang
        if (left <= this.hangB + 0.5 && !this.cued.has(d)) {
          this.cued.add(d);
          cues.push({ type: 'hang', drop: d, start: d - this.hangB });
        }
      } else {
        // the surge: kick the camera on the strong hits
        if (this.surgeFor !== d) {
          this.surgeFor = d;
          this.kickQ.length = 0;
          this.kickBeat = Math.floor(beat);
        }
        while (this.kickBeat <= Math.floor(beat)) {
          for (const [at, w] of hitsAt(this.kickBeat)) if (w >= KICK_MIN) this.kickQ.push([this.kickBeat + at, w]);
          this.kickBeat++;
        }
        const taper = 1 - smoothstep(SURGE_BEATS - 4, SURGE_BEATS, beat - d);
        for (let i = this.kickQ.length - 1; i >= 0; i--) {
          const [t, w] = this.kickQ[i];
          if (t > beat) continue;
          if (t > d + 0.25 && beat - t < 0.25) this.kick = Math.max(this.kick, w * taper);
          this.kickQ.splice(i, 1);
        }
      }
    }
    // out through the exit portal
    if (this.inPortal !== null && beat >= this.inPortal + SURGE_BEATS) {
      cues.push({ type: 'exit', drop: this.inPortal });
      this.inPortal = null;
    }
    if (this.inPortal === null) this.portal = Math.max(0, this.portal - dt * 4);

    // the sky: the sun bursts into a ring once the freeze lets go; the crack tears open fast,
    // stays open through the whole surge and heals slowly once you're back on the road
    if (!this.frozen) this.skyT += dt;
    if (this.inPortal !== null) this.crack += (1 - this.crack) * Math.min(1, dt * 7);
    else this.crack = Math.max(0, this.crack - dt / CRACK_HEAL_S);

    // bars close smoothly; the impact snaps them open (see impact())
    this.lb += (lbT - this.lb) * Math.min(1, dt * (lbT > this.lb ? 5 : 10));
    this.pull += (pullT - this.pull) * Math.min(1, dt * 3);
    if (!this.frozen) this.punch *= Math.exp(-dt * 3.2);
    this.kick *= Math.exp(-dt * 10);
    return cues;
  }

  // Camera adjustments, in the warped camera rig's local units.
  get camUp() {
    return this.pull * 4.5;
  }
  get camBack() {
    return this.pull * 9 + this.inhale * 6 - this.punch * 1.4 - this.kick * 0.7;
  }
  get fovAdd() {
    return this.punch * 30 + this.kick * 5 - this.inhale * 20;
  }
  get roll() {
    return this.rollDir * this.punch * 0.1;
  }
  // >0 drags the picture towards the centre (the hang breathing in); <0 bulges it out (impact)
  get pinch() {
    return this.inhale * 0.12 - this.punch * 0.16;
  }
  get saturation() {
    return 1 - this.hang * 0.85;
  }
}
