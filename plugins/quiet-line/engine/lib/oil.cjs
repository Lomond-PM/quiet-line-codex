/* ============================================================
   Quiet Line — oil paint simulation.

   Oil and palette-knife strokes are not alpha-blended ribbons.
   Each stroke is a bundle of filaments walking the centreline.
   Every filament carries its own paint load, width, tone and
   saturation, and deposits pigment into a per-pixel paint film
   that stores colour, coverage, thickness and the stroke that
   laid it down.

   A later stroke reads that film: it picks up wet colour into
   the filament, mixes it, drags it forward and scrapes the paint
   it crosses. Canvas tooth gates adhesion, so a drying brush
   skips the valleys and catches only the peaks (dry brush), and
   the same gate makes the canvas texture show through the paint
   instead of sitting underneath it as a background image.

   flushOil() resolves the film into the shared premultiplied RGBA
   ink buffer: the thickness field becomes relief light, groove
   shadow and a lit edge bead, and coverage becomes film opacity.
   Only pixels the strokes touched are read or written, so the
   cost of a stroke does not depend on how many strokes already
   exist on the board.
   ============================================================ */
'use strict';

const CORE = require('./core.cjs');

const TAU = Math.PI * 2;
const H_UNIT = 5200;          // stored height units per 1.0 of paint thickness
const DRY_PER_STROKE = 0.035; // wetness lost per intervening stroke
const MAX_SERIAL = 250;
const DRY_AGE = Math.ceil(1 / DRY_PER_STROKE); // 29; zero stamps are permanently dry

/* ---------- small helpers ---------------------------------- */

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function mixNum(a, b, t) { return a + (b - a) * t; }
function smoothstep(a, b, x) {
  const t = clamp01((x - a) / ((b - a) || 1e-6));
  return t * t * (3 - 2 * t);
}

function hash2(x, y, seed) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function noise2(x, y, seed) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  return (a + (b - a) * ux) * (1 - uy) + (c + (d - c) * ux) * uy;
}

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

function noise1(x, seed) {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return hash2(i, 0, seed) * (1 - u) + hash2(i + 1, 0, seed) * u;
}

/* ---------- canvas tooth ----------------------------------- */
/*
 * The tooth map is the physical surface the paint has to sit on:
 * fine grain plus the structure of this particular support
 * (cold-press bumps, linen weave, kraft fibre, newsprint screen).
 * It is generated once at canvas resolution and read by adhesion,
 * so paint that cannot bridge a valley stays on the peaks.
 */
function makeTooth(width, height, surface, seed) {
  const n = width * height;
  const out = new Uint8Array(n);
  const toothStrength = clamp(surface.tooth == null ? 0.55 : surface.tooth, 0.2, 1);
  const texture = surface.texture || 'fibre';
  const cell = texture === 'watercolor' ? 13 : texture === 'weave' ? 7 : 10;
  const gx = Math.ceil(width / cell) + 2;
  const grid = new Float32Array(gx * gx);
  for (let i = 0; i < grid.length; i++) {
    grid[i] = hash2(i % gx, (i / gx) | 0, seed + 31);
  }
  const fineAmp = 0.30 + toothStrength * 0.45;
  const bumpAmp = 0.22 + toothStrength * 0.55;

  for (let y = 0; y < height; y++) {
    const gy = y / cell;
    const gy0 = gy | 0, fy = gy - gy0, uy = fy * fy * (3 - 2 * fy);
    const row0 = gy0 * gx, row1 = row0 + gx;
    for (let x = 0; x < width; x++) {
      const gxf = x / cell;
      const gx0 = gxf | 0, fx = gxf - gx0, ux = fx * fx * (3 - 2 * fx);
      const a = grid[row0 + gx0], b = grid[row0 + gx0 + 1];
      const c = grid[row1 + gx0], d = grid[row1 + gx0 + 1];
      const bump = (a + (b - a) * ux) * (1 - uy) + (c + (d - c) * ux) * uy;
      const fine = hash2(x, y, seed + 47);
      // stretched fibre noise: high-frequency along y, stretched along x
      const fib = noise2(x / 2.6, y / 18, seed + 59);
      let t = 0.50 + (bump - 0.5) * bumpAmp * 2 + (fine - 0.5) * fineAmp + (fib - 0.5) * 0.22;

      if (texture === 'weave') {
        // linen: two thread directions, alternate in blocks of two pixels
        const wx = ((x % 6) < 3 ? 0.16 : -0.12);
        const wy = ((y % 6) < 3 ? 0.16 : -0.12);
        t += (wx + wy) * (0.45 + toothStrength * 0.5);
      } else if (texture === 'newsprint') {
        // dot screen: isolated peaks on a 4 px lattice
        t += ((x % 4 === 1 && y % 4 === 1) ? 0.16 : -0.05);
      } else if (texture === 'kraft') {
        // long soft fibres
        t += (noise2(x / 34, y / 5.5, seed + 71) - 0.5) * 0.35;
      } else if (texture === 'watercolor') {
        // cold-press: broad plateaus with narrow valleys
        const p = noise2(x / 7.5, y / 7.5, seed + 83);
        t += (p > 0.52 ? 0.14 : -0.10);
      } else if (texture === 'charcoal') {
        // soft dark paper: fine mottling only
        t = 0.52 + (bump - 0.5) * bumpAmp + (fine - 0.5) * fineAmp * 0.7;
      }

      out[y * width + x] = (clamp01(t) * 255) | 0;
    }
  }
  return out;
}

/* ---------- paint film state ------------------------------- */

function createOilState(width, height, ss, opts) {
  const o = opts || {};
  const surface = CORE.SURFACES[o.surface] || CORE.SURFACES.warm;
  const seed = (o.seed || 1) >>> 0;
  const n = width * height;
  const toothW = Math.max(1, Math.ceil(width / ss));
  const toothH = Math.max(1, Math.ceil(height / ss));
  const tile = Math.max(24, Math.round(26 * ss));
  const cols = Math.ceil(width / tile);
  const rows = Math.ceil(height / tile);
  const tooth = makeTooth(toothW, toothH, surface, seed);
  return {
    width, height, ss, inv: 1 / ss,
    surface: surface.id,
    toothW, toothH,
    tooth,
    // a blurred copy of the same tooth: coverage follows the sharp support,
    // but the relief of the film should follow its broader shape, otherwise
    // every grain cell prints into the paint as a quilted grid
    toothSoft: smoothTooth(tooth, toothW, toothH),
    col: new Uint8Array(n * 3),
    cov: new Uint8Array(n),
    hgt: new Uint16Array(n),
    stamp: new Uint8Array(n),
    serial: 0,
    impasto: 0.62,
    painted: 0,
    dirty: { x0: width, y0: height, x1: -1, y1: -1 },
    // coarse record of paint that has already been resolved, so a later
    // stroke can still pick some of it up at low weight
    tile, cols, rows,
    dryR: new Float32Array(cols * rows),
    dryG: new Float32Array(cols * rows),
    dryB: new Float32Array(cols * rows),
    dryA: new Float32Array(cols * rows)
  };
}

function toothAt(state, x, y) {
  const tx = (x * state.inv) | 0;
  const ty = (y * state.inv) | 0;
  if (tx < 0 || ty < 0 || tx >= state.toothW || ty >= state.toothH) return 0.5;
  return state.tooth[ty * state.toothW + tx] * (1 / 255);
}

