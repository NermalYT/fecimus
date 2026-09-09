// A persistent, private browser profile per active Fecimus connection.
import fs from 'node:fs/promises';
import { dataDir } from './config.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
const base = path.dirname(fileURLToPath(import.meta.url));
const root = process.env.FECIMUS_BROWSER_PROFILE || path.join(dataDir, 'browser-profiles');
await fs.mkdir(root, {recursive:true, mode:0o700});
const alive = pid => { try { process.kill(Number(pid), 0); return true; } catch { return false; } };
let lock, profile;
for (let slot = 0; slot < 32; slot++) {
  const candidate = path.join(root, `session-${slot}`);
  const handle = await fs.open(candidate + '.lock', 'a', 0o600);
  try {
    // flock is attached to the inherited open file description; parent retains it.
    execFileSync('flock', ['--nonblock','3'], {stdio:['ignore','ignore','ignore',handle.fd]});
    try {
      const target = await fs.readlink(path.join(candidate, 'SingletonLock'));
      if (alive(target.split('-').at(-1))) { await handle.close(); continue; }
    } catch {}
    profile = candidate; lock = handle; break;
  } catch { await handle.close(); }
}
if (!profile) throw new Error('All Fecimus browser profile slots are busy');
await fs.mkdir(profile, {recursive:true, mode:0o700});
const cli = path.resolve(base, '../node_modules/@playwright/mcp/cli.js');
const browserEnv = { ...process.env };
for (const key of ['PLAYWRIGHT_MCP_CDP_ENDPOINT','PLAYWRIGHT_MCP_EXTENSION','PLAYWRIGHT_MCP_ENDPOINT']) delete browserEnv[key];
const child = spawn(process.execPath, [cli, '--browser=chromium','--headless','--user-data-dir',profile,
  '--caps=vision,pdf','--image-responses=allow','--codegen=none','--timeout-settle=150','--timeout-action=5000','--timeout-navigation=30000',
  '--viewport-size=1600x1000','--console-level=error','--config',path.join(base,'browser.config.json'),
  '--output-dir',path.join(dataDir,'browser-output',String(process.pid)), '--output-max-size=104857600'], {env: browserEnv, stdio:[0,1,2,lock.fd], detached:true});
let stopping;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const groupAlive = () => { if (!child.pid) return false; try { process.kill(-child.pid, 0); return true; } catch { return false; } };
const killGroup = signal => { if (child.pid) { try { process.kill(-child.pid, signal); } catch {} } };
function stop(code = 0) {
  if (stopping) return stopping;
  stopping = (async () => {
    killGroup('SIGTERM');
    const deadline = Date.now() + 1500;
    while (groupAlive() && Date.now() < deadline) await pause(50);
    if (groupAlive()) killGroup('SIGKILL');
    await lock.close();
    process.exit(code);
  })();
  return stopping;
}
process.on('SIGINT', () => stop()); process.on('SIGTERM', () => stop());
child.on('error', e => { console.error('[fecimus/browser]', e.message); stop(1); });
child.on('exit', code => stop(code || 0));
