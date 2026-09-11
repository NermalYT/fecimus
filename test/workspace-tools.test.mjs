import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as pause } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { createWorkspaceManager, workspaceTools, callWorkspaceTool } from '../src/workspace-tools.mjs';
import { inputValidator } from '../src/gateway-core.mjs';

const sha = value => crypto.createHash('sha256').update(value).digest('hex');
async function fixture(t, overrides = {}) {
  const home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'fecimus workspace ')));
  const project = path.join(home, 'project with spaces');
  const appHome = path.join(home, 'private');
  await fs.mkdir(project); await fs.mkdir(appHome);
  const config = { dataDir: path.join(home, 'data'), home, env: { ...process.env, FECIMUS_FILE_ROOTS: '[]', FECIMUS_APP_HOME: appHome }, ...overrides };
  const manager = createWorkspaceManager(config);
  const canonical = await fs.realpath(project);
  const store = path.join(config.dataDir, 'workspace-notes', sha(process.platform === 'win32' ? canonical.toLowerCase() : canonical));
  t.after(() => fs.rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
  return { home, project, appHome, config, manager, store };
}

test('project notes and task checkpoints survive manager restart with explicit revisions', async t => {
  const { manager, project, config } = await fixture(t);
  const first = await manager.notes({ action: 'write', project, key: 'next-session', kind: 'checkpoint', title: 'Next build', content: 'Resume tests. 世界🙂' });
  assert(first.created); assert.equal(first.kind, 'checkpoint');
  const restarted = createWorkspaceManager(config);
  const read = await restarted.notes({ action: 'read', project, key: 'next-session' });
  assert.equal(read.content, 'Resume tests. 世界🙂'); assert.equal(read.revision, first.revision); assert(read.reference_data);
  await assert.rejects(restarted.notes({ action: 'write', project, key: 'next-session', content: 'lost update' }), /revision conflict/);
  const updated = await restarted.notes({ action: 'write', project, key: 'next-session', content: 'Tests finished.', revision: first.revision });
  assert.notEqual(updated.revision, first.revision); assert.equal(updated.kind, 'checkpoint');
  await assert.rejects(manager.notes({ action: 'delete', project, key: 'next-session', revision: first.revision }), /revision conflict/);
  const listing = await restarted.notes({ action: 'list', project });
  assert.equal(listing.total, 1); assert.equal(listing.records[0].content, undefined);
  assert.equal((await restarted.notes({ action: 'delete', project, key: 'next-session', revision: updated.revision })).deleted, true);
  assert.equal((await restarted.notes({ action: 'list', project })).total, 0);
});

test('parallel writers cannot lose updates and separate projects remain separate', async t => {
  const { manager, config, project, home } = await fixture(t);
  const initial = await manager.notes({ action: 'write', project, key: 'build', content: 'initial' });
  const peer = createWorkspaceManager(config);
  const results = await Promise.allSettled([manager, peer].map((writer, index) => writer.notes({ action: 'write', project, key: 'build', content: `writer${index}`, revision: initial.revision })));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.match(results.find(result => result.status === 'rejected').reason.message, /revision conflict/);
  const winner = await manager.notes({ action: 'read', project, key: 'build' });
  assert.match(winner.content, /^writer[01]$/);
  const other = path.join(home, 'other'); await fs.mkdir(other);
  assert.equal((await peer.notes({ action: 'list', project: other })).total, 0);
  await assert.rejects(peer.notes({ action: 'read', project: path.dirname(home), key: 'build' }), /outside configured/);
});

test('writer revision lock works across independent Node processes', async t => {
  const { manager, config, project } = await fixture(t);
  const first = await manager.notes({ action: 'write', project, key: 'parallel', content: 'base' });
  const module = pathToFileURL(path.resolve('src/workspace-tools.mjs')).href;
  const childConfig = { dataDir: config.dataDir, home: config.home, env: { FECIMUS_FILE_ROOTS: '[]' } };
  const run = value => new Promise((resolve, reject) => {
    const script = `import {createWorkspaceManager} from ${JSON.stringify(module)};const m=createWorkspaceManager(${JSON.stringify(childConfig)});try{await m.notes(${JSON.stringify({ action: 'write', project, key: 'parallel', content: value, revision: first.revision })});console.log('saved')}catch(e){console.log(e.message);process.exitCode=2}`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
    child.on('error', reject); child.on('close', code => resolve({ code, output }));
  });
  const results = await Promise.all([run('first'), run('second')]);
  assert.deepEqual(results.map(result => result.code).sort(), [0, 2]);
  assert.match(results.find(result => result.code === 2).output, /revision conflict/);
});

