import * as THREE from 'three';
import { AudioEngine } from './audio/engine.js';
import { Soundtrack } from './audio/soundtrack.js';
import { CustomTrack } from './audio/customTrack.js';
import { U, warpPoint } from './warp.js';
import { World } from './world.js';
import { Player } from './player.js';
import { Spawner, BUILD_BEATS, GATE_POINTS } from './spawner.js';
import { Shards } from './shards.js';
import { FX } from './fx.js';
import { HUD, formatDist } from './hud.js';
import { Intro, DRONE_LEN } from './intro.js';
import { DropDirector } from './drop.js';
import { Tutorial } from './tutorial.js';
import { SONGS, SONG_CREDIT } from './songs.js';
import { TIERS, tierOf, tierProgress, displaySpeed, displayMs, worldSpeed, smooth, V_MIN, V_MAX } from './speed.js';

const params = new URLSearchParams(location.search);
const DEV = params.has('dev');

// ------------------------------------------------------------------ setup
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
// Phones get a lower resolution from the start; see the adaptive quality below.
const MOBILE = matchMedia('(pointer: coarse)').matches;
const BASE_DPR = Math.min(devicePixelRatio, MOBILE ? 1.25 : 1.5);
renderer.setPixelRatio(BASE_DPR);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
const craftScene = new THREE.Scene(); // drawn on top of the warped world, never blurred
const camera = new THREE.PerspectiveCamera(64, innerWidth / innerHeight, 0.1, 3000);
craftScene.add(new THREE.HemisphereLight('#ff9a7a', '#201040', 1.4));
const sunLight = new THREE.DirectionalLight('#ffd0a0', 2.5);
sunLight.position.set(0, 3, -10);
craftScene.add(sunLight);
const backLight = new THREE.DirectionalLight('#77aaff', 1.5);
backLight.position.set(0, 5, 10);
craftScene.add(backLight);

const world = new World(scene);
const player = new Player(scene, craftScene);
const spawner = new Spawner(scene, craftScene);
const fx = new FX(renderer, scene, craftScene, camera);
const hud = new HUD();
const intro = new Intro(scene, world, player, camera, fx);
const drop = new DropDirector();
spawner.warp = drop;
const shards = new Shards(scene);

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  fx.setSize(innerWidth, innerHeight);
});

// Adaptive quality: if frames run slow for a couple of seconds the game renders at a lower
// resolution (and with fewer blur samples), and steps back up when there's headroom again.
// The post effects are per-pixel, so resolution is by far the biggest cost on phones.
const QUALITY = [1, 0.8, 0.65, 0.5]; // fraction of BASE_DPR
const quality = { level: MOBILE ? 1 : 0, ema: 1 / 60, cool: 0, good: 0 };
function applyQuality() {
  const pr = BASE_DPR * QUALITY[quality.level];
  renderer.setPixelRatio(pr);
  fx.composer.setPixelRatio(pr);
  renderer.setSize(innerWidth, innerHeight);
  fx.setSize(innerWidth, innerHeight);
  fx.u.uTaps.value = quality.level >= 2 ? 8 : 16;
}
function trackQuality(rawDt) {
  if (G.state !== 'playing' && G.state !== 'intro') return;
  if (rawDt > 0.25) return; // a stall (tab switch, GC), not the steady frame rate
  quality.ema += (rawDt - quality.ema) * 0.04;
  quality.cool -= rawDt;
  if (quality.cool > 0) return;
  if (quality.ema > 1 / 45 && quality.level < QUALITY.length - 1) {
    quality.level++;
  } else if (quality.ema < 1 / 57) {
    quality.good += rawDt;
    if (quality.good < 10 || quality.level === 0) return;
    quality.level--;
  } else {
    quality.good = 0;
    return;
  }
  quality.good = 0;
  quality.cool = 3; // let the new setting settle before judging it
  quality.ema = 1 / 55;
  applyQuality();
}
if (quality.level) applyQuality();

// ------------------------------------------------------------------ audio
let audio = null;
let soundtrack = null;
let customTrack = null;
let track = null;
let useCustom = false;

function ensureAudio() {
  if (!audio) {
    audio = new AudioEngine();
    applyPrefs();
  }
  return audio.resume();
}

// Player settings: volume sliders (0..1) plus mute, and how hard beats and events flash
// the screen. Remembered between visits.
const PREFS_KEY = 'redshift.prefs';
const prefs = { master: 0.6, music: 0.8, sfx: 0.7, muted: false, flash: 0.5 };
try {
  const saved = localStorage.getItem(PREFS_KEY) || localStorage.getItem('redshift.volume');
  Object.assign(prefs, JSON.parse(saved) || {});
} catch {}

function applyPrefs() {
  if (audio) audio.setVolume({ master: prefs.muted ? 0 : prefs.master, music: prefs.music, sfx: prefs.sfx });
  document.querySelectorAll('input[data-pref]').forEach((el) => {
    el.value = Math.round(prefs[el.dataset.pref] * 100);
    el.nextElementSibling.textContent = el.value;
  });
  document.querySelectorAll('.vol-mute').forEach((b) => {
    b.textContent = prefs.muted ? 'UNMUTE' : 'MUTE';
    b.classList.toggle('on', prefs.muted);
  });
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {}
}

function nudgeVolume(d) {
  prefs.muted = false;
  prefs.master = THREE.MathUtils.clamp(Math.round((prefs.master + d) * 20) / 20, 0, 1);
  applyPrefs();
  hud.toast(`VOLUME ${Math.round(prefs.master * 100)}`);
}

function toggleMute() {
  prefs.muted = !prefs.muted;
  applyPrefs();
  hud.toast(prefs.muted ? 'MUTED' : `VOLUME ${Math.round(prefs.master * 100)}`);
}

