// Drop-detection test. Checks the detector against two sets of songs:
//
//  - synthetic songs built here from bars of simple instruments (kick, sub bass, hats, snare,
//    pad, riser), so every drop position is known to the beat
//  - real songs in scripts/drop-corpus/, labelled with tools/drops.html (beat levels and the
//    true drop beats only, no audio)
//
//   npm run test:drops               check the current settings
//   npm run test:drops -- --sweep    try a grid of settings and show how much margin there is

import fs from 'node:fs';
import { analyzeBeats, findDrops, DROP_DEFAULTS } from '../src/audio/customTrack.js';

const SR = 22050;

// Deterministic noise so results don't change from run to run.
let seed = 1;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;

class Song {
  constructor(bpm, bars, lead = 0.5) {
    this.bpm = bpm;
    this.spb = 60 / bpm;
    this.lead = lead; // silence before beat 0
    this.data = new Float32Array(Math.ceil((lead + bars * 4 * this.spb + 2) * SR));
    this.gain = 1;
  }
  t(beat) {
    return this.lead + beat * this.spb;
  }
  add(t0, len, fn) {
    const s0 = Math.floor(t0 * SR);
    const n = Math.floor(len * SR);
    for (let i = 0; i < n && s0 + i < this.data.length; i++) this.data[s0 + i] += fn(i / SR, i / n) * this.gain;
  }
  kick(beat, amp) {
    this.add(this.t(beat), 0.25, (t) => amp * Math.sin(2 * Math.PI * (45 * t + 60 * (1 - Math.exp(-t * 30)) / 30)) * Math.exp(-t * 14));
  }
  bass(beat, beats, amp, hz = 55) {
    this.add(this.t(beat), beats * this.spb, (t, p) => amp * Math.tanh(2 * Math.sin(2 * Math.PI * hz * t)) * Math.min(1, p * 40, (1 - p) * 40));
  }
  hat(beat, amp) {
    let y = 0, prev = 0;
    this.add(this.t(beat), 0.05, (t) => {
      const x = rand();
      y = 0.6 * (y + x - prev); // crude high-pass
      prev = x;
      return amp * y * Math.exp(-t * 60);
    });
  }
  snare(beat, amp) {
    this.add(this.t(beat), 0.18, (t) => amp * (rand() * 0.8 + 0.4 * Math.sin(2 * Math.PI * 190 * t)) * Math.exp(-t * 22));
  }
  pad(beat, beats, amp) {
    this.add(this.t(beat), beats * this.spb, (t, p) =>
      amp * (Math.sin(2 * Math.PI * 220 * t) + Math.sin(2 * Math.PI * 261.6 * t) + Math.sin(2 * Math.PI * 329.6 * t)) / 3 * Math.min(1, p * 8, (1 - p) * 8)
    );
  }
  // rising noise sweep over a build-up: loud, but no bass
  riser(beat, beats, amp) {
    let y = 0, prev = 0;
    this.add(this.t(beat), beats * this.spb, (t, p) => {
      const x = rand();
      y = 0.8 * (y + x - prev);
      prev = x;
      return amp * p * p * y;
    });
  }
  buffer() {
    const d = this.data;
    return { sampleRate: SR, numberOfChannels: 1, duration: d.length / SR, length: d.length, getChannelData: () => d };
  }
}