test('only provably dead aged writer locks are recovered, including competing recoverers', async t => {
  const { manager, config, project, store } = await fixture(t);
  const first = await manager.notes({ action: 'write', project, key: 'recover', content: 'base' });
  const pid = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
    child.on('error', reject); child.on('close', () => resolve(child.pid));
  });
  assert.throws(() => process.kill(pid, 0), error => error.code === 'ESRCH');
  const lock = path.join(store, '.mutation.lock');
  const old = new Date(Date.now() - 20000);
  await fs.writeFile(lock, JSON.stringify({ pid, created_at: old.toISOString() }), { mode: 0o600 });
  await fs.utimes(lock, old, old);
  const peer = createWorkspaceManager(config);
  const updates = await Promise.allSettled([manager, peer].map((writer, index) => writer.notes({ action: 'write', project, key: 'recover', content: `winner${index}`, revision: first.revision })));
  assert.equal(updates.filter(update => update.status === 'fulfilled').length, 1);
  assert.match(updates.find(update => update.status === 'rejected').reason.message, /revision conflict/);
  assert.equal((await fs.readdir(store)).some(name => name.startsWith('.mutation')), false);
});

test('live writer locks and abandoned recovery guards are never stolen', async t => {
  const { manager, project, store } = await fixture(t, { lockWaitMs: 100 });
  const first = await manager.notes({ action: 'write', project, key: 'unchanged', content: 'original' });
  const lock = path.join(store, '.mutation.lock');
  const recovery = path.join(store, '.mutation.recovery');
  const old = new Date(Date.now() - 20000);
  const owner = JSON.stringify({ pid: process.pid, created_at: old.toISOString() });
  await fs.writeFile(lock, owner, { mode: 0o600 }); await fs.utimes(lock, old, old);
  const update = () => manager.notes({ action: 'write', project, key: 'unchanged', content: 'must not happen', revision: first.revision });
  await assert.rejects(update(), error => error.message.includes(lock) && /busy/.test(error.message));
  assert.equal(await fs.readFile(lock, 'utf8'), owner);
  await fs.unlink(lock); await fs.writeFile(recovery, owner, { mode: 0o600 }); await fs.utimes(recovery, old, old);
  await assert.rejects(update(), error => error.message.includes(recovery) && /before removing/.test(error.message));
  assert.equal(await fs.readFile(recovery, 'utf8'), owner);
  assert.equal((await manager.notes({ action: 'read', project, key: 'unchanged' })).content, 'original');
});

test('failed atomic rename preserves the previous checkpoint and removes temporary files', async t => {
  const { manager, project, store } = await fixture(t);
  const first = await manager.notes({ action: 'write', project, key: 'checkpoint', content: 'previous' });
  const rename = fs.rename;
  fs.rename = async () => { throw Object.assign(new Error('fixture rename denied'), { code: 'EACCES' }); };
  try { await assert.rejects(manager.notes({ action: 'write', project, key: 'checkpoint', content: 'uncommitted', revision: first.revision }), /rename denied/); }
  finally { fs.rename = rename; }
  const record = await manager.notes({ action: 'read', project, key: 'checkpoint' });
  assert.equal(record.content, 'previous'); assert.equal(record.revision, first.revision);
  assert.deepEqual(await fs.readdir(store), [`${sha('checkpoint')}.json`]);
});

test('notes enforce encoded text limits, pagination, private permissions and safe schemas', async t => {
  const { manager, project, store } = await fixture(t);
  const validate = inputValidator(workspaceTools[0].inputSchema);
  assert.equal(validate({ action: 'list', project }).limit, 50);
  assert.throws(() => validate({ action: 'read', project, key: '../../outside' }));
  await assert.rejects(manager.notes({ action: 'write', project, key: 'large', content: '世界'.repeat(11000) }), /64 KiB/);
  for (const key of ['a', 'b']) await manager.notes({ action: 'write', project, key, content: key });
  const list = await manager.notes({ action: 'list', project, limit: 1 });
  assert.equal(list.total, 2); assert.equal(list.next_offset, 1);
  assert.equal((await manager.notes({ action: 'list', project, limit: 1, offset: 1 })).records[0].key, 'b');
  if (process.platform !== 'win32') {
    assert.equal((await fs.stat(store)).mode & 0o777, 0o700);
    assert.equal((await fs.stat(path.join(store, `${sha('a')}.json`))).mode & 0o777, 0o600);
  }
  const result = await callWorkspaceTool('fecimus_workspace_notes', { action: 'list', project }, manager);
  assert.equal(JSON.parse(result.content[0].text).total, 2);
});

