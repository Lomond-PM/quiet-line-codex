/* ============================================================
   Quiet Line — dependency-free PNG rasterizer for a Host plugin.
   Fills the shared core's ribbon polygons and washes into a
   supersampled premultiplied ink buffer, adds paper + grain,
   then writes an RGB PNG with Node's zlib.
   ============================================================ */
'use strict';

const zlib = require('node:zlib');
const CORE = require('./core.cjs');
const OIL = require('./oil.cjs');
const PAINT_STATE = require('./paint-state.cjs');

const TAU = Math.PI * 2;

/* ---------- random / noise --------------------------------- */

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

/* ---------- raster primitives ------------------------------ */

/**
 * Fill an even-odd polygon into a premultiplied RGBA byte buffer.
 * Pixels are sampled at their centers; callers supersample to antialias.
 */
function fillPolygon(buf, width, height, points, color, alpha) {
  const n = points.length;
  if (n < 3 || alpha <= 0) return;
  const edges = [];
  let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity;
  for (let i = 0; i < n; i++) {
    const a = points[i], b = points[(i + 1) % n];
    if (a[0] < minX) minX = a[0];
    if (a[0] > maxX) maxX = a[0];
    if (a[1] < minY) minY = a[1];
    if (a[1] > maxY) maxY = a[1];
    if (a[1] === b[1]) continue;
    edges.push(a[1] < b[1]
      ? { y0: a[1], y1: b[1], x0: a[0], dx: (b[0] - a[0]) / (b[1] - a[1]) }
      : { y0: b[1], y1: a[1], x0: b[0], dx: (a[0] - b[0]) / (a[1] - b[1]) });
  }
  if (!edges.length) return;
  const yStart = Math.max(0, Math.floor(minY - 0.5));
  const yEnd = Math.min(height - 1, Math.ceil(maxY));
  const xClipMin = Math.max(0, Math.floor(minX - 1));
  const xClipMax = Math.min(width - 1, Math.ceil(maxX + 1));
  edges.sort((a, b) => a.y0 - b.y0);
  const active = [];
  let next = 0;
  const sa = Math.round(Math.max(0, Math.min(1, alpha)) * 255);
  if (sa <= 0) return;
  const inv = 255 - sa;
  const sr = Math.round(color[0] * sa / 255);
  const sg = Math.round(color[1] * sa / 255);
  const sb = Math.round(color[2] * sa / 255);
  const rowBase = (y) => y * width * 4;

  for (let y = yStart; y <= yEnd; y++) {
    const yc = y + 0.5;
    while (next < edges.length && edges[next].y0 <= yc) {
      active.push(edges[next]);
      next++;
    }
    for (let i = active.length - 1; i >= 0; i--) {
      if (active[i].y1 <= yc) active.splice(i, 1);
    }
    if (!active.length) continue;
    const xs = [];
    for (let i = 0; i < active.length; i++) {
      const e = active[i];
      if (yc >= e.y0 && yc < e.y1) xs.push(e.x0 + (yc - e.y0) * e.dx);
    }
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    const base = rowBase(y);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      let xa = Math.max(xClipMin, Math.ceil(xs[i] - 0.5));
      let xb = Math.min(xClipMax, Math.floor(xs[i + 1] - 0.5));
      if (xb < xa) continue;
      for (let x = xa; x <= xb; x++) {
        const idx = base + x * 4;
        buf[idx] = (sr + buf[idx] * inv / 255) | 0;
        buf[idx + 1] = (sg + buf[idx + 1] * inv / 255) | 0;
        buf[idx + 2] = (sb + buf[idx + 2] * inv / 255) | 0;
        buf[idx + 3] = (sa + buf[idx + 3] * inv / 255) | 0;
      }
    }
  }
}

/* ---------- paper ------------------------------------------ */