// Section builders: each writes `bars` bars starting at `bar`.
const S = {
  groove(s, bar, bars, { kick = 0.7, bass = 0.4, hats = 0.15, snare = 0 } = {}) {
    for (let b = bar * 4; b < (bar + bars) * 4; b++) {
      if (kick) s.kick(b, kick);
      if (bass) s.bass(b, 1, bass);
      if (hats) s.hat(b + 0.5, hats);
      if (snare && b % 2 === 1) s.snare(b, snare);
    }
  },
  dnb(s, bar, bars, { bass = 0 } = {}) {
    for (let b = bar * 4; b < (bar + bars) * 4; b += 4) {
      s.kick(b, 0.7);
      s.kick(b + 2.5, 0.7);
      s.snare(b + 1, 0.5);
      s.snare(b + 3, 0.5);
      for (let h = 0; h < 8; h++) s.hat(b + h * 0.5, 0.12);
      if (bass) s.bass(b, 4, bass, 49);
    }
  },
  breakdown(s, bar, bars, amp = 0.15) {
    s.pad(bar * 4, bars * 4, amp);
  },
  build(s, bar, bars, { riser = 0.25 } = {}) {
    const n = bars * 4;
    for (let i = 0; i < n * 2; i++) {
      const p = i / (n * 2);
      if (i % Math.max(1, Math.round(4 - p * 3)) === 0) s.snare(bar * 4 + i * 0.5, 0.15 + p * 0.35);
    }
    if (riser) s.riser(bar * 4, n, riser);
    s.pad(bar * 4, n, 0.1);
  },
  drop(s, bar, bars) {
    S.groove(s, bar, bars, { kick: 1.0, bass: 0.8, hats: 0.25, snare: 0.4 });
    s.pad(bar * 4, bars * 4, 0.12);
  },
};

// Each case: song + the beats where drops really are (empty = there shouldn't be any).
const CASES = [
  {
    name: 'EDM, two drops (128 BPM)',
    make() {
      const s = new Song(128, 92);
      S.groove(s, 0, 16);
      S.breakdown(s, 16, 8);
      S.build(s, 24, 8);
      S.drop(s, 32, 16);
      S.breakdown(s, 48, 8);
      S.build(s, 56, 4);
      S.drop(s, 60, 16);
      S.groove(s, 76, 16, { kick: 0.5, bass: 0.3 });
      return { s, drops: [128, 240] };
    },
  },
  {
    name: 'Dubstep-style, loud riser then drop (140 BPM)',
    make() {
      const s = new Song(140, 48);
      S.breakdown(s, 0, 16, 0.2);
      for (let b = 0; b < 64; b += 2) s.hat(b, 0.1);
      S.build(s, 16, 8, { riser: 0.6 });
      for (let bar = 24; bar < 48; bar++) {
        const b = bar * 4;
        s.kick(b, 1);
        s.snare(b + 2, 0.6);
        s.bass(b, 4, 0.9, 41);
        s.hat(b + 1, 0.2);
        s.hat(b + 3, 0.2);
      }
      return { s, drops: [96] };
    },
  },
  {
    name: 'Drum & bass, drums-only intro (174 BPM)',
    make() {
      const s = new Song(174, 72);
      S.dnb(s, 0, 16);
      S.dnb(s, 16, 16, { bass: 0.8 });
      S.breakdown(s, 32, 8);
      S.build(s, 40, 8);
      S.dnb(s, 48, 24, { bass: 0.8 });
      return { s, drops: [64, 192] };
    },
  },
  {
    name: 'Hip-hop, 8th-note hats, must stay at 88 BPM',
    make() {
      const s = new Song(88, 40);
      for (let bar = 0; bar < 40; bar++) {
        const b = bar * 4;
        s.kick(b, 0.8);
        s.kick(b + 2.5, 0.6);
        s.snare(b + 1, 0.6);
        s.snare(b + 3, 0.6);
        for (let h = 0; h < 8; h++) s.hat(b + h * 0.5, 0.15);
        if (bar >= 16) s.bass(b, 4, 0.7, 44);
      }
      return { s, drops: [64] };
    },
  },
  {
    name: 'Sudden lift, no breakdown (128 BPM)',
    make() {
      const s = new Song(128, 40);
      S.groove(s, 0, 16, { kick: 0.25, bass: 0.08, hats: 0.12 });
      S.drop(s, 16, 24);
      return { s, drops: [64] };
    },
  },
  {
    // modelled on a loud NCS-style master: the build is nearly as loud overall as the drop,
    // only the bass really jumps, bass is teased 16 beats early, and there's a 1-beat gap
    name: 'Loud master, bass-only jump, gap before drop (175 BPM)',
    make() {
      const s = new Song(175, 56);
      for (let b = 0; b < 64; b++) {
        s.kick(b, 0.6);
        s.bass(b, 1, 0.12, 49);
        s.hat(b + 0.5, 0.25);
        if (b % 2) s.snare(b, 0.5);
      }
      S.build(s, 16, 8, { riser: 0.7 });
      s.pad(64, 32, 0.5);
      for (let b = 80; b < 96; b++) s.bass(b, 1, 0.25, 49); // tease
      for (let b = 72; b < 76; b++) { s.kick(b, 0.9); s.bass(b, 1, 0.8, 49); } // one-bar fake-out
      // (beat 95 is left without new hits, the gap)
      for (let b = 96; b < 224; b++) {
        s.kick(b, 0.9);
        s.bass(b, 1, 0.8, 49);
        s.hat(b + 0.5, 0.25);
        if (b % 2) s.snare(b, 0.5);
      }
      return { s, drops: [96] };
    },
  },
  {
    name: 'Same EDM song mastered 30 dB quieter',
    make() {
      const { s, drops } = CASES[0].make();
      for (let i = 0; i < s.data.length; i++) s.data[i] *= 0.0316;
      return { s, drops };
    },
  },
  {
    name: 'Same EDM song under a constant noise bed',
    make() {
      const { s, drops } = CASES[0].make();
      for (let i = 0; i < s.data.length; i++) s.data[i] += rand() * 0.08;
      return { s, drops };
    },
  },
  {
    name: 'Slow crescendo, no drop (128 BPM)',
    make() {
      const s = new Song(128, 64);
      for (let bar = 0; bar < 64; bar++) {
        s.gain = Math.pow(10, (-24 + (24 * bar) / 63) / 20);
        S.groove(s, bar, 1, { kick: 0.9, bass: 0.6, hats: 0.2, snare: 0.3 });
      }
      return { s, drops: [] };
    },
  },
  {
    name: 'Flat groove, no drop (120 BPM)',
    make() {
      const s = new Song(120, 48);
      S.groove(s, 0, 48, { snare: 0.3 });
      return { s, drops: [] };
    },
  },
  {
    name: 'Verse to chorus +3 dB, no drop (100 BPM)',
    make() {
      const s = new Song(100, 64);
      for (let sec = 0; sec < 4; sec++) {
        s.gain = sec % 2 ? 1.41 : 1;
        S.groove(s, sec * 16, 16, { kick: 0.5, bass: 0.35, hats: sec % 2 ? 0.2 : 0.12, snare: 0.3 });
      }
      return { s, drops: [] };
    },
  },
];

