'use strict';
// Independent dry-pigment snapshot. A validated JSON descriptor and bounded zlib
// bytes, never an executable deserializer. Worst-case state is 16 bytes/pixel.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const CORE = require('./core.cjs');
const MAGIC = Buffer.from('QLDRY001');
const MAX_BYTES = 52 * 1024 * 1024, MAX_HEADER = 16384;
const TYPES = { u8: Uint8Array, f32: Float32Array };
const littleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
const fail = m => { throw new Error(`Invalid dry state: ${m}`); };
function keys(v, expected, label) {
  if (!v || typeof v !== 'object' || Array.isArray(v) || ArrayBuffer.isView(v) ||
      Object.keys(v).sort().join(',') !== expected.slice().sort().join(',')) fail(`${label} fields`);
}
function number(v, lo, hi, label, integer = false) {
  if (!Number.isFinite(v) || v < lo || v > hi || (integer && !Number.isSafeInteger(v))) fail(label);
}
function validateDryState(s, descriptors = false) {
  keys(s, ['version', 'metadata', 'substrate', 'tooth', 'bound', 'loose', 'pigment'], 'snapshot');
  if (s.version !== 1) fail('version');
  const m = s.metadata;
  keys(m, ['width', 'height', 'surface', 'seed', 'grain', 'itemOffset', 'settings'], 'metadata');
  number(m.width, 1, 1800, 'width', true); number(m.height, 1, 1800, 'height', true);
  number(m.seed, 1, 9999, 'seed', true); number(m.grain, 0, 1, 'grain');
  number(m.itemOffset, 0, Number.MAX_SAFE_INTEGER, 'itemOffset', true);
  if (typeof m.surface !== 'string' || !Object.hasOwn(CORE.SURFACES, m.surface)) fail('surface');
  keys(m.settings, ['weight', 'wobble', 'pressure', 'texture', 'accent', 'brush'], 'settings');
  number(m.settings.weight, 1.5, 4.5, 'weight');
  for (const k of ['wobble', 'pressure', 'texture']) number(m.settings[k], 0, 1, k);
  if (m.settings.brush !== 'pencil' && m.settings.brush !== 'charcoal') fail('brush');
  if (m.settings.accent !== null && (typeof m.settings.accent !== 'string' || !/^#[0-9a-f]{6}$/i.test(m.settings.accent))) fail('accent');
  const n = m.width * m.height, arrays = [], lengths = { substrate: ['u8', n * 4], tooth: ['u8', n], bound: ['f32', n], loose: ['f32', n], pigment: ['u8', n * 3] };
  let total = 0;
  for (const [key, [type, length]] of Object.entries(lengths)) {
    const v = s[key], Ctor = TYPES[type];
    if (descriptors) {
      keys(v, ['type', 'length'], key);
      if (v.type !== type || v.length !== length) fail(`${key} type/length`);
    } else {
      if (!(v instanceof Ctor) || v.constructor !== Ctor || v.length !== length) fail(`${key} type/length`);
      if (type === 'f32') for (const x of v) number(x, 0, 1, key);
    }
    total += length * Ctor.BYTES_PER_ELEMENT;
    if (total > MAX_BYTES) fail('allocation limit');
    arrays.push({ key, type, length });
  }
  if (!descriptors) for (let i = 0; i < n; i++) if (s.bound[i] + s.loose[i] > 1.000001) fail('pigment capacity');
  return { arrays, total };
}
function cloneDryState(s) {
  const { arrays } = validateDryState(s);
  const copy = { ...s, metadata: { ...s.metadata, settings: { ...s.metadata.settings } } };
  for (const a of arrays) copy[a.key] = new TYPES[a.type](s[a.key]);
  return copy;
}
function outputPath(cwd, requested) {
  if (typeof requested !== 'string' || !requested.trim() || path.extname(requested).toLowerCase() !== '.qldry') fail('output requires .qldry path');
  const root = fs.realpathSync(cwd), target = path.resolve(root, requested);
  const inside = p => { const r = path.relative(root, p); return r && r !== '..' && !r.startsWith(`..${path.sep}`) && !path.isAbsolute(r); };
  if (!inside(target)) fail('output must be inside working directory');
  const parent = fs.realpathSync(path.dirname(target));
  if (parent !== root && !inside(parent)) fail('output parent must be inside working directory');
  return path.join(parent, path.basename(target));
}
function saveDryState(cwd, requested, s) {
  const { arrays, total } = validateDryState(s);
  const target = outputPath(cwd, requested);
  const header = { ...s, metadata: { ...s.metadata, settings: { ...s.metadata.settings } } };
  const raw = Buffer.allocUnsafe(total); let offset = 0;
  for (const a of arrays) {
    const v = s[a.key], bytes = Buffer.from(v.buffer, v.byteOffset, v.byteLength);
    bytes.copy(raw, offset);
    if (!littleEndian && a.type === 'f32') raw.subarray(offset, offset + bytes.length).swap32();
    offset += bytes.length;
    header[a.key] = { type: a.type, length: a.length };
  }
  const json = Buffer.from(JSON.stringify(header));
  if (json.length > MAX_HEADER) fail('header limit');
  const prefix = Buffer.alloc(12); MAGIC.copy(prefix); prefix.writeUInt32LE(json.length, 8);
  const compressed = zlib.deflateSync(raw);
  if (compressed.length > MAX_BYTES) fail('compressed size');
  // Do not concatenate another canvas-sized output buffer: state + raw +
  // compressed are bounded below 192 MiB even for incompressible 1800² data.
  const fd = fs.openSync(target, 'wx');
  try { fs.writeFileSync(fd, prefix); fs.writeFileSync(fd, json); fs.writeFileSync(fd, compressed); }
  finally { fs.closeSync(fd); }
  return target;
}
function loadDryState(cwd, requested) {
  if (typeof requested !== 'string' || !requested.trim()) fail('input path');
  const fd = fs.openSync(path.resolve(cwd, requested), 'r'); let bytes;
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size < 14 || stat.size > MAX_BYTES + MAX_HEADER + 12) fail('file size');
    bytes = Buffer.allocUnsafe(stat.size); let offset = 0;
    while (offset < bytes.length) { const n = fs.readSync(fd, bytes, offset, bytes.length - offset, null); if (!n) fail('truncated file'); offset += n; }
    if (fs.readSync(fd, Buffer.alloc(1), 0, 1, null)) fail('file changed');
  } finally { fs.closeSync(fd); }
  if (!bytes.subarray(0, 8).equals(MAGIC)) fail('signature');
  const len = bytes.readUInt32LE(8);
  if (len < 2 || len > MAX_HEADER || 12 + len >= bytes.length) fail('header length');
  let s; try { s = JSON.parse(bytes.toString('utf8', 12, 12 + len)); } catch { fail('header JSON'); }
  const { arrays, total } = validateDryState(s, true);
  let raw;
  try {
    const result = zlib.inflateSync(bytes.subarray(12 + len), { maxOutputLength: total, info: true });
    if (result.engine.bytesWritten !== bytes.length - 12 - len) fail('trailing data');
    raw = result.buffer;
  } catch (e) { fail(`compressed payload (${e.message})`); }
  if (raw.length !== total) fail('payload length');
  let offset = 0;
  for (const a of arrays) {
    const v = new TYPES[a.type](a.length), size = v.byteLength, dest = Buffer.from(v.buffer);
    raw.copy(dest, 0, offset, offset + size);
    if (!littleEndian && a.type === 'f32') dest.swap32();
    s[a.key] = v; offset += size;
  }
  validateDryState(s); return s;
}
module.exports = { saveDryState, loadDryState, cloneDryState, validateDryState, MAX_BYTES };
