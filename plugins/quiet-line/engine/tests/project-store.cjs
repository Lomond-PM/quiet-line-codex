'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');
const { spawnSync } = require('node:child_process');
const { readProject, commitProject, manageProject } = require('../lib/project-store.cjs');
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'quiet-project-test-'));
const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'quiet-project-outside-'));
const MiB = 1024 * 1024;
// Valid 1x1 PNG. State deliberately synthetic/opaque: renderer validation lives above storage.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
const state = Buffer.from('opaque compressed renderer state');
const info = { brush: 'oil', width: 1, height: 1, nested: { value: [1, true, null] } };
let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`ok ${passed} - ${name}`); }
function commit(file, opts = {}) { return commitProject(cwd, file, { mode: 'wet', state, png, info, expectedRevision: null, ...opts }); }
function mutate(file, opts) { const current = readProject(cwd, file); return manageProject(cwd, file, { expectedRevision: current.revision, ...opts }); }
function sql(file, statement) { const db = new DatabaseSync(path.resolve(cwd, file)); try { db.exec(statement); } finally { db.close(); } }
function badCopy(name, statement) { fs.copyFileSync(path.join(cwd, 'wet.qlproject'), path.join(cwd, name)); sql(name, statement); }
// Construct the exact 1.3/V1 on-disk format, independent of current writer.
function legacy(file, mode = 'wet', savedState = state, opts = {}) {
  const db = new DatabaseSync(path.resolve(cwd, file));
  try {
    db.exec(`PRAGMA journal_mode=DELETE; PRAGMA auto_vacuum=FULL; PRAGMA application_id=1363955794; PRAGMA user_version=1;
      CREATE TABLE project (singleton INTEGER PRIMARY KEY CHECK(singleton=1), mode TEXT NOT NULL, head INTEGER NOT NULL, revision INTEGER NOT NULL, historyLimit INTEGER NOT NULL, maxBytes INTEGER NOT NULL, nextId INTEGER NOT NULL);
      CREATE TABLE steps (id INTEGER PRIMARY KEY, parentId INTEGER, createdAt TEXT NOT NULL, label TEXT, bytes INTEGER NOT NULL, pinned INTEGER NOT NULL, state BLOB NOT NULL, png BLOB NOT NULL, info TEXT NOT NULL);`);
    const label = opts.label || null, json = JSON.stringify(info);
    db.prepare('INSERT INTO project VALUES (1,?,1,1,30,?,2)').run(mode, opts.maxBytes || 2 * 1024 * MiB);
    db.prepare('INSERT INTO steps VALUES (1,NULL,?,?,?,?,?,?,?)').run(new Date().toISOString(), label,
      savedState.length + png.length + Buffer.byteLength(json) + (label ? Buffer.byteLength(label) : 0) + 128,
      label ? 1 : 0, savedState, png, json);
  } finally { db.close(); }
}
function version(file) {
  const db = new DatabaseSync(path.resolve(cwd, file), { readOnly: true });
  try { return db.prepare('PRAGMA user_version').get().user_version; } finally { db.close(); }
}
function noSidecars() {
  assert.deepEqual(fs.readdirSync(cwd).filter(n => /-(?:journal|wal|shm)$/.test(n) || n.startsWith('.qlproject-')), []);
}
try {
  test('wet/dry roundtrip and metadata-only reads', () => {
    for (const mode of ['wet', 'dry']) {
      const m = commit(`${mode}.qlproject`, { mode });
      assert.equal(m.head, 1); assert.equal(m.revision, 1);
      assert.equal(m.historyLimit, 30); assert.equal(m.maxBytes, 2 * 1024 * MiB);
      assert.equal(m.mode, mode); assert.equal(m.steps[0].parentId, null);
      assert.equal(m.steps[0].pinned, false); assert.equal(m.steps[0].label, null);
      assert.equal(m.selected, undefined);
      const selected = readProject(cwd, m.path, { includeData: true }).selected;
      assert(Buffer.isBuffer(selected.state)); assert(Buffer.isBuffer(selected.png));
      assert.deepEqual(selected.state, state); assert.deepEqual(selected.png, png); assert.deepEqual(selected.info, info);
      assert.equal(m.steps[0].bytes, state.length + png.length + Buffer.byteLength(JSON.stringify(info)) + 128);
      const db = new DatabaseSync(m.path, { readOnly: true });
      try { assert.equal(db.prepare('PRAGMA auto_vacuum').get().auto_vacuum, 1); assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'delete'); } finally { db.close(); }
    }
    noSidecars();
  });
  test('wet-dry-wet keeps per-step modes, exact payloads and explicit switch authority', () => {
    let m = commit('mixed.qlproject');
    assert.equal(version('mixed.qlproject'), 2);
    const before = fs.readFileSync(m.path);
    for (const allowModeSwitch of [undefined, false, 1, 'true', {}]) {
      assert.throws(() => commit('mixed.qlproject', { expectedRevision: 1, mode: 'dry', allowModeSwitch }), /allowModeSwitch/);
      assert.deepEqual(fs.readFileSync(m.path), before);
    }
    m = commit('mixed.qlproject', { expectedRevision: m.revision, mode: 'dry', state: Buffer.from('dry'), allowModeSwitch: true });
    assert.equal(m.mode, 'dry');
    m = commit('mixed.qlproject', { expectedRevision: m.revision, mode: 'wet', state: Buffer.from('wet again'), allowModeSwitch: true });
    assert.equal(m.mode, 'wet'); assert.deepEqual(m.steps.map(s => s.mode), ['wet', 'dry', 'wet']);
    for (const [index, bytes] of [state, Buffer.from('dry'), Buffer.from('wet again')].entries()) {
      const result = readProject(cwd, 'mixed.qlproject', { step: index + 1, includeData: true });
      assert.equal(result.mode, 'wet', 'metadata mode belongs to head, not selected');
      assert.equal(result.selected.mode, m.steps[index].mode);
      assert.deepEqual(result.selected.state, bytes); assert.deepEqual(result.selected.png, png);
    }
    const snapshot = fs.readFileSync(m.path);
    assert.throws(() => commit('mixed.qlproject', { expectedRevision: 1, mode: 'dry', allowModeSwitch: true }), { code: 'ERR_PROJECT_REVISION' });
    assert.deepEqual(fs.readFileSync(m.path), snapshot);
    m = mutate('mixed.qlproject', { action: 'restore', step: 2 });
    assert.equal(m.mode, 'dry'); assert.equal(m.head, 2); assert.equal(m.revision, 4);
    assert.deepEqual(m.steps.map(s => s.mode), ['wet', 'dry', 'wet']);
    assert.throws(() => commit('mixed.qlproject', { expectedRevision: m.revision }), /allowModeSwitch/);
    m = commit('mixed.qlproject', { expectedRevision: m.revision, mode: 'dry' });
    assert.equal(m.steps.at(-1).parentId, 2); assert.equal(m.steps.at(-1).mode, 'dry');
    const source = fs.readFileSync(m.path);
    const branch = manageProject(cwd, 'mixed.qlproject', { action: 'branch', step: 1, target: 'mixed-branch.qlproject', expectedRevision: m.revision });
    assert.equal(branch.mode, 'wet'); assert.equal(branch.steps[0].mode, 'wet');
    assert.deepEqual(fs.readFileSync(m.path), source);
    m = mutate('mixed.qlproject', { action: 'restore', step: 3 });
    assert.equal(m.mode, 'wet');
    m = mutate('mixed.qlproject', { action: 'prune', historyLimit: 1 });
    assert.deepEqual(m.steps.map(s => s.id), [3]); assert.equal(m.mode, 'wet');
    noSidecars();
  });
  test('1.3 legacy reads/verify leave bytes unchanged; same-mode writes stay V1', () => {
    for (const mode of ['wet', 'dry']) {
      const file = `legacy-${mode}.qlproject`; legacy(file, mode);
      const original = fs.readFileSync(path.join(cwd, file));
      let m = readProject(cwd, file, { includeData: true });
      assert.equal(m.mode, mode); assert.equal(m.steps[0].mode, mode); assert.equal(m.selected.mode, mode);
      assert.deepEqual(m.selected.state, state);
      manageProject(cwd, file, { action: 'recover' });
      assert.deepEqual(fs.readFileSync(m.path), original);
      assert.throws(() => commit(file, { expectedRevision: 1, mode: mode === 'wet' ? 'dry' : 'wet' }), /allowModeSwitch/);
      assert.deepEqual(fs.readFileSync(m.path), original);
      m = commit(file, { expectedRevision: 1, mode, allowModeSwitch: true });
      assert.equal(version(file), 1); assert.deepEqual(m.steps.map(s => s.mode), [mode, mode]);
      m = mutate(file, { action: 'checkpoint', step: 1, label: 'legacy pin' });
      m = mutate(file, { action: 'restore', step: 1 });
      assert.equal(version(file), 1);
      const beforeBranch = fs.readFileSync(m.path);
      const branch = manageProject(cwd, file, { action: 'branch', step: 2, target: `legacy-${mode}-branch.qlproject`, expectedRevision: m.revision });
      assert.equal(branch.mode, mode); assert.equal(branch.steps[0].mode, mode);
      assert.deepEqual(fs.readFileSync(m.path), beforeBranch);
      const other = mode === 'wet' ? 'dry' : 'wet';
      assert.throws(() => commit(file, { expectedRevision: 1, mode: other, allowModeSwitch: true }), { code: 'ERR_PROJECT_REVISION' });
      assert.equal(version(file), 1); assert.deepEqual(fs.readFileSync(m.path), beforeBranch);
      m = commit(file, { expectedRevision: m.revision, mode: other, allowModeSwitch: true });
      assert.equal(version(file), 2); assert.equal(m.mode, other);
      assert.deepEqual(m.steps.map(s => s.mode), [mode, mode, other]);
      assert.equal(readProject(cwd, file, { step: 1, includeData: true }).selected.mode, mode);
      m = mutate(file, { action: 'restore', step: 1 }); assert.equal(m.mode, mode);
    }
    noSidecars();
  });
  test('failed first switch atomically rolls back V1 migration, head and capacity', () => {
    const file = 'legacy-rollback.qlproject', large = Buffer.alloc(33 * MiB, 11);
    legacy(file, 'dry', large, { label: 'protected', maxBytes: 64 * MiB });
    const before = fs.readFileSync(path.join(cwd, file));
    assert.throws(() => commit(file, { expectedRevision: 1, mode: 'wet', state: large, allowModeSwitch: true }), { code: 'ERR_PROJECT_CAPACITY' });
    assert.equal(version(file), 1); assert.deepEqual(fs.readFileSync(path.join(cwd, file)), before);
    assert.equal(readProject(cwd, file).mode, 'dry');
    noSidecars();
  });
  test('creation exclusive; missing path retains ENOENT', () => {
    const original = fs.readFileSync(path.join(cwd, 'wet.qlproject'));
    assert.throws(() => commit('wet.qlproject'), { code: 'EEXIST' });
    assert.deepEqual(fs.readFileSync(path.join(cwd, 'wet.qlproject')), original);
    assert.throws(() => readProject(cwd, 'absent.qlproject'), { code: 'ENOENT' });
    assert.throws(() => commit('absent.qlproject', { expectedRevision: 1 }), { code: 'ENOENT' });
    noSidecars();
  });
  test('default recent30, named pins retained and oldest unpinned pruned', () => {
    let m = commit('history.qlproject', { label: 'first' });
    for (let i = 0; i < 34; i++) m = commit('history.qlproject', { expectedRevision: m.revision });
    assert.equal(m.steps.length, 31); assert.equal(m.head, 35); assert.equal(m.revision, 35);
    assert.deepEqual(m.steps.map(s => s.id), [1, ...Array.from({ length: 30 }, (_, i) => i + 6)]);
    assert.equal(m.steps[0].label, 'first');
    assert.equal(m.steps.at(-1).parentId, 34);
    m = mutate('history.qlproject', { action: 'prune', historyLimit: 1 });
    assert.deepEqual(m.steps.map(s => s.id), [1, 35]);
    m = mutate('history.qlproject', { action: 'delete_checkpoint', step: 1 });
    assert.deepEqual(m.steps.map(s => s.id), [35]);
    noSidecars();
  });
  test('restore preserves future and commit uses restored parent; monotonic ids', () => {
    let m = commit('rewind.qlproject');
    m = commit('rewind.qlproject', { expectedRevision: m.revision });
    m = commit('rewind.qlproject', { expectedRevision: m.revision });
    m = mutate('rewind.qlproject', { action: 'restore', step: 1 });
    assert.equal(m.head, 1); assert.equal(m.revision, 4); assert.deepEqual(m.steps.map(s => s.id), [1, 2, 3]);
    m = commit('rewind.qlproject', { expectedRevision: m.revision });
    assert.equal(m.head, 4); assert.equal(m.steps[3].parentId, 1);
    m = mutate('rewind.qlproject', { action: 'checkpoint', step: 2, label: 'alternative' });
    assert.equal(m.steps[1].pinned, true); assert.equal(m.steps[1].label, 'alternative');
    const firstBytes = m.steps[1].bytes;
    m = mutate('rewind.qlproject', { action: 'checkpoint', step: 2, label: 'renamed' });
    assert.equal(m.steps[1].bytes, firstBytes - Buffer.byteLength('alternative') + Buffer.byteLength('renamed'));
  });
  test('branch copies exact selected payload and does not mutate source', () => {
    const before = readProject(cwd, 'rewind.qlproject');
    const m = manageProject(cwd, 'rewind.qlproject', { action: 'branch', step: 2, target: 'branch.qlproject', label: 'fork', expectedRevision: before.revision });
    assert.equal(m.head, 1); assert.equal(m.revision, 1); assert.equal(m.steps.length, 1); assert.equal(m.steps[0].parentId, null);
    assert.equal(m.steps[0].label, 'fork');
    assert.deepEqual(readProject(cwd, 'rewind.qlproject'), before);
    assert.deepEqual(readProject(cwd, 'branch.qlproject', { includeData: true }).selected.state, state);
    const clone = path.join(outside, 'external.qlproject'); fs.copyFileSync(path.join(cwd, 'dry.qlproject'), clone);
    assert.equal(manageProject(cwd, clone, { action: 'branch', target: 'external-branch.qlproject', expectedRevision: 1 }).mode, 'dry');
    assert.throws(() => manageProject(cwd, clone, { action: 'checkpoint', label: 'x', expectedRevision: 1 }), { code: 'ERR_PROJECT_PATH' });
  });
  test('stale revisions and invalid mutations preserve original bytes', () => {
    const file = 'rewind.qlproject', before = fs.readFileSync(path.join(cwd, file));
    for (const expectedRevision of [null, undefined, 1, -1, 1.5]) {
      assert.throws(() => commit(file, { expectedRevision }), /already exists|expectedRevision/);
    }
    for (const action of ['checkpoint', 'restore', 'delete_checkpoint', 'prune', 'branch']) {
      assert.throws(() => manageProject(cwd, file, { action, expectedRevision: 1, label: 'x', target: 'stale-branch.qlproject' }), { code: 'ERR_PROJECT_REVISION' });
    }
    const revision = readProject(cwd, file).revision;
    assert.throws(() => commit(file, { expectedRevision: revision, mode: 'dry' }), /mode cannot change/);
    assert.throws(() => manageProject(cwd, file, { action: 'restore', step: 9999, expectedRevision: revision }), { code: 'ERR_PROJECT_STEP' });
    assert.deepEqual(fs.readFileSync(path.join(cwd, file)), before); noSidecars();
  });
  test('pinned limit64 atomic on pin65; rename does not add pin', () => {
    let m = commit('pins.qlproject', { label: 'pin1' });
    for (let i = 2; i <= 64; i++) m = commit('pins.qlproject', { expectedRevision: m.revision, label: `pin${i}` });
    assert.equal(m.steps.length, 64);
    const before = fs.readFileSync(m.path);
    assert.throws(() => commit('pins.qlproject', { expectedRevision: m.revision, label: 'pin65' }), { code: 'ERR_PROJECT_CAPACITY' });
    assert.deepEqual(fs.readFileSync(m.path), before);
    m = mutate('pins.qlproject', { action: 'checkpoint', step: 1, label: 'renamed' });
    assert.equal(m.steps.length, 64); assert.equal(m.steps[0].label, 'renamed');
  });
  test('capacity prunes oldest unpinned and physical deletion reclaims space', () => {
    const large = Buffer.alloc(23 * MiB, 17);
    let m = commit('capacity.qlproject', { state: large, maxBytes: 64 * MiB, label: 'protected' });
    m = commit('capacity.qlproject', { state: large, expectedRevision: m.revision });
    m = commit('capacity.qlproject', { state: large, expectedRevision: m.revision });
    assert.deepEqual(m.steps.map(s => s.id), [1, 3]);
    const before = fs.statSync(m.path).size;
    assert(before <= 64 * MiB + 16 * MiB);
    m = mutate('capacity.qlproject', { action: 'delete_checkpoint', step: 1, historyLimit: 1 });
    assert.deepEqual(m.steps.map(s => s.id), [3]);
    assert(fs.statSync(m.path).size < before - 20 * MiB, 'FULL auto-vacuum must physically shrink');
    noSidecars();
  });
  test('impossible capacity rolls back new head/pin/settings and cleans failed creation', () => {
    const large = Buffer.alloc(33 * MiB, 18);
    const m = commit('impossible.qlproject', { state: large, label: 'protected', maxBytes: 64 * MiB });
    const before = fs.readFileSync(m.path);
    assert.throws(() => commit('impossible.qlproject', { state: large, expectedRevision: m.revision }), { code: 'ERR_PROJECT_CAPACITY' });
    assert.deepEqual(fs.readFileSync(m.path), before);
    assert.throws(() => commit('too-big.qlproject', { state: Buffer.alloc(65 * MiB), maxBytes: 64 * MiB }), { code: 'ERR_PROJECT_CAPACITY' });
    assert(!fs.existsSync(path.join(cwd, 'too-big.qlproject')));
    noSidecars();
  });
  test('lower maxBytes prunes persisted larger project atomically', () => {
    let m = commit('lower.qlproject', { state: Buffer.alloc(23 * MiB), maxBytes: 128 * MiB });
    for (let i = 0; i < 3; i++) m = commit('lower.qlproject', { state: Buffer.alloc(23 * MiB), expectedRevision: m.revision });
    assert(fs.statSync(m.path).size > 80 * MiB);
    m = mutate('lower.qlproject', { action: 'prune', maxBytes: 64 * MiB });
    assert.equal(m.steps.length, 2); assert.equal(m.maxBytes, 64 * MiB);
    assert(fs.statSync(m.path).size <= 80 * MiB);
  });
  test('input bounds and plain JSON reject before creating SQL file', () => {
    for (const opts of [
      { state: Buffer.alloc(0) }, { state: new Uint8Array(2) }, { state: Buffer.alloc(224 * MiB + 1) },
      { png: Buffer.alloc(8) }, { png: Buffer.alloc(32 * MiB + 1) }, { mode: 'other' },
      { info: [] }, { info: new Date() }, { info: { x: undefined } }, { info: { x: Infinity } },
      { info: { x: 'x'.repeat(16385) } }, { info: { get x() { throw new Error('must not execute'); } } },
      { historyLimit: 0 }, { historyLimit: 501 }, { maxBytes: 64 * MiB - 1 }, { maxBytes: 8 * 1024 * MiB + 1 },
      { label: '' }, { label: ' ' }, { label: 'x'.repeat(121) }
    ]) assert.throws(() => commit('invalid-input.qlproject', opts), /Quiet Line project/);
    assert(!fs.existsSync(path.join(cwd, 'invalid-input.qlproject')));
    const cyclic = {}; cyclic.x = cyclic;
    assert.throws(() => commit('invalid-input.qlproject', { info: cyclic }), /plain JSON/);
    noSidecars();
  });
  test('read-only malformed app/version/schema/JSON/types are rejected unchanged', () => {
    const cases = [
      ['wrong-app.qlproject', 'PRAGMA application_id=1'],
      ['wrong-version.qlproject', 'PRAGMA user_version=99'],
      ['wrong-schema.qlproject', 'CREATE TABLE extra (x)'],
      ['trigger.qlproject', 'CREATE TRIGGER malicious AFTER UPDATE ON project BEGIN DELETE FROM steps; END'],
      ['bad-json.qlproject', "UPDATE steps SET info='invalid'"],
      ['bad-meta.qlproject', "UPDATE project SET mode=zeroblob(1000000)"],
      ['bad-step-mode.qlproject', "UPDATE steps SET mode='bad'"],
      ['bad-step-mode-type.qlproject', "UPDATE steps SET mode=zeroblob(1000000)"],
      ['bad-head-mode.qlproject', "UPDATE project SET mode='dry'"],
      ['bad-v1-schema.qlproject', 'PRAGMA user_version=1'],
      ['bad-length.qlproject', "UPDATE steps SET state=zeroblob(234881025)"],
      ['bad-png-length.qlproject', "UPDATE steps SET png=zeroblob(33554433)"],
      ['bad-info-length.qlproject', "UPDATE steps SET info=printf('%20000s','x')"],
      ['bad-type.qlproject', "UPDATE steps SET parentId=zeroblob(1000000)"],
      ['bad-bytes.qlproject', 'UPDATE steps SET bytes=1'],
      ['bad-head.qlproject', 'UPDATE project SET head=999'],
      ['bad-pin.qlproject', 'UPDATE steps SET pinned=1'],
      ['bad-journal.qlproject', 'PRAGMA journal_mode=WAL'],
      ['bad-vacuum.qlproject', 'PRAGMA auto_vacuum=NONE; VACUUM']
    ];
    for (const [name, statement] of cases) {
      badCopy(name, statement);
      const file = path.join(cwd, name), beforeSize = fs.statSync(file).size;
      assert.throws(() => readProject(cwd, name, { includeData: true }), /Quiet Line project|malformed|database/);
      assert.equal(fs.statSync(file).size, beforeSize);
    }
    fs.writeFileSync(path.join(cwd, 'corrupt.qlproject'), Buffer.alloc(4096, 55));
    assert.throws(() => readProject(cwd, 'corrupt.qlproject'), /database/);
    noSidecars();
  });
  test('bad embedded PNG rejected on data read; metadata reads allocate no BLOBs', () => {
    badCopy('bad-png.qlproject', "UPDATE steps SET png=zeroblob(length(png))");
    assert(readProject(cwd, 'bad-png.qlproject').steps.length);
    assert.throws(() => readProject(cwd, 'bad-png.qlproject', { includeData: true }), /PNG signature/);
  });
  test('path extension/traversal, links/junctions and hardlinks protected', () => {
    assert.throws(() => commit('wrong.txt'), /\.qlproject/);
    assert.throws(() => commit('../escape.qlproject'), { code: 'ERR_PROJECT_PATH' });
    assert.throws(() => commit(path.join(outside, 'escape.qlproject')), { code: 'ERR_PROJECT_PATH' });
    const junction = path.join(cwd, 'junction');
    fs.symlinkSync(outside, junction, process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => commit('junction/escape.qlproject'), { code: 'ERR_PROJECT_PATH' });
    assert(!fs.existsSync(path.join(outside, 'escape.qlproject')));
    fs.linkSync(path.join(cwd, 'dry.qlproject'), path.join(cwd, 'hardlink.qlproject'));
    assert.throws(() => commit('hardlink.qlproject', { expectedRevision: 1, mode: 'dry' }), { code: 'ERR_PROJECT_PATH' });
    if (process.platform === 'win32') assert.throws(() => commit('alternate.qlproject:bad.qlproject'), /unsafe/);
    noSidecars();
  });
  test('explicit recovery rolls back a real crashed/spilled transaction; revision unchanged', () => {
    const savedState = Buffer.alloc(2 * MiB, 91);
    const m = commit('recover.qlproject', { state: savedState });
    const before = fs.readFileSync(m.path);
    const child = spawnSync(process.execPath, ['-e', `
      const {DatabaseSync}=require('node:sqlite');
      const db=new DatabaseSync(${JSON.stringify(m.path)});
      db.exec('PRAGMA cache_size=8; PRAGMA cache_spill=ON; PRAGMA synchronous=FULL; BEGIN IMMEDIATE; UPDATE steps SET state=zeroblob(length(state));');
      process.kill(process.pid,'SIGKILL');
    `], { stdio: 'ignore', timeout: 20000 });
    assert.ifError(child.error);
    assert(child.signal || child.status !== 0, 'child must actually crash');
    assert(fs.statSync(m.path + '-journal').size > 512, 'crash must leave a spilled journal');
    assert.throws(() => readProject(cwd, 'recover.qlproject'), { code: 'ERR_PROJECT_BUSY' });
    assert.throws(() => commit('recover.qlproject', { expectedRevision: 1 }), { code: 'ERR_PROJECT_BUSY' });
    const recovered = manageProject(cwd, 'recover.qlproject', { action: 'recover' });
    assert.equal(recovered.revision, 1); assert.equal(recovered.head, 1);
    assert.deepEqual(recovered, m);
    assert.deepEqual(readProject(cwd, 'recover.qlproject', { includeData: true }).selected.state, savedState);
    assert.deepEqual(fs.readFileSync(m.path), before, 'SQLite must restore exact pretransaction DB');
    assert.deepEqual(manageProject(cwd, 'recover.qlproject', { action: 'recover' }), m, 'clean recovery is verify-only');
    assert.throws(() => manageProject(cwd, 'recover.qlproject', { action: 'recover', expectedRevision: 999 }), { code: 'ERR_PROJECT_REVISION' });
    noSidecars();
  });
  test('crashed V1 migration and mixed-mode writes recover exact prior schema/modes', () => {
    for (const isLegacy of [true, false]) {
      const file = isLegacy ? 'recover-migration.qlproject' : 'recover-mixed.qlproject';
      const savedState = Buffer.alloc(2 * MiB, 92);
      let m;
      if (isLegacy) { legacy(file, 'dry', savedState); m = readProject(cwd, file); }
      else {
        m = commit(file, { state: savedState });
        m = commit(file, { expectedRevision: 1, mode: 'dry', state: savedState, allowModeSwitch: true });
      }
      const before = fs.readFileSync(m.path);
      const child = spawnSync(process.execPath, ['-e', `
        const {DatabaseSync}=require('node:sqlite');
        const db=new DatabaseSync(${JSON.stringify(m.path)});
        db.exec("PRAGMA cache_size=8; PRAGMA cache_spill=ON; PRAGMA synchronous=FULL; BEGIN IMMEDIATE;");
        ${isLegacy ? `db.exec("ALTER TABLE steps ADD COLUMN mode TEXT NOT NULL DEFAULT 'dry'; PRAGMA user_version=2;");` : ''}
        db.exec("UPDATE project SET mode='wet',revision=revision+1; UPDATE steps SET mode='wet',state=zeroblob(length(state));");
        process.kill(process.pid,'SIGKILL');
      `], { stdio: 'ignore', timeout: 20000 });
      assert.ifError(child.error); assert(child.signal || child.status !== 0);
      assert(fs.statSync(m.path + '-journal').size > 512);
      assert.throws(() => readProject(cwd, file), { code: 'ERR_PROJECT_BUSY' });
      assert.deepEqual(manageProject(cwd, file, { action: 'recover' }), m);
      assert.deepEqual(fs.readFileSync(m.path), before);
      assert.equal(version(file), isLegacy ? 1 : 2);
      const selected = readProject(cwd, file, { includeData: true }).selected;
      assert.equal(selected.mode, 'dry'); assert.deepEqual(selected.state, savedState);
    }
    noSidecars();
  });
  test('explicit recovery rejects outside files and unsafe journal links without deleting evidence', () => {
    const external = path.join(outside, 'external.qlproject');
    assert.throws(() => manageProject(cwd, external, { action: 'recover' }), { code: 'ERR_PROJECT_PATH' });
    const journal = path.join(cwd, 'wet.qlproject-journal');
    fs.symlinkSync(outside, journal, process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => manageProject(cwd, 'wet.qlproject', { action: 'recover' }), { code: 'ERR_PROJECT_BUSY' });
    assert(fs.lstatSync(journal).isSymbolicLink());
    assert.equal(journal, path.resolve(cwd, 'wet.qlproject-journal')); fs.unlinkSync(journal);
    const hardlinkSource = path.join(outside, 'journal-evidence'); fs.writeFileSync(hardlinkSource, 'evidence');
    fs.linkSync(hardlinkSource, journal);
    assert.throws(() => manageProject(cwd, 'wet.qlproject', { action: 'recover' }), { code: 'ERR_PROJECT_BUSY' });
    assert.equal(fs.readFileSync(hardlinkSource, 'utf8'), 'evidence');
    assert.equal(journal, path.resolve(cwd, 'wet.qlproject-journal')); fs.unlinkSync(journal);
    const wal = path.join(cwd, 'wet.qlproject-wal'); fs.writeFileSync(wal, 'evidence');
    assert.throws(() => manageProject(cwd, 'wet.qlproject', { action: 'recover' }), { code: 'ERR_PROJECT_BUSY' });
    assert.equal(fs.readFileSync(wal, 'utf8'), 'evidence');
    assert.equal(wal, path.resolve(cwd, 'wet.qlproject-wal')); fs.unlinkSync(wal);
    noSidecars();
  });
  test('all public operations leave no SQLite sidecars or temp stores', noSidecars);
  console.log(`PASS ${passed} project-store groups`);
} finally {
  // These are exact owned mkdtemp paths, never caller input.
  assert(path.basename(cwd).startsWith('quiet-project-test-'));
  assert(path.basename(outside).startsWith('quiet-project-outside-'));
  fs.rmSync(cwd, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
}
