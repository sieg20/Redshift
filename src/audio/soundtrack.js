// Procedural 174 BPM drum & bass soundtrack. Layers stack up with the speed tier,
// always switching on a bar line so the music never stumbles.
//
// Layer 0 CRUISE      kick, hats, sub, pad
// Layer 1 BLUR        + snare, reese bass
// Layer 2 MIRAGE      + arpeggio, rolls into every 4th bar
// Layer 3 SONIC       + lead melody, 16th hats, ghost snares
// Layer 4 WARP        + lead up an octave, crash every 2 bars, extra kicks
// Layer 5 SINGULARITY + everything, double arps, constant crashes
//
// Every 32 bars there's a drop: 4 bars of breakdown (drums and bass out, then a snare
// build and a riser), and the 8 bars after it play one layer above your tier.

const BPM = 174;
const DROP_BARS = [32, 64, 96];
const BREAKDOWN_BARS = 4;
const SURGE_BARS = 8;
const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

// A minor: Am - F - C - G
const CHORDS = [
  { root: 33, pad: [57, 60, 64], tones: [57, 60, 64, 69] },
  { root: 29, pad: [53, 57, 60], tones: [53, 57, 60, 65] },
  { root: 36, pad: [55, 60, 64], tones: [55, 60, 64, 67] },
  { root: 31, pad: [55, 59, 62], tones: [55, 59, 62, 67] },
];

// Lead phrase, one row per chord, 16 steps each. null = hold / rest.
const LEAD = [
  [81, null, null, 76, null, null, 81, null, 84, null, 83, null, 81, null, 79, null],
  [77, null, null, 81, null, null, 84, null, null, null, 81, null, 79, null, 76, null],
  [76, null, null, 79, null, null, 84, null, 88, null, 86, null, 84, null, 83, null],
  [86, null, null, 83, null, null, 79, null, null, null, 81, null, 83, null, 86, null],
];

// [step, lengthInSteps, semitoneOffset]
const BASS = [
  [0, 3, 0],
  [3, 2, 0],
  [6, 2, 12],
  [10, 3, 0],
  [13, 1, 7],
  [14, 2, 12],
];

export class Soundtrack {
  constructor(engine) {
    this.engine = engine;
    this.ctx = engine.ctx;
    this.bpm = BPM;
    this.spb = 60 / BPM;
    this.stepDur = this.spb / 4;
    this.layer = 0;
    this.targetLayer = 0;
    this.durationBeats = 128 * 4; // ~2:56 run
    this.name = 'REDSHIFT OST — 174 BPM';
    this.drops = DROP_BARS.map((b) => b * 4);
    this._buildBuses();
  }