function blendPixel(out, width, x, y, color, alpha) {
  if (x < 0 || y < 0 || x >= width) return;
  const idx = (y * width + x) * 3;
  if (idx < 0 || idx + 2 >= out.length) return;
  out[idx] = out[idx] * (1 - alpha) + color[0] * alpha;
  out[idx + 1] = out[idx + 1] * (1 - alpha) + color[1] * alpha;
  out[idx + 2] = out[idx + 2] * (1 - alpha) + color[2] * alpha;
}

function paintPaper(width, height, seed, surfaceId) {
  const surface = CORE.SURFACES[surfaceId] || CORE.SURFACES.warm;
  const out = new Uint8Array(width * height * 3);
  const rng = mulberry32(seed ^ 0x9e3779b9 ^ (surface.id.length * 31));
  const top = CORE.hexToRgb(surface.top);
  const mid = CORE.hexToRgb(surface.mid);
  const bottom = CORE.hexToRgb(surface.bottom);
  const dark = !!surface.dark;
  const stainColor = dark ? [226, 216, 198] : [152, 112, 67];
  const markColor = dark ? [213, 204, 188] : [105, 94, 72];
  const stains = [];
  const stainCount = dark ? 3 : 2 + Math.floor(rng() * 2);
  for (let i = 0; i < stainCount; i++) {
    stains.push({
      x: (0.15 + rng() * 0.75) * width,
      y: (0.15 + rng() * 0.75) * height,
      r: (0.12 + rng() * 0.22) * Math.min(width, height),
      a: (dark ? 0.014 : 0.012) + rng() * 0.012
    });
  }
  const cx = width * 0.5, cy = height * 0.47;
  const vmax = Math.hypot(width, height) * 0.55;
  const mottle = surface.texture === 'watercolor' ? 8 : 5;
  const toothAmp = 1.1 + surface.tooth * 1.9;

  for (let y = 0; y < height; y++) {
    const ty = y / Math.max(1, height - 1);
    const t1 = Math.min(1, ty * 1.35);
    const baseR = top[0] + (mid[0] - top[0]) * t1;
    const baseG = top[1] + (mid[1] - top[1]) * t1;
    const baseB = top[2] + (mid[2] - top[2]) * t1;
    const t2 = Math.max(0, (ty - 0.55) / 0.45);
    for (let x = 0; x < width; x++) {
      const low = noise2(x / 85, y / 85, seed + 3) * 0.55 +
        noise2(x / 210, y / 210, seed + 7) * 0.45;
      const fine = hash2(x >> 1, y >> 1, seed + 11) - 0.5;
      const tooth = (noise2(x / 3.2, y / 3.2, seed + 13) - 0.5) * toothAmp;
      let r = baseR + (bottom[0] - mid[0]) * t2 + (low - 0.5) * mottle + fine * 3.2 + tooth;
      let g = baseG + (bottom[1] - mid[1]) * t2 + (low - 0.5) * (mottle * 0.9) + fine * 3 + tooth * 0.92;
      let b = baseB + (bottom[2] - mid[2]) * t2 + (low - 0.5) * (mottle * 0.8) + fine * 2.6 + tooth * 0.82;

      // soft foxing / chalk bloom
      for (let i = 0; i < stains.length; i++) {
        const s = stains[i];
        const dx = x - s.x, dy = y - s.y;
        const d = (dx * dx + dy * dy) / (s.r * s.r);
        if (d < 1) {
          const a = s.a * (1 - d) * (1 - d);
          r += (stainColor[0] - r) * a;
          g += (stainColor[1] - g) * a;
          b += (stainColor[2] - b) * a;
        }
      }

      // quiet edge vignette
      const vx = (x - cx) / vmax, vy = (y - cy) / vmax;
      const v = Math.max(0, Math.sqrt(vx * vx + vy * vy) - 0.45) * (dark ? 0.2 : 0.12);
      r -= v * (dark ? 150 : 240);
      g -= v * (dark ? 145 : 235);
      b -= v * (dark ? 135 : 225);

      const idx = (y * width + x) * 3;
      out[idx] = Math.max(0, Math.min(255, r));
      out[idx + 1] = Math.max(0, Math.min(255, g));
      out[idx + 2] = Math.max(0, Math.min(255, b));
    }
  }

  // woven linen: crossed threads
  if (surface.texture === 'weave') {
    for (let y = 0; y < height; y += 4) {
      for (let x = 0; x < width; x++) {
        const a = 0.035 + hash2(x >> 2, y, seed + 21) * 0.018;
        blendPixel(out, width, x, y, markColor, a);
      }
    }
    for (let x = 0; x < width; x += 4) {
      for (let y = 0; y < height; y++) {
        const a = 0.026 + hash2(x, y >> 2, seed + 27) * 0.016;
        blendPixel(out, width, x, y, dark ? [236, 228, 212] : [255, 249, 233], a);
      }
    }
  }

  // newsprint dot screen
  if (surface.texture === 'newsprint') {
    for (let y = 0; y < height; y += 4) {
      for (let x = (y / 4) % 2 === 0 ? 1 : 3; x < width; x += 4) {
        blendPixel(out, width, x, y, [33, 35, 32], 0.045);
      }
    }
  }

  // paper fibres
  const fibreCount = surface.texture === 'watercolor' ? 1.5 : surface.texture === 'kraft' ? 1.25 : 1;
  const fibres = Math.round((width * height) / 7200 * fibreCount);
  for (let i = 0; i < fibres; i++) {
    const x = rng() * width;
    const y = rng() * height;
    const len = 3 + rng() * Math.min(32, 8 + width * 0.012);
    const angle = (rng() - 0.5) * 0.9 + (rng() > 0.82 ? 1.1 : 0);
    const steps = Math.max(2, Math.ceil(len));
    const isDark = rng() > (dark ? 0.25 : 0.5);
    const a = (dark ? 0.03 : 0.02) + rng() * 0.025;
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const px = Math.round(x + Math.cos(angle) * len * t);
      const py = Math.round(y + Math.sin(angle) * len * t);
      blendPixel(out, width, px, py, isDark ? markColor : (dark ? [238, 230, 213] : [255, 251, 238]), a);
    }
  }
  return out;
}