// ------------------------------------------------------------------ state
const G = {
  state: 'menu',
  t: 0,
  v: V_MIN,
  vs: V_MIN, // smoothed speed that drives the visuals
  tier: 0,
  combo: 0,
  overdrive: 0,
  vSustain: V_MIN,
  topTier: 0,
  flux: 0.5,
  score: 0,
  distKm: 0,
  topV: 0,
  perfects: 0,
  gates: 0,
  crashes: 0,
  maxCombo: 0,
  beatNow: 0,
  lastBeat: -1,
  pulse: 0,
  glow: 0,
  bassAvg: 0,
  shake: 0,
  glitch: 0,
  flash: 0,
  boomFlash: 0,
  boostKick: 0,
  shockR: 3,
  shockAmp: 0,
  waveR: 3,
  waveAmp: 0,
  chime: 0,
  build: 0, // 0..1 through the build-up before a drop
  surge: 0, // 1 at a drop, fades over a few bars
  dropWave: 0, // drop shockwave front, units ahead of the craft
  dropWaveAmp: 0,
};

const fxs = { blur: 0, mirage: 0, sonic: 0, sonicBand: 0, space: 0, sing: 0, speedN: 0, pulse: 0, boomFlash: 0 };

function resetRun() {
  Object.assign(G, {
    v: V_MIN, vs: V_MIN, vSustain: V_MIN, tier: 0, topTier: 0, combo: 0, overdrive: 0, odHinted: false, flux: 0.5, score: 0, distKm: 0, topV: V_MIN,
    perfects: 0, gates: 0, crashes: 0, maxCombo: 0, lastBeat: -1, pulse: 0, glow: 0, shake: 0,
    glitch: 0, flash: 0, boomFlash: 0, boostKick: 0, shockAmp: 0, chime: 0,
    build: 0, buildAudio: 0, surge: 0, lastDrop: -1, buildFor: -1, buildClean: false, countdown: 0, dropBoomFor: -1, dropUntil: -1,
    drops: 0, perfectDrops: 0, dropWave: 0, dropWaveAmp: 0,
  });
  shards.clear();
  U.uScroll.value = 0;
  drop.setTrack([], 0.5);
  if (audio) audio.cancelHang();
  spawner.reset();
  player.reset();
}

// ------------------------------------------------------------------ input
const keys = new Set();
const touch = { left: false, right: false };

addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.target.tagName === 'INPUT' && e.code.startsWith('Arrow')) return; // focused slider keeps its arrows
  keys.add(e.code);
  if (e.code === 'KeyM') toggleMute();
  if (e.code === 'Minus' || e.code === 'NumpadSubtract') nudgeVolume(-0.05);
  if (e.code === 'Equal' || e.code === 'NumpadAdd') nudgeVolume(0.05);
  if (G.state === 'playing') {
    if (['Space', 'ShiftLeft', 'ShiftRight', 'KeyW', 'ArrowUp'].includes(e.code)) boost();
    if (e.code === 'Escape' || e.code === 'KeyP') pause(true);
    if (e.code === 'BracketLeft' || e.code === 'BracketRight') {
      audio.userOffset += e.code === 'BracketLeft' ? -0.01 : 0.01;
      hud.toast(`AUDIO OFFSET ${audio.userOffset >= 0 ? '+' : ''}${Math.round(audio.userOffset * 1000)} ms`);
    }
    if (DEV && e.code.startsWith('Digit')) {
      const n = Number(e.code.slice(5)) - 1;
      if (n >= 0 && n < TIERS.length) {
        G.v = TIERS[n].min + 15;
        G.combo = Math.max(G.combo, Math.min(COMBO_CAP, Math.round((G.v - 60) / 15)));
        G.overdrive = Math.max(0, (G.v - (60 + 15 * COMBO_CAP)) / OD_SPEED);
      }
    }
  } else if (G.state === 'paused' && e.code === 'Escape') pause(false);
  else if (G.state === 'intro' && ['Space', 'Enter', 'Escape'].includes(e.code)) intro.skip();
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', (e) => keys.delete(e.code));

// Touch: hold the left or right half of the screen to steer; tap both sides at once to boost.
// Each finger is tracked on its own, so lifting one thumb keeps the other one steering.
// Pressing the other side while already steering is ambiguous: it's either a boost (the first
// thumb stays down) or a switch of direction (the first thumb lifts straight after). So that
// press waits SWITCH_MS to see which, and a boost is then judged as of the moment it was pressed.
const fingers = new Map(); // pointerId -> { side: -1 | 1, t: press time (ms) }
const TAP_BOTH_MS = 150; // both sides pressed within this long of each other: a two-thumb tap
const SWITCH_MS = 70;
function syncTouch() {
  touch.left = touch.right = false;
  for (const f of fingers.values()) f.side < 0 ? (touch.left = true) : (touch.right = true);
}
canvas.addEventListener('pointerdown', (e) => {
  if (G.state === 'intro') intro.skip();
  if (G.state !== 'playing') return;
  const side = e.clientX < innerWidth / 2 ? -1 : 1;
  const now = performance.now();
  const other = [...fingers.values()].find((f) => f.side !== side);
  fingers.set(e.pointerId, { side, t: now });
  syncTouch();
  if (!other) return;
  if (now - other.t < TAP_BOTH_MS) boost();
  else {
    setTimeout(() => {
      // the first thumb is still down: both sides are held, so it's a boost
      if ([...fingers.values()].includes(other)) boost((performance.now() - now) / 1000);
    }, SWITCH_MS);
  }
});
const liftFinger = (e) => {
  fingers.delete(e.pointerId);
  syncTouch();
};
addEventListener('pointerup', liftFinger);
addEventListener('pointercancel', liftFinger);

function steerInput() {
  let s = 0;
  if (keys.has('KeyA') || keys.has('ArrowLeft') || touch.left) s -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight') || touch.right) s += 1;
  return s;
}

// ------------------------------------------------------------------ gameplay
// combo multiplier, doubled for the 16 beats after a drop
const mult = () => (1 + G.combo * 0.1) * (G.beatNow < G.dropUntil ? 2 : 1);