/** The same tooth, blurred by one cell: the shape of the support rather than
 *  its fine grain, which is what the relief of a thick film should follow. */
function smoothTooth(tooth, w, h) {
  const out = new Uint8Array(tooth.length);
  for (let y = 0; y < h; y++) {
    const y0 = y > 0 ? y - 1 : 0;
    const y1 = y < h - 1 ? y + 1 : h - 1;
    for (let x = 0; x < w; x++) {
      const x0 = x > 0 ? x - 1 : 0;
      const x1 = x < w - 1 ? x + 1 : w - 1;
      const v = tooth[y * w + x] * 2 +
        tooth[y * w + x0] + tooth[y * w + x1] +
        tooth[y0 * w + x] + tooth[y1 * w + x];
      out[y * w + x] = (v / 6) | 0;
    }
  }
  return out;
}

function toothSoftAt(state, x, y) {
  const tx = (x * state.inv) | 0;
  const ty = (y * state.inv) | 0;
  if (tx < 0 || ty < 0 || tx >= state.toothW || ty >= state.toothH) return 0.5;
  return state.toothSoft[ty * state.toothW + tx] * (1 / 255);
}

// Keep the on-disk Uint8 stamps / serial<=250 contract. Old snapshots may
// straddle the historical 250->1 wrap, so interpret their recent age modulo
// 250 (not 256). At the next wrap, rebase only still-wet stamps and retire all
// older ones to zero; retired pixels can never alias a future stroke again.
function filmAge(state, stamp) {
  return (state.serial - stamp + MAX_SERIAL) % MAX_SERIAL;
}

function filmWet(state, i) {
  const stamp = state.stamp[i];
  if (state.cov[i] < 3 || stamp === 0) return 0;
  return clamp01(1 - filmAge(state, stamp) * DRY_PER_STROKE);
}

function advanceOilStroke(state) {
  if (state.serial >= MAX_SERIAL) {
    for (let i = 0; i < state.stamp.length; i++) {
      const stamp = state.stamp[i];
      if (!stamp) continue;
      const age = filmAge(state, stamp);
      state.stamp[i] = age < DRY_AGE ? DRY_AGE - age : 0;
    }
    state.serial = DRY_AGE;
  }
  state.serial++;
}

/** Dry the current film without resolving or changing its visible material.
 * Accepts the oil object (paintState.oil), mutates only its age stamps, and
 * returns the same object. Safe for repeated calls and the existing snapshots.
 * Resolved dry-colour caches are deliberately not rewritten by this operation.
 */
function dryOilState(state) {
  if (!state || !(state.stamp instanceof Uint8Array)) throw new TypeError('dryOilState requires an oil state');
  state.stamp.fill(0);
  return state;
}

/* ---------- resolving the film ----------------------------- */

const LIGHT_X = -0.60;
const LIGHT_Y = -0.80;

/**
 * Composite the current paint film into the premultiplied RGBA ink
 * buffer, then clear it. Height gradients become relief light and
 * groove shadow; coverage becomes film opacity.
 */
function flushOil(ink, width, height, ss, state) {
  if (!state || !state.painted) return 0;
  const d = state.dirty;
  const x0 = Math.max(1, d.x0 - 2);
  const x1 = Math.min(width - 2, d.x1 + 2);
  const y0 = Math.max(1, d.y0 - 2);
  const y1 = Math.min(height - 2, d.y1 + 2);
  // Height is measured in canvas pixels, not supersampled buffer pixels.
  // A broad studio light gives relief without outlining every grain in black.
  const relief = 0.12 + 0.55 * state.impasto;
  const lightZ = 1.6;
  const lightInv = 1 / Math.sqrt(1 + lightZ * lightZ);
  const flatLight = lightZ * lightInv;
  const halfZ = flatLight + 1;
  const halfInv = 1 / Math.sqrt(lightInv * lightInv + halfZ * halfZ);
  const flatSpec = Math.pow(halfZ * halfInv, 24);
  const tile = state.tile;
  const cols = state.cols;
  let touched = 0;

  // Smooth only the *lighting* height. Actual film height, pigment and
  // coverage remain untouched. A one-canvas-pixel Gaussian suppresses tooth
  // noise while retaining the broader shoulders of individual paint ridges.
  const pad = 2 * ss + 1;
  const rx0 = Math.max(0, x0 - pad), ry0 = Math.max(0, y0 - pad);
  const rx1 = Math.min(width - 1, x1 + pad), ry1 = Math.min(height - 1, y1 + pad);
  const rw = rx1 - rx0 + 1, rh = ry1 - ry0 + 1;
  const horizontal = new Float32Array(rw * rh);
  const reliefHeight = new Float32Array(rw * rh);
  for (let yy = 0; yy < rh; yy++) {
    const row = (yy + ry0) * width;
    for (let xx = 0; xx < rw; xx++) {
      const x = xx + rx0;
      horizontal[yy * rw + xx] = (
        state.hgt[row + Math.max(0, x - 2 * ss)] +
        4 * state.hgt[row + Math.max(0, x - ss)] +
        6 * state.hgt[row + x] +
        4 * state.hgt[row + Math.min(width - 1, x + ss)] +
        state.hgt[row + Math.min(width - 1, x + 2 * ss)]) / (16 * H_UNIT);
    }
  }
  for (let yy = 0; yy < rh; yy++) {
    const a = Math.max(0, yy - 2 * ss) * rw;
    const b = Math.max(0, yy - ss) * rw;
    const c = yy * rw;
    const e = Math.min(rh - 1, yy + ss) * rw;
    const f = Math.min(rh - 1, yy + 2 * ss) * rw;
    for (let xx = 0; xx < rw; xx++) {
      reliefHeight[c + xx] = (horizontal[a + xx] + 4 * horizontal[b + xx] +
        6 * horizontal[c + xx] + 4 * horizontal[e + xx] + horizontal[f + xx]) / 16;
    }
  }

  for (let y = y0; y <= y1; y++) {
    const row = y * width;
    for (let x = x0; x <= x1; x++) {
      const i = row + x;
      const cov = state.cov[i];
      if (cov) {
        const a0 = cov * (1 / 255);
        const hc = state.hgt[i] * (1 / H_UNIT);
        // Read the intact height field. Sobel derivatives average across each
        // hair, so support grain does not become isolated dark flecks.
        const ri = (y - ry0) * rw + x - rx0;
        const hL = reliefHeight[ri - 1];
        const hR = reliefHeight[ri + 1];
        const hU = reliefHeight[ri - rw];
        const hD = reliefHeight[ri + rw];
        const hUL = reliefHeight[ri - rw - 1];
        const hUR = reliefHeight[ri - rw + 1];
        const hDL = reliefHeight[ri + rw - 1];
        const hDR = reliefHeight[ri + rw + 1];
        const dx = (hUR + 2 * hR + hDR - hUL - 2 * hL - hDL) * ss * 0.125;
        const dy = (hDL + 2 * hD + hDR - hUL - 2 * hU - hUR) * ss * 0.125;
        const nx = -dx * relief, ny = -dy * relief;
        const normalInv = 1 / Math.sqrt(1 + nx * nx + ny * ny);
        const lit = (nx * LIGHT_X + ny * LIGHT_Y + lightZ) * normalInv * lightInv;
        const diffuse = clamp((lit - flatLight) * 0.55, -0.13, 0.16);
        const nh = ((nx * LIGHT_X + ny * LIGHT_Y) * lightInv + halfZ) * normalInv * halfInv;
        // A restrained broad reflection, not white glitter or a glossy tube.
        const thick = clamp01(hc * 0.80);
        const glint = Math.max(0, Math.pow(Math.max(0, nh), 24) - flatSpec) *
          0.11 * (0.35 + 0.65 * thick);
        const groove = Math.min(0.025, Math.max(0, hL + hR + hU + hD - 4 * reliefHeight[ri]) * 0.04);
        const v = 0.97 + thick * 0.05 + diffuse - groove;
        const cr0 = state.col[i * 3], cg0 = state.col[i * 3 + 1], cb0 = state.col[i * 3 + 2];
        const r = cr0 * v + (255 - cr0) * glint;
        const g = cg0 * v + (255 - cg0) * glint;
        const b = cb0 * v + (255 - cb0) * glint;
        const a = a0 * (0.95 + 0.05 * clamp01(hc * 1.8));
        const inv = 1 - a;
        const k = a * 255;
        ink[i * 4] = clamp(r * a + ink[i * 4] * inv, 0, 255);
        ink[i * 4 + 1] = clamp(g * a + ink[i * 4 + 1] * inv, 0, 255);
        ink[i * 4 + 2] = clamp(b * a + ink[i * 4 + 2] * inv, 0, 255);
        ink[i * 4 + 3] = Math.min(255, k + ink[i * 4 + 3] * inv);

        // remember resolved paint coarsely for low-weight pickup later
        const ti = ((y / tile) | 0) * cols + ((x / tile) | 0);
        const w = a0;
        const prev = state.dryA[ti];
        const ww = w + prev * 0.35;
        if (ww > 0) {
          const cr = clamp(r, 0, 255), cg = clamp(g, 0, 255), cb = clamp(b, 0, 255);
          state.dryR[ti] = (state.dryR[ti] * prev * 0.35 + cr * w) / ww;
          state.dryG[ti] = (state.dryG[ti] * prev * 0.35 + cg * w) / ww;
          state.dryB[ti] = (state.dryB[ti] * prev * 0.35 + cb * w) / ww;
        }
        state.dryA[ti] = Math.max(prev, a);
        touched++;
      }
    }
  }
  // Do not clear during shading: doing so zeroed the left/up neighbours of
  // every following pixel and made relief depend on scan order rather than
  // actual surface normals. Clear only after all film samples are resolved.
  for (let y = y0; y <= y1; y++) {
    const start = y * width + x0, end = y * width + x1 + 1;
    state.cov.fill(0, start, end);
    state.hgt.fill(0, start, end);
    state.stamp.fill(0, start, end);
  }
  state.painted = 0;
  d.x0 = width; d.y0 = height; d.x1 = -1; d.y1 = -1;
  return touched;
}

