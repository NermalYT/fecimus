import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// Uses only a disposable private X display, browser profile, and directory.
// A unique temporary desktop entry exercises the real application launcher.
// Host X11 commands below are strictly read-only; user movement is recorded,
// never treated as failure or undone by the test.
const exec = promisify(execFile);
const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
const temporary = await fs.mkdtemp(path.join(os.homedir(), '.fecimus-integration-'));
const shellQuote = value => `'${String(value).replaceAll("'", "'\\''")}'`;
const desktopQuote = value => '"' + String(value).replace(/[\\"`$]/g, '\\$&').replaceAll('\\', '\\\\') + '"';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = [];
const textOf = result => (result.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
const jsonOf = result => result.structuredContent ?? JSON.parse(textOf(result));
const client = new Client({ name: 'fecimus-integration', version: '2.0.0' });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [process.env.FECIMUS_SERVER_MODULE || path.join(base, 'server.mjs')],
  env: { ...process.env, FECIMUS_TOOL_MODE: 'full', FECIMUS_BROWSER_PROFILE: path.join(temporary, 'browser-profile') },
  stderr: 'pipe',
});
transport.stderr?.on('data', data => process.stderr.write(data));
let fixturePid, fixtureWindow, tools, runtimePids = [], connected = false, desktopCreated = false;
const fixtureTitle = `Fecimus integration ${path.basename(temporary)}`;
const desktopPath = path.join(os.homedir(), '.local/share/applications', `fecimus-integration-${path.basename(temporary)}.desktop`);
const marker = `offscreen-${path.basename(temporary)}`;
const httpServer = http.createServer((request, response) => {
  if (request.url === '/broken') { request.socket.destroy(); return; }
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  const second = request.url === '/second';
  response.end(`<!doctype html><html><head><title>Fecimus ${second ? 'second' : 'first'} fixture</title></head><body>
    <main><h1>${second ? 'Second tab content' : 'Fecimus browser fixture'}</h1>
    <label>Test input <input id="test-input" aria-label="Test input"></label>
    <button id="test-button" onclick="document.querySelector('#output').textContent='clicked:'+document.querySelector('#test-input').value">Commit fixture</button>
    <p id="output">untouched</p><a href="/second">Fixture second page</a>
    <div style="height:3100px">Tall content</div><p id="offscreen">${marker}${second ? '-second' : '-first'}</p>
    </main></body></html>`);
});
await new Promise((resolve, reject) => { httpServer.once('error', reject); httpServer.listen(0, '127.0.0.1', resolve); });
const origin = `http://127.0.0.1:${httpServer.address().port}`;

async function call(name, args = {}, { allowError = false, timeout = 90000 } = {}) {
  const started = performance.now();
  const result = await client.callTool({ name, arguments: args }, undefined, { timeout });
  if (!allowError) assert(!result.isError, `${name}: ${textOf(result).slice(0, 3000)}`);
  report.push({ tool: name, passed: allowError ? undefined : true, ms: Math.round(performance.now() - started) });
  return result;
}
async function shell(command) {
  const result = jsonOf(await call('shell_run', { command, cwd: temporary, timeout_seconds: 30 }));
  assert.equal(result.exit_code, 0, `shell: ${result.stderr}`);
  assert(!result.timed_out, 'shell timed out');
  return result;
}
async function hostState() {
  const values = await Promise.allSettled([
    exec('xdotool', ['getmouselocation', '--shell'], { timeout: 2000 }),
    exec('xdotool', ['getactivewindow'], { timeout: 2000 }),
    exec('wmctrl', ['-l'], { timeout: 2000 }),
  ]);
  return { display: process.env.DISPLAY, pointer: values[0].value?.stdout.trim(), active_window: values[1].value?.stdout.trim(), windows: values[2].value?.stdout || '' };
}
async function waitFor(fn, label) {
  let last;
  for (let i = 0; i < 40; i++) {
    try { const result = await fn(); if (result) return result; } catch (error) { last = error; }
    await pause(100);
  }
  throw new Error(`Timed out waiting for ${label}${last ? ': ' + last.message : ''}`);
}
function pngSize(data) {
  const bytes = Buffer.from(data, 'base64');
  assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}
function findRef(snapshot, role, label) {
  const line = snapshot.split('\n').find(line => line.includes(role) && line.includes(label) && /\[ref=[^\]]+\]/.test(line));
  assert(line, `No ${role} ${label} in snapshot:\n${snapshot.slice(-2500)}`);
  return line.match(/\[ref=([^\]]+)\]/)[1];
}

