import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { createStudioManager, validateJobInput, readJobLog, studioTools, callStudioTool } from '../src/studio-tools.mjs';
import { createPathGuard } from '../src/file-roots.mjs';
import { inputValidator } from '../src/gateway-core.mjs';
const linux = process.platform === 'linux';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, timeout = 6000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const result = await check(); if (result) return result; await pause(25); }
  throw new Error('Timed out waiting for job test condition.');
}
async function fixture(t, options = {}) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'fecimus-studio-test-'));
  const appHome = path.join(home, 'private'); await fs.mkdir(appHome);
  const env = { ...process.env, FECIMUS_APP_HOME: appHome, FECIMUS_FILE_ROOTS: '[]', DISPLAY: ':987', XAUTHORITY: '/private/auth', DBUS_SESSION_BUS_ADDRESS: 'private-bus' };
  const manager = createStudioManager({ home, env, ...options });
  t.after(async () => { await manager.close(); await fs.rm(home, { recursive: true, force: true }); });
  return { home, appHome, manager, env };
}
const completed = (manager, id) => until(() => {
  const state = manager.status({ job_id: id }); return ['succeeded', 'failed', 'cancelled', 'timed_out'].includes(state.state) && state;
});
async function dead(pid) {
  try {
    if (linux && /\) Z /.test(await fs.readFile(`/proc/${pid}/stat`, 'utf8'))) return true;
    process.kill(pid, 0); return false;
  } catch (error) { if (error.code === 'ESRCH' || error.code === 'ENOENT') return true; throw error; }
}

test('job schemas validate defaults and reject malformed calls without dispatch', async t => {
  const { home } = await fixture(t);
  const guard = createPathGuard({ home, roots: [] });
  const start = inputValidator(studioTools.find(tool => tool.name === 'fecimus_job_start').inputSchema);
  assert.deepEqual(start({ command: 'node', cwd: home }), { command: 'node', cwd: home, args: [], timeout_ms: 900000 });
  assert.throws(() => start({ command: 'node', cwd: home, args: 'bad' }));
  assert.throws(() => validateJobInput({ command: 'node', cwd: home, args: ['\0'] }, guard));
  assert.throws(() => validateJobInput({ command: 'node', cwd: home, args: Array(20).fill('x'.repeat(8192)) }, guard), /64 KiB/);
  assert.throws(() => validateJobInput({ command: 'node', cwd: path.dirname(home) }, guard), /Access denied/);
  assert.throws(() => validateJobInput({ command: 'node', cwd: home, env: { DISPLAY: ':0' } }, guard), /overrides/);
  const file = path.join(home, 'file'); await fs.writeFile(file, 'x');
  assert.throws(() => validateJobInput({ command: 'node', cwd: file }, guard), /directory/);
  assert.equal(validateJobInput({ command: 'node', cwd: home, args: ['a; $(echo nope)'] }, guard).args[0], 'a; $(echo nope)');
});

test('log cursors distinguish dropped history, remaining output and invalid future cursors', () => {
  const job = { logOffset: 100, log: 'abcdefghij' };
  assert.deepEqual(readJobLog(job, { cursor: 0, max_chars: 4 }), {
    output: 'abcd', cursor: 100, next_cursor: 104, log_start: 100, log_end: 110, output_truncated: true, has_more: true
  });
  assert.equal(readJobLog(job, { cursor: 104, max_chars: 4 }).output, 'efgh');
  assert.equal(readJobLog(job, { max_chars: 4 }).output, 'ghij');
  assert.throws(() => readJobLog(job, { cursor: 111 }), /beyond/);
  assert.throws(() => readJobLog(job, { max_chars: 20001 }), /max_chars/);
});

test('actual jobs retain argv, private runtime environment and split Unicode output', { skip: !linux }, async t => {
  const { home, appHome, manager } = await fixture(t);
  const literal = 'a; $(echo should-never-run) "quotes"';
  const code = `console.log(JSON.stringify({arg:process.argv[1],cwd:process.cwd(),home:process.env.HOME,display:process.env.DISPLAY,bus:process.env.DBUS_SESSION_BUS_ADDRESS}));const bytes=Buffer.from('世界');process.stdout.write(bytes.subarray(0,2));setTimeout(()=>process.stdout.write(bytes.subarray(2)),10);`;
  const started = await manager.start({ command: process.execPath, args: ['-e', code, literal], cwd: home });
  const result = await completed(manager, started.job_id);
  assert.equal(result.state, 'succeeded'); assert.equal(result.exit_code, 0);
  assert.equal(result.cpu_nice, Math.min(19, os.getPriority(process.pid) + 5));
  assert(result.output.endsWith('世界'));
  assert.deepEqual(JSON.parse(result.output.split('\n')[0]), { arg: literal, cwd: home, home: appHome, display: ':987', bus: 'private-bus' });
  assert.equal(manager.status().active, 0);
  assert.equal(JSON.parse((await callStudioTool('fecimus_job_status', { job_id: started.job_id }, manager)).content[0].text).job_id, started.job_id);
});