/* ---------- path helpers ----------------------------------- */

function oilNormals(centers) {
  const out = [];
  const n = centers.length;
  for (let i = 0; i < n; i++) {
    const a = centers[Math.max(0, i - 1)];
    const b = centers[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1];
    const l = Math.hypot(tx, ty) || 1;
    out.push([-ty / l, tx / l]);
  }
  return out;
}

function smoothOilPath(centers, widthsL, widthsR, radius, passes) {
  const n = centers.length;
  const r = Math.max(0, Math.round(radius));
  const count = Math.max(1, passes || 1);
  if (r < 1 || n < 3) return { centers, widthsL, widthsR };
  let cx = centers.map(p => p[0]);
  let cy = centers.map(p => p[1]);
  let wl = widthsL.slice();
  let wr = widthsR.slice();
  for (let pass = 0; pass < count; pass++) {
    const nx = new Array(n), ny = new Array(n), nl = new Array(n), nr = new Array(n);
    for (let i = 0; i < n; i++) {
      let sx = 0, sy = 0, sl = 0, sr = 0, k = 0;
      for (let j = -r; j <= r; j++) {
        const idx = Math.max(0, Math.min(n - 1, i + j));
        sx += cx[idx]; sy += cy[idx]; sl += wl[idx]; sr += wr[idx]; k++;
      }
      nx[i] = sx / k; ny[i] = sy / k; nl[i] = sl / k; nr[i] = sr / k;
    }
    cx = nx; cy = ny; wl = nl; wr = nr;
  }
  return { centers: cx.map((x, i) => [x, cy[i]]), widthsL: wl, widthsR: wr };
}

/** Resample the centreline at a fixed arc step, with tangents and normals. */
function densify(centers, widthsL, widthsR, step, controls) {
  const n0 = centers.length;
  if (n0 < 2) return null;
  const cum = new Float64Array(n0);
  for (let i = 1; i < n0; i++) {
    cum[i] = cum[i - 1] + Math.hypot(centers[i][0] - centers[i - 1][0], centers[i][1] - centers[i - 1][1]);
  }
  const total = cum[n0 - 1];
  if (!(total > 0.01)) return null;
  const count = Math.max(3, Math.ceil(total / step) + 1);
  const x = new Float64Array(count);
  const y = new Float64Array(count);
  const w = new Float64Array(count);
  const sampledControls = controls ? new Array(count) : null;
  let seg = 0;
  for (let j = 0; j < count; j++) {
    const s = (j / (count - 1)) * total;
    while (seg < n0 - 2 && cum[seg + 1] < s) seg++;
    const a = centers[seg], b = centers[Math.min(n0 - 1, seg + 1)];
    const span = Math.max(1e-6, cum[Math.min(n0 - 1, seg + 1)] - cum[seg]);
    const t = clamp01((s - cum[seg]) / span);
    if (sampledControls) {
      const ca = controls[seg], cb = controls[Math.min(n0 - 1, seg + 1)];
      const c = {};
      for (const key of ['pressure', 'width', 'opacity', 'tilt']) c[key] = mixNum(ca[key], cb[key], t);
      c.angle = ca.angle + (((cb.angle - ca.angle) % 360 + 540) % 360 - 180) * t;
      sampledControls[j] = c;
    }
    x[j] = a[0] + (b[0] - a[0]) * t;
    y[j] = a[1] + (b[1] - a[1]) * t;
    w[j] = widthsL[seg] + (widthsR[seg] - widthsL[seg]) * 0.5 +
      ((widthsL[Math.min(n0 - 1, seg + 1)] + widthsR[Math.min(n0 - 1, seg + 1)]) * 0.5 -
        (widthsL[seg] + widthsR[seg]) * 0.5) * t;
  }
  const tx = new Float64Array(count);
  const ty = new Float64Array(count);
  const nx = new Float64Array(count);
  const ny = new Float64Array(count);
  for (let j = 0; j < count; j++) {
    const a = Math.max(0, j - 1), b = Math.min(count - 1, j + 1);
    let dx = x[b] - x[a], dy = y[b] - y[a];
    const l = Math.hypot(dx, dy) || 1;
    dx /= l; dy /= l;
    tx[j] = dx; ty[j] = dy;
    nx[j] = -dy; ny[j] = dx;
  }
  return { n: count, x, y, w, tx, ty, nx, ny, total, step: total / (count - 1), ...(sampledControls ? { controls: sampledControls } : {}) };
}

