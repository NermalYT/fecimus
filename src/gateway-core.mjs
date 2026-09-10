import fs from 'node:fs';
import { compactTool } from './catalog.mjs';
import { VERSION } from './version.mjs';
import { createHash } from 'node:crypto';
import Ajv from 'ajv';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ListToolsResultSchema, ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';

const errorText = error => error instanceof Error ? error.message : String(error);
export const toolError = message => ({ isError: true, content: [{ type: 'text', text: message }] });
const aborted = signal => { if (signal?.aborted) throw new Error('Request cancelled before dispatch; no action was sent.'); };
const bounded = (value, fallback, min, max) => Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

export function inputValidator(schema) {
  const Constructor = schema?.$schema?.includes('2020-12') ? Ajv2020 : Ajv;
  const ajv = new Constructor({ strict: false, allErrors: true, useDefaults: true, coerceTypes: false, validateSchema: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  return args => {
    const input = structuredClone(args ?? {});
    if (!validate(input)) throw new Error(`Invalid arguments: ${ajv.errorsText(validate.errors, { separator: '; ' })}. Follow this tool's input schema; no action was sent.`);
    return input;
  };
}

// Abortable FIFO: stateful backend calls never overlap, and cancelled queued work never runs.
export class SerialQueue {
  constructor(limit = 64) { this.limit = limit; this.jobs = []; this.running = false; }
  run(fn, signal) {
    try { aborted(signal); } catch (error) { return Promise.reject(error); }
    if (this.jobs.length >= this.limit) return Promise.reject(new Error('Fecimus queue is full; no action was sent.'));
    return new Promise((resolve, reject) => {
      const job = { fn, signal, resolve, reject };
      job.abort = () => {
        const index = this.jobs.indexOf(job);
        if (index >= 0) { this.jobs.splice(index, 1); reject(new Error('Request cancelled while queued; no action was sent.')); }
      };
      signal?.addEventListener('abort', job.abort, { once: true });
      this.jobs.push(job);
      this.drain();
    });
  }
  async drain() {
    if (this.running) return;
    this.running = true;
    while (this.jobs.length) {
      const job = this.jobs.shift();
      job.signal?.removeEventListener('abort', job.abort);
      try { aborted(job.signal); job.resolve(await job.fn()); } catch (error) { job.reject(error); }
    }
    this.running = false;
  }
  cancel() {
    for (const job of this.jobs.splice(0)) {
      job.signal?.removeEventListener('abort', job.abort);
      job.reject(new Error('Fecimus is closing; no action was sent.'));
    }
  }
}

export class Gateway {
  constructor(config, options = {}) {
    if (!config || Array.isArray(config) || typeof config !== 'object') throw new Error('Fecimus backend configuration must be an object.');
    this.options = options;
    this.settings = options.settings || {};
    this.log = options.log || (line => console.error(`[fecimus] ${line}`));
    this.startTime = Date.now();
    this.closing = false;
    this.peers = new Map();
    this.routes = new Map();
    this.validators = new Map();
    this.queues = new Map();
    this.reserved = new Set(['fecimus_status', ...(options.reservedNames || [])]);
    this.cachePath = options.cachePath;
    this.configHash = createHash('sha256').update(JSON.stringify(config)).digest('hex');
    for (const [name, entry] of Object.entries(config)) {
      if (!entry || typeof entry.command !== 'string' || !entry.command || (entry.args !== undefined && (!Array.isArray(entry.args) || entry.args.some(a => typeof a !== 'string')))) throw new Error(`Invalid command configuration for ${name}.`);
      if (entry.toolPrefix !== undefined && !/^[a-z][a-z0-9_]{0,31}__$/.test(entry.toolPrefix)) throw new Error(`Invalid tool prefix for ${name}.`);
      const group = name.startsWith('desktop-') || entry.group === 'desktop' ? 'desktop' : name;
      if (!this.queues.has(group)) this.queues.set(group, new SerialQueue());
      this.peers.set(name, { name, entry, group, connected: false, tools: [], client: null, connectPromise: null, closePromise: null, generation: 0, lastError: null, metrics: { calls: 0, errors: 0, connections: 0, total_ms: 0, last_ms: null, startup_ms: null } });
    }
    this.readCache();
    this.rebuildRoutes();
  }
  readCache() {
    if (!this.cachePath) return;
    try {
      if (fs.statSync(this.cachePath).size > 8 * 1024 * 1024) return;
      const cache = JSON.parse(fs.readFileSync(this.cachePath, 'utf8'));
      if (cache.version !== 1 || cache.configHash !== this.configHash || !cache.backends || typeof cache.backends !== 'object') return;
      for (const [name, peer] of this.peers) {
        const parsed = ListToolsResultSchema.safeParse({ tools: cache.backends[name] });
        if (parsed.success && parsed.data.tools.length <= 1000) peer.tools = parsed.data.tools;
      }
    } catch (error) { if (error.code !== 'ENOENT') this.log(`Ignoring invalid tool cache: ${errorText(error)}`); }
  }
  saveCache() {
    if (!this.cachePath) return;
    try {
      const temporary = `${this.cachePath}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify({ version: 1, configHash: this.configHash, backends: Object.fromEntries([...this.peers].map(([name, p]) => [name, p.tools])) }) + '\n', { mode: 0o600 });
      fs.renameSync(temporary, this.cachePath);
    } catch (error) { this.log(`Tool cache write failed: ${errorText(error)}`); }
  }
  rebuildRoutes() {
    const next = new Map();
    const usedValidators = new Set();
    for (const [backend, peer] of this.peers) {
      for (const tool of peer.tools) {
        let name = (peer.entry.toolPrefix || '') + tool.name;
        if (peer.entry.toolPrefix && (!/^[a-zA-Z0-9_-]+$/.test(tool.name) || name.length > 64)) { this.log(`Skipping invalid addon tool name from ${backend}.`); continue; }
        if (next.has(name) || this.reserved.has(name)) name = `${backend.replace(/[^a-zA-Z0-9_]/g, '_')}_${tool.name}`;
        while (next.has(name) || this.reserved.has(name)) name = `_${name}`;
        try {
          const compact = compactTool(tool);
          if (backend.startsWith('desktop-') && !compact.description?.startsWith('AI desktop.')) compact.description = `AI desktop. ${compact.description || ''}`;
          const schemaKey = JSON.stringify(tool.inputSchema);
          let validate = this.validators.get(schemaKey);
          if (!validate) { validate = inputValidator(tool.inputSchema); this.validators.set(schemaKey, validate); }
          usedValidators.add(schemaKey);
          next.set(name, { backend, original: tool.name, definition: { ...compact, name }, validate });
        } catch (error) { this.log(`Skipping invalid schema ${backend}/${tool.name}: ${errorText(error)}`); }
      }
    }
    const before = JSON.stringify(this.listTools());
    this.routes = next;
    for (const key of this.validators.keys()) if (!usedValidators.has(key)) this.validators.delete(key);
    if (before !== JSON.stringify(this.listTools())) this.options.onToolsChanged?.();
  }
  listTools() { return [...this.routes.values()].map(route => route.definition); }
  async start() {
    await Promise.allSettled([...this.peers.values()].map(peer => this.ensureConnected(peer)));
    this.saveCache();
  }
  async ensureConnected(peer) {
    if (this.closing) throw new Error('Fecimus is closing.');
    if (peer.connected) return;
    if (peer.connectPromise) return peer.connectPromise;
    peer.connectPromise = this.connect(peer).finally(() => { peer.connectPromise = null; });
    return peer.connectPromise;
  }
  async connect(peer) {
    await peer.closePromise;
    if (this.closing) throw new Error('Fecimus is closing.');
    const generation = ++peer.generation;
    const started = Date.now();
    const timeout = bounded(this.settings.startup_timeout_ms, 15000, 100, 60000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const useRuntime = peer.name.startsWith('desktop-') || peer.name === 'terminal-files' || peer.entry.isolated === true;
    const client = new Client({ name: `fecimus-${peer.name}`, version: VERSION });
    const runtimeEnv = this.options.runtimeEnv;
    const env = { ...(useRuntime && runtimeEnv ? runtimeEnv : process.env), ...peer.entry.env };
    if (useRuntime && runtimeEnv) {
      for (const key of ['DISPLAY', 'XAUTHORITY', 'WAYLAND_DISPLAY', 'XDG_SESSION_TYPE', 'SESSION_MANAGER', 'GDK_BACKEND', 'QT_QPA_PLATFORM', 'DBUS_SESSION_BUS_ADDRESS', 'DBUS_STARTER_ADDRESS', 'DBUS_STARTER_BUS_TYPE', ...(peer.entry.isolated ? ['HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'XDG_RUNTIME_DIR', 'FECIMUS_APP_HOME'] : [])]) {
        if (Object.hasOwn(runtimeEnv, key)) env[key] = runtimeEnv[key]; else delete env[key];
      }
    }
    const launch = this.options.childWrapper
      ? { command: 'python3', args: [this.options.childWrapper, String(process.pid), peer.entry.command, ...(peer.entry.args || [])] }
      : { command: peer.entry.command, args: peer.entry.args || [] };
    const transport = new StdioClientTransport({ ...launch, cwd: peer.entry.cwd, env, stderr: 'pipe' });
    peer.client = client;
    peer.transport = transport;
    transport.stderr?.on('data', data => this.log(`[${peer.name}] ${String(data).trimEnd()}`));
    client.onerror = error => { peer.lastError = errorText(error); };
    client.onclose = () => {
      if (peer.generation === generation) { peer.connected = false; if (!this.closing) peer.lastError ||= 'Backend process disconnected.'; }
    };
    client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
      if (!peer.connected || this.closing) return;
      clearTimeout(peer.refreshTimer);
      peer.refreshTimer = setTimeout(() => this.queues.get(peer.group).run(async () => {
        if (!peer.connected || peer.generation !== generation) return;
        try { peer.tools = await this.discover(client); this.rebuildRoutes(); this.saveCache(); }
        catch (error) { peer.lastError = `Tool refresh failed: ${errorText(error)}`; }
      }).catch(error => this.log(errorText(error))), 100);
    });
    try {
      await client.connect(transport, { timeout, signal: controller.signal });
      const tools = await this.discover(client, controller.signal, timeout);
      if (this.closing || controller.signal.aborted) throw new Error('Backend startup cancelled or timed out.');
      peer.tools = tools;
      peer.connected = true;
      peer.lastError = null;
      peer.metrics.connections++;
      peer.metrics.startup_ms = Date.now() - started;
      this.rebuildRoutes();
      this.log(`${peer.name}: ${tools.length} tools (${peer.metrics.startup_ms} ms)`);
    } catch (error) {
      peer.connected = false;
      peer.lastError = errorText(error);
      peer.closePromise = client.close().catch(() => {});
      this.log(`${peer.name} unavailable: ${peer.lastError}`);
      throw error;
    } finally { clearTimeout(timer); }
  }
  async discover(client, signal, timeout = 15000) {
    const tools = [];
    const cursors = new Set();
    let cursor;
    do {
      const page = await client.listTools(cursor ? { cursor } : {}, { timeout, signal });
      tools.push(...page.tools);
      if (tools.length > 1000) throw new Error('Backend returned more than 1,000 tools.');
      cursor = page.nextCursor;
      if (cursor && cursors.has(cursor)) throw new Error('Backend returned a repeated tool-list cursor.');
      cursors.add(cursor);
    } while (cursor);
    // SDK 1.26 listTools replaces metadata on each page; restore all pages for output validation.
    client.cacheToolMetadata(tools);
    return tools;
  }
  async invoke(name, args = {}, signal, options = {}) {
    const route = this.routes.get(name);
    if (!route) return toolError(`Unknown tool: ${name}. Refresh the Fecimus tool list.`);
    try { route.validate(args); aborted(signal); } catch (error) { return toolError(errorText(error)); }
    const peer = this.peers.get(route.backend);
    try {
      return await this.queues.get(peer.group).run(() => this.dispatch(name, route, args, signal, options), signal);
    } catch (error) { return toolError(errorText(error)); }
  }
  async invokeDesktopBatch(steps, signal, options = {}) {
    // Validate the entire known sequence before the first action. A batch owns
    // the same desktop queue as individual calls, so keyboard focus cannot be
    // changed by another Fecimus request in the middle of a sequence.
    try {
      aborted(signal);
      if (!Array.isArray(steps) || !steps.length || steps.length > 16) throw new Error('A desktop sequence requires 1–16 steps.');
      const planned = steps.map(step => {
        const route = this.routes.get(step.tool);
        if (!route || this.peers.get(route.backend)?.group !== 'desktop') throw new Error(`Not a desktop tool: ${step.tool}. No action was sent.`);
        route.validate(step.arguments);
        return { ...step, route };
      });
      return await this.queues.get('desktop').run(async () => {
        const results = [];
        for (const [index, step] of planned.entries()) {
          let result;
          try { result = await this.dispatch(step.tool, step.route, step.arguments, signal, options); }
          catch (error) { result = toolError(errorText(error)); }
          results.push({ tool: step.tool, result });
          if (result.isError) return { results, completed: index, failed_step: index, stopped: true };
        }
        return { results, completed: results.length, stopped: false };
      }, signal);
    } catch (error) { return { results: [], completed: 0, stopped: true, error: errorText(error) }; }
  }
  async dispatch(name, route, args, signal, options = {}) {
    const peer = this.peers.get(route.backend);
    let input;
    aborted(signal);
    if ((peer.group === 'desktop' || peer.name === 'terminal-files') && this.options.runtimeStatus?.().healthy === false) {
      return toolError('Fecimus isolated desktop is unavailable. Restart the Fecimus integration; no action was sent to any desktop.');
    }
    try { await this.ensureConnected(peer); } catch (error) { return toolError(`${peer.name} is unavailable: ${errorText(error)}. No action was sent; check fecimus_status.`); }
    aborted(signal);
    const currentRoute = this.routes.get(name);
    if (!currentRoute || currentRoute.backend !== route.backend || currentRoute.original !== route.original) return toolError('This tool changed during backend recovery. Refresh the tool list; no action was sent.');
    try { input = currentRoute.validate(args); } catch (error) { return toolError(errorText(error)); }
    const started = Date.now();
    peer.metrics.calls++;
    let dispatched = false;
    try {
      const timeout = bounded(this.settings.call_timeout_ms, 180000, 100, 600000);
      dispatched = true;
      const result = await peer.client.callTool({ name: route.original, arguments: input, ...(options.meta ? { _meta: options.meta } : {}) }, undefined, {
        timeout, maxTotalTimeout: timeout, signal,
        ...(options.onprogress ? { onprogress: options.onprogress } : {})
      });
      if (result.isError) peer.metrics.errors++;
      return this.options.transformResult ? await this.options.transformResult(name, result) : result;
    } catch (error) {
      peer.metrics.errors++;
      peer.lastError = errorText(error);
      // Stop an uncertain transport before allowing the next queued action. Never replay it.
      peer.connected = false;
      peer.closePromise = peer.client.close().catch(() => {});
      await peer.closePromise;
      return toolError(`${peer.name}/${route.original}: ${errorText(error)}. ${dispatched ? 'The action may have run; check actual state before retrying. Fecimus did not replay it.' : 'No action was sent.'}`);
    } finally {
      peer.metrics.last_ms = Date.now() - started;
      peer.metrics.total_ms += peer.metrics.last_ms;
    }
  }
  status() {
    return { version: VERSION, uptime_seconds: Math.round((Date.now() - this.startTime) / 1000), tools: this.routes.size,
      backends: [...this.peers.values()].map(peer => ({ name: peer.name, connected: peer.connected, tools: peer.tools.length, queued: this.queues.get(peer.group).jobs.length, last_error: peer.lastError, ...peer.metrics })),
      runtime: this.options.runtimeStatus?.() || null };
  }
  async close() {
    if (this.closing) return;
    this.closing = true;
    for (const queue of this.queues.values()) queue.cancel();
    for (const peer of this.peers.values()) clearTimeout(peer.refreshTimer);
    await Promise.allSettled([...this.peers.values()].map(async peer => {
      peer.connected = false;
      if (peer.client) await peer.client.close();
      await peer.closePromise;
    }));
  }
}
