#!/usr/bin/env node
import fs from 'node:fs/promises';
import { accessSync, constants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { assertSupportedPlatform } from '../src/platform.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const LEGACY_SERVERS = Object.freeze(['playwright', 'desktop-mouse', 'desktop-vision', 'desktop-keyboard', 'desktop-apps', 'terminal-files']);
export const SYSTEM_PACKAGES = Object.freeze(['python3', 'xvfb', 'xauth', 'x11-utils', 'xdotool', 'wmctrl', 'xfwm4', 'dbus', 'xclip', 'scrot', 'imagemagick', 'libglib2.0-bin', 'util-linux', 'findutils', 'debianutils', 'fonts-dejavu-core']);
export const REQUIRED_COMMANDS = Object.freeze(['python3', 'Xvfb', 'xauth', 'xdpyinfo', 'xprop', 'xdotool', 'wmctrl', 'xfwm4', 'dbus-daemon', 'xclip', 'scrot', 'identify', 'convert', 'gio', 'flock', 'find', 'which', 'bash']);

export function mergeConfig(config, entry, replaceLegacy = false) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Existing MCP configuration must be a JSON object.');
  if (config.mcpServers !== undefined && (!config.mcpServers || typeof config.mcpServers !== 'object' || Array.isArray(config.mcpServers))) throw new Error('Existing mcpServers must be an object.');
  const servers = { ...config.mcpServers };
  if (replaceLegacy) for (const name of LEGACY_SERVERS) delete servers[name];
  servers.fecimus = entry;
  return { ...config, mcpServers: servers };
}

