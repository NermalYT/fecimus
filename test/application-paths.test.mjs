import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { applicationDirectories } from '../src/application-paths.mjs';

test('application discovery keeps host XDG precedence and Flatpak/Snap exports', () => {
  const home = path.resolve('fixture-home'), custom = path.resolve('custom-data');
  const dirs = applicationDirectories({ home, env: { FECIMUS_HOST_DATA_HOME: custom, XDG_DATA_HOME: path.resolve('private-data'), XDG_DATA_DIRS: '/opt/xdg:/usr/share:/opt/xdg:relative' }, exists: () => true });
  assert.equal(dirs[0], path.join(custom, 'applications'));
  assert.ok(dirs.includes(path.join(home, '.local/share/flatpak/exports/share/applications')));
  assert.ok(dirs.includes('/var/lib/flatpak/exports/share/applications'));
  assert.ok(dirs.includes('/var/lib/snapd/desktop/applications'));
  assert.ok(!dirs.some(p => p.includes('private-data') || p.includes('relative')));
  assert.equal(new Set(dirs).size, dirs.length);
  assert.deepEqual(applicationDirectories({ home, env: {}, exists: () => false }), []);
});
