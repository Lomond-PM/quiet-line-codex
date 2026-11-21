'use strict';

// A bounded, versioned JSON header followed by zlib-compressed typed-array bytes.
// No executable object deserializer is used for files supplied by the caller.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const CORE = require('./core.cjs');
const MAGIC = Buffer.from('QLPAINT1');
const VERSION = 1;
const MAX_BYTES = 192 * 1024 * 1024;
const MAX_HEADER = 16384;
const TYPES = { u8: Uint8Array, u16: Uint16Array, f32: Float32Array };
const littleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
function fail(message) { throw new Error(`Invalid paint state: ${message}`); }
function object(v) { return v && typeof v === 'object' && !Array.isArray(v) && !ArrayBuffer.isView(v); }
function keys(v, expected, label) {
  if (!object(v) || Object.keys(v).sort().join(',') !== expected.slice().sort().join(',')) fail(`${label} fields`);
}
function number(v, lo, hi, label, integer = false) {
  if (!Number.isFinite(v) || v < lo || v > hi || (integer && !Number.isInteger(v))) fail(label);
}
function cap(v, label) {
  if (v === null) return;
  keys(v, ['x', 'y', 'nx', 'ny'], label);
  number(v.x, -1e7, 1e7, label); number(v.y, -1e7, 1e7, label);
  number(v.nx, -1, 1, label); number(v.ny, -1, 1, label);
}