const nativeSource = String.raw`
#include <X11/Xlib.h>
#include <X11/Xutil.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
int main(int argc, char **argv) {
  if (argc != 3) return 2;
  Display *d = XOpenDisplay(NULL); if (!d) return 3;
  int s = DefaultScreen(d), count = 0; char keys[1024] = "";
  Window w = XCreateSimpleWindow(d, RootWindow(d,s), 40,40,420,200,1,BlackPixel(d,s),WhitePixel(d,s));
  XStoreName(d,w,argv[1]);
  XClassHint hint = { "fecimus-integration", "FecimusIntegration" }; XSetClassHint(d,w,&hint);
  XSelectInput(d,w,ExposureMask|KeyPressMask|ButtonPressMask|StructureNotifyMask);
  Atom deletion = XInternAtom(d,"WM_DELETE_WINDOW",False); XSetWMProtocols(d,w,&deletion,1);
  XMapWindow(d,w); XFlush(d);
  GC gc = XCreateGC(d,w,0,NULL); XSetForeground(d,gc,BlackPixel(d,s));
  while (1) {
    XEvent e; XNextEvent(d,&e);
    if (e.type == ClientMessage && (Atom)e.xclient.data.l[0] == deletion) break;
    if (e.type == KeyPress) {
      char b[64]; KeySym sym; int n = XLookupString(&e.xkey,b,sizeof b,&sym,NULL);
      if (n>0 && strlen(keys)+(size_t)n<sizeof keys) strncat(keys,b,n);
    }
    if (e.type == ButtonPress) count++;
    char rendered[1200]; snprintf(rendered,sizeof rendered,"Clicks: %d; typed: %s",count,keys);
    XClearWindow(d,w); XDrawString(d,w,gc,20,60,rendered,strlen(rendered)); XFlush(d);
    char out[4096]; snprintf(out,sizeof out,"%s.tmp",argv[2]);
    FILE *f=fopen(out,"w"); if(f) {
      fprintf(f,"PID:%ld\nWINDOW:%lu\nCLICKS:%d\nKEYS:%s\n",(long)getpid(),w,count,keys);
      const char *names[] = { "DISPLAY", "HOME", "FECIMUS_APP_HOME", "XDG_RUNTIME_DIR", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME" };
      for (unsigned i=0; i<sizeof(names)/sizeof(names[0]); i++) fprintf(f,"%s:%s\n",names[i],getenv(names[i]) ? getenv(names[i]) : "");
      fclose(f); rename(out,argv[2]);
    }
  }
  XDestroyWindow(d,w); XCloseDisplay(d); return 0;
}
`;

