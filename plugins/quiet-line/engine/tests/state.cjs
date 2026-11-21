'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const CORE = require('../lib/core.cjs');
const { renderPNG } = require('../lib/raster.cjs');
const { savePaintState, loadPaintState, clonePaintState } = require('../lib/paint-state.cjs');
const cwd = fs.mkdtempSync(path.join(__dirname, 'state-test-'));
let count = 0;
const opts = { width: 320, height: 320, surface: 'linen', seed: 271, grain: 0.35, wetness: 0.8 };
function build(brush, dimensions = { width: 320, height: 320 }) {
  return CORE.buildSketch({ items: [
    CORE.stroke([[0.2, 0.45], [0.45, 0.5], [0.75, 0.4]], { width: 2.5, color: '#c34a35' }),
    CORE.stroke([[0.45, 0.2], [0.5, 0.45], [0.55, 0.75]], { width: 2.5, color: '#467daf' })
  ] }, { seed: opts.seed, weight: 3, wobble: 0.3, pressure: 0.6, texture: 0.4, padding: 0.02, brush, surface: 'linen' }, dimensions);
}
function sameSplit(brush, baseImage) {
  const built = build(brush, baseImage ? { width: baseImage.width, height: baseImage.height } : undefined);
  // Keep the already-built primitive group IDs fixed: a fresh CORE build may
  // otherwise reseed group-dependent bristles, which is unrelated to resume.
  const groups = [...new Set(built.primitives.filter(p => p.kind === 'stroke').map(p => p.group))];
  assert.equal(groups.length, 2);
  const first = { ...built, primitives: built.primitives.filter(p => p.group === groups[0]) };
  const second = { ...built, primitives: built.primitives.filter(p => p.group === groups[1]) };
  const o = { ...opts, ...(baseImage ? { baseImage } : {}) };
  const full = renderPNG(built, o);
  assert.equal(Object.hasOwn(full, 'paintState'), false);
  const settings = { weight: 3, wobble: 0.3, pressure: 0.6, texture: 0.4, wetness: 0.8, impasto: 0.62, load: 0.65, accent: '#b95035' };
  const a = renderPNG(first, { ...o, captureState: true, itemOffset: 1, settings });
  assert.deepEqual(a.paintState.metadata.settings, settings);
  assert.notEqual(a.paintState.metadata.settings, settings, 'settings snapshot must not alias caller');
  assert.equal(a.paintState.oil.painted, 1, 'snapshot must retain unflushed wet film');
  assert.equal(a.paintState.metadata.itemOffset, 1);
  const before = clonePaintState(a.paintState);
  const b = renderPNG(second, { paintState: a.paintState, wetness: opts.wetness, captureState: true, itemOffset: 2 });
  assert.deepEqual(b.png, full.png, `${brush} split PNG equals single call (${baseImage ? 'base' : 'paper'})`);
  assert.deepEqual(b.paintState.metadata.settings, settings, 'resume inherits settings');
  assert.notEqual(b.paintState.metadata.settings, a.paintState.metadata.settings, 'resume deep-copies settings');
  assert.deepEqual(a.paintState, before, 'resume does not mutate input snapshot');
  const noMarks = { ...built, primitives: [] };
  const again = renderPNG(noMarks, { paintState: b.paintState });
  assert.deepEqual(again.png, full.png, 'presentation must not double-composite film');
  const output = savePaintState(cwd, `roundtrip-${brush}-${baseImage ? 'base' : 'paper'}.qlpaint`, b.paintState);
  assert.equal(path.isAbsolute(output), true);
  const loaded = loadPaintState(cwd, output);
  assert.deepEqual(loaded, b.paintState, 'all arrays, scalar counters, paper/base roundtrip');
  assert.deepEqual(renderPNG(noMarks, { paintState: loaded }).png, full.png);
  assert.throws(() => savePaintState(cwd, output, b.paintState), /EEXIST/);
  assert.throws(() => savePaintState(cwd, '../escape.qlpaint', b.paintState), /working directory/);
  for (const mismatch of [{ seed: 2 }, { surface: 'warm' }, { grain: 0.8 }, { width: 321 }, { size: 321 }, { baseImage: { width: 1 } }]) {
    assert.throws(() => renderPNG(second, { paintState: loaded, ...mismatch }), /mismatch|combined/);
  }
  assert.throws(() => renderPNG({ ...second, brush: 'ink' }, { paintState: loaded }), /oil/);
  assert.throws(() => renderPNG({ ...second, brush: 'ink' }, { captureState: true }), /oil/);
  assert.throws(() => renderPNG({ ...second, brush: brush === 'oil' ? 'oilknife' : 'oil' }, { paintState: loaded }), /mismatch/);
  count++;
  return { snapshot: b.paintState, file: output, built };
}
function corrupt(file, mutateHeader, mutatePayload) {
  const original = fs.readFileSync(file), length = original.readUInt32LE(8);
  const header = JSON.parse(original.toString('utf8', 12, 12 + length));
  if (mutateHeader) mutateHeader(header);
  const json = Buffer.from(JSON.stringify(header));
  const prefix = Buffer.from(original.subarray(0, 12)); prefix.writeUInt32LE(json.length, 8);
  const payload = original.subarray(12 + length);
  const result = Buffer.concat([prefix, json, mutatePayload ? mutatePayload(payload) : payload]);
  const output = path.join(cwd, `corrupt-${count++}.qlpaint`); fs.writeFileSync(output, result);
  assert.throws(() => loadPaintState(cwd, output), /Invalid paint state/);
}
try {
  const { snapshot, file, built } = sameSplit('oil');
  sameSplit('oilknife');
  const rgba = new Uint8Array(80 * 64 * 4);
  for (let i = 0; i < rgba.length; i += 4) { rgba[i] = 80; rgba[i + 1] = 110; rgba[i + 2] = 160; rgba[i + 3] = (i % 12) ? 180 : 0; }
  sameSplit('oil', { width: 80, height: 64, rgba });
  sameSplit('oilknife', { width: 80, height: 64, rgba });
  // A real ordering flush (non-oil wash) is also preserved, including dry tiles.
  const split = built.primitives.findIndex(p => p.group !== built.primitives[0].group);
  const wash = { kind: 'fill', polygon: [[100, 100], [180, 100], [180, 180]], color: [20, 40, 60], alpha: 0.4 };
  const combined = { ...built, primitives: [...built.primitives.slice(0, split), wash, ...built.primitives.slice(split)] };
  const cut = split + 1;
  const stage = renderPNG({ ...combined, primitives: combined.primitives.slice(0, cut) }, { ...opts, captureState: true });
  assert.equal(stage.paintState.metadata.settings, null, 'missing settings default to null');
  assert.equal(stage.paintState.oil.painted, 0);
  assert.ok(stage.paintState.oil.dryA.some(x => x > 0));
  assert.deepEqual(renderPNG({ ...combined, primitives: combined.primitives.slice(cut) }, { ...opts, paintState: stage.paintState }).png, renderPNG(combined, opts).png);
  corrupt(file, h => { h.version = 9; });
  corrupt(file, h => { h.metadata.width = 1801; });
  corrupt(file, h => { h.metadata.ss = 16; });
  corrupt(file, h => { h.metadata.seed = '271'; });
  corrupt(file, h => { h.metadata.itemOffset = -1; });
  corrupt(file, h => { h.metadata.settings = []; });
  corrupt(file, h => { h.metadata.settings.weight = 0; });
  corrupt(file, h => { h.metadata.settings.texture = 100; });
  corrupt(file, h => { h.metadata.settings.load = '0.5'; });
  corrupt(file, h => { h.metadata.settings.accent = 'red'; });
  corrupt(file, h => { h.metadata.settings.extra = 1; });
  corrupt(file, h => { delete h.metadata.settings; });
  corrupt(file, h => { h.ink.type = 'f32'; });
  corrupt(file, h => { h.ink.length++; });
  corrupt(file, h => { h.oil.serial = 256; });
  corrupt(file, h => { h.oil.dirty.x1 = 999999; });
  corrupt(file, h => { h.baseRGBA = h.paper; });
  corrupt(file, null, p => p.subarray(0, p.length - 5));
  corrupt(file, null, p => Buffer.concat([p, Buffer.from('trailing')]));
  corrupt(file, null, p => zlib.deflateSync(Buffer.concat([zlib.inflateSync(p), Buffer.alloc(1)])));
  corrupt(file, null, p => zlib.deflateSync(zlib.inflateSync(p).subarray(1)));
  const invalid = clonePaintState(snapshot); invalid.oil.dryR[0] = NaN;
  assert.throws(() => savePaintState(cwd, 'nan.qlpaint', invalid), /Invalid paint state/);
  const invalid2 = clonePaintState(snapshot); invalid2.ink = new Uint8ClampedArray(snapshot.ink);
  assert.throws(() => savePaintState(cwd, 'wrongtype.qlpaint', invalid2), /type/);
  const bufferBase = clonePaintState(snapshot);
  bufferBase.paper = null;
  bufferBase.baseRGBA = Buffer.alloc(snapshot.metadata.width * snapshot.metadata.height * 4);
  assert.throws(() => savePaintState(cwd, 'buffer-base.qlpaint', bufferBase), /baseRGBA type\/length/,
    'snapshot validation must still reject Buffer subclasses; normalize trusted decoder output instead');
  console.log('state: PASS — oil/oilknife split/single byte equality, paper/RGBA, flush ordering, exclusive safe roundtrip, strict corruption/size/type checks');
} finally {
  // This directory is a fresh child of this test's own directory, never user data.
  assert.equal(path.dirname(cwd), __dirname);
  assert.ok(path.basename(cwd).startsWith('state-test-'));
  fs.rmSync(cwd, { recursive: true, force: true });
}