// With descriptors=true, validate the entire header before allocating/inflating.
function validate(snapshot, descriptors = false) {
  keys(snapshot, ['version', 'metadata', 'ink', 'paper', 'baseRGBA', 'oil'], 'snapshot');
  if (snapshot.version !== VERSION) fail('unsupported version');
  const m = snapshot.metadata;
  keys(m, ['width', 'height', 'ss', 'brush', 'surface', 'seed', 'grain', 'itemOffset', 'settings'], 'metadata');
  number(m.width, 1, 1800, 'width', true); number(m.height, 1, 1800, 'height', true);
  if (m.ss !== 2) fail('supersampling');
  if (m.brush !== 'oil' && m.brush !== 'oilknife') fail('brush must be oil or oilknife');
  if (typeof m.surface !== 'string' || !Object.hasOwn(CORE.SURFACES, m.surface)) fail('surface');
  number(m.seed, 1, 9999, 'seed', true); number(m.grain, 0, 1, 'grain');
  number(m.itemOffset, 0, Number.MAX_SAFE_INTEGER, 'itemOffset', true);
  if (m.settings !== null) {
    keys(m.settings, ['weight', 'wobble', 'pressure', 'texture', 'wetness', 'impasto', 'load', 'accent'], 'settings');
    number(m.settings.weight, 1.5, 4.5, 'settings.weight');
    for (const key of ['wobble', 'pressure', 'texture', 'wetness', 'impasto', 'load']) number(m.settings[key], 0, 1, `settings.${key}`);
    if (m.settings.accent !== null && (typeof m.settings.accent !== 'string' || !/^#[0-9a-f]{6}$/i.test(m.settings.accent))) fail('settings.accent');
  }
  const W = m.width * m.ss, H = m.height * m.ss, n = W * H;
  const oil = snapshot.oil;
  keys(oil, ['width', 'height', 'ss', 'inv', 'surface', 'toothW', 'toothH', 'tooth', 'toothSoft',
    'col', 'cov', 'hgt', 'stamp', 'serial', 'impasto', 'painted', 'dirty', 'tile', 'cols', 'rows',
    'dryR', 'dryG', 'dryB', 'dryA', 'capA', 'capB'], 'oil');
  const tile = Math.max(24, Math.round(26 * m.ss));
  const cols = Math.ceil(W / tile), rows = Math.ceil(H / tile);
  for (const [key, value] of Object.entries({ width: W, height: H, ss: m.ss, inv: 1 / m.ss,
    surface: m.surface, toothW: m.width, toothH: m.height, tile, cols, rows })) {
    if (oil[key] !== value) fail(`oil.${key}`);
  }
  number(oil.serial, 0, 250, 'serial', true); number(oil.impasto, 0, 1, 'impasto');
  number(oil.painted, 0, 1, 'painted', true);
  keys(oil.dirty, ['x0', 'y0', 'x1', 'y1'], 'dirty');
  for (const k of ['x0', 'x1']) number(oil.dirty[k], -1, W, `dirty.${k}`, true);
  for (const k of ['y0', 'y1']) number(oil.dirty[k], -1, H, `dirty.${k}`, true);
  if (oil.painted ? (oil.dirty.x0 > oil.dirty.x1 || oil.dirty.y0 > oil.dirty.y1 ||
    oil.dirty.x0 < 0 || oil.dirty.y0 < 0 || oil.dirty.x1 >= W || oil.dirty.y1 >= H) :
    (oil.dirty.x0 !== W || oil.dirty.y0 !== H || oil.dirty.x1 !== -1 || oil.dirty.y1 !== -1)) fail('dirty bounds');
  cap(oil.capA, 'capA'); cap(oil.capB, 'capB');
  const arrays = [];
  let total = 0;
  function array(owner, key, type, length) {
    const v = owner[key], Ctor = TYPES[type];
    if (descriptors) {
      keys(v, ['type', 'length'], key);
      if (v.type !== type || v.length !== length) fail(`${key} type/length`);
    } else {
      if (!(v instanceof Ctor) || v.constructor !== Ctor || v.length !== length) fail(`${key} type/length`);
      if (type === 'f32') for (const x of v) number(x, 0, 255, key);
    }
    total += length * Ctor.BYTES_PER_ELEMENT;
    if (total > MAX_BYTES) fail('allocation limit');
    arrays.push({ owner, key, type, length });
  }
  array(snapshot, 'ink', 'u8', n * 4);
  if ((snapshot.paper === null) === (snapshot.baseRGBA === null)) fail('exactly one paper/baseRGBA required');
  if (snapshot.paper !== null) array(snapshot, 'paper', 'u8', m.width * m.height * 3);
  if (snapshot.baseRGBA !== null) array(snapshot, 'baseRGBA', 'u8', m.width * m.height * 4);
  array(oil, 'tooth', 'u8', m.width * m.height);
  array(oil, 'toothSoft', 'u8', m.width * m.height);
  array(oil, 'col', 'u8', n * 3); array(oil, 'cov', 'u8', n);
  array(oil, 'hgt', 'u16', n); array(oil, 'stamp', 'u8', n);
  for (const k of ['dryR', 'dryG', 'dryB', 'dryA']) array(oil, k, 'f32', cols * rows);
  return { arrays, total };
}
function clonePaintState(snapshot) {
  const { arrays } = validate(snapshot);
  const copy = { ...snapshot, metadata: { ...snapshot.metadata,
    settings: snapshot.metadata.settings && { ...snapshot.metadata.settings } }, oil: { ...snapshot.oil,
    dirty: { ...snapshot.oil.dirty }, capA: snapshot.oil.capA && { ...snapshot.oil.capA },
    capB: snapshot.oil.capB && { ...snapshot.oil.capB } } };
  for (const a of arrays) (a.owner === snapshot ? copy : copy.oil)[a.key] = new TYPES[a.type](a.owner[a.key]);
  return copy;
}
function outputPath(cwd, requestedPath) {
  if (typeof requestedPath !== 'string' || !requestedPath.trim()) throw new Error('save_state requires a new file path');
  const root = fs.realpathSync(cwd), target = path.resolve(root, requestedPath);
  const relative = path.relative(root, target);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('State output must be inside the working directory');
  // Resolve the existing parent to reject junction/symlink escapes as well.
  const parent = fs.realpathSync(path.dirname(target));
  const realRelative = path.relative(root, parent);
  if (realRelative === '..' || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) throw new Error('State output parent must be inside the working directory');
  return path.join(parent, path.basename(target));
}
function savePaintState(cwd, requestedPath, snapshot) {
  const { arrays } = validate(snapshot);
  const header = { ...snapshot, metadata: { ...snapshot.metadata }, oil: { ...snapshot.oil } };
  const chunks = [];
  for (const a of arrays) {
    const v = a.owner[a.key];
    let bytes = Buffer.from(v.buffer, v.byteOffset, v.byteLength);
    if (!littleEndian && a.type !== 'u8') { bytes = Buffer.from(bytes); a.type === 'u16' ? bytes.swap16() : bytes.swap32(); }
    chunks.push(bytes);
    (a.owner === snapshot ? header : header.oil)[a.key] = { type: a.type, length: a.length };
  }
  const json = Buffer.from(JSON.stringify(header));
  if (json.length > MAX_HEADER) fail('header limit');
  const prefix = Buffer.alloc(12); MAGIC.copy(prefix); prefix.writeUInt32LE(json.length, 8);
  const compressed = zlib.deflateSync(Buffer.concat(chunks));
  const target = outputPath(cwd, requestedPath);
  fs.writeFileSync(target, Buffer.concat([prefix, json, compressed]), { flag: 'wx' });
  return target;
}
function loadPaintState(cwd, requestedPath) {
  if (typeof requestedPath !== 'string' || !requestedPath.trim()) fail('input path');
  const target = path.resolve(cwd, requestedPath);
  const fd = fs.openSync(target, 'r');
  let bytes;
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size < 14 || stat.size > MAX_BYTES + MAX_HEADER) fail('file size');
    bytes = Buffer.alloc(stat.size);
    let read = 0;
    while (read < bytes.length) {
      const count = fs.readSync(fd, bytes, read, bytes.length - read, null);
      if (!count) fail('truncated file');
      read += count;
    }
    if (fs.readSync(fd, Buffer.alloc(1), 0, 1, null)) fail('file changed while reading');
  } finally { fs.closeSync(fd); }
  if (!bytes.subarray(0, 8).equals(MAGIC)) fail('signature/version');
  const len = bytes.readUInt32LE(8);
  if (len < 2 || len > MAX_HEADER || 12 + len >= bytes.length) fail('header length');
  let header;
  try { header = JSON.parse(bytes.toString('utf8', 12, 12 + len)); } catch { fail('header JSON'); }
  const { arrays, total } = validate(header, true);
  let raw;
  try {
    const result = zlib.inflateSync(bytes.subarray(12 + len), { maxOutputLength: total, info: true });
    if (result.engine.bytesWritten !== bytes.length - 12 - len) fail('trailing compressed data');
    raw = result.buffer;
  } catch (error) { fail(`compressed payload (${error.message})`); }
  if (raw.length !== total) fail('payload length');
  let offset = 0;
  for (const a of arrays) {
    const Ctor = TYPES[a.type], size = a.length * Ctor.BYTES_PER_ELEMENT;
    const value = new Ctor(a.length);
    const bytes = Buffer.from(value.buffer);
    raw.copy(bytes, 0, offset, offset + size);
    if (!littleEndian && a.type !== 'u8') a.type === 'u16' ? bytes.swap16() : bytes.swap32();
    a.owner[a.key] = value;
    offset += size;
  }
  validate(header);
  return header;
}
module.exports = { savePaintState, loadPaintState, clonePaintState, validatePaintState: validate };