test('symlink, hardlink and malformed record replacements are refused without leaking contents', async t => {
  const { manager, project, store, home } = await fixture(t);
  const entry = await manager.notes({ action: 'write', project, key: 'safe', content: 'safe' });
  const filename = path.join(store, `${sha('safe')}.json`);
  const outside = path.join(home, 'outside-record'); await fs.writeFile(outside, 'PRIVATE_DIAGNOSTIC_SENTINEL');
  await fs.unlink(filename);
  try { await fs.symlink(outside, filename); }
  catch (error) { if (process.platform === 'win32' && error.code === 'EPERM') { t.skip('Windows runner lacks symlink permission'); return; } throw error; }
  await assert.rejects(manager.notes({ action: 'read', project, key: 'safe' }), /regular, unlinked/);
  await assert.rejects(manager.notes({ action: 'write', project, key: 'safe', content: 'overwrite', revision: entry.revision }), /regular, unlinked/);
  assert.equal(await fs.readFile(outside, 'utf8'), 'PRIVATE_DIAGNOSTIC_SENTINEL');
  await fs.unlink(filename); await fs.link(outside, filename);
  await assert.rejects(manager.notes({ action: 'read', project, key: 'safe' }), /regular, unlinked/);
  await fs.unlink(filename); await fs.writeFile(filename, 'PRIVATE_DIAGNOSTIC_SENTINEL');
  await assert.rejects(manager.notes({ action: 'read', project, key: 'safe' }), error => error.message === 'Invalid workspace record JSON.');
  await fs.unlink(filename); await fs.rmdir(store); await fs.symlink(home, store, 'dir');
  await assert.rejects(manager.notes({ action: 'list', project }), /symlink/);
});

test('app probes inspect Unity and unspecified paths without launching anything', async t => {
  let calls = 0;
  const { manager } = await fixture(t, { runVersion: async () => { calls++; throw new Error('must not launch'); } });
  for (const app of [undefined, 'unity']) {
    const result = await manager.probe({ executable: process.execPath, ...(app ? { app } : {}) });
    assert(result.applications[0].found);
    assert.match(result.applications[0].version_probe, /inspection_only|unity_no_launch/);
  }
  assert.equal(calls, 0);
  await assert.rejects(manager.probe({ executable: 'relative-path' }), /absolute path/);
  await assert.rejects(manager.probe({ apps: ['node'], executable: process.execPath }), /Use apps or/);
});

test('version probes preserve argv/private HOME and explicitly report failure or deadline', async t => {
  const calls = [];
  const { manager, appHome, home } = await fixture(t, { runVersion: async (...args) => { calls.push(args); return { stdout: 'v99.0.0\n', stderr: '' }; } });
  const result = await manager.probe({ executable: process.execPath, app: 'node', timeout_ms: 300 });
  if (process.platform !== 'linux') { assert.match(result.applications[0].version_probe, /requires_linux/); assert.equal(calls.length, 0); return; }
  assert.equal(result.applications[0].version, 'v99.0.0');
  assert.deepEqual(calls[0].slice(0, 2), [process.execPath, ['--version']]);
  assert.equal(calls[0][2].env.HOME, appHome); assert.equal(calls[0][2].cwd, appHome); assert.equal(calls[0][2].timeout, 300);
  const failure = createWorkspaceManager({ home, dataDir: path.join(home, 'fail-data'), env: { FECIMUS_FILE_ROOTS: '[]' }, runVersion: async () => { throw { killed: true, message: 'timeout' }; } });
  assert.equal((await failure.probe({ executable: process.execPath, app: 'node' })).applications[0].version_probe, 'timed_out');
  const unhealthy = createWorkspaceManager({ home, dataDir: path.join(home, 'unhealthy'), env: { FECIMUS_FILE_ROOTS: '[]' }, runtimeStatus: () => ({ healthy: false }), runVersion: () => assert.fail('must not dispatch') });
  assert.equal((await unhealthy.probe({ executable: process.execPath, app: 'node' })).applications[0].version_probe, 'skipped_private_runtime_unavailable');
});

test('real Node version probe and PATH discovery work without a GUI', async t => {
  const { manager } = await fixture(t);
  const result = await manager.probe({ apps: ['node'] });
  assert(result.applications[0].found);
  if (process.platform === 'linux') {
    assert.equal(result.applications[0].version_probe, 'completed');
    assert.match(result.applications[0].version, /^v\d+\.\d+\.\d+/);
  }
  assert(result.searched_path_directories <= 64);
});

