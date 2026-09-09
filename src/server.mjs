import fs from 'node:fs';
import { dataDir, defaultBackends, loadSettings } from './config.mjs';
import { assertSupportedPlatform } from './platform.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Gateway, inputValidator, toolError } from './gateway-core.mjs';
import { startRuntime } from './runtime.mjs';
import { extraTools, callExtraTool } from './browser-tools.mjs';
import { inlineBrowserSnapshot } from './browser-output.mjs';
import { compactTool } from './catalog.mjs';

const base = fileURLToPath(new URL('.', import.meta.url));
const read = filename => JSON.parse(fs.readFileSync(filename, 'utf8'));
const settings = loadSettings();
const config = process.env.FECIMUS_BACKENDS ? read(process.env.FECIMUS_BACKENDS) : defaultBackends();

let gateway, runtime, closing = false, connected = false, changeTimer;
const server = new Server({ name: 'fecimus', version: '2.0.0' }, {
  capabilities: { tools: { listChanged: true } },
  instructions: 'Fecimus provides a private AI desktop with its own cursor and keyboard, plus a headless browser. The human can work simultaneously without AI mouse/keyboard interference. Browser tools inspect background tabs through browser APIs; screen visibility is irrelevant. Prefer browser tools for websites and scrape tasks; use fecimus browser helpers when available to reduce round trips. Native desktop tools see only Fecimus\'s isolated desktop, not the human\'s desktop. Launch native apps inside Fecimus before interacting. Observe, act, verify. Return actual errors honestly and use short valid JSON. Never automatically retry a dispatched action after a timeout or error; check actual state first. This isolation is a workspace convenience, not a filesystem/security sandbox.'
});
async function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  clearTimeout(changeTimer);
  await gateway?.close().catch(() => {});
  await runtime?.close().catch(() => {});
  await server.close().catch(() => {});
  process.exit(code);
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => shutdown());
process.stdin.on('end', () => shutdown());
server.onclose = () => shutdown();
server.onerror = error => console.error('[fecimus]', error.message);
function toolsChanged() {
  if (!connected || closing) return;
  clearTimeout(changeTimer);
  changeTimer = setTimeout(() => server.notification({ method: 'notifications/tools/list_changed' }).catch(() => {}), 100);
}
try {
  if (process.env.FECIMUS_SKIP_RUNTIME !== '1') await assertSupportedPlatform();
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  runtime = process.env.FECIMUS_SKIP_RUNTIME === '1'
    ? { env: process.env, status: () => ({ mode: 'test', healthy: true }), close: async () => {} }
    : await startRuntime(base, settings);
  if (closing) { await runtime.close(); process.exit(0); }
  const extraValidators = new Map(extraTools.map(tool => [tool.name, inputValidator(tool.inputSchema)]));
  gateway = new Gateway(config, { settings, childWrapper: path.join(base, 'runtime-child.py'), runtimeEnv: runtime.env, runtimeStatus: runtime.status,
    cachePath: process.env.FECIMUS_TOOL_CACHE || path.join(dataDir, 'tool-catalog.json'),
    transformResult: (name, result) => inlineBrowserSnapshot(name, result, path.join(dataDir, 'browser-output'), settings.snapshot_max_chars),
    reservedNames: extraTools.map(tool => tool.name), onToolsChanged: toolsChanged });
  await gateway.start();
  if (closing) { await gateway.close(); await runtime.close(); process.exit(0); }
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [
    ...gateway.listTools(), ...extraTools.map(compactTool),
    { name: 'fecimus_status', description: 'Check desktop health, connections, timing and errors. reconnect=true reconnects unavailable backends without replaying actions.', inputSchema: { type: 'object', properties: { reconnect: { type: 'boolean', default: false } }, additionalProperties: false }, annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false } }
  ] }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: args } = request.params;
    if (name === 'fecimus_status') {
      if (args && (Object.keys(args).some(k => k !== 'reconnect') || (args.reconnect !== undefined && typeof args.reconnect !== 'boolean'))) return toolError('fecimus_status accepts only reconnect: boolean.');
      if (args?.reconnect) await gateway.start();
      const status = gateway.status();
      return { content: [{ type: 'text', text: JSON.stringify({ ...status, backend_tools: status.tools, tools: status.tools + extraTools.length + 1 }) }] };
    }
    const progressToken = request.params._meta?.progressToken;
    const options = { meta: request.params._meta,
      ...(progressToken === undefined ? {} : { onprogress: progress => {
        server.notification({ method: 'notifications/progress', params: { ...progress, progressToken } }).catch(() => {});
      } }) };
    if (extraValidators.has(name)) {
      try {
        const input = extraValidators.get(name)(args);
        return await callExtraTool(name, input, (tool, inputArgs, signal = extra.signal) => gateway.invoke(tool, inputArgs, signal, options), extra.signal);
      } catch (error) { return toolError(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
    }
    return gateway.invoke(name, args, extra.signal, options);
  });
  await server.connect(new StdioServerTransport());
  connected = true;
  console.error(`[fecimus] Ready: ${gateway.routes.size} backend tools + ${extraTools.length + 1} Fecimus tools`);
} catch (error) {
  console.error('[fecimus] Startup failed:', error);
  await shutdown(1);
}