export async function writeLmStudioConfig({ configPath, entry, replaceLegacy = false }) {
  let original;
  try { original = await fs.readFile(configPath, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const config = original === undefined ? {} : JSON.parse(original.replace(/^\uFEFF/, ''));
  const updated = mergeConfig(config, entry, replaceLegacy);
  await fs.mkdir(path.dirname(configPath), { recursive: true, mode: 0o700 });
  const suffix = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const backup = original === undefined ? null : `${configPath}.backup-${suffix}`;
  if (backup) await fs.writeFile(backup, original, { mode: 0o600, flag: 'wx' });
  const temporary = `${configPath}.tmp-${suffix}`;
  try {
    await fs.writeFile(temporary, JSON.stringify(updated, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    // Do not overwrite an editor's concurrent change while preparing the new file.
    const current = await fs.readFile(configPath, 'utf8').catch(error => { if (error.code === 'ENOENT') return undefined; throw error; });
    if (current !== original) throw new Error('MCP configuration changed during installation. Retry after saving your editor.');
    await fs.rename(temporary, configPath);
  } finally { await fs.rm(temporary, { force: true }); }
  return { configPath, backup, servers: Object.keys(updated.mcpServers) };
}

export function parseOptions(args) {
  const options = { configPath: path.join(os.homedir(), '.lmstudio', 'mcp.json') };
  for (let i = 0; i < args.length; i++) {
    const option = args[i];
    if (option === '--config') {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error('--config requires a path.');
      options.configPath = path.resolve(value);
    } else if (['--system-deps', '--replace-legacy', '--skip-config', '--skip-deps', '--check', '--print-entry', '--help'].includes(option)) {
      options[option.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = true;
    } else throw new Error(`Unknown installer option: ${option}`);
  }
  return options;
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: project, stdio: 'inherit', ...options });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${command} exited ${signal || code}.`)));
  });
}

export function missingCommands() {
  return REQUIRED_COMMANDS.filter(command => command === 'Xvfb' && privateXvfb() ? false : spawnSync('which', [command], { stdio: 'ignore', timeout: 5000 }).status !== 0);
}

function privateXvfb() {
  const candidate = process.env.FECIMUS_XVFB || path.join(process.env.FECIMUS_DATA_DIR || path.join(os.homedir(), '.local/share/fecimus'), 'runtime/usr/bin/Xvfb');
  try { accessSync(candidate, constants.X_OK); return candidate; } catch { return null; }
}

function entryForInstall() {
  return { command: process.execPath, args: [path.join(project, 'src', 'server.mjs')],
    env: { FECIMUS_DATA_DIR: path.resolve(process.env.FECIMUS_DATA_DIR || path.join(os.homedir(), '.local', 'share', 'fecimus')),
      ...(privateXvfb() ? { FECIMUS_XVFB: privateXvfb() } : {}),
      PATH: `${path.dirname(process.execPath)}:${process.env.PATH || '/usr/local/bin:/usr/bin:/bin'}` } };
}

export async function verifyServer(entry) {
  const require = createRequire(path.join(project, 'package.json'));
  const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'fecimus-install-check-'));
  const client = new Client({ name: 'fecimus-installer-check', version: '2.0.0' });
  const transport = new StdioClientTransport({ command: entry.command, args: entry.args,
    env: { ...process.env, ...entry.env, FECIMUS_DATA_DIR: temporary }, stderr: 'pipe' });
  let log = '';
  transport.stderr?.on('data', data => { log = (log + data).slice(-6000); });
  try {
    await client.connect(transport, { timeout: 45000 });
    const listed = await client.listTools({}, { timeout: 30000 });
    if (!listed.tools?.some(tool => tool.name === 'fecimus_status')) throw new Error('fecimus_status was not advertised.');
    const result = await client.callTool({ name: 'fecimus_status', arguments: {} }, undefined, { timeout: 15000 });
    if (result.isError) throw new Error('fecimus_status returned an error.');
    const status = result.structuredContent || JSON.parse(result.content.filter(part => part.type === 'text').map(part => part.text).join('\n'));
    if (!status.runtime?.healthy || status.backends?.length !== 6 || status.backends.some(backend => !backend.connected)) {
      throw new Error(`Unhealthy startup: ${JSON.stringify(status)}`);
    }
    return { tools: listed.tools.length, backends: status.backends.length };
  } catch (error) { throw new Error(`MCP startup verification failed: ${error.message}${log ? '\n' + log : ''}`); }
  finally {
    await client.close().catch(() => {});
    await transport.close().catch(() => {});
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

export async function main(args = process.argv.slice(2)) {
  const options = parseOptions(args);
  if (options.help) {
    console.log('Usage: node scripts/install.mjs [--system-deps] [--replace-legacy] [--config PATH]\n  --system-deps    Install required Ubuntu packages using sudo, plus Chromium libraries.\n  --replace-legacy Remove the six original Fecimus backend registrations (backup kept).\n  --skip-config    Install dependencies only; used by the Windows launcher installer.\n  --skip-deps      Reconfigure an already installed checkout without downloading dependencies.\n  --check          Check platform and required commands without changes.\n  --print-entry    Print the launch entry as JSON without changes.');
    return;
  }
  const platform = await assertSupportedPlatform();
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node.js 22+ is required. Use bash scripts/install.sh to install a private Node runtime.');
  const entry = entryForInstall();
  if (options.printEntry) { console.log(JSON.stringify(entry)); return; }
  if (options.check) {
    const missing = missingCommands();
    console.log(JSON.stringify({ platform, node: process.versions.node, missing, ready: missing.length === 0 }, null, 2));
    if (missing.length) process.exitCode = 1;
    return;
  }
  if (process.getuid?.() === 0) throw new Error('Install Fecimus as your ordinary Linux/WSL user, not root. The installer uses sudo only for system packages.');
  await fs.access(path.join(project, 'src', 'server.mjs'));
  if (options.systemDeps) {
    await run('sudo', ['apt-get', 'update']);
    await run('sudo', ['apt-get', 'install', '-y', ...SYSTEM_PACKAGES]);
  }
  const missing = missingCommands();
  if (missing.length) throw new Error(`Missing dependencies: ${missing.join(', ')}. Rerun with --system-deps.`);
  if (!options.skipDeps) {
    await fs.access(path.join(project, 'package-lock.json'));
    await run('npm', ['ci', '--no-audit', '--no-fund']);
    const require = createRequire(path.join(project, 'package.json'));
    const browserCli = path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js');
    if (options.systemDeps) await run(process.execPath, [browserCli, 'install-deps', 'chromium']);
    await run(process.execPath, [browserCli, 'install', 'chromium']);
    const { chromium } = require('playwright');
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent('<title>Fecimus install check</title><p>Background browser ready</p>');
      if (await page.title() !== 'Fecimus install check') throw new Error('Background browser verification failed.');
    } finally { await browser.close(); }
  }
  const verified = await verifyServer(entry);
  console.log(`Verified MCP startup: ${verified.backends} backends, ${verified.tools} tools.`);
  await fs.mkdir(entry.env.FECIMUS_DATA_DIR, { recursive: true, mode: 0o700 });
  if (!options.skipConfig) {
    const result = await writeLmStudioConfig({ configPath: options.configPath, entry, replaceLegacy: options.replaceLegacy });
    console.log(`Registered Fecimus in ${result.configPath}`);
    if (result.backup) console.log(`Previous configuration: ${result.backup}`);
  }
  console.log('Fecimus installation complete. Restart LM Studio, select a tool-capable model, and enable mcp/fecimus.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`Fecimus install failed: ${error.message}`); process.exitCode = 1; });
}
