import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const [target, calls] = process.argv.slice(2);
const tools = [
  { name: 'screenshot', description: 'Fixture desktop screenshot', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'click', description: 'Fixture desktop click', inputSchema: { type: 'object', properties: { x: { type: 'integer' }, y: { type: 'integer' } }, required: ['x', 'y'], additionalProperties: false } },
];
createInterface({ input: process.stdin }).on('line', line => {
  const frame = JSON.parse(line);
  if (process.env.OMB_TEST_HOST_VM_RUNTIME !== '1') {
    if (frame.id !== undefined) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: frame.id, error: { code: -32000, message: 'Fixture host VM runtime is unavailable inside the engine' } }) + '\n');
    return;
  }
  let result;
  if (frame.method === 'initialize') result = { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fixture-vm', version: '1' } };
  if (frame.method === 'tools/list') result = { tools };
  if (frame.method === 'tools/call') {
    appendFileSync(calls, JSON.stringify({ target, tool: frame.params.name, arguments: frame.params.arguments }) + '\n');
    result = { content: [
      { type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=' },
      { type: 'text', text: target },
    ] };
  }
  if (frame.id !== undefined) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: frame.id, result: result ?? {} }) + '\n');
});
