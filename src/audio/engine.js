// Shared audio graph: music bus (speed-controlled lowpass) + sfx bus -> glue compressor -> limiter
// -> player volume. Both the built-in soundtrack and user-loaded tracks play through this.

export class AudioEngine {
  constructor() {
    const c = (this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' }));

    this.music = c.createGain();
    this.filter = c.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 900;
    this.filter.Q.value = 0.9;

    this.sfx = c.createGain();
    this.sfx.gain.value = 0.55;

    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -18;
    this.comp.knee.value = 8;
    this.comp.ratio.value = 4;
    this.comp.attack.value = 0.004;
    this.comp.release.value = 0.18;

    this.master = c.createGain();
    this.master.gain.value = 0.9;

    this.limiter = c.createDynamicsCompressor();
    this.limiter.threshold.value = -1.5;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.001;
    this.limiter.release.value = 0.08;

    this.analyser = c.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.55;
    this.freq = new Uint8Array(this.analyser.frequencyBinCount);

    // Player volume sliders. Separate from music/sfx above, which the game itself rides.
    this.musicVol = c.createGain();
    this.sfxVol = c.createGain();
    this.masterVol = c.createGain();

    // The drop's hang muffles the music to a distant thump, then lets go exactly on the drop.
    this.hangLp = c.createBiquadFilter();
    this.hangLp.type = 'lowpass';
    this.hangLp.frequency.value = 20000;
    this.hangDuck = c.createGain();

    this.music.connect(this.filter).connect(this.hangLp).connect(this.hangDuck).connect(this.musicVol).connect(this.comp);
    this.sfx.connect(this.sfxVol).connect(this.comp);
    this.comp.connect(this.master).connect(this.limiter).connect(this.masterVol).connect(c.destination);
    // visuals read the music before the volume sliders, so turning it down keeps the pulse
    this.filter.connect(this.analyser);

    // 2 s of white noise shared by every noise-based instrument
    const len = c.sampleRate * 2;
    this.noise = c.createBuffer(1, len, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // Air roar: a band of noise that climbs in pitch and level with speed, plus a
    // sub rumble that only wakes up in the wormhole.
    this.windBp = c.createBiquadFilter();
    this.windBp.type = 'bandpass';
    this.windBp.Q.value = 0.8;
    this.windBp.frequency.value = 300;
    this.windGain = c.createGain();
    this.windGain.gain.value = 0;
    this.rumbleLp = c.createBiquadFilter();
    this.rumbleLp.frequency.value = 90;
    this.rumbleGain = c.createGain();
    this.rumbleGain.gain.value = 0;
    const wind = this.noiseSource();
    wind.connect(this.windBp).connect(this.windGain).connect(this.sfx);
    wind.connect(this.rumbleLp).connect(this.rumbleGain).connect(this.sfx);
    wind.start();

    this.open = 0; // 0..1 how far the speed filter is open
    this.slamAmt = 0; // crash "filter slam", decays back to 0
    this.dropSrc = []; // riser / reverse cymbal sources, so a quit can silence them
    this.userOffset = 0; // seconds, adjustable with [ ]
  }

  // Time the listener is actually hearing right now (compensates output latency).
  get heardTime() {
    const c = this.ctx;
    return c.currentTime - (c.outputLatency || 0) - (c.baseLatency || 0) + this.userOffset;
  }

  resume() {
    if (this.ctx.state !== 'running') return this.ctx.resume();
    return Promise.resolve();
  }

  // Slider values 0..1; squared so the slider feels even to the ear.
  setVolume({ master, music, sfx }) {
    const t = this.ctx.currentTime;
    this.masterVol.gain.setTargetAtTime(master * master, t, 0.02);
    this.musicVol.gain.setTargetAtTime(music * music, t, 0.02);
    this.sfxVol.gain.setTargetAtTime(sfx * sfx, t, 0.02);
  }

  noiseSource(t) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.loopStart = Math.random();
    return s;
  }

  // Called every frame with the speed-driven openness; 0 = muffled, 1 = full spectrum.
  update(dt, open, speed = 0) {
    this.open += (open - this.open) * Math.min(1, dt * 3);
    this.slamAmt = Math.max(0, this.slamAmt - dt * 0.8);
    const x = this.open * (1 - this.slamAmt * 0.9);
    const hz = 520 * Math.pow(38, x);
    const now = this.ctx.currentTime;
    this.filter.frequency.setTargetAtTime(Math.min(hz, 20000), now, 0.03);

    const s = Math.max(0, Math.min(1, speed));
    this.windBp.frequency.setTargetAtTime(250 * Math.pow(14, s), now, 0.1);
    this.windGain.gain.setTargetAtTime(s > 0 ? 0.03 + 0.3 * Math.pow(s, 1.4) : 0, now, 0.15);
    this.rumbleGain.gain.setTargetAtTime(Math.max(0, s - 0.5) * 1.6, now, 0.2);
  }

  // Muffle and duck the music from `start` until `drop` (audio-clock times), then snap it
  // back open on the drop itself.
  hang(start, drop) {
    const c = this.ctx;
    const t0 = Math.max(c.currentTime, start);
    if (drop <= t0) return;
    const ramp = Math.min(0.25, (drop - t0) * 0.45);
    const f = this.hangLp.frequency, g = this.hangDuck.gain;
    f.cancelScheduledValues(0);
    g.cancelScheduledValues(0);
    f.setValueAtTime(20000, t0);
    f.exponentialRampToValueAtTime(240, t0 + ramp);
    g.setValueAtTime(1, t0);
    g.linearRampToValueAtTime(0.4, t0 + ramp);
    f.setValueAtTime(20000, drop);
    g.setValueAtTime(1, drop);
  }

  // Build-up riser for songs that don't bring their own: a noise sweep and a climbing saw,
  // from `start` to `end` (audio-clock times), cut dead on the drop.
  riser(start, end) {
    const c = this.ctx, t = Math.max(c.currentTime, start);
    if (end - t < 0.3) return;
    const n = this.noiseSource();
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(8000, end);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, end);
    g.gain.setValueAtTime(0, end);
    n.connect(bp).connect(g).connect(this.sfx);
    n.start(t);
    n.stop(end + 0.05);
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(880, end);
    const lp = c.createBiquadFilter();
    lp.frequency.setValueAtTime(400, t);
    lp.frequency.exponentialRampToValueAtTime(5000, end);
    const og = c.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.05, end);
    og.gain.setValueAtTime(0, end);
    o.connect(lp).connect(og).connect(this.sfx);
    o.start(t);
    o.stop(end + 0.05);
    this.dropSrc.push(n, o);
  }

  // A cymbal played backwards: bright noise swelling up to `end` and stopping dead there.
  reverseCymbal(end, dur) {
    const c = this.ctx, t = Math.max(c.currentTime, end - dur);
    if (end - t < 0.1) return;
    const n = this.noiseSource();
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(9000, t);
    hp.frequency.exponentialRampToValueAtTime(3500, end);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, end);
    g.gain.setValueAtTime(0, end);
    n.connect(hp).connect(g).connect(this.sfx);
    n.start(t);
    n.stop(end + 0.05);
    this.dropSrc.push(n);
  }

  // Stops everything scheduled for a drop (quitting or restarting mid build-up).
  cancelHang() {
    for (const x of this.dropSrc.splice(0)) {
      try {
        x.stop();
      } catch (e) {
        /* already stopped */
      }
    }
    const t = this.ctx.currentTime;
    this.hangLp.frequency.cancelScheduledValues(0);
    this.hangDuck.gain.cancelScheduledValues(0);
    this.hangLp.frequency.setValueAtTime(20000, t);
    this.hangDuck.gain.setValueAtTime(1, t);
  }

  // Doppler pass-by: falls in pitch as something rips past; pan = side it's on.
  passBy(pan, strength, speed) {
    const c = this.ctx, t = c.currentTime;
    const dur = 0.35 - speed * 0.15;
    const n = this.noiseSource();
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 2;
    bp.frequency.setValueAtTime(2200 + speed * 3000, t);
    bp.frequency.exponentialRampToValueAtTime(260, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5 * strength, t + dur * 0.35);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    const p = c.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    n.connect(bp).connect(g).connect(p).connect(this.sfx);
    n.start(t);
    n.stop(t + dur + 0.02);
  }

  slam() {
    this.slamAmt = 1;
  }

  // 0..1 low-end energy for visuals
  bass() {
    this.analyser.getByteFrequencyData(this.freq);
    let s = 0;
    for (let i = 1; i < 7; i++) s += this.freq[i];
    return s / (6 * 255);
  }

  // ------------- SFX -------------

  whoosh(strength = 1) {
    const c = this.ctx, t = c.currentTime;
    const n = this.noiseSource();
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(5000 + 3000 * strength, t + 0.35);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.7 * strength, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
    n.connect(bp).connect(g).connect(this.sfx);
    n.start(t);
    n.stop(t + 0.6);

    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(440 * (1 + strength), t + 0.3);
    const og = c.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.12 * strength, t + 0.03);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    const lp = c.createBiquadFilter();
    lp.frequency.value = 2500;
    o.connect(lp).connect(og).connect(this.sfx);
    o.start(t);
    o.stop(t + 0.4);
  }

  // Bell tuned to a MIDI note so gate pickups play along with the harmony. `when` is an
  // audio-clock time; pickups pass their ring's beat so the bell lands on the drum hit.
  chime(midi, vol = 0.35, when = 0) {
    const c = this.ctx, t = Math.max(c.currentTime, when);
    const f = 440 * Math.pow(2, (midi - 69) / 12);
    [1, 2.01, 3.98].forEach((m, i) => {
      const o = c.createOscillator();
      o.type = i === 0 ? 'triangle' : 'sine';
      o.frequency.value = f * m;
      const g = c.createGain();
      const v = vol / (1 + i * 1.6);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(v, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0008, t + 0.5 - i * 0.12);
      o.connect(g).connect(this.sfx);
      o.start(t);
      o.stop(t + 0.55);
    });
  }

  crash() {
    const c = this.ctx, t = c.currentTime;
    const n = this.noiseSource();
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(3000, t);
    lp.frequency.exponentialRampToValueAtTime(120, t + 0.5);
    const g = c.createGain();
    g.gain.setValueAtTime(1.0, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    n.connect(lp).connect(g).connect(this.sfx);
    n.start(t);
    n.stop(t + 0.65);

    const o = c.createOscillator();
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(30, t + 0.5);
    const og = c.createGain();
    og.gain.setValueAtTime(0.9, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
    o.connect(og).connect(this.sfx);
    o.start(t);
    o.stop(t + 0.6);
    this.slam();
  }

  // Deep boom for breaking the "sound barrier" and other tier jumps.
  boom(big = false, when = 0) {
    const c = this.ctx, t = Math.max(c.currentTime, when);
    const o = c.createOscillator();
    o.frequency.setValueAtTime(big ? 70 : 110, t);
    o.frequency.exponentialRampToValueAtTime(big ? 22 : 35, t + (big ? 1.6 : 0.9));
    const g = c.createGain();
    g.gain.setValueAtTime(1.1, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + (big ? 1.8 : 1.0));
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + 2);

    const n = this.noiseSource();
    const lp = c.createBiquadFilter();
    lp.frequency.setValueAtTime(big ? 9000 : 4000, t);
    lp.frequency.exponentialRampToValueAtTime(80, t + 1.2);
    const ng = c.createGain();
    ng.gain.setValueAtTime(0.8, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 1.3);
    n.connect(lp).connect(ng).connect(this.sfx);
    n.start(t);
    n.stop(t + 1.4);
  }

  // Low, slow swell under the black hole shot of the level intro.
  drone(dur) {
    const c = this.ctx, t = c.currentTime;
    [[41, 0], [41.3, 7], [61.7, -5]].forEach(([f, det]) => {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = det;
      const lp = c.createBiquadFilter();
      lp.frequency.setValueAtTime(140, t);
      lp.frequency.exponentialRampToValueAtTime(700, t + dur * 0.7);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.09, t + dur * 0.55);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(lp).connect(g).connect(this.sfx);
      o.start(t);
      o.stop(t + dur + 0.05);
    });
  }

  // Reverse-swell into time warp.
  warpSwell() {
    const c = this.ctx, t = c.currentTime;
    for (let i = 0; i < 3; i++) {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(55 * (i + 1), t);
      o.frequency.exponentialRampToValueAtTime(55 * (i + 1) * 8, t + 1.1);
      o.detune.value = (i - 1) * 14;
      const lp = c.createBiquadFilter();
      lp.frequency.setValueAtTime(200, t);
      lp.frequency.exponentialRampToValueAtTime(9000, t + 1.1);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 1.0);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.25);
      o.connect(lp).connect(g).connect(this.sfx);
      o.start(t);
      o.stop(t + 1.3);
    }
  }
}
