// Plays a user-supplied song and works out its tempo + beat phase so the
// whole game (spawns, pulses, boost judging) locks to it.

export class CustomTrack {
  constructor(engine, buffer, analysis, name) {
    this.engine = engine;
    this.ctx = engine.ctx;
    this.buffer = buffer;
    this.bpm = analysis.bpm;
    this.spb = 60 / analysis.bpm;
    this.offset = analysis.offset;
    this.intensity = analysis.intensity;
    this.accents = analysis.accents;
    // drops need room for a build-up before them
    this.drops = analysis.drops.filter((b) => b >= 24);
    this.durationBeats = Math.floor((buffer.duration - this.offset) / this.spb) - 1;
    this.name = name;
  }

  static async load(engine, file, onStatus = () => {}) {
    onStatus('decoding…');
    const data = await file.arrayBuffer();
    const buffer = await engine.ctx.decodeAudioData(data);
    onStatus('finding the beat…');
    await new Promise((r) => setTimeout(r, 30)); // let the status paint
    const analysis = analyzeBeats(buffer);
    const name = file.name.replace(/\.[^.]+$/, '');
    return new CustomTrack(engine, buffer, analysis, name);
  }

  start() {
    const src = (this.src = this.ctx.createBufferSource());
    src.buffer = this.buffer;
    src.connect(this.engine.music);
    this.startTime = this.ctx.currentTime + 0.15;
    src.start(this.startTime);
  }

  stop() {
    try {
      this.src && this.src.stop();
    } catch (e) {
      /* already stopped */
    }
  }

  beatAt(t) {
    return (t - this.startTime - this.offset) / this.spb;
  }

  intensityAt(beat) {
    const i = Math.max(0, Math.min(this.intensity.length - 1, Math.floor(beat)));
    return this.intensity[i] ?? 0.5;
  }

  timeOfBeat(b) {
    return this.startTime + this.offset + b * this.spb;
  }

  // Rings go on every beat the song actually hits, plus strong off-beat hits (syncopation).
  hits(b) {
    const on = this.accents[b * 2] ?? 0.5;
    const off = this.accents[b * 2 + 1] ?? 0;
    const out = [[0, 0.35 + 0.65 * on]];
    if (off > 0.55) out.push([0.5, off]);
    return out;
  }

  setLayer() {}

  // Without harmonic info, chimes walk an A-minor pentatonic.
  chordTone(beat, i) {
    const pent = [69, 72, 74, 76, 79];
    return pent[i % 5] + 12 * Math.floor(i / 5);
  }
}

// ---------------------------------------------------------------------------
// Beat analysis: onset envelope -> comb-filter tempo search -> phase -> refine.