/* ---------- the filament bundle ---------------------------- */

function shade(color, amount) {
  return [
    clamp(color[0] * (1 + amount), 0, 255),
    clamp(color[1] * (1 + amount), 0, 255),
    clamp(color[2] * (1 + amount), 0, 255)
  ];
}

function makeBristles(halfWidth, opts, rng) {
  const knife = !!opts.knife;
  // A flat bristle brush: the hairs stand side by side and each lays its own
  // line. The marks the brush leaves are whatever those lines actually
  // touched, so tracks are as wide as a hair, not as wide as the brush.
  const target = knife ? 2.9 : 1.25;
  const minCount = knife ? 3 : 5;
  const maxCount = knife ? 8 : 28;
  const count = Math.max(minCount, Math.min(maxCount, Math.round((halfWidth * 2) / target)));
  const spacing = (halfWidth * 2) / count;
  const load0 = clamp01(opts.load == null ? 0.65 : opts.load);
  const twin = opts.color;
  // Hairs clump: linseed oil bridges neighbouring hairs, so a flat brush lays
  // a few bundles of paint rather than one line per hair. Groups share their
  // load, colour and where they touch down / lift off.
  const groups = Math.max(2, Math.min(6, Math.round(count / 4)));
  const group = [];
  for (let g = 0; g < groups; g++) {
    const centre = (g + 0.5) / groups;
    const outer = Math.abs(centre * 2 - 1);
    group.push({
      per: load0 * (0.95 - 0.42 * outer * outer) * (0.85 + rng() * 0.30),
      tone: rng(),
      lift: 1 - rng() * rng() * 0.22,
      drop: rng() * rng() * 0.05,
      col: shade(opts.color, (rng() - 0.5) * 0.03),
      height: (0.7 + rng() * 0.9) * (1 - 0.18 * outer)
    });
  }
  const list = [];
  for (let i = 0; i < count; i++) {
    const grp = group[Math.min(groups - 1, Math.floor((i / count) * groups))];
    const v0 = ((i + 0.5) / count) * 2 - 1;
    // hairs are not evenly spaced: they clump and leave gaps
    const v = clamp(v0 + (rng() - 0.5) * (knife ? 0.04 : 0.18) * (2 / count), -1.0, 1.0);
    const outer = Math.abs(v);
    // a flat brush has hairs of very different thickness: thin hairs draw
    // hairlines inside the mark, fat ones merge with their neighbours
    // Refine the interior of broad oil marks only. Keep fine marks and the
    // outer silhouette at the recovered baseline; consume exactly one width
    // random sample as before (none for the knife).
    const widthDetail = knife ? 0 : clamp01((halfWidth - 4) / 6) *
      (1 - Math.pow(outer, 4));
    const widthSample = knife ? 0 : rng();
    // Same expected half-width (.73 * spacing), a little more distinction
    // between fine and loaded hairs, without adding gaps by widening spacing.
    const hw = Math.max(0.30, spacing * (knife ? 0.95 :
      0.62 + widthSample * 0.22 + (widthSample - 0.5) * 0.22 * widthDetail));
    // the outer hairs carry less paint and give out first
    const per = grp.per * (0.9 + rng() * 0.2);
    // a loaded brush covers a distance, and a long gesture runs out near its end:
    // deplete over most of this stroke so the body stays loaded and only the
    // last stretch frays
    const strokeLen = opts.len || halfWidth * 8;
    // a loaded brush stays loaded for the whole gesture and only the last
    // stretch frays; a dry brush runs out much earlier
    // a loaded brush carries enough for the whole gesture, so only the last
    // stretch frays; a low load deliberately runs dry part way through
    // how far this hair's paint lasts: a loaded brush covers the whole gesture,
    // a low load runs dry part way through
    // a loaded brush carries paint past the end of the gesture; a low load`n    // runs dry and starts to skip over the canvas
    const dryLen = Math.max(halfWidth * 6, strokeLen * (0.8 + 4.2 * load0)) *
      (1 - 0.10 * outer);
    list.push({
      v, hw, widthDetail, step: spacing,
      load: per, load0: Math.max(0.06, per),
      dep: (1 / dryLen) * (0.85 + rng() * 0.55),
      press: knife ? 1 : 1 - 0.24 * outer * outer,
      flow: 0.85 + rng() * 0.35,
      height: grp.height * (0.9 + rng() * 0.25),
      sat: 0,
      wet: 0.45 + rng() * 0.85,
      phase: rng() * 97,
      wobble: 0.10 + rng() * 0.26,
      // each hair is its own line, with its own value; the small differences
      // between the lines are what the eye reads as bristles
      col: shade(grp.col, (rng() - 0.5) * 0.10),
      carry: shade(grp.col, (rng() - 0.5) * 0.10),
      // hairs do not all touch down and lift off together: the group decides
      // roughly where, and each hair adds a little, which frays the ends
      // how far this hair falls short of the stroke ends, in canvas pixels:
      // the middle of the brush reaches furthest, the outer hairs lift early
      head: rng() * rng() * 3,
      // hair ends are spread over a long range: a few hairs trail far past
      // the rest, which is what frays the end of the mark
      // a hair falls a few pixels short of the end, at its own random length:
      // together the hairs fade the mark out instead of cutting it
      tail: (0.18 + 0.82 * outer * outer) * (1.5 + rng() * 7),
      splay: 0
    });
  }
  // no stray hairs outside the tuft: a flat brush's edge is the outermost
  // hairs themselves, and single hairs only draw thin contour-like lines
  return list;
}

/* ---------- depositing one filament step ------------------- */

