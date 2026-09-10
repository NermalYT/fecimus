import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// Every process inspected or stopped belongs to this disposable test. Browser
// sessions are headless; the native fixture only starts a private X display.
const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'fecimus-lifecycle-'));
const profileRoot = path.join(temporary, 'profiles');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = [];
const textOf = result => result.content?.filter(c => c.type === 'text').map(c => c.text).join('\n') || '';

async function processInfo(pid) {
  try {
    const stat = await fs.readFile(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/);
    return { pid: Number(pid), state: fields[0], ppid: Number(fields[1]), group: Number(fields[2]), start: fields[19] };
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ESRCH') return null;
    throw error;
  }
}
async function processes() {
  const entries = (await fs.readdir('/proc')).filter(name => /^\d+$/.test(name));
  return (await Promise.all(entries.map(processInfo))).filter(Boolean);
}
const running = proc => proc && proc.state !== 'Z' && proc.state !== 'X';
async function waitFor(fn, label, timeout = 10000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try { const result = await fn(); if (result) return result; } catch (error) { lastError = error; }
    await pause(50);
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`);
}
async function dead(owned) {
  const current = await processInfo(owned.pid);
  return !running(current) || current.start !== owned.start;
}
async function stopOwned(owned) {
  if (owned && !(await dead(owned))) {
    try { process.kill(owned.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
}
function firstLine(child) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => finish(new Error('Runtime readiness timeout')), 20000);
    const onExit = (code, signal) => finish(new Error(`Runtime parent exited before readiness (${code ?? signal})`));
    const onError = error => finish(error);
    const onData = data => {
      buffer += data;
      if (buffer.includes('\n')) finish(null, buffer.split('\n')[0]);
    };
    function finish(error, line) {
      clearTimeout(timer);
      child.off('error', onError); child.off('exit', onExit); child.stdout.off('data', onData);
      if (error) reject(error); else resolve(line);
    }
    child.once('error', onError); child.once('exit', onExit); child.stdout.on('data', onData);
  });
}

async function testRuntimeParentDeath() {
  const code = `
    import path from 'node:path';
    import { startRuntime } from ${JSON.stringify(pathToFileURL(path.join(base, 'runtime.mjs')).href)};
    const runtime = await startRuntime(${JSON.stringify(base)}, { desktop: { width: 800, height: 600 } });
    console.log(JSON.stringify({ ...runtime.status(), directory: path.dirname(runtime.env.XAUTHORITY) }));
    setInterval(() => {}, 1000);
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '', directory, owned = [];
  child.stderr.on('data', data => { stderr = (stderr + data).slice(-3000); });
  try {
    const status = JSON.parse(await firstLine(child).catch(error => { error.message += stderr ? `: ${stderr}` : ''; throw error; }));
    directory = status.directory;
    assert.equal(status.mode, 'isolated'); assert(status.healthy);
    if (process.env.DISPLAY) assert.notEqual(status.display.split('.')[0], process.env.DISPLAY.split('.')[0]);
    assert.equal(status.processes.length, 3, 'expected Xvfb, session bus, and window manager');
    owned = await Promise.all(status.processes.map(processInfo));
    assert(owned.every(proc => running(proc) && proc.ppid === child.pid), 'runtime children must belong to test parent');
    const identities = await Promise.all(owned.map(async proc => path.basename((await fs.readFile(`/proc/${proc.pid}/cmdline`, 'utf8')).split('\0')[0])));
    assert.deepEqual(identities, ['Xvfb', 'dbus-daemon', 'xfwm4']);
    child.kill('SIGKILL');
    await waitFor(async () => (await Promise.all(owned.map(dead))).every(Boolean), 'parent-death termination').catch(async error => {
      error.message += `: ${JSON.stringify(await Promise.all(owned.map(async (proc, index) => ({ command: identities[index], current: await processInfo(proc.pid) }))))}`;
      throw error;
    });
    report.push({ check: 'SIGKILL parent terminates private Xvfb, bus, and window manager', display: status.display, passed: true });
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await Promise.all(owned.map(stopOwned));
    if (directory) {
      assert(path.dirname(directory) === os.tmpdir() && path.basename(directory).startsWith('fecimus-display-'));
      await fs.rm(directory, { recursive: true, force: true });
    }
  }
}

const httpServer = http.createServer((request, response) => {
  const label = request.url === '/second' ? 'second' : request.url === '/third' ? 'third' : 'first';
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end(`<!doctype html><title>Fecimus lifecycle ${label}</title><h1>Independent ${label} session</h1>`);
});
await new Promise((resolve, reject) => { httpServer.once('error', reject); httpServer.listen(0, '127.0.0.1', resolve); });
const origin = `http://127.0.0.1:${httpServer.address().port}`;

