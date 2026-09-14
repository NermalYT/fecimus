import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { addonTools, validateAddonManifest, createAddonManager, callAddonTool } from '../src/addons.mjs';

const exec = promisify(execFile);
const repo = fileURLToPath(new URL('../', import.meta.url));
const example = path.join(repo, 'examples', 'hello-addon');
const manifest = JSON.parse(await fs.readFile(path.join(example, 'fecimus-addon.json'), 'utf8'));
async function fixture(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fecimus-addons-test-'));
  try {
    const source = path.join(dir, 'source'), dataDir = path.join(dir, 'data');
    await fs.cp(example, source, { recursive: true });
    const manager = createAddonManager({ dataDir, platform: 'linux' });
    await fn({ dir, source, dataDir, manager });
  } finally { await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
}
const missing = async filename => assert.rejects(fs.access(filename), { code: 'ENOENT' });

test('manifest validates required compatibility, namespaces, platform and executable arguments', () => {
  assert.deepEqual(validateAddonManifest(manifest), manifest);
  for (const id of ['../hello', 'fecimus', 'fecimus_custom', 'Hello', 'hello-addon', 'x'.repeat(33), '__proto__']) assert.throws(() => validateAddonManifest({ ...manifest, id }), /id|namespace/);
  for (const fields of [{ fecimus_compat: '*' }, { fecimus_compat: '>=2.0.0' }, { platforms: ['windows'] }, { platforms: ['linux', 'linux'] }, { version: 'latest' }, { version: '01.0.0' }, { surprise: true }, { server: { command: '{node}', args: 'server.mjs' } }, { server: { ...manifest.server, env: { X: 4 } } }]) assert.throws(() => validateAddonManifest({ ...manifest, ...fields }));
  assert.equal(addonTools.length, 1);
  assert.equal(addonTools[0].name, 'fecimus_addons');
});

test('inspect and installation never execute code; source is independently copied and persists privately', async () => fixture(async ({ source, dataDir, manager }) => {
  const marker = path.join(dataDir, 'must-not-exist');
  await fs.writeFile(path.join(source, 'side-effect.mjs'), `import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(marker)},'ran')`);
  const custom = { ...manifest, server: { command: '{node}', args: ['{addon}/side-effect.mjs'], env: { ADDON_ROOT: '{addon}', NODE_PATH_EXAMPLE: '{node}' } } };
  await fs.writeFile(path.join(source, 'fecimus-addon.json'), JSON.stringify(custom));
  const inspection = await manager.inspect(source);
  assert.equal(inspection.compatible, true); assert.equal(inspection.executes_code, false);
  assert.equal(inspection.files, 5); assert(inspection.bytes > 0);
  await missing(marker);
  await assert.rejects(manager.install(source), /trust:true/);
  const installed = await manager.install(source, { trust: true });
  assert.equal(installed.restart_required, true); await missing(marker);
  await fs.writeFile(path.join(source, 'side-effect.mjs'), 'changed source');
  assert(!(await fs.readFile(path.join(installed.path, 'side-effect.mjs'), 'utf8')).includes('changed source'));
  const afterRestart = createAddonManager({ dataDir, platform: 'linux' });
  const config = await afterRestart.backendConfig();
  assert.equal(config['addon-hello'].command, process.execPath);
  assert.equal(path.normalize(config['addon-hello'].args[0]), path.join(installed.path, 'side-effect.mjs'));
  assert.equal(config['addon-hello'].env.ADDON_ROOT, installed.path);
  assert.equal(config['addon-hello'].env.NODE_PATH_EXAMPLE, process.execPath);
  assert.equal(config['addon-hello'].toolPrefix, 'hello__');
  assert.equal(config['addon-hello'].isolated, true); assert.equal(config['addon-hello'].group, 'desktop');
  if (process.platform !== 'win32') {
    assert.equal((await fs.stat(path.join(dataDir, 'addons', 'registry.json'))).mode & 0o777, 0o600);
    assert.equal((await fs.stat(installed.path)).mode & 0o777, 0o700);
  }
  await missing(marker);
}));

test('enable/disable/remove are persistent, require trust for execution, and keep recoverable files', async () => fixture(async ({ source, manager }) => {
  const installed = await manager.install(source, { trust: true });
  await assert.rejects(manager.install(source, { trust: true }), /already installed/);
  assert.equal((await manager.disable('hello')).enabled, false);
  assert.deepEqual(await manager.backendConfig(), {});
  await assert.rejects(manager.enable('hello'), /trust:true/);
  await manager.enable('hello', { trust: true });
  assert.equal(Object.keys(await manager.backendConfig()).length, 1);
  const removed = await manager.remove('hello');
  assert.equal(removed.removed, true); await missing(installed.path);
  assert.equal((await manager.list()).addons.length, 0);
  assert.equal(JSON.parse(await fs.readFile(path.join(removed.recovery_path, 'fecimus-addon.json'), 'utf8')).id, 'hello');
  await manager.install(removed.recovery_path, { trust: true });
  assert.equal((await manager.list()).addons.length, 1);
}));

test('tool wrapper uses actual schema and invalid/cancelled actions cannot mutate', async () => fixture(async ({ source, dataDir, manager }) => {
  const result = JSON.parse((await callAddonTool('fecimus_addons', { action: 'inspect', path: source }, manager)).content[0].text);
  assert.equal(result.manifest.id, 'hello');
  await assert.rejects(callAddonTool('fecimus_addons', { action: 'install', path: source }, manager), /trust:true/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(callAddonTool('fecimus_addons', { action: 'install', path: source, trust: true }, manager, controller.signal), /cancelled/);
  await missing(dataDir);
  await assert.rejects(manager.disable('../escape'), /id/);
  await assert.rejects(manager.remove('fecimus'), /namespace/);
  await assert.rejects(callAddonTool('other', {}, manager), /Unknown addon tool/);
  await assert.rejects(callAddonTool('fecimus_addons', { action: 'launch' }, manager), /Unknown addon action/);
}));

test('incompatible, altered and invalid installed manifests never become backend configurations', async () => fixture(async ({ source, dataDir, manager }) => {
  const winOnly = { ...manifest, platforms: ['windows-wsl2'] };
  await fs.writeFile(path.join(source, 'fecimus-addon.json'), JSON.stringify(winOnly));
  assert.equal((await manager.inspect(source)).compatible, false);
  await assert.rejects(manager.install(source, { trust: true }), /does not support linux/);
  await fs.writeFile(path.join(source, 'fecimus-addon.json'), JSON.stringify(manifest));
  const installed = await manager.install(source, { trust: true });
  await fs.writeFile(path.join(installed.path, 'fecimus-addon.json'), JSON.stringify({ ...manifest, id: 'other' }));
  assert.deepEqual(await manager.backendConfig(), {});
  assert.match((await manager.list()).addons[0].error, /differs/);
  await fs.writeFile(path.join(installed.path, 'fecimus-addon.json'), '{');
  assert.deepEqual(await manager.backendConfig(), {});
  await assert.rejects(manager.enable('hello', { trust: true }), /JSON/);
  await fs.writeFile(path.join(dataDir, 'addons', 'registry.json'), JSON.stringify({ schema: 1, addons: [{ id: '../escape', enabled: true, installed_at: 'now' }] }));
  await assert.rejects(manager.backendConfig(), /id/);
}));

test('symlinks, hardlinks, source aliases and storage aliases are refused', async t => fixture(async ({ dir, source, dataDir, manager }) => {
  const outside = path.join(dir, 'outside'); await fs.writeFile(outside, 'private');
  const linked = path.join(source, 'linked.txt');
  try { await fs.symlink(outside, linked); } catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) { t.skip('Host cannot create test symlinks.'); return; } throw error; }
  await assert.rejects(manager.inspect(source), /symlink|special file/);
  await fs.rm(linked); await fs.link(outside, linked);
  await assert.rejects(manager.inspect(source), /regular, unlinked/);
  await fs.rm(linked);
  const sourceAlias = path.join(dir, 'alias'); await fs.symlink(source, sourceAlias, 'junction');
  await assert.rejects(manager.inspect(sourceAlias), /symlink/);
  await fs.mkdir(dataDir); await fs.symlink(source, path.join(dataDir, 'addons'), 'junction');
  await assert.rejects(manager.list(), /symlink/);
}));