// Speed has two stages. The combo alone carries you up to SONIC (60 + 15 * 14 = 270).
// Past that only overdrive pushes further, and it charges slowly and only while the
// combo is maxed, so WARP and SINGULARITY are earned over a long clean stretch and
// the world bends gradually instead of all at once.
const COMBO_CAP = 14;
const OD_PER_RING = 1;
const OD_PER_PERFECT = 0.5;
const OD_SPEED = 0.95; // speed per overdrive point
const OD_MAX = (V_MAX - (60 + 15 * COMBO_CAP)) / OD_SPEED;
const BOOST_HEADROOM = 60; // how far boosts can burst above sustained speed

function chargeOverdrive(n) {
  if (G.combo < COMBO_CAP) return;
  if (!G.odHinted) {
    G.odHinted = true;
    hud.toast('COMBO MAXED — keep it alive to charge OVERDRIVE');
  }
  G.overdrive = Math.min(OD_MAX, G.overdrive + n);
}

// `ago`: seconds since the player actually pressed (a touch boost can be confirmed a moment
// later), so the timing is judged against when they pressed, not when it was confirmed.
function boost(ago = 0) {
  if (G.state !== 'playing') return;
  if (G.flux < 0.18) {
    hud.toast('FLUX EMPTY — fly through rings');
    return;
  }
  const beat = track.beatAt(audio.heardTime - ago);
  const err = Math.abs(beat - Math.round(beat)) * track.spb;
  let label, color, dv, cost;
  if (err < 0.06) {
    [label, color, dv, cost] = ['PERFECT', '#ffd166', 32, 0.2];
    G.perfects++;
    chargeOverdrive(OD_PER_PERFECT);
  } else if (err < 0.12) {
    [label, color, dv, cost] = ['GOOD', '#3ef2ff', 20, 0.25];
  } else {
    [label, color, dv, cost] = ['OFF-BEAT', '#8a93b8', 10, 0.3];
  }
  G.v = Math.min(V_MAX, G.v + dv);
  G.flux = Math.max(0, G.flux - cost);
  G.score += (label === 'PERFECT' ? 250 : 80) * mult();
  G.boostKick = label === 'PERFECT' ? 1 : 0.6;
  G.shockR = 0;
  G.shockAmp = label === 'PERFECT' ? 0.8 : 0.4;
  hud.pop(label, color, -40);
  audio.whoosh(label === 'PERFECT' ? 1.2 : 0.7);
}

function handleEvents(events) {
  for (const ev of events) {
    switch (ev.type) {
      case 'gate': {
        G.combo++;
        G.gates++;
        chargeOverdrive(OD_PER_RING);
        G.v = Math.min(V_MAX, G.v + 8);
        G.flux = Math.min(1, G.flux + 0.1);
        G.score += GATE_POINTS[ev.accent] * mult();
        const at = track.timeOfBeat(ev.beat);
        const note = track.chordTone(ev.beat, G.chime++ % 6 + 2);
        audio.chime(note, 0.28, at);
        if (ev.accent) audio.chime(note + 12, 0.2, at);
        world.emitDust(ev.x, 1.2, 0, 900, 1 / 30, new THREE.Color(0.4, 1.6, 2.2), ev.accent ? 12 : 7);
        hud.pop(['+RING', '+ACCENT', '+DROP RING', '+PORTAL'][ev.accent], ev.accent ? '#ffd34e' : '#3ef2ff');
        // the portals shatter as you fly through
        if (ev.accent >= 2) {
          const r = 2 * (ev.accent === 3 ? 3.6 : 1.7) * (1 + U.uSpace.value * 0.45);
          const col = ev.accent === 2 ? new THREE.Color(2.0, 1.3, 0.35) : new THREE.Color(0.5, 1.4, 2.2);
          shards.burst(warpPoint(ev.x, 1.0, -0.5, tmp).clone(), r, col, ev.accent === 3 ? 160 : 130, camera.position);
        }
        break;
      }
      case 'miss':
        G.buildClean = false;
        G.combo = Math.max(0, G.combo - 2);
        G.overdrive = Math.max(0, G.overdrive - 4);
        G.chime = 0;
        hud.pop('MISS', '#8a93b8', 30);
        break;
      case 'crash':
        G.buildClean = false;
        G.v = Math.max(V_MIN, G.v * 0.6);
        G.combo = Math.floor(G.combo / 2);
        G.overdrive *= 0.5;
        G.chime = 0;
        G.crashes++;
        G.flux = Math.max(0, G.flux - 0.1);
        G.glitch = 1;
        G.shake = 1;
        player.invuln = 1.3;
        player.flash = 1;
        audio.crash();
        world.emitDust(ev.x, 1, 0, 1500, 1 / 30, new THREE.Color(2.4, 0.3, 0.4), 10);
        hud.pop('CRASH', '#ff3b4e');
        break;
      case 'close':
        G.score += 60 * mult();
        G.v = Math.min(V_MAX, G.v + 6);
        hud.pop('CLOSE CALL', '#ff3edc', 30);
        audio.passBy((ev.x - player.x) / 6, 1, fxs.speedN);
        break;
      case 'pass':
        audio.passBy((ev.x - player.x) / 8, 0.5, fxs.speedN);
        break;
      case 'arch':
        G.flash = Math.max(G.flash, 0.12);
        hud.pop(`SECTOR ${ev.sector}`, '#ffffff', -90);
        break;
    }
  }
  G.maxCombo = Math.max(G.maxCombo, G.combo);
}

function onTierChange(n, prev) {
  G.tier = n;
  G.topTier = Math.max(G.topTier, n);
  track.setLayer(n);
  if (n <= prev) return;
  hud.banner(TIERS[n].name, TIERS[n].color);
  G.shockR = 0;
  if (n === 3) {
    audio.boom(false);
    G.shockAmp = 1.6;
    G.boomFlash = 1;
    G.flash = 0.5;
    G.shake = 0.8;
  } else if (n === 4) {
    audio.warpSwell();
    audio.boom(true);
    G.shockAmp = 2;
    G.flash = 1;
    G.shake = 0.6;
  } else if (n === 5) {
    audio.boom(true);
    G.shockAmp = 2.5;
    G.flash = 1.2;
    G.shake = 1;
  } else {
    audio.whoosh(1);
    G.shockAmp = 0.8;
    G.flash = 0.2;
  }
}

