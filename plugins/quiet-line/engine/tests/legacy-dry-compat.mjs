// Explicit, opt-in compatibility test. Reads the installed plugin, never installs.
// Writes artwork/projects only to a new OS temporary directory. Keeps it for audit.
// Run: node tests/legacy-dry-compat.mjs [absolute-installed-plugin-directory]
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { apply as candidateApply } from '../index.js';
const require = createRequire(import.meta.url);
const STATE = require('../lib/paint-state.cjs');
const STORE = require('../lib/project-store.cjs');
const OIL = require('../lib/oil.cjs');
const CORE = require('../lib/core.cjs');
const RASTER = require('../lib/raster.cjs');
const sharp = require('sharp');
const rgbaPixels = png => sharp(png).ensureAlpha().raw().toBuffer();
const installed = path.resolve(process.argv[2] || path.join(os.homedir(), '.dsh/profiles/desktop/node_modules/@dsh-local/quiet-line-board'));
const candidate = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
assert.notEqual(installed, candidate, 'must test distinct installed and candidate implementations');
const oldRequire = createRequire(path.join(installed, 'index.js'));
assert.equal(oldRequire('./package.json').version, '1.4.0', 'requires the actual installed 1.4.0');
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const sourceFiles = ['package.json', 'index.js', ...['core', 'oil', 'raster', 'paint-state', 'project-store', 'project-tool'].map(n => `lib/${n}.cjs`)];
const installedHashes = Object.fromEntries(sourceFiles.map(f => [f, hash(fs.readFileSync(path.join(installed, f)))]));
const candidateHashes = Object.fromEntries(sourceFiles.map(f => [f, hash(fs.readFileSync(path.join(candidate, f)))]));
const { apply: oldApply } = await import(pathToFileURL(path.join(installed, 'index.js')).href);
const oldState = oldRequire('./lib/paint-state.cjs');
const oldStore = oldRequire('./lib/project-store.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quiet-line-real-legacy-'));
console.log('ISOLATED_ARTIFACT_DIRECTORY', root);
function harness(apply, cwd) {
  const tools = new Map();
  apply({ tools: { register: t => tools.set(t.name, t) }, workingDirectory: { ensure: async () => cwd }, get() {} });
  const exec = { agent: { id: 'legacy-compat-isolated' } };
  return { draw: args => tools.get('quiet_line_draw').execute(args, exec), manage: args => tools.get('quiet_line_project').execute(args, exec) };
}
const old = harness(oldApply, root), next = harness(candidateApply, root);
const report = { installed, installedVersion: '1.4.0', candidateVersion: require('../package.json').version, root, cases: [] };
const read = (project, step) => STORE.readProject(root, project, { includeData: true, ...(step === undefined ? {} : { step }) });
const sql = (project, fn) => { const db = new DatabaseSync(path.join(root, project), { readOnly: true }); try { return fn(db); } finally { db.close(); } };
const version = project => sql(project, db => db.prepare('PRAGMA user_version').get().user_version);
const row = (project, id) => sql(project, db => db.prepare('SELECT id,parentId,createdAt,label,bytes,pinned,state,png,info FROM steps WHERE id=?').get(id));
function render(snapshot) {
  return RASTER.renderPNG({ brush: snapshot.metadata.brush, primitives: [] }, { paintState: snapshot }).png;
}
function unchangedExceptStamps(before, after) {
  const b = STATE.clonePaintState(before), a = STATE.clonePaintState(after);
  assert.ok(a.oil.stamp.every(s => s === 0));
  a.oil.stamp = b.oil.stamp;
  assert.deepEqual(a, b, 'all metadata, colour, coverage, height, ink, caches and paper unchanged');
}
function meanCenter(snapshot) {
  const { oil: s } = snapshot; const rgb = [0, 0, 0]; let n = 0;
  for (let y = Math.floor(s.height * .498); y < s.height * .502; y++) {
    for (let x = Math.floor(s.width * .40); x < s.width * .60; x++) {
      const i = y * s.width + x; if (!s.cov[i]) continue;
      for (let k = 0; k < 3; k++) rgb[k] += s.col[i * 3 + k]; n++;
    }
  }
  assert.ok(n > 100, 'real painted ROI exists');
  return rgb.map(v => v / n);
}
// Exact 1.3/V1 SQLite schema, seeded with actual 1.4.0-rendered state, not a
// claim that an unavailable 1.3 engine generated the artwork.
function v1Fixture(source, target) {
  const m = read(source), r = row(source, m.head);
  const db = new DatabaseSync(path.join(root, target));
  try {
    db.exec(`PRAGMA journal_mode=DELETE; PRAGMA auto_vacuum=FULL; PRAGMA application_id=1363955794; PRAGMA user_version=1;
      CREATE TABLE project (singleton INTEGER PRIMARY KEY CHECK(singleton=1), mode TEXT NOT NULL, head INTEGER NOT NULL, revision INTEGER NOT NULL, historyLimit INTEGER NOT NULL, maxBytes INTEGER NOT NULL, nextId INTEGER NOT NULL);
      CREATE TABLE steps (id INTEGER PRIMARY KEY, parentId INTEGER, createdAt TEXT NOT NULL, label TEXT, bytes INTEGER NOT NULL, pinned INTEGER NOT NULL, state BLOB NOT NULL, png BLOB NOT NULL, info TEXT NOT NULL);`);
    db.prepare('INSERT INTO project VALUES (1,?,?,?,?,?,?)').run('wet', r.id, m.revision, m.historyLimit, m.maxBytes, r.id + 1);
    db.prepare('INSERT INTO steps VALUES (?,?,?,?,?,?,?,?,?)').run(...['id', 'parentId', 'createdAt', 'label', 'bytes', 'pinned', 'state', 'png', 'info'].map(k => r[k]));
  } finally { db.close(); }
}
for (const brush of ['oil', 'oilknife']) {
  const original = `${brush}-old.qlproject`, snapshotFile = `${brush}-old.qlpaint`, working = `${brush}-candidate.qlproject`;
  const oldDrawing = await old.draw({ project: original, project_checkpoint: 'original wet paint', brush, size: 320, seed: 719, grain: 15,
    weight: 4.5, wobble: 0, pressure: 0, wetness: 100, impasto: 80, load: 100,
    strokes: [{ points: [[.2, .5], [.8, .5]], width: 8, color: '#1748a6', overshoot: 0 }], output: `${brush}-old.png` });
  await old.manage({ project: original, action: 'export', target: snapshotFile });
  const originalProjectHash = hash(fs.readFileSync(path.join(root, original)));
  const originalSnapshotBytes = fs.readFileSync(path.join(root, snapshotFile));
  const originalSnapshotHash = hash(originalSnapshotBytes);
  const legacySnapshot = oldState.loadPaintState(root, snapshotFile);
  assert.deepEqual(STATE.loadPaintState(root, snapshotFile), legacySnapshot, 'new loader reads actual old snapshot exactly');
  const oldStored = oldStore.readProject(root, original, { includeData: true });
  assert.deepEqual(oldStored.selected.state, originalSnapshotBytes);
  const oldPNG = fs.readFileSync(oldDrawing.absolutePath);
  const oldPixels = await rgbaPixels(oldPNG);
  assert.deepEqual(await rgbaPixels(render(legacySnapshot)), oldPixels, 'candidate zero-stroke renderer reproduces every legacy pixel');
  const noOp = await next.draw({ paint_state: snapshotFile, save_state: `${brush}-noop.qlpaint`, output: `${brush}-noop.png` });
  assert.deepEqual(await rgbaPixels(noOp.absolutePath), oldPixels);
  assert.deepEqual(STATE.loadPaintState(root, `${brush}-noop.qlpaint`), legacySnapshot, 'public no-op continuation preserves old state');
  fs.copyFileSync(path.join(root, original), path.join(root, working), fs.constants.COPYFILE_EXCL);
  const before = read(working), beforeRow = row(working, before.head);
  const driedMeta = await next.manage({ project: working, action: 'dry_paint' });
  assert.equal(driedMeta.mode, 'wet'); assert.equal(driedMeta.revision, before.revision + 1);
  assert.equal(driedMeta.head, before.head + 1); assert.equal(version(working), 2);
  assert.equal(driedMeta.steps.find(s => s.id === driedMeta.head).parentId, before.head);
  assert.deepEqual(row(working, before.head), beforeRow, 'old step metadata and both blobs unchanged');
  const dried = read(working);
  assert.deepEqual(dried.selected.png, oldPNG);
  const dryFile = `${brush}-dried.qlpaint`;
  await next.manage({ project: working, action: 'export', target: dryFile });
  const drySnapshot = STATE.loadPaintState(root, dryFile);
  unchangedExceptStamps(legacySnapshot, drySnapshot);
  assert.deepEqual(await rgbaPixels(render(drySnapshot)), oldPixels, 'dried state reproduces every legacy pixel including impasto');
  const over = { points: [[.25, .5], [.75, .5]], width: 3, color: '#ffffff', opacity: 1,
    controls: [{}, {}], tip: 'round', hardness: 1, cap: 'round', overshoot: 0 };
  // Candidate public continuation of both the untouched old wet snapshot and
  // the dried snapshot establishes an actual behaviour change, not metadata only.
  const wetContinue = await next.draw({ paint_state: snapshotFile, strokes: [over], wetness: 100, load: 100, save_state: `${brush}-wet-over.qlpaint`, output: `${brush}-wet-over.png` });
  const dryContinue = await next.draw({ project: working, strokes: [over], wetness: 100, load: 100, output: `${brush}-dry-over.png` });
  await next.manage({ project: working, action: 'export', target: `${brush}-dry-over.qlpaint` });
  const wetRGB = meanCenter(STATE.loadPaintState(root, `${brush}-wet-over.qlpaint`));
  const dryRGB = meanCenter(STATE.loadPaintState(root, `${brush}-dry-over.qlpaint`));
  // Old parsers accept the unchanged file format, but old engines do not know
  // zero means permanently dry. Record an actual downgrade continuation too.
  assert.deepEqual(oldState.loadPaintState(root, dryFile), drySnapshot);
  await old.draw({ paint_state: dryFile, strokes: [over], wetness: 100, load: 100,
    save_state: `${brush}-downgraded-over.qlpaint`, output: `${brush}-downgraded-over.png` });
  const downgradeRGB = meanCenter(STATE.loadPaintState(root, `${brush}-downgraded-over.qlpaint`));
  assert.ok(dryRGB[0] > wetRGB[0] + 10, `${brush}: dried pigment is not picked up (${wetRGB} versus ${dryRGB})`);
  assert.notDeepEqual(await rgbaPixels(wetContinue.absolutePath), await rgbaPixels(dryContinue.absolutePath));
  // Start from actual old material and its new permanent-dry markers. Use the
  // engine directly for 1000 tiny off-subject strokes to avoid 1000 disk renders.
  const aged = STATE.clonePaintState(drySnapshot), settings = aged.metadata.settings;
  const filler = CORE.buildItems([{ type: 'stroke', points: [[.04, .04], [.05, .04]], width: .1, color: '#aa3322', controls: [{}, {}] }],
    { ...settings, brush, seed: aged.metadata.seed, pressure: 0, wobble: 0, padding: 0 }, 320).primitives[0];
  for (let i = 0; i < 1000; i++) OIL.paintOilStroke(aged.ink, aged.oil.width, aged.oil.height, aged.metadata.ss, filler,
    { knife: brush === 'oilknife', wetness: 0, impasto: .8, load: 1, seed: aged.metadata.seed }, aged.oil);
  const center = Math.floor(aged.oil.height * .5) * aged.oil.width + Math.floor(aged.oil.width * .5);
  assert.equal(aged.oil.stamp[center], 0); assert.equal(aged.oil.hgt[center], drySnapshot.oil.hgt[center]);
  assert.deepEqual(aged.oil.col.slice(center * 3, center * 3 + 3), drySnapshot.oil.col.slice(center * 3, center * 3 + 3));
  STATE.savePaintState(root, `${brush}-1000.qlpaint`, aged);
  // Compare the aged and unaged snapshots through the same standalone
  // continuation. Mixed-project compositing has its own material import path.
  await next.draw({ paint_state: dryFile, strokes: [over], wetness: 100, load: 100, save_state: `${brush}-unaged-over.qlpaint`, output: `${brush}-unaged-over.png` });
  const unagedRGB = meanCenter(STATE.loadPaintState(root, `${brush}-unaged-over.qlpaint`));
  await next.draw({ paint_state: `${brush}-1000.qlpaint`, strokes: [over], wetness: 100, load: 100, save_state: `${brush}-1000-over.qlpaint`, output: `${brush}-1000-over.png` });
  const agedRGB = meanCenter(STATE.loadPaintState(root, `${brush}-1000-over.qlpaint`));
  assert.deepEqual(agedRGB, unagedRGB, '1000 off-subject strokes and save/reload do not revive old dry pigment');
  // Restore is reversible because the original wet step was checkpointed.
  await next.manage({ project: working, action: 'restore', step: before.head });
  assert.deepEqual(read(working).selected.state, before.selected.state);
  const restoredDry = await next.manage({ project: working, action: 'dry_paint' });
  await next.manage({ project: working, action: 'branch', target: `${brush}-branch.qlproject` });
  assert.deepEqual(read(`${brush}-branch.qlproject`).selected.state, read(working).selected.state);
  assert.throws(() => STORE.commitProject(root, working, { mode: 'wet', state: before.selected.state, png: before.selected.png,
    info: before.selected.info, expectedRevision: before.revision }), /stale|revision/i);
  assert.equal(read(working).revision, restoredDry.revision, 'stale CAS never writes');
  // Both concurrent dry operations read the same head before temporary work.
  const raceBefore = read(working).revision;
  const race = await Promise.allSettled([next.manage({ project: working, action: 'dry_paint' }), next.manage({ project: working, action: 'dry_paint' })]);
  assert.equal(race.filter(r => r.status === 'fulfilled').length, 1);
  assert.match(race.find(r => r.status === 'rejected').reason.message, /revision|stale|conflict/i);
  assert.equal(read(working).revision, raceBefore + 1);
  const v1 = `${brush}-v1.qlproject`;
  v1Fixture(original, v1);
  const v1Before = read(v1), v1Row = row(v1, v1Before.head);
  assert.equal(version(v1), 1);
  const v1Dry = await next.manage({ project: v1, action: 'dry_paint' });
  assert.equal(version(v1), 1, 'same-mode drying must not upgrade V1');
  assert.equal(v1Dry.revision, v1Before.revision + 1);
  assert.equal(sql(v1, db => db.prepare('PRAGMA table_info(steps)').all().some(c => c.name === 'mode')), false);
  assert.throws(() => STORE.commitProject(root, v1, { mode: 'wet', state: v1Before.selected.state, png: v1Before.selected.png,
    info: v1Before.selected.info, expectedRevision: v1Before.revision }), /stale|revision/i);
  assert.equal(read(v1).revision, v1Dry.revision, 'V1 stale CAS never writes');
  assert.deepEqual(row(v1, v1Before.head), v1Row, 'V1 old step is byte-for-byte unchanged');
  assert.deepEqual(read(v1).selected.png, oldPNG);
  await next.draw({ project: v1, strokes: [over], wetness: 100, load: 100, output: `${brush}-v1-over.png` });
  assert.equal(version(v1), 3, 'the first mixed drawing step upgrades a V1 project to V3');
  assert.equal(read(v1).selected.mode, 'mixed');
  await next.manage({ project: v1, action: 'export', target: `${brush}-v1-over.qlpaint` });
  assert.deepEqual(meanCenter(STATE.loadPaintState(root, `${brush}-v1-over.qlpaint`)), dryRGB);
  assert.deepEqual(row(v1, v1Before.head), v1Row, 'V1 old step also unchanged after subsequent painting');
  assert.equal(hash(fs.readFileSync(path.join(root, original))), originalProjectHash, 'source old project never touched');
  assert.equal(hash(fs.readFileSync(path.join(root, snapshotFile))), originalSnapshotHash, 'source old snapshot never touched');
  report.cases.push({ brush, originalProjectHash, originalSnapshotHash, storedPNGBytesPreserved: true, renderedPixelsPreserved: true, exactMaterialPreservedExceptStamps: true,
    wetRGB, dryRGB, downgradeRGB, after1000RGB: agedRGB, v1SameModePreserved: true, oldStepsIntact: true, staleAndConcurrentCAS: true });
}
for (const [file, digest] of Object.entries(installedHashes)) assert.equal(hash(fs.readFileSync(path.join(installed, file))), digest, `installed source unchanged: ${file}`);
assert.equal(fs.readdirSync(root).some(n => n.startsWith('.quiet-line-project-')), false, 'all temporary bridges cleaned');
report.installedSourcesUnchanged = true;
for (const [file, digest] of Object.entries(candidateHashes)) assert.equal(hash(fs.readFileSync(path.join(candidate, file))), digest, `candidate changed during compatibility run: ${file}`);
report.candidateSourceHashes = candidateHashes;
fs.writeFileSync(path.join(root, 'compatibility-report.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
console.log(JSON.stringify(report, null, 2));
console.log('legacy-dry-compat: PASS (real installed 1.4.0; synthetic exact 1.3/V1 container seeded with real old material)');