/* ---------- grain + composition ---------------------------- */

function composite(width, height, ink, ss, paper, seed, grain, baseRGBA) {
  const out = new Uint8Array(width * height * (baseRGBA ? 4 : 3));
  const invCount = 1 / (ss * ss);
  const grainStrength = Math.max(0, Math.min(1, grain));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const idx = (((y * ss + sy) * width * ss) + (x * ss + sx)) * 4;
          r += ink[idx];
          g += ink[idx + 1];
          b += ink[idx + 2];
          a += ink[idx + 3];
        }
      }
      r *= invCount; g *= invCount; b *= invCount; a *= invCount;

      if (a > 0.25) {
        // clumpy tooth rather than a per-pixel blanket of noise
        const fine = hash2(x, y, seed + 41);
        const clump = noise2(x / 8.5, y / 8.5, seed + 47) * 0.55 +
          noise2(x / 24, y / 24, seed + 53) * 0.45;
        const mask = Math.max(0, (fine * 0.42 + clump * 0.58 - 0.38) / 0.62);
        const f = 1 - grainStrength * 0.62 * Math.pow(mask, 2.2);
        r *= f; g *= f; b *= f; a *= f;
      }

      if (baseRGBA) {
        const p = (y * width + x) * 4;
        if (a === 0) {
          // No paper, vignette or grain is reapplied to old pixels.
          out.set(baseRGBA.subarray(p, p + 4), p);
          continue;
        }
        const sa = a / 255, ba = baseRGBA[p + 3] / 255;
        const alpha = sa + ba * (1 - sa);
        const bg = ba * (1 - sa);
        out[p] = Math.max(0, Math.min(255, Math.round((r + baseRGBA[p] * bg) / alpha)));
        out[p + 1] = Math.max(0, Math.min(255, Math.round((g + baseRGBA[p + 1] * bg) / alpha)));
        out[p + 2] = Math.max(0, Math.min(255, Math.round((b + baseRGBA[p + 2] * bg) / alpha)));
        out[p + 3] = Math.max(0, Math.min(255, Math.round(alpha * 255)));
        continue;
      }
      const pidx = (y * width + x) * 3;
      const invA = 1 - a / 255;
      out[pidx] = Math.max(0, Math.min(255, r + paper[pidx] * invA));
      out[pidx + 1] = Math.max(0, Math.min(255, g + paper[pidx + 1] * invA));
      out[pidx + 2] = Math.max(0, Math.min(255, b + paper[pidx + 2] * invA));
    }
  }
  return out;
}

