import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createControlState } from '../src/control-state.mjs';
import { startControlPanel } from '../src/control-panel.mjs';

test('pause rejects new calls, stop aborts running calls, resume never replays', async () => {
  let dispatches = 0, stops = 0;
  const state = createControlState({ onStop: async () => { stops++; } });
  state.pause();
  await assert.rejects(state.run('test', async () => { dispatches++; }), /paused/);
  state.resume();
  const work = state.run('slow', signal => new Promise(resolve => { dispatches++; signal.addEventListener('abort', () => resolve({ isError: true }), { once: true }); }));
  assert.equal(state.snapshot().active.length, 1);
  await state.stop(); await work;
  assert.equal(dispatches, 1); assert.equal(stops, 1);
  state.resume(); assert.equal(dispatches, 1);
  assert.equal(state.snapshot().history[0].ok, false);
  assert.deepEqual(Object.keys(state.snapshot().history[0]).sort(), ['ended_at', 'id', 'ms', 'ok', 'tool']);
});

test('closing waits for cancelled operations to finish their cleanup', async () => {
  const state = createControlState();
  let cleaned = false;
  const operation = state.run('fixture', signal => new Promise(resolve => signal.addEventListener('abort', () => {
    setTimeout(() => { cleaned = true; resolve({ isError: true }); }, 30);
  }, { once: true })));
  await state.close(); await operation;
  assert(cleaned); assert.equal(state.snapshot().active.length, 0);
  await assert.rejects(state.run('later', async () => assert.fail('must not run')), /closing/);
  assert.throws(() => state.resume(), /closing/);
});

test('control HTTP requires loopback host, token and same-origin mutations; serves no arbitrary tool RPC', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fecimus-control-'));
  const control = createControlState();
  let captures = 0, cancelled;
  const panel = await startControlPanel({ dataDir, control, getStatus: () => ({ version: '3.0.0', tools: 97 }), getJobs: () => ({ jobs: [] }), cancelJob: id => { cancelled = id; return { ok: true }; }, getScreenshot: async () => { captures++; await new Promise(resolve => setTimeout(resolve, 20)); return { image: { data: 'fixture', mimeType: 'image/jpeg' } }; } });
  const url = new URL(panel.url), token = url.hash.slice(1), origin = url.origin;
  const auth = { Authorization: 'Bearer ' + token };
  const post = (route, body, headers = {}) => fetch(origin + route, { method: 'POST', headers: { ...auth, Origin: origin, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  try {
    assert.equal((await fetch(origin + '/api/status')).status, 401);
    assert.equal((await fetch(origin + '/api/status', { headers: { ...auth, Origin: 'http://evil.invalid' } })).status, 403);
    const hostStatus = await new Promise((resolve, reject) => { const req = http.get(origin + '/api/status', { headers: { ...auth, Host: 'evil.invalid' } }, response => { response.resume(); resolve(response.statusCode); }); req.on('error', reject); });
    assert.equal(hostStatus, 403);
    assert.equal((await fetch(origin + '/api/status', { headers: auth })).status, 200);
    assert.equal((await post('/api/control', { action: 'pause' }, { Origin: 'http://evil.invalid' })).status, 403);
    assert.equal((await post('/api/control', { action: 'pause' })).status, 200); assert(control.snapshot().paused);
    assert.equal((await post('/api/control', { action: 'resume' })).status, 200); assert(!control.snapshot().paused);
    assert.equal((await post('/api/call', { tool: 'shell_run', arguments: {} })).status, 400);
    assert.equal((await post('/api/job/cancel', { job_id: 'fixture' })).status, 200); assert.equal(cancelled, 'fixture');
    await Promise.all([1, 2, 3].map(() => fetch(origin + '/api/screenshot', { headers: auth }).then(r => r.json())));
    assert.equal(captures, 1);
    const page = await fetch(origin + '/'); assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert(!(await page.text()).includes(token));
    for (const asset of ['/panel.js', '/panel.css']) assert.equal((await fetch(origin + asset)).status, 200);
    assert.equal((await fetch(origin + '/unknown')).status, 404);
    const descriptor = JSON.parse(await fs.readFile(path.join(dataDir, 'control.json'), 'utf8')); assert.equal(descriptor.url, panel.url);
    if (process.platform !== 'win32') assert.equal((await fs.stat(path.join(dataDir, 'control.json'))).mode & 0o777, 0o600);
  } finally {
    await panel.close();
    assert.equal(JSON.parse(await fs.readFile(path.join(dataDir, 'control.json'), 'utf8')).url, panel.url);
    await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test('closing an older panel never removes a newer session descriptor', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fecimus-control-session-'));
  const filename = path.join(dataDir, 'control.json');
  const options = { dataDir, control: createControlState(), getStatus: () => ({}), getJobs: () => ({ jobs: [] }), cancelJob: () => ({}), getScreenshot: () => ({}) };
  const originalRemove = fs.rm;
  let older, newer;
  try {
    older = await startControlPanel(options);
    // Reproduce the old read-then-unlink race deterministically: if close tries
    // to unlink the shared pointer, publish the replacement just before unlink.
    fs.rm = async (file, settings) => {
      if (file === filename && !newer) newer = await startControlPanel(options);
      return originalRemove(file, settings);
    };
    await older.close();
    fs.rm = originalRemove;
    if (!newer) newer = await startControlPanel(options);
    const saved = JSON.parse(await fs.readFile(filename, 'utf8'));
    assert.equal(saved.url, newer.url);
    const url = new URL(newer.url);
    assert.equal((await fetch(url.origin + '/api/status', { headers: { Authorization: 'Bearer ' + url.hash.slice(1) } })).status, 200);
    await newer.close();
    assert.equal(JSON.parse(await fs.readFile(filename, 'utf8')).url, newer.url);
  } finally {
    fs.rm = originalRemove;
    await older?.close(); await newer?.close();
    await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});
