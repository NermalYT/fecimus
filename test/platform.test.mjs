import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseOsRelease, assessPlatform, UBUNTU_LTS } from '../src/platform.mjs';
import { mergeConfig, writeLmStudioConfig, parseOptions } from '../scripts/install.mjs';

test('parses os-release as inert data including quotes and CRLF', () => {
  assert.deepEqual(parseOsRelease('ID=linuxmint\r\nPRETTY_NAME="Linux Mint 22.3"\r\nID_LIKE=\'ubuntu debian\'\nINVALID LINE\n#COMMENT=x\nHOME_URL="$(touch /tmp/never-run)"'),
    { ID: 'linuxmint', PRETTY_NAME: 'Linux Mint 22.3', ID_LIKE: 'ubuntu debian', HOME_URL: '$(touch /tmp/never-run)' });
});

test('supports every declared Ubuntu LTS and Mint XFCE base on x64/arm64', () => {
  for (const [codename, version] of Object.entries(UBUNTU_LTS)) {
    for (const arch of ['x64', 'arm64']) {
      assert.equal(assessPlatform({ platform: 'linux', arch, osRelease: { ID: 'ubuntu', VERSION_CODENAME: codename, VERSION_ID: version } }).supported, true);
      assert.equal(assessPlatform({ platform: 'linux', arch, osRelease: { ID: 'linuxmint', ID_LIKE: 'ubuntu debian', UBUNTU_CODENAME: codename, VERSION_CODENAME: 'zena' } }).supported, true);
    }
  }
});

test('rejects unrelated Linux, interim releases, unverifiable bases, and malformed version pairs', () => {
  for (const osRelease of [
    {}, { ID: 'debian', VERSION_ID: '13' }, { ID: 'ubuntu', VERSION_CODENAME: 'questing', VERSION_ID: '25.10' },
    { ID: 'linuxmint', ID_LIKE: 'debian', UBUNTU_CODENAME: 'noble' },
    { ID: 'linuxmint', ID_LIKE: 'ubuntu', VERSION_CODENAME: 'noble' },
    { ID: 'ubuntu', VERSION_CODENAME: 'noble', VERSION_ID: '25.04' },
    { ID: 'ubuntu', VERSION_CODENAME: '__proto__' }
  ]) assert.equal(assessPlatform({ platform: 'linux', osRelease }).supported, false, JSON.stringify(osRelease));
  assert.equal(assessPlatform({ platform: 'linux', arch: 'ia32', osRelease: { ID: 'ubuntu', VERSION_CODENAME: 'noble' } }).supported, false);
  assert.equal(assessPlatform({ platform: 'darwin', arch: 'arm64' }).supported, false);
});

test('WSL2 is accepted and WSL1 is rejected', () => {
  const linux = { platform: 'linux', osRelease: { ID: 'ubuntu', VERSION_CODENAME: 'noble', VERSION_ID: '24.04' } };
  assert.equal(assessPlatform({ ...linux, release: '5.15.167.4-microsoft-standard-WSL2' }).mode, 'wsl2');
  assert.equal(assessPlatform({ ...linux, release: '4.4.0-19041-Microsoft' }).supported, false);
});

test('Windows support gate permits only Windows11 Pro and Pro N', () => {
  for (const windowsEdition of ['Professional', 'ProfessionalN']) {
    assert.equal(assessPlatform({ platform: 'win32', windowsEdition, windowsBuild: 22000 }).mode, 'windows-wsl2-launcher');
    assert.equal(assessPlatform({ platform: 'win32', windowsEdition, windowsBuild: 19045 }).supported, false);
  }
  for (const windowsEdition of ['Core', 'Enterprise', 'Education', 'ProfessionalEducation', 'ProfessionalWorkstation', '', 'professional']) {
    assert.equal(assessPlatform({ platform: 'win32', windowsEdition, windowsBuild: 26100 }).supported, false);
  }
  assert.equal(assessPlatform({ platform: 'win32', windowsEdition: 'Professional', windowsBuild: 'invalid' }).supported, false);
});

test('config merge preserves unrelated integrations and removes legacy only when requested', () => {
  const input = { theme: 'dark', mcpServers: { custom: { url: 'https://example.invalid' }, playwright: { command: 'old' }, 'desktop-mouse': { command: 'old' } } };
  const entry = { command: '/path with spaces/node', args: ['/path/fecimus/server.mjs'] };
  assert.equal(Object.keys(mergeConfig(input, entry).mcpServers).length, 4);
  const merged = mergeConfig(input, entry, true);
  assert.deepEqual(Object.keys(merged.mcpServers), ['custom', 'fecimus']);
  assert.deepEqual(merged.mcpServers.fecimus, entry);
  assert.equal(merged.theme, 'dark');
  assert.equal(Object.keys(input.mcpServers).length, 3, 'does not mutate the caller');
  for (const invalid of [null, [], { mcpServers: [] }, { mcpServers: null }, { mcpServers: 'oops' }]) assert.throws(() => mergeConfig(invalid, entry));
});

test('installer writes atomically with exact backup and never destroys malformed JSON', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'fecimus-config-test-'));
  try {
    const configPath = path.join(temporary, 'path with spaces', 'mcp.json');
    const entry = { command: '/usr/bin/node', args: ['/tmp/server.mjs'] };
    const first = await writeLmStudioConfig({ configPath, entry });
    assert.equal(first.backup, null);
    const original = await fs.readFile(configPath, 'utf8');
    const changed = await writeLmStudioConfig({ configPath, entry: { ...entry, args: ['/tmp/updated.mjs'] } });
    assert.equal(await fs.readFile(changed.backup, 'utf8'), original);
    assert.equal(JSON.parse(await fs.readFile(configPath, 'utf8')).mcpServers.fecimus.args[0], '/tmp/updated.mjs');
    if (process.platform !== 'win32') assert.equal((await fs.stat(configPath)).mode & 0o777, 0o600);
    await fs.writeFile(configPath, '{ broken');
    await assert.rejects(writeLmStudioConfig({ configPath, entry }), SyntaxError);
    assert.equal(await fs.readFile(configPath, 'utf8'), '{ broken');
    assert.equal((await fs.readdir(path.dirname(configPath))).filter(name => name.includes('.tmp-')).length, 0);
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
});

test('installer rejects unknown flags and missing values', () => {
  assert.throws(() => parseOptions(['--config']));
  assert.throws(() => parseOptions(['--config', '--replace-legacy']));
  assert.throws(() => parseOptions(['--destroy-everything']));
  assert.equal(parseOptions(['--replace-legacy', '--system-deps', '--skip-config']).replaceLegacy, true);
});