export function analyzeBeats(buffer) {
  const sr = buffer.sampleRate;
  const a = buffer.getChannelData(0);
  const b = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : a;
  const hop = 512;
  const frames = Math.floor(a.length / hop);
  const fps = sr / hop;

  // Frame energies: full band + a one-pole lowpassed "kick" band.
  const full = new Float32Array(frames);
  const low = new Float32Array(frames);
  const fullP = new Float32Array(frames); // mean power per frame, for drop detection
  const lowP = new Float32Array(frames);
  const k = Math.exp((-2 * Math.PI * 160) / sr);
  let lp = 0;
  for (let f = 0, i = 0; f < frames; f++) {
    let e = 0, el = 0;
    for (let j = 0; j < hop; j++, i++) {
      const s = (a[i] + b[i]) * 0.5;
      lp = k * lp + (1 - k) * s;
      e += s * s;
      el += lp * lp;
    }
    full[f] = Math.log1p(1000 * e / hop);
    low[f] = Math.log1p(4000 * el / hop);
    fullP[f] = e / hop;
    lowP[f] = el / hop;
  }

  // Half-wave rectified flux, minus a moving average so sustained loudness doesn't count.
  const onset = new Float32Array(frames);
  for (let f = 1; f < frames; f++) {
    onset[f] = Math.max(0, low[f] - low[f - 1]) + 0.5 * Math.max(0, full[f] - full[f - 1]);
  }
  const win = Math.round(fps * 0.4);
  const clean = new Float32Array(frames);
  let acc = 0;
  for (let f = 0; f < frames; f++) {
    acc += onset[f];
    if (f >= win) acc -= onset[f - win];
    const mean = acc / Math.min(f + 1, win);
    clean[f] = Math.max(0, onset[f] - mean);
  }

  const sample = (x) => {
    const i = Math.floor(x);
    if (i < 0 || i + 1 >= frames) return 0;
    const t = x - i;
    return clean[i] * (1 - t) + clean[i + 1] * t;
  };

  // Mean onset strength along a beat grid, best phase.
  const comb = (bpm, phaseStep) => {
    const P = (fps * 60) / bpm;
    let best = 0, bestPhase = 0;
    for (let ph = 0; ph < P; ph += phaseStep) {
      let s = 0, n = 0;
      for (let x = ph; x < frames; x += P) {
        s += sample(x);
        n++;
      }
      s /= n || 1;
      if (s > best) {
        best = s;
        bestPhase = ph;
      }
    }
    return { score: best, phase: bestPhase };
  };

  // Gentle prior towards typical dance tempos to break octave ties.
  const prior = (bpm) => Math.exp(-0.5 * Math.pow(Math.log2(bpm / 140) / 0.9, 2));

  let best = { bpm: 140, score: -1, phase: 0 };
  for (let bpm = 80; bpm <= 190; bpm += 0.5) {
    const r = comb(bpm, 1);
    const sc = r.score * prior(bpm);
    if (sc > best.score) best = { bpm, score: sc, phase: r.phase };
  }
  // Refine
  const coarse = best.bpm;
  for (let bpm = coarse - 0.6; bpm <= coarse + 0.6; bpm += 0.02) {
    const r = comb(bpm, 0.25);
    const sc = r.score * prior(bpm);
    if (sc > best.score) best = { bpm, score: sc, phase: r.phase };
  }

  const spb = 60 / best.bpm;
  const offset = (best.phase * hop) / sr;

  // Per-beat loudness normalised to 0..1 (p10 -> 0, p95 -> 1), lightly smoothed.
  const beats = Math.floor((buffer.duration - offset) / spb);
  const raw = new Float32Array(Math.max(1, beats));
  for (let i = 0; i < beats; i++) {
    const f0 = Math.floor(((offset + i * spb) * sr) / hop);
    const f1 = Math.floor(((offset + (i + 1) * spb) * sr) / hop);
    let s = 0;
    for (let f = f0; f < f1 && f < frames; f++) s += full[f];
    raw[i] = s / Math.max(1, f1 - f0);
  }
  const sorted = Array.from(raw).sort((x, y) => x - y);
  const p10 = sorted[Math.floor(sorted.length * 0.1)] ?? 0;
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 1;
  const intensity = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    let s = 0, n = 0;
    for (let j = i - 2; j <= i + 2; j++) if (j >= 0 && j < raw.length) { s += raw[j]; n++; }
    intensity[i] = Math.max(0, Math.min(1, (s / n - p10) / Math.max(1e-6, p95 - p10)));
  }

  // Onset strength on every half beat (0..1 against the song's own p90), so rings can sit on
  // the hits the listener hears rather than on an even grid.
  const halves = beats * 2;
  const accRaw = new Float32Array(Math.max(1, halves));
  const reach = Math.round(fps * 0.035);
  for (let i = 0; i < halves; i++) {
    const c = Math.round(((offset + (i * spb) / 2) * sr) / hop);
    let m = 0;
    for (let f = c - reach; f <= c + reach; f++) if (f >= 0 && f < frames) m = Math.max(m, clean[f]);
    accRaw[i] = m;
  }
  const accSorted = Array.from(accRaw).sort((x, y) => x - y);
  const p90 = accSorted[Math.floor(accSorted.length * 0.9)] || 1;
  const accents = accRaw.map((x) => Math.min(1, x / p90));

  // Per-beat level in dB (whole mix and the bass band) for finding drops.
  const loudDb = new Float32Array(Math.max(1, beats));
  const bassDb = new Float32Array(Math.max(1, beats));
  for (let i = 0; i < beats; i++) {
    const f0 = Math.floor(((offset + i * spb) * sr) / hop);
    const f1 = Math.floor(((offset + (i + 1) * spb) * sr) / hop);
    let s = 0, sl = 0, n = 0;
    for (let f = f0; f < f1 && f < frames; f++, n++) {
      s += fullP[f];
      sl += lowP[f];
    }
    loudDb[i] = 10 * Math.log10(s / Math.max(1, n) + 1e-12);
    bassDb[i] = 10 * Math.log10(sl / Math.max(1, n) + 1e-12);
  }
  const drops = findDrops(loudDb, bassDb);

  return { bpm: best.bpm, offset, intensity, accents, drops, loudDb, bassDb };
}