async function testBrowserLeases() {
  const sessions = [];
  const browserPids = [];
  const groups = new Set();
  const open = async label => {
    const client = new Client({ name: `fecimus-lifecycle-${label}`, version: '1.0.0' });
    const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(base, 'start-browser.mjs')], env: { ...process.env, FECIMUS_BROWSER_PROFILE: profileRoot }, stderr: 'pipe' });
    const session = { client, transport, label, closed: false };
    sessions.push(session);
    await client.connect(transport, { timeout: 20000 });
    const result = await client.callTool({ name: 'browser_navigate', arguments: { url: `${origin}/${label}` } }, undefined, { timeout: 20000 });
    assert(!result.isError, `browser ${label} navigation: ${textOf(result)}`);
    return session;
  };
  const snapshot = async session => {
    const result = await session.client.callTool({ name: 'browser_snapshot', arguments: {} });
    assert(!result.isError, `browser ${session.label} snapshot: ${textOf(result)}`);
    return textOf(result);
  };
  const close = async session => { if (!session.closed) { await session.client.close(); session.closed = true; } };
  const inspectLease = async slot => {
    const profile = path.join(profileRoot, `session-${slot}`);
    const lock = await fs.readlink(path.join(profile, 'SingletonLock'));
    const pid = Number(lock.split('-').at(-1));
    assert(Number.isInteger(pid) && pid > 1);
    const browser = await processInfo(pid);
    assert(running(browser));
    // Chromium may rewrite its process title as one space-separated argv item.
    // These test-owned temporary paths contain no spaces.
    const args = (await fs.readFile(`/proc/${pid}/cmdline`, 'utf8')).split(/[\0\s]+/);
    const profileArgs = args.filter((arg, index) => arg.startsWith('--user-data-dir') || args[index - 1] === '--user-data-dir');
    assert(args.includes(`--user-data-dir=${profile}`) || args[args.indexOf('--user-data-dir') + 1] === profile,
      `browser command must own ${profile}; lock PID ${pid}, command ${path.basename(args[0])}, state ${browser.state}; profile arguments: ${JSON.stringify(profileArgs)}`);
    assert(args.some(arg => arg.startsWith('--headless')), 'browser must remain headless');
    browserPids.push(browser); groups.add(browser.group);
    return browser;
  };
  const assertClosed = async owned => {
    await waitFor(async () => (await Promise.all(owned.map(dead))).every(Boolean), 'leased browsers to terminate');
    await waitFor(async () => (await processes()).every(proc => !groups.has(proc.group) || !running(proc)), 'owned browser process groups to terminate');
  };
  try {
    const [first, second] = await Promise.all([open('first'), open('second')]);
    const owned = await Promise.all([inspectLease(0), inspectLease(1)]);
    assert.notEqual(owned[0].pid, owned[1].pid, 'concurrent sessions share a browser');
    assert.notEqual(owned[0].group, owned[1].group, 'concurrent sessions share a process group');
    const snapshots = await Promise.all([snapshot(first), snapshot(second)]);
    assert(snapshots[0].includes('Independent first session') && !snapshots[0].includes('Independent second session'));
    assert(snapshots[1].includes('Independent second session') && !snapshots[1].includes('Independent first session'));
    await Promise.all([close(first), close(second)]);
    await assertClosed(owned);
    const third = await open('third');
    const reused = await inspectLease(0);
    assert(await dead(owned[0])); assert(await dead(owned[1]));
    assert((await snapshot(third)).includes('Independent third session'));
    await close(third);
    await assertClosed([reused]);
    report.push({ check: 'concurrent headless sessions lease distinct profiles, clean process groups, and reuse slot 0', slots: [0, 1, 0], passed: true });
  } finally {
    await Promise.allSettled(sessions.map(close));
    // Emergency cleanup affects only groups proven to own this test's profiles.
    for (const group of groups) {
      const members = (await processes()).filter(proc => proc.group === group && running(proc));
      await Promise.all(members.map(stopOwned));
    }
    await Promise.all(browserPids.map(stopOwned));
  }
}

const results = await Promise.allSettled([testRuntimeParentDeath(), testBrowserLeases()]);
await new Promise(resolve => httpServer.close(resolve));
await fs.rm(temporary, { recursive: true, force: true });
const errors = results.filter(result => result.status === 'rejected').map(result => result.reason.stack || String(result.reason));
console.log(JSON.stringify({ passed: !errors.length, checks: report, ...(errors.length ? { errors } : {}) }, null, 2));
if (errors.length) process.exitCode = 1;
