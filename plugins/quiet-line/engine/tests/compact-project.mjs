import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { apply } from '../index.js';
import store from '../lib/project-store.cjs';
import mixed from '../lib/mixed-project.cjs';

const temporary = fs.realpathSync(os.tmpdir());
const workspace = fs.mkdtempSync(path.join(temporary, 'quiet-line-compact-'));
const absolute = name => path.join(workspace, name);
const registered = new Map();
apply({ tools: { register(tool) { registered.set(tool.name, tool); } }, workingDirectory: { ensure: async () => workspace }, get() {} });
const execute = (tool, args) => registered.get(tool).execute(args, { agent: { id: 'compact-test' } });
const draw = args => execute('quiet_line_draw', args);
const manage = args => execute('quiet_line_project', args);
const read = (file, step) => store.readProject(workspace, file, { step, includeData: true }).selected;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fileHash = name => hash(fs.readFileSync(absolute(name)));

function query(file, callback, readOnly = true) {
  const db = new DatabaseSync(absolute(file), { readOnly });
  try { return callback(db); } finally { db.close(); }
}

// Build the old schema independently of the current writer. The gaps and
// restored head exercise copying the saved identifiers, not replaying commits.
function writeLegacy(file, version, snapshots, head, nextId) {
  query(file, db => {
    db.exec('PRAGMA journal_mode=DELETE; PRAGMA auto_vacuum=FULL; PRAGMA application_id=1363955794;');
    db.exec('PRAGMA user_version=' + version);
    db.exec('CREATE TABLE project (singleton INTEGER PRIMARY KEY CHECK(singleton=1), mode TEXT NOT NULL, head INTEGER NOT NULL, revision INTEGER NOT NULL, historyLimit INTEGER NOT NULL, maxBytes INTEGER NOT NULL, nextId INTEGER NOT NULL)');
    const perStepMode = version === 1 ? '' : ", mode TEXT NOT NULL DEFAULT 'wet'";
    db.exec('CREATE TABLE steps (id INTEGER PRIMARY KEY, parentId INTEGER, createdAt TEXT NOT NULL, label TEXT, bytes INTEGER NOT NULL, pinned INTEGER NOT NULL, state BLOB NOT NULL, png BLOB NOT NULL, info TEXT NOT NULL' + perStepMode + ')');
    const mode = snapshots.find(s => s.id === head).mode;
    db.prepare('INSERT INTO project VALUES (1,?,?,17,9,67108864,?)').run(mode, head, nextId);
    for (const s of snapshots) {
      const fields = [s.id, s.parentId, new Date(Date.UTC(2026, 0, s.id)).toISOString(), s.label];
      const json = JSON.stringify(s.info);
      fields.push(s.state.length + s.png.length + Buffer.byteLength(json) + Buffer.byteLength(s.label ?? '') + 128,
        Number(s.label !== null), s.state, s.png, json);
      if (version !== 1) fields.push(s.mode);
      db.prepare('INSERT INTO steps VALUES (' + fields.map(() => '?').join(',') + ')').run(...fields);
    }
  }, false);
}

function assertHistory(source, target) {
  const { path: sourcePath, ...before } = store.readProject(workspace, source);
  const { path: targetPath, ...after } = store.readProject(workspace, target);
  assert.notEqual(sourcePath, targetPath);
  assert.deepEqual(after, before);
  for (const { id } of before.steps) assert.deepEqual(read(target, id), read(source, id));
  const nextId = f => query(f, db => db.prepare('SELECT nextId FROM project').get().nextId);
  assert.equal(nextId(target), nextId(source));
  assert.equal(query(target, db => db.prepare('PRAGMA user_version').get().user_version), 4);
}

function assertAllChunksUsed(file) {
  const unused = query(file, db => db.prepare('SELECT count(*) AS n FROM chunks WHERE NOT EXISTS (SELECT 1 FROM parts WHERE parts.hash=chunks.hash)').get().n);
  assert.equal(unused, 0);
}