let finalError;
const hostBefore = await hostState();
try {
  const started = performance.now();
  await client.connect(transport, { timeout: 60000 }); connected = true;
  tools = (await client.listTools()).tools;
  assert.equal(new Set(tools.map(t => t.name)).size, tools.length, 'tool names must be unique');
  const status = jsonOf(await call('fecimus_status'));
  assert(!Array.isArray(status), 'Requires Fecimus server v2 (refusing desktop actions under v1)');
  assert.equal(status.runtime.mode, 'isolated');
  assert(status.runtime.healthy, 'private desktop unhealthy');
  if (process.env.DISPLAY) assert.notEqual(status.runtime.display.split('.')[0], process.env.DISPLAY.split('.')[0], 'never automate physical display');
  runtimePids = status.runtime.processes || [];
  assert.equal(status.backends.length, 6);
  assert(status.backends.every(p => p.connected && p.tools > 0), 'all six original backends must connect');
  report.push({ check: 'discovery and isolated runtime', tools: tools.length, display: status.runtime.display, startup_ms: Math.round(performance.now() - started), passed: true });

  const display = jsonOf(await call('display_size'));
  assert.equal(display.width, status.runtime.width); assert.equal(display.height, status.runtime.height);
  const envResult = await shell('python3 -c ' + shellQuote('import json, os; print(json.dumps({k: os.environ.get(k) for k in ["DISPLAY", "HOME", "FECIMUS_APP_HOME", "XDG_RUNTIME_DIR", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME"]}))'));
  const privateEnv = JSON.parse(envResult.stdout);
  assert.equal(privateEnv.DISPLAY, status.runtime.display);
  assert.equal(privateEnv.HOME, os.homedir(), 'shell must retain the real home');
  const appHome = path.join(process.env.FECIMUS_DATA_DIR || path.join(os.homedir(), '.local/share/fecimus'), 'app-homes', `display-${status.runtime.display.slice(1)}`);
  assert.equal(privateEnv.FECIMUS_APP_HOME, appHome);
  assert.notEqual(appHome, os.homedir(), 'application home must be private');
  for (const [key, relative] of Object.entries({ XDG_CONFIG_HOME: '.config', XDG_CACHE_HOME: '.cache', XDG_DATA_HOME: '.local/share', XDG_STATE_HOME: '.local/state' })) {
    assert.equal(privateEnv[key], path.join(appHome, relative), `${key} must be private`);
  }
  assert(privateEnv.XDG_RUNTIME_DIR && privateEnv.XDG_RUNTIME_DIR !== process.env.XDG_RUNTIME_DIR, 'XDG runtime must be private');
  const file = path.join(temporary, 'roundtrip.txt');
  await call('filesystem_write_text', { path: file, content: 'Fecimus file roundtrip — Ω\n' });
  assert.equal(jsonOf(await call('filesystem_read_text', { path: file })).content, 'Fecimus file roundtrip — Ω\n');
  await call('filesystem_stat', { path: file });
  assert((await call('filesystem_trash', { path: os.homedir() }, { allowError: true })).isError, 'file roots must not be trashed');
  const nativePath = path.join(temporary, 'fixture.c');
  await fs.writeFile(nativePath, nativeSource);
  await shell('cc fixture.c -o fixture -lX11');
  const statePath = path.join(temporary, 'native-state.txt');
  await fs.mkdir(path.dirname(desktopPath), { recursive: true });
  await fs.writeFile(desktopPath, `[Desktop Entry]\nType=Application\nName=${fixtureTitle}\nExec=${[path.join(temporary, 'fixture'), fixtureTitle, statePath].map(desktopQuote).join(' ')}\nTerminal=false\nStartupNotify=false\n`, { flag: 'wx', mode: 0o600 });
  desktopCreated = true;
  const launched = jsonOf(await call('application_launch', { desktop_id: path.basename(desktopPath), wait_ms: 1800 }));
  assert.equal(launched.started, true);
  assert.equal(launched.window_observed, true, 'launcher must observe the fixture window');
  const initialState = await waitFor(() => fs.readFile(statePath, 'utf8'), 'launched fixture environment');
  fixturePid = Number(initialState.match(/^PID:(\d+)$/m)?.[1]);
  assert(Number.isInteger(fixturePid) && fixturePid > 1);
  for (const [key, value] of Object.entries({ ...privateEnv, HOME: appHome })) {
    assert(initialState.includes(`${key}:${value}\n`), `launched fixture must independently report private ${key}`);
  }
  fixtureWindow = await waitFor(async () => jsonOf(await call('window_list', { query: fixtureTitle })).windows[0], 'native fixture window');
  assert(fixtureWindow.wm_class.toLowerCase().includes('fecimusintegration'), 'wmctrl class must not be swapped with hostname');
  assert(launched.new_windows.some(window => window.id === fixtureWindow.id), 'launcher must report the fixture window');
  assert(!(await hostState()).windows.includes(fixtureTitle), 'private window leaked onto physical display');
  await call('window_focus', { window_id: fixtureWindow.id });
  const geometry = jsonOf(await call('window_geometry', { window_id: fixtureWindow.id }));
  assert.equal(geometry.width, 420); assert.equal(geometry.height, 200);
  const active = jsonOf(await call('window_active')).active_window;
  assert.equal(parseInt(active.id, 16), parseInt(fixtureWindow.id, 16));
  await call('mouse_move', { x: geometry.center_x, y: geometry.center_y, duration_ms: 0 });
  const pointer = jsonOf(await call('mouse_position'));
  assert.equal(pointer.x, geometry.center_x); assert.equal(pointer.y, geometry.center_y);
  await call('mouse_click'); // Exercise backend/gateway default application.
  await call('keyboard_type_text', { text: 'FecimusNative42', interval_ms: 0 });
  const nativeState = await waitFor(async () => {
    const state = await fs.readFile(statePath, 'utf8');
    return state.includes('CLICKS:1\n') && state.includes('KEYS:FecimusNative42\n') ? state : null;
  }, 'independent native mouse and typing');
  assert(nativeState.includes(`DISPLAY:${status.runtime.display}\n`));
  const screen = await call('desktop_screenshot');
  assert(screen.content.some(c => c.type === 'image' && c.data.length > 500), 'desktop screenshot must include pixels');
  const invalid = await call('keyboard_press_key', { key: 123 }, { allowError: true }); assert(invalid.isError);
  const outside = await call('mouse_move', { x: -1, y: -1 }, { allowError: true }); assert(outside.isError);
  assert.deepEqual(jsonOf(await call('mouse_position')), pointer, 'invalid move changed private pointer');
  const invalidWindow = await call('window_geometry', { window_id: 'no-such-window' }, { allowError: true }); assert(invalidWindow.isError);
  const unknown = await call('no_such_fecimus_tool', {}, { allowError: true }); assert(unknown.isError);
  report.push({ check: 'application launch, private HOME/XDG/display, native window, independent cursor/keyboard, screenshot, defaults and validation', passed: true });

  if (process.env.FECIMUS_BENCHMARK_CORE_ONLY !== '1') {
    const observed = jsonOf(await call('fecimus_desktop_state', { screenshot: false }));
    assert.equal(observed.completed, 3); assert(!observed.stopped);
    assert(observed.results.find(row => row.tool === 'window_list').result.windows.some(w => w.id === fixtureWindow.id));
    const batch = await call('fecimus_desktop_actions', { steps: [
      { tool: 'window_focus', arguments: { window_id: fixtureWindow.id } },
      { tool: 'keyboard_type_text', arguments: { text: 'Batch', interval_ms: 0 } },
      { tool: 'mouse_click' }
    ] });
    assert.equal(JSON.parse(batch.content.find(c => c.type === 'text').text).completed, 4);
    assert(batch.content.some(c => c.type === 'image'), 'batch must return verification screenshot');
    await waitFor(async () => {
      const state = await fs.readFile(statePath, 'utf8');
      return state.includes('CLICKS:2\n') && state.includes('KEYS:FecimusNative42Batch\n');
    }, 'grouped native actions');
    const invalidBatch = await call('fecimus_desktop_actions', { steps: [
      { tool: 'keyboard_type_text', arguments: { text: 'MUST_NOT_RUN', interval_ms: 0 } },
      { tool: 'mouse_move', arguments: { x: 'invalid', y: 0 } }
    ], screenshot: false }, { allowError: true });
    assert(invalidBatch.isError); assert.equal(jsonOf(invalidBatch).completed, 0);
    assert(!(await fs.readFile(statePath, 'utf8')).includes('MUST_NOT_RUN'));
    const literal = 'literal ; $(not-a-command) " spaced Ω';
    const job = jsonOf(await call('fecimus_job_start', { command: process.execPath, cwd: temporary, args: ['-e',
      'require("node:fs").writeFileSync("job-artifact.txt",process.argv[1]); setTimeout(()=>console.log("fixture-job-done"),250)', literal], timeout_ms: 5000 }));
    assert(job.job_id); await call('fecimus_desktop_state', { screenshot: false });
    const finished = await waitFor(async () => {
      const state = jsonOf(await call('fecimus_job_status', { job_id: job.job_id }));
      return state.state === 'succeeded' ? state : null;
    }, 'nonblocking studio command completion');
    assert.equal(finished.exit_code, 0); assert(finished.output.includes('fixture-job-done'));
    assert.equal(await fs.readFile(path.join(temporary, 'job-artifact.txt'), 'utf8'), literal);
    assert.equal((await call('fecimus_job_start', { command: 'fecimus-no-such-executable', cwd: temporary }, { allowError: true })).isError, true);
    report.push({ check: 'atomic desktop observation/actions, invalid batch no-dispatch and asynchronous studio artifact', passed: true });
  }

  const navigation = await call('browser_navigate', { url: origin + '/first' });
  // Fecimus includes automatic snapshots inline so navigation supplies usable refs.
  const snapshot = textOf(navigation);
  assert(snapshot.includes('[ref='), 'automatic snapshot must include inline refs');
  await call('browser_type', { element: 'Test input', target: findRef(snapshot, 'textbox', 'Test input'), text: 'Background42' });
  const updated = textOf(await call('browser_snapshot'));
  await call('browser_click', { element: 'Commit fixture', target: findRef(updated, 'button', 'Commit fixture') });
  const afterClick = textOf(await call('browser_snapshot'));
  assert(afterClick.includes('clicked:Background42'), 'browser click/type did not update page');
  const shotArgs = { type: 'png', fullPage: true };
  const shot = await call('browser_take_screenshot', shotArgs);
  const shotImage = shot.content.find(c => c.type === 'image');
  assert(shotImage, 'full-page browser screenshot must return image');
  const dimensions = pngSize(shotImage.data);
  assert(dimensions.height > 3000, `full-page screenshot too short: ${dimensions.height}`);
  await call('browser_tabs', { action: 'new' });
  await call('browser_navigate', { url: origin + '/second' });
  const read = jsonOf(await call('browser_read_tabs', { tabs: 'all', content: 'body', max_chars: 10000 }));
  assert(read.succeeded >= 2 && !read.failed, 'all hidden and current tabs must be readable');
  assert(read.pages.some(p => p.text?.includes(marker + '-first') && p.text.includes('clicked:Background42')));
  assert(read.pages.some(p => p.text?.includes(marker + '-second')));
  assert(read.pages.filter(p => p.text?.includes(marker)).every(p => p.document_height > p.viewport_height));
  const scrape = jsonOf(await call('browser_scrape', { urls: [origin + '/first', origin + '/broken', origin + '/second'], content: 'body', timeout_ms: 3000 }));
  assert.equal(scrape.succeeded, 2); assert.equal(scrape.failed, 1); assert(scrape.partial);
  assert(scrape.pages.find(p => p.requested_url === origin + '/broken')?.error);
  assert(scrape.pages.find(p => p.requested_url === origin + '/second')?.text.includes(marker + '-second'));
  const remaining = jsonOf(await call('browser_read_tabs', { tabs: 'all', content: 'body' }));
  assert.equal(remaining.total_tabs, read.total_tabs, 'scrape leaked browser tabs');
  assert.equal(remaining.pages.find(p => p.url === origin + '/first')?.text.includes('clicked:Background42'), true, 'scrape changed existing tab state');
  report.push({ check: 'background browser input, full-page capture, inactive tabs, parallel scraping and partial errors', screenshot: dimensions, passed: true });
  await call('window_close', { window_id: fixtureWindow.id }); fixtureWindow = null;
  if (process.env.FECIMUS_BENCHMARK_CORE_ONLY !== '1') {
    const explicit = jsonOf(await call('application_launch', { executable: path.join(temporary, 'fixture'), args: [fixtureTitle, statePath], cwd: temporary, wait_ms: 3000 }));
    assert(explicit.started && explicit.window_observed, 'explicit executable must open a private window');
    fixtureWindow = explicit.new_windows.find(w => w.title === fixtureTitle);
    assert(fixtureWindow); await call('window_close', { window_id: fixtureWindow.id }); fixtureWindow = null;
  }
  await call('browser_close');
  const hostAfter = await hostState();
  assert(!hostAfter.windows.includes(fixtureTitle));
  report.push({ check: 'physical desktop observed only; user input never restored or moved', before: { display: hostBefore.display, pointer: hostBefore.pointer, active_window: hostBefore.active_window }, after: { display: hostAfter.display, pointer: hostAfter.pointer, active_window: hostAfter.active_window }, passed: true });
} catch (error) {
  finalError = error;
} finally {
  if (desktopCreated) await fs.rm(desktopPath, { force: true }).catch(error => { finalError ||= error; });
  if (connected && fixtureWindow) await call('window_close', { window_id: fixtureWindow.id }).catch(() => {});
  if (fixturePid) { try { process.kill(fixturePid, 'SIGTERM'); } catch {} }
  if (connected) await client.close().catch(() => {});
  else await transport.close().catch(() => {});
  await new Promise(resolve => httpServer.close(resolve));
  await fs.rm(temporary, { recursive: true, force: true });
  if (runtimePids.length) {
    await waitFor(async () => runtimePids.every(pid => { try { process.kill(pid, 0); return false; } catch (e) { return e.code === 'ESRCH'; } }), 'runtime process cleanup').catch(error => { finalError ||= error; });
  }
}
console.log(JSON.stringify({ passed: !finalError, checks: report, error: finalError?.stack }, null, 2));
if (finalError) process.exitCode = 1;