// Everything is compared in seconds, so a tempo read at half or double speed doesn't hide
// whether the drops themselves were found; tolerance is one real beat either side.
const items = [];
for (const c of CASES) {
  seed = 1;
  const { s, drops: want } = c.make();
  const t0 = performance.now();
  const r = analyzeBeats(s.buffer());
  const tempo = Math.abs(r.bpm - s.bpm) < 0.5 ? 'ok' : [0.5, 2].some((k) => Math.abs(r.bpm - s.bpm * k) < 0.5) ? 'OCTAVE' : 'WRONG';
  items.push({
    name: c.name,
    kind: 'synthetic',
    loudDb: r.loudDb,
    bassDb: r.bassDb,
    toTime: (b) => r.offset + (b * 60) / r.bpm,
    want: want.map((w) => s.t(w)),
    beat: s.spb,
    note: `tempo ${r.bpm.toFixed(2)} (real ${s.bpm}) ${tempo}  ${Math.round(performance.now() - t0)} ms`,
    tempoWrong: tempo === 'WRONG',
    octave: tempo === 'OCTAVE',
  });
}
const CORPUS = new URL('./drop-corpus/', import.meta.url);
if (fs.existsSync(CORPUS)) {
  for (const f of fs.readdirSync(CORPUS).filter((f) => f.endsWith('.json')).sort()) {
    const j = JSON.parse(fs.readFileSync(new URL(f, CORPUS), 'utf8'));
    const toTime = (b) => j.offset + (b * 60) / j.bpm;
    items.push({
      name: j.file || f,
      kind: 'real',
      loudDb: Float32Array.from(j.loudDb),
      bassDb: Float32Array.from(j.bassDb),
      toTime,
      want: j.drops.map(toTime),
      beat: 60 / j.bpm,
      note: `${j.bpm.toFixed(1)} BPM, labelled by ${j.labelledBy || 'listening'}`,
    });
  }
}

