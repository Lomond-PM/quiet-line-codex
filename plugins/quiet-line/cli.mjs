import { readFile } from 'node:fs/promises';
import { runTool, toolDefinitions } from './bridge.mjs';

const [tool, input] = process.argv.slice(2);
try {
  if (tool === '--tools') {
    console.log(JSON.stringify(toolDefinitions, null, 2));
  } else {
    if (!tool || !input) throw new Error('Usage: node cli.mjs <tool> <arguments.json> or node cli.mjs --tools');
    const args = JSON.parse((await readFile(input, 'utf8')).replace(/^\uFEFF/, ''));
    if (tool === 'quiet_line_draw') args.preview = false;
    const result = await runTool(tool, args);
    console.log(JSON.stringify(result.structuredContent, null, 2));
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
