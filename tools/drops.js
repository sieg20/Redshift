// Drop Labeller: runs the game's beat analysis on a song, shows where the detector puts the
// drops, and lets you mark where they really are. Saves to scripts/drop-corpus/ through the
// dev server (see vite.config.js).

import { analyzeBeats, findDrops, DROP_DEFAULTS } from '../src/audio/customTrack.js';

const $ = (id) => document.getElementById(id);
const canvas = $('plot');
const g = canvas.getContext('2d');
const audio = new Audio();

let song = null; // { name, file, bpm, offset, duration, loudDb, bassDb, detected }
let labels = [];

const beatTime = (b) => song.offset + (b * 60) / song.bpm;
const timeBeat = (t) => ((t - song.offset) * song.bpm) / 60;
const fmt = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
const slug = (s) => s.toLowerCase().replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);

function status(t) {
  $('status').textContent = t;
}

$('file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = '';
  status('decoding…');
  const data = await file.arrayBuffer();
  const buf = await new OfflineAudioContext(2, 44100, 44100).decodeAudioData(data.slice(0));
  status('analysing…');
  await new Promise((r) => setTimeout(r, 20));
  const r = analyzeBeats(buf);
  song = {
    name: slug(file.name),
    file: file.name,
    bpm: r.bpm,
    offset: r.offset,
    duration: buf.duration,
    loudDb: Array.from(r.loudDb, (x) => +x.toFixed(2)),
    bassDb: Array.from(r.bassDb, (x) => +x.toFixed(2)),
    detected: r.drops,
  };
  labels = [];
  audio.src = URL.createObjectURL(file);
  // pick up labels saved earlier for the same song
  try {
    const res = await fetch(`/__drop-corpus/${song.name}`);
    if (res.ok) {
      const j = await res.json();
      if (Array.isArray(j.drops)) labels = j.drops.slice();
      status(`loaded ${labels.length} saved label(s)`);
    } else status('');
  } catch {
    status('');
  }
  $('info').textContent = `${file.name} — ${fmt(buf.duration)}, ${r.bpm.toFixed(1)} BPM, ${song.loudDb.length} beats`;
  render();
});

function toggleLabel(b) {
  const near = labels.findIndex((l) => Math.abs(l - b) <= 2);
  if (near >= 0) labels.splice(near, 1);
  else labels.push(b);
  labels.sort((x, y) => x - y);
  render();
}

function nudgeNearest(d) {
  if (!song || !labels.length) return;
  const b = timeBeat(audio.currentTime);
  let i = 0;
  labels.forEach((l, j) => {
    if (Math.abs(l - b) < Math.abs(labels[i] - b)) i = j;
  });
  labels[i] = Math.max(0, labels[i] + d);
  labels.sort((x, y) => x - y);
  render();
}

function playFrom(t) {
  audio.currentTime = Math.max(0, t);
  audio.play();
}

$('play').addEventListener('click', () => (audio.paused ? audio.play() : audio.pause()));
$('use').addEventListener('click', () => {
  if (!song) return;
  labels = song.detected.slice();
  render();
});
$('clear').addEventListener('click', () => {
  labels = [];
  render();
});
$('save').addEventListener('click', async () => {
  if (!song) return;
  const { detected, ...rest } = song;
  const res = await fetch(`/__drop-corpus/${song.name}`, {
    method: 'POST',
    body: JSON.stringify({ ...rest, drops: labels }),
  });
  status(res.ok ? `saved scripts/drop-corpus/${song.name}.json` : `save failed: ${await res.text()}`);
});

const xToBeat = (x) => Math.round((x / canvas.clientWidth) * song.loudDb.length);
canvas.addEventListener('click', (e) => {
  if (!song) return;
  const r = canvas.getBoundingClientRect();
  const b = xToBeat(e.clientX - r.left);
  if (e.shiftKey) toggleLabel(b);
  else audio.currentTime = Math.max(0, beatTime(b));
});

