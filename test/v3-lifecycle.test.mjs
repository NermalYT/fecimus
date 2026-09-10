import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// Real server/MCP/job supervision, with a disposable loopback model endpoint and
// an empty native backend catalog. No personal desktop, browser or model is used.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const linux = process.platform === 'linux';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const value = result => JSON.parse(result.content.find(part => part.type === 'text').text);
async function until(check, label, timeout = 8000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const result = await check(); if (result) return result; await pause(25); }
  throw new Error(`Timed out waiting for ${label}.`);
}
async function processInfo(pid) {
  try {
    const raw = await fs.readFile(`/proc/${pid}/stat`, 'utf8');
    const fields = raw.slice(raw.lastIndexOf(')') + 2).trim().split(/\s+/);
    return { pid: Number(pid), state: fields[0], parent: Number(fields[1]), group: Number(fields[2]), start: fields[19] };
  } catch (error) { if (['ENOENT', 'ESRCH'].includes(error.code)) return null; throw error; }
}
const running = info => info && !['Z', 'X'].includes(info.state);
async function dead(owned) { const now = await processInfo(owned.pid); return !running(now) || now.start !== owned.start; }
async function processList() {
  return (await Promise.all((await fs.readdir('/proc')).filter(name => /^\d+$/.test(name)).map(processInfo))).filter(Boolean);
}
async function readPid(filename) {
  try { const pid = Number(await fs.readFile(filename, 'utf8')); return Number.isInteger(pid) && pid > 1 ? pid : null; }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
const workerSource = `
const fs = require('node:fs');
const { spawn } = require('node:child_process');
process.on('SIGTERM', () => {});
fs.writeFileSync(process.argv[2], String(process.pid));
if (process.argv[3]) spawn(process.execPath, [__filename, process.argv[3]], { stdio: 'ignore' });
setInterval(() => {}, 1000);
setTimeout(() => process.exit(0), 30000);
`;

async function fixture(t) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'fecimus-v3-lifecycle-'));
  const dataDir = path.join(temporary, 'data'), bin = path.join(temporary, 'bin'), appHome = path.join(temporary, 'home');
  await Promise.all([dataDir, bin, appHome].map(dir => fs.mkdir(dir)));
  const backends = path.join(temporary, 'backends.json'), settings = path.join(temporary, 'settings.json');
  const worker = path.join(temporary, 'worker.cjs'), git = path.join(bin, 'git');
  const markers = Object.fromEntries(['job', 'child', 'git'].map(name => [name, path.join(temporary, `${name}.pid`)]));
  await fs.writeFile(backends, '{}'); await fs.writeFile(worker, workerSource);
  await fs.writeFile(git, `#!/usr/bin/env node\nconst fs = require('node:fs');\nprocess.on('SIGTERM', () => {});\nfs.writeFileSync(${JSON.stringify(markers.git)}, String(process.pid));\nsetInterval(() => {}, 1000);\nsetTimeout(() => process.exit(0), 30000);\n`, { mode: 0o700 });
  const requests = [], held = new Set();
  const model = http.createServer(async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      requests.push(body);
      if (body.model === 'waiting-fixture') { held.add(res); res.once('close', () => held.delete(res)); return; }
      const hasToolResult = body.messages.some(message => message.role === 'tool');
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ choices: [{ finish_reason: hasToolResult ? 'stop' : 'tool_calls', message: hasToolResult
        ? { role: 'assistant', content: 'Unexpected continuation after cancellation.' }
        : { role: 'assistant', content: null, tool_calls: [{ id: 'fixture_git', type: 'function', function: { name: 'fecimus_git_status', arguments: JSON.stringify({ root: temporary }) } }] }
      }] }));
    } catch { if (!res.writableEnded) { res.statusCode = 500; res.end('Fixture error.'); } }
  });
  await new Promise(resolve => model.listen(0, '127.0.0.1', resolve));
  await fs.writeFile(settings, JSON.stringify({ agents: { base_url: `http://127.0.0.1:${model.address().port}/v1` } }));
  const client = new Client({ name: 'fecimus-v3-lifecycle', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'src/server.mjs')], stderr: 'pipe',
    env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH || ''}`, FECIMUS_DATA_DIR: dataDir,
      FECIMUS_SETTINGS: settings, FECIMUS_BACKENDS: backends, FECIMUS_SKIP_RUNTIME: '1', FECIMUS_TOOL_MODE: 'compact', FECIMUS_CONTROL: '1',
      FECIMUS_FILE_ROOTS: JSON.stringify([temporary]), FECIMUS_APP_HOME: appHome } });
  let diagnostics = '', closed = false;
  const owned = [], groups = new Set();
  transport.stderr.on('data', chunk => { diagnostics = (diagnostics + chunk).slice(-5000); });
  const close = async () => { if (closed) return; closed = true; await client.close(); await transport.close(); };
  t.after(async () => {
    try { await close(); }
    finally {
      // Emergency cleanup targets only identities and groups captured from this
      // fixture; PID start times prevent touching an unrelated reused PID.
      for (const process of owned) if (!(await dead(process))) {
        try { globalThis.process.kill(process.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      }
      for (const process of await processList()) if (groups.has(process.group) && running(process)) {
        try { globalThis.process.kill(process.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      }
      model.closeAllConnections(); await new Promise(resolve => model.close(resolve));
      await fs.rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  });
  await client.connect(transport, { timeout: 15000 });
  const server = await processInfo(transport.pid); assert(running(server)); owned.push(server);
  const call = async (name, args = {}) => {
    const result = await client.callTool({ name: 'fecimus_call', arguments: { tool: name, arguments: args } }, undefined, { timeout: 15000 });
    assert(!result.isError, `${name}: ${result.content?.[0]?.text}\n${diagnostics}`); return value(result);
  };
  const panel = new URL((await call('fecimus_control_panel')).url);
  const headers = { Authorization: `Bearer ${panel.hash.slice(1)}`, Origin: panel.origin, 'Content-Type': 'application/json' };
  const api = async (route, body) => {
    const response = await fetch(panel.origin + '/api/' + route, { method: body ? 'POST' : 'GET', headers,
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000) });
    const data = await response.json(); assert.equal(response.status, 200, JSON.stringify(data)); return data;
  };
  const capture = async (filename, command) => {
    const pid = await until(() => readPid(filename), 'fixture PID');
    const info = await processInfo(pid); assert(running(info), 'Fixture exited before cancellation');
    assert((await fs.readFile(`/proc/${pid}/cmdline`, 'utf8')).includes(command), 'PID must belong to the fixture executable');
    owned.push(info); return info;
  };
  const startWork = async () => {
    const job = await call('fecimus_job_start', { command: process.execPath, args: [worker, markers.job, markers.child], cwd: temporary, timeout_ms: 20000 });
    const [jobProcess, childProcess] = await Promise.all([capture(markers.job, worker), capture(markers.child, worker)]);
    assert.equal(jobProcess.group, jobProcess.pid); assert.equal(childProcess.group, jobProcess.group); assert.equal(childProcess.parent, jobProcess.pid);
    groups.add(jobProcess.group);
    const guardian = await processInfo(jobProcess.parent);
    assert(running(guardian)); assert.equal(guardian.parent, server.pid);
    assert((await fs.readFile(`/proc/${guardian.pid}/cmdline`, 'utf8')).includes('studio-job-guard.py')); owned.push(guardian);
    const agent = model => call('fecimus_agent_start', { model, objective: 'Lifecycle fixture only.', allowed_tools: ['fecimus_git_status'], timeout_ms: 20000 });
    const waiting = await agent('waiting-fixture'); await until(() => held.size === 1, 'waiting model request');
    const working = await agent('tool-fixture'); const gitProcess = await capture(markers.git, git); groups.add(gitProcess.group);
    await until(async () => (await api('status')).agents.agents.some(run => run.agent_id === working.agent_id && run.in_flight_tool === 'fecimus_git_status'), 'agent tool dispatch');
    assert.equal(requests.length, 2);
    return { job, waiting, working, workers: [jobProcess, childProcess, guardian, gitProcess] };
  };
  const assertDead = async processes => {
    await until(async () => (await Promise.all(processes.map(dead))).every(Boolean), 'all fixture processes to terminate');
    await until(async () => (await processList()).every(info => !groups.has(info.group) || !running(info)), 'fixture process groups to drain');
  };
  return { startWork, api, call, client, close, server, dataDir, requests, held, assertDead, diagnostics: () => diagnostics };
}

test('panel Stop cancels real studio descendants, a pending model request and an agent tool without replay', { skip: !linux, timeout: 20000 }, async t => {
  const f = await fixture(t), work = await f.startWork();
  const stopped = await f.api('control', { action: 'stop' }); assert.equal(stopped.paused, true);
  const status = await until(async () => {
    const current = await f.api('status');
    return current.jobs.jobs.find(job => job.job_id === work.job.job_id)?.state === 'cancelled'
      && [work.waiting, work.working].every(agent => current.agents.agents.find(run => run.agent_id === agent.agent_id)?.state === 'cancelled')
      && current.agents.active === 0 && current.control.active.length === 0 && current;
  }, 'Stop cancellation results');
  assert.equal(status.control.paused, true);
  await f.assertDead(work.workers); await until(() => f.held.size === 0, 'model HTTP cancellation');
  const rejected = await f.client.callTool({ name: 'fecimus_call', arguments: { tool: 'fecimus_git_status', arguments: { root: f.dataDir } } });
  assert.equal(rejected.isError, true); assert.match(rejected.content[0].text, /paused/);
  assert.equal(f.requests.length, 2);
  await f.api('control', { action: 'resume' }); await pause(50);
  assert.equal(f.requests.length, 2); assert.equal((await f.api('status')).agents.active, 0);
});

test('individual panel cancel routes use real job_id and agent_id values', { skip: !linux, timeout: 20000 }, async t => {
  const f = await fixture(t), work = await f.startWork();
  const job = await f.api('job/cancel', { job_id: work.job.job_id }); assert.equal(job.job_id, work.job.job_id);
  for (const agent of [work.waiting, work.working]) {
    const cancelled = await f.api('agent/cancel', { agent_id: agent.agent_id }); assert.equal(cancelled.agent_id, agent.agent_id);
  }
  await until(async () => {
    const current = await f.api('status');
    return current.jobs.active === 0 && current.agents.active === 0 && current.control.active.length === 0;
  }, 'individual cancellations');
  const status = await f.api('status');
  assert(status.jobs.jobs.every(job => job.state === 'cancelled'));
  assert(status.agents.agents.every(agent => agent.state === 'cancelled'));
  await f.assertDead(work.workers); await until(() => f.held.size === 0, 'model request disconnect');
  assert.equal(f.requests.length, 2); assert.equal(status.control.paused, false);
});

test('MCP close drains active jobs and agent tools, leaving an inactive last-known panel descriptor', { skip: !linux, timeout: 20000 }, async t => {
  const f = await fixture(t), work = await f.startWork();
  const descriptorPath = path.join(f.dataDir, 'control.json');
  const descriptor = JSON.parse(await fs.readFile(descriptorPath, 'utf8'));
  assert.equal(descriptor.pid, f.server.pid);
  await f.close();
  await f.assertDead([...work.workers, f.server]);
  await until(() => f.held.size === 0, 'model connection close');
  assert.deepEqual(JSON.parse(await fs.readFile(descriptorPath, 'utf8')), descriptor);
  await assert.rejects(fetch(new URL('/', descriptor.url), { signal: AbortSignal.timeout(2000) }));
  assert.equal(f.requests.length, 2, 'Shutdown must not run a continuation or replay');
  assert(!/Startup failed/.test(f.diagnostics()));
});
