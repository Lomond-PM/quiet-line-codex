'use strict';
const { createHash } = require('node:crypto');

// QLMIX001 starts with nine little-endian component lengths in a fixed order.
// Preserve its original header. Other renderer formats remain opaque.
const magic = Buffer.from('QLMIX001');
const slots = 9, headerSize = magic.length + slots * 4;
const schema = {
  chunks: 'CREATE TABLE chunks (hash BLOB PRIMARY KEY, data BLOB NOT NULL) WITHOUT ROWID',
  parts: 'CREATE TABLE parts (stepId INTEGER NOT NULL, slot INTEGER NOT NULL, hash BLOB NOT NULL, PRIMARY KEY(stepId,slot)) WITHOUT ROWID'
};
const digest = bytes => createHash('sha256').update(bytes).digest();
const buffer = bytes => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const invalid = reason => { throw Object.assign(new Error('Quiet Line project: ' + reason), { code: 'ERR_PROJECT_INVALID' }); };

function put(db, stepId, mode, state) {
  let header = state.subarray(0, 0);
  if (mode === 'mixed' && state.length >= headerSize && state.subarray(0, magic.length).equals(magic)) {
    let size = headerSize;
    for (let slot = 0; slot < slots; slot++) size += state.readUInt32LE(magic.length + slot * 4);
    if (size === state.length) header = state.subarray(0, headerSize);
  }
  const insert = db.prepare('INSERT INTO chunks(hash,data) VALUES (?,?)');
  const exists = db.prepare('SELECT 1 FROM chunks WHERE hash=?');
  const matches = db.prepare('SELECT data=? AS same FROM chunks WHERE hash=?');
  const link = db.prepare('INSERT INTO parts(stepId,slot,hash) VALUES (?,?,?)');
  let offset = header.length;
  for (let slot = 0; slot < (header.length ? slots : 1); slot++) {
    const length = header.length ? header.readUInt32LE(magic.length + slot * 4) : state.length;
    if (!length) continue;
    const bytes = state.subarray(offset, offset + length), hash = digest(bytes);
    offset += length;
    // SQLite owns the write lock. Confirm equal bytes before reusing a digest.
    if (!exists.get(hash)) insert.run(hash, bytes);
    else if (!matches.get(bytes, hash).same) invalid('component checksum collision or damaged data');
    link.run(stepId, slot, hash);
  }
  return header;
}

// Validate sizes, reference ownership and completeness before reading any
// payload BLOB. The existing project cap also bounds total physical bytes.
function index(db, steps, maxState) {
  const maxParts = steps.length * slots;
  for (const table of ['chunks', 'parts']) {
    if (db.prepare('SELECT count(*) AS n FROM ' + table).get().n > maxParts) invalid('too many stored components');
  }
  if (db.prepare("SELECT 1 FROM chunks WHERE typeof(hash)!='blob' OR length(hash)!=32 OR typeof(data)!='blob' OR length(data)<1 OR length(data)>? LIMIT 1").get(maxState)) invalid('invalid component length or digest');
  if (db.prepare("SELECT 1 FROM parts WHERE typeof(stepId)!='integer' OR typeof(slot)!='integer' OR slot<0 OR slot>=? OR typeof(hash)!='blob' OR length(hash)!=32 LIMIT 1").get(slots)) invalid('invalid component reference');
  // Check header sizes before SELECTing them into memory.
  if (db.prepare("SELECT 1 FROM steps WHERE typeof(state)!='blob' OR length(state) NOT IN (0,?) LIMIT 1").get(headerSize)) invalid('invalid component header length');
  const chunks = new Map(db.prepare('SELECT hash,length(data) AS n FROM chunks').all().map(row =>
    [buffer(row.hash).toString('hex'), { length: row.n, used: false }]));
  const byStep = new Map();
  for (const { id, state } of db.prepare('SELECT id,state FROM steps').all()) {
    byStep.set(id, { header: buffer(state), refs: [], size: state.length });
  }
  for (const { stepId, slot, hash } of db.prepare('SELECT stepId,slot,hash FROM parts ORDER BY stepId,slot').all()) {
    const entry = byStep.get(stepId), chunk = chunks.get(buffer(hash).toString('hex'));
    if (!entry || !chunk) invalid('missing component or step');
    entry.refs.push({ slot, hash, length: chunk.length });
    entry.size += chunk.length;
    chunk.used = true;
  }
  for (const { id, mode } of steps) {
    const { header, refs } = byStep.get(id);
    if (!header.length) {
      if (refs.length !== 1 || refs[0].slot !== 0) invalid('invalid opaque state reference');
      continue;
    }
    if (mode !== 'mixed' || !header.subarray(0, magic.length).equals(magic)) invalid('invalid mixed component header');
    let i = 0;
    for (let slot = 0; slot < slots; slot++) {
      const length = header.readUInt32LE(magic.length + slot * 4);
      if (!length) continue;
      const ref = refs[i++];
      if (!ref || ref.slot !== slot || ref.length !== length) invalid('inconsistent mixed component length');
    }
    if (i !== refs.length) invalid('unexpected mixed component');
  }
  for (const chunk of chunks.values()) if (!chunk.used) invalid('unreferenced stored component');
  return byStep;
}

function read(db, entry) {
  const fetch = db.prepare('SELECT data FROM chunks WHERE hash=?');
  const result = entry.header.length ? Buffer.allocUnsafe(entry.size) : null;
  let offset = entry.header.length;
  if (result) entry.header.copy(result);
  for (const ref of entry.refs) {
    const bytes = buffer(fetch.get(ref.hash).data);
    if (!digest(bytes).equals(ref.hash)) invalid('invalid stored component checksum');
    if (!result) return bytes;
    bytes.copy(result, offset);
    offset += bytes.length;
  }
  return result;
}

function collect(db) {
  db.exec('DELETE FROM parts WHERE stepId NOT IN (SELECT id FROM steps); DELETE FROM chunks WHERE hash NOT IN (SELECT hash FROM parts)');
}

module.exports = { schema, put, index, read, collect, digest };