test('version deadline kills a fixture that ignores graceful termination', { skip: process.platform !== 'linux', timeout: 5000 }, async t => {
  const { manager, home } = await fixture(t);
  const executable = path.join(home, 'version-fixture');
  const pidFile = path.join(home, 'timeout-probe.pid');
  let pid;
  t.after(() => { if (pid) try { process.kill(pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; } });
  await fs.writeFile(executable, `#!${process.execPath}\nrequire('fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));process.on('SIGTERM',()=>{});setInterval(()=>{},1000);\n`, { mode: 0o700 });
  const start = Date.now();
  const pending = manager.probe({ executable, app: 'node', timeout_ms: 250 });
  for (let i = 0; i < 20; i++) { pid = await fs.readFile(pidFile, 'utf8').then(Number).catch(() => null); if (pid) break; await pause(10); }
  const result = await pending;
  assert.equal(result.applications[0].version_probe, 'timed_out');
  assert(Date.now() - start < 2000, 'probe must resolve after killing the unresponsive version process');
});

test('pre-cancelled workspace operations create no storage and dispatch no probes', async t => {
  const { manager, config, project } = await fixture(t, { runVersion: () => assert.fail('must not dispatch') });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(callWorkspaceTool('fecimus_workspace_notes', { action: 'write', project, key: 'stopped', content: 'must not save' }, manager, controller.signal), /cancelled/);
  await assert.rejects(callWorkspaceTool('fecimus_app_probe', { apps: ['node'] }, manager, controller.signal), /cancelled/);
  await assert.rejects(fs.access(config.dataDir), error => error.code === 'ENOENT');
});

test('cancelling a queued mutation preserves both the previous note and the live writer lock', async t => {
  const { manager, project, store } = await fixture(t);
  const first = await manager.notes({ action: 'write', project, key: 'state', content: 'before stop' });
  const filename = path.join(store, '.mutation.lock');
  const owner = JSON.stringify({ pid: process.pid, created_at: new Date().toISOString() });
  await fs.writeFile(filename, owner, { mode: 0o600 });
  const controller = new AbortController();
  const pending = manager.notes({ action: 'write', project, key: 'state', content: 'must not commit', revision: first.revision }, controller.signal);
  const rejected = assert.rejects(pending, /cancel|abort/i);
  await pause(30); controller.abort(); await rejected;
  const record = await manager.notes({ action: 'read', project, key: 'state' });
  assert.equal(record.content, 'before stop'); assert.equal(record.revision, first.revision);
  assert.equal(await fs.readFile(filename, 'utf8'), owner);
});

test('cancellation aborts active probes and prevents later applications from dispatching', { skip: process.platform !== 'linux', timeout: 5000 }, async t => {
  let ready;
  const dispatched = [], started = new Promise(resolve => { ready = resolve; });
  const { manager } = await fixture(t, { runVersion: (command, args, options) => new Promise((resolve, reject) => {
    dispatched.push(command);
    options.signal.addEventListener('abort', () => reject(new Error('fixture aborted')), { once: true });
    if (dispatched.length === 2) ready();
  }) });
  const controller = new AbortController();
  const pending = manager.probe({ apps: ['node', 'git', 'python'] }, controller.signal);
  const rejected = assert.rejects(pending, /cancel|abort/i);
  await started; controller.abort(); await rejected;
  await pause(10);
  assert.equal(dispatched.length, 2);
});

test('cancellation actively kills an in-flight version executable', { skip: process.platform !== 'linux', timeout: 5000 }, async t => {
  const { manager, home } = await fixture(t);
  const executable = path.join(home, 'cancel-version-fixture');
  const pidFile = path.join(home, 'probe.pid');
  await fs.writeFile(executable, `#!${process.execPath}\nrequire('fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));process.on('SIGTERM',()=>{});setInterval(()=>{},1000);\n`, { mode: 0o700 });
  const controller = new AbortController();
  const pending = manager.probe({ executable, app: 'node', timeout_ms: 3000 }, controller.signal);
  const rejected = assert.rejects(pending, /cancel|abort/i);
  let pid;
  t.after(() => { if (pid) try { process.kill(pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; } });
  for (let i = 0; i < 100; i++) { pid = await fs.readFile(pidFile, 'utf8').then(Number).catch(() => undefined); if (pid) break; await pause(10); }
  assert(pid, 'fixture must launch before cancellation');
  controller.abort(); await rejected;
  for (let i = 0; i < 100; i++) { try { process.kill(pid, 0); await pause(10); } catch (error) { assert.equal(error.code, 'ESRCH'); return; } }
  assert.fail('cancelled version executable must exit');
});