test('portable paths reject case collisions, Windows reserved names and Git metadata', async () => fixture(async ({ source, manager }) => {
  for (const name of ['.git', 'NUL.txt', 'COM1', 'trailing.']) {
    if (process.platform === 'win32' && name !== '.git') continue;
    const filename = path.join(source, name); await fs.mkdir(filename);
    await assert.rejects(manager.inspect(source), /portable|Remove the .git/);
    await fs.rm(filename, { recursive: true });
  }
  if (process.platform !== 'win32') {
    await fs.writeFile(path.join(source, 'A.txt'), 'A'); await fs.writeFile(path.join(source, 'a.txt'), 'a');
    await assert.rejects(manager.inspect(source), /portable/);
  }
}));

test('size and depth limits reject oversized trees before installing', async () => fixture(async ({ source, dataDir, manager }) => {
  const large = path.join(source, 'large'); await fs.writeFile(large, Buffer.alloc(2 * 1024 * 1024 + 1));
  await assert.rejects(manager.install(source, { trust: true }), /at most/);
  await missing(dataDir); await fs.rm(large);
  let deep = source;
  for (let level = 0; level < 17; level++) { deep = path.join(deep, 'd'); await fs.mkdir(deep); }
  await assert.rejects(manager.inspect(source), /directory levels/);
}));

