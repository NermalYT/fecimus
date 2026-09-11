import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { callProjectTool, projectTools } from '../src/project-tools.mjs';
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const available = executable => { try { execFileSync(executable, ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } };
const rgPresent = available('rg');
const gitPresent = available('git');
async function fixture(t) {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'fecimus-project-test-'));
  const root = path.join(home, 'project with spaces'); await fsp.mkdir(root);
  const options = { home, roots: [], env: process.env };
  t.after(() => fsp.rm(home, { recursive: true, force: true }));
  const call = (name, args, extra = {}) => callProjectTool(name, args, { ...options, ...extra });
  return { home, root, call, options };
}
function data(result) { assert(!result.isError, result.content[0].text); return JSON.parse(result.content[0].text); }
function failure(result, pattern) { assert.equal(result.isError, true); assert.match(result.content[0].text, pattern); }

test('project read returns byte-exact hash, preserves CRLF/Unicode and bounds line output', async t => {
  const { root, call } = await fixture(t);
  const target = path.join(root, 'source.js'); const text = 'const 世界 = 1;\r\nconst second = "two";\r\nthird\r\n';
  await fsp.writeFile(target, text);
  const read = data(await call('fecimus_project_read', { path: target, start_line: 2, line_count: 1 }));
  assert.equal(read.sha256, hash(text)); assert.equal(read.total_lines, 3);
  assert.equal(read.content, 'const second = "two";\r'); assert.equal(read.next_line, 3);
  await fsp.writeFile(target, 'x'.repeat(1000));
  const clipped = data(await call('fecimus_project_read', { path: target, max_chars: 100 }));
  assert.equal(clipped.content.length, 100); assert.equal(clipped.content_truncated, true); assert.equal(clipped.next_line, null);
  await fsp.writeFile(target, '');
  const empty = data(await call('fecimus_project_read', { path: target })); assert.equal(empty.total_lines, 0); assert.equal(empty.sha256, hash(''));
});

test('literal edits require a fresh hash and a unique non-regex match', async t => {
  const { root, call } = await fixture(t);
  const target = path.join(root, 'a.js'); const original = 'const item = "a.$(literal)";\n';
  await fsp.writeFile(target, original, { mode: 0o755 });
  const read = data(await call('fecimus_project_read', { path: target }));
  const edit = data(await call('fecimus_project_edit', { path: target, expected_sha256: read.sha256, old_text: 'a.$(literal)', new_text: '$&\\literal\n世界' }));
  const expected = original.replace('a.$(literal)', () => '$&\\literal\n世界');
  assert.equal(await fsp.readFile(target, 'utf8'), expected); assert.equal(edit.sha256, hash(expected));
  if (process.platform !== 'win32') assert.equal((await fsp.stat(target)).mode & 0o777, 0o755);
  failure(await call('fecimus_project_edit', { path: target, expected_sha256: read.sha256, old_text: 'const', new_text: 'let' }), /Conflict/);
  await fsp.writeFile(target, 'aaa');
  failure(await call('fecimus_project_edit', { path: target, expected_sha256: hash('aaa'), old_text: 'aa', new_text: 'z' }), /more than once/);
  failure(await call('fecimus_project_edit', { path: target, expected_sha256: hash('aaa'), old_text: 'missing', new_text: 'z' }), /not found/);
  assert.equal(await fsp.readFile(target, 'utf8'), 'aaa');
  assert(!(await fsp.readdir(root)).some(name => name.startsWith('.fecimus-edit-')));
});