// ------------------------------------------------------------------ drops
// Drops come from the track: written into the built-in soundtrack, found by analysis in
// your own songs. The 16 beats before one are a build-up (the course straightens, the music
// muffles, the view tightens, a countdown runs), and on the drop beat everything lets go.
const DROP_SURGE_V = 160;

function updateDrop() {
  const d = track.drops.find((x) => x > G.lastDrop);
  G.build = 0;
  if (d === undefined) return;
  const left = d - G.beatNow;
  if (left > 0 && left <= BUILD_BEATS) {
    if (G.buildFor !== d) {
      G.buildFor = d;
      G.buildClean = true;
      hud.toast('DROP INCOMING');
    }
    G.build = 1 - left / BUILD_BEATS;
    const n = Math.ceil(left);
    if (n <= 4 && n !== G.countdown) {
      G.countdown = n;
      hud.countdown(String(n));
    }
  }
  // schedule the impact a little early so it lands on the drop in the audio, not a frame late
  if (left <= 0.3 && G.dropBoomFor !== d) {
    G.dropBoomFor = d;
    audio.boom(true, track.timeOfBeat(d));
    audio.open = 1; // the muffle lets go with the drop, then settles back to your speed
  }
  G.buildAudio = left > 0.3 ? G.build : 0;
  if (left <= 0) {
    G.lastDrop = d;
    G.countdown = 0;
    onDrop(d);
  }
}

// Out through the exit portal at the end of a drop's surge: back onto the road with a bang.
function onPortalExit() {
  G.flash = Math.max(G.flash, 0.45);
  G.shake = Math.max(G.shake, 0.6);
  G.boostKick = 1;
  G.dropWave = 0;
  G.dropWaveAmp = 0.7;
  drop.punch = Math.max(drop.punch, 0.6);
  audio.boom(false);
  audio.whoosh(1);
}

function onDrop(d) {
  const perfect = G.buildFor === d && G.buildClean;
  drop.impact(d);
  G.dropWave = 0;
  G.dropWaveAmp = 1;
  G.drops++;
  G.surge = perfect ? 1.3 : 1;
  G.v += perfect ? 140 : 90;
  G.dropUntil = d + 16;
  G.shockR = 0;
  G.shockAmp = 2.2;
  G.flash = 0.6;
  G.shake = 0.8;
  G.boostKick = 1;
  audio.slamAmt = 0;
  hud.countdown('DROP', true, perfect ? 'PERFECT' : '');
  if (perfect) {
    G.perfectDrops++;
    G.score += 1000 * mult();
    hud.pop('PERFECT DROP  x2', '#ffd34e', -40);
  } else hud.pop('SCORE x2', '#ffd34e', -40);
}

function updatePlaying(dt) {
  G.beatNow = track.beatAt(audio.heardTime);

  // momentum: combo + overdrive set the speed you can sustain
  const vT = 60 + 15 * Math.min(G.combo, COMBO_CAP) + G.overdrive * OD_SPEED;
  if (G.v < vT) G.v += Math.min(vT - G.v, (16 + (vT - G.v) * 0.45) * dt);
  else G.v -= (G.v - vT) * 1.1 * dt; // boosts are bursts; combo + overdrive hold speed
  updateDrop();
  for (const cue of drop.update(dt, G.beatNow, (b) => track.hits(b))) {
    const at = track.timeOfBeat(cue.drop);
    if (cue.type === 'build') {
      // the built-in soundtrack brings its own riser; uploaded songs get one from the engine
      if (track !== soundtrack) audio.riser(track.timeOfBeat(cue.start), at);
      audio.reverseCymbal(at, Math.min(1.6, 4 * track.spb));
    } else if (cue.type === 'hang') audio.hang(track.timeOfBeat(cue.start), at);
    else if (cue.type === 'exit') onPortalExit();
  }
  // a drop lets you blow well past your sustained speed for a moment
  G.v = THREE.MathUtils.clamp(G.v, V_MIN, Math.min(V_MAX, vT + BOOST_HEADROOM + G.surge * DROP_SURGE_V));
  G.flux = Math.min(1, G.flux + dt * 0.015);
  G.topV = Math.max(G.topV, G.v);

  // tiers (banners, music layers) follow sustained speed, so boost bursts can't flicker them
  G.vSustain = vT;
  const nt = tierOf(vT, G.tier);
  if (nt !== G.tier) onTierChange(nt, G.tier);

  const wspd = worldSpeed(G.vs);
  const ts = drop.scaleAt(G.beatNow); // the drop's slow-motion hang and impact freeze
  const progress = G.beatNow / track.durationBeats;
  const difficulty = THREE.MathUtils.clamp(0.15 + progress * 0.45 + track.intensityAt(G.beatNow + 8) * 0.3 + G.tier * 0.04, 0, 1);
  let steer = steerInput();
  if (DEV && params.has('auto')) {
    steer = autopilot();
    if (G.flux > 0.5 && Math.abs(G.beatNow - Math.round(G.beatNow)) < 0.04) boost();
  }
  player.charge = G.build;
  ringAssist(dt, steer);
  player.update(dt, steer, fxs, wspd * ts);
  handleEvents(
    spawner.update(dt, G.beatNow, track.spb, wspd, player.x, player.invuln > 0, difficulty, track.durationBeats - 4, (b) => track.hits(b))
  );

  G.score += G.vs * dt * 0.5 * (G.tier + 1);
  G.distKm += (displayMs(G.vs) * dt) / 1000;

  if (G.beatNow >= track.durationBeats) endRun();
}

