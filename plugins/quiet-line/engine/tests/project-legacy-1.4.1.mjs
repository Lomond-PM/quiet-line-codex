import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { apply } from '../index.js';

// Run with a path to a separate, unchanged Quiet Line 1.4.1 engine installation.
const requested = process.argv[2];
assert.ok(requested, 'Pass the absolute path of the original 1.4.1 engine');
const original = await fs.realpath(requested);
const engine = await fs.realpath(fileURLToPath(new URL('..', import.meta.url)));
assert.notEqual(engine, original);
const manifest = JSON.parse(await fs.readFile(path.join(original, 'package.json'), 'utf8'));
assert.equal(manifest.version, '1.4.1');
const { apply: applyLegacy } = await import(pathToFileURL(path.join(original, 'index.js')).href);
const require = createRequire(import.meta.url);
const { loadPaintState } = require('../lib/paint-state.cjs');
const { loadDryState } = require('../lib/dry-state.cjs');
const sharp = require('sharp');
const temporary = await fs.realpath(os.tmpdir());
const workspace = await fs.mkdtemp(path.join(temporary, 'quiet-line-1.4.1-compat-'));

function tools(register) {
  const registered = new Map();
  register({
    tools: { register(tool) { registered.set(tool.name, tool); } },
    workingDirectory: { ensure: async () => workspace },
    get() {}
  });
  const exec = { agent: { id: '1.4.1-compatibility' } };
  return {
    draw: args => registered.get('quiet_line_draw').execute(args, exec),
    manage: args => registered.get('quiet_line_project').execute(args, exec)
  };
}

const old = tools(applyLegacy);
const current = tools(apply);
const inWorkspace = name => path.join(workspace, name);
const read = name => fs.readFile(inWorkspace(name));
const pixels = png => sharp(png).ensureAlpha().raw().toBuffer();
const oil = {
  brush: 'oil', width: 360, height: 320, seed: 313, wetness: 100,
  strokes: [{ points: [[.2,.62],[.8,.62]], width: 7, color: '#29357c' }]
};
const pencil = {
  width: 360, height: 320, seed: 313,
  operations: [{ points: [[.2,.3],[.8,.3]], tool: 'charcoal', width: 6, color: '#151516' }]
};

try {
  await old.draw({ ...oil, project: 'legacy-wet.qlproject', output: 'old-wet.png', project_checkpoint: 'Wet oil in 1.4.1' });
  await old.draw({ ...pencil, project: 'legacy-dry.qlproject', output: 'old-dry.png' });
  await old.draw({ ...oil, save_state: 'legacy.qlpaint', output: 'standalone-wet.png' });
  await old.draw({ ...pencil, save_dry_state: 'legacy.qldry', output: 'standalone-dry.png' });
  const originals = ['legacy-wet.qlproject', 'legacy-dry.qlproject', 'legacy.qlpaint', 'legacy.qldry'];
  const originalBytes = await Promise.all(originals.map(read));

  for (const { mode, extension, png } of [
    { mode: 'wet', extension: 'qlpaint', png: 'standalone-wet.png' },
    { mode: 'dry', extension: 'qldry', png: 'standalone-dry.png' }
  ]) {
    const legacy = 'legacy-' + mode + '.qlproject';
    const working = 'continued-' + mode + '.qlproject';
    const legacyListing = await current.manage({ action: 'list', project: legacy });
    assert.equal(legacyListing.mode, mode);
    const exported = await current.manage({ action: 'export', project: legacy, target: 'legacy-export-' + mode + '.png' });
    assert.ok((await fs.readFile(exported.target)).equals(await read('old-' + mode + '.png')), 'Legacy history PNG must be byte-identical');
    await fs.copyFile(inWorkspace(legacy), inWorkspace(working));
    const continued = await current.draw({
      project: working, brush: 'marker', output: 'continued-' + mode + '.png',
      strokes: [{ points: [[.2,.85],[.8,.85]], color: '#a44339' }]
    });
    assert.equal(continued.projectMode, 'mixed');
    assert.deepEqual([continued.width, continued.height], [360, 320]);
    const after = await current.manage({ action: 'list', project: working });
    assert.deepEqual(after.steps[0], legacyListing.steps[0]);
    const snapshot = await current.manage({ action: 'export', project: working, target: 'continued.' + extension });
    if (mode === 'wet') assert.ok(loadPaintState(workspace, snapshot.target).oil.stamp.some(Number));
    else assert.ok(loadDryState(workspace, snapshot.target).bound.some(Number));

    const snapshotField = mode === 'wet' ? 'paint_state' : 'dry_state';
    const imported = await current.draw({
      project: 'imported-' + mode + '.qlproject', output: 'imported-' + mode + '.png', [snapshotField]: 'legacy.' + extension
    });
    assert.ok((await pixels(await fs.readFile(imported.absolutePath))).equals(await pixels(await read(png))), mode + ' snapshot import should preserve every pixel');
  }

  for (const [index, filename] of originals.entries()) {
    assert.ok((await read(filename)).equals(originalBytes[index]), filename + ' source bytes must remain unchanged');
  }
  console.log('Legacy 1.4.1 project and standalone snapshot fixtures passed.');
} finally {
  const resolved = await fs.realpath(workspace);
  assert.equal(path.dirname(resolved), temporary);
  assert.ok(path.basename(resolved).startsWith('quiet-line-1.4.1-compat-'));
  await fs.rm(resolved, { recursive: true, force: true });
}