test('mutation lock and corrupt registry fail without replacing installed files', async () => fixture(async ({ source, dataDir, manager }) => {
  await manager.list();
  const lock = path.join(dataDir, 'addons', '.mutation.lock');
  await fs.writeFile(lock, JSON.stringify({ pid: process.pid }));
  await assert.rejects(manager.install(source, { trust: true }), /Another addon mutation/);
  assert.equal(JSON.parse(await fs.readFile(lock, 'utf8')).pid, process.pid);
  await fs.rm(lock);
  const registry = path.join(dataDir, 'addons', 'registry.json'); await fs.writeFile(registry, 'broken');
  await assert.rejects(manager.install(source, { trust: true }), /registry JSON/);
  assert.equal(await fs.readFile(registry, 'utf8'), 'broken');
  await missing(lock);
}));

test('example speaks actual MCP stdio initialize, tools/list and tools/call', async () => {
  const client = new Client({ name: 'fecimus-addon-test', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(example, 'server.mjs')], stderr: 'pipe' });
  try {
    await client.connect(transport);
    const definitions = await client.listTools(); assert.equal(definitions.tools[0].name, 'greet');
    const result = await client.callTool({ name: 'greet', arguments: { name: 'Fecimus' } });
    assert.match(result.content[0].text, /Hello, Fecimus! Your private Fecimus addon is working/);
    assert.equal((await client.callTool({ name: 'greet', arguments: { name: 42 } })).isError, true);
    assert.equal((await client.callTool({ name: 'missing', arguments: {} })).isError, true);
    await client.ping();
  } finally { await client.close(); }
});

test('CLI supports local inspect/install/list/disable/remove and rejects extra flags', async () => fixture(async ({ source, dataDir }) => {
  const run = args => exec(process.execPath, [path.join(repo, 'scripts', 'addons.mjs'), ...args], { env: { ...process.env, FECIMUS_DATA_DIR: dataDir } });
  assert.equal(JSON.parse((await run(['inspect', source])).stdout).manifest.id, 'hello');
  await assert.rejects(run(['install', source]), error => /trust:true/.test(error.stderr));
  assert.equal(JSON.parse((await run(['install', source, '--trust'])).stdout).enabled, true);
  assert.equal(JSON.parse((await run(['list'])).stdout).addons.length, 1);
  assert.equal(JSON.parse((await run(['disable', 'hello'])).stdout).enabled, false);
  await assert.rejects(run(['enable', 'hello', '--other']), error => /Usage/.test(error.stderr));
  assert.equal(JSON.parse((await run(['enable', 'hello', '--trust'])).stdout).enabled, true);
  assert.equal(JSON.parse((await run(['remove', 'hello'])).stdout).removed, true);
}));

test('vendor studio templates inspect and register without starting proprietary applications', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fecimus-studio-manifests-'));
  try {
    for (const [folder, id, platform] of [['roblox-studio-addon', 'roblox', 'windows-wsl2'], ['unity-cli-addon', 'unity', 'linux']]) {
      const manager = createAddonManager({ dataDir: path.join(dir, id), platform });
      const source = path.resolve('examples', folder);
      assert.equal((await manager.inspect(source)).compatible, true);
      await manager.install(source, { trust: true });
      const config = (await manager.backendConfig())[`addon-${id}`];
      assert.equal(config.toolPrefix, `${id}__`);
      assert.deepEqual(config.args, id === 'roblox' ? ['/d', '/c', '%LOCALAPPDATA%\\Roblox\\mcp.bat'] : ['mcp']);
    }
    const linux = createAddonManager({ dataDir: path.join(dir, 'linux'), platform: 'linux' });
    assert.equal((await linux.inspect(path.resolve('examples/roblox-studio-addon'))).compatible, false);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