function depositFilament(ink, W, H, ss, state, fx, fy, b, pressure, color, amount, hGain, wetParam, clipEnd, loose) {
  const cx = fx * ss;
  const cy = fy * ss;
  // supply is the absolute paint in the hair, so a low load really does run dry
  const supply = clamp01(b.load * 1.6 * pressure);
  // What the hair touches is what it paints: the mark is the hair's own
  // footprint, not a widened band, so gaps between hairs survive as streaks.
  const hw = b.hwEff || b.hw;
  // the track is the hair's width, plus only a touch of spread from wet paint
  const footprint = b.footprint;
  const rx = footprint ? Math.max(0.25, footprint.rx * ss) : 0;
  const ry = footprint ? Math.max(0.25, footprint.ry * ss) : 0;
  const cos = footprint ? Math.cos(footprint.angle) : 1;
  const sin = footprint ? Math.sin(footprint.angle) : 0;
  const radC = footprint ? Math.max(rx, ry) : Math.max(0.55, (hw + 0.35) * ss);
  const boundX = footprint ? Math.hypot(rx * cos, ry * sin) : radC;
  const boundY = footprint ? Math.hypot(rx * sin, ry * cos) : radC;
  const radH = radC;
  const radH2 = radH * radH;
  const radC2 = radC * radC;
  const x0 = Math.max(0, Math.floor(cx - boundX));
  const x1 = Math.min(W - 1, Math.ceil(cx + boundX));
  const y0 = Math.max(0, Math.floor(cy - boundY));
  const y1 = Math.min(H - 1, Math.ceil(cy + boundY));
  // a loaded brush covers everything it touches; a drying one only catches
  // the peaks of the tooth, so the canvas starts to show through
  const dry = clamp01((0.72 - supply) / 0.72);
  const thr = clamp(0.95 - 0.85 * supply, 0.08, 0.92);
  const lo = thr - 0.17, hi = thr + 0.21;
  const hMul = hGain * b.height * (b.hgtEff || 1);
  const localMix = 0.22 * b.wet;
  let hits = 0;

  for (let y = y0; y <= y1; y++) {
    const dy = y + 0.5 - cy;
    const dy2 = dy * dy;
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx;
      const u = footprint ? (dx * cos + dy * sin) / rx : 0;
      const v = footprint ? (-dx * sin + dy * cos) / ry : 0;
      const d2 = footprint ? (u * u + v * v) * radC2 : dx * dx + dy2;
      if (d2 > radC2) continue;
      // a flat brush ends where the gesture ends: nothing spills past the ends
      if (state.capA) {
        const pxA = x + 0.5, pyA = y + 0.5;
        if ((pxA - state.capA.x) * state.capA.nx + (pyA - state.capA.y) * state.capA.ny > 0) continue;
        if (clipEnd && (pxA - state.capB.x) * state.capB.nx + (pyA - state.capB.y) * state.capB.ny > 0) continue;
      }
      const fallC = 1 - d2 / radC2;
      const fall = b.hardness == null ? Math.pow(fallC, 0.55) :
        1 - smoothstep(b.hardness, 1, Math.sqrt(Math.max(0, d2 / radC2))); // hard core, soft shoulder
      const tooth = toothAt(state, x, y);
      const gate = smoothstep(lo, hi, tooth);
      // relief follows the broad shape of the support, not every grain cell
      const gateH = smoothstep(lo - 0.06, hi + 0.10, toothSoftAt(state, x, y));
      // a hair that still has paint covers its footprint; only a drying hair
      // breaks up on the tooth
      // in the tail of the mark the paint stops closing up, so it breaks into
      // strands on the tooth instead of ending as a solid cone
      const floor = loose ? 0 : (b.load > b.load0 * 0.32 ? 0.92 : 0);
      const covGate = Math.max(gate + (1 - gate) * (1 - dry), floor);
      const i = y * W + x;
      const oc = state.cov[i] * (1 / 255);
      // Coverage builds whatever is underneath: paint is opaque. The *colour*
      // replacement is damped once the pixel is covered, so the mixture a
      // stroke carried across another one is not repainted away by later passes.
      // a loaded brush closes the film quickly: partial coverage over paint
      // already on the board is what makes an overlap look like a glass pane
      let coverAmt = amount * fall * covGate * 1.45;
      if (coverAmt > 0.98) coverAmt = 0.98;
      if (coverAmt < 0.004) continue;
      const mixAmt = coverAmt * (1 - 0.25 * oc);
      const dr = color[0], dg = color[1], db = color[2];
      let outA = coverAmt + oc * (1 - coverAmt);
      if (outA > 0.002) {
        if (outA > 1) outA = 1;
        const keep = (oc * (1 - mixAmt)) / Math.max(0.0001, mixAmt + oc * (1 - mixAmt));
        const oc0 = state.col[i * 3], oc1 = state.col[i * 3 + 1], oc2 = state.col[i * 3 + 2];
        // typed arrays wrap above 255, so clamp before writing pigment
        state.col[i * 3] = clamp(dr + (oc0 - dr) * keep, 0, 255);
        state.col[i * 3 + 1] = clamp(dg + (oc1 - dg) * keep, 0, 255);
        state.col[i * 3 + 2] = clamp(db + (oc2 - db) * keep, 0, 255);
        let cov = outA;
        // wet paint on wet paint keeps sinking; dry paint keeps its film
        const wetNow = filmWet(state, i);
        if (oc > 0.02 && wetNow > 0.05) {
          cov = outA + (1 - outA) * 0.35 * wetNow * (b.footprint ? coverAmt : 1);
          if (cov > 1) cov = 1;
        }
        state.cov[i] = (cov * 255) | 0;
        if (d2 <= radH2) {
          const uH = d2 / radH2;
          const fallH = (1 - uH * uH) * (1 - uH * uH);   // flat ridge top, soft shoulder
          const oh = state.hgt[i] * (1 / H_UNIT);
          const nh = oh + coverAmt * fallH * hMul * (0.60 + 0.40 * gateH) *
            (0.55 + 0.45 * wetNow) * (1 - 0.20 * oh);
          state.hgt[i] = nh > 12.6 ? 65535 : (nh * H_UNIT) | 0;
        }
      }
      state.stamp[i] = state.serial & 255;
      state.painted = 1;
      if (x < state.dirty.x0) state.dirty.x0 = x;
      if (x > state.dirty.x1) state.dirty.x1 = x;
      if (y < state.dirty.y0) state.dirty.y0 = y;
      if (y > state.dirty.y1) state.dirty.y1 = y;
      hits++;
    }
  }
  return hits;
}

/* Controlled strokes arrive with locally rounded geometry from CORE, while
 * their attribute anchors remain intact. Avoid the legacy width smoother:
 * averaging widths would erase zero-pressure boundaries. Both geometry and
 * attributes are then densified with the same arc-length cursor.
 * No stroke-history scans or additional canvas-sized buffers are introduced. */