/* ---------- PNG writer ------------------------------------- */

function chunk(type, data) {
  const bytes = Buffer.allocUnsafe(data.length + 12);
  bytes.writeUInt32BE(data.length, 0);
  bytes.write(type, 4, 4, 'ascii');
  data.copy(bytes, 8);
  bytes.writeUInt32BE(zlib.crc32(bytes.subarray(4, 8 + data.length)), 8 + data.length);
  return bytes;
}

// PNG predicts each byte from neighbours in the same channel. Score the
// residuals as signed bytes so that small differences across 0 count as small.
const residualCost = Uint8Array.from({ length: 256 }, (_, value) => Math.min(value, 256 - value));

function applyScanlineFilters(raw, pixels, stride, channels) {
  const zeroRow = Buffer.alloc(stride);
  const candidates = Array.from({ length: 4 }, () => Buffer.allocUnsafe(stride));
  const [sub, up, average, paeth] = candidates;
  const scores = new Uint32Array(5);
  let changed = false;
  for (let start = 0, row = 0; start < pixels.length; start += stride, row += stride + 1) {
    // Empty rows in a transparent layer already have the lowest possible score.
    if (pixels.compare(zeroRow, 0, stride, start, start + stride) === 0) continue;
    scores.fill(0);
    for (let x = 0; x < stride; x++) {
      const pos = start + x, value = pixels[pos];
      const left = x >= channels ? pixels[pos - channels] : 0;
      const above = start ? pixels[pos - stride] : 0;
      const corner = start && x >= channels ? pixels[pos - stride - channels] : 0;
      const dl = Math.abs(above - corner), da = Math.abs(left - corner);
      const dc = Math.abs(left + above - 2 * corner);
      const predictor = dl <= da && dl <= dc ? left : da <= dc ? above : corner;
      sub[x] = value - left;
      up[x] = value - above;
      average[x] = value - ((left + above) >>> 1);
      paeth[x] = value - predictor;
      scores[0] += residualCost[value];
      scores[1] += residualCost[sub[x]];
      scores[2] += residualCost[up[x]];
      scores[3] += residualCost[average[x]];
      scores[4] += residualCost[paeth[x]];
    }
    let best = 0;
    for (let filter = 1; filter < scores.length; filter++) {
      if (scores[filter] < scores[best]) best = filter;
    }
    if (best) {
      raw[row] = best;
      candidates[best - 1].copy(raw, row + 1);
      changed = true;
    }
  }
  return changed;
}