// In the last half beat before a ring, ease the craft onto it if it's already roughly lined
// up, unless the player is steering away.
const ASSIST_BEATS = 0.6;
function ringAssist(dt, steer) {
  for (const o of spawner.active) {
    if (o.type !== 'gate' || o.done) continue;
    const left = o.beat - G.beatNow;
    const dx = o.x - player.x;
    if (left <= 0 || left > ASSIST_BEATS || Math.abs(dx) > 3.2) continue;
    if (steer && Math.sign(steer) !== Math.sign(dx)) return;
    player.x += dx * Math.min(1, dt * 7 * (1 - left / ASSIST_BEATS));
    return;
  }
}

function autopilot() {
  const next = spawner.active.filter((o) => !o.done && o.type === 'gate').sort((a, b) => b.z - a.z)[0];
  const tx = next ? next.x : 0;
  const d = tx - player.x;
  if (Math.abs(d) < 0.4) return 0;
  return Math.sign(d);
}

// ------------------------------------------------------------------ level intro
function updateIntro(dt) {
  const cues = intro.update(dt, worldSpeed(G.vs));
  G.v = intro.speed;
  G.beatNow = -100; // no beat pulses until the music starts
  player.x = 0;
  player.update(dt, 0, fxs, worldSpeed(G.vs));
  for (const c of cues) {
    if (c === 'boost') {
      audio.whoosh(1.3);
      G.boostKick = 1;
      G.shockR = 0;
      G.shockAmp = 0.8;
    } else if (c === 'cut') {
      player.resetTrails();
      audio.drone(DRONE_LEN);
    } else if (c === 'swell') audio.warpSwell();
    else if (c === 'enter') {
      audio.boom(true);
      beginPlay();
    }
  }
}

// The craft is through the portal: the music and the run start here.
function beginPlay() {
  drop.setTrack(track.drops, track.spb);
  intro.end();
  player.z = 0;
  player.resetTrails();
  G.v = 90; // carry a little of the intro's speed in, settling to cruise
  G.boostKick = 1;
  track.start();
  G.state = 'playing';
  hud.show(true);
}

function updateMenu(dt) {
  // attract mode: sweep through every tier so the title screen shows off
  G.v = V_MIN + (500 - V_MIN) * (0.5 - 0.5 * Math.cos(G.t * 0.09));
  G.beatNow = G.t / (60 / 174);
  const nt = tierOf(G.v, G.tier);
  G.tier = nt;
  player.update(dt, 0, fxs, worldSpeed(G.vs));
  player.x = Math.sin(G.t * 0.6) * 4;
}

// ------------------------------------------------------------------ visuals
const letterboxEl = document.getElementById('letterbox');
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const focus = new THREE.Vector2(0.5, 0.55);
const C = (h) => new THREE.Color(h);
const PAL = {
  duskTop: C('#2a1150'), duskHor: C('#ff7a59'),
  hotTop: C('#4a1d4f'), hotHor: C('#ffad5e'),
  highTop: C('#070726'), highHor: C('#ff4f7b'),
  spaceFog: C('#120a33'),
};

