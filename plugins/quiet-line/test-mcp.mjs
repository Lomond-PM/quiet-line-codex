import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import sharp from 'sharp';
import guidance from './engine/lib/art-guidance.cjs';

test('Quiet Line over MCP', async t => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'quiet-line-mcp-'));
  const client = new Client({ name: 'quiet-line-test', version: '1.0.0' });
  t.after(async () => {
    await client.close();
    await rm(workspace, { recursive: true, force: true });
  });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL('./server.mjs', import.meta.url))]
  }));

  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(tool => tool.name), ['quiet_line_draw', 'quiet_line_project']);
  assert.ok(tools.every(tool => tool.inputSchema.required.includes('workspace')));
  assert.ok(tools[0].description.endsWith(guidance.ART_GUIDANCE));
  assert.match(tools[0].description, /Choose stroke scale and density according to artistic intent\./);

  const invoke = (name, args) => client.callTool({ name, arguments: { workspace, ...args } });
  const draw = args => invoke('quiet_line_draw', args);
  const manage = args => invoke('quiet_line_project', { project, ...args });
  const success = result => {
    assert.notEqual(result.isError, true, JSON.stringify(result.content));
    return result.structuredContent;
  };

  const project = 'test.qlproject';
  const stroke = { points: [[0.12, 0.45], [0.8, 0.52]], width: 2.1, color: '#aa562d' };
  const initial = await draw({
    project, project_checkpoint: 'wet start', brush: 'oil', size: 320,
    strokes: [stroke], output: 'wet.png'
  });
  const wet = success(initial);
  assert.equal(wet.projectStep, 1);
  const original = await readFile(wet.absolutePath);
  const preview = initial.content.find(block => block.type === 'image');
  assert.equal(preview?.mimeType, 'image/jpeg');
  assert.equal((await sharp(Buffer.from(preview.data, 'base64')).metadata()).width, 320);
  assert.equal((await sharp(original).metadata()).format, 'png');

  const dried = success(await manage({ action: 'dry_paint' }));
  assert.equal(dried.head, 2);
  const exported = success(await manage({ action: 'export', target: 'dried.png' }));
  assert.deepEqual(await readFile(exported.target), original);

  const next = await draw({
    project, output: 'dry.png', preview: false,
    operations: [
      { tool: 'charcoal', points: [[0.2, 0.18], [0.74, 0.23]], width: 2 },
      { tool: 'kneaded', points: [[0.42, 0.18], [0.48, 0.23]], width: 0.5 }
    ]
  });
  assert.equal(success(next).projectMode, 'mixed');
  assert.ok(next.content.every(block => block.type === 'text'));
  assert.equal(success(await manage({ action: 'list' })).steps.length, 3);
  assert.equal(success(await manage({ action: 'restore', step: 1 })).head, 1);
  const wide = success(await draw({
    project: 'wide.qlproject', width: 2560, height: 320, output: 'wide.png', preview: false
  }));
  assert.deepEqual([wide.width, wide.height, wide.marks], [2560, 320, 0]);

  const collision = await draw({ subject: 'cup', size: 320, output: 'wet.png' });
  assert.equal(collision.isError, true);
  assert.match(collision.content[0].text, /already exists/);
  assert.deepEqual(await readFile(wet.absolutePath), original);
  assert.equal((await draw({ subject: 'cup', size: 320, output: '../escape.png' })).isError, true);
  assert.equal((await draw({ subject: 'cup', size: '320' })).isError, true);
});