function encodePNG(width, height, rgb, channels = 3) {
  if (channels !== 3 && channels !== 4) throw new Error('PNG encoder expects RGB or RGBA');
  const stride = width * channels;
  const pixels = Buffer.from(rgb.buffer, rgb.byteOffset, stride * height);
  const raw = Buffer.allocUnsafe((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = channels === 4 ? 6 : 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  // Sparse marks and grainy paper can compress better with no prediction.
  // Keep that exact encoding when the adaptive stream does not save space.
  let idat = zlib.deflateSync(raw, { level: 9 });
  if (applyScanlineFilters(raw, pixels, stride, channels)) {
    const filtered = zlib.deflateSync(raw, { level: 6 });
    if (filtered.length < idat.length) idat = filtered;
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/**
 * Render the core's primitives to a PNG.
 * @param {object} built result of QuietLineCore.buildSketch
 * @param {object} opts size, seed, grain, surface
 * @returns {{png: Buffer, width: number, height: number, surface: string, grain: number}}
 */
function renderPNG(built, opts) {
  const clampDim = v => Math.max(320, Math.min(CORE.MAX_CANVAS_SIDE, Math.round(v)));
  const oil = built.brush === 'oil' || built.brush === 'oilknife';
  if ((opts.paintState != null || opts.captureState) && !oil) throw new Error('Paint state requires oil or oilknife');
  if (opts.paintState != null && opts.baseImage) throw new Error('paintState cannot be combined with a base image');
  // Preserve caller-owned snapshots by default. The project bridge may transfer ownership.
  let restored = opts.paintState;
  if (restored && !opts.consumePaintState) restored = PAINT_STATE.clonePaintState(restored);
  const meta = restored && restored.metadata;
  const base = opts.baseImage || (restored && restored.baseRGBA ? { width: meta.width, height: meta.height, rgba: restored.baseRGBA } : null);
  const hasSize = opts.width != null || opts.height != null || opts.size != null;
  const width = base ? base.width : meta && !hasSize ? meta.width : clampDim(opts.width || opts.height || opts.size || 1200);
  const height = base ? base.height : meta && !hasSize ? meta.height : clampDim(opts.height || opts.width || opts.size || 1200);
  const surface = opts.surface || (meta && meta.surface) || built.surface || 'warm';
  const seed = opts.seed == null && meta ? meta.seed : (opts.seed || 1);
  const grain = opts.grain == null ? (meta ? meta.grain : built.grain == null ? 0.46 : built.grain) : opts.grain;
  if (meta && (width !== meta.width || height !== meta.height ||
      surface !== meta.surface || seed !== meta.seed || grain !== meta.grain ||
      (hasSize && ((opts.width != null && opts.width !== meta.width) ||
       (opts.height != null && opts.height !== meta.height) ||
       (opts.size != null && (opts.size !== meta.width || opts.size !== meta.height)))))) {
    throw new Error('Paint state dimensions/surface/seed/grain mismatch');
  }
  if (base && (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
      width > CORE.MAX_CANVAS_SIDE || height > CORE.MAX_CANVAS_SIDE || !(base.rgba instanceof Uint8Array) || base.rgba.length !== width * height * 4)) {
    throw new Error('Invalid base image dimensions or RGBA buffer');
  }
  const ss = 2;
  const W = width * ss;
  const H = height * ss;
  const ink = restored ? restored.ink : new Uint8Array(W * H * 4);
  const oilState = restored ? restored.oil : oil ? OIL.createOilState(W, H, ss, {
    surface,
    seed: seed ^ 0x1b873593
  }) : null;
  let filmRelief = opts.fixedPaintRelief && oilState?.painted ? oilState.impasto : undefined;
  let lastOilGroup = -1;
  for (const primitive of built.primitives) {
    if (oil && primitive.kind === 'stroke' && primitive.group != null && primitive.brush === built.brush) {
      if (primitive.group === lastOilGroup || (opts.fixedPaintRelief && primitive.flow === 0)) continue;
      lastOilGroup = primitive.group;
      OIL.paintOilStroke(ink, W, H, ss, primitive, {
        knife: built.brush === 'oilknife',
        wetness: opts.wetness == null ? 0.55 : opts.wetness,
        impasto: opts.impasto == null ? 0.62 : opts.impasto,
        load: opts.load == null ? 0.65 : opts.load,
        seed
      }, oilState);
      if (opts.fixedPaintRelief && oilState.painted) {
        // New paint uses the selected thickness; keep lighting of the retained film stable.
        filmRelief ??= oilState.impasto;
        oilState.impasto = filmRelief;
      }
      continue;
    }
    // anything that is not a paint stroke is a wash, a charge or a mark that
    // belongs under the paint now on the board: resolve the film first so the
    // oil keeps its place in the drawing order
    if (oilState && oilState.painted) {
      OIL.flushOil(ink, W, H, ss, oilState);
      filmRelief = undefined;
    }
    const poly = primitive.kind === 'stroke' ? primitive.outline : primitive.polygon;
    if (poly && poly.length >= 3) {
      const scaled = new Array(poly.length);
      for (let i = 0; i < poly.length; i++) scaled[i] = [poly[i][0] * ss, poly[i][1] * ss];
      fillPolygon(ink, W, H, scaled, primitive.color, primitive.alpha);
    }
  }
  const paper = restored ? restored.paper : base ? null : paintPaper(width, height, seed ^ 0x1b873593, surface);
  let paintState;
  if (opts.captureState) {
    // Capture *before* the final presentation-only flush: flushing clears the
    // wet film and updates dry pickup, so capturing afterwards breaks split
    // stroke equivalence. The normal non-capturing path does no copying.
    const snapshot = {
      version: 1,
      metadata: { width, height, ss, brush: built.brush, surface, seed, grain,
        itemOffset: opts.itemOffset == null ? (meta ? meta.itemOffset : 0) : opts.itemOffset,
        settings: opts.settings === undefined ? (meta ? meta.settings : null) : opts.settings },
      ink, paper, baseRGBA: base ? base.rgba : null,
      oil: { ...oilState, capA: oilState.capA || null, capB: oilState.capB || null }
    };
    // A synchronous writer may serialize the live buffers before preview composition.
    if (typeof opts.captureState === 'function') opts.captureState(snapshot);
    else paintState = PAINT_STATE.clonePaintState(snapshot);
  }
  if (oilState) OIL.flushOil(ink, W, H, ss, oilState);
  const rgb = composite(width, height, ink, ss, paper, seed, grain, base && base.rgba);
  const png = encodePNG(width, height, rgb, base ? 4 : 3);
  return { png, width, height, surface, grain, ...(paintState ? { paintState } : {}) };
}

function resizeRGB(rgb, width, height, nextSize) {
  const out = new Uint8Array(nextSize * nextSize * 3);
  const scale = width / nextSize;
  for (let y = 0; y < nextSize; y++) {
    const sy0 = Math.floor(y * scale);
    const sy1 = Math.max(sy0 + 1, Math.min(height, Math.ceil((y + 1) * scale)));
    for (let x = 0; x < nextSize; x++) {
      const sx0 = Math.floor(x * scale);
      const sx1 = Math.max(sx0 + 1, Math.min(width, Math.ceil((x + 1) * scale)));
      let r = 0, g = 0, b = 0, count = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const idx = (sy * width + sx) * 3;
          r += rgb[idx]; g += rgb[idx + 1]; b += rgb[idx + 2]; count++;
        }
      }
      const idx = (y * nextSize + x) * 3;
      out[idx] = r / count;
      out[idx + 1] = g / count;
      out[idx + 2] = b / count;
    }
  }
  return out;
}

/** Encode an already-rendered RGB image, optionally at a smaller size. */
function encodePreview(rgb, width, height, maxSize) {
  if (maxSize && maxSize < width) {
    const rgb2 = resizeRGB(rgb, width, height, maxSize);
    return { png: encodePNG(maxSize, maxSize, rgb2), width: maxSize, height: maxSize };
  }
  return { png: encodePNG(width, height, rgb), width, height };
}

module.exports = {
  renderPNG,
  encodePNG,
  encodePreview,
  paintPaper,
  fillPolygon,
  createOilState: OIL.createOilState,
  paintOilStroke: OIL.paintOilStroke,
  flushOil: OIL.flushOil,
  resizeRGB
};
