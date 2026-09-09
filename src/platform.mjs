import fs from 'node:fs/promises';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
export const UBUNTU_LTS = Object.freeze({ jammy: '22.04', noble: '24.04', resolute: '26.04' });
export const WINDOWS_PRO_EDITIONS = Object.freeze(['Professional', 'ProfessionalN']);

// Parse os-release as data. Never source a distribution-provided file as shell code.
export function parseOsRelease(text) {
  const values = {};
  for (const line of String(text).split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1).replace(/\\(["\\$`])/g, '$1');
    else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    values[match[1]] = value;
  }
  return values;
}

export function assessPlatform({ platform, arch = process.arch, release = '', osRelease = {}, windowsEdition = '', windowsBuild } = {}) {
  const base = { platform, arch, supported: false };
  if (!['x64', 'arm64'].includes(arch)) return { ...base, reason: 'Fecimus requires x86-64 or ARM64.' };
  if (platform === 'linux') {
    const data = typeof osRelease === 'string' ? parseOsRelease(osRelease) : osRelease;
    const ubuntu = data.ID === 'ubuntu';
    const derived = String(data.ID_LIKE || '').split(/\s+/).includes('ubuntu');
    const codename = ubuntu ? (data.UBUNTU_CODENAME || data.VERSION_CODENAME) : data.UBUNTU_CODENAME;
    if (!(ubuntu || derived) || !Object.hasOwn(UBUNTU_LTS, codename || '')) {
      return { ...base, reason: 'Fecimus supports Ubuntu 22.04, 24.04 or 26.04 LTS and derivatives declaring the same Ubuntu base in /etc/os-release.' };
    }
    if (ubuntu && data.VERSION_ID && data.VERSION_ID !== UBUNTU_LTS[codename]) {
      return { ...base, reason: 'Ubuntu VERSION_ID and LTS codename disagree.' };
    }
    const wsl = /microsoft|wsl/i.test(release);
    if (wsl && !/wsl2|microsoft-standard/i.test(release)) {
      return { ...base, reason: 'WSL 1 is unsupported. Convert this distribution using wsl --set-version <name> 2.' };
    }
    return { ...base, supported: true, mode: wsl ? 'wsl2' : 'linux', distro: data.PRETTY_NAME || data.ID,
      ubuntuCodename: codename, ubuntuVersion: UBUNTU_LTS[codename] };
  }
  if (platform === 'win32') {
    const build = Number(windowsBuild ?? String(release).split('.')[2]);
    if (!Number.isInteger(build) || build < 22000 || !WINDOWS_PRO_EDITIONS.includes(windowsEdition)) {
      return { ...base, reason: 'The Windows launcher supports Windows 11 Pro or Pro N (build 22000+) only.' };
    }
    return { ...base, supported: true, mode: 'windows-wsl2-launcher', windowsEdition, windowsBuild: build };
  }
  return { ...base, reason: 'Fecimus supports only Windows 11 Pro through WSL2 and Ubuntu LTS-based Linux.' };
}

export async function detectPlatform() {
  const info = { platform: process.platform, arch: process.arch, release: os.release() };
  if (process.platform === 'linux') info.osRelease = await fs.readFile('/etc/os-release', 'utf8').catch(() => '');
  if (process.platform === 'win32') {
    const { stdout } = await exec('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
      "$p=Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion'; @{edition=$p.EditionID;build=$p.CurrentBuildNumber} | ConvertTo-Json -Compress"], { timeout: 15000, windowsHide: true });
    const windows = JSON.parse(stdout.replace(/^\uFEFF/, ''));
    info.windowsEdition = windows.edition;
    info.windowsBuild = windows.build;
  }
  return assessPlatform(info);
}

export async function assertSupportedPlatform({ allowWindowsLauncher = false } = {}) {
  const result = await detectPlatform();
  if (!result.supported) throw new Error(result.reason);
  if (result.mode === 'windows-wsl2-launcher' && !allowWindowsLauncher) {
    throw new Error('Run scripts/install.ps1 from Windows PowerShell. Fecimus itself runs inside WSL2 Ubuntu LTS; a separate native Windows cursor is not available.');
  }
  return result;
}