function paintControlledStroke(ink, W, H, ss, primitive, options, state) {
  const o = Object.assign({ wetness: 0.55, impasto: 0.62, load: 0.65, seed: 7 }, options || {});
  // Broad new strokes otherwise stamp the same large footprint every half
  // pixel: quadratic contact area times path length. Keep at least ~40
  // samples per contact width (overlapping filament footprints), while old
  // width<=3 strokes retain their exact sample count and floating-point order.
  let broadWidth = 0;
  if (primitive.broadStroke) for (let i = 0; i < primitive.widthsL.length; i++) {
    broadWidth = Math.max(broadWidth, (primitive.widthsL[i] + primitive.widthsR[i]) * 0.5);
  }
  const path = densify(primitive.centers, primitive.widthsL, primitive.widthsR, Math.max(0.5, broadWidth * 0.025), primitive.controls);
  if (!path) return { segments: 0 };
  state.impasto = clamp01(o.impasto);
  advanceOilStroke(state);
  let maxW = 0;
  for (const w of path.w) maxW = Math.max(maxW, w);
  const halfW = Math.max(0.25, maxW * 0.5);
  const base = primitive.color || [40, 40, 40];
  const rng = mulberry32(((primitive.group || 0) * 2246822519) ^ (o.seed * 3266489917) ^ 0x9e3779b9);
  const bristles = makeBristles(halfW, { knife: !!o.knife, load: o.load, color: base, len: path.total }, rng);
  const flatCap = primitive.cap === 'flat' && !primitive.closed;
  const last = path.n - 1;
  state.capA = flatCap ? { x: path.x[0] * ss, y: path.y[0] * ss, nx: -path.tx[0], ny: -path.ty[0] } : null;
  state.capB = flatCap ? { x: path.x[last] * ss, y: path.y[last] * ss, nx: path.tx[last], ny: path.ty[last] } : null;
  const alpha = clamp01(primitive.alpha == null ? 0.95 : primitive.alpha);
  const flow = primitive.flow == null ? 1 : clamp01(primitive.flow);
  const hardness = primitive.hardness == null ? 1 : clamp01(primitive.hardness);
  const wet = clamp01(o.wetness);
  let deposits = 0;
  for (let j = 0; j < path.n; j++) {
    const control = path.controls[j];
    const half = path.w[j] * 0.5;
    if (half <= 0 || control.pressure <= 0 || control.width <= 0 || control.opacity <= 0 || alpha <= 0 || flow <= 0) continue;
    const flat = primitive.tip === 'flat';
    const angle = flat ? control.angle * Math.PI / 180 : Math.atan2(path.ny[j], path.nx[j]);
    const ax = Math.cos(angle), ay = Math.sin(angle);
    // Tilting lays more of a flat tuft on the support; its minor axis grows.
    const depth = flat ? half * Math.min(1, (primitive.aspect == null ? 0.3 : primitive.aspect) * (1 + 2 * control.tilt)) : half;
    const spacing = half * 2 / bristles.length;
    for (const b of bristles) {
      const edge = 1 - smoothstep(hardness, 1, Math.abs(b.v));
      if (edge <= 0) continue;
      b.load = Math.max(0, b.load - path.step * b.dep * (0.6 + 0.8 * control.pressure) * flow);
      const offset = b.v * Math.max(0, half - spacing * 0.35);
      const fx = path.x[j] + ax * offset, fy = path.y[j] + ay * offset;
      const px = Math.floor(fx * ss), py = Math.floor(fy * ss);
      if (px >= 0 && py >= 0 && px < W && py < H) {
        const i = py * W + px;
        if (state.cov[i] > 2 && state.stamp[i] !== (state.serial & 255)) {
          const pick = Math.min(0.45, wet * filmWet(state, i) * (state.cov[i] / 255) * control.pressure * 0.3);
          for (let k = 0; k < 3; k++) b.carry[k] += (state.col[i * 3 + k] - b.carry[k]) * pick;
          b.load = Math.min(1.3, b.load + pick * 0.1);
        }
      }
      for (let k = 0; k < 3; k++) b.carry[k] += (b.col[k] - b.carry[k]) * 0.006;
      if (b.load <= 0) continue;
      b.hardness = hardness;
      b.footprint = { rx: Math.max(0.15, spacing * 0.7),
        ry: Math.max(0.15, depth * (flat ? 1 : Math.sqrt(Math.max(0, 1 - b.v * b.v)))), angle };
      const supply = clamp01(b.load * 1.6 * control.pressure);
      // Correct for stamp overlap so flow is deposition per travelled distance,
      // not per sample count, and opacity zero is genuinely no contact.
      const rate = path.step / Math.max(0.3, b.footprint.ry * 2);
      const amount = alpha * control.opacity * flow * edge * rate * b.flow * supply * (o.knife ? 2 : 1.75);
      if (amount <= 0) continue;
      deposits += depositFilament(ink, W, H, ss, state, fx, fy, b, control.pressure, b.carry,
        amount, (o.knife ? 1.7 : 1.25) * (0.40 + 0.95 * state.impasto), wet, flatCap, false);
    }
  }
  state.capA = null; state.capB = null;
  return { segments: path.n, deposits };
}

/* ---------- one stroke ------------------------------------- */