test('exclusive create never overwrites a preexisting file and requires existing parents', async t => {
  const { root, call } = await fixture(t); const target = path.join(root, 'new.txt');
  const created = data(await call('fecimus_project_edit', { path: target, expected_sha256: 'absent', new_text: 'created' }));
  assert.equal(created.created, true); assert.equal(created.sha256, hash('created'));
  failure(await call('fecimus_project_edit', { path: target, expected_sha256: 'absent', new_text: 'overwritten' }), /already exists/);
  failure(await call('fecimus_project_edit', { path: path.join(root, 'missing-parent', 'new'), expected_sha256: 'absent', new_text: 'x' }), /ENOENT/);
  failure(await call('fecimus_project_edit', { path: path.join(root, 'bad'), expected_sha256: 'absent', old_text: 'x', new_text: 'x' }), /no old_text/);
  assert.equal(await fsp.readFile(target, 'utf8'), 'created');
});

test('last-moment content and creation conflicts preserve the human edit and clean temporary files', async t => {
  const { root, call } = await fixture(t); const target = path.join(root, 'race.txt');
  await fsp.writeFile(target, 'original');
  const realSync = fs.fsyncSync;
  let once = true;
  fs.fsyncSync = function(fd) { realSync(fd); if (once) { once = false; fs.writeFileSync(target, 'human edit'); } };
  try { failure(await call('fecimus_project_edit', { path: target, expected_sha256: hash('original'), old_text: 'original', new_text: 'AI edit' }), /Conflict/); }
  finally { fs.fsyncSync = realSync; }
  assert.equal(await fsp.readFile(target, 'utf8'), 'human edit');
  const other = path.join(root, 'created-during-commit');
  const realLink = fs.linkSync;
  fs.linkSync = function(source, destination) { fs.writeFileSync(destination, 'human create'); return realLink(source, destination); };
  try { failure(await call('fecimus_project_edit', { path: other, expected_sha256: 'absent', new_text: 'AI create' }), /concurrently/); }
  finally { fs.linkSync = realLink; }
  assert.equal(await fsp.readFile(other, 'utf8'), 'human create');
  assert(!(await fsp.readdir(root)).some(name => name.startsWith('.fecimus-edit-')));
});

test('two simultaneous Fecimus edits with one expected hash allow exactly one mutation', async t => {
  const { root, call } = await fixture(t); const target = path.join(root, 'parallel.txt');
  await fsp.writeFile(target, 'original');
  const outputs = await Promise.all(['first', 'second'].map(new_text => call('fecimus_project_edit', { path: target, expected_sha256: hash('original'), old_text: 'original', new_text })));
  assert.equal(outputs.filter(value => value.isError).length, 1);
  assert.equal(await fsp.readFile(target, 'utf8'), 'first');
});

test('path boundaries, binary/encoding/size limits, and cancellation prevent mutations', async t => {
  const { home, root, call } = await fixture(t);
  failure(await call('fecimus_project_read', { path: path.dirname(home) }), /Access denied/);
  const target = path.join(root, 'data');
  await fsp.writeFile(target, Buffer.from([0, 1, 2])); failure(await call('fecimus_project_read', { path: target }), /Binary/);
  await fsp.writeFile(target, Buffer.from([0xff, 0xff])); failure(await call('fecimus_project_read', { path: target }), /UTF-8/);
  const handle = await fsp.open(target, 'w'); await handle.truncate(3 * 1024 * 1024); await handle.close();
  failure(await call('fecimus_project_read', { path: target }), /2 MiB/);
  const abort = new AbortController(); abort.abort();
  failure(await call('fecimus_project_edit', { path: path.join(root, 'cancelled'), expected_sha256: 'absent', new_text: 'x' }, { signal: abort.signal }), /cancelled/);
  assert.equal(fs.existsSync(path.join(root, 'cancelled')), false);
  assert.equal(projectTools.length, 4);
});

