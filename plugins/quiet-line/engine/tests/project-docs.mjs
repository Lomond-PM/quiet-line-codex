import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apply } from '../index.js';

// Execute the published JSON workflows, including real legacy-state imports.
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'quiet-line-project-docs-'));
const tools = new Map();
apply({ tools: { register(t) { tools.set(t.name, t); } }, workingDirectory: { ensure: async () => cwd }, get() {} });
const exec = { agent: { id: 'project-docs' } };
const draw = args => tools.get('quiet_line_draw').execute(args, exec);
const manage = args => tools.get('quiet_line_project').execute(args, exec);
try {
  await draw({ brush: 'oil', size: 320, seed: 241, strokes: [], save_state: 'old-study.qlpaint', output: 'old-oil.png' });
  await draw({ dry_media: true, size: 320, seed: 241, operations: [], save_dry_state: 'old-study.qldry', output: 'old-dry.png' });
  const wet = fs.readFileSync(path.join(cwd, 'old-study.qlpaint'));
  const dry = fs.readFileSync(path.join(cwd, 'old-study.qldry'));
  const markdown = fs.readFileSync(path.join(repository, 'PROJECTS.md'), 'utf8');
  const blocks = [...markdown.matchAll(/```json\s*\r?\n([\s\S]*?)```/g)];
  assert.ok(blocks.length >= 10, 'Expected complete project workflows');
  for (const [, text] of blocks) {
    const args = JSON.parse(text);
    const result = await (args.action ? manage(args) : draw(args));
    assert.ok(args.action ? result.head >= 1 : result.projectStep >= 1);
  }
  assert.deepEqual(fs.readFileSync(path.join(cwd, 'old-study.qlpaint')), wet);
  assert.deepEqual(fs.readFileSync(path.join(cwd, 'old-study.qldry')), dry);
  assert.ok(!fs.readdirSync(cwd).some(name => name.startsWith('.quiet-line-project-')));
  for (const entry of fs.readdirSync(repository).filter(name => name.endsWith('.md'))) {
    const text = fs.readFileSync(path.join(repository, entry), 'utf8');
    for (const [, target] of text.matchAll(/\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
      if (/^(?:https?:|#)/.test(target)) continue;
      assert.ok(fs.existsSync(path.resolve(repository, decodeURI(target.split('#')[0]))), `${entry}: broken local link ${target}`);
    }
  }
  console.log(`project docs: PASS — ${blocks.length} real JSON workflows, immutable imported states and local Markdown links`);
} finally {
  // cwd is an exact, privately created fixture directory, never a user argument.
  assert.equal(path.dirname(cwd), os.tmpdir());
  assert.ok(path.basename(cwd).startsWith('quiet-line-project-docs-'));
  fs.rmSync(cwd, { recursive: true, force: true });
}
