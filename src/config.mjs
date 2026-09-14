import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Compatibility with installations configured before the Fecimus rename.
for (const [key, value] of Object.entries(process.env)) {
  if (key.startsWith('ASTRA_')) process.env[key.replace(/^ASTRA_/, 'FECIMUS_')] ??= value;
}
export const sourceDir = path.dirname(fileURLToPath(import.meta.url));
const currentData = path.join(os.homedir(), '.local/share/fecimus');
const previousData = path.join(os.homedir(), '.local/share/astra-mcp');
export const dataDir = path.resolve(process.env.FECIMUS_DATA_DIR || (fs.existsSync(currentData) || !fs.existsSync(previousData) ? currentData : previousData));
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
