import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { runTool, toolDefinitions } from './bridge.mjs';
import manifest from './package.json' with { type: 'json' };

const server = new Server(
  { name: 'quiet-line', version: manifest.version },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: toolDefinitions }));

// The original DSH tools serialize drawing and project operations.
let pending = Promise.resolve();
server.setRequestHandler(CallToolRequestSchema, ({ params }, { signal }) => {
  const call = pending.then(async () => {
    try {
      return await runTool(params.name, params.arguments ?? {}, signal);
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: error.message }] };
    }
  });
  pending = call;
  return call;
});

await server.connect(new StdioServerTransport());
