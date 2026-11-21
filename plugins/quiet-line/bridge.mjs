import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import Ajv from 'ajv';
import sharp from 'sharp';
import { apply } from './engine/index.js';

const drawName = 'quiet_line_draw';
const workspaceProperty = {
  type: 'string',
  minLength: 1,
  description: 'Absolute local directory for this drawing or project, usually the active Codex workspace. Relative image, output, and project paths resolve here.'
};
const previewProperty = {
  type: 'boolean',
  description: 'Return a small JPEG preview with the tool result. Defaults to true. The full PNG is saved either way.'
};

function engineTools(cwd, attachments) {
  const tools = new Map();
  apply({
    tools: { register: tool => tools.set(tool.name, tool) },
    workingDirectory: { ensure: async () => cwd },
    get: service => service === 'attachments' ? attachments : undefined
  });
  return tools;
}

const ajv = new Ajv({ allErrors: true });
const validators = new Map();

export const toolDefinitions = [...engineTools().values()].map(tool => {
  const properties = { workspace: workspaceProperty, ...tool.parameters.properties };
  if (tool.name === drawName) {
    properties.preview = previewProperty;
    properties.output = {
      ...properties.output,
      description: 'New PNG path relative to workspace. Default quiet-line-out/<title>-<seed>.png. Default filenames gain a numeric suffix if occupied.'
    };
  }

  const inputSchema = {
    ...tool.parameters,
    properties,
    required: ['workspace', ...(tool.parameters.required ?? [])]
  };
  validators.set(tool.name, ajv.compile(inputSchema));
  return { name: tool.name, description: tool.description, inputSchema };
});

export async function runTool(name, args, signal) {
  const validate = validators.get(name);
  if (!validate) throw new Error(`Unknown Quiet Line tool: ${name}`);
  if (!validate(args)) throw new Error(ajv.errorsText(validate.errors, { dataVar: 'arguments' }));
  signal?.throwIfAborted();

  const { workspace, preview = true, ...engineArgs } = args;
  if (!path.isAbsolute(workspace)) throw new Error('workspace must be an absolute local directory');
  const cwd = await realpath(workspace);
  if (!(await stat(cwd)).isDirectory()) throw new Error('workspace must be a directory');

  let png;
  // Adapt the engine's attachment callback to capture this call's own bytes.
  const attachments = {
    imageLimits: { maxImageBytes: Infinity, maxImageDimension: Infinity },
    saveImage({ data, mediaType, name }) {
      if (preview) png = data;
      return {
        attachmentId: 'local-preview',
        mediaType,
        bytes: data.length,
        width: data.readUInt32BE(16),
        height: data.readUInt32BE(20),
        name
      };
    }
  };

  const tool = engineTools(cwd, attachments).get(name);
  const result = await tool.execute(engineArgs, { agent: { id: 'codex-quiet-line' }, signal });
  delete result.image;
  const content = tool.output.render(engineArgs, result);

  if (png) {
    try {
      const jpeg = await sharp(png)
        .resize(768, 768, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 88 })
        .toBuffer();
      content.push({ type: 'image', mimeType: 'image/jpeg', data: jpeg.toString('base64') });
    } catch {
      content.push({ type: 'text', text: `Preview unavailable. The full PNG is saved at ${result.absolutePath}.` });
    }
  }

  return { content, structuredContent: result };
}