function paintOilStroke(ink, width, height, ss, primitive, options, state) {
  const rawCenters = primitive && primitive.centers;
  if (!rawCenters || rawCenters.length < 2 || !primitive.widthsL) return { segments: 0 };
  if (!state) return { segments: 0 };
  // A transparent stroke has no physical contact, pickup, scrape or ageing.
  if (primitive.alpha != null && primitive.alpha <= 0) return { segments: 0 };
  if (primitive.controls) return paintControlledStroke(ink, width, height, ss, primitive, options, state);
  const o = Object.assign({
    wetness: 0.55, impasto: 0.62, load: 0.65, knife: false, seed: 7
  }, options || {});
  const knife = !!o.knife;
  const wetParam = clamp01(o.wetness);
  state.impasto = clamp01(o.impasto);

  const rawN = rawCenters.length;
  let rawLen = 0;
  for (let i = 1; i < rawN; i++) {
    rawLen += Math.hypot(rawCenters[i][0] - rawCenters[i - 1][0], rawCenters[i][1] - rawCenters[i - 1][1]);
  }
  let rawW = 0;
  for (let i = 0; i < rawN; i++) rawW += (primitive.widthsL[i] + primitive.widthsR[i]) * 0.5;
  rawW /= rawN;
  const rawStep = rawLen / Math.max(1, rawN - 1);
  const smoothRadius = Math.max(2, Math.min(26, Math.round(rawW * (0.55 + wetParam * 0.35) / Math.max(0.8, rawStep))));
  const smooth = smoothOilPath(rawCenters, primitive.widthsL, primitive.widthsR, smoothRadius, 2);

  const legacyStep = Math.max(0.50, Math.min(1.5, rawW * 0.22));
  const stepLen = primitive.broadStroke ? Math.max(legacyStep, rawW * 0.025) : legacyStep;
  const path = densify(smooth.centers, smooth.widthsL, smooth.widthsR, stepLen);
  if (!path || path.n < 3) return { segments: 0 };
  // Hairs may overrun the ends of the gesture, so an open stroke gets its
  // path extended past both ends. A loop keeps its ends where they are: the
  // overrun would cut its seam.
  const iHead0 = 0;
  const iTail0 = path.n - 1;
  const seamDist = Math.hypot(path.x[iTail0] - path.x[iHead0], path.y[iTail0] - path.y[iHead0]);
  const isLoop = seamDist < path.total * 0.35;
  const K = 0;   // hairs stop inside the gesture; the mark fades out
  const nBody = path.n;
  if (K > 0) {
    const nExt = path.n + 2 * K;
    const px = new Float64Array(nExt), py = new Float64Array(nExt);
    const ptx = new Float64Array(nExt), pty = new Float64Array(nExt);
    const pnx = new Float64Array(nExt), pny = new Float64Array(nExt);
    const pw = new Float64Array(nExt);
    const t0x = path.tx[0], t0y = path.ty[0];
    const t1x = path.tx[path.n - 1], t1y = path.ty[path.n - 1];
    for (let i = 0; i < nExt; i++) {
      const src = i - K;
      if (src >= 0 && src < path.n) {
        px[i] = path.x[src]; py[i] = path.y[src];
        ptx[i] = path.tx[src]; pty[i] = path.ty[src];
        pnx[i] = path.nx[src]; pny[i] = path.ny[src];
        pw[i] = path.w[src];
      } else if (src < 0) {
        const d = src * path.step;
        px[i] = path.x[0] + t0x * d; py[i] = path.y[0] + t0y * d;
        ptx[i] = t0x; pty[i] = t0y; pnx[i] = path.nx[0]; pny[i] = path.ny[0];
        pw[i] = path.w[0];
      } else {
        const d = (src - (path.n - 1)) * path.step;
        px[i] = path.x[path.n - 1] + t1x * d; py[i] = path.y[path.n - 1] + t1y * d;
        ptx[i] = t1x; pty[i] = t1y; pnx[i] = path.nx[path.n - 1]; pny[i] = path.ny[path.n - 1];
        pw[i] = path.w[path.n - 1];
      }
    }
    path.x = px; path.y = py; path.tx = ptx; path.ty = pty;
    path.nx = pnx; path.ny = pny; path.w = pw; path.n = nExt;
  }
  const n = path.n;
  const iHead = K;
  const iTail = K + nBody - 1;

  let avgW = 0;
  for (let i = 0; i < n; i++) avgW += path.w[i];
  avgW /= n;
  // even a small mark has to be a body of paint, not a pen line
  const small = avgW < 6;
  const halfW = Math.max(0.9, avgW * 0.5);

  advanceOilStroke(state);

  const rng = mulberry32(((primitive.group || 0) * 2246822519) ^ (o.seed * 3266489917) ^ 0x9e3779b9);
  const base = primitive.color ? primitive.color.slice() : [40, 40, 40];
  // the second pigment a loaded brush carries: a warmer sibling of the first
  const twin = [
    clamp(base[0] * 1.05 + 7, 0, 255),
    clamp(base[1] * 0.96, 0, 255),
    clamp(base[2] * 0.90, 0, 255)
  ];
  const bristles = makeBristles(halfW, {
    knife, load: o.load, color: base, twin, len: path.total
  }, rng);
  const invStep = 1 / Math.max(0.4, path.step);
  for (let i = 0; i < bristles.length; i++) {
    const b = bristles[i];
    b.j0 = Math.max(0, Math.min(n - 2, Math.round(b.head * invStep)));
    // on a short mark a hair cannot fall a long way short of the end, or the
    // whole gesture turns into wisps
    const maxTail = Math.max(1, Math.round(Math.min(path.total * 0.10, 34)) * invStep);
    // the overrun can never be longer than a couple of brush widths: a thin line
    // with a hair trailing 40 px off its end looks like a stray hair
    const over = b.tail;
    b.j1 = Math.max(b.j0 + 1, n - 1 - Math.min(Math.round(b.tail * invStep), maxTail));
  }

  const alphaScale = clamp01(primitive.alpha == null ? 0.95 : primitive.alpha);
  const depositRate = (knife ? 2.0 : 1.75) * alphaScale * (0.40 + 0.60 * clamp01(o.load));
  const hGain = (knife ? 1.7 : 1.25) * (0.40 + 0.95 * state.impasto) * (small ? 1.2 : 1);

  // the two end planes of the mark, in ss pixels. A closed loop has its ends
  // on top of each other, so it gets no caps (the planes would cut the seam).
  if (false) {
    state.capA = {
      x: path.x[iHead] * ss, y: path.y[iHead] * ss,
      nx: -path.tx[iHead], ny: -path.ty[iHead]
    };
    state.capB = {
      x: path.x[iTail] * ss, y: path.y[iTail] * ss,
      nx: path.tx[iTail], ny: path.ty[iTail]
    };
  } else {
    state.capA = null; state.capB = null;
  }

  const col = [0, 0, 0];
  // paint squeezes between the hairs and bridges them, so under the tracks
  // there is a thin body of the same pigment: the mark reads as paint with
  // structure, not as a comb of separate lines
  const body = {
    hw: 1, hwEff: 1, load: 1, load0: 3, height: 0.30, flow: 1,
    col: base, carry: base, phase: 0, wAmp: 0, sat: 0, wet: 0.6
  };
  for (let j = 0; j < n; j++) {
    const cx = path.x[j], cy = path.y[j];
    const nX = path.nx[j], nY = path.ny[j];
    const tX = path.tx[j], tY = path.ty[j];
    // A flat brush lands square and fully loaded; only the far end lifts and
    // breaks, so the silhouette is decided by which hairs still touch.
    const tail = clamp01((n - 1 - j) / Math.max(3, n * 0.12));
    // a small mark still has to carry a body of paint, not a pen line
    // the width of a brush mark barely changes along the gesture: the two
    // edges are set by the outer hairs, which wander independently
    // the mark narrows towards both ends: the hairs converge and the paint
    // thins out into streaks instead of ending on a cut edge
    const half = Math.max(0.5, path.w[j] * 0.5) * (0.94 + 0.06 * tail);
    const dTail = (iTail - j) * path.step;
    const inTail = false;
    const wide = clamp(half / halfW, 0.3, 1.2);
    const pressure = wide * (0.72 + 0.28 * tail);

    // paint squeezes between the hairs: a thin body of the same pigment goes
    // down first, so the mark is paint with structure instead of a comb
    if (!knife) {
      // the body must not round the ends off: a flat brush lands and lifts square
      // the body's footprint is as wide as the brush, so it must not reach past
      // the ends: otherwise it rounds the mark into a pill
      // the body lands square but lifts early at the far end, so the last
      // stretch of the mark is only hair tracks and thins out into them
      const stepM = Math.max(0.4, path.step);
      const rampHead = Math.max(2, Math.ceil(half * 0.18 / stepM));
      const rampTail = Math.max(2, Math.ceil(half * 0.75 / stepM));
      const bodyFade = Math.min(1, Math.min((j - iHead) / rampHead, (iTail - j) / rampTail));
      if (false && bodyFade > 0.01 && j >= iHead && j <= iTail) {
        body.hw = Math.max(0.5, half * 0.94);
        body.hwEff = body.hw;
        depositFilament(ink, width, height, ss, state, cx, cy, body, pressure * 0.9,
          base, 0.05 * bodyFade * alphaScale * (0.7 + 0.3 * pressure), hGain * 0.30, wetParam, true);
      }
    }

    for (let bi = 0; bi < bristles.length; bi++) {
      const b = bristles[bi];
      // each hair only exists between its own touchdown and lift-off points
      if (j < b.j0 || j > b.j1) continue;
      b.load = Math.max(0, b.load - path.step * b.dep * (0.6 + 0.8 * pressure));
      // a hair stops touching the canvas once it is nearly dry, instead of
      // thinning out forever: that is what makes the end of a stroke break
      if (b.load <= b.load0 * 0.20) continue;
      const span = Math.max(0.35, half - (b.hw + 0.35));
      // hairs fan out as the brush lifts, so the trailing strands spread apart
      const lift = Math.max(0, j - iTail) * path.step;
      const fan = 1 + 0.55 * Math.min(1, lift / 45);
      const off = b.v * span * fan +
        (noise1(j * 0.05 + b.phase, 7) - 0.5) * 1.1 * b.hw * b.wobble;
      const fx = cx + nX * off;
      const fy = cy + nY * off;
      const px = (fx * ss) | 0;
      const py = (fy * ss) | 0;
      const supplyNow = clamp01(b.load * 1.6 * pressure);
      // a drying hair gets thinner; a loaded one keeps its width
      // a hair is never an even-width line: it loads and unloads along its length
      // Individual hair size does most of the work; soften its local width
      // oscillation slightly so the newly distinct tracks do not look beaded.
      // Keep the original arithmetic for fine marks and the palette knife.
      const widthNoise = noise1(j * 0.035 + b.phase, 5);
      const widthWave = b.widthDetail > 0 ?
        1 + (0.60 - 0.16 * b.widthDetail) * (widthNoise - 0.5) :
        0.70 + 0.60 * widthNoise;
      b.hwEff = b.hw * (0.86 + 0.14 * supplyNow) * widthWave;
      // the hair wears unevenly along its length, but stays one continuous line
      b.hgtEff = 0.97 + 0.03 * noise1(j * 0.09 + b.phase, 21);
      b.sat *= 0.94;

      /* --- what is the filament crossing right now? --- */
      let sr = 0, sg = 0, sb = 0, sa = 0, sw = 0, hAvg = 0, sc = 0;
      for (let k = -1; k <= 1; k++) {
        const qx = (px + (nX * k * b.hw * ss) | 0);
        const qy = (py + (nY * k * b.hw * ss) | 0);
        if (qx < 0 || qy < 0 || qx >= width || qy >= height) continue;
        const qi = qy * width + qx;
        const qc = state.cov[qi];
        sc += qc * (1 / 255);
        // only paint that was already on the board feeds the pickup: sampling
        // the stroke's own trail would feed its colour back into itself
        if (qc > 2 && state.stamp[qi] !== (state.serial & 255)) {
          const wet = filmWet(state, qi);
          if (wet <= 0) continue; // dry neighbours cannot donate pigment
          const coverage = qc * (1 / 255);
          const weight = coverage * wet;
          sr += state.col[qi * 3] * weight;
          sg += state.col[qi * 3 + 1] * weight;
          sb += state.col[qi * 3 + 2] * weight;
          sa += coverage;
          sw += weight;
          hAvg += state.hgt[qi] * (1 / H_UNIT) * weight;
        }
      }
      sc /= 3;
      if (sa > 0.02) {
        // Colour is normalized by wet pigment mass, never by dry coverage.
        // Strength uses wet-covered area / 3 and its coverage-weighted mean
        // wetness: a dry neighbour reduces available area, not pigment hue.
        const invWet = 1 / sw;
        sr *= invWet; sg *= invWet; sb *= invWet; hAvg *= invWet;
        sw /= sa;
        sa /= 3;
      } else {
        // nothing wet here: fall back to paint resolved earlier
        const ti = ((py / state.tile) | 0) * state.cols + ((px / state.tile) | 0);
        const da = state.dryA[ti];
        if (da > 0.05) {
          sr = state.dryR[ti]; sg = state.dryG[ti]; sb = state.dryB[ti];
          sa = da; sw = 0; sc = da; // resolved paint is dry, never a wet pigment source
        }
      }

      /* --- the brush carries the colour it has crossed --- */
      // near the end of the gesture the brush drags further back through the
      // wet paint underneath, so the tail runs out in streaks of that colour
      const dragDist = (2.2 + 2.8 * (1 - tail)) * b.hw * ss;
      const dragX = (px - (tX * dragDist) | 0);
      const dragY = (py - (tY * dragDist) | 0);
      let dr = 0, dg = 0, db = 0, dw = 0;
      if (dragX >= 0 && dragY >= 0 && dragX < width && dragY < height) {
        const di = dragY * width + dragX;
        if (state.cov[di] > 8 && state.stamp[di] !== (state.serial & 255)) {
          dr = state.col[di * 3]; dg = state.col[di * 3 + 1]; db = state.col[di * 3 + 2];
          dw = filmWet(state, di);
        }
      }

      let cr = b.carry[0], cg = b.carry[1], cb = b.carry[2];
      if (sa > 0.02 && sw > 0.02) {
        const pick = clamp(0.95 * (0.30 + 0.70 * sw) * sa * (1 - b.sat) *
          (0.35 + 0.65 * pressure) * wetParam * wetParam, 0, 0.72);
        if (pick > 0.004) {
          // the colour the hair picks up is pulled in smoothly, so what it drags
          // across the canvas is a streak, not a fleck
          const k = clamp(pick * 1.5, 0, 0.5);
          cr += (sr - cr) * k;
          cg += (sg - cg) * k;
          cb += (sb - cb) * k;
          b.sat = Math.min(1, b.sat + pick * 0.55);
          b.load = Math.min(1.3, b.load + pick * 0.20);
        }
      }
      if (dw > 0.05) {
        // the brush drags the wet colour it just crossed forward with it
        const drag = clamp((0.60 + 0.80 * (1 - tail)) * (0.30 + 0.70 * dw) * wetParam *
          (1 - b.sat * 0.4), 0, 0.80);
        cr += (dr - cr) * drag;
        cg += (dg - cg) * drag;
        cb += (db - cb) * drag;
        b.sat = Math.min(1, b.sat + drag * 0.35);
      }
      // the carried colour fades back toward the loaded pigment over a distance
      cr += (b.col[0] - cr) * 0.012;
      cg += (b.col[1] - cg) * 0.012;
      cb += (b.col[2] - cb) * 0.012;
      b.carry[0] = cr; b.carry[1] = cg; b.carry[2] = cb;

      // pigment density varies along the mark, not just across it
      const toneJ = 1;
      col[0] = clamp(cr * toneJ, 0, 255);
      col[1] = clamp(cg * toneJ, 0, 255);
      col[2] = clamp(cb * toneJ, 0, 255);

      // supply is the absolute paint in the hair, so a low load really does run dry
  const supply = clamp01(b.load * 1.6 * pressure);
      // each hair thins out over its own last few pixels, and because the hairs
      // stop at different points the end of the mark frays into strands
      const amount = depositRate * b.flow * (0.25 + 0.75 * supply) *
        (0.80 + 0.35 * noise1(j * 0.20 + b.phase, 13));
      if (amount > 0.004) {
        depositFilament(ink, width, height, ss, state, fx, fy, b, pressure, col,
          amount, hGain, wetParam, false, inTail);
      }

      /* --- scrape only older wet film, never this stroke's fresh deposit --- */
      if (sa > 0.05 && sw > 0.05 && wetParam > 0.02) {
        const scrape = clamp(0.16 * (0.25 + 0.75 * sw) * wetParam * (1 - b.sat * 0.75) *
          (knife ? 1.6 : 1), 0, 0.28);
        if (scrape > 0.01) {
          const rdp = Math.max(0.6, b.hw * 0.75) * ss;
          const rx0 = Math.max(0, (px - rdp) | 0), rx1 = Math.min(width - 1, (px + rdp) | 0);
          const ry0 = Math.max(0, (py - rdp) | 0), ry1 = Math.min(height - 1, (py + rdp) | 0);
          for (let y = ry0; y <= ry1; y++) {
            for (let x = rx0; x <= rx1; x++) {
              const i = y * width + x;
              const c0 = state.cov[i];
              if (c0 < 6 || state.stamp[i] === state.serial) continue;
              const w0 = filmWet(state, i);
              if (w0 < 0.04) continue;
              const delta = 1 - scrape * w0 * (0.45 + 0.55 * (c0 * (1 / 255)));
              state.cov[i] = (c0 * delta) | 0;
              state.hgt[i] = (state.hgt[i] * delta) | 0;
            }
          }
        }
      }
    }
  }
  return { segments: n };
}

module.exports = {
  createOilState,
  dryOilState,
  paintOilStroke,
  flushOil,
  makeTooth,
  H_UNIT
};
