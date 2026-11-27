'use strict';

// Node >=24, built-in SQLite only. Payloads are already-compressed renderer
// snapshots: this layer deliberately treats them as opaque bytes. Capacity is
// logical bytes (state + PNG + UTF-8 info/label + 128 bytes per step); SQLite
// page/index/schema overhead is permitted up to 16 MiB above maxBytes.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const components = require('./project-components.cjs');
const MiB = 1024 * 1024;
const APP_ID = 0x514c5052;
const COMPACT_VERSION = 4;
const MIXED_VERSION = 3;
const PER_STEP_VERSION = 2;
const LEGACY_VERSION = 1;
const MAX_STATE = 320 * MiB + 16 * 1024 + 12;
const MAX_MIXED_STATE = 576 * MiB;
const MAX_PNG = 32 * MiB, MAX_INFO = 16384;
const MIN_CAPACITY = 64 * MiB, MAX_CAPACITY = 8 * 1024 * MiB;
const OVERHEAD = 16 * MiB;
const PNG_MAGIC = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const SCHEMA = {
  project: 'CREATE TABLE project (singleton INTEGER PRIMARY KEY CHECK(singleton=1), mode TEXT NOT NULL, head INTEGER NOT NULL, revision INTEGER NOT NULL, historyLimit INTEGER NOT NULL, maxBytes INTEGER NOT NULL, nextId INTEGER NOT NULL)',
  steps: 'CREATE TABLE steps (id INTEGER PRIMARY KEY, parentId INTEGER, createdAt TEXT NOT NULL, label TEXT, bytes INTEGER NOT NULL, pinned INTEGER NOT NULL, state BLOB NOT NULL, png BLOB NOT NULL, info TEXT NOT NULL)'
};
// ALTER ADD COLUMN keeps existing opaque BLOBs in place. The finite default is
// the legacy project's single mode; it gives every old step its true mode
// without rewriting/copying up to 8 GiB of snapshots during migration.
const STEP_SCHEMAS = Object.fromEntries(['wet', 'dry'].map(mode => [mode,
  SCHEMA.steps.slice(0, -1) + `, mode TEXT NOT NULL DEFAULT '${mode}')`
]));
function supportedVersion(version) {
  return [LEGACY_VERSION, PER_STEP_VERSION, MIXED_VERSION, COMPACT_VERSION].includes(version);
}
function stateByteLimit(mode) { return mode === 'mixed' ? MAX_MIXED_STATE : MAX_STATE; }
function fail(message, code = 'ERR_PROJECT_INVALID') {
  const error = new Error(`Quiet Line project: ${message}`); error.code = code; throw error;
}
function integer(value, min, max, name) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(`invalid ${name}`);
  return value;
}
function labelValue(label, optional = false) {
  if (optional && (label === undefined || label === null)) return null;
  if (typeof label !== 'string' || label.length < 1 || label.length > 120 || !label.trim() || label.includes('\0')) fail('label must be 1..120 characters');
  return label;
}
function settings(historyLimit, maxBytes, prior) {
  return {
    historyLimit: integer(historyLimit === undefined ? (prior?.historyLimit ?? 30) : historyLimit, 1, 500, 'historyLimit (1..500)'),
    maxBytes: integer(maxBytes === undefined ? (prior?.maxBytes ?? 2 * 1024 * MiB) : maxBytes, MIN_CAPACITY, MAX_CAPACITY, 'maxBytes (64 MiB..8 GiB)')
  };
}
function jsonInfo(info) {
  // Reject getters, custom prototypes/toJSON, undefined, cycles and exotic JSON
  // conversions instead of invoking caller code while holding a transaction.
  const seen = new Set(); let nodes = 0;
  function visit(v, depth) {
    if (++nodes > 16384 || depth > 32) fail('info JSON complexity limit');
    if (typeof v === 'string' && v.length > MAX_INFO) fail('info exceeds 16 KiB');
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return;
    if (typeof v === 'number' && Number.isFinite(v)) return;
    if (typeof v !== 'object' || seen.has(v)) fail('info must be bounded plain JSON');
    if (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) fail('info must be plain JSON');
    seen.add(v);
    if (Reflect.ownKeys(v).some(k => typeof k !== 'string')) fail('info JSON symbol key');
    for (const [key, d] of Object.entries(Object.getOwnPropertyDescriptors(v))) {
      if (Array.isArray(v) && key === 'length') continue;
      if (key.length > MAX_INFO) fail('info exceeds 16 KiB');
      if (Array.isArray(v) && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= v.length)) fail('info JSON custom array property');
      if (!d.enumerable || !Object.hasOwn(d, 'value')) fail('info JSON accessor or hidden property');
      visit(d.value, depth + 1);
    }
    if (Array.isArray(v) && Object.keys(v).length !== v.length) fail('info JSON sparse/custom array');
    seen.delete(v);
  }
  if (!info || Array.isArray(info) || typeof info !== 'object') fail('info must be a plain JSON object');
  visit(info, 0);
  const json = JSON.stringify(info);
  if (Buffer.byteLength(json) > MAX_INFO) fail('info exceeds 16 KiB');
  return json;
}
function payload(options) {
  if (!['wet', 'dry', 'mixed'].includes(options.mode)) fail('mode must be wet, dry or mixed');
  const maxState = stateByteLimit(options.mode);
  if (!Buffer.isBuffer(options.state) || !options.state.length || options.state.length > maxState) fail(`state must be a nonempty Buffer up to ${maxState} bytes`);
  if (!Buffer.isBuffer(options.png) || options.png.length < 8 || options.png.length > MAX_PNG || !options.png.subarray(0, 8).equals(PNG_MAGIC)) fail('png must be a PNG Buffer <=32 MiB');
  return { mode: options.mode, state: options.state, png: options.png, info: jsonInfo(options.info), label: labelValue(options.label, true) };
}
function inside(root, file) {
  const relative = path.relative(root, file);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
function resolvePath(cwd, requested, write) {
  if (typeof requested !== 'string' || !requested || requested.includes('\0') || path.extname(requested).toLowerCase() !== '.qlproject') fail('path must end in .qlproject');
  // Reject NTFS streams and Windows namespace aliases as well as normal escapes.
  const absolute = path.resolve(cwd, requested);
  if (process.platform === 'win32' && (absolute.slice(2).includes(':') || absolute.startsWith('\\\\?\\') || absolute.startsWith('\\\\.\\'))) fail('unsafe project path');
  if (!write) return absolute;
  const root = path.resolve(cwd);
  if (!inside(root, absolute)) fail('writes must be inside the working directory', 'ERR_PROJECT_PATH');
  const realRoot = fs.realpathSync(root);
  const relative = path.relative(root, absolute);
  let cursor = root;
  for (const part of relative.split(path.sep)) {
    cursor = path.join(cursor, part);
    let stat;
    try { stat = fs.lstatSync(cursor); } catch (error) {
      if (error.code === 'ENOENT' && cursor === absolute) break;
      throw error;
    }
    if (stat.isSymbolicLink()) fail('symlink/junction project paths are not writable', 'ERR_PROJECT_PATH');
    const real = fs.realpathSync(cursor);
    if (!inside(realRoot, real)) fail('project path escapes working directory', 'ERR_PROJECT_PATH');
    if (cursor !== absolute && !stat.isDirectory()) fail('project parent is not a directory', 'ERR_PROJECT_PATH');
  }
  return absolute;
}
function preflight(file, write, recovery = false) {
  const stat = fs.statSync(file); // Preserve identifiable ENOENT.
  if (!stat.isFile() || stat.size < 100 || stat.size > MAX_CAPACITY + OVERHEAD) fail('invalid project file size');
  if (write && stat.nlink !== 1) fail('hard-linked project is not writable', 'ERR_PROJECT_PATH');
  const header = Buffer.alloc(100), fd = fs.openSync(file, 'r');
  try { if (fs.readSync(fd, header, 0, 100, 0) !== 100) fail('truncated database header'); } finally { fs.closeSync(fd); }
  if (!header.subarray(0, 16).equals(Buffer.from('SQLite format 3\0'))) fail('invalid database header');
  // SQLite can create -wal/-shm even for a readOnly connection to a WAL file.
  // Reject the on-disk WAL flag before opening the database at all.
  if (header[18] !== 1 || header[19] !== 1) fail('unsupported database journal format');
  if (header.readUInt32BE(68) !== APP_ID || !supportedVersion(header.readUInt32BE(60))) fail('wrong application id or version');
  // Never recover or change a caller's journal/WAL database behind their back.
  for (const suffix of ['-wal', '-shm', '-journal']) {
    // lstat, not existsSync: even a dangling journal symlink must be rejected.
    let sidecar;
    try { sidecar = fs.lstatSync(file + suffix); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (sidecar && !(recovery && suffix === '-journal' && sidecar.isFile() && !sidecar.isSymbolicLink() && sidecar.nlink === 1)) fail('project has active/recovery SQLite sidecars; close/recover it first (recovery accepts only a regular, unlinked DELETE journal)', 'ERR_PROJECT_BUSY');
  }
}
function open(file, write, recovery = false) {
  preflight(file, write, recovery);
  let db;
  try {
    db = new DatabaseSync(file, { readOnly: !write, enableDoubleQuotedStringLiterals: false, allowExtension: false });
    db.exec('PRAGMA trusted_schema=OFF; PRAGMA busy_timeout=5000;');
    if (!write) db.exec('PRAGMA query_only=ON;');
    return db;
  } catch (error) { if (db) db.close(); throw error; }
}
function scalar(db, pragma) { return Object.values(db.prepare(`PRAGMA ${pragma}`).get())[0]; }
function validate(db, file, changed = false) {
  const version = scalar(db, 'user_version');
  if (scalar(db, 'application_id') !== APP_ID || !supportedVersion(version)) fail('wrong application id or version');
  if (scalar(db, 'journal_mode') !== 'delete' || scalar(db, 'auto_vacuum') !== 1) fail('unsupported journal/auto_vacuum configuration');
  const schemaBounds = db.prepare('SELECT count(*) AS n,max(length(CAST(sql AS BLOB))) AS longest FROM sqlite_schema').get();
  const compact = version === COMPACT_VERSION;
  if (schemaBounds.n !== (compact ? 4 : 2) || schemaBounds.longest > 1024) fail('unsupported/oversized schema');
  const perStep = version >= PER_STEP_VERSION;
  const allowedModes = version >= MIXED_VERSION ? "'wet','dry','mixed'" : "'wet','dry'";
  const schema = db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY name').all();
  const tables = compact ? { ...SCHEMA, ...components.schema } : SCHEMA;
  if (schema.some(r => r.type !== 'table' || r.tbl_name !== r.name || !Object.hasOwn(tables, r.name) ||
    (perStep && r.name === 'steps' ? !Object.values(STEP_SCHEMAS).includes(r.sql) : tables[r.name] !== r.sql))) fail('unsupported schema (tables, indexes, views, triggers must match)');
  const unsafeMeta = db.prepare(`SELECT count(*) AS n FROM project WHERE typeof(mode)!='text' OR length(CAST(mode AS BLOB))>5 OR mode NOT IN (${allowedModes}) OR typeof(singleton)!='integer' OR typeof(head)!='integer' OR typeof(revision)!='integer' OR typeof(historyLimit)!='integer' OR typeof(maxBytes)!='integer' OR typeof(nextId)!='integer'`).get().n;
  if (unsafeMeta) fail('invalid project metadata types/lengths');
  const rows = db.prepare('SELECT * FROM project LIMIT 2').all();
  if (rows.length !== 1 || rows[0].singleton !== 1) fail('invalid project metadata');
  const m = rows[0];
  integer(m.head, 1, Number.MAX_SAFE_INTEGER - 1, 'head');
  integer(m.revision, 1, Number.MAX_SAFE_INTEGER - 1, 'revision');
  integer(m.nextId, 2, Number.MAX_SAFE_INTEGER - 1, 'nextId');
  settings(m.historyLimit, m.maxBytes);
  // FULL auto-vacuum releases freelist pages at COMMIT, not at DELETE. Within
  // a mutation use the conservative post-commit page estimate.
  const pages = scalar(db, 'page_count') - (changed ? scalar(db, 'freelist_count') : 0);
  if ((!changed && fs.statSync(file).size > m.maxBytes + OVERHEAD) || pages * scalar(db, 'page_size') > m.maxBytes + OVERHEAD) fail('project exceeds physical size limit');
  // Query lengths/types first. Never SELECT a BLOB (or arbitrarily large JSON)
  // until every row passes limits. The row count is bounded before allocation.
  const count = db.prepare('SELECT count(*) AS n FROM steps').get().n;
  if (count < 1 || count > 564) fail('invalid history count');
  const unsafeSteps = db.prepare("SELECT count(*) AS n FROM steps WHERE (parentId IS NOT NULL AND typeof(parentId)!='integer') OR typeof(bytes)!='integer' OR typeof(pinned)!='integer' OR typeof(createdAt)!='text' OR (label IS NOT NULL AND typeof(label)!='text')").get().n;
  if (unsafeSteps) fail('invalid step metadata types');
  // Check mode types and lengths in SQL before selecting any untrusted value.
  if (perStep && db.prepare(`SELECT count(*) AS n FROM steps WHERE typeof(mode)!='text' OR length(CAST(mode AS BLOB))>5 OR mode NOT IN (${allowedModes})`).get().n) fail('invalid step mode');
  const lengths = db.prepare(`SELECT id, typeof(state) AS st, length(state) AS sl, typeof(png) AS pt, length(png) AS pl, typeof(info) AS it, length(CAST(info AS BLOB)) AS il, length(CAST(label AS BLOB)) AS ll, length(CAST(createdAt AS BLOB)) AS cl${perStep ? ',mode' : ''} FROM steps ORDER BY id`).all();
  const componentIndex = compact ? components.index(db, lengths, MAX_MIXED_STATE) : undefined;
  for (const r of lengths) {
    if (compact) r.sl = componentIndex.get(r.id).size;
    if (r.st !== 'blob' || !Number.isSafeInteger(r.sl) || r.sl < 1 || r.sl > stateByteLimit(r.mode ?? m.mode) || r.pt !== 'blob' || !Number.isSafeInteger(r.pl) || r.pl < 8 || r.pl > MAX_PNG || r.it !== 'text' || r.il < 2 || r.il > MAX_INFO || (r.ll !== null && r.ll > 480) || r.cl !== 24) fail('invalid/oversized stored BLOB or metadata length');
  }
  const steps = db.prepare(`SELECT id,parentId,createdAt,label,bytes,pinned,info${perStep ? ',mode' : ''} FROM steps ORDER BY id`).all();
  if (!perStep) for (const step of steps) step.mode = m.mode;
  let total = 0, pins = 0, automatic = 0;
  for (let i = 0; i < steps.length; i++) {
    const r = steps[i], l = lengths[i];
    integer(r.id, 1, m.nextId - 1, 'step id');
    if (r.parentId !== null) integer(r.parentId, 1, r.id - 1, 'parentId');
    if (typeof r.createdAt !== 'string' || !Number.isFinite(Date.parse(r.createdAt)) || new Date(r.createdAt).toISOString() !== r.createdAt) fail('invalid creation time');
    if (r.pinned !== 0 && r.pinned !== 1) fail('invalid pinned flag');
    labelValue(r.label, true);
    if (Boolean(r.pinned) !== (r.label !== null)) fail('invalid checkpoint label');
    let info;
    try { info = JSON.parse(r.info); } catch { fail('invalid info JSON'); }
    jsonInfo(info);
    const bytes = l.sl + l.pl + l.il + (l.ll || 0) + 128;
    if (r.bytes !== bytes) fail('incorrect stored byte count');
    total += bytes;
    if (r.pinned) pins++; else automatic++;
  }
  const head = steps.find(r => r.id === m.head);
  if (!head || head.mode !== m.mode || pins > 64 || automatic > m.historyLimit || total > m.maxBytes) fail('invalid history/capacity or head mode');
  return { ...m, version, componentIndex, steps: steps.map(({ info, ...r }) => ({ ...r, pinned: Boolean(r.pinned) })) };
}
function metadata(file, m) {
  return { path: file, mode: m.mode, head: m.head, revision: m.revision, historyLimit: m.historyLimit, maxBytes: m.maxBytes, steps: m.steps };
}
function selected(db, m, id) {
  id = id === undefined ? m.head : integer(id, 1, Number.MAX_SAFE_INTEGER - 1, 'step');
  if (!m.steps.some(s => s.id === id)) fail(`step ${id} not found`, 'ERR_PROJECT_STEP');
  const row = db.prepare('SELECT id,state,png,info FROM steps WHERE id=?').get(id);
  const png = Buffer.from(row.png.buffer, row.png.byteOffset, row.png.byteLength);
  if (!png.subarray(0, 8).equals(PNG_MAGIC)) fail('invalid stored PNG signature');
  // SQLite returns owned byte arrays. Wrap them without copying potentially
  // hundreds of MiB into a second allocation.
  const state = m.componentIndex ? components.read(db, m.componentIndex.get(id)) :
    Buffer.from(row.state.buffer, row.state.byteOffset, row.state.byteLength);
  return { id: row.id, mode: m.steps.find(s => s.id === id).mode, state, png, info: JSON.parse(row.info) };
}
function readProject(cwd, requested, { step, includeData = false } = {}) {
  const file = resolvePath(cwd, requested, false); let db;
  try {
    db = open(file, false); db.exec('BEGIN;');
    const m = validate(db, file), result = metadata(file, m);
    const id = step === undefined ? m.head : integer(step, 1, Number.MAX_SAFE_INTEGER - 1, 'step');
    if (!m.steps.some(s => s.id === id)) fail(`step ${id} not found`, 'ERR_PROJECT_STEP');
    if (includeData) result.selected = selected(db, m, id);
    db.exec('COMMIT;'); return result;
  } finally { if (db) db.close(); }
}
function cas(m, expectedRevision) {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== m.revision) fail(`stale or missing expectedRevision (expected ${m.revision}, received ${expectedRevision})`, 'ERR_PROJECT_REVISION');
}
function prune(db, head, limits) {
  const rows = db.prepare('SELECT id,bytes,pinned FROM steps ORDER BY id').all();
  const pins = rows.filter(s => s.pinned).length;
  if (pins > 64) fail('at most 64 pinned checkpoints', 'ERR_PROJECT_CAPACITY');
  let automatic = rows.length - pins, bytes = rows.reduce((n, s) => n + s.bytes, 0);
  const remove = db.prepare('DELETE FROM steps WHERE id=?');
  let removed = false;
  for (const row of rows) {
    if (automatic <= limits.historyLimit && bytes <= limits.maxBytes) break;
    if (row.pinned || row.id === head) continue;
    remove.run(row.id); removed = true; automatic--; bytes -= row.bytes;
  }
  if (automatic > limits.historyLimit || bytes > limits.maxBytes) fail('capacity cannot fit head and pinned checkpoints; unpin checkpoints or increase maxBytes', 'ERR_PROJECT_CAPACITY');
  if (removed && scalar(db, 'user_version') === COMPACT_VERSION) components.collect(db);
}
function addStep(db, id, parentId, p, createdAt = new Date().toISOString()) {
  const bytes = p.state.length + p.png.length + Buffer.byteLength(p.info) + (p.label ? Buffer.byteLength(p.label) : 0) + 128;
  const version = scalar(db, 'user_version'), perStep = version >= PER_STEP_VERSION;
  const state = version === COMPACT_VERSION ? components.put(db, id, p.mode, p.state) : p.state;
  db.prepare(`INSERT INTO steps (id,parentId,createdAt,label,bytes,pinned,state,png,info${perStep ? ',mode' : ''}) VALUES (?,?,?,?,?,?,?,?,?${perStep ? ',?' : ''})`)
    .run(id, parentId, createdAt, p.label, bytes, p.label ? 1 : 0, state, p.png, p.info, ...(perStep ? [p.mode] : []));
}
function physical(db, maxBytes) {
  if ((scalar(db, 'page_count') - scalar(db, 'freelist_count')) * scalar(db, 'page_size') > maxBytes + OVERHEAD) fail('SQLite physical overhead exceeds 16 MiB allowance', 'ERR_PROJECT_CAPACITY');
}
function rollback(db) { try { db.exec('ROLLBACK;'); } catch { /* Already rolled back/committed. */ } }
function mutate(file, expectedRevision, fn) {
  let db;
  try {
    db = open(file, true); db.exec('BEGIN IMMEDIATE;');
    const m = validate(db, file); cas(m, expectedRevision);
    fn(db, m);
    physical(db, db.prepare('SELECT maxBytes FROM project').get().maxBytes);
    // Validate and construct the result before committing: failures remain atomic.
    const result = metadata(file, validate(db, file, true));
    db.exec('COMMIT;'); return result;
  } catch (error) { if (db) rollback(db); throw error; }
  finally { if (db) db.close(); }
}
function createDatabase(cwd, requested, version, populate) {
  const file = resolvePath(cwd, requested, true);
  if (fs.existsSync(file)) fail('project already exists; expectedRevision:null is creation-only', 'EEXIST');
  const temporary = path.join(path.dirname(file), `.qlproject-${crypto.randomUUID()}.qlproject`);
  let db, ownsTemporary = false;
  try {
    const fd = fs.openSync(temporary, 'wx', 0o600); ownsTemporary = true; fs.closeSync(fd);
    db = new DatabaseSync(temporary, { enableDoubleQuotedStringLiterals: false, allowExtension: false });
    db.exec(`PRAGMA trusted_schema=OFF; PRAGMA journal_mode=DELETE; PRAGMA auto_vacuum=FULL; PRAGMA application_id=${APP_ID}; PRAGMA user_version=${version};`);
    db.exec(`${SCHEMA.project}; ${STEP_SCHEMAS.wet}; BEGIN IMMEDIATE;`);
    if (version === COMPACT_VERSION) db.exec(Object.values(components.schema).join(';'));
    const verify = populate(db);
    const m = validate(db, temporary);
    if (verify) verify(db, m);
    const result = metadata(file, m);
    db.exec('COMMIT;'); db.close(); db = undefined;
    const syncFd = fs.openSync(temporary, 'r+'); try { fs.fsyncSync(syncFd); } finally { fs.closeSync(syncFd); }
    // Recheck the path after work, and publish without replacing any existing
    // destination. A hard link is the portable exclusive atomic publish primitive.
    resolvePath(cwd, requested, true);
    fs.linkSync(temporary, file);
    return result;
  } catch (error) { if (db) rollback(db); throw error; }
  finally {
    if (db) db.close();
    if (ownsTemporary) for (const suffix of ['', '-journal', '-wal', '-shm']) {
      try { fs.unlinkSync(temporary + suffix); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    }
  }
}
function create(cwd, requested, p, limits, version = p.mode === 'mixed' ? COMPACT_VERSION : PER_STEP_VERSION) {
  return createDatabase(cwd, requested, version, db => {
    addStep(db, 1, null, p);
    db.prepare('INSERT INTO project VALUES (1,?,?,?,?,?,?)').run(p.mode, 1, 1, limits.historyLimit, limits.maxBytes, 2);
    prune(db, 1, limits); physical(db, limits.maxBytes);
  });
}
function compactCopy(cwd, requested, target, expectedRevision) {
  const sourceFile = resolvePath(cwd, requested, false);
  let source;
  try {
    source = open(sourceFile, false);
    source.exec('BEGIN;');
    const original = validate(source, sourceFile);
    cas(original, expectedRevision);
    return createDatabase(cwd, target, COMPACT_VERSION, db => {
      // Copy one step at a time, including raw info JSON and timestamps. Keep
      // only digests and bounded metadata for verification before publication.
      const expected = new Map();
      const rawInfo = source.prepare('SELECT info FROM steps WHERE id=?');
      for (const step of original.steps) {
        const p = selected(source, original, step.id);
        const info = rawInfo.get(step.id).info;
        addStep(db, step.id, step.parentId, { ...p, info, label: step.label }, step.createdAt);
        expected.set(step.id, { state: components.digest(p.state), png: components.digest(p.png), info });
      }
      const { mode, head, revision, historyLimit, maxBytes, nextId } = original;
      db.prepare('INSERT INTO project VALUES (1,?,?,?,?,?,?)').run(mode, head, revision, historyLimit, maxBytes, nextId);
      physical(db, maxBytes);
      return (destination, copy) => {
        if (copy.nextId !== nextId || JSON.stringify(metadata('', copy)) !== JSON.stringify(metadata('', original))) fail('compact copy history verification failed');
        const copiedInfo = destination.prepare('SELECT info FROM steps WHERE id=?');
        for (const [id, before] of expected) {
          const after = selected(destination, copy, id);
          if (!components.digest(after.state).equals(before.state) || !components.digest(after.png).equals(before.png) || copiedInfo.get(id).info !== before.info) fail('compact copy payload verification failed');
        }
      };
    });
  } finally { if (source) source.close(); }
}
function commitProject(cwd, requested, options) {
  const p = payload(options);
  if (options.expectedRevision === null) return create(cwd, requested, p, settings(options.historyLimit, options.maxBytes));
  const file = resolvePath(cwd, requested, true);
  return mutate(file, options.expectedRevision, (db, m) => {
    if (p.mode !== m.mode && options.allowModeSwitch !== true) fail('project mode cannot change without allowModeSwitch:true');
    // The first mode switch adds the per-step mode to a v1 database. The first
    // mixed payload needs v3 but uses the same tables as v2. Both upgrades are
    // inside the save transaction so a failed commit leaves the original intact.
    if (p.mode !== m.mode && m.version === LEGACY_VERSION) {
      db.exec(`ALTER TABLE steps ADD COLUMN mode TEXT NOT NULL DEFAULT '${m.mode}';`);
    }
    if (p.mode === 'mixed' && m.version < MIXED_VERSION) {
      db.exec(`PRAGMA user_version=${MIXED_VERSION};`);
    } else if (p.mode !== m.mode && m.version === LEGACY_VERSION) {
      db.exec(`PRAGMA user_version=${PER_STEP_VERSION};`);
    }
    const limits = settings(options.historyLimit, options.maxBytes, m);
    if (m.nextId >= Number.MAX_SAFE_INTEGER - 1 || m.revision >= Number.MAX_SAFE_INTEGER - 2) fail('revision/step id exhausted');
    addStep(db, m.nextId, m.head, p);
    prune(db, m.nextId, limits);
    db.prepare('UPDATE project SET mode=?,head=?,revision=?,historyLimit=?,maxBytes=?,nextId=? WHERE singleton=1')
      .run(p.mode, m.nextId, m.revision + 1, limits.historyLimit, limits.maxBytes, m.nextId + 1);
  });
}
function manageProject(cwd, requested, options) {
  const { action, step, label, target, expectedRevision } = options;
  if (action === 'compact') return compactCopy(cwd, requested, target, expectedRevision);
  if (action === 'recover') {
    // Explicitly authorized SQLite hot-journal rollback, not a history mutation.
    // The rollback happens on opening/reading, necessarily before any optional
    // revision check. Never remove a journal manually or recover outside cwd.
    const file = resolvePath(cwd, requested, true); let db, result;
    try {
      db = open(file, true, true); db.exec('BEGIN IMMEDIATE;');
      const m = validate(db, file);
      if (expectedRevision !== undefined) cas(m, expectedRevision);
      if (scalar(db, 'quick_check(1)') !== 'ok') fail('corrupt SQLite database');
      result = metadata(file, m);
      db.exec('COMMIT;');
    } catch (error) { if (db) rollback(db); throw error; }
    finally { if (db) db.close(); }
    // Cold/unrecognized journals may be left alone by SQLite. Report those,
    // rather than deleting evidence or pretending the project is now writable.
    preflight(file, true);
    return result;
  }
  if (action === 'branch') {
    // Source is a read-only snapshot (may be outside cwd). Validate its CAS in
    // the same read transaction as the selected payload.
    const file = resolvePath(cwd, requested, false); let db;
    try {
      db = open(file, false); db.exec('BEGIN;');
      const m = validate(db, file); cas(m, expectedRevision);
      const s = selected(db, m, step);
      const p = payload({ mode: s.mode, state: s.state, png: s.png, info: s.info, label });
      const result = create(cwd, target, p, settings(options.historyLimit, options.maxBytes, m), COMPACT_VERSION);
      db.exec('COMMIT;'); return result;
    } finally { if (db) db.close(); }
  }
  if (!['checkpoint', 'restore', 'delete_checkpoint', 'prune'].includes(action)) fail('unknown project action');
  const file = resolvePath(cwd, requested, true);
  return mutate(file, expectedRevision, (db, m) => {
    const limits = settings(options.historyLimit, options.maxBytes, m);
    const id = step === undefined ? m.head : integer(step, 1, Number.MAX_SAFE_INTEGER - 1, 'step');
    if (!m.steps.some(s => s.id === id)) fail(`step ${id} not found`, 'ERR_PROJECT_STEP');
    let head = m.head;
    if (action === 'checkpoint') {
      const name = labelValue(label);
      const old = m.steps.find(s => s.id === id);
      const bytes = old.bytes - (old.label ? Buffer.byteLength(old.label) : 0) + Buffer.byteLength(name);
      db.prepare('UPDATE steps SET label=?,pinned=1,bytes=? WHERE id=?').run(name, bytes, id);
    } else if (action === 'delete_checkpoint') {
      const old = m.steps.find(s => s.id === id);
      db.prepare('UPDATE steps SET label=NULL,pinned=0,bytes=? WHERE id=?').run(old.bytes - (old.label ? Buffer.byteLength(old.label) : 0), id);
    } else if (action === 'restore') head = id;
    prune(db, head, limits);
    if (m.revision >= Number.MAX_SAFE_INTEGER - 2) fail('revision exhausted');
    db.prepare('UPDATE project SET mode=?,head=?,revision=?,historyLimit=?,maxBytes=? WHERE singleton=1')
      .run(m.steps.find(s => s.id === head).mode, head, m.revision + 1, limits.historyLimit, limits.maxBytes);
  });
}
module.exports = { readProject, commitProject, manageProject };
