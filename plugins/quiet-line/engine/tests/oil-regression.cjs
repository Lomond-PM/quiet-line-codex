'use strict';
// No user artwork/profile access. Run: node tests/oil-regression.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const CORE = require('../lib/core.cjs');
const OIL = require('../lib/oil.cjs');
const STATE = require('../lib/paint-state.cjs');
const RASTER = require('../lib/raster.cjs');
const N = 96, ink = new Uint8Array(N * N * 4);
const style = { brush: 'oil', seed: 31, weight: 4.5, pressure: 0, wobble: 0, texture: 0, padding: 0 };
const options = { seed: 31, load: 1, impasto: .8, wetness: 1 };
function primitive(controlled, brush = 'oil', extra = {}) {
  return CORE.buildItems([{ type: 'stroke', points: [[.2, .5], [.8, .5]], width: 3,
    color: '#ffffff', opacity: 1, overshoot: 0, ...(controlled ? { controls: [{}, {}] } : {}), ...extra }],
    { ...style, brush }, N).primitives[0];
}
function state(serial = 1, stamp = 1, coverage = 254, color = [23, 73, 169]) {
  const s = OIL.createOilState(N, N, 1, { seed: 31 });
  s.serial = serial; s.cov.fill(coverage); s.hgt.fill(5200); s.stamp.fill(stamp);
  for (let i = 0; i < s.cov.length; i++) s.col.set(color, i * 3);
  s.painted = 1; s.dirty = { x0: 0, y0: 0, x1: N - 1, y1: N - 1 };
  return s;
}
function copy(s) { return structuredClone(s); }
function paint(s, p, opts = {}) { return OIL.paintOilStroke(ink, N, N, 1, p, { ...options, ...opts }, s); }
function roi(s) {
  const rgb = [0, 0, 0]; let n = 0;
  for (let y = 47; y < 49; y++) for (let x = 30; x < 66; x++) {
    const i = y * N + x; for (let k = 0; k < 3; k++) rgb[k] += s.col[i * 3 + k]; n++;
  }
  return rgb.map(v => v / n);
}
function visible(s) { const { stamp, serial, ...rest } = s; return rest; }
const results = [];
for (const brush of ['oil', 'oilknife']) for (const controlled of [false, true]) {
  const name = `${brush}/${controlled ? 'controlled' : 'legacy'}`;
  const p = primitive(controlled, brush), opts = { knife: brush === 'oilknife' };
  // Both branches genuinely honor opacity zero without changing visible film or age.
  const transparent = state(), before = copy(transparent);
  paint(transparent, { ...p, alpha: 0 }, opts);
  assert.deepEqual(transparent, before, `${name}: alpha zero is a true no-op`);
  const thin = state(), opaque = copy(thin);
  paint(thin, { ...p, alpha: .05 }, { ...opts, wetness: 0 });
  paint(opaque, { ...p, alpha: .35 }, { ...opts, wetness: 0 });
  assert.ok(roi(thin)[0] < roi(opaque)[0], `${name}: alpha below .35 is not clamped`);
  const fresh = state(), zero = copy(fresh), dry = copy(fresh);
  paint(fresh, p, opts); paint(zero, p, { ...opts, wetness: 0 });
  OIL.dryOilState(dry); paint(dry, p, opts);
  assert.ok(roi(zero)[0] > roi(fresh)[0] + 5, `${name}: zero wetness disables pickup`);
  assert.ok(roi(dry)[0] > roi(fresh)[0] + 5, `${name}: dry film is not a pigment source`);
  const resolved = OIL.createOilState(N, N, 1, { seed: 31 });
  resolved.dryA.fill(1); resolved.dryB.fill(180);
  const resolvedZero = copy(resolved);
  paint(resolved, p, opts); paint(resolvedZero, p, { ...opts, wetness: 0 });
  assert.ok(roi(resolved).every((v, k) => Math.abs(v - roi(resolvedZero)[k]) < 2), `${name}: resolved dry cache never supplies wet colour`);
  // Rebase keeps exact ages for recent pixels and retires old ones. An old
  // nonempty stamp=1 must not turn into the new stroke at the 250 boundary.
  const wrap = state(250, 1), recentIndex = 0, dryIndex = 1;
  wrap.stamp[recentIndex] = 250;
  const freshMaterial = { col: wrap.col[0], cov: wrap.cov[0], hgt: wrap.hgt[0] };
  paint(wrap, p, opts);
  assert.equal(wrap.serial, 30, `${name}: serial remains compatible and rebased`);
  assert.equal(wrap.stamp[recentIndex], 29, `${name}: previous stroke is still age one`);
  assert.equal(wrap.stamp[dryIndex], 0, `${name}: old untouched film retired`);
  assert.deepEqual({ col: wrap.col[0], cov: wrap.cov[0], hgt: wrap.hgt[0] }, freshMaterial);
  // Legacy snapshots across the former wrap are read as modulo 250 ages.
  const oldWrap = state(1, 250), equivalent = state(31, 30);
  paint(oldWrap, p, opts); paint(equivalent, p, opts);
  assert.deepEqual(oldWrap.col, equivalent.col, `${name}: old wrap recent colour preserved`);
  assert.deepEqual(oldWrap.hgt, equivalent.hgt, `${name}: old wrap recent height preserved`);
  // Former wrap failure: an old bottom layer remains dry after 248/250 strokes.
  const filler = primitive(controlled, brush, { points: [[.02, .02], [.04, .02]], width: .1 });
  const after248 = state(), after250 = state();
  for (let i = 0; i < 248; i++) paint(after248, filler, { ...opts, wetness: 0 });
  for (let i = 0; i < 250; i++) paint(after250, filler, { ...opts, wetness: 0 });
  paint(after248, p, opts); paint(after250, p, opts);
  assert.deepEqual(roi(after248), roi(after250), `${name}: old layers never rewet at cycle`);
  // Weighted RGB samples cannot amplify uniform low-coverage pigments beyond
  // their original channel maxima when painting a darker pigment over them.
  const low = state(1, 1, 64, [40, 80, 120]);
  paint(low, primitive(controlled, brush, { color: '#000000' }), opts);
  for (let i = 0; i < low.cov.length; i++) for (let k = 0; k < 3; k++) {
    assert.ok(low.col[i * 3 + k] <= [40, 80, 120][k], `${name}: coverage-weighted RGB stays bounded`);
  }
  // Change ONLY dry-neighbour pigment in a mixed wet/dry sample footprint.
  // Newly painted wet pixels must be identical: ordinary visible blending over
  // the dry stripes may differ, but dry RGB must not enter the brush's carry.
  const stripesA = state(), stripesB = state();
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x;
    if (y % 2) {
      stripesA.stamp[i] = stripesB.stamp[i] = 0;
      stripesA.cov[i] = stripesB.cov[i] = x % 2 ? 64 : 220;
      stripesA.col.set([200, 20, 20], i * 3);
      stripesB.col.set([20, 200, 20], i * 3);
    } else {
      stripesA.cov[i] = stripesB.cov[i] = x % 2 ? 80 : 240;
    }
  }
  paint(stripesA, p, opts); paint(stripesB, p, opts);
  for (let y = 0; y < N; y += 2) for (let x = 0; x < N; x++) for (let k = 0; k < 3; k++) {
    const ci = (y * N + x) * 3 + k;
    assert.equal(stripesA.col[ci], stripesB.col[ci], `${name}: mixed samples exclude dry-neighbour pigment`);
  }
  // Drying changes no material, rendering bookkeeping or caches. The reserved
  // zero marker survives repeated rebases (1000 real oil strokes).
  const dried = state(), preserved = copy(dried);
  assert.equal(OIL.dryOilState(dried), dried);
  const once = copy(dried);
  assert.equal(OIL.dryOilState(dried), dried);
  assert.deepEqual(dried, once, `${name}: repeated drying is idempotent`);
  assert.deepEqual(visible(dried), visible(preserved), `${name}: drying changes only age`);
  assert.equal(dried.serial, preserved.serial);
  assert.ok(dried.stamp.every(x => x === 0));
  for (let i = 0; i < 1000; i++) paint(dried, filler, { ...opts, wetness: 0 });
  assert.equal(dried.stamp[48 * N + 48], 0, `${name}: permanent dry marker after 1000 strokes`);
  const plain = copy(dried); paint(dried, p, opts); paint(plain, p, { ...opts, wetness: 0 });
  assert.ok(roi(dried)[0] > 150, `${name}: permanent dry film permits light overpainting`);
  // wetness also controls legacy path smoothing/drag geometry and repeated
  // coverage, so do not require cross-wetness pixel equality as a pickup test.
  assert.ok(roi(dried).every((v, k) => Math.abs(v - roi(plain)[k]) < 2), `${name}: no substantial pickup from retired film`);
  results.push({ name, fresh: roi(fresh).map(Math.round), zero: roi(zero).map(Math.round), dry: roi(dry).map(Math.round) });
}
// Observe writes directly: an already-current stamp must never be scraped down.
// A proxy is used only in this unit test, not in persisted or production state.
const scraped = state();
for (const key of ['cov', 'hgt']) {
  const a = scraped[key];
  scraped[key] = new Proxy(a, { get(t, k) { const v = Reflect.get(t, k, t); return typeof v === 'function' ? v.bind(t) : v; },
    set(t, k, value) { if (/^\d+$/.test(k) && scraped.stamp[k] === scraped.serial)
      assert.ok(value >= t[k], `${key}: do not scrape current stroke`); return Reflect.set(t, k, value, t); } });
}
paint(scraped, primitive(false));
// Real snapshot contract remains V1 / Uint8 stamps / serial 0..250, including
// historical boundary values and the new dry markers. Render before and after
// drying must be byte-identical, not just look approximately similar.
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'quiet-line-oil-regression-'));
  try {
    const settings = { weight: 4.5, wobble: 0, pressure: 0, texture: 0, wetness: 1, impasto: .8, load: 1, accent: null };
    const built = CORE.buildItems([{ type: 'stroke', points: [[.2, .5], [.8, .5]], color: '#1748a6', width: 3 }], style, 320);
    const snapshot = RASTER.renderPNG(built, { width: 320, height: 320, seed: 31, captureState: true, settings }).paintState;
    const empty = { ...built, primitives: [] };
    const png = RASTER.renderPNG(empty, { paintState: snapshot }).png;
    OIL.dryOilState(snapshot.oil);
    assert.deepEqual(RASTER.renderPNG(empty, { paintState: snapshot }).png, png, 'drying keeps the visible PNG exact');
    for (const serial of [0, 1, 249, 250]) {
      const saved = STATE.clonePaintState(snapshot); saved.oil.serial = serial;
      const name = `serial-${serial}.qlpaint`;
      await STATE.savePaintState(tmp, name, saved);
      const loaded = await STATE.loadPaintState(tmp, name);
      assert.deepEqual(loaded, saved, 'legacy format exact roundtrip with dry markers');
    }
  } finally {
    assert.ok(path.isAbsolute(tmp) && path.dirname(tmp) === path.resolve(os.tmpdir()) &&
      path.basename(tmp).startsWith('quiet-line-oil-regression-'), 'cleanup only our exact temporary directory');
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(JSON.stringify(results));
  console.log('oil-regression: zero wetness/opacity, weighted pickup, no self-scrape, legacy wrap, 1000-stroke dry state, exact PNG and V1 snapshot roundtrip passed');
})().catch(e => { console.error(e); process.exitCode = 1; });