test('long jobs return quickly, enforce concurrency, and cancel without replay', { skip: !linux }, async t => {
  const { home, manager } = await fixture(t, { maxConcurrent: 1 });
  const marker = path.join(home, 'dispatches');
  const before = Date.now();
  const job = await manager.start({ command: process.execPath, args: ['-e', `require('fs').appendFileSync(${JSON.stringify(marker)},'x');setInterval(()=>{},1000)`], cwd: home });
  assert(Date.now() - before < 1500, 'launch returns before job completion');
  assert.equal(job.state, 'running');
  await assert.rejects(manager.start({ command: process.execPath, cwd: home }), /slots/);
  await until(() => fs.readFile(marker, 'utf8').then(value => value === 'x').catch(() => false));
  assert.equal(manager.cancel(job.job_id).state, 'cancelling');
  assert.equal((await completed(manager, job.job_id)).state, 'cancelled');
  assert.equal(await fs.readFile(marker, 'utf8'), 'x');
  assert.equal(manager.cancel(job.job_id).state, 'cancelled');
});

test('timeout terminates a child that ignores SIGTERM and reports timed_out', { skip: !linux }, async t => {
  const { home, manager } = await fixture(t);
  const childFile = path.join(home, 'descendant.pid');
  const inner = `require('fs').writeFileSync(${JSON.stringify(childFile)},String(process.pid));process.on('SIGTERM',()=>{});setInterval(()=>{},1000)`;
  const outer = `require('child_process').spawn(process.execPath,['-e',${JSON.stringify(inner)}],{stdio:'ignore'});setInterval(()=>{},1000)`;
  const job = await manager.start({ command: process.execPath, args: ['-e', outer], cwd: home, timeout_ms: 1000 });
  const pid = Number(await until(() => fs.readFile(childFile, 'utf8').catch(() => false)));
  const result = await completed(manager, job.job_id);
  assert.equal(result.state, 'timed_out'); assert.equal(result.stop_reason, 'timeout');
  assert.equal((await callStudioTool('fecimus_job_status', { job_id: job.job_id }, manager)).isError, true);
  await until(() => dead(pid));
});

test('finishing the leader also cleans its lingering process group', { skip: !linux }, async t => {
  const { home, manager } = await fixture(t);
  const pidFile = path.join(home, 'lingering.pid');
  const inner = `require('fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));process.on('SIGTERM',()=>{});setInterval(()=>{},1000)`;
  const code = `require('child_process').spawn(process.execPath,['-e',${JSON.stringify(inner)}],{stdio:'ignore'});setTimeout(()=>process.exit(0),200)`;
  const job = await manager.start({ command: process.execPath, args: ['-e', code], cwd: home });
  const pid = Number(await until(() => fs.readFile(pidFile, 'utf8').catch(() => false)));
  assert.equal((await completed(manager, job.job_id)).state, 'succeeded');
  await until(() => dead(pid));
});

test('bounded output/history, nonzero exit and missing executable are explicit', { skip: !linux }, async t => {
  const { home, manager } = await fixture(t, { maxConcurrent: 1, maxHistory: 2, maxLogChars: 1024 });
  const noisy = await manager.start({ command: process.execPath, args: ['-e', "process.stdout.write('x'.repeat(10000));process.stderr.write('END');process.exitCode=7"], cwd: home });
  const noise = await completed(manager, noisy.job_id);
  assert.equal(noise.state, 'failed'); assert.equal(noise.exit_code, 7);
  assert(noise.output.length <= 1024); assert(noise.output_truncated); assert(noise.log_start > 0);
  const missing = await manager.start({ command: 'fecimus-nonexistent-test-executable-1234', cwd: home });
  const failure = await completed(manager, missing.job_id);
  assert.equal(failure.state, 'failed'); assert.match(failure.error, /No such file/);
  const third = await manager.start({ command: process.execPath, args: ['-e', ''], cwd: home });
  await completed(manager, third.job_id);
  assert.equal(manager.status().jobs.length, 2);
  assert.throws(() => manager.status({ job_id: noisy.job_id }), /expired/);
});