test('symlink leaf and directory paths are refused and FIFO reads never block', async t => {
  const { root, call } = await fixture(t);
  const target = path.join(root, 'real'); await fsp.writeFile(target, 'content');
  const link = path.join(root, 'alias');
  try { await fsp.symlink(target, link); }
  catch (error) { if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) return t.skip('Windows symlink privilege unavailable.'); throw error; }
  failure(await call('fecimus_project_read', { path: link }), /Symbolic-link/);
  failure(await call('fecimus_project_edit', { path: link, expected_sha256: hash('content'), old_text: 'content', new_text: 'changed' }), /Symbolic-link/);
  const directoryLink = path.join(root, 'directory-alias'); await fsp.symlink(root, directoryLink, process.platform === 'win32' ? 'junction' : 'dir');
  failure(await call('fecimus_project_edit', { path: path.join(directoryLink, 'new'), expected_sha256: 'absent', new_text: 'x' }), /Symbolic-link/);
  if (process.platform === 'linux') {
    const fifo = path.join(root, 'pipe'); execFileSync('mkfifo', [fifo]);
    failure(await call('fecimus_project_read', { path: fifo }), /regular file/);
  }
  assert.equal(await fsp.readFile(target, 'utf8'), 'content');
});

async function searchFixture(root) {
  await fsp.mkdir(path.join(root, 'src'));
  for (const dir of ['private', 'node_modules', 'Library', '.hidden']) { await fsp.mkdir(path.join(root, dir)); await fsp.writeFile(path.join(root, dir, 'secret.js'), 'needle'); }
  await fsp.writeFile(path.join(root, '.env'), 'needle');
  await fsp.writeFile(path.join(root, '.secret.js'), 'needle');
  await fsp.writeFile(path.join(root, 'src', 'main.js'), '世界 needle\nconst other = "literal $(x).*";\n');
  await fsp.writeFile(path.join(root, 'other.txt'), 'needle');
}

test('portable literal search handles globs, Unicode and default exclusions without rg', async t => {
  const { root, call } = await fixture(t); await searchFixture(root);
  const result = data(await call('fecimus_project_search', { root, query: 'needle', glob: '**/*.js' }, { env: { ...process.env, PATH: root, Path: root } }));
  assert.equal(result.engine, 'node-literal'); assert.equal(result.partial, false);
  assert.deepEqual(result.matches.map(match => [match.path, match.column]), [['src/main.js', 4]]);
  failure(await call('fecimus_project_search', { root, query: '.*', regex: true }, { env: { ...process.env, PATH: root, Path: root } }), /requires ripgrep/);
  failure(await call('fecimus_project_search', { root, query: 'x', glob: '../*' }), /relative paths/);
});

test('ripgrep search uses explicit literal/regex modes and ignores unsafe config', { skip: !rgPresent }, async t => {
  const { root, call } = await fixture(t); await searchFixture(root);
  const config = path.join(root, 'rg-config'); await fsp.writeFile(config, '--hidden\n--follow\n');
  const result = data(await call('fecimus_project_search', { root, query: 'needle', glob: '**/*.js' }, { env: { ...process.env, RIPGREP_CONFIG_PATH: config } }));
  assert.equal(result.engine, 'ripgrep'); assert.equal(result.matches.length, 1); assert.equal(result.matches[0].column, 4);
  const literal = data(await call('fecimus_project_search', { root, query: 'literal $(x).*' })); assert.equal(literal.matches.length, 1);
  const regex = data(await call('fecimus_project_search', { root, query: 'needl[e]', regex: true, glob: '*.txt' })); assert.equal(regex.matches[0].path, 'other.txt');
  failure(await call('fecimus_project_search', { root, query: '(', regex: true }), /ripgrep failed/);
});

test('search result and escaped-text bounds are reported explicitly', async t => {
  const { root, call } = await fixture(t);
  await fsp.writeFile(path.join(root, 'large.txt'), Array(100).fill('match ' + '"\\\t'.repeat(1000)).join('\n'));
  for (const env of [process.env, { ...process.env, PATH: root, Path: root }]) {
    const result = data(await call('fecimus_project_search', { root, query: 'match', max_results: 2, max_chars: 1000 }, { env }));
    assert(result.partial); assert(result.matches.length <= 2); assert(JSON.stringify(result.matches).length <= 1000);
    assert.equal(result.matches[0].text_truncated, true);
  }
});