function updateVisuals(dt) {
  G.vs += (G.v - G.vs) * Math.min(1, dt * 2.5);
  const v = G.vs;
  Object.assign(fxs, {
    blur: smooth(70, 330, v),
    mirage: smooth(150, 260, v),
    sonic: smooth(245, 300, v),
    sonicBand: Math.exp(-Math.pow((v - 265) / 22, 2)),
    space: smooth(335, 450, v),
    sing: smooth(470, 610, v),
    speedN: (v - V_MIN) / (V_MAX - V_MIN),
  });
  // a drop throws the world part of the way into warp for a few bars
  G.surge *= Math.exp(-dt * 0.45);
  fxs.space = Math.min(1, fxs.space + G.surge * 0.4);
  // through the drop portal: the whole surge happens inside the wormhole
  fxs.space = Math.max(fxs.space, drop.portal);

  // beat + bass pulses
  const bi = Math.floor(G.beatNow);
  if (bi !== G.lastBeat && G.beatNow >= 0) {
    G.lastBeat = bi;
    G.pulse = Math.max(G.pulse, bi % 4 === 0 ? 1 : 0.6);
    // the craft charges up on every beat of a drop's build
    if (G.build > 0) player.chargeBeat = 0.4 + 0.6 * G.build;
    // in warp every beat fires a wave of compressed space past the camera
    if (fxs.space > 0.05) {
      G.waveR = 0;
      G.waveAmp = fxs.space * (bi % 4 === 0 ? 1.4 : 0.8);
    }
  }
  if (audio && G.state === 'playing') {
    const b = audio.bass();
    G.bassAvg += (b - G.bassAvg) * Math.min(1, dt * 4);
    G.pulse = Math.max(G.pulse, Math.max(0, b - G.bassAvg) * 3);
  }
  G.pulse *= Math.exp(-dt * 7) * (1 - drop.hang * 0.6); // the hang goes still
  // Brightness follows a softened copy of the pulse: lower peak, a short fade-in and a slow
  // fade-out, so beats swell instead of strobing at ~3 Hz. Motion (FOV, punch-in, ripples)
  // keeps the sharp pulse. The FLASHES setting scales it, down to no brightness change at 0.
  const glowT = Math.min(1, G.pulse) * 0.6 * prefs.flash;
  G.glow += (glowT - G.glow) * Math.min(1, dt * (glowT > G.glow ? 14 : 3));
  fxs.pulse = G.glow;

  // transient decays
  G.shake *= Math.exp(-dt * 4);
  G.glitch = Math.max(0, G.glitch - dt * 2.2);
  G.flash *= Math.exp(-dt * 5);
  G.boomFlash *= Math.exp(-dt * 2);
  G.boostKick *= Math.exp(-dt * 4);
  G.shockR += dt * 1.6;
  G.shockAmp *= Math.exp(-dt * 1.5);
  G.waveR += dt * 3.2;
  G.waveAmp *= Math.exp(-dt * 3);
  fxs.boomFlash = G.boomFlash;

  // world bending
  const ease = fxs.space * fxs.space * (3 - 2 * fxs.space);
  U.uInvR.value = 1 / 400 + (1 / 9.5 - 1 / 400) * ease;
  U.uTwist.value = fxs.sing * 0.005 + fxs.space * 0.0015 * Math.sin(G.t * 0.5);
  U.uBend.value = fxs.space * 0.35 * Math.sin(G.t * 0.37);
  U.uSway.value = fxs.space * 0.45 * Math.sin(G.t * 0.29 + 1);
  U.uRipple.value = fxs.space * 0.35 * G.pulse;
  U.uTime.value = G.t;
  U.uBeat.value = G.beatNow;
  U.uPulse.value = G.glow;
  U.uBeatGlow.value = prefs.flash * 1.2;
  U.uSpeedN.value = fxs.speedN;
  U.uMirage.value = fxs.mirage;
  U.uSonic.value = fxs.sonic;
  U.uSpace.value = fxs.space;
  U.uSing.value = fxs.sing;
  const ts = G.state === 'playing' ? drop.scaleAt(G.beatNow) : 1;
  const wspd = worldSpeed(v) * ts;
  shards.update(dt * ts);
  // the drop shockwave races away down the track, fading as it goes
  G.dropWave += dt * ts * 850;
  G.dropWaveAmp *= Math.exp(-dt * ts * 0.8);
  if (G.dropWave > 1300) G.dropWaveAmp = 0;
  U.uDropWave.value = G.dropWave;
  U.uDropWaveAmp.value = G.dropWaveAmp * (0.4 + 0.6 * prefs.flash);
  U.uScroll.value += wspd * dt;

  // sky palette: dusk -> heat -> stratosphere -> space
  const top = world.skyTop.value, hor = world.skyHor.value;
  top.copy(PAL.duskTop).lerp(PAL.hotTop, fxs.mirage).lerp(PAL.highTop, fxs.sonic);
  hor.copy(PAL.duskHor).lerp(PAL.hotHor, fxs.mirage * (1 - fxs.sonic)).lerp(PAL.highHor, fxs.sonic);
  U.uFogColor.value.copy(hor).lerp(PAL.spaceFog, fxs.space);
  U.uFogFar.value = 900 + fxs.space * 150;

  world.update(dt, wspd, fxs);

  if (G.state !== 'paused' && G.state !== 'results') {
    const sparkle = fxs.space > 0.1 ? new THREE.Color(0.6, 0.5, 1.6) : fxs.sonic > 0.1 ? new THREE.Color(1.4, 1.4, 1.6) : new THREE.Color(1.1, 0.8, 0.6);
    world.emitDust(player.x, 0.2, 1.2, fxs.mirage * 60 + fxs.sonic * 30, dt, sparkle.multiplyScalar(0.5), 2 + fxs.sonic * 4);
  }

  // camera rides the curl so the craft always sits at the bottom of the tube
  const px = player.x;
  // in warp the FOV punches out on every beat and the camera hugs the floor
  // the build-up pulls the view in tight; the drop punches it back out
  // drops add a wide pull-back before, a punch on impact and kicks on the hits after (drop.js)
  camera.fov = Math.min(116, 60 + fxs.blur * 18 + fxs.space * 14 + G.pulse * (1.5 + fxs.space * 7) + G.boostKick * 9 - G.build * 9 + drop.fovAdd);
  camera.updateProjectionMatrix();
  warpPoint(px * 0.75, 2.6 - fxs.blur * 0.6 - fxs.space * 0.35 + drop.camUp, 7.0 - fxs.blur * 1.6 - G.boostKick * 1.2 + drop.camBack, tmp);
  const roll = tmp.roll + Math.sin(G.t * 23) * 0.006 * fxs.space + drop.roll;
  const rumble = fxs.sonic * 0.025 + fxs.space * 0.05 + fxs.sing * 0.04;
  const sh = G.shake * 0.45 + rumble;
  camera.position.set(tmp.x + (Math.random() - 0.5) * sh, tmp.y + (Math.random() - 0.5) * sh, tmp.z);
  warpPoint(px * 0.85, 1.1, -30, tmp2);
  camera.up.set(-Math.sin(roll), Math.cos(roll), 0);
  camera.lookAt(tmp2);
  camera.updateMatrixWorld();
  U.uCamPos.value.copy(camera.position);
  if (G.state === 'playing') hud.markers(ringMarkers(fxs.space));
  world.followCamera(camera);

  // screen-space anchors for the post effects
  warpPoint(px * 0.3, 1.2, -700, tmp).project(camera);
  focus.x += ((tmp.x * 0.5 + 0.5) - focus.x) * Math.min(1, dt * 6);
  focus.y += ((tmp.y * 0.5 + 0.5) - focus.y) * Math.min(1, dt * 6);
  focus.x = THREE.MathUtils.clamp(focus.x, 0.15, 0.85);
  focus.y = THREE.MathUtils.clamp(focus.y, 0.2, 0.85);
  const u = fx.u;
  u.uFocus.value.copy(focus);
  warpPoint(px, 0.6, -1, tmp).project(camera);
  u.uShockC.value.set(tmp.x * 0.5 + 0.5, tmp.y * 0.5 + 0.5);

  u.uTime.value = G.t;
  // ease the radial blur in warp: smearing everything hides the stuff rushing past
  u.uBlur.value = fxs.blur * (1 - fxs.space * 0.35) * (1 + G.pulse * 0.25) + G.boostKick * 0.5;
  u.uWaveR.value = G.waveR;
  u.uWaveAmp.value = G.waveAmp;
  u.uWaveGlow.value = prefs.flash * 2;
  u.uMirage.value = fxs.mirage * (1 - fxs.space * 0.6);
  u.uChroma.value = fxs.blur * 0.5 + fxs.sonic * 0.5 + fxs.space * 1.1 + G.glitch * 3 + G.boostKick * 0.6 + G.build * 0.6;
  u.uWarp.value = fxs.space;
  u.uLens.value = fxs.space * 0.03 + fxs.sing * 0.06;
  u.uEcho.value = Math.min(0.7, fxs.space * 0.55 + fxs.sing * 0.15);
  u.uSing.value = fxs.sing;
  u.uPulse.value = G.pulse;
  u.uVig.value = 0.25 + fxs.blur * 0.35 + fxs.space * 0.2 + G.build * 0.4;
  u.uGlitch.value = G.glitch;
  u.uSat.value = drop.saturation;
  u.uPinch.value = drop.pinch;
  // the sky breaking: the ring sweeps out from the sun and fades; the crack follows drop.crack
  // it races out at first, then slows and hangs near the edge of the view while it fades
  U.uSkyRing.value = 1.15 * (1 - Math.exp(-drop.skyT * 1.1));
  U.uSkyRingAmp.value = drop.skyT < 8 ? Math.exp(-drop.skyT * 0.45) * (0.5 + 0.5 * prefs.flash) : 0;
  U.uSkyCrack.value = drop.crack;
  const lb = drop.lb.toFixed(3);
  if (lb !== letterboxEl.style.getPropertyValue('--lb')) letterboxEl.style.setProperty('--lb', lb);
  // event flashes (tier breaks, sectors) are capped well short of a white screen
  const flash = Math.min(0.35, G.flash * 0.6) * prefs.flash;
  u.uFlash.value = flash;
  u.uShockR.value = G.shockR;
  u.uShockAmp.value = G.shockAmp;
  fx.bloom.strength = 0.5 + fxs.speedN * 0.3 + G.glow * 0.2 + flash * 0.6;
  fx.bloom.radius = 0.5 + fxs.space * 0.3;

  // the music muffles through a build-up
  const open = (0.18 + 0.82 * smooth(V_MIN, 300, v)) * (1 - (G.buildAudio || 0) * 0.7);
  const flying = G.state === 'playing' || G.state === 'intro';
  if (audio) audio.update(dt, G.state === 'playing' ? open : 1, flying ? fxs.speedN : 0);
}