test('abort before dispatch, runtime health and shutdown prevent stray work', { skip: !linux }, async t => {
  let healthy = true;
  const { home, manager } = await fixture(t, { runtimeStatus: () => ({ healthy }) });
  const abort = new AbortController(); abort.abort();
  await assert.rejects(manager.start({ command: process.execPath, cwd: home }, abort.signal), /before job dispatch/);
  assert.equal(manager.status().jobs.length, 0);
  healthy = false;
  await assert.rejects(manager.start({ command: process.execPath, cwd: home }), /not dispatched/);
  healthy = true;
  const job = await manager.start({ command: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'], cwd: home });
  healthy = false;
  const result = await completed(manager, job.job_id);
  assert.equal(result.state, 'cancelled'); assert.equal(result.stop_reason, 'private runtime unavailable');
  await manager.close();
  await assert.rejects(manager.start({ command: process.execPath, cwd: home }), /closed/);
});

test('abrupt Fecimus parent death cleans job and descendant processes', { skip: !linux }, async t => {
  const { home, env } = await fixture(t);
  const moduleURL = pathToFileURL(path.resolve('src/studio-tools.mjs')).href;
  const pidFile = path.join(home, 'orphan.pid');
  const descendantFile = path.join(home, 'orphan-descendant.pid');
  const descendant = `require('fs').writeFileSync(${JSON.stringify(descendantFile)},String(process.pid));process.on('SIGTERM',()=>{});setInterval(()=>{},1000)`;
  const worker = `require('fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));require('child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'ignore'});process.on('SIGTERM',()=>{});setInterval(()=>{},1000)`;
  const script = `import {createStudioManager} from ${JSON.stringify(moduleURL)};const m=createStudioManager({home:${JSON.stringify(home)}});await m.start({command:process.execPath,args:['-e',${JSON.stringify(worker)}],cwd:${JSON.stringify(home)}});console.log('ready');setInterval(()=>{},1000);`;
  const parent = spawn(process.execPath, ['--input-type=module', '-e', script], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; parent.stdout.on('data', buffer => { output += buffer; });
  t.after(() => parent.kill('SIGKILL'));
  await until(() => output.includes('ready'));
  const pid = Number(await until(() => fs.readFile(pidFile, 'utf8').catch(() => false)));
  const descendantPid = Number(await until(() => fs.readFile(descendantFile, 'utf8').catch(() => false)));
  parent.kill('SIGKILL');
  await until(() => dead(pid));
  await until(() => dead(descendantPid));
});


test('unexpected supervisor death cleans the surviving command group', { skip: !linux }, async t => {
  const { home, manager } = await fixture(t);
  const job = await manager.start({ command: process.execPath, args: ['-e', 'console.log(process.pid);setInterval(()=>{},1000)'], cwd: home });
  const workerPid = Number(await until(() => manager.status({ job_id: job.job_id }).output.trim()));
  const stat = await fs.readFile(`/proc/${workerPid}/stat`, 'utf8');
  const supervisorPid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
  process.kill(supervisorPid, 'SIGKILL');
  assert.equal((await completed(manager, job.job_id)).state, 'failed');
  await until(() => dead(workerPid));
});


test('supervisor startup failure reports failed and an MCP error, not cancellation', { skip: !linux }, async t => {
  const { home, env } = await fixture(t);
  const bin = path.join(home, 'bin'); await fs.mkdir(bin);
  await fs.writeFile(path.join(bin, 'python3'), `#!${process.execPath}\nrequire('fs').writeSync(3,'invalid-json\\n');setInterval(()=>{},1000);`, { mode: 0o700 });
  const manager = createStudioManager({ home, env: { ...env, PATH: bin + path.delimiter + env.PATH } });
  t.after(() => manager.close());
  const result = await callStudioTool('fecimus_job_start', { command: process.execPath, cwd: home }, manager);
  assert.equal(result.isError, true);
  const job = JSON.parse(result.content[0].text);
  assert.equal(job.state, 'failed');
  assert.equal(job.stop_reason, 'startup failure');
  assert.match(job.error, /Invalid supervisor startup response/);
});


test('startup timeout waits for bounded cleanup and returns an MCP failure', { skip: !linux }, async t => {
  const { home, env } = await fixture(t);
  const bin = path.join(home, 'slow-bin'); await fs.mkdir(bin);
  await fs.writeFile(path.join(bin, 'python3'), `#!${process.execPath}\nsetInterval(()=>{},1000);`, { mode: 0o700 });
  const manager = createStudioManager({ home, env: { ...env, PATH: bin + path.delimiter + env.PATH } });
  t.after(() => manager.close());
  const result = await callStudioTool('fecimus_job_start', { command: process.execPath, cwd: home }, manager);
  assert.equal(result.isError, true);
  const job = JSON.parse(result.content[0].text);
  assert.equal(job.state, 'failed');
  assert.equal(job.stop_reason, 'startup failure');
  assert.match(job.error, /startup exceeded 5 seconds/);
  assert.equal(manager.status().active, 0);
});