  _buildBuses() {
    const c = this.ctx;
    const out = this.engine.music;

    this.drums = c.createGain();
    this.drums.gain.value = 0.9;
    this.drums.connect(out);

    // Bass + pad get side-chained (ducked) by the kick for that pumping feel.
    this.duck = c.createGain();
    this.duck.connect(out);
    this.bassBus = c.createGain();
    this.bassBus.gain.value = 0.55;
    this.bassBus.connect(this.duck);
    this.padBus = c.createGain();
    this.padBus.gain.value = 0.16;
    this.padBus.connect(this.duck);

    this.leadBus = c.createGain();
    this.leadBus.gain.value = 0.16;
    this.leadBus.connect(out);
    this.arpBus = c.createGain();
    this.arpBus.gain.value = 0.1;
    this.arpBus.connect(out);

    // Dotted-8th delay for lead + arp
    this.delay = c.createDelay(2);
    this.delay.delayTime.value = this.stepDur * 3;
    const fb = c.createGain();
    fb.gain.value = 0.38;
    const dlp = c.createBiquadFilter();
    dlp.frequency.value = 3200;
    this.delay.connect(dlp).connect(fb).connect(this.delay);
    const wet = c.createGain();
    wet.gain.value = 0.35;
    dlp.connect(wet).connect(out);
    this.leadBus.connect(this.delay);
    this.arpBus.connect(this.delay);

    // Small generated reverb
    this.verb = c.createConvolver();
    const len = c.sampleRate * 2.2;
    const ir = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    this.verb.buffer = ir;
    this.verbSend = c.createGain();
    this.verbSend.gain.value = 0.25;
    this.verbSend.connect(this.verb).connect(out);
    this.padBus.connect(this.verbSend);
    this.leadBus.connect(this.verbSend);

    this.shaper = c.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = (i / 1023) * 2 - 1;
      curve[i] = Math.tanh(x * 3.2);
    }
    this.shaper.curve = curve;
    this.shaper.connect(this.bassBus);
  }

  start() {
    this.startTime = this.ctx.currentTime + 0.15;
    this.step = 0;
    this.nextTime = this.startTime;
    this.layer = this.targetLayer;
    this.timer = setInterval(() => this._schedule(), 25);
    this._schedule();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    const t = this.ctx.currentTime;
    this.engine.music.gain.setTargetAtTime(0, t, 0.08);
    setTimeout(() => this.engine.music.gain.setValueAtTime(1, this.ctx.currentTime), 600);
  }

  beatAt(t) {
    return (t - this.startTime) / this.spb;
  }

  // Audio-clock time of a beat, for scheduling sounds exactly on it.
  timeOfBeat(b) {
    return this.startTime + b * this.spb;
  }

  // Where the drums hit inside beat b, as [offset in beats, weight]. Mirrors _playStep:
  // kick on steps 0 and 10, snare on 4 and 12, extra kick on 7 from WARP, roll in fill bars.
  hits(b) {
    const L = this.targetLayer;
    const inBar = ((b % 4) + 4) % 4;
    const fill = Math.floor(b / 4) % 4 === 3;
    if (inBar === 0) return [[0, 1]];
    if (inBar === 1) return L >= 4 && !fill ? [[0, 0.9], [0.75, 0.5]] : [[0, L >= 1 ? 0.9 : 0.5]];
    if (inBar === 2) return [[0.5, 1]];
    return fill && L >= 2 ? [[0, 0.9], [0.5, 0.8]] : [[0, L >= 1 ? 0.9 : 0.5]];
  }

  intensityAt() {
    return 0.5 + 0.1 * this.layer;
  }

  setLayer(n) {
    this.targetLayer = Math.max(0, Math.min(5, n));
  }

  // MIDI note of the current chord, used to tune pickup chimes.
  chordTone(beat, i) {
    const bar = Math.floor(Math.max(0, beat) / 4);
    const ch = CHORDS[bar % 4];
    return ch.tones[i % ch.tones.length] + 12 * Math.floor(i / ch.tones.length);
  }

  _schedule() {
    const ahead = this.ctx.currentTime + 0.12;
    while (this.nextTime < ahead) {
      this._playStep(this.step, this.nextTime);
      this.step++;
      this.nextTime = this.startTime + this.step * this.stepDur;
    }
  }

  _playStep(n, t) {
    const s = n % 16;
    const bar = Math.floor(n / 16);
    if (s === 0) {
      if (this.targetLayer > this.layer) this.crash(t, 0.55);
      this.layer = this.targetLayer;
    }
    const chord = CHORDS[bar % 4];
    const fillBar = bar % 4 === 3;
    const toDrop = DROP_BARS.map((d) => d - bar).find((k) => k > 0 && k <= BREAKDOWN_BARS);
    const surge = DROP_BARS.some((d) => bar >= d && bar < d + SURGE_BARS);
    const L = Math.min(5, this.layer + (surge ? 1 : 0));

    if (toDrop) {
      this._breakdownStep(s, n, t, toDrop, chord, L);
      return;
    }
    if (s === 0 && DROP_BARS.includes(bar)) this.crash(t, 0.9);

    // ---- drums ----
    if (s === 0 || s === 10 || (L >= 4 && s === 7 && !fillBar)) this.kick(t);
    if (L >= 1) {
      if (s === 4 || s === 12) this.snare(t, 1);
      if (L >= 3 && (s === 7 || s === 15) && !(fillBar && s === 15)) this.snare(t, 0.22);
      if (L >= 2 && fillBar && s >= 12) this.snare(t, 0.25 + (s - 12) * 0.2);
    }
    if (s % 2 === 0) this.hat(t, s % 4 === 2 ? 0.5 : 0.28, L >= 2 && s % 4 === 2);
    else if (L >= 3) this.hat(t, 0.14, false);
    if (L >= 4 && s === 0 && (bar % 2 === 0 || L >= 5)) this.crash(t, 0.35);

    // ---- bass ----
    if (s === 0) this.sub(t, chord.root, this.stepDur * 9.5);
    if (s === 10) this.sub(t, chord.root, this.stepDur * 5.5);
    if (L >= 1) {
      for (const [st, len, off] of BASS) if (st === s) this.reese(t, chord.root + 12 + off, this.stepDur * len);
    }

    // ---- pad ----
    if (s === 0) this.pad(t, chord.pad, this.stepDur * 16);

    // ---- arp ----
    if (L >= 2) {
      const tones = chord.tones;
      const idx = [0, 1, 2, 3, 2, 1][(n % 6)];
      const oct = L >= 5 && s % 2 === 1 ? 24 : 12;
      if (L >= 5 || s % 2 === 0 || L >= 3) this.arp(t, tones[idx] + oct, (n % 2) * 2 - 1);
    }

    // ---- lead ----
    if (L >= 3) {
      const row = LEAD[bar % 4];
      const note = row[s];
      if (note != null) {
        let len = 1;
        while (s + len < 16 && row[s + len] == null) len++;
        this.lead(t, note + (L >= 4 ? 12 : 0) - 12, this.stepDur * len * 0.92);
      }
    }
  }

  // Breakdown into a drop. toDrop = bars left (4..1). Pad and arp carry on, the drums
  // drop out, then a snare build speeds up from quarters to 16ths over the last two bars.
  _breakdownStep(s, n, t, toDrop, chord, L) {
    if (s === 0) this.pad(t, chord.pad, this.stepDur * 16);
    if (s === 0 && toDrop === BREAKDOWN_BARS) this.riser(t, this.stepDur * 16 * BREAKDOWN_BARS);
    if (L >= 2 && s % 2 === 0) this.arp(t, chord.tones[(n / 2) % 4] + 12, n % 4 < 2 ? -1 : 1);
    if (toDrop <= 2) {
      const every = toDrop === 2 ? 4 : s < 8 ? 2 : 1;
      const p = 1 - (toDrop - 1 + (16 - s) / 16) / 2; // 0..1 across the last two bars
      if (s % every === 0) this.snare(t, 0.2 + p * 0.6);
    } else if (s % 4 === 2) this.hat(t, 0.25, toDrop === 3);
  }

  // Rising noise sweep plus a climbing saw: the "here it comes" of a build-up.
  riser(t, dur) {
    const c = this.ctx;
    const n = this.engine.noiseSource();
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.5;
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(9000, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + dur);
    g.gain.setValueAtTime(0.0001, t + dur + 0.01);
    n.connect(bp).connect(g).connect(this.drums);
    g.connect(this.verbSend);
    n.start(t);
    n.stop(t + dur + 0.05);

    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(880, t + dur);
    const lp = c.createBiquadFilter();
    lp.frequency.setValueAtTime(400, t);
    lp.frequency.exponentialRampToValueAtTime(6000, t + dur);
    const og = c.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.06, t + dur);
    og.gain.setValueAtTime(0.0001, t + dur + 0.01);
    o.connect(lp).connect(og).connect(this.leadBus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  // ---------------- instruments ----------------

  kick(t) {
    const c = this.ctx;
    const o = c.createOscillator();
    const g = c.createGain();
    o.frequency.setValueAtTime(170, t);
    o.frequency.exponentialRampToValueAtTime(52, t + 0.07);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.35);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(1.0, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
    o.connect(g).connect(this.drums);
    o.start(t);
    o.stop(t + 0.4);

    const n = this.engine.noiseSource();
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2500;
    const ng = c.createGain();
    ng.gain.setValueAtTime(0.35, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.015);
    n.connect(hp).connect(ng).connect(this.drums);
    n.start(t);
    n.stop(t + 0.02);

    // sidechain duck
    const d = this.duck.gain;
    d.cancelScheduledValues(t);
    d.setValueAtTime(0.25, t);
    d.linearRampToValueAtTime(1, t + 0.16);
  }

  snare(t, vol) {
    const c = this.ctx;
    const n = this.engine.noiseSource();
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1900;
    bp.Q.value = 0.7;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.75 * vol, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.17);
    n.connect(bp).connect(g).connect(this.drums);
    if (vol > 0.5) g.connect(this.verbSend);
    n.start(t);
    n.stop(t + 0.2);

    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(150, t + 0.08);
    const og = c.createGain();
    og.gain.setValueAtTime(0.6 * vol, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    o.connect(og).connect(this.drums);
    o.start(t);
    o.stop(t + 0.12);
  }

  hat(t, vol, open) {
    const c = this.ctx;
    const n = this.engine.noiseSource();
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7500;
    const g = c.createGain();
    const dur = open ? 0.22 : 0.04;
    g.gain.setValueAtTime(0.32 * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    n.connect(hp).connect(g).connect(this.drums);
    n.start(t);
    n.stop(t + dur + 0.01);
  }

  crash(t, vol) {
    const c = this.ctx;
    const n = this.engine.noiseSource();
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 4200;
    const g = c.createGain();
    g.gain.setValueAtTime(0.4 * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.8);
    n.connect(hp).connect(g).connect(this.drums);
    g.connect(this.verbSend);
    n.start(t);
    n.stop(t + 1.9);
  }

  sub(t, midi, dur) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.frequency.value = midiHz(midi);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.8, t + 0.01);
    g.gain.setValueAtTime(0.8, t + dur - 0.05);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.bassBus);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  reese(t, midi, dur) {
    const c = this.ctx;
    const f = midiHz(midi);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 5;
    lp.frequency.setValueAtTime(260, t);
    lp.frequency.exponentialRampToValueAtTime(1600 + this.layer * 300, t + 0.04);
    lp.frequency.exponentialRampToValueAtTime(380, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.008);
    g.gain.setValueAtTime(0.35, t + dur - 0.03);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    lp.connect(g).connect(this.shaper);
    for (const det of [-14, 14]) {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = det;
      o.connect(lp);
      o.start(t);
      o.stop(t + dur + 0.02);
    }
  }

  pad(t, notes, dur) {
    const c = this.ctx;
    const lp = c.createBiquadFilter();
    lp.frequency.value = 700 + this.layer * 250;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.35);
    g.gain.setValueAtTime(0.5, t + dur - 0.25);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur + 0.2);
    lp.connect(g).connect(this.padBus);
    for (const m of notes) {
      for (const det of [-9, 9]) {
        const o = c.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = midiHz(m);
        o.detune.value = det;
        o.connect(lp);
        o.start(t);
        o.stop(t + dur + 0.25);
      }
    }
  }

  arp(t, midi, pan) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'square';
    o.frequency.value = midiHz(midi);
    const lp = c.createBiquadFilter();
    lp.frequency.setValueAtTime(4500, t);
    lp.frequency.exponentialRampToValueAtTime(900, t + 0.1);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
    const p = c.createStereoPanner();
    p.pan.value = pan * 0.5;
    o.connect(lp).connect(g).connect(p).connect(this.arpBus);
    o.start(t);
    o.stop(t + 0.13);
  }

  lead(t, midi, dur) {
    const c = this.ctx;
    const f = midiHz(midi);
    const lp = c.createBiquadFilter();
    lp.Q.value = 2;
    lp.frequency.setValueAtTime(1200, t);
    lp.frequency.exponentialRampToValueAtTime(5200, t + 0.03);
    lp.frequency.exponentialRampToValueAtTime(2200, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.01);
    g.gain.setValueAtTime(0.45, t + Math.max(0.02, dur - 0.04));
    g.gain.exponentialRampToValueAtTime(0.001, t + dur + 0.06);
    lp.connect(g).connect(this.leadBus);

    const lfo = c.createOscillator();
    lfo.frequency.value = 6;
    const lfoG = c.createGain();
    lfoG.gain.value = 0;
    lfoG.gain.setValueAtTime(0, t);
    lfoG.gain.linearRampToValueAtTime(18, t + Math.max(0.05, dur));
    lfo.connect(lfoG);
    lfo.start(t);
    lfo.stop(t + dur + 0.1);

    [['sawtooth', -7], ['sawtooth', 7], ['square', 1200]].forEach(([type, det]) => {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.detune.value = det;
      lfoG.connect(o.detune);
      o.connect(lp);
      o.start(t);
      o.stop(t + dur + 0.1);
    });
  }
}
