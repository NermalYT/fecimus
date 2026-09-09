import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const sourceDir = path.dirname(fileURLToPath(import.meta.url));
export const dataDir = path.resolve(process.env.FECIMUS_DATA_DIR || path.join(os.homedir(), '.local/share/fecimus'));
export function defaultBackends() {
  const launch = name => ({ command: process.execPath, args: [path.join(sourceDir, 'native', `${name}.mjs`)] });
  return {
    playwright: { command: process.execPath, args: [path.join(sourceDir, 'start-browser.mjs')] },
    'desktop-mouse': launch('mouse'), 'desktop-vision': launch('vision'),
    'desktop-keyboard': launch('keyboard'), 'desktop-apps': launch('apps'),
    'terminal-files': launch('terminal-files')
  };
}
export function loadSettings() {
  const filename = process.env.FECIMUS_SETTINGS || path.join(dataDir, 'settings.json');
  return fs.existsSync(filename) ? JSON.parse(fs.readFileSync(filename, 'utf8')) : { desktop: { width: 1600, height: 1000 } };
}
