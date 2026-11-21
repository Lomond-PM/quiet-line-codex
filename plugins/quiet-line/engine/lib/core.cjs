/* ============================================================
   A QUIET LINE — shared art core
   Pure geometry: shapes, hand-drawn stroke construction, washes,
   hatching and the six richer studies. It runs unchanged in the
   browser board and in the Node renderer used by the DSH plugin.
   ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QuietLineCore = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smoothstep = (a, b, x) => {
    const t = clamp((x - a) / (b - a || 1), 0, 1);
    return t * t * (3 - 2 * t);
  };

  /* ---------- deterministic randomness ---------------------- */

  function mulberry32(a) {
    a = a >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function mixSeeds() {
    let h = 0x811c9dc5;
    for (let i = 0; i < arguments.length; i++) {
      let v = (arguments[i] | 0) >>> 0;
      v = Math.imul(v ^ (v >>> 16), 0x7feb352d);
      h ^= Math.imul(v + 0x9e3779b9, 0x85ebca6b);
      h = (h << 13) | (h >>> 19);
      h = (h + 0x27d4eb2d) >>> 0;
    }
    return h >>> 0;
  }

  function hash1(i, seed) {
    let h = Math.imul(i | 0, 0x27d4eb2d) ^ Math.imul(seed | 0, 0x165667b1);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296 * 2 - 1;
  }

  function noise1(x, seed) {
    const i = Math.floor(x);
    const f = x - i;
    const u = f * f * (3 - 2 * f);
    return lerp(hash1(i, seed), hash1(i + 1, seed), u);
  }

  function fbm(x, seed) {
    return (
      noise1(x, seed) * 0.62 +
      noise1(x * 2.17 + 11.7, seed + 17) * 0.26 +
      noise1(x * 4.39 + 3.1, seed + 83) * 0.12
    );
  }

  /* ---------- brushes, surfaces, palette -------------------- */

  const DEFAULT_ACCENT = '#ad4f2f';

  const SURFACES = {
    warm: {
      id: 'warm', title: 'Warm paper', cn: '暖白纸',
      top: '#f8f3e8', mid: '#f3ede1', bottom: '#eee5d5',
      ink: '#2c2821', accent: '#ad4f2f',
      clay: [196, 161, 128], ochre: [195, 138, 76], sage: [139, 148, 128],
      tooth: 0.55, grain: 1.0, texture: 'fibre', dark: false
    },
    coldpress: {
      id: 'coldpress', title: 'Cold-press watercolor', cn: '水彩纸',
      top: '#faf7f0', mid: '#f2ece2', bottom: '#e6dfd3',
      ink: '#2e2b26', accent: '#a65338',
      clay: [192, 170, 145], ochre: [190, 145, 92], sage: [136, 146, 130],
      tooth: 0.92, grain: 1.18, texture: 'watercolor', dark: false
    },
    kraft: {
      id: 'kraft', title: 'Kraft paper', cn: '牛皮纸',
      top: '#d7ba8f', mid: '#c8a577', bottom: '#b38c5f',
      ink: '#34261b', accent: '#753a2a',
      clay: [150, 112, 77], ochre: [166, 119, 68], sage: [112, 118, 93],
      tooth: 0.8, grain: 1.05, texture: 'kraft', dark: false
    },
    linen: {
      id: 'linen', title: 'Linen canvas', cn: '亚麻布',
      top: '#efe4ce', mid: '#e7dac1', bottom: '#d7c5a4',
      ink: '#39332a', accent: '#a45236',
      clay: [176, 144, 110], ochre: [177, 132, 80], sage: [123, 130, 108],
      tooth: 0.7, grain: 1.0, texture: 'weave', dark: false
    },
    newsprint: {
      id: 'newsprint', title: 'Newsprint', cn: '新闻纸',
      top: '#eae8e0', mid: '#e1ded3', bottom: '#d1cdc0',
      ink: '#30322f', accent: '#9c4e3b',
      clay: [180, 160, 140], ochre: [176, 140, 96], sage: [126, 134, 120],
      tooth: 0.85, grain: 1.15, texture: 'newsprint', dark: false
    },
    charcoal: {
      id: 'charcoal', title: 'Charcoal paper', cn: '炭黑纸',
      top: '#3a3935', mid: '#2e2c29', bottom: '#23211f',
      ink: '#ece5d6', accent: '#d98963',
      clay: [190, 170, 150], ochre: [205, 160, 108], sage: [165, 176, 158],
      tooth: 0.6, grain: 0.9, texture: 'charcoal', dark: true
    }
  };

  const BRUSHES = {
    ink: {
      id: 'ink', title: 'Ink pen', cn: '墨线',
      widthScale: 1.0, alpha: 1.0, pressureScale: 1.0, edgeScale: 1.0,
      wobbleScale: 1.0, grainScale: 1.0, cap: 'round', taperStart: 0.34, taperEnd: 0.2,
      passes: [{ offset: 0, width: 1, alpha: 1 }]
    },
    fountain: {
      id: 'fountain', title: 'Fountain pen', cn: '钢笔',
      widthScale: 0.64, alpha: 1.0, pressureScale: 1.25, edgeScale: 0.55,
      wobbleScale: 0.92, grainScale: 0.5, cap: 'round', taperStart: 0.3, taperEnd: 0.14,
      passes: [{ offset: 0, width: 1, alpha: 1 }]
    },
    pencil: {
      id: 'pencil', title: 'Pencil', cn: '铅笔',
      widthScale: 0.82, alpha: 0.9, pressureScale: 0.82, edgeScale: 1.5,
      wobbleScale: 1.05, grainScale: 1.45, cap: 'round', taperStart: 0.34, taperEnd: 0.24,
      passes: [
        { offset: 0, width: 1, alpha: 0.68 },
        { offset: 0.18, width: 0.54, alpha: 0.38, trim: 0.035, bristle: 0.055 }
      ]
    },
    charcoal: {
      id: 'charcoal', title: 'Charcoal', cn: '炭条',
      widthScale: 1.24, alpha: 1.0, pressureScale: 1.12, edgeScale: 2.0,
      wobbleScale: 1.1, grainScale: 1.5, cap: 'round', taperStart: 0.42, taperEnd: 0.28,
      passes: [
        { offset: 0, width: 1.24, alpha: 0.45, trim: 0.012 },
        { offset: -0.3, width: 0.8, alpha: 0.4, trim: 0.04, bristle: 0.07 },
        { offset: 0.36, width: 0.44, alpha: 0.35, trim: 0.07, bristle: 0.09 }
      ]
    },
    brush: {
      id: 'brush', title: 'Brush', cn: '毛笔',
      widthScale: 1.32, alpha: 1.0, pressureScale: 1.0, edgeScale: 1.3,
      wobbleScale: 1.0, grainScale: 1.0, cap: 'round', taperStart: 0.26, taperEnd: 0.14,
      passes: [
        { offset: 0, width: 1.1, alpha: 0.94 },
        { offset: -0.46, width: 0.28, alpha: 0.34, trim: 0.05, bristle: 0.055 },
        { offset: 0.4, width: 0.22, alpha: 0.3, trim: 0.08, bristle: 0.075 },
        { offset: -0.18, width: 0.14, alpha: 0.22, trim: 0.12, bristle: 0.09 }
      ]
    },
    marker: {
      id: 'marker', title: 'Marker', cn: '马克',
      widthScale: 1.18, alpha: 0.92, pressureScale: 0.22, edgeScale: 0.45,
      wobbleScale: 0.62, grainScale: 0.55, cap: 'flat', taperStart: 0.55, taperEnd: 0.52,
      pressMin: 0.78, pressMax: 1.12,
      passes: [
        { offset: 0, width: 1.14, alpha: 0.62 },
        { offset: 0.22, width: 0.62, alpha: 0.26, trim: 0.02 }
      ]
    },
    oil: {
      id: 'oil', title: 'Oil brush', cn: '油画',
      widthScale: 1.5, alpha: 1.0, pressureScale: 0.58, edgeScale: 0.42,
      wobbleScale: 0.7, grainScale: 0.42, cap: 'flat', taperStart: 0.62, taperEnd: 0.58,
      pressMin: 0.72, pressMax: 1.22,
      passes: [
        { offset: 0, width: 1.18, alpha: 0.95 },
        { offset: -0.24, width: 0.82, alpha: 0.34, tint: 0.24, bristle: 0.07, trim: 0.01 },
        { offset: 0.28, width: 0.58, alpha: 0.3, tint: -0.22, bristle: 0.09, trim: 0.02 },
        { offset: 0, width: 0.52, alpha: 0.26, tint: 0.32, bristle: 0.035, trim: 0.015 }
      ]
    },
    oilknife: {
      id: 'oilknife', title: 'Palette knife', cn: '油刀',
      widthScale: 1.72, alpha: 1.0, pressureScale: 0.28, edgeScale: 0.22,
      wobbleScale: 0.45, grainScale: 0.3, cap: 'flat', taperStart: 0.74, taperEnd: 0.7,
      pressMin: 0.84, pressMax: 1.1,
      passes: [
        { offset: 0, width: 1.2, alpha: 0.96 },
        { offset: -0.3, width: 0.7, alpha: 0.3, tint: 0.34, bristle: 0.025, trim: 0.005 },
        { offset: 0.3, width: 0.45, alpha: 0.24, tint: -0.26, bristle: 0.02, trim: 0.008 }
      ]
    }
  };

  const THEME = {
    ink: [44, 40, 33],
    accent: [173, 79, 47],
    clay: [196, 161, 128],
    ochre: [195, 138, 76],
    sage: [139, 148, 128],
    paper: [244, 238, 226]
  };

  function hexToRgb(hex) {
    const value = String(hex || '').replace('#', '');
    if (!/^[0-9a-f]{6}$/i.test(value)) return null;
    return [
      parseInt(value.slice(0, 2), 16),
      parseInt(value.slice(2, 4), 16),
      parseInt(value.slice(4, 6), 16)
    ];
  }

  function buildPalette(accent, surfaceId) {
    const surface = SURFACES[surfaceId] || SURFACES.warm;
    const custom = hexToRgb(accent);
    return {
      ink: hexToRgb(surface.ink) || THEME.ink,
      accent: custom || hexToRgb(surface.accent) || THEME.accent,
      clay: surface.clay.slice(),
      ochre: surface.ochre.slice(),
      sage: surface.sage.slice(),
      paper: hexToRgb(surface.mid) || THEME.paper
    };
  }

  function resolveColor(value, palette) {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string' && value[0] === '#') {
      return hexToRgb(value) || palette.ink;
    }
    return palette[value] || palette.ink;
  }

  function shadeColor(color, amount) {
    if (!amount) return color;
    const k = Math.max(-1, Math.min(1, amount));
    return color.map(c => {
      const v = k > 0 ? c + (255 - c) * k : c * (1 + k);
      return Math.max(0, Math.min(255, Math.round(v)));
    });
  }

  /* ---------- drawing helpers for the sketches -------------- */

  function stroke(points, options) {
    return Object.assign({ type: 'stroke', points }, options || {});
  }

  function fill(points, options) {
    return Object.assign({ type: 'fill', points }, options || {});
  }

  function dot(x, y, r, options) {
    return Object.assign({ type: 'dot', x, y, r }, options || {});
  }

  function ellipsePoints(cx, cy, rx, ry, options) {
    const o = options || {};
    const start = o.start == null ? 0 : o.start;
    const sweep = o.sweep == null ? TAU : o.sweep;
    const steps = o.steps || Math.max(28, Math.ceil(Math.abs(sweep) / 0.045));
    const rot = o.rotate || 0;
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const a = start + (i / steps) * sweep;
      let x = Math.cos(a) * rx;
      let y = Math.sin(a) * ry;
      pts.push([
        cx + x * Math.cos(rot) - y * Math.sin(rot),
        cy + x * Math.sin(rot) + y * Math.cos(rot)
      ]);
    }
    return pts;
  }

  function ellipse(cx, cy, rx, ry, options) {
    const o = options || {};
    const start = o.start == null ? 0 : o.start;
    const sweep = o.sweep == null ? TAU + 0.22 : o.sweep;
    const pts = ellipsePoints(cx, cy, rx, ry, Object.assign({}, o, { start, sweep }));
    return stroke(pts, o);
  }

  function fillEllipse(cx, cy, rx, ry, options) {
    const o = options || {};
    return fill(ellipsePoints(cx, cy, rx, ry, {
      start: 0, sweep: TAU, steps: o.steps || 48, rotate: o.rotate || 0
    }), o);
  }

  function curve(points, options) {
    const o = options || {};
    const steps = o.steps || 14;
    const closed = !!o.closed;
    const p = points;
    const out = [];
    const n = p.length;
    const at = i => {
      if (closed) return p[(i + n) % n];
      return p[Math.max(0, Math.min(n - 1, i))];
    };
    const segments = closed ? n : n - 1;
    for (let i = 0; i < segments; i++) {
      const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
      for (let k = 0; k < steps; k++) {
        const t = k / steps;
        const t2 = t * t, t3 = t2 * t;
        const x = 0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
        const y = 0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
        out.push([x, y]);
      }
    }
    out.push(closed ? p[0] : p[n - 1]);
    return stroke(out, o);
  }

  function poly(points, radius, options) {
    const r = radius == null ? 0.006 : radius;
    const out = [];
    if (points.length < 2) return stroke(points, options || {});
    out.push(points[0]);
    for (let i = 1; i < points.length - 1; i++) {
      const prev = points[i - 1], cur = points[i], next = points[i + 1];
      const d1 = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
      const d2 = Math.hypot(next[0] - cur[0], next[1] - cur[1]);
      const rr = Math.min(r, d1 * 0.42, d2 * 0.42);
      const a = [cur[0] + (prev[0] - cur[0]) / (d1 || 1) * rr, cur[1] + (prev[1] - cur[1]) / (d1 || 1) * rr];
      const b = [cur[0] + (next[0] - cur[0]) / (d2 || 1) * rr, cur[1] + (next[1] - cur[1]) / (d2 || 1) * rr];
      out.push(a);
      for (let k = 1; k <= 7; k++) {
        const t = k / 7;
        const u = 1 - t;
        out.push([
          u * u * a[0] + 2 * u * t * cur[0] + t * t * b[0],
          u * u * a[1] + 2 * u * t * cur[1] + t * t * b[1]
        ]);
      }
    }
    out.push(points[points.length - 1]);
    return stroke(out, options || {});
  }

  function roundRectPoints(x, y, w, h, r, steps) {
    const rr = Math.min(r, w / 2, h / 2);
    const n = steps || 6;
    const pts = [];
    const arc = (cx, cy, a0, a1) => {
      for (let i = 0; i <= n; i++) {
        const a = a0 + (a1 - a0) * (i / n);
        pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
      }
    };
    pts.push([x + rr, y]);
    pts.push([x + w - rr, y]);
    arc(x + w - rr, y + rr, -Math.PI / 2, 0);
    pts.push([x + w, y + h - rr]);
    arc(x + w - rr, y + h - rr, 0, Math.PI / 2);
    pts.push([x + rr, y + h]);
    arc(x + rr, y + h - rr, Math.PI / 2, Math.PI);
    pts.push([x, y + rr]);
    arc(x + rr, y + rr, Math.PI, Math.PI * 1.5);
    return pts;
  }

  function leafShape(base, tip, width, lean) {
    const dx = tip[0] - base[0];
    const dy = tip[1] - base[1];
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const nx = -uy, ny = ux;
    const bend = lean == null ? 0 : lean;
    const mid = [(base[0] + tip[0]) / 2, (base[1] + tip[1]) / 2];
    const ctrl = [mid[0] + nx * bend, mid[1] + ny * bend];

    const center = s => {
      const u = 1 - s;
      return [
        u * u * base[0] + 2 * u * s * ctrl[0] + s * s * tip[0],
        u * u * base[1] + 2 * u * s * ctrl[1] + s * s * tip[1]
      ];
    };
    const derivative = s => {
      const u = 1 - s;
      return [
        2 * u * (ctrl[0] - base[0]) + 2 * s * (tip[0] - ctrl[0]),
        2 * u * (ctrl[1] - base[1]) + 2 * s * (tip[1] - ctrl[1])
      ];
    };

    const steps = 30;
    const left = [];
    const right = [];
    const vein = [];
    for (let i = 0; i <= steps; i++) {
      const s = i / steps;
      const c = center(s);
      const d = derivative(s);
      const dl = Math.hypot(d[0], d[1]) || 1;
      const snx = -d[1] / dl;
      const sny = d[0] / dl;
      const shape = Math.pow(Math.sin(Math.PI * Math.pow(s, 0.88)), 0.74);
      const w = width * shape;
      const asym = 1 + 0.055 * Math.sin(s * Math.PI * 1.25 + 0.4);
      left.push([c[0] + snx * w * asym, c[1] + sny * w * asym]);
      right.push([c[0] - snx * w * (2 - asym), c[1] - sny * w * (2 - asym)]);
      if (i >= 2 && i <= steps - 1) vein.push(c);
    }

    const outline = left.slice();
    for (let i = right.length - 2; i >= 1; i--) outline.push(right[i]);
    outline.push([base[0] + ux * len * 0.006, base[1] + uy * len * 0.006]);
    return { outline, vein };
  }

  /**
   * Hand-hatched fill: parallel lines clipped to a polygon, then left
   * for the stroke engine to wobble. Each line is a separate pen pass.
   */
  function hatch(points, options) {
    const o = Object.assign({
      gap: 0.022, angle: -32, color: 'ink', width: 0.42,
      opacity: 0.26, inset: 0.006, seed: 7
    }, options || {});
    const rng = mulberry32(mixSeeds(o.seed, 0x51a7));
    const rad = (o.angle || 0) * Math.PI / 180;
    const cos = Math.cos(-rad), sin = Math.sin(-rad);
    let cx = 0, cy = 0;
    for (const p of points) { cx += p[0]; cy += p[1]; }
    cx /= points.length;
    cy /= points.length;
    const rot = p => {
      const dx = p[0] - cx, dy = p[1] - cy;
      return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
    };
    const back = p => {
      const dx = p[0] - cx, dy = p[1] - cy;
      return [cx + dx * cos + dy * sin, cy - dx * sin + dy * cos];
    };
    const poly = points.map(rot);
    let minY = Infinity, maxY = -Infinity;
    for (const p of poly) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
    const lines = [];
    let guard = 0;
    for (let y = minY + o.gap * 0.55; y < maxY && guard < 240; y += o.gap) {
      const xs = [];
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
          const t = (y - a[1]) / (b[1] - a[1] || 1);
          xs.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
        }
      }
      xs.sort((a, b) => a[0] - b[0]);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const x0 = xs[i][0] + o.inset + rng() * 0.004;
        const x1 = xs[i + 1][0] - o.inset - rng() * 0.004;
        if (x1 - x0 < 0.012) continue;
        const a = back([x0, y]);
        const b = back([x1, y]);
        lines.push(stroke([a, b], {
          color: o.color, width: o.width, opacity: o.opacity,
          overshoot: 0.05, registration: 0.25
        }));
        guard++;
      }
    }
    return lines;
  }

  /* ---------- geometry --------------------------------------- */

  function resample(points, step, closed) {
    if (points.length < 2) return points.slice();
    const src = closed ? points.concat([points[0]]) : points;
    let total = 0;
    const cum = [0];
    for (let i = 1; i < src.length; i++) {
      total += Math.hypot(src[i][0] - src[i - 1][0], src[i][1] - src[i - 1][1]);
      cum.push(total);
    }
    if (total < 0.001) return [src[0].slice(), src[0].slice()];
    const n = Math.max(3, Math.ceil(total / step));
    const out = [];
    let seg = 0;
    for (let j = 0; j < n; j++) {
      const d = (j / (n - 1)) * total;
      while (seg < src.length - 2 && cum[seg + 1] < d) seg++;
      const span = cum[seg + 1] - cum[seg] || 1;
      const t = clamp((d - cum[seg]) / span, 0, 1);
      out.push([
        lerp(src[seg][0], src[seg + 1][0], t),
        lerp(src[seg][1], src[seg + 1][1], t)
      ]);
    }
    return out;
  }

  function arcLength(points) {
    let len = 0;
    for (let i = 1; i < points.length; i++) {
      len += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    }
    return len;
  }

  function normals(points) {
    const out = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[Math.max(0, i - 1)];
      const b = points[Math.min(points.length - 1, i + 1)];
      let tx = b[0] - a[0];
      let ty = b[1] - a[1];
      const l = Math.hypot(tx, ty) || 1;
      tx /= l;
      ty /= l;
      out.push([-ty, tx]);
    }
    return out;
  }

  function rotatePoint(x, y, cx, cy, angle) {
    const c = Math.cos(angle), s = Math.sin(angle);
    const dx = x - cx, dy = y - cy;
    return [cx + dx * c - dy * s, cy + dx * s + dy * c];
  }

  // Controls are attached to geometry samples, never indexed by sample count.
  // A single forward cursor keeps resampling linear even for long polylines.
  const CONTROL_RANGES = { pressure: [0, 1], width: [0, 3], opacity: [0, 1], angle: [-360, 360], tilt: [0, 1] };
  function strokeControls(item, points) {
    const active = item.controls != null || ['hardness', 'flow', 'tip', 'aspect', 'angle', 'tilt', 'cap'].some(k => item[k] != null);
    if (!active) return null;
    for (const [k, range] of Object.entries({ hardness: [0, 1], flow: [0, 1], aspect: [0.05, 1], angle: [-360, 360], tilt: [0, 1] })) {
      if (item[k] != null && (!Number.isFinite(item[k]) || item[k] < range[0] || item[k] > range[1])) throw new RangeError(`stroke.${k} out of range`);
    }
    if (item.tip != null && !['round', 'flat'].includes(item.tip)) throw new TypeError('stroke.tip must be round or flat');
    if (item.cap != null && !['round', 'flat', 'taper'].includes(item.cap)) throw new TypeError('stroke.cap must be round, flat or taper');
    const controls = item.controls == null ? points.map(() => ({})) : item.controls;
    if (!Array.isArray(controls) || controls.length !== points.length) throw new TypeError('controls must match points length');
    return controls.map(c => {
      if (!c || typeof c !== 'object' || Array.isArray(c)) throw new TypeError('each control must be an object');
      for (const [k, range] of Object.entries(CONTROL_RANGES)) {
        if (c[k] != null && (!Number.isFinite(c[k]) || c[k] < range[0] || c[k] > range[1])) throw new RangeError(`control.${k} out of range`);
      }
      return { pressure: c.pressure == null ? 1 : c.pressure, width: c.width == null ? 1 : c.width,
        opacity: c.opacity == null ? 1 : c.opacity, angle: c.angle == null ? (item.angle || 0) : c.angle,
        tilt: c.tilt == null ? (item.tilt || 0) : c.tilt };
    });
  }
  function interpolateControl(a, b, t) {
    const out = {};
    for (const k of ['pressure', 'width', 'opacity', 'tilt']) out[k] = lerp(a[k], b[k], t);
    const delta = ((b.angle - a.angle) % 360 + 540) % 360 - 180;
    out.angle = a.angle + delta * t;
    return out;
  }
  function resampleControls(points, controls, count, closed) {
    const src = closed ? points.concat([points[0]]) : points;
    const cs = closed ? controls.concat([controls[0]]) : controls;
    const cum = [0];
    for (let i = 1; i < src.length; i++) cum.push(cum[i - 1] + Math.hypot(src[i][0] - src[i - 1][0], src[i][1] - src[i - 1][1]));
    const total = cum[cum.length - 1];
    let seg = 0;
    return Array.from({ length: count }, (_, i) => {
      const d = total * i / Math.max(1, count - 1);
      while (seg < src.length - 2 && cum[seg + 1] < d) seg++;
      return interpolateControl(cs[seg], cs[seg + 1], clamp((d - cum[seg]) / (cum[seg + 1] - cum[seg] || 1), 0, 1));
    });
  }

  // Smooth geometry only: the control object at each anchor travels with it.
  // Averaging controls here would blur deliberate zero-pressure/opacity stops.
  // Radius is bounded, so work and scratch space stay local to this stroke.
  function roundControlledPath(points, radius, closed) {
    const n = points.length;
    if (n < 5) return points;
    let current = points;
    for (let pass = 0; pass < 2; pass++) {
      const next = current.slice();
      const ring = n - 3; // resampling closes the loop, then adds two endpoint copies
      for (let i = 1; i < n - 1; i++) {
        const r = closed ? Math.min(radius, Math.floor((ring - 1) / 2)) : Math.min(radius, i - 1, n - 2 - i);
        if (r < 1) continue;
        let x = 0, y = 0, weight = 0;
        for (let j = -r; j <= r; j++) {
          const index = closed ? 1 + ((i - 1 + j) % ring + ring) % ring : i + j;
          const w = r + 1 - Math.abs(j);
          x += current[index][0] * w; y += current[index][1] * w; weight += w;
        }
        next[i] = [x / weight, y / weight];
      }
      if (closed) { next[n - 2] = next[1]; next[0] = next[1]; next[n - 1] = next[1]; }
      current = next;
    }
    return current;
  }

  /* ---------- builders --------------------------------------- */

  function buildStroke(item, index, opts, seed, box, palette) {
    const brush = BRUSHES[opts.brush] || BRUSHES.ink;
    const surface = SURFACES[opts.surface] || SURFACES.warm;
    const W = box.width, H = box.height, S = box.scale;
    const rng = mulberry32(mixSeeds(seed, index * 7919 + 11));
    const wob = opts.wobble * brush.wobbleScale * (0.92 + surface.tooth * 0.12);
    const pressure = opts.pressure * brush.pressureScale;
    const texture = clamp(opts.texture * brush.edgeScale * (0.65 + surface.tooth * 0.8), 0, 1.2);
    const toPx = p => [box.padX + p[0] * box.usableW, box.padY + p[1] * box.usableH];

    let pts = item.points.map(toPx);
    if (pts.length < 2) return null;

    const reg = item.registration == null ? 1 : item.registration;
    const angle = (rng() - 0.5) * 0.012 * reg * (0.4 + wob * 1.4);
    if (Math.abs(angle) > 0.00001) {
      pts = pts.map(p => rotatePoint(p[0], p[1], W / 2, H / 2, angle));
    }
    const drift = S * 0.0042 * (0.35 + wob) * reg;
    const ox = (rng() - 0.5) * drift;
    const oy = (rng() - 0.5) * drift;
    pts = pts.map(p => [p[0] + ox, p[1] + oy]);

    const step = Math.max(0.85, S / 390);
    const inputControls = strokeControls(item, pts);
    const sourcePoints = pts;
    pts = resample(pts, step, !!item.closed);
    let controls = inputControls ? resampleControls(sourcePoints, inputControls, pts.length, !!item.closed) : null;

    const over = (item.overshoot == null ? (controls ? 0 : 1) : item.overshoot) * (brush.cap === 'flat' ? 0.38 : 1);
    const endExt = () => S * 0.0066 * (0.25 + wob) * over * (0.55 + rng() * 0.9);
    const extA = endExt(), extB = endExt();
    const t0 = normals([pts[0], pts[Math.min(2, pts.length - 1)]])[0];
    const t1 = normals([pts[Math.max(0, pts.length - 3)], pts[pts.length - 1]])[0];
    pts.unshift([pts[0][0] - t0[0] * extA, pts[0][1] - t0[1] * extA]);
    pts.push([pts[pts.length - 1][0] + t1[0] * extB, pts[pts.length - 1][1] + t1[1] * extB]);
    if (controls) { controls.unshift(controls[0]); controls.push(controls[controls.length - 1]); }

    let L = Math.max(arcLength(pts), 0.001);
    const nrm = normals(pts);
    const seedA = (rng() * 4294967296) >>> 0;
    const seedB = (rng() * 4294967296) >>> 0;
    const seedC = (rng() * 4294967296) >>> 0;

    const bow = (rng() - 0.5) * 2 * S * 0.0068 * wob;
    let centers = [];
    let s = 0;
    for (let i = 0; i < pts.length; i++) {
      if (i > 0) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      const t = s / L;
      const slow = fbm(s / (S * 0.47) + 1.13, seedA);
      const mid = fbm(s / (S * 0.155) + 7.31, seedB);
      const fast = fbm(s / (S * 0.047) + 3.77, seedC);
      const slowAmp = S * 0.0088 * wob;
      const midAmp = S * 0.0034 * wob;
      const fastAmp = S * 0.0009 * (0.3 + texture) * (0.4 + wob);
      const d = slow * slowAmp + mid * midAmp + fast * fastAmp + Math.sin(Math.PI * t) * bow;
      centers.push([pts[i][0] + nrm[i][0] * d, pts[i][1] + nrm[i][1] * d]);
    }

    const baseW = opts.weight * Math.pow(S / 420, 0.68) * (item.width || 1) * brush.widthScale;
    if (controls && (brush.id === 'oil' || brush.id === 'oilknife')) {
      const radius = Math.max(2, Math.min(26, Math.round(baseW * 0.75 / step)));
      centers = roundControlledPath(centers, radius, !!item.closed);
      L = Math.max(arcLength(centers), 0.001);
    }
    const startSpan = clamp(L * 0.035, S * 0.012, S * 0.055) / L;
    const endSpan = clamp(L * 0.085, S * 0.026, S * 0.11) / L;
    const pSeed1 = (rng() * 4294967296) >>> 0;
    const pSeed2 = (rng() * 4294967296) >>> 0;
    const edgeSeedL = (rng() * 4294967296) >>> 0;
    const edgeSeedR = (rng() * 4294967296) >>> 0;
    const ts = brush.taperStart == null ? 0.34 : brush.taperStart;
    const te = brush.taperEnd == null ? 0.2 : brush.taperEnd;

    const widthsL = [];
    const widthsR = [];
    let run = 0;
    for (let i = 0; i < centers.length; i++) {
      if (i > 0) run += Math.hypot(centers[i][0] - centers[i - 1][0], centers[i][1] - centers[i - 1][1]);
      const t = clamp(run / L, 0, 1);
      const enter = smoothstep(0, startSpan, t);
      const leave = smoothstep(0, endSpan, 1 - t);
      const taper = item.cap === 'taper' ? enter * leave : item.cap ? 1 :
        (ts + (1 - ts) * Math.pow(enter, 0.7)) * (te + (1 - te) * Math.pow(leave, 0.8));
      const n1 = fbm(run / (S * 0.21) + 4.9, pSeed1);
      const n2 = fbm(run / (S * 0.58) + 1.7, pSeed2);
      const press = 1 + pressure * (0.24 * n1 + 0.12 * n2);
      const edge = 0.016 + texture * 0.105;
      const jl = 1 + edge * fbm(run / (S * 0.018) + 2.3, edgeSeedL);
      const jr = 1 + edge * fbm(run / (S * 0.018) + 8.6, edgeSeedR);
      const rawWidth = baseW * taper * clamp(press, brush.pressMin == null ? 0.58 : brush.pressMin, brush.pressMax == null ? 1.42 : brush.pressMax);
      let w = controls ? Math.max(0, rawWidth) : Math.max(0.035, rawWidth);
      if (controls) w *= controls[i].pressure * controls[i].width;
      widthsL.push(w * jl);
      widthsR.push(w * jr);
    }

    const color = resolveColor(item.color || 'ink', palette);
    const baseAlpha = clamp((item.opacity == null ? 0.95 : item.opacity) * brush.alpha, 0, 1);
    const passDefs = brush.passes && brush.passes.length ? brush.passes : [{ offset: 0, width: 1, alpha: 1 }];
    const centerNormals = normals(centers);
    const baseWeight = (L + S * 0.075) / passDefs.length;
    const primitives = [];

    for (let p = 0; p < passDefs.length; p++) {
      const pass = passDefs[p];
      const passRng = mulberry32(mixSeeds(seed, index * 7919 + 11 + (p + 1) * 701));
      const passSeed = (passRng() * 4294967296) >>> 0;
      const trim = pass.trim || 0;
      const trimStart = trim ? Math.floor(centers.length * trim * (0.15 + passRng() * 0.65)) : 0;
      const trimEnd = trim ? Math.floor(centers.length * trim * (0.15 + passRng() * 0.65)) : 0;
      const start = Math.min(trimStart, Math.max(0, centers.length - 3));
      const end = Math.max(start + 2, centers.length - trimEnd);
      const n = end - start;
      const c = [];
      const wl = [];
      const wr = [];
      for (let k = 0; k < n; k++) {
        const i = start + k;
        const localW = (widthsL[i] + widthsR[i]) * 0.5;
        const t = i / Math.max(1, centers.length - 1);
        const bristle = (pass.bristle || 0) * localW *
          fbm(t * 12.7 + p * 2.3, passSeed);
        const offset = (pass.offset || 0) * localW + bristle;
        c.push([centers[i][0] + centerNormals[i][0] * offset, centers[i][1] + centerNormals[i][1] * offset]);
        const widthJitter = 1 + (pass.widthJitter == null ? 0.055 : pass.widthJitter) *
          fbm(t * 8.1 + p * 3.7, passSeed + 17);
        wl.push(widthsL[i] * (pass.width || 1) * widthJitter);
        wr.push(widthsR[i] * (pass.width || 1) * (2 - widthJitter));
      }
      const cap = item.cap || brush.cap;
      const outline = buildStrokeOutline(c, wl, wr, 10, cap === 'taper' ? 'flat' : cap);
      const alpha = clamp(baseAlpha * (pass.alpha == null ? 1 : pass.alpha) * (0.95 + passRng() * 0.08), 0, 1);
      const primitive = {
        kind: 'stroke',
        centers: c,
        widthsL: wl,
        widthsR: wr,
        outline,
        color: pass.tint ? shadeColor(color, pass.tint) : color,
        alpha,
        brush: brush.id,
        surface: surface.id,
        group: index,
        // Only the newly accepted broad-width range opts into contact-relative
        // oil sampling. All previously legal widths keep the exact old path.
        ...(item.width > 3 ? { broadStroke: true } : {}),
        length: L,
        weight: baseWeight,
        ...(p === 0 ? { guide: pts } : {}),
        ...(controls ? { controls: controls.slice(start, end), hardness: item.hardness == null ? 1 : item.hardness,
          flow: item.flow == null ? 1 : item.flow, tip: item.tip || 'round', aspect: item.aspect == null ? 0.3 : item.aspect,
          cap, closed: !!item.closed } : {})
      };
      if (controls && brush.id !== 'oil' && brush.id !== 'oilknife') {
        // Raster accepts constant-alpha polygons. Small butt-ended ribbons give
        // spatial opacity (rather than one stroke-wide average) without changing
        // its API. Adjacent ribbons share exactly the same edge vertices.
        const ns = normals(c);
        const edge = (i, side) => [c[i][0] + ns[i][0] * (side > 0 ? wl[i] : -wr[i]) * 0.5,
          c[i][1] + ns[i][1] * (side > 0 ? wl[i] : -wr[i]) * 0.5];
        for (let i = 0; i < c.length - 1; i++) {
          const a = primitive.controls[i], b = primitive.controls[i + 1];
          primitives.push(Object.assign({}, primitive, { centers: [c[i], c[i + 1]], widthsL: wl.slice(i, i + 2), widthsR: wr.slice(i, i + 2),
            controls: [a, b], outline: [edge(i, 1), edge(i + 1, 1), edge(i + 1, -1), edge(i, -1)],
            alpha: alpha * (a.opacity + b.opacity) * 0.5 * primitive.flow, weight: baseWeight / (c.length - 1), length: L / (c.length - 1) }));
        }
        if (cap === 'round' && !item.closed) {
          for (const i of [0, c.length - 1]) {
            const direction = i === 0 ? -1 : 1;
            const rad = (wl[i] + wr[i]) * 0.25;
            const tangent = [ns[i][1] * direction, -ns[i][0] * direction];
            const poly = [edge(i, -1)];
            for (let k = 0; k <= 10; k++) {
              const a = -Math.PI / 2 + Math.PI * k / 10;
              poly.push([c[i][0] + rad * (tangent[0] * Math.cos(a) + ns[i][0] * Math.sin(a)),
                c[i][1] + rad * (tangent[1] * Math.cos(a) + ns[i][1] * Math.sin(a))]);
            }
            primitives.push(Object.assign({}, primitive, { outline: poly, alpha: alpha * primitive.controls[i].opacity * primitive.flow, weight: 0, length: 0 }));
          }
        }
      } else primitives.push(primitive);
    }
    return primitives;
  }

  function buildStrokeOutline(centers, widthsL, widthsR, capSteps, capStyle) {
    const n = centers.length;
    if (n < 2) return [];
    const nrm = normals(centers);
    const left = [];
    const right = [];
    for (let i = 0; i < n; i++) {
      left.push([
        centers[i][0] + nrm[i][0] * widthsL[i] * 0.5,
        centers[i][1] + nrm[i][1] * widthsL[i] * 0.5
      ]);
      right.push([
        centers[i][0] - nrm[i][0] * widthsR[i] * 0.5,
        centers[i][1] - nrm[i][1] * widthsR[i] * 0.5
      ]);
    }
    const out = left.slice();
    if (capStyle !== 'flat') {
      const endA = Math.atan2(nrm[n - 1][1], nrm[n - 1][0]);
      const endR = Math.max(0.3, (widthsL[n - 1] + widthsR[n - 1]) * 0.25);
      for (let k = 1; k <= capSteps; k++) {
        const a = endA - (k / capSteps) * Math.PI;
        out.push([centers[n - 1][0] + Math.cos(a) * endR, centers[n - 1][1] + Math.sin(a) * endR]);
      }
    }
    for (let i = n - 1; i >= 0; i--) out.push(right[i]);
    if (capStyle !== 'flat') {
      const startA = Math.atan2(nrm[0][1], nrm[0][0]);
      const startR = Math.max(0.3, (widthsL[0] + widthsR[0]) * 0.25);
      for (let k = 1; k <= capSteps; k++) {
        const a = startA + Math.PI - (k / capSteps) * Math.PI;
        out.push([centers[0][0] + Math.cos(a) * startR, centers[0][1] + Math.sin(a) * startR]);
      }
    }
    return out;
  }

  function buildFill(item, index, opts, seed, box, palette) {
    const S = box.scale;
    const rng = mulberry32(mixSeeds(seed, index * 4271 + 71));
    const surface = SURFACES[opts.surface] || SURFACES.warm;
    let pts = item.points.map(p => [box.padX + p[0] * box.usableW, box.padY + p[1] * box.usableH]);
    if (pts.length < 3) return null;
    const angle = (rng() - 0.5) * 0.004 * (item.registration == null ? 1 : item.registration);
    if (Math.abs(angle) > 0.000001) pts = pts.map(p => rotatePoint(p[0], p[1], box.width / 2, box.height / 2, angle));
    pts = resample(pts, Math.max(0.8, S / 260), true);
    const nrm = normals(pts);
    const seedA = (rng() * 4294967296) >>> 0;
    const seedB = (rng() * 4294967296) >>> 0;
    const rough = item.rough == null ? 0.5 : item.rough;
    let total = 0;
    const cum = [0];
    for (let i = 1; i < pts.length; i++) {
      total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      cum.push(total);
    }
    const tooth = 0.78 + surface.tooth * 0.5;
    const polygon = pts.map((p, i) => {
      const s = cum[i];
      const d = (fbm(s / (S * 0.105) + 5.1, seedA) * 0.65 +
        fbm(s / (S * 0.038) + 1.7, seedB) * 0.35) * S * 0.0022 * rough * tooth;
      return [p[0] + nrm[i][0] * d, p[1] + nrm[i][1] * d];
    });
    const color = resolveColor(item.color || 'ink', palette);
    const alpha = clamp(item.opacity == null ? 0.2 : item.opacity, 0, 1);
    return {
      kind: 'fill',
      polygon,
      color,
      alpha,
      weight: S * 0.02
    };
  }

  function buildDot(item, index, opts, seed, box, palette) {
    const rng = mulberry32(mixSeeds(seed, index * 3571 + 29));
    const dotScale = Math.min(box.usableW, box.usableH);
    const cx = box.padX + item.x * box.usableW;
    const cy = box.padY + item.y * box.usableH;
    const rx = (item.rx == null ? item.r || 0.014 : item.rx) * dotScale * (0.94 + rng() * 0.12);
    const ry = (item.ry == null ? item.r || 0.014 : item.ry) * dotScale * (0.94 + rng() * 0.12);
    const rot = (rng() - 0.5) * 0.6;
    const phase = rng() * TAU;
    const pts = [];
    const n = 22;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const rough = 1 + (0.06 + opts.texture * 0.11) * Math.sin(a * 3 + phase) + (rng() - 0.5) * 0.035;
      const x = Math.cos(a) * rx * rough;
      const y = Math.sin(a) * ry * rough;
      pts.push([
        cx + x * Math.cos(rot) - y * Math.sin(rot),
        cy + x * Math.sin(rot) + y * Math.cos(rot)
      ]);
    }
    return {
      kind: 'fill',
      polygon: pts,
      color: resolveColor(item.color || 'ink', palette),
      alpha: clamp((item.opacity == null ? 0.96 : item.opacity), 0, 1),
      weight: Math.max(rx, ry) * 3.4
    };
  }

  const DEFAULTS = {
    seed: 241,
    weight: 3.0,
    wobble: 0.58,
    pressure: 0.66,
    texture: 0.46,
    padding: 0.02,
    accent: null,
    brush: 'ink',
    surface: 'warm'
  };

  function resolveCanvas(size, opts) {
    const o = opts || {};
    let width, height;
    if (size && typeof size === 'object') {
      width = size.width != null ? size.width : size.size;
      height = size.height != null ? size.height : size.size;
    } else {
      width = height = size;
    }
    if (o.width != null) width = o.width;
    if (o.height != null) height = o.height;
    if (!(width > 0)) width = 1200;
    if (!(height > 0)) height = width;
    width = Math.max(1, Math.round(width));
    height = Math.max(1, Math.round(height));
    const padding = o.padding == null ? 0.02 : o.padding;
    return {
      width,
      height,
      size: Math.max(width, height),
      scale: Math.min(width, height),
      padding,
      padX: width * padding,
      padY: height * padding,
      usableW: width * (1 - padding * 2),
      usableH: height * (1 - padding * 2)
    };
  }

  function buildItems(items, options, size) {
    const opts = Object.assign({}, DEFAULTS, options || {});
    const surface = SURFACES[opts.surface] || SURFACES.warm;
    const brush = BRUSHES[opts.brush] || BRUSHES.ink;
    const palette = buildPalette(opts.accent, surface.id);
    const canvas = resolveCanvas(size, opts);
    const primitives = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const itemIndex = i + (Number.isSafeInteger(opts.itemOffset) && opts.itemOffset >= 0 ? opts.itemOffset : 0);
      if (!item) continue;
      if (item.type === 'fill') {
        const f = buildFill(item, itemIndex, opts, opts.seed, canvas, palette);
        if (!f) continue;
        primitives.push(f);
        if (item.hatch) {
          const lines = hatch(item.points, Object.assign({ seed: opts.seed + itemIndex * 31 }, item.hatch));
          for (let j = 0; j < lines.length; j++) {
            const built = buildStroke(lines[j], itemIndex * 1000 + j + 7, opts, opts.seed, canvas, palette);
            if (built) primitives.push(...built);
          }
        }
      } else if (item.type === 'dot') {
        const d = buildDot(item, itemIndex, opts, opts.seed, canvas, palette);
        if (d) primitives.push(d);
      } else {
        const built = buildStroke(item, itemIndex, opts, opts.seed, canvas, palette);
        if (built) primitives.push(...built);
      }
    }
    return {
      primitives,
      palette,
      options: opts,
      canvas,
      width: canvas.width,
      height: canvas.height,
      size: canvas.size,
      brush: brush.id,
      surface: surface.id,
      grain: clamp(opts.texture * brush.grainScale * surface.grain, 0, 1)
    };
  }

  function buildSketch(sketch, options, size) {
    const result = buildItems(sketch.items || [], options, size);
    let strokes = 0, fills = 0, length = 0;
    for (const p of result.primitives) {
      if (p.kind === 'stroke') { strokes++; length += p.length; } else fills++;
    }
    return Object.assign(result, {
      sketch,
      stats: { marks: result.primitives.length, strokes, fills, length: Math.round(length) }
    });
  }

  /* ---------- richer studies -------------------------------- */

  function sunStudy() {
    const items = [];
    // a low field anchors the sun instead of leaving it floating
    items.push(fill([
      [-0.04, 0.89], [0.02, 0.865], [0.16, 0.805], [0.33, 0.792], [0.50, 0.824],
      [0.68, 0.795], [0.86, 0.824], [0.98, 0.878], [1.04, 0.91],
      [1.04, 1.04], [-0.04, 1.04]
    ], { color: 'ochre', opacity: 0.13, rough: 0.8 }));

    items.push(fillEllipse(0.5, 0.405, 0.238, 0.226, {
      color: 'accent', opacity: 0.21, rough: 0.42, rotate: -0.06
    }));
    items.push(ellipse(0.5, 0.405, 0.238, 0.226, {
      start: 2.72, sweep: TAU + 0.22, steps: 150, rotate: -0.06,
      color: 'accent', width: 1.32, overshoot: 0.25
    }));

    const count = 12;
    for (let i = 0; i < count; i++) {
      const a = -Math.PI * 0.53 + (i / count) * TAU + Math.sin(i * 11.17) * 0.018;
      const inner = 0.298 + Math.sin(i * 3.1) * 0.004;
      const outer = 0.365 + Math.sin(i * 5.7 + 1.3) * 0.014;
      const bend = Math.sin(i * 1.7 + 0.4) * 0.02;
      items.push(curve([
        [0.5 + Math.cos(a) * inner, 0.405 + Math.sin(a) * inner],
        [0.5 + Math.cos(a + bend) * (inner + outer) * 0.5, 0.405 + Math.sin(a + bend) * (inner + outer) * 0.5],
        [0.5 + Math.cos(a) * outer, 0.405 + Math.sin(a) * outer]
      ], { steps: 7, width: 0.86 + (i % 3) * 0.08, overshoot: 0.4 }));
    }

    items.push(curve([
      [0.025, 0.895], [0.18, 0.855], [0.31, 0.862], [0.47, 0.882],
      [0.62, 0.861], [0.78, 0.872], [0.975, 0.91]
    ], { steps: 16, width: 1.02, opacity: 0.8, overshoot: 0.45 }));

    // a couple of birds and a few field marks
    const bird = (x, y, s) => curve([
      [x - s, y], [x - s * 0.5, y - s * 0.55], [x, y - s * 0.12],
      [x + s * 0.5, y - s * 0.55], [x + s, y]
    ], { steps: 6, width: 0.44, opacity: 0.58, overshoot: 0.1 });
    items.push(bird(0.295, 0.195, 0.032));
    items.push(bird(0.365, 0.245, 0.023));
    items.push(bird(0.75, 0.17, 0.019));

    const grass = (x, y, h, o) => stroke([[x, y], [x - 0.012, y - h]], {
      width: 0.4, opacity: o, overshoot: 0.05
    });
    items.push(grass(0.165, 0.9, 0.036, 0.45));
    items.push(grass(0.181, 0.904, 0.026, 0.38));
    items.push(grass(0.803, 0.89, 0.032, 0.4));
    items.push(grass(0.818, 0.894, 0.022, 0.34));
    items.push(grass(0.29, 0.906, 0.028, 0.35));
    items.push(grass(0.305, 0.909, 0.02, 0.3));
    items.push(dot(0.35, 0.913, 0.006, { color: 'accent', opacity: 0.72 }));
    items.push(dot(0.855, 0.9, 0.005, { color: 'accent', opacity: 0.6 }));
    return items;
  }

  function sprigStudy() {
    const items = [];
    items.push(fillEllipse(0.5, 0.945, 0.285, 0.043, { color: 'ink', opacity: 0.06, rough: 0.7 }));

    // pot behind the plant
    items.push(fill([
      [0.34, 0.795], [0.66, 0.795], [0.63, 0.925], [0.59, 0.94],
      [0.41, 0.94], [0.37, 0.925]
    ], { color: 'accent', opacity: 0.2, rough: 0.55 }));
    items.push(fill([
      [0.38, 0.82], [0.62, 0.82], [0.60, 0.91], [0.40, 0.91]
    ], {
      color: 'ink', opacity: 0.02, rough: 0.4,
      hatch: { gap: 0.028, angle: 58, color: 'accent', width: 0.36, opacity: 0.3, inset: 0.012, seed: 44 }
    }));
    items.push(fillEllipse(0.5, 0.792, 0.178, 0.038, { color: 'accent', opacity: 0.14, rough: 0.4 }));

    // stem and leaves
    items.push(curve([
      [0.49, 0.79], [0.498, 0.70], [0.516, 0.61], [0.505, 0.51],
      [0.531, 0.40], [0.548, 0.28], [0.558, 0.175]
    ], { steps: 18, width: 1.0, overshoot: 0.65 }));

    const leaves = [
      { base: [0.503, 0.745], tip: [0.155, 0.655], w: 0.074, lean: 0.018, fill: 'sage', fo: 0.13 },
      { base: [0.509, 0.675], tip: [0.845, 0.505], w: 0.079, lean: -0.015, fill: null },
      { base: [0.514, 0.575], tip: [0.165, 0.415], w: 0.067, lean: 0.024, fill: null },
      { base: [0.525, 0.475], tip: [0.815, 0.29], w: 0.062, lean: -0.02, fill: 'ochre', fo: 0.1 },
      { base: [0.539, 0.375], tip: [0.725, 0.175], w: 0.053, lean: -0.018, fill: null },
      { base: [0.556, 0.255], tip: [0.58, 0.045], w: 0.047, lean: 0.008, fill: 'accent', fo: 0.23 }
    ];
    const leafGeos = leaves.map(l => leafShape(l.base, l.tip, l.w, l.lean));
    leaves.forEach((l, i) => {
      if (l.fill) {
        items.push(fill(leafGeos[i].outline, { color: l.fill, opacity: l.fo, rough: 0.35 }));
      }
    });
    leaves.forEach((l, i) => {
      items.push(stroke(leafGeos[i].outline, {
        width: i === 5 ? 1.04 : 0.96, color: l.fill === 'accent' ? 'accent' : 'ink',
        opacity: 0.95, overshoot: 0.42
      }));
      items.push(stroke(leafGeos[i].vein, {
        width: 0.35, opacity: 0.48, overshoot: 0.08,
        color: l.fill === 'accent' ? 'accent' : 'ink'
      }));
    });
    items.push(dot(0.586, 0.242, 0.008, { color: 'accent', opacity: 0.92 }));
    items.push(dot(0.604, 0.272, 0.0058, { color: 'accent', opacity: 0.82 }));
    items.push(dot(0.565, 0.288, 0.0048, { color: 'accent', opacity: 0.7 }));

    // pot lip and body over the stem base
    items.push(ellipse(0.5, 0.792, 0.178, 0.038, {
      start: 3.1, sweep: TAU + 0.08, steps: 80, width: 1.08, overshoot: 0.15
    }));
    items.push(curve([
      [0.322, 0.797], [0.348, 0.845], [0.372, 0.902], [0.408, 0.928],
      [0.50, 0.936], [0.592, 0.928], [0.628, 0.902], [0.652, 0.845], [0.678, 0.797]
    ], { steps: 12, width: 1.05, overshoot: 0.3 }));
    items.push(curve([
      [0.375, 0.874], [0.440, 0.884], [0.560, 0.884], [0.625, 0.872]
    ], { steps: 10, width: 0.68, color: 'accent', opacity: 0.82, overshoot: 0.15 }));
    return items;
  }

  function cupStudy() {
    const items = [];
    items.push(fillEllipse(0.5, 0.87, 0.345, 0.052, { color: 'ink', opacity: 0.055, rough: 0.8 }));
    items.push(fillEllipse(0.478, 0.795, 0.315, 0.074, { color: 'clay', opacity: 0.19, rough: 0.7 }));
    items.push(ellipse(0.478, 0.795, 0.315, 0.074, {
      start: 3.15, sweep: TAU + 0.05, steps: 100, width: 0.78, opacity: 0.5, overshoot: 0.15
    }));

    // spoon resting on the saucer
    items.push(fillEllipse(0.704, 0.79, 0.046, 0.018, { color: 'clay', opacity: 0.25, rough: 0.45 }));
    items.push(ellipse(0.704, 0.79, 0.046, 0.018, {
      start: 2.9, sweep: TAU + 0.08, steps: 40, width: 0.62, opacity: 0.75, overshoot: 0.1
    }));
    items.push(curve([[0.742, 0.786], [0.795, 0.765], [0.832, 0.742]], {
      steps: 8, width: 0.72, opacity: 0.8, overshoot: 0.18
    }));

    items.push(curve([
      [0.668, 0.44], [0.745, 0.434], [0.806, 0.49], [0.809, 0.585],
      [0.762, 0.65], [0.679, 0.66]
    ], { steps: 13, width: 0.98, overshoot: 0.4 }));

    // tea surface before the rim so the rim overlaps it
    items.push(fillEllipse(0.472, 0.342, 0.184, 0.044, { color: 'ochre', opacity: 0.31, rough: 0.6 }));
    items.push(ellipse(0.472, 0.342, 0.195, 0.047, {
      start: 3.05, sweep: TAU + 0.02, steps: 60, width: 0.46, opacity: 0.42, overshoot: 0.1
    }));
    items.push(ellipse(0.472, 0.34, 0.208, 0.057, {
      start: 3.02, sweep: TAU + 0.14, steps: 100, rotate: -0.025,
      width: 1.24, overshoot: 0.2
    }));
    items.push(curve([
      [0.264, 0.35], [0.275, 0.45], [0.293, 0.565], [0.334, 0.675],
      [0.407, 0.728], [0.50, 0.741], [0.589, 0.72], [0.648, 0.657],
      [0.672, 0.556], [0.68, 0.354]
    ], { steps: 16, width: 1.2, overshoot: 0.5 }));
    items.push(curve([
      [0.312, 0.588], [0.395, 0.605], [0.505, 0.609], [0.609, 0.594], [0.635, 0.584]
    ], { steps: 12, width: 0.78, color: 'accent', overshoot: 0.28, opacity: 0.94 }));

    // a little interior shading, warm and sparse
    const shade = hatch([
      [0.53, 0.55], [0.654, 0.52], [0.64, 0.67], [0.54, 0.70]
    ], { gap: 0.028, angle: 68, width: 0.34, opacity: 0.2, inset: 0.01, seed: 91 });
    for (const line of shade) items.push(line);

    // saucer front, drawn last so it reads as the nearest edge
    items.push(curve([[0.19, 0.812], [0.30, 0.84], [0.50, 0.853], [0.70, 0.84], [0.79, 0.812]], {
      steps: 14, width: 0.95, opacity: 0.9, overshoot: 0.35
    }));

    items.push(curve([[0.394, 0.303], [0.367, 0.258], [0.405, 0.208], [0.384, 0.153], [0.405, 0.094]], {
      steps: 12, width: 0.58, opacity: 0.46, overshoot: 0.2
    }));
    items.push(curve([[0.545, 0.302], [0.567, 0.259], [0.537, 0.211], [0.559, 0.159], [0.55, 0.128]], {
      steps: 12, width: 0.54, opacity: 0.38, overshoot: 0.2
    }));
    items.push(curve([[0.474, 0.31], [0.468, 0.272], [0.486, 0.236], [0.48, 0.204]], {
      steps: 9, width: 0.46, opacity: 0.3, overshoot: 0.15
    }));
    return items;
  }

  function catStudy() {
    const items = [];
    items.push(fillEllipse(0.5, 0.932, 0.345, 0.047, { color: 'ink', opacity: 0.06, rough: 0.8 }));

    // tail behind the body
    items.push(curve([
      [0.665, 0.866], [0.755, 0.895], [0.845, 0.89], [0.895, 0.825],
      [0.892, 0.735], [0.846, 0.683], [0.785, 0.68]
    ], { steps: 16, width: 1.5, overshoot: 0.35 }));
    const tailHatches = hatch([
      [0.77, 0.815], [0.84, 0.84], [0.865, 0.78], [0.85, 0.73], [0.80, 0.72]
    ], { gap: 0.024, angle: 62, width: 0.34, opacity: 0.18, inset: 0.014, seed: 12 });
    for (const line of tailHatches) items.push(line);

    // body wash, then the open body outline
    items.push(fill([
      [0.36, 0.46], [0.30, 0.52], [0.255, 0.62], [0.235, 0.74],
      [0.265, 0.865], [0.345, 0.918], [0.50, 0.935], [0.655, 0.918],
      [0.735, 0.865], [0.765, 0.74], [0.745, 0.62], [0.70, 0.52],
      [0.64, 0.46], [0.5, 0.50]
    ], { color: 'ink', opacity: 0.038, rough: 0.7 }));
    items.push(curve([
      [0.36, 0.465], [0.285, 0.55], [0.248, 0.69], [0.275, 0.835],
      [0.35, 0.90], [0.50, 0.925], [0.65, 0.90], [0.725, 0.835],
      [0.752, 0.69], [0.715, 0.55], [0.64, 0.465]
    ], { steps: 15, width: 1.28, overshoot: 0.3 }));

    // front legs and paws
    items.push(curve([[0.432, 0.54], [0.418, 0.64], [0.421, 0.78], [0.44, 0.90]], {
      steps: 10, width: 0.98, opacity: 0.95, overshoot: 0.2
    }));
    items.push(curve([[0.568, 0.54], [0.582, 0.64], [0.579, 0.78], [0.56, 0.90]], {
      steps: 10, width: 0.98, opacity: 0.95, overshoot: 0.2
    }));
    items.push(curve([[0.374, 0.906], [0.404, 0.928], [0.425, 0.934], [0.448, 0.927], [0.476, 0.906]], {
      steps: 8, width: 0.9, overshoot: 0.1
    }));
    items.push(curve([[0.524, 0.906], [0.552, 0.927], [0.575, 0.934], [0.596, 0.928], [0.626, 0.906]], {
      steps: 8, width: 0.9, overshoot: 0.1
    }));

    // soft fur hatching on the left flank
    const bodyHatches = hatch([
      [0.27, 0.61], [0.34, 0.58], [0.37, 0.87], [0.28, 0.84]
    ], { gap: 0.028, angle: 72, width: 0.33, opacity: 0.17, inset: 0.012, seed: 33 });
    for (const line of bodyHatches) items.push(line);

    // ear interiors
    items.push(fill([
      [0.318, 0.143], [0.302, 0.103], [0.333, 0.125], [0.374, 0.168],
      [0.407, 0.218], [0.384, 0.231], [0.348, 0.191], [0.326, 0.157]
    ], { color: 'accent', opacity: 0.13, rough: 0.5 }));
    items.push(fill([
      [0.682, 0.143], [0.698, 0.103], [0.667, 0.125], [0.626, 0.168],
      [0.593, 0.218], [0.616, 0.231], [0.652, 0.191], [0.674, 0.157]
    ], { color: 'accent', opacity: 0.13, rough: 0.5 }));

    // one continuous head silhouette
    items.push(curve([
      [0.500, 0.490], [0.440, 0.482], [0.390, 0.463], [0.345, 0.434], [0.310, 0.400],
      [0.286, 0.360], [0.276, 0.320], [0.288, 0.282], [0.308, 0.248], [0.320, 0.220],
      [0.300, 0.155], [0.292, 0.100], [0.305, 0.086], [0.325, 0.100], [0.365, 0.145],
      [0.410, 0.195], [0.445, 0.235], [0.475, 0.250], [0.500, 0.254],
      [0.525, 0.250], [0.555, 0.235], [0.590, 0.195], [0.635, 0.145], [0.675, 0.100],
      [0.695, 0.086], [0.708, 0.100], [0.700, 0.155], [0.680, 0.220], [0.692, 0.248],
      [0.712, 0.282], [0.724, 0.320], [0.714, 0.360], [0.690, 0.400], [0.655, 0.434],
      [0.610, 0.463], [0.560, 0.482], [0.505, 0.490]
    ], { steps: 8, width: 1.28, overshoot: 0.28 }));

    // scarf
    items.push(fill([
      [0.330, 0.505], [0.400, 0.517], [0.500, 0.525], [0.600, 0.517], [0.670, 0.505],
      [0.664, 0.545], [0.580, 0.562], [0.500, 0.567], [0.420, 0.562], [0.336, 0.545]
    ], { color: 'accent', opacity: 0.3, rough: 0.45 }));
    items.push(fill([
      [0.500, 0.548], [0.550, 0.557], [0.610, 0.647], [0.556, 0.664], [0.519, 0.608], [0.492, 0.573]
    ], { color: 'accent', opacity: 0.34, rough: 0.45 }));
    items.push(fill([
      [0.500, 0.548], [0.450, 0.557], [0.390, 0.635], [0.444, 0.652], [0.481, 0.602]
    ], { color: 'accent', opacity: 0.32, rough: 0.45 }));
    items.push(curve([
      [0.330, 0.505], [0.400, 0.518], [0.500, 0.526], [0.600, 0.518], [0.670, 0.505]
    ], { steps: 12, width: 0.95, color: 'accent', overshoot: 0.2 }));
    items.push(curve([
      [0.336, 0.545], [0.420, 0.562], [0.500, 0.567], [0.580, 0.562], [0.664, 0.545]
    ], { steps: 12, width: 0.9, color: 'accent', opacity: 0.88, overshoot: 0.2 }));
    items.push(poly([
      [0.500, 0.548], [0.550, 0.557], [0.610, 0.647], [0.556, 0.664], [0.519, 0.608], [0.492, 0.573]
    ], 0.006, { width: 0.72, color: 'accent', opacity: 0.88, overshoot: 0.12 }));
    items.push(poly([
      [0.500, 0.548], [0.450, 0.557], [0.390, 0.635], [0.444, 0.652], [0.481, 0.602]
    ], 0.006, { width: 0.72, color: 'accent', opacity: 0.88, overshoot: 0.12 }));
    items.push(curve([[0.49, 0.55], [0.52, 0.61], [0.556, 0.66]], {
      steps: 8, width: 0.5, color: 'accent', opacity: 0.8, overshoot: 0.1
    }));
    items.push(curve([[0.49, 0.55], [0.46, 0.60], [0.43, 0.65]], {
      steps: 8, width: 0.5, color: 'accent', opacity: 0.8, overshoot: 0.1
    }));
    items.push(fillEllipse(0.5, 0.545, 0.025, 0.019, { color: 'accent', opacity: 0.7, rough: 0.4 }));
    items.push(curve([[0.478, 0.576], [0.5, 0.598], [0.522, 0.576]], {
      steps: 5, width: 0.4, opacity: 0.36, overshoot: 0.05
    }));

    // face
    items.push(dot(0.425, 0.336, 0.015, { rx: 0.0125, ry: 0.018, opacity: 0.95 }));
    items.push(dot(0.575, 0.336, 0.015, { rx: 0.0125, ry: 0.018, opacity: 0.95 }));
    items.push(fillEllipse(0.5, 0.397, 0.016, 0.0115, { color: 'accent', opacity: 0.92, rough: 0.3 }));
    items.push(stroke([[0.5, 0.408], [0.5, 0.423]], { width: 0.44, opacity: 0.78, overshoot: 0.1 }));
    items.push(curve([[0.499, 0.421], [0.474, 0.438], [0.450, 0.428]], {
      steps: 7, width: 0.44, opacity: 0.78, overshoot: 0.1
    }));
    items.push(curve([[0.501, 0.421], [0.526, 0.438], [0.550, 0.428]], {
      steps: 7, width: 0.44, opacity: 0.78, overshoot: 0.1
    }));

    const whisker = (a, b, c, op) => curve([a, b, c], {
      steps: 6, width: 0.31, opacity: op, overshoot: 0.18
    });
    items.push(whisker([0.292, 0.374], [0.195, 0.356], [0.115, 0.348], 0.5));
    items.push(whisker([0.282, 0.404], [0.178, 0.401], [0.095, 0.411], 0.46));
    items.push(whisker([0.286, 0.433], [0.190, 0.45], [0.11, 0.467], 0.48));
    items.push(whisker([0.708, 0.374], [0.805, 0.356], [0.885, 0.348], 0.5));
    items.push(whisker([0.718, 0.404], [0.822, 0.401], [0.905, 0.411], 0.46));
    items.push(whisker([0.714, 0.433], [0.810, 0.45], [0.89, 0.467], 0.48));
    return items;
  }

  function houseStudy() {
    const items = [];
    // sky
    items.push(fillEllipse(0.17, 0.175, 0.057, 0.057, { color: 'accent', opacity: 0.25, rough: 0.45 }));
    items.push(ellipse(0.17, 0.175, 0.057, 0.057, {
      start: 2.8, sweep: TAU + 0.13, steps: 60, width: 0.9, color: 'accent', overshoot: 0.15
    }));
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI * 0.88 + i * 0.33;
      items.push(stroke([
        [0.17 + Math.cos(a) * 0.078, 0.175 + Math.sin(a) * 0.078],
        [0.17 + Math.cos(a) * 0.115, 0.175 + Math.sin(a) * 0.115]
      ], { width: 0.54, color: 'accent', opacity: 0.7, overshoot: 0.2 }));
    }
    items.push(curve([[0.25, 0.145], [0.285, 0.118], [0.32, 0.14], [0.35, 0.122], [0.382, 0.14]], {
      steps: 9, width: 0.42, opacity: 0.36, overshoot: 0.1
    }));
    items.push(curve([[0.62, 0.11], [0.65, 0.09], [0.685, 0.108], [0.715, 0.092]], {
      steps: 8, width: 0.38, opacity: 0.3, overshoot: 0.1
    }));

    // ground and path
    items.push(fill([
      [-0.04, 0.82], [0.02, 0.80], [0.18, 0.775], [0.36, 0.79], [0.53, 0.808],
      [0.71, 0.786], [0.88, 0.803], [0.99, 0.84], [1.04, 0.86],
      [1.04, 1.04], [-0.04, 1.04]
    ], { color: 'ochre', opacity: 0.11, rough: 0.75 }));
    items.push(fillEllipse(0.52, 0.835, 0.36, 0.047, { color: 'ink', opacity: 0.045, rough: 0.8 }));
    items.push(fill([
      [0.43, 0.79], [0.52, 0.79], [0.62, 0.94], [0.56, 0.972], [0.36, 0.955]
    ], { color: 'clay', opacity: 0.16, rough: 0.7 }));
    items.push(curve([[0.435, 0.793], [0.44, 0.86], [0.455, 0.92], [0.43, 0.958]], {
      steps: 10, width: 0.7, opacity: 0.62, overshoot: 0.2
    }));
    items.push(curve([[0.52, 0.793], [0.545, 0.86], [0.575, 0.92], [0.55, 0.96]], {
      steps: 10, width: 0.7, opacity: 0.62, overshoot: 0.2
    }));

    // roof mass, wall, tree
    items.push(fill([[0.205, 0.45], [0.48, 0.212], [0.76, 0.45]], {
      color: 'clay', opacity: 0.23, rough: 0.5,
      hatch: { gap: 0.026, angle: -38, color: 'ink', width: 0.38, opacity: 0.24, inset: 0.012, seed: 17 }
    }));
    items.push(curve([[0.175, 0.465], [0.34, 0.33], [0.48, 0.215]], {
      steps: 10, width: 1.22, overshoot: 0.7
    }));
    items.push(curve([[0.465, 0.22], [0.62, 0.335], [0.79, 0.465]], {
      steps: 10, width: 1.22, overshoot: 0.7
    }));
    items.push(poly([[0.628, 0.39], [0.627, 0.286], [0.69, 0.286], [0.69, 0.355]], 0.005, {
      width: 0.78, overshoot: 0.3
    }));
    items.push(curve([[0.667, 0.255], [0.655, 0.218], [0.686, 0.188], [0.676, 0.151], [0.698, 0.118]], {
      steps: 10, width: 0.44, opacity: 0.36, overshoot: 0.1
    }));
    items.push(curve([[0.687, 0.24], [0.702, 0.216], [0.694, 0.19], [0.708, 0.172]], {
      steps: 8, width: 0.36, opacity: 0.24, overshoot: 0.1
    }));

    items.push(poly([[0.285, 0.80], [0.285, 0.455], [0.705, 0.455], [0.705, 0.80]], 0.007, {
      width: 1.08, overshoot: 0.25
    }));
    items.push(fill(roundRectPoints(0.326, 0.523, 0.078, 0.083, 0.005), {
      color: 'ink', opacity: 0.6, rough: 0.35
    }));
    items.push(poly([[0.326, 0.523], [0.404, 0.523], [0.404, 0.606], [0.326, 0.606]], 0.004, {
      width: 0.7, overshoot: 0.1
    }));
    items.push(stroke([[0.365, 0.524], [0.365, 0.605]], { color: 'paper', width: 0.5, overshoot: 0.1 }));
    items.push(stroke([[0.327, 0.564], [0.403, 0.564]], { color: 'paper', width: 0.5, overshoot: 0.1 }));
    // flower box under the window
    items.push(fill(roundRectPoints(0.324, 0.604, 0.084, 0.028, 0.004), {
      color: 'accent', opacity: 0.26, rough: 0.35
    }));
    items.push(poly([[0.324, 0.604], [0.408, 0.604], [0.408, 0.632], [0.324, 0.632]], 0.004, {
      width: 0.58, opacity: 0.9, overshoot: 0.08
    }));
    items.push(stroke([[0.345, 0.604], [0.34, 0.59]], { width: 0.34, opacity: 0.5, overshoot: 0.05 }));
    items.push(stroke([[0.366, 0.603], [0.369, 0.586]], { width: 0.32, opacity: 0.48, overshoot: 0.05 }));
    items.push(stroke([[0.389, 0.604], [0.394, 0.589]], { width: 0.32, opacity: 0.46, overshoot: 0.05 }));
    items.push(dot(0.341, 0.586, 0.0048, { color: 'accent', opacity: 0.8 }));
    items.push(dot(0.37, 0.581, 0.0052, { color: 'accent', opacity: 0.82 }));
    items.push(dot(0.395, 0.585, 0.0044, { color: 'accent', opacity: 0.76 }));

    items.push(fill([
      [0.445, 0.80], [0.444, 0.72], [0.445, 0.67], [0.473, 0.646],
      [0.527, 0.646], [0.556, 0.67], [0.556, 0.72], [0.555, 0.80]
    ], { color: 'accent', opacity: 0.28, rough: 0.4 }));
    items.push(curve([
      [0.445, 0.80], [0.444, 0.72], [0.445, 0.67], [0.473, 0.646],
      [0.527, 0.646], [0.556, 0.67], [0.556, 0.72], [0.555, 0.80]
    ], { steps: 12, width: 1.0, color: 'accent', overshoot: 0.2 }));
    items.push(dot(0.535, 0.723, 0.0068, { color: 'ink', opacity: 0.85 }));

    // small tree with a washed, lobed canopy
    items.push(curve([[0.80, 0.825], [0.795, 0.73], [0.79, 0.665]], {
      steps: 8, width: 1.04, overshoot: 0.2
    }));
    const canopy = [
      [0.794, 0.489], [0.828, 0.482], [0.852, 0.503], [0.881, 0.516],
      [0.894, 0.554], [0.879, 0.596], [0.853, 0.625], [0.82, 0.644],
      [0.79, 0.636], [0.762, 0.648], [0.737, 0.625], [0.72, 0.59],
      [0.724, 0.55], [0.743, 0.516], [0.767, 0.5], [0.781, 0.491]
    ];
    items.push(fill(canopy, {
      color: 'sage', opacity: 0.31, rough: 0.65,
      hatch: { gap: 0.026, angle: 30, color: 'ink', width: 0.34, opacity: 0.22, inset: 0.012, seed: 53 }
    }));
    items.push(curve([[0.79, 0.665], [0.752, 0.606], [0.735, 0.567]], {
      steps: 7, width: 0.66, opacity: 0.62, overshoot: 0.15
    }));
    items.push(curve([[0.79, 0.64], [0.836, 0.602], [0.856, 0.566]], {
      steps: 7, width: 0.64, opacity: 0.55, overshoot: 0.15
    }));
    items.push(curve([[0.79, 0.61], [0.766, 0.555], [0.77, 0.52]], {
      steps: 6, width: 0.45, opacity: 0.4, overshoot: 0.1
    }));
    items.push(curve(canopy.concat([canopy[0]]), {
      steps: 9, width: 1.12, overshoot: 0.25
    }));
    items.push(curve([[0.775, 0.56], [0.81, 0.578], [0.842, 0.57]], {
      steps: 6, width: 0.36, opacity: 0.35, overshoot: 0.1
    }));
    items.push(curve([[0.755, 0.595], [0.79, 0.612], [0.82, 0.604]], {
      steps: 6, width: 0.32, opacity: 0.3, overshoot: 0.1
    }));

    // tiny cat waiting at the door
    items.push(fillEllipse(0.585, 0.792, 0.02, 0.017, { color: 'ink', opacity: 0.72, rough: 0.4 }));
    items.push(fillEllipse(0.585, 0.766, 0.014, 0.013, { color: 'ink', opacity: 0.8, rough: 0.35 }));
    items.push(fill([[0.577, 0.756], [0.575, 0.748], [0.583, 0.754]], { color: 'ink', opacity: 0.8, rough: 0.2 }));
    items.push(fill([[0.593, 0.756], [0.595, 0.748], [0.587, 0.754]], { color: 'ink', opacity: 0.8, rough: 0.2 }));
    items.push(curve([[0.6, 0.794], [0.625, 0.788], [0.632, 0.77]], {
      steps: 5, width: 0.42, opacity: 0.75, overshoot: 0.1
    }));

    // grass and path stones
    items.push(stroke([[0.22, 0.845], [0.21, 0.815]], { width: 0.34, opacity: 0.4, overshoot: 0.05 }));
    items.push(stroke([[0.238, 0.847], [0.245, 0.82]], { width: 0.32, opacity: 0.36, overshoot: 0.05 }));
    items.push(stroke([[0.7, 0.858], [0.69, 0.835]], { width: 0.32, opacity: 0.34, overshoot: 0.05 }));
    items.push(stroke([[0.716, 0.86], [0.724, 0.84]], { width: 0.3, opacity: 0.3, overshoot: 0.05 }));
    items.push(stroke([[0.48, 0.905], [0.51, 0.91]], { width: 0.34, opacity: 0.3, overshoot: 0.1 }));
    items.push(stroke([[0.43, 0.93], [0.46, 0.936]], { width: 0.3, opacity: 0.26, overshoot: 0.1 }));
    return items;
  }

  function hillsStudy() {
    const items = [];
    // sun with a few short rays
    items.push(fillEllipse(0.18, 0.19, 0.082, 0.086, { color: 'accent', opacity: 0.24, rough: 0.4 }));
    items.push(ellipse(0.18, 0.19, 0.082, 0.086, {
      start: 2.8, sweep: TAU + 0.16, steps: 70, width: 0.95, color: 'accent', overshoot: 0.18
    }));
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI * 0.9 + i * 0.3;
      items.push(stroke([
        [0.18 + Math.cos(a) * 0.11, 0.19 + Math.sin(a) * 0.11],
        [0.18 + Math.cos(a) * 0.145, 0.19 + Math.sin(a) * 0.145]
      ], { width: 0.52, color: 'accent', opacity: 0.7, overshoot: 0.2 }));
    }
    items.push(curve([[0.3, 0.13], [0.34, 0.108], [0.38, 0.126], [0.41, 0.112]], {
      steps: 8, width: 0.38, opacity: 0.34, overshoot: 0.1
    }));
    items.push(curve([[0.72, 0.105], [0.755, 0.088], [0.79, 0.104], [0.818, 0.09]], {
      steps: 8, width: 0.35, opacity: 0.28, overshoot: 0.1
    }));

    // far ridge with a pale wash
    items.push(fill([
      [-0.04, 0.75], [0.03, 0.68], [0.12, 0.60], [0.24, 0.39], [0.31, 0.27], [0.39, 0.35],
      [0.47, 0.46], [0.55, 0.34], [0.63, 0.23], [0.68, 0.27], [0.76, 0.41],
      [0.85, 0.33], [0.94, 0.43], [0.99, 0.58], [1.04, 0.66],
      [1.04, 1.04], [-0.04, 1.04]
    ], {
      color: 'sage', opacity: 0.16, rough: 0.7,
      hatch: { gap: 0.05, angle: 18, color: 'ink', width: 0.3, opacity: 0.11, inset: 0.012, seed: 21 }
    }));
    items.push(poly([
      [0.03, 0.68], [0.12, 0.60], [0.24, 0.39], [0.31, 0.27], [0.39, 0.35],
      [0.47, 0.46], [0.55, 0.34], [0.63, 0.23], [0.68, 0.27], [0.76, 0.41],
      [0.85, 0.33], [0.94, 0.43], [0.99, 0.58]
    ], 0.012, { width: 1.0, overshoot: 0.3 }));

    // snow marks on the two highest peaks
    items.push(curve([
      [0.588, 0.297], [0.607, 0.272], [0.62, 0.288], [0.637, 0.257],
      [0.653, 0.276], [0.67, 0.264]
    ], { steps: 5, width: 0.4, opacity: 0.52, overshoot: 0.06 }));
    items.push(curve([
      [0.28, 0.34], [0.297, 0.319], [0.31, 0.333], [0.32, 0.31], [0.335, 0.325]
    ], { steps: 4, width: 0.36, opacity: 0.4, overshoot: 0.06 }));

    // middle ridge with an ochre wash
    items.push(fill([
      [-0.04, 0.78], [0.0, 0.745], [0.10, 0.67], [0.20, 0.55], [0.30, 0.48], [0.39, 0.55],
      [0.46, 0.64], [0.54, 0.55], [0.64, 0.46], [0.72, 0.52], [0.82, 0.62],
      [0.92, 0.59], [0.99, 0.69], [1.04, 0.74], [1.04, 1.04], [-0.04, 1.04]
    ], { color: 'ochre', opacity: 0.15, rough: 0.7 }));
    items.push(curve([
      [0.0, 0.748], [0.10, 0.672], [0.20, 0.552], [0.30, 0.48], [0.39, 0.552],
      [0.46, 0.642], [0.54, 0.552], [0.64, 0.462], [0.72, 0.522], [0.82, 0.622],
      [0.92, 0.592], [0.99, 0.692]
    ], { steps: 17, width: 1.02, overshoot: 0.3 }));

    // foreground hill and its hatching
    items.push(fill([
      [-0.04, 0.88], [0.0, 0.845], [0.11, 0.762], [0.23, 0.714], [0.36, 0.715], [0.47, 0.772],
      [0.54, 0.833], [0.62, 0.803], [0.71, 0.74], [0.80, 0.716], [0.89, 0.742],
      [0.96, 0.797], [0.99, 0.838], [1.04, 0.88], [1.04, 1.04], [-0.04, 1.04]
    ], { color: 'ink', opacity: 0.04, rough: 0.8 }));
    items.push(curve([
      [0.0, 0.846], [0.11, 0.763], [0.23, 0.715], [0.36, 0.716], [0.47, 0.773],
      [0.54, 0.834], [0.62, 0.804], [0.71, 0.741], [0.80, 0.717], [0.89, 0.743],
      [0.96, 0.798], [0.99, 0.839]
    ], { steps: 20, width: 1.12, overshoot: 0.35 }));
    const hillHatches = hatch([
      [0.06, 0.82], [0.18, 0.78], [0.31, 0.79], [0.42, 0.84], [0.33, 0.93], [0.12, 0.95]
    ], { gap: 0.035, angle: 12, width: 0.33, opacity: 0.16, inset: 0.015, seed: 64 });
    for (const line of hillHatches) items.push(line);

    // cabin on the shoulder
    items.push(fill([[0.635, 0.63], [0.71, 0.632], [0.71, 0.69], [0.635, 0.69]], {
      color: 'clay', opacity: 0.16, rough: 0.4
    }));
    items.push(poly([[0.62, 0.63], [0.673, 0.598], [0.725, 0.63]], 0.004, {
      width: 0.82, color: 'ink', overshoot: 0.25
    }));
    items.push(fill([[0.62, 0.63], [0.673, 0.598], [0.725, 0.63]], {
      color: 'accent', opacity: 0.32, rough: 0.35
    }));
    items.push(poly([[0.635, 0.69], [0.635, 0.633], [0.708, 0.633], [0.708, 0.69]], 0.004, {
      width: 0.72, overshoot: 0.15
    }));
    items.push(fill([[0.646, 0.67], [0.662, 0.67], [0.662, 0.69], [0.646, 0.69]], {
      color: 'accent', opacity: 0.4, rough: 0.3
    }));
    items.push(fillEllipse(0.688, 0.652, 0.012, 0.013, { color: 'ochre', opacity: 0.55, rough: 0.3 }));
    items.push(curve([[0.69, 0.648], [0.7, 0.622], [0.707, 0.602]], {
      steps: 5, width: 0.35, opacity: 0.32, overshoot: 0.06
    }));

    // a pair of dark pines
    const pine = (x, baseY, h, w) => {
      const zig = [
        [x, baseY - h],
        [x + w * 0.38, baseY - h * 0.63], [x + w * 0.17, baseY - h * 0.63],
        [x + w * 0.52, baseY - h * 0.36], [x + w * 0.26, baseY - h * 0.36],
        [x + w * 0.64, baseY - h * 0.08], [x - w * 0.64, baseY - h * 0.08],
        [x - w * 0.26, baseY - h * 0.36], [x - w * 0.52, baseY - h * 0.36],
        [x - w * 0.17, baseY - h * 0.63], [x - w * 0.38, baseY - h * 0.63]
      ];
      items.push(fill(zig, { color: 'ink', opacity: 0.72, rough: 0.35 }));
      items.push(stroke([[x, baseY - h * 0.08], [x, baseY + 0.02]], {
        width: 0.45, opacity: 0.7, overshoot: 0.1
      }));
    };
    pine(0.82, 0.735, 0.15, 0.072);
    pine(0.9, 0.755, 0.11, 0.055);
    pine(0.76, 0.725, 0.085, 0.042);

    // birds and foreground marks
    const bird = (x, y, s) => curve([
      [x - s, y], [x - s * 0.48, y - s * 0.55], [x, y - s * 0.12],
      [x + s * 0.48, y - s * 0.55], [x + s, y]
    ], { steps: 6, width: 0.4, opacity: 0.56, overshoot: 0.1 });
    items.push(bird(0.43, 0.275, 0.03));
    items.push(bird(0.50, 0.225, 0.022));
    items.push(bird(0.35, 0.335, 0.018));

    items.push(stroke([[0.245, 0.82], [0.235, 0.792]], { width: 0.34, opacity: 0.38, overshoot: 0.05 }));
    items.push(stroke([[0.265, 0.823], [0.272, 0.798]], { width: 0.32, opacity: 0.34, overshoot: 0.05 }));
    items.push(stroke([[0.45, 0.85], [0.443, 0.828]], { width: 0.3, opacity: 0.3, overshoot: 0.05 }));
    items.push(stroke([[0.468, 0.853], [0.475, 0.832]], { width: 0.28, opacity: 0.28, overshoot: 0.05 }));
    items.push(stroke([[0.69, 0.92], [0.68, 0.895]], { width: 0.3, opacity: 0.28, overshoot: 0.05 }));
    items.push(stroke([[0.706, 0.923], [0.714, 0.902]], { width: 0.28, opacity: 0.25, overshoot: 0.05 }));
    return items;
  }

  const sketches = [
    {
      id: 'morning', no: '01', title: 'Morning', cn: '晨光',
      note: 'a circle, held for one breath', noteCn: '一次呼吸那么长的圆',
      items: sunStudy()
    },
    {
      id: 'sprig', no: '02', title: 'Sprig', cn: '枝条',
      note: 'a cutting, rooting quietly', noteCn: '一根正在悄悄生根的枝条',
      items: sprigStudy()
    },
    {
      id: 'cup', no: '03', title: 'Still Warm', cn: '余温',
      note: 'drawn while the tea was steeping', noteCn: '茶还在泡着的时候画的',
      items: cupStudy()
    },
    {
      id: 'cat', no: '04', title: 'Small Cat', cn: '小猫',
      note: 'it stayed just long enough', noteCn: '它只停留了一小会儿',
      items: catStudy()
    },
    {
      id: 'house', no: '05', title: 'Home, Roughly', cn: '家',
      note: 'straight lines, more or less', noteCn: '大致笔直的线',
      items: houseStudy()
    },
    {
      id: 'hills', no: '06', title: 'Two Hills', cn: '两座山',
      note: 'the long way home', noteCn: '回家的远路',
      items: hillsStudy()
    }
  ];

  const api = {
    TAU,
    clamp,
    lerp,
    smoothstep,
    mulberry32,
    mixSeeds,
    buildSketch,
    buildItems,
    buildPalette,
    hexToRgb,
    resolveColor,
    shadeColor,
    hatch,
    stroke,
    fill,
    dot,
    ellipse,
    fillEllipse,
    ellipsePoints,
    curve,
    poly,
    roundRectPoints,
    leafShape,
    DEFAULT_ACCENT,
    THEME,
    SURFACES,
    BRUSHES,
    sketches
  };
  return api;
});
