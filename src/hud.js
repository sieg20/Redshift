import { TIERS } from './speed.js';

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor() {
    this.root = $('hud');
    this.el = {
      tl: $('hud-tl'),
      tierName: $('tier-name'),
      tierFill: $('tier-fill'),
      tierNext: $('tier-next'),
      time: $('time'),
      dist: $('dist'),
      score: $('score'),
      speedVal: $('speed-val'),
      speedUnit: $('speed-unit'),
      speedSub: $('speed-sub'),
      shrink: $('beat-shrink'),
      combo: $('combo'),
      flux: $('flux-fill'),
      popups: $('popups'),
      banner: $('banner'),
      toast: $('toast'),
      countdown: $('countdown'),
    };
    this._tier = -1;
    this._toastT = null;
    this._markers = [];
    const box = $('markers');
    for (let i = 0; i < 6; i++) {
      const m = document.createElement('div');
      m.className = 'marker';
      m.innerHTML = '<i class="core"></i><i class="approach"></i>';
      box.appendChild(m);
      this._markers.push({ el: m, core: m.children[0], approach: m.children[1] });
    }
  }

  // list of { x, y, r (screen px), t (0..1 time left until the ring's beat), a (opacity) }
  markers(list) {
    this._markers.forEach((m, i) => {
      const k = list[i];
      if (!k || k.a <= 0.01) {
        m.el.style.opacity = 0;
        return;
      }
      m.el.style.opacity = k.a.toFixed(3);
      m.el.style.transform = `translate(${k.x.toFixed(1)}px, ${k.y.toFixed(1)}px)`;
      const d = Math.max(8, k.r * 2);
      m.core.style.width = m.core.style.height = `${d}px`;
      const ad = d * (1 + k.t * 2.2);
      m.approach.style.width = m.approach.style.height = `${ad}px`;
      m.approach.style.opacity = (1 - k.t * 0.6).toFixed(3);
    });
  }

  show(on) {
    this.root.classList.toggle('hidden', !on);
  }

  update(s) {
    const e = this.el;
    if (s.tier !== this._tier) {
      this._tier = s.tier;
      e.tl.style.color = TIERS[s.tier].color;
      e.tierName.textContent = TIERS[s.tier].name;
      e.tierNext.textContent = s.tier < TIERS.length - 1 ? `next: ${TIERS[s.tier + 1].name}` : 'beyond the edge';
    }
    e.tierFill.style.width = `${(s.prog * 100).toFixed(1)}%`;
    e.speedVal.textContent = s.speed.value;
    // the readout itself shudders once space starts warping
    const j = s.jitter || 0;
    e.speedVal.style.transform = j ? `translate(${((Math.random() - 0.5) * j).toFixed(1)}px, ${((Math.random() - 0.5) * j).toFixed(1)}px)` : '';
    e.speedUnit.textContent = s.speed.unit;
    e.speedSub.textContent = s.speed.sub;
    e.combo.textContent = `x${s.combo}`;
    e.flux.style.width = `${(s.flux * 100).toFixed(1)}%`;
    const left = Math.max(0, s.timeLeft);
    e.time.textContent = `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`;
    e.dist.textContent = formatDist(s.distKm);
    e.score.textContent = Math.floor(s.score).toLocaleString();
    // ring closes in on the core exactly on the beat
    e.shrink.style.transform = `scale(${1 + (1 - s.beatPhase) * 0.9})`;
    e.shrink.style.opacity = 0.25 + s.beatPhase * 0.75;
    document.documentElement.style.setProperty('--hud-pulse', s.pulse.toFixed(3));
  }

  pop(text, color = '#fff', dy = 0) {
    const d = document.createElement('div');
    d.className = 'pop';
    d.textContent = text;
    d.style.color = color;
    d.style.marginTop = `${dy}px`;
    this.el.popups.appendChild(d);
    setTimeout(() => d.remove(), 850);
  }

  banner(text, color) {
    const b = this.el.banner;
    b.textContent = text;
    b.style.color = color;
    b.style.textShadow = `0 0 30px ${color}, 0 0 80px ${color}`;
    b.classList.remove('show');
    void b.offsetWidth;
    b.classList.add('show');
  }

  // Build-up countdown (4, 3, 2, 1), then the drop call-out; `big` for the drop itself.
  // `sub` is an optional small line above it (e.g. PERFECT over DROP).
  countdown(text, big = false, sub = '') {
    const c = this.el.countdown;
    c.textContent = text;
    if (sub) {
      const s = document.createElement('small');
      s.textContent = sub;
      c.prepend(s);
    }
    c.classList.toggle('big', big);
    c.classList.remove('show');
    void c.offsetWidth;
    c.classList.add('show');
  }

  toast(text) {
    const t = this.el.toast;
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => t.classList.remove('show'), 1200);
  }
}

export function formatDist(km) {
  if (km < 1e5) return `${km.toFixed(km < 10 ? 2 : 0)} km`;
  if (km < 1.496e7) return `${(km / 1e6).toFixed(2)} M km`;
  return `${(km / 1.496e8).toFixed(2)} AU`;
}
