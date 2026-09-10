// Small, dependency-free MCP stdio example. stdout is exclusively JSON-RPC.
// For production servers with more protocol features, use an official MCP SDK.
const tool = {
  name: 'greet',
  description: 'Return a local greeting for a name.',
  inputSchema: { type: 'object', properties: { name: { type: 'string', minLength: 1, maxLength: 100 } }, required: ['name'], additionalProperties: false },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
};
const respond = value => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\n');
const handle = request => {
  if (!request || request.jsonrpc !== '2.0' || typeof request.method !== 'string') return respond({ id: request?.id ?? null, error: { code: -32600, message: 'Invalid request.' } });
  if (request.id === undefined) return; // Initialized/cancellation notifications need no reply.
  const { id, method, params = {} } = request;
  if (method === 'initialize') return respond({ id, result: { protocolVersion: ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25'].includes(params.protocolVersion) ? params.protocolVersion : '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'hello-fecimus-addon', version: '1.0.0' } } });
  if (method === 'ping') return respond({ id, result: {} });
  if (method === 'tools/list') return respond({ id, result: { tools: [tool] } });
  if (method === 'tools/call') {
    const args = params.arguments;
    if (params.name !== 'greet' || !args || typeof args.name !== 'string' || !args.name.length || args.name.length > 100 || Object.keys(args).some(key => key !== 'name')) return respond({ id, result: { isError: true, content: [{ type: 'text', text: 'Expected greet with a name of 1–100 characters.' }] } });
    return respond({ id, result: { content: [{ type: 'text', text: `Hello, ${args.name}! Your private Fecimus addon is working.` }] } });
  }
  return respond({ id, error: { code: -32601, message: 'Method not found.' } });
};
let buffered = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffered += chunk;
  if (Buffer.byteLength(buffered) > 1024 * 1024) { console.error('Input exceeded 1 MiB.'); process.exit(1); }
  let end;
  while ((end = buffered.indexOf('\n')) !== -1) {
    const line = buffered.slice(0, end); buffered = buffered.slice(end + 1);
    if (!line.trim()) continue;
    try { handle(JSON.parse(line)); } catch { respond({ id: null, error: { code: -32700, message: 'Parse error.' } }); }
  }
});
