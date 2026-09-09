import fs from 'node:fs/promises';
import { dataDir } from './config.mjs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const pause = ms => new Promise(r => setTimeout(r, ms));

function firstLine(child, stream, timeout = 10000) {
  return new Promise((resolve, reject) => {
    let data = '';
    const cleanup = () => { clearTimeout(timer); stream.off('data', onData); child.off('error', onError); child.off('exit', onExit); };
    const onError = e => { cleanup(); reject(e); };
    const onExit = code => onError(new Error(`Runtime exited before readiness (${code})`));
    const onData = chunk => { data += chunk; if (data.includes('\n')) { cleanup(); resolve(data.split('\n')[0].trim()); } };
    const timer = setTimeout(() => onError(new Error('Runtime startup timeout')), timeout);
    stream.on('data', onData); child.once('error', onError); child.once('exit', onExit);
  });
}
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.kill('SIGTERM');
  await Promise.race([exited, pause(1000)]);
  if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await Promise.race([exited, pause(1000)]); }
}
export async function startRuntime(base, settings = {}) {
  const width = settings.desktop?.width ?? 1600;
  const height = settings.desktop?.height ?? 1000;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 640 || height < 480 || width > 3840 || height > 2160) throw new Error('Invalid AI desktop dimensions');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fecimus-display-'));
  await fs.chmod(dir, 0o700);
  const authority = path.join(dir, 'Xauthority');
  await fs.writeFile(authority, '', { mode: 0o600 });
  const children = [];
  let closed = false, display = null;
  const errors = [];
  function launch(command, args, options = {}) {
    const child = spawn('python3', [path.join(base, 'runtime-child.py'), String(process.pid), command, ...args], { stdio: ['ignore','pipe','pipe'], ...options });
    child.on('error', e => errors.push(e.message));
    child.stderr?.on('data', b => { if (settings.debug) process.stderr.write(`[fecimus/runtime] ${b}`); });
    children.push(child);
    return child;
  }
  const close = async () => {
    if (closed) return;
    closed = true;
    for (const child of children.toReversed()) await stop(child);
    await fs.rm(dir, { recursive: true, force: true });
  };
  try {
    const cookie = crypto.randomBytes(16).toString('hex');
    await exec('xauth', ['-f',authority,'add',':65500','.',cookie]);
    const binary = process.env.FECIMUS_XVFB || settings.desktop?.xvfbPath || (await fs.access(path.join(dataDir, 'runtime/usr/bin/Xvfb')).then(() => path.join(dataDir, 'runtime/usr/bin/Xvfb')).catch(() => 'Xvfb'));
    const x = launch(binary, ['-displayfd','3','-screen','0',`${width}x${height}x24`,'-nolisten','tcp','-auth',authority,'-noreset'], { stdio: ['ignore','ignore','pipe','pipe'] });
    const number = await firstLine(x, x.stdio[3]);
    if (!/^\d+$/.test(number)) throw new Error('Invalid X display returned');
    display = `:${number}`;
    await exec('xauth',['-f',authority,'add',display,'.',cookie]);
    const env = { ...process.env, DISPLAY: display, XAUTHORITY: authority, WAYLAND_DISPLAY: '', XDG_SESSION_TYPE: 'x11', SESSION_MANAGER: '', GDK_BACKEND: 'x11', QT_QPA_PLATFORM: 'xcb', NO_AT_BRIDGE: '1' };
    const appHome = path.join(dataDir, 'app-homes', 'display-' + number);
    // Applications get independent profiles; terminal/files retain the real HOME.
    await fs.mkdir(appHome, { recursive: true, mode: 0o700 });
    const privateRuntime = path.join(dir, 'xdg-runtime');
    await fs.mkdir(privateRuntime, { mode: 0o700 });
    Object.assign(env, { FECIMUS_APP_HOME: appHome, FECIMUS_HOST_DATA_HOME: process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local/share'), XDG_RUNTIME_DIR: privateRuntime,
      XDG_CONFIG_HOME: path.join(appHome, '.config'), XDG_CACHE_HOME: path.join(appHome, '.cache'),
      XDG_DATA_HOME: path.join(appHome, '.local/share'), XDG_STATE_HOME: path.join(appHome, '.local/state') });
    delete env.DBUS_SESSION_BUS_ADDRESS;
    delete env.DBUS_STARTER_ADDRESS;
    delete env.DBUS_STARTER_BUS_TYPE;
    const bus = launch('dbus-daemon', ['--session','--nofork','--print-address=1'], { env: { ...env, HOME: appHome } });
    env.DBUS_SESSION_BUS_ADDRESS = await firstLine(bus, bus.stdout);
    await exec('xdpyinfo', [], { env, timeout: 5000, maxBuffer: 1024*1024 });
    const wm = launch('xfwm4', ['--sm-client-disable','--compositor=off'], { env });
    for (let i = 0; i < 50; i++) {
      if (wm.exitCode !== null || wm.signalCode !== null) throw new Error('AI window manager exited');
      const { stdout } = await exec('xprop', ['-root','_NET_SUPPORTING_WM_CHECK'], { env, timeout: 1000 });
      if (stdout.includes('window id #')) break;
      if (i === 49) throw new Error('AI window manager startup timeout');
      await pause(100);
    }
    const status = () => ({ mode: 'isolated', display, width, height, healthy: !closed && children.every(c => c.exitCode === null && c.signalCode === null) && !errors.length, processes: children.map(c => c.pid), errors: [...errors] });
    // A separate display never receives physical mouse/keyboard events.
    return { env, status, close };
  } catch (error) { await close(); throw error; }
}
