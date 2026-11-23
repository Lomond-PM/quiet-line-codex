'use strict';
// Procedural dry-media engine. State is unbaked pigment over an immutable RGBA
// substrate. Only brush-local ellipses are visited while applying an operation.
const CORE = require('./core.cjs');
const { paintPaper, encodePNG } = require('./raster.cjs');
const { cloneDryState, validateDryState } = require('./dry-state.cjs');
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const num = (x, d) => x == null ? d : x;
function range(x, lo, hi, name, integer = false) {
  if (!Number.isFinite(x) || x < lo || x > hi || (integer && !Number.isSafeInteger(x))) throw new Error(`Invalid dry ${name}`);
  return x;
}
function hash(x, y, seed) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function createState(style, opts) {
  const width = range(opts.width, 1, CORE.MAX_CANVAS_SIDE, 'width', true), height = range(opts.height, 1, CORE.MAX_CANVAS_SIDE, 'height', true), n = width * height;
  const seed = range(num(style.seed, 241), 1, 9999, 'seed', true), surface = style.surface || 'warm';
  if (!Object.hasOwn(CORE.SURFACES, surface)) throw new Error('Invalid dry surface');
  const settings = { weight: num(style.weight, 3), wobble: num(style.wobble, .58), pressure: num(style.pressure, .66), texture: num(style.texture, .46), accent: style.accent || null, brush: style.brush || 'pencil', ...opts.settings };
  const grain = num(opts.grain, settings.texture), substrate = new Uint8Array(n * 4), tooth = new Uint8Array(n);
  if (opts.baseImage) {
    const b = opts.baseImage;
    if (b.width !== width || b.height !== height || !(b.rgba instanceof Uint8Array) || b.rgba.length !== n * 4) throw new Error('Invalid dry base image');
    substrate.set(b.rgba);
  } else {
    const paper = paintPaper(width, height, seed, surface);
    for (let i = 0; i < n; i++) { substrate[i * 4] = paper[i * 3]; substrate[i * 4 + 1] = paper[i * 3 + 1]; substrate[i * 4 + 2] = paper[i * 3 + 2]; substrate[i * 4 + 3] = 255; }
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) tooth[y * width + x] = Math.round(255 * (.2 + .8 * (hash(x, y, seed) * .65 + hash(x >> 2, y >> 2, seed + 7) * .35)));
  const state = { version: 1, metadata: { width, height, surface, seed, grain, itemOffset: num(opts.itemOffset, 0), settings }, substrate, tooth, bound: new Float32Array(n), loose: new Float32Array(n), pigment: new Uint8Array(n * 3) };
  validateDryState(state); return state;
}
const GRADES = { H: .2, HB: .35, '2B': .48, '4B': .64, '6B': .8, '8B': 1 };
function operation(raw, defaultTool) {
  const o = { ...raw, tool: raw.tool || defaultTool, width: num(raw.width, 1), pressure: num(raw.pressure, .5), opacity: num(raw.opacity, .95), flow: num(raw.flow, 1), grade: raw.grade || '2B', angle: num(raw.angle, 0), tilt: num(raw.tilt, 0), tip: raw.tip || 'round', aspect: num(raw.aspect, .3), cap: raw.cap || 'round', closed: !!raw.closed };
  if (!['pencil', 'charcoal', 'eraser', 'kneaded', 'smudge'].includes(o.tool)) throw new Error('Invalid dry tool');
  if (!Object.hasOwn(GRADES, o.grade)) throw new Error('Invalid dry grade');
  if (!['round', 'flat'].includes(o.tip) || !['round', 'flat', 'taper'].includes(o.cap)) throw new Error('Invalid dry tip/cap');
  range(o.width, .1, 30, 'width'); range(o.angle, -360, 360, 'angle'); range(o.aspect, .05, 1, 'aspect');
  for (const k of ['pressure', 'opacity', 'flow', 'tilt']) range(o[k], 0, 1, k);
  if (!Array.isArray(o.points) || o.points.length < 2 || o.points.length > 400) throw new Error('Invalid dry points');
  for (const p of o.points) { if (!Array.isArray(p) || p.length !== 2) throw new Error('Invalid dry point'); for (const v of p) range(v, -.2, 1.2, 'coordinate'); }
  if (o.controls != null && (!Array.isArray(o.controls) || o.controls.length !== o.points.length)) throw new Error('Invalid dry controls length');
  o.controls = o.points.map((_, i) => {
    const c = o.controls ? o.controls[i] : {};
    if (!c || typeof c !== 'object' || Array.isArray(c)) throw new Error('Invalid dry control');
    for (const k of Object.keys(c)) if (!['pressure', 'width', 'opacity', 'angle', 'tilt'].includes(k)) throw new Error('Invalid dry control field');
    const value = { pressure: num(c.pressure, o.pressure), width: num(c.width, 1), opacity: num(c.opacity, 1), angle: num(c.angle, o.angle), tilt: num(c.tilt, o.tilt) };
    for (const k of ['pressure', 'opacity', 'tilt']) range(value[k], 0, 1, k);
    range(value.width, 0, 3, 'control width'); range(value.angle, -360, 360, 'control angle'); return value;
  });
  return o;
}
function mixPigment(s, i, color, added, old) {
  const sum = old + added;
  for (let k = 0; k < 3; k++) s.pigment[i * 3 + k] = Math.round((s.pigment[i * 3 + k] * old + color[k] * added) / sum);
}
function applyOperation(s, o, index, stats) {
  const { width: W, height: H, seed, settings, grain } = s.metadata;
  const scale = Math.pow(Math.min(W, H) / 420, .68);
  const radius = Math.max(.4, settings.weight * scale * o.width * .5);
  const palette = CORE.buildPalette(settings.accent, s.metadata.surface);
  if (o.color != null && !(typeof o.color === 'string' && (/^#[0-9a-f]{6}$/i.test(o.color) || ['ink', 'accent', 'clay', 'ochre', 'sage'].includes(o.color)))) throw new Error('Invalid dry color');
  const color = CORE.resolveColor(o.color || 'ink', palette);
  const points = o.points.map(p => [p[0] * W, p[1] * H]), cs = o.controls.slice();
  if (o.closed) { points.push(points[0]); cs.push(cs[0]); }
  const lengths = []; let total = 0;
  for (let i = 1; i < points.length; i++) { const len = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]); lengths.push(len); total += len; }
  if (!total) return;
  const firstSegment = lengths.findIndex(l => l > 0);
  let lastSegment = lengths.length - 1;
  while (lengths[lastSegment] === 0) lastSegment--;
  const start = points[0], end = points[points.length - 1];
  const fdx = points[firstSegment + 1][0] - start[0], fdy = points[firstSegment + 1][1] - start[1];
  const edx = end[0] - points[lastSegment][0], edy = end[1] - points[lastSegment][1];
  let walked = 0;
  for (let seg = 0; seg < lengths.length; seg++) {
    const a = points[seg], b = points[seg + 1], len = lengths[seg];
    if (len < 1e-9) continue;
    const dx = (b[0] - a[0]) / len, dy = (b[1] - a[1]) / len;
    // Pixel-sized spacing for fine tools; large tools use contact-relative steps.
    const steps = Math.max(1, Math.ceil(len / Math.max(.55, radius * .3)));
    for (let j = 0; j <= steps; j++) {
      if (seg && !j) continue;
      const t = j / steps, c = {}, ca = cs[seg], cb = cs[seg + 1];
      for (const k of ['pressure', 'width', 'opacity', 'tilt']) c[k] = ca[k] + (cb[k] - ca[k]) * t;
      const da = ((cb.angle - ca.angle + 180) % 360 + 360) % 360 - 180;
      c.angle = ca.angle + da * t;
      if (!c.pressure || !c.width || !c.opacity || !o.opacity || !o.flow) continue;
      const distance = walked + len * t;
      const taper = o.cap === 'taper' && !o.closed ? clamp(Math.min(distance, total - distance) / Math.max(1, radius * 2)) : 1;
      if (!taper) continue;
      const r = radius * c.width * taper;
      const major = r * (1 + c.tilt * 3), minor = Math.max(.2, r * (o.tip === 'flat' ? o.aspect : 1) * (1 - c.tilt * .65));
      const angle = c.angle * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
      const wobble = settings.wobble * .35 * Math.sin(distance * .13 + index * 1.73 + seed);
      const cx = a[0] + (b[0] - a[0]) * t - dy * wobble, cy = a[1] + (b[1] - a[1]) * t + dx * wobble;
      const rx = Math.abs(cos) * major + Math.abs(sin) * minor, ry = Math.abs(sin) * major + Math.abs(cos) * minor;
      const x0 = Math.max(0, Math.floor(cx - rx - 1)), x1 = Math.min(W - 1, Math.ceil(cx + rx + 1));
      const y0 = Math.max(0, Math.floor(cy - ry - 1)), y1 = Math.min(H - 1, Math.ceil(cy + ry + 1));
      const moveX = Math.round(dx * Math.max(1, r * .4)), moveY = Math.round(dy * Math.max(1, r * .4));
      // Visit against transport direction: a stamp cannot repeatedly transport a
      // newly received parcel. Each transfer conserves mass and respects capacity.
      const sx = moveX > 0 ? -1 : 1, sy = moveY > 0 ? -1 : 1;
      for (let y = sy > 0 ? y0 : y1; sy > 0 ? y <= y1 : y >= y0; y += sy) {
        for (let x = sx > 0 ? x0 : x1; sx > 0 ? x <= x1 : x >= x0; x += sx) {
          stats.pixelVisits++;
          const px = x + .5 - cx, py = y + .5 - cy;
          const u = (px * cos + py * sin) / major, v = (-px * sin + py * cos) / minor;
          const dist = u * u + v * v;
          if (dist >= 1) continue;
          if (o.cap === 'flat' && !o.closed) {
            if ((x + .5 - start[0]) * fdx + (y + .5 - start[1]) * fdy < 0 || (x + .5 - end[0]) * edx + (y + .5 - end[1]) * edy > 0) continue;
          }
          const autoPressure = clamp(1 + settings.pressure * .12 * Math.sin(distance * .17 + index * 2.1 + seed), .8, 1.2);
          const i = y * W + x, edge = clamp((1 - dist) * 3), strength = Math.min(1, edge * c.pressure * c.opacity * o.opacity * o.flow * autoPressure);
          const old = s.bound[i] + s.loose[i];
          if (o.tool === 'eraser' || o.tool === 'kneaded') {
            const factor = o.tool === 'eraser' ? .88 : .48;
            s.loose[i] *= 1 - strength * factor;
            s.bound[i] *= 1 - strength * (o.tool === 'eraser' ? .8 : .09);
            if (s.loose[i] < .00001) s.loose[i] = 0;
            if (s.bound[i] < .00001) s.bound[i] = 0;
          } else if (o.tool === 'smudge') {
            const tx = x + moveX, ty = y + moveY;
            if ((!moveX && !moveY) || tx < 0 || tx >= W || ty < 0 || ty >= H || !s.loose[i]) continue;
            const dest = ty * W + tx, destMass = s.bound[dest] + s.loose[dest];
            const amount = Math.min(s.loose[i] * strength * .24, Math.max(0, 1 - destMass));
            if (!amount) continue;
            mixPigment(s, dest, s.pigment.subarray(i * 3, i * 3 + 3), amount, destMass);
            s.loose[i] -= amount; s.loose[dest] += amount;
          } else {
            const soft = GRADES[o.grade], charcoal = o.tool === 'charcoal';
            const tooth = s.tooth[i] / 255;
            const contact = clamp((c.pressure * .8 + soft * .35 + .15 - tooth * grain * .9) * 2);
            const deposit = Math.min(1 - old, strength * contact * (.035 + soft * .11) * (charcoal ? 1.35 : .85) * (1 - old));
            if (deposit <= 0) continue;
            mixPigment(s, i, color, deposit, old);
            const looseFraction = charcoal ? .78 : .18 + soft * .25;
            s.loose[i] += deposit * looseFraction; s.bound[i] += deposit * (1 - looseFraction);
          }
        }
      }
    }
    walked += len;
  }
}
function composite(s) {
  const n = s.metadata.width * s.metadata.height, out = new Uint8Array(s.substrate);
  for (let i = 0; i < n; i++) {
    const amount = s.bound[i] + s.loose[i];
    if (!amount) continue; // Preserve invisible substrate RGB as well as alpha.
    const sa = .96 * (1 - Math.exp(-3.4 * amount)), ba = s.substrate[i * 4 + 3] / 255, a = sa + ba * (1 - sa);
    for (let k = 0; k < 3; k++) out[i * 4 + k] = Math.round((s.pigment[i * 3 + k] * sa + s.substrate[i * 4 + k] * ba * (1 - sa)) / a);
    out[i * 4 + 3] = Math.round(a * 255);
  }
  return out;
}
function renderDry(operations, style = {}, opts = {}) {
  if (!Array.isArray(operations) || operations.length > 600) throw new Error('Invalid dry operations');
  if (operations.reduce((n, o) => n + (o.points?.length || 0), 0) > 40000) throw new Error('Invalid dry total points');
  if (opts.state && opts.baseImage) throw new Error('Dry state/base image are exclusive');
  const s = opts.state ? cloneDryState(opts.state) : createState(style, opts), m = s.metadata;
  if (opts.state) {
    for (const k of ['width', 'height']) if (opts[k] != null && opts[k] !== m[k]) throw new Error(`Dry state ${k} mismatch`);
    for (const k of ['surface', 'seed']) if (style[k] != null && style[k] !== m[k]) throw new Error(`Dry state ${k} mismatch`);
    if (opts.grain != null && opts.grain !== m.grain) throw new Error('Dry state grain mismatch');
    // Drawing defaults may change; substrate/tooth/seed/grain remain fixed.
    for (const k of Object.keys(m.settings)) if (style[k] != null) m.settings[k] = style[k];
    Object.assign(m.settings, opts.settings || {});
    validateDryState(s);
  }
  const offset = num(opts.itemOffset, m.itemOffset);
  if (opts.state && offset !== m.itemOffset) throw new Error('Dry state itemOffset mismatch');
  range(offset, 0, Number.MAX_SAFE_INTEGER - operations.length, 'itemOffset', true);
  const stats = { operations: operations.length, pixelVisits: 0 };
  for (let i = 0; i < operations.length; i++) applyOperation(s, operation(operations[i], m.settings.brush), offset + i, stats);
  m.itemOffset = offset + operations.length;
  const rgba = composite(s), png = encodePNG(m.width, m.height, rgba, 4);
  return { png, width: m.width, height: m.height, surface: m.surface, grain: m.grain, stats, ...(opts.captureState ? { paintState: s } : {}) };
}
module.exports = { renderDry };