try {
  const live = 'painting.qlproject';
  await draw({ project: live, size: 320, seed: 476, brush: 'oil', project_checkpoint: 'Wet', output: 'wet.png',
    strokes: [{ points: [[.2,.4],[.7,.52]], color: '#92482d', width: 6 }] });
  await draw({ project: live, output: 'dry.png',
    operations: [{ tool: 'charcoal', points: [[.1,.8],[.77,.65]], width: 4 }] });
  await draw({ project: live, output: 'flat.png', brush: 'ink',
    strokes: [{ points: [[.3,.15],[.85,.3]], color: '#485f8c', width: 2 }] });
  await draw({ project: live, output: 'again.png' });
  const art = [1, 2, 3, 4].map(id => read(live, id));
  const secondLayers = mixed.unpack(art[1].state);
  assert.ok(secondLayers.wet && secondLayers.dry, 'fixture contains both editable materials');
  assert.deepEqual(art[3].state, art[2].state, 'fixture repeats the packed state');

  const legacyWet = { ...art[0], mode: 'wet', state: mixed.unpack(art[0].state).wet, id: 1, parentId: null, label: 'Wet' };
  const legacyDry = { ...art[1], mode: 'dry', state: secondLayers.dry, id: 4, parentId: 1, label: null };
  for (const [version, rows] of [[1, [legacyWet]], [2, [legacyWet, legacyDry]]]) {
    const source = 'v' + version + '.qlproject', target = 'v' + version + '-copy.qlproject';
    writeLegacy(source, version, rows, 1, 11);
    const original = fileHash(source);
    await manage({ project: source, action: 'compact', target });
    assertHistory(source, target);
    assert.equal(fileHash(source), original);
  }

  const source = 'v3.qlproject', target = 'v4.qlproject';
  writeLegacy(source, 3, [
    { ...art[0], id: 1, parentId: null, label: 'Wet' },
    { ...art[1], id: 4, parentId: 1, label: null },
    { ...art[2], id: 5, parentId: 4, label: null },
    { ...art[3], id: 8, parentId: 4, label: '另一版' }
  ], 4, 13);
  const original = fileHash(source);
  assert.throws(() => store.manageProject(workspace, source, {
    action: 'compact', target: 'stale.qlproject', expectedRevision: 16
  }), { code: 'ERR_PROJECT_REVISION' });
  assert.ok(!fs.existsSync(absolute('stale.qlproject')));
  await manage({ project: source, action: 'compact', target });
  assertHistory(source, target);
  assert.ok(fs.statSync(absolute(target)).size < fs.statSync(absolute(source)).size,
    'sharing repeated mixed material reduces the physical SQLite file');
  assertAllChunksUsed(target);
  const targetBefore = fileHash(target);
  await assert.rejects(() => manage({ project: source, action: 'compact', target }));
  assert.equal(fileHash(target), targetBefore);
  assert.equal(fileHash(source), original);

  await manage({ project: target, action: 'restore', step: 1 });
  const branch = 'branch.qlproject';
  await manage({ project: target, action: 'branch', step: 8, target: branch });
  assert.deepEqual(read(branch).state, art[3].state);
  assert.deepEqual(read(branch).png, art[3].png);
  await manage({ project: target, action: 'prune', history_limit: 1 });
  assertAllChunksUsed(target);
  assert.deepEqual(read(target, 8).state, art[3].state);
  await manage({ project: target, action: 'delete_checkpoint', step: 8 });
  await manage({ project: target, action: 'restore', step: 1 });
  const mark = { brush: 'oil', strokes: [{ points: [[.3,.3],[.5,.45]], width: 3, color: '#3e6c54' }] };
  await manage({ project: source, action: 'restore', step: 1 });
  const oldPass = await draw({ project: source, output: 'old-pass.png', ...mark });
  const newPass = await draw({ project: target, output: 'new-pass.png', ...mark });
  assert.equal(newPass.projectStep, 13);
  assert.equal(oldPass.projectStep, newPass.projectStep);
  assert.deepEqual(read(target), read(source), 'same continuation has exact state, PNG and info');
  assert.deepEqual(read(target, 1).state, art[0].state, 'pinned shared component survived pruning');
  assertAllChunksUsed(target);

  const broken = 'broken.qlproject';
  fs.copyFileSync(absolute(branch), absolute(broken));
  query(broken, db => db.exec('UPDATE chunks SET data=zeroblob(length(data)) WHERE hash=(SELECT hash FROM parts LIMIT 1)'), false);
  assert.throws(() => read(broken));
  const brokenBytes = fileHash(broken);
  await assert.rejects(() => manage({ project: broken, action: 'compact', target: 'failed.qlproject' }));
  assert.equal(fileHash(broken), brokenBytes);
  assert.ok(!fs.existsSync(absolute('failed.qlproject')));
  for (const [file, damage] of [
    ['missing-chunk.qlproject', 'DELETE FROM chunks WHERE hash=(SELECT hash FROM parts LIMIT 1)'],
    ['missing-reference.qlproject', 'DELETE FROM parts WHERE slot=0'],
    ['invalid-header.qlproject', 'UPDATE steps SET state=zeroblob(44)']
  ]) {
    fs.copyFileSync(absolute(branch), absolute(file));
    query(file, db => db.exec(damage), false);
    assert.throws(() => store.readProject(workspace, file), { code: 'ERR_PROJECT_INVALID' });
  }
  console.log('Compact project format, history, material continuation and corruption checks passed.');
} finally {
  const verified = fs.realpathSync(workspace);
  assert.equal(path.dirname(verified), temporary);
  assert.ok(path.basename(verified).startsWith('quiet-line-compact-'));
  fs.rmSync(verified, { recursive: true, force: true });
}
