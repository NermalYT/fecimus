import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const value = result => JSON.parse(result.content.find(part => part.type === 'text').text);
test('real MCP full/compact protocol preserves tools, schemas, guides, edits and panel control', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'fecimus-v3-protocol-'));
  const backends = path.join(temporary, 'empty-backends.json'); await fs.writeFile(backends, '{}');
  const catalogs = [];
  try {
    for (const mode of ['full', 'compact']) {
      const dataDir = path.join(temporary, mode); await fs.mkdir(dataDir);
      const client = new Client({ name: 'fecimus-v3-protocol', version: '1.0.0' });
      const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'src/server.mjs')], env: { ...process.env, FECIMUS_DATA_DIR: dataDir, FECIMUS_BACKENDS: backends, FECIMUS_SKIP_RUNTIME: '1', FECIMUS_TOOL_MODE: mode, FECIMUS_FILE_ROOTS: JSON.stringify([temporary]) }, stderr: 'pipe' });
      let stderr = ''; transport.stderr.on('data', data => { stderr = (stderr + data).slice(-4000); });
      const call = (name, args = {}) => client.callTool({ name, arguments: args }, undefined, { timeout: 15000 });
      try {
        await client.connect(transport, { timeout: 15000 });
        const listed = (await client.listTools()).tools;
        if (mode === 'compact') assert.equal(listed.length, 5); else assert(listed.length > 15);
        const inventory = value(await call('fecimus_tools')); catalogs.push(inventory.names);
        const found = value(await call('fecimus_tools', { names: ['fecimus_project_edit'] }));
        assert(found.tools[0].inputSchema.required.includes('expected_sha256'));
        const status = value(await call('fecimus_status')); assert.equal(status.tool_mode, mode); assert.equal(status.advertised_tools, listed.length);
        const resources = await client.listResources(); assert.equal(resources.resources.length, 7);
        assert((await client.readResource({ uri: 'fecimus://guide/workflow' })).contents[0].text.includes('objective'));
        assert.equal((await client.listPrompts()).prompts.length, 2);
        assert((await client.getPrompt({ name: 'fecimus_development', arguments: { objective: 'fixture objective' } })).messages[0].content.text.includes('fixture objective'));
        const filename = path.join(temporary, `${mode}.txt`);
        assert(!(await call('fecimus_call', { tool: 'fecimus_project_edit', arguments: { path: filename, expected_sha256: 'absent', new_text: 'original text\n' } })).isError);
        const before = value(await call('fecimus_call', { tool: 'fecimus_project_read', arguments: { path: filename } }));
        assert.equal(typeof before.sha256, 'string');
        assert((await call('fecimus_call', { tool: 'fecimus_project_edit', arguments: { path: filename, expected_sha256: '0'.repeat(64), old_text: 'original', new_text: 'corrupt' } })).isError);
        assert.equal(await fs.readFile(filename, 'utf8'), 'original text\n');
        assert((await call('fecimus_call', { tool: 'fecimus_call', arguments: {} })).isError);
        assert((await call('fecimus_call', { tool: 'fecimus_project_read', arguments: { path: 4 } })).isError);
        const url = new URL(value(await call('fecimus_control_panel')).url), origin = url.origin;
        const headers = { Authorization: 'Bearer ' + url.hash.slice(1), Origin: origin, 'Content-Type': 'application/json' };
        assert.equal((await fetch(origin + '/api/control', { method: 'POST', headers, body: '{"action":"pause"}' })).status, 200);
        const paused = await call('fecimus_call', { tool: 'fecimus_project_read', arguments: { path: filename } }); assert(paused.isError); assert.match(paused.content[0].text, /paused/);
        assert(value(await call('fecimus_status')).paused);
        assert.equal((await fetch(origin + '/api/control', { method: 'POST', headers, body: '{"action":"resume"}' })).status, 200);
        assert(!(await call('fecimus_call', { tool: 'fecimus_project_read', arguments: { path: filename } })).isError);
      } catch (error) { error.message += '\nServer diagnostics: ' + stderr; throw error; }
      finally { await client.close().catch(() => {}); await transport.close().catch(() => {}); }
    }
    assert.deepEqual(catalogs[0], catalogs[1]);
  } finally { await fs.rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});