function evaluate(it, o) {
  const got = findDrops(it.loudDb, it.bassDb, o).map(it.toTime);
  const errMs = [];
  let matched = 0;
  for (const w of it.want) {
    const g = got.find((x) => Math.abs(x - w) <= it.beat * 1.01);
    if (g !== undefined) {
      matched++;
      errMs.push(Math.round((g - w) * 1000));
    }
  }
  const extra = got.filter((g) => !it.want.some((w) => Math.abs(g - w) <= it.beat * 1.01));
  return { got, errMs, missed: it.want.length - matched, extra, ok: matched === it.want.length && !extra.length };
}

const sec = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

if (process.argv.includes('--sweep')) {
  // Grid around the defaults. A setting is good if every song passes; the more good settings
  // surround the defaults, the less fragile they are.
  const grid = {
    rise: [3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7],
    sharp: [2, 3, 4, 5, 6],
    hold: [0.4, 0.5, 0.6, 0.7, 0.8],
    bassWeight: [0.5, 0.6, 0.7, 0.8, 0.9],
  };
  const results = [];
  for (const rise of grid.rise)
    for (const sharp of grid.sharp)
      for (const hold of grid.hold)
        for (const bassWeight of grid.bassWeight) {
          const o = { ...DROP_DEFAULTS, rise, sharp, hold, bassWeight };
          let errors = 0;
          const fails = [];
          for (const it of items) {
            const e = evaluate(it, o);
            errors += e.missed + e.extra.length;
            if (!e.ok) fails.push(it.name);
          }
          results.push({ o, errors, fails });
        }
  const good = results.filter((r) => !r.errors);
  console.log(`${good.length} of ${results.length} settings get every song right (${items.length} songs)
`);
  for (const k of Object.keys(grid)) {
    const line = grid[k].map((v) => {
      const at = results.filter((r) => r.o[k] === v);
      return `${v}: ${at.filter((r) => !r.errors).length}/${at.length}`;
    });
    console.log(`  ${k.padEnd(10)} ${line.join('  ')}   (default ${DROP_DEFAULTS[k]})`);
  }
  const fails = {};
  for (const r of results) for (const f of r.fails) fails[f] = (fails[f] || 0) + 1;
  console.log('\nsongs that fail most often across the grid:');
  for (const [f, n] of Object.entries(fails).sort((a, b) => b[1] - a[1]).slice(0, 6)) console.log(`  ${String(n).padStart(4)}  ${f}`);
  process.exit(0);
}

let failed = 0;
let octave = 0;
for (const it of items) {
  const e = evaluate(it, DROP_DEFAULTS);
  const ok = e.ok && !it.tempoWrong;
  if (!ok) failed++;
  if (it.octave) octave++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  [${it.kind}] ${it.name}
` +
      `      drops want [${it.want.map(sec).join(', ')}]  got [${e.got.map(sec).join(', ')}]` +
      `${e.extra.length ? `  false: [${e.extra.map(sec).join(', ')}]` : ''}` +
      `${e.errMs.length ? `  timing ${e.errMs.map((x) => (x >= 0 ? '+' : '') + x).join('/')} ms` : ''}
` +
      `      ${it.note}`
  );
}
console.log(failed ? `
${failed} of ${items.length} failed` : `
all ${items.length} passed`);
if (octave) console.log(`${octave} tempo read at half/double speed (drops still placed by time)`);
process.exit(failed ? 1 : 0);
