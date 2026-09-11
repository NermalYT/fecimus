import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const python = process.platform === 'win32' ? 'python' : 'python3';

test('setup helper invokes real addon inspect/install/list without executing addon code', () => {
  const code = String.raw`
import importlib.util, os, pathlib, tempfile, subprocess, json
root = pathlib.Path.cwd()
spec = importlib.util.spec_from_file_location('setup', root/'scripts/setup-gui.py')
setup = importlib.util.module_from_spec(spec); spec.loader.exec_module(setup)
with tempfile.TemporaryDirectory(prefix='fecimus setup ') as tmp:
    os.environ['FECIMUS_DATA_DIR'] = str(pathlib.Path(tmp)/'private')
    folder = root/'examples/hello-addon'
    inspected = subprocess.run(setup.addon_command('inspect', folder), capture_output=True, text=True, check=True)
    assert 'hello' in inspected.stdout
    installed = subprocess.run(setup.addon_command('install', folder), capture_output=True, text=True, check=True)
    assert 'hello' in installed.stdout
    listed = subprocess.run(setup.addon_command('list'), capture_output=True, text=True, check=True)
    assert 'hello' in listed.stdout
    duplicate = subprocess.run(setup.addon_command('install', folder), capture_output=True, text=True)
    assert duplicate.returncode != 0
    try: setup.addon_command('remove', folder)
    except ValueError: pass
    else: raise AssertionError('unexpected action allowed')
    try: setup.addon_command('inspect', root/'package.json')
    except ValueError: pass
    else: raise AssertionError('file accepted as folder')
`;
  const result = spawnSync(python, ['-c', code], { cwd: root, encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
});

test('Linux setup worker retains failure logs and completion without installing on the host', { skip: process.platform === 'win32' }, () => {
  const code = String.raw`
import importlib.util, pathlib, tempfile, json
root = pathlib.Path.cwd()
spec = importlib.util.spec_from_file_location('setup', root/'scripts/setup-gui.py')
setup = importlib.util.module_from_spec(spec); spec.loader.exec_module(setup)
with tempfile.TemporaryDirectory(prefix='fecimus worker ') as tmp:
    setup.ROOT = pathlib.Path(tmp)
    launcher = setup.ROOT/'platform/Linux/INSTALL_FECIMUS.sh'
    launcher.parent.mkdir(parents=True)
    launcher.write_text('#!/bin/bash\nprintf "failure detail"\nexit 7\n')
    result = setup.ROOT/'result.json'
    assert setup.install_worker(result) == 7
    assert json.loads(result.read_text())['exit_code'] == 7
    assert 'failure detail' in result.with_suffix('.log').read_text()
`;
  const result = spawnSync(python, ['-c', code], { cwd: root, encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