// Approach circles for the next rings, faded in once space starts warping.
const markerPt = new THREE.Vector3();
const markerList = [];
function ringMarkers(space) {
  markerList.length = 0;
  const a = smooth(0.1, 0.5, space);
  if (a <= 0) return markerList;
  const focalPx = innerHeight / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  const rings = spawner.active.filter((o) => o.type === 'gate' && !o.done && o.beat - G.beatNow <= 2 && o.beat > G.beatNow);
  rings.sort((p, q) => p.beat - q.beat);
  for (const o of rings) {
    warpPoint(o.x, 1.0, o.z, markerPt);
    const depth = -markerPt.clone().applyMatrix4(camera.matrixWorldInverse).z;
    if (depth < 1) continue;
    markerPt.project(camera);
    markerList.push({
      x: (markerPt.x * 0.5 + 0.5) * innerWidth,
      y: (0.5 - markerPt.y * 0.5) * innerHeight,
      r: (2.0 * o.group.scale.x * focalPx) / depth,
      t: (o.beat - G.beatNow) / 2,
      a: a * smooth(2, 1.4, o.beat - G.beatNow),
    });
  }
  return markerList;
}

// ------------------------------------------------------------------ flow
const $ = (id) => document.getElementById(id);
const menuEl = $('menu'), pauseEl = $('pause'), resultsEl = $('results'), statusEl = $('analysis-status');

function showOnly(el) {
  [menuEl, pauseEl, resultsEl].forEach((x) => x.classList.toggle('hidden', x !== el));
}

async function startRun() {
  await ensureAudio();
  if (track) track.stop();
  if (useCustom && customTrack) track = customTrack;
  else {
    if (!soundtrack) soundtrack = new Soundtrack(audio);
    track = soundtrack;
  }
  resetRun();
  spawner.setDrops(track.drops, track.spb);
  track.setLayer(0);
  // the intro plays first; beginPlay() starts the music when the craft enters the portal
  G.state = 'intro';
  showOnly(null);
  hud.show(false);
  hud.markers([]);
  intro.start(track.name.replace(/\s*—\s*[\d.]+\s*BPM$/i, ''), `${Math.round(track.bpm)} BPM`);
}

function pause(on) {
  if (on && G.state === 'playing') {
    G.state = 'paused';
    audio.ctx.suspend();
    showOnly(pauseEl);
  } else if (!on && G.state === 'paused') {
    audio.ctx.resume();
    G.state = 'playing';
    showOnly(null);
  }
}

function toMenu() {
  if (track) track.stop();
  if (audio && audio.ctx.state === 'suspended') audio.ctx.resume();
  G.state = 'menu';
  G.build = G.buildAudio = G.surge = G.dropWaveAmp = 0;
  drop.reset();
  shards.clear();
  if (audio) audio.cancelHang();
  hud.show(false);
  showOnly(menuEl);
  showBest();
}

function endRun() {
  G.state = 'results';
  G.build = G.buildAudio = G.surge = G.dropWaveAmp = 0;
  drop.reset();
  shards.clear();
  audio.cancelHang();
  hud.markers([]);
  track.stop();
  hud.show(false);
  const best = loadBest();
  const isBest = G.score > best;
  if (isBest) saveBest(G.score);
  const top = displaySpeed(G.topV);
  const rows = [
    ['SCORE', Math.floor(G.score).toLocaleString() + (isBest ? '  ★ NEW BEST' : ''), true],
    ['TOP SPEED', `${top.value} ${top.unit}`],
    ['HIGHEST TIER', TIERS[G.topTier].name],
    ['DISTANCE', formatDist(G.distKm)],
    ['RINGS', G.gates],
    ['PERFECT BOOSTS', G.perfects],
    ['MAX COMBO', `x${G.maxCombo}`],
    ['CRASHES', G.crashes],
    ['DROPS', track.drops.length ? `${G.perfectDrops} of ${G.drops} perfect` : 'none in this song'],
  ];
  $('results-body').innerHTML = rows
    .map(([k, v, big]) => `<div class="k">${k}</div><div class="v${big ? ' big' : ''}">${v}</div>`)
    .join('');
  showOnly(resultsEl);
}