// Drop detection. A drop is where the next 8 beats are `rise` dB louder than the 8 before,
// the jump happens within a beat or two rather than as a slow crescendo, it holds (a one-bar
// tease that cuts out again doesn't count), and what follows is one of the louder parts of
// the song. Loudness mixes the whole song with the bass band, weighted towards bass: in a
// loud modern master the build-up (snare rolls, vocals, risers) is nearly as loud overall as
// the drop, and the bass coming in is what really changes.
export const DROP_DEFAULTS = {
  rise: 4.5, // dB, next 8 beats vs the 8 before
  sharp: 4, // dB, 2 beats after vs 2 before
  hold: 0.6, // each of the next two bars keeps this share of `rise`
  bassWeight: 0.8,
  gap: 32, // beats between drops, at least
};

// `o` is only for tuning sweeps (scripts/drop-test.mjs --sweep); the game uses the defaults.
export function findDrops(loudDb, bassDb, o = DROP_DEFAULTS) {
  const n = loudDb.length;
  const mean = (a, i0, i1) => {
    let s = 0, c = 0;
    for (let i = Math.max(0, i0); i < Math.min(n, i1); i++, c++) s += a[i];
    return c ? s / c : 0;
  };
  const lv = Array.from(loudDb, (l, i) => (1 - o.bassWeight) * l + o.bassWeight * bassDb[i]);
  const level = (i0, i1) => mean(lv, i0, i1);
  // Windows after a candidate use their 25th percentile: most of the window has to be up, but
  // a one-beat stop inside the drop ("drop, stop, go") can't drag it down, while a one-bar
  // fake-out can't carry it. The window before uses the mean: a gap just before the drop is
  // part of the contrast.
  const mostly = (a, i0, i1) => {
    const w = Array.from(a.slice(Math.max(0, i0), Math.min(n, i1))).sort((x, y) => x - y);
    return w.length ? w[Math.floor(w.length * 0.25)] : 0;
  };
  const sharpAt = (b) => level(b, b + 2) - level(b - 2, b);
  const sorted = Array.from(loudDb).sort((x, y) => x - y);
  const loudish = sorted[Math.floor(n * 0.5)] ?? 0;

  const cands = [];
  for (let b = 8; b < n - 12; b++) {
    const before = level(b - 8, b);
    const rise = mostly(lv, b, b + 8) - before;
    const sharp = sharpAt(b);
    // still up in each of the next two bars, not just on average
    const holds = Math.min(mostly(lv, b + 4, b + 8), mostly(lv, b + 8, b + 12)) - before >= o.rise * o.hold;
    if (rise >= o.rise && sharp >= o.sharp && holds && mostly(loudDb, b, b + 8) >= loudish) cands.push({ b, score: rise + sharp });
  }
  // strongest first, then keep the ones not too close to a stronger drop
  cands.sort((x, y) => y.score - x.score);
  const drops = [];
  for (const c of cands) if (drops.every((d) => Math.abs(d - c.b) >= o.gap)) drops.push(c.b);
  // The 8-beat windows blur where the drop starts by a beat or so: put each one on the beat
  // where the level jumps hardest.
  return drops
    .map((d) => {
      let best = d;
      for (let b = Math.max(2, d - 2); b <= Math.min(n - 2, d + 2); b++) if (sharpAt(b) > sharpAt(best)) best = b;
      return best;
    })
    .sort((x, y) => x - y);
}
