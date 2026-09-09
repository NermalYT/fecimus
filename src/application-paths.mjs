import os from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';

export function applicationDirectories({ home = os.homedir(), env = process.env, exists = existsSync } = {}) {
  const dataHome = env.FECIMUS_HOST_DATA_HOME || env.XDG_DATA_HOME || path.join(home, '.local/share');
  const dataDirs = (env.XDG_DATA_DIRS || '/usr/local/share:/usr/share').split(':').filter(p => path.isAbsolute(p));
  return [...new Set([
    path.join(dataHome, 'applications'),
    path.join(home, '.local/share/applications'),
    ...dataDirs.map(p => path.join(p, 'applications')),
    path.join(home, '.local/share/flatpak/exports/share/applications'),
    '/var/lib/flatpak/exports/share/applications',
    '/var/lib/snapd/desktop/applications',
  ])].filter(exists);
}