test('Git status/diffs are read-only, bounded and suppress configured external programs', { skip: !gitPresent }, async t => {
  const { root, call } = await fixture(t);
  const git = args => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
  git(['init']);
  git(['config', 'core.autocrlf', 'true']);
  await fsp.writeFile(path.join(root, 'a.txt'), 'before\n'); git(['add', 'a.txt']);
  git(['-c', 'user.name=Fecimus Test', '-c', 'user.email=fecimus-test@example.invalid', 'commit', '-m', 'fixture']);
  await fsp.writeFile(path.join(root, 'a.txt'), 'staged\n'); git(['add', 'a.txt']);
  await fsp.writeFile(path.join(root, 'a.txt'), 'working\n' + 'line\n'.repeat(300));
  const marker = path.join(root, 'should-not-run');
  const helper = path.join(root, 'external-helper');
  await fsp.writeFile(helper, '#!/bin/sh\ntouch "' + marker.replaceAll('"', '\\"') + '"\n', { mode: 0o700 });
  git(['config', 'diff.external', helper]); git(['config', 'core.fsmonitor', helper]);
  const indexBefore = hash(await fsp.readFile(path.join(root, '.git', 'index')));
  const result = data(await call('fecimus_git_status', { root, diff: true, max_chars: 40000 }, { env: { ...process.env, GIT_DIR: '/nonexistent-should-not-be-used' } }));
  assert.equal(result.failed, false);
  assert.match(result.status.text, /MM a\.txt/);
  assert.match(result.staged_diff.text, /\+staged/); assert.match(result.unstaged_diff.text, /\+working/);
  assert.equal(fs.existsSync(marker), false); assert.equal(hash(await fsp.readFile(path.join(root, '.git', 'index'))), indexBefore);
  const bounded = data(await call('fecimus_git_status', { root, diff: true, max_chars: 100 }));
  assert(bounded.partial); assert([bounded.status, bounded.staged_diff, bounded.unstaged_diff].reduce((sum, value) => sum + (value?.text.length || 0), 0) <= 100);
  const outsideRepo = path.dirname(root); failure(await call('fecimus_git_status', { root: outsideRepo }), /not a git repository/);
});

test('Git cancellation cleans descendant processes and cannot hang on inherited pipes', { skip: process.platform !== 'linux' }, async t => {
  const { root, call } = await fixture(t);
  const bin = path.join(root, 'fake-bin'); await fsp.mkdir(bin);
  const marker = path.join(root, 'descendant.pid');
  const childCode = `require('fs').writeFileSync(${JSON.stringify(marker)},String(process.pid));process.on('SIGTERM',()=>{});setInterval(()=>{},1000);`;
  const fakeGit = `#!${process.execPath}\nrequire('child_process').spawn(process.execPath,['-e',${JSON.stringify(childCode)}],{stdio:'inherit'});setInterval(()=>{},1000);`;
  await fsp.writeFile(path.join(bin, 'git'), fakeGit, { mode: 0o700 });
  const abort = new AbortController();
  const pending = call('fecimus_git_status', { root }, { signal: abort.signal, env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH } });
  const deadline = Date.now() + 4000;
  while (!fs.existsSync(marker) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
  assert(fs.existsSync(marker));
  const pid = Number(await fsp.readFile(marker, 'utf8'));
  abort.abort();
  const result = await pending; assert.equal(result.isError, true); assert.match(result.content[0].text, /request cancelled/);
  let alive = true;
  for (let i = 0; i < 100; i++) {
    try { alive = !/\) Z /.test(await fsp.readFile(`/proc/${pid}/stat`, 'utf8')); }
    catch (error) { if (['ENOENT', 'ESRCH'].includes(error.code)) alive = false; else throw error; }
    if (!alive) break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(alive, false);
});