addEventListener('keydown', (e) => {
  if (!song) return;
  if (e.code === 'Space') {
    e.preventDefault();
    audio.paused ? audio.play() : audio.pause();
  } else if (e.code === 'KeyM') toggleLabel(Math.round(timeBeat(audio.currentTime)));
  else if (e.code === 'ArrowLeft') audio.currentTime = Math.max(0, audio.currentTime - 2);
  else if (e.code === 'ArrowRight') audio.currentTime += 2;
  else if (e.code === 'Comma') nudgeNearest(-1);
  else if (e.code === 'Period') nudgeNearest(1);
});
audio.addEventListener('play', () => ($('play').textContent = 'Pause'));
audio.addEventListener('pause', () => ($('play').textContent = 'Play'));

function listRows(el, beats, cls, other) {
  el.innerHTML = '';
  if (!beats.length) el.innerHTML = '<div class="item" style="color:var(--dim)">none</div>';
  for (const b of beats) {
    const row = document.createElement('div');
    row.className = `item ${cls}`;
    const matched = other.some((o) => Math.abs(o - b) <= 1);
    row.innerHTML = `<b>${fmt(beatTime(b))} · beat ${b}</b>${matched ? '' : `<span class="miss">${cls === 'label' ? 'not detected' : 'not a label'}</span>`}`;
    const btn = document.createElement('button');
    btn.textContent = 'play';
    btn.addEventListener('click', () => playFrom(beatTime(b) - 4));
    row.appendChild(btn);
    el.appendChild(row);
  }
}

function render(lists = true) {
  const dpr = devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== w * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  if (!song) return;
  const n = song.loudDb.length;
  const bw = DROP_DEFAULTS.bassWeight;
  const lv = song.loudDb.map((l, i) => (1 - bw) * l + bw * song.bassDb[i]);
  const all = song.loudDb.concat(lv).filter(Number.isFinite);
  const hi = Math.max(...all), lo = Math.max(Math.min(...all), hi - 45);
  const y = (db) => h - 8 - ((Math.max(lo, db) - lo) / (hi - lo)) * (h - 24);
  const x = (b) => (b / n) * w;

  g.fillStyle = '#5a527f';
  for (let i = 0; i < n; i++) g.fillRect(x(i), y(song.loudDb[i]), Math.max(1, w / n), h - y(song.loudDb[i]));
  g.strokeStyle = '#3ef2ff';
  g.lineWidth = 1.5;
  g.beginPath();
  lv.forEach((v, i) => (i ? g.lineTo(x(i), y(v)) : g.moveTo(x(i), y(v))));
  g.stroke();

  const line = (b, color, dash, top) => {
    g.strokeStyle = color;
    g.setLineDash(dash);
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x(b), top);
    g.lineTo(x(b), h);
    g.stroke();
    g.setLineDash([]);
  };
  song.detected.forEach((b) => line(b, '#ffd166', [5, 4], 0));
  labels.forEach((b) => line(b, '#5dff9b', [], 14));

  // minute ticks
  g.fillStyle = '#8a84aa';
  g.font = '11px system-ui';
  for (let t = 0; t < song.duration; t += 30) g.fillText(fmt(t).replace('.0', ''), x(timeBeat(t)) + 2, 11);

  const ph = timeBeat(audio.currentTime);
  g.fillStyle = '#ffffff';
  g.fillRect(x(ph) - 1, 0, 2, h);

  if (!lists) return;
  listRows($('labels'), labels, 'label', song.detected);
  listRows($('detected'), song.detected, 'det', labels);
}

// redraw the playhead while playing
(function tick() {
  requestAnimationFrame(tick);
  if (song && !audio.paused) render(false);
})();
addEventListener('resize', render);

// Lets an automated check rerun the detector against the current labels.
window.dropLabeller = { get song() { return song; }, get labels() { return labels; }, set labels(v) { labels = v; render(); }, findDrops };
