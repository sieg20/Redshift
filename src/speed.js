// Speed tiers, how "true" speed maps to the number on the HUD, and how
// fast the world actually scrolls (gameplay stays readable; effects sell the rest).

export const TIERS = [
  { name: 'CRUISE', min: 0, color: '#e9f3ff' },
  { name: 'BLUR', min: 90, color: '#3ef2ff' },
  { name: 'MIRAGE', min: 170, color: '#ffb347' },
  { name: 'SONIC', min: 260, color: '#ffffff' },
  { name: 'WARP', min: 360, color: '#9d7bff' },
  { name: 'SINGULARITY', min: 480, color: '#ff3edc' },
];
export const V_MIN = 40;
export const V_MAX = 640;

export function tierOf(v, current) {
  // hysteresis: need to fall 8% under a tier's floor to drop out of it
  let t = 0;
  for (let i = TIERS.length - 1; i >= 0; i--) {
    const floor = i <= current ? TIERS[i].min * 0.92 : TIERS[i].min;
    if (v >= floor) {
      t = i;
      break;
    }
  }
  return t;
}

export function tierProgress(v, t) {
  if (t >= TIERS.length - 1) return Math.min(1, (v - TIERS[t].min) / (V_MAX - TIERS[t].min));
  return Math.max(0, Math.min(1, (v - TIERS[t].min) / (TIERS[t + 1].min - TIERS[t].min)));
}

// Anchors: internal v -> "real" metres per second shown to the player.
const C = 299792458;
const ANCHORS = [
  [V_MIN, 22],
  [90, 85],
  [170, 210],
  [260, 343],
  [360, 0.05 * C],
  [480, 0.92 * C],
  [V_MAX, 2.4 * C],
];

// The "real" speed in m/s that internal speed v represents.
export function displayMs(v) {
  for (let i = 0; i < ANCHORS.length - 1; i++) {
    const [v0, d0] = ANCHORS[i];
    const [v1, d1] = ANCHORS[i + 1];
    if (v <= v1) {
      const t = Math.max(0, (v - v0) / (v1 - v0));
      return Math.exp(Math.log(d0) + (Math.log(d1) - Math.log(d0)) * t);
    }
  }
  return ANCHORS[ANCHORS.length - 1][1];
}

export function displaySpeed(v) {
  const ms = displayMs(v);
  if (ms < 343) return { value: Math.round(ms * 3.6).toLocaleString(), unit: 'KM/H', sub: '' };
  if (ms < 0.01 * C) {
    const mach = ms / 343;
    return { value: mach < 100 ? mach.toFixed(1) : Math.round(mach).toLocaleString(), unit: 'MACH', sub: mach > 30 ? 'HYPERSONIC' : '' };
  }
  const c = ms / C;
  const gamma = c < 1 ? 1 / Math.sqrt(1 - c * c) : Infinity;
  return {
    value: c.toFixed(c < 1 ? 3 : 2),
    unit: '× LIGHT',
    sub: c < 1 ? `TIME DILATION ×${gamma.toFixed(gamma < 10 ? 2 : 0)}` : 'CAUSALITY: OPTIONAL',
  };
}

// How fast the track scrolls under you, in world units / s.
// Past WARP it keeps climbing (~250 u/s at the cap) so the top tiers actually move faster.
export function worldSpeed(v) {
  return 34 + 112 * (1 - Math.exp(-v / 230)) + 110 * smooth(330, V_MAX, v);
}

export const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
