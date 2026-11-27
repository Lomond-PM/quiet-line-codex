import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { apply } from '../index.js';

test('project-only drawings retain full-resolution exports and previews', async t => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'quiet-line-project-output-'));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const tools = new Map();
  let attached;
  const attachments = {
    imageLimits: { maxImageBytes: Infinity, maxImageDimension: Infinity },
    saveImage({ data, name, mediaType }) {
      attached = data;
      return {
        name, mediaType, attachmentId: 'preview', bytes: data.length,
        width: data.readUInt32BE(16), height: data.readUInt32BE(20)
      };
    }
  };
  apply({
    tools: { register: tool => tools.set(tool.name, tool) },
    workingDirectory: { ensure: async () => workspace },
    get: service => service === 'attachments' ? attachments : undefined
  });

  const project = 'painting.qlproject';
  const exec = { agent: { id: 'project-output-test' } };
  const draw = tools.get('quiet_line_draw');
  const manage = tools.get('quiet_line_project');
  const initial = await draw.execute({
    project, output: false, brush: 'oil', size: 320,
    strokes: [{ points: [[0.2, 0.3], [0.8, 0.7]], color: '#ab6435' }]
  }, exec);
  assert.equal(initial.projectStep, 1);
  assert.equal(initial.image.attachmentId, 'preview');
  assert.equal(initial.bytes, attached.length);
  assert.ok(!Object.hasOwn(initial, 'path') && !Object.hasOwn(initial, 'absolutePath'));
  const [text, image] = draw.output.render({}, initial);
  assert.doesNotMatch(text.text, /File:|undefined/);
  assert.equal(image.type, 'image');
  assert.deepEqual(await readdir(workspace), [project]);

  const exported = await manage.execute({ project, action: 'export', target: 'exported.png' }, exec);
  assert.deepEqual(await readFile(exported.target), attached);
  const automatic = await draw.execute({ project }, exec);
  assert.match(automatic.path, /^quiet-line-out\/.+\.png$/);
  assert.deepEqual(await readFile(automatic.absolutePath), attached);
  const named = await draw.execute({ project, output: 'named.png' }, exec);
  assert.equal(named.path, 'named.png');
  assert.deepEqual(await readFile(named.absolutePath), attached);
  await assert.rejects(draw.execute({ project, output: 'named.png' }, exec), /already exists/);
  await assert.rejects(draw.execute({ size: 320, output: false }, exec), /requires project/);
  await assert.rejects(draw.execute({ project, output: true }, exec), /output/);
  assert.equal((await manage.execute({ project, action: 'list' }, exec)).head, 3);
});