function loadBest() {
  try {
    return Number(localStorage.getItem('redshift.best')) || 0;
  } catch (e) {
    return 0;
  }
}
function saveBest(s) {
  try {
    localStorage.setItem('redshift.best', String(Math.floor(s)));
  } catch (e) {
    /* storage unavailable */
  }
}
function showBest() {
  const b = loadBest();
  $('best').textContent = b ? `BEST ${b.toLocaleString()}` : '';
}

const tutorial = new Tutorial();
// The first run is preceded by How to Play; its last button starts the run.
function firstRun(go) {
  if (Tutorial.seen) go();
  else tutorial.open({ then: go, finish: "LET'S GO" });
}
$('btn-howto').addEventListener('click', () => tutorial.open());

// Songs that ship with the game: fetched and analysed on first pick, then kept for replays.
const songCache = new Map();
$('song-credit').innerHTML = SONG_CREDIT;
$('song-row').innerHTML = SONGS.map((s, i) => `<button class="btn" type="button" data-song="${i}">${s.title.toUpperCase()} <small>${s.artist}</small></button>`).join('');
const menuButtons = () => document.querySelectorAll('#btn-play, #song-row .btn');
document.querySelectorAll('#song-row .btn').forEach((b) =>
  b.addEventListener('click', async () => {
    const song = SONGS[Number(b.dataset.song)];
    try {
      await ensureAudio();
      menuButtons().forEach((x) => (x.disabled = true));
      let t = songCache.get(song.id);
      if (!t) {
        statusEl.textContent = 'loading…';
        const res = await fetch(song.file);
        if (!res.ok) throw new Error(`${res.status} ${song.file}`);
        const file = new File([await res.blob()], `${song.artist} - ${song.title}.mp3`);
        t = await CustomTrack.load(audio, file, (s) => (statusEl.textContent = s));
        songCache.set(song.id, t);
      }
      customTrack = t;
      useCustom = true;
      statusEl.textContent = `${song.artist} – ${song.title} — ${t.bpm.toFixed(1)} BPM`;
      firstRun(startRun);
    } catch (err) {
      console.error(err);
      statusEl.textContent = "couldn't load that song";
    } finally {
      menuButtons().forEach((x) => (x.disabled = false));
    }
  })
);
$('btn-pause-howto').addEventListener('click', () => tutorial.open());

$('btn-play').addEventListener('click', () => {
  useCustom = false;
  firstRun(startRun);
});
$('file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = '';
  try {
    await ensureAudio();
    $('btn-play').disabled = true;
    customTrack = await CustomTrack.load(audio, file, (s) => (statusEl.textContent = s));
    statusEl.textContent = `${customTrack.name} — ${customTrack.bpm.toFixed(1)} BPM`;
    useCustom = true;
    firstRun(startRun);
  } catch (err) {
    console.error(err);
    statusEl.textContent = "couldn't read that file — try an mp3, ogg or wav";
  } finally {
    $('btn-play').disabled = false;
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pause(true);
});
$('btn-resume').addEventListener('click', () => pause(false));
$('btn-hud-pause').addEventListener('click', () => pause(true));
$('btn-quit').addEventListener('click', toMenu);
$('btn-again').addEventListener('click', startRun);
$('btn-menu').addEventListener('click', toMenu);
showBest();

const PREF_ROWS = [['master', 'VOLUME'], ['music', 'MUSIC'], ['sfx', 'EFFECTS'], ['flash', 'FLASHES']];
document.querySelectorAll('.settings-panel').forEach((panel) => {
  panel.innerHTML =
    PREF_ROWS.map(([k, label]) => `<label class="pref-row"><span>${label}</span><input type="range" min="0" max="100" step="1" data-pref="${k}" /><b></b></label>`).join('') +
    `<button class="vol-mute" type="button"></button>`;
});
document.querySelectorAll('input[data-pref]').forEach((el) =>
  el.addEventListener('input', () => {
    prefs[el.dataset.pref] = el.value / 100;
    if (el.dataset.pref === 'master') prefs.muted = false;
    applyPrefs();
  })
);
document.querySelectorAll('.vol-mute').forEach((b) => b.addEventListener('click', toggleMute));
applyPrefs();

// ------------------------------------------------------------------ loop
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const raw = (now - last) / 1000;
  const dt = Math.min(0.05, raw);
  last = now;
  trackQuality(raw);
  step(dt);
}

function step(dt) {
  if (G.state !== 'paused') {
    G.t += dt;
    if (G.state === 'playing') updatePlaying(dt);
    else if (G.state === 'intro') updateIntro(dt);
    else updateMenu(dt);
    updateVisuals(dt);
    if (G.state === 'intro') intro.apply(prefs.flash < 0.35);
    if (G.state === 'playing') {
      hud.update({
        tier: G.tier,
        prog: tierProgress(G.vSustain, G.tier),
        speed: displaySpeed(G.vs),
        combo: G.combo,
        flux: G.flux,
        timeLeft: (track.durationBeats - G.beatNow) * track.spb,
        distKm: G.distKm,
        score: G.score,
        beatPhase: ((G.beatNow % 1) + 1) % 1,
        pulse: G.pulse,
        jitter: fxs.space * 4 + fxs.sing * 4 + G.pulse * fxs.space * 4,
      });
    }
  }
  fx.render();
}
requestAnimationFrame(frame);

// captureShot(name) saves the current frame as public/tutorial/<name>.jpg (dev server only),
// for refreshing the How to Play screenshots
async function captureShot(name, width = 960) {
  fx.render();
  const c = document.createElement('canvas');
  c.width = width;
  c.height = Math.round((width * canvas.height) / canvas.width);
  c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
  const res = await fetch(`/__shot/${name}`, { method: 'POST', body: c.toDataURL('image/jpeg', 0.86) });
  return res.text();
}

// devStep(seconds) runs the game forward in 1/60 s steps without waiting for frames, for
// testing when the page isn't being drawn
if (DEV) Object.assign(window, { G, U, captureShot, world, player, spawner, fx, camera, drop, shards, quality, fingers, getAudio: () => audio, prefs, intro, devStep: (sec) => { for (let i = 0; i < sec * 60; i++) step(1 / 60); } });
