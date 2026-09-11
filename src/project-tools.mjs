import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { createPathGuard } from './file-roots.mjs';
import { inputValidator } from './gateway-core.mjs';

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const filename = { type: 'string', minLength: 1, maxLength: 4096 };
const outputLimit = value => ({ type: 'integer', minimum: 100, maximum: 40000, default: value });
const readOnly = { readOnlyHint: true, idempotentHint: true, openWorldHint: false };
export const projectTools = [
  { name: 'fecimus_project_search', description: 'Search project text with bounded output. Literal by default; regex requires ripgrep. Skips hidden, private and generated directories, environment files, binary files and symlinks. glob supports *, ** and ?. Results explicitly report partial searches.',
    inputSchema: object({ root: filename, query: { type: 'string', minLength: 1, maxLength: 512 }, regex: { type: 'boolean', default: false }, glob: { type: 'string', minLength: 1, maxLength: 200 }, max_results: { type: 'integer', minimum: 1, maximum: 500, default: 100 }, max_chars: outputLimit(12000) }, ['root', 'query']), annotations: readOnly },
  { name: 'fecimus_project_read', description: 'Read a bounded UTF-8 line range and obtain the complete file SHA-256 needed for an edit. Files must be at most 2 MiB; symlink paths are refused. The hash covers original bytes, including line endings.',
    inputSchema: object({ path: filename, start_line: { type: 'integer', minimum: 1, maximum: 10000000, default: 1 }, line_count: { type: 'integer', minimum: 1, maximum: 1000, default: 200 }, max_chars: outputLimit(20000) }, ['path']), annotations: readOnly },
  { name: 'fecimus_project_edit', description: 'Replace one unique literal old_text in a UTF-8 file using expected_sha256 from a fresh read, or create a missing file with expected_sha256="absent" and no old_text. Parent directory must exist. Rechecks content before atomic replacement; refuses symlinks and conflicts. No automatic retry. External editors still have a small final check-to-rename race.',
    inputSchema: object({ path: filename, expected_sha256: { type: 'string', pattern: '^(?:[a-fA-F0-9]{64}|absent)$' }, old_text: { type: 'string', minLength: 1, maxLength: 262144 }, new_text: { type: 'string', maxLength: 262144 } }, ['path', 'expected_sha256', 'new_text']), annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } },
  { name: 'fecimus_git_status', description: 'Read bounded Git status and optional staged/unstaged diffs without staging or committing. Disables external diff, text conversion, filesystem monitors, pagers and optional index writes. Exits, truncation and timeouts are reported.',
    inputSchema: object({ root: filename, diff: { type: 'boolean', default: false }, max_chars: outputLimit(16000) }, ['root']), annotations: readOnly }
];
const validators = new Map(projectTools.map(tool => [tool.name, inputValidator(tool.inputSchema)]));
const failIfAborted = signal => { if (signal?.aborted) throw new Error('Request cancelled; no new operation was dispatched.'); };
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const skippedDirs = new Set(['.git', 'node_modules', 'private', 'dist', 'build', 'Library', 'Temp', 'obj', 'bin', '.venv', 'venv', 'coverage']);

// A project edit deliberately refuses every symbolic-link component, even links
// whose current destination is inside an allowed root. The guard remains a path
// convenience, not a security boundary against adversarial filesystem mutation.
function noSymlinks(target, missingLeaf = false) {
  const parsed = path.parse(target);
  let current = parsed.root;
  const parts = target.slice(parsed.root.length).split(path.sep).filter(Boolean);
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    let stat;
    try { stat = fs.lstatSync(current); }
    catch (error) { if (error.code === 'ENOENT' && missingLeaf && index === parts.length - 1) return; throw error; }
    if (stat.isSymbolicLink()) throw new Error('Symbolic-link paths are refused by project tools.');
    if (index < parts.length - 1 && !stat.isDirectory()) throw new Error('Path parent must be a directory.');
  }
}
function resolvePath(input, guard, missingLeaf = false) {
  if (input.includes('\0')) throw new Error('Path contains a null character.');
  const resolved = guard.resolve(input);
  noSymlinks(resolved, missingLeaf);
  return resolved;
}
function resolveDirectory(input, guard) {
  const resolved = resolvePath(input, guard);
  if (!fs.statSync(resolved).isDirectory()) throw new Error('Project root must be an existing directory.');
  return resolved;
}
function sameFile(a, b) {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
}
function readText(target) {
  if (!fs.lstatSync(target).isFile()) throw new Error('Expected a regular file.');
  const fd = fs.openSync(target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0));
  try {
    const before = fs.fstatSync(fd, { bigint: true });
    if (!before.isFile()) throw new Error('Expected a regular file.');
    if (before.size > BigInt(MAX_FILE_BYTES)) throw new Error('File exceeds the 2 MiB project text limit.');
    const buffer = Buffer.alloc(Number(before.size) + 1);
    let count = 0;
    while (count < buffer.length) {
      const read = fs.readSync(fd, buffer, count, buffer.length - count, count);
      if (!read) break;
      count += read;
    }
    const after = fs.fstatSync(fd, { bigint: true });
    if (!sameFile(before, after) || count !== Number(before.size)) throw new Error('File changed while reading; read it again before editing.');
    const bytes = buffer.subarray(0, count);
    if (bytes.includes(0)) throw new Error('Binary files are not supported by project text tools.');
    const text = bytes.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(bytes)) throw new Error('File is not valid UTF-8; its encoding was not changed.');
    return { bytes, text, sha256: hash(bytes), stat: after };
  } finally { fs.closeSync(fd); }
}
function projectRead(args, guard) {
  const target = resolvePath(args.path, guard);
  const current = readText(target);
  const lines = current.text === '' ? [] : current.text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  const selected = lines.slice(args.start_line - 1, args.start_line - 1 + args.line_count);
  const content = selected.join('\n');
  const contentTruncated = content.length > args.max_chars;
  const end = selected.length ? args.start_line + selected.length - 1 : args.start_line - 1;
  return { path: target, sha256: current.sha256, bytes: current.bytes.length, total_lines: lines.length,
    start_line: args.start_line, end_line: end, content: content.slice(0, args.max_chars), content_truncated: contentTruncated,
    has_more_lines: end < lines.length, next_line: !contentTruncated && end < lines.length ? end + 1 : null };
}
function projectEdit(args, guard, signal) {
  const target = resolvePath(args.path, guard, true);
  const create = args.expected_sha256 === 'absent';
  let existing;
  try { existing = readText(target); }
  catch (error) { if (error.code !== 'ENOENT' || !create) throw error; }
  if (create && existing) throw new Error('Conflict: file already exists; no content was written.');
  if (create && args.old_text !== undefined) throw new Error('Creating a file requires no old_text.');
  if (!create && args.old_text === undefined) throw new Error('Editing an existing file requires one unique literal old_text.');
  if (!create && existing.sha256 !== args.expected_sha256.toLowerCase()) throw new Error('Conflict: SHA-256 differs from the expected file; read current content before proposing another edit.');
  let text = args.new_text;
  if (!create) {
    const first = existing.text.indexOf(args.old_text);
    if (first < 0) throw new Error('old_text was not found; no content was written.');
    if (existing.text.indexOf(args.old_text, first + 1) !== -1) throw new Error('old_text matches more than once; provide a larger unique literal context.');
    text = existing.text.slice(0, first) + args.new_text + existing.text.slice(first + args.old_text.length);
  }
  const bytes = Buffer.from(text, 'utf8');
  if (text.includes('\0') || bytes.toString('utf8') !== text) throw new Error('New content must be valid UTF-8 text without null characters.');
  if (bytes.length > MAX_FILE_BYTES) throw new Error('Edited file would exceed the 2 MiB project text limit.');
  if (existing?.bytes.equals(bytes)) return { path: target, changed: false, created: false, sha256: existing.sha256, bytes: bytes.length };
  const temporary = path.join(path.dirname(target), `.fecimus-edit-${crypto.randomUUID()}.tmp`);
  let fd;
  try {
    fd = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(fd, bytes);
    fs.fchmodSync(fd, existing ? Number(existing.stat.mode & 0o777n) : 0o666 & ~process.umask());
    fs.fsyncSync(fd);
    fs.closeSync(fd); fd = undefined;
    failIfAborted(signal);
    // Keep the last verification and commit synchronous, with no async yield.
    // This prevents competing Fecimus calls interleaving; external writers cannot
    // be made transactional with portable filesystem APIs.
    resolvePath(args.path, guard, true);
    if (create) {
      // link is an exclusive atomic publish; a concurrently created destination
      // is never overwritten, including on Windows/NTFS.
      try { fs.linkSync(temporary, target); }
      catch (error) { if (error.code === 'EEXIST') throw new Error('Conflict: file was created concurrently; no existing content was overwritten.'); throw error; }
      fs.unlinkSync(temporary);
    } else {
      const latest = readText(target);
      if (latest.sha256 !== args.expected_sha256.toLowerCase() || !sameFile(existing.stat, latest.stat)) throw new Error('Conflict: file changed before commit; no edit was applied.');
      fs.renameSync(temporary, target);
    }
    return { path: target, changed: true, created: create, previous_sha256: existing?.sha256 ?? null, sha256: hash(bytes), bytes: bytes.length };
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

// Only the portable wildcard subset is exposed, keeping rg and fallback results
// consistent without executing caller-provided JavaScript regular expressions.
function validateGlob(glob) {
  if (!glob) return;
  if (path.isAbsolute(glob) || glob.includes('..') || /[\[\]{}\\!\0]/.test(glob)) throw new Error('glob supports relative paths with only *, ** and ? wildcards.');
}
function segmentMatches(pattern, text) {
  pattern = Array.from(pattern); text = Array.from(text);
  let p = 0, t = 0, star = -1, retry = 0;
  while (t < text.length) {
    if (pattern[p] === '?' || pattern[p] === text[t]) { p++; t++; }
    else if (pattern[p] === '*') { star = p++; retry = t; }
    else if (star >= 0) { p = star + 1; t = ++retry; }
    else return false;
  }
  while (pattern[p] === '*') p++;
  return p === pattern.length;
}
function globMatches(glob, relative) {
  if (!glob) return true;
  const pattern = glob.split('/');
  const parts = (glob.includes('/') ? relative : path.posix.basename(relative)).split('/');
  const memo = new Map();
  function match(p, t) {
    const key = `${p}:${t}`;
    if (memo.has(key)) return memo.get(key);
    const result = p === pattern.length ? t === parts.length : pattern[p] === '**'
      ? match(p + 1, t) || (t < parts.length && match(p, t + 1))
      : t < parts.length && segmentMatches(pattern[p], parts[t]) && match(p + 1, t + 1);
    memo.set(key, result); return result;
  }
  return match(0, 0);
}
function searchAccumulator(args) {
  const matches = [];
  let size = 0, partial = false, reason = null;
  return {
    matches,
    add(entry) {
      const original = entry.text.replace(/[\r\n]+$/, '');
      entry.text = original.slice(0, 2000);
      if (original.length > entry.text.length) entry.text_truncated = true;
      const available = args.max_chars - size - 2;
      if (JSON.stringify({ ...entry, text: '', text_truncated: true }).length >= available) { this.stop('output limit'); return false; }
      if (JSON.stringify(entry).length > available) {
        entry.text_truncated = true;
        const source = entry.text;
        let low = 0, high = source.length;
        while (low < high) {
          const middle = Math.ceil((low + high) / 2);
          if (JSON.stringify({ ...entry, text: source.slice(0, middle) }).length <= available) low = middle;
          else high = middle - 1;
        }
        entry.text = source.slice(0, low);
      }
      size += JSON.stringify(entry).length + 1;
      matches.push(entry);
      if (matches.length >= args.max_results || size >= args.max_chars - 100) { this.stop('result or output limit'); return false; }
      return true;
    },
    stop(message) { partial = true; reason ||= message; },
    result(engine, extra = {}) { return { engine, matches, partial, ...(reason ? { reason } : {}), ...extra }; }
  };
}
async function rgSearch(args, root, options, accumulator) {
  const argv = ['--no-config', '--no-follow', '--no-hidden', '--json', '--line-number', '--max-filesize', String(MAX_FILE_BYTES), '--max-count', String(args.max_results), '--color', 'never'];
  if (!args.regex) argv.push('--fixed-strings');
  if (args.glob) argv.push('--glob', args.glob);
  for (const name of skippedDirs) argv.push('--glob', `!**/${name}/**`);
  argv.push('--glob', '!**/.*', '--glob', '!**/.*/**', '--glob', '!**/.env*', '--', args.query, '.');
  return await new Promise((resolve, reject) => {
    const child = spawn('rg', argv, { cwd: root, env: options.env || process.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let carry = '', stderr = '', stopped = false, done = false;
    const finish = (code, error) => {
      if (done) return; done = true; clearTimeout(timer); clearTimeout(killTimer); options.signal?.removeEventListener('abort', abort);
      if (error?.code === 'ENOENT') return resolve(null);
      if (error) return reject(error);
      if (code !== 0 && code !== 1 && !stopped) return reject(new Error(`ripgrep failed: ${stderr.trim() || `exit ${code}`}`));
      resolve(accumulator.result('ripgrep', { exit_code: code, ...(stderr.trim() ? { warning: stderr.trim() } : {}) }));
    };
    let killTimer;
    const stop = reason => {
      if (stopped) return; stopped = true; accumulator.stop(reason); child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 500); killTimer.unref();
    };
    const abort = () => stop('request cancelled');
    options.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => stop('5 second search limit'), 5000); timer.unref();
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      if (stopped) return;
      carry += chunk;
      if (carry.length > 3 * MAX_FILE_BYTES) return stop('search record size limit');
      let newline;
      while (!stopped && (newline = carry.indexOf('\n')) >= 0) {
        const line = carry.slice(0, newline); carry = carry.slice(newline + 1);
        let event;
        try { event = JSON.parse(line); } catch { stop('invalid ripgrep output'); break; }
        if (event.type !== 'match') continue;
        if (event.data.path.text === undefined || event.data.lines.text === undefined) { accumulator.stop('non-UTF-8 search record omitted'); continue; }
        const relative = event.data.path.text.replace(/^\.\//, '').replaceAll('\\', '/');
        if (!accumulator.add({ path: relative, line: event.data.line_number, column: Buffer.from(event.data.lines.text).subarray(0, event.data.submatches[0]?.start || 0).toString('utf8').length + 1, text: event.data.lines.text })) stop('result or output limit');
      }
    });
    child.stderr.setEncoding('utf8'); child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
    child.once('error', error => finish(null, error)); child.once('close', code => finish(code));
    if (options.signal?.aborted) abort();
  });
}
async function nodeSearch(args, root, options, accumulator) {
  if (args.regex) throw new Error('Regex search requires ripgrep (rg). Install ripgrep or use regex=false for portable literal search.');
  const deadline = Date.now() + 5000;
  let files = 0, bytes = 0, stopped = false;
  async function visit(directory) {
    if (stopped) return;
    if (options.signal?.aborted || Date.now() > deadline) { accumulator.stop(options.signal?.aborted ? 'request cancelled' : '5 second search limit'); stopped = true; return; }
    try {
      const handle = await fs.promises.opendir(directory);
      for await (const entry of handle) {
        if (stopped) break;
        if (Date.now() > deadline || options.signal?.aborted) { accumulator.stop(options.signal?.aborted ? 'request cancelled' : '5 second search limit'); stopped = true; break; }
        if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) { if (!skippedDirs.has(entry.name)) await visit(target); continue; }
        if (!entry.isFile()) continue;
        files++;
        if (files > 2000 || bytes >= 16 * MAX_FILE_BYTES) { accumulator.stop('fallback scan limit'); stopped = true; break; }
        if (Date.now() > deadline || options.signal?.aborted) { accumulator.stop(options.signal?.aborted ? 'request cancelled' : '5 second search limit'); stopped = true; break; }
        const relative = path.relative(root, target).split(path.sep).join('/');
        if (!globMatches(args.glob, relative)) continue;
        let current;
        try { noSymlinks(target); current = readText(target); }
        catch (error) { if (error.code === 'ENOENT' || /Binary|UTF-8|2 MiB/.test(error.message)) continue; accumulator.stop(`Some files could not be read: ${error.code || error.message}`); continue; }
        bytes += current.bytes.length;
        const lines = current.text.split('\n');
        for (const [index, line] of lines.entries()) {
          const column = line.indexOf(args.query);
          if (column >= 0 && !accumulator.add({ path: relative, line: index + 1, column: column + 1, text: line })) { stopped = true; break; }
        }
      }
    } catch (error) { accumulator.stop(`Some directories could not be read: ${error.code || error.message}`); }
  }
  await visit(root);
  return accumulator.result('node-literal', { files_considered: Math.min(files, 2000), bytes_scanned: bytes, gitignore: 'not interpreted by the portable fallback' });
}
async function projectSearch(args, guard, options) {
  const root = resolveDirectory(args.root, guard);
  if (/[\r\n\0]/.test(args.query)) throw new Error('Search query must be a single line without null characters.');
  validateGlob(args.glob);
  const accumulator = searchAccumulator(args);
  const result = await rgSearch(args, root, options, accumulator);
  return { root, ...(result || await nodeSearch(args, root, options, accumulator)) };
}

async function captureGit(argv, root, options, maxChars) {
  const env = { ...(options.env || process.env) };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  Object.assign(env, { GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat' });
  const command = ['--no-pager', '--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', '-c', 'core.hooksPath=', ...argv];
  return await new Promise(resolve => {
    const child = spawn('git', command, { cwd: root, env, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', stderr = '', truncated = false, reason = null, done = false, killTimer, drainTimer;
    const kill = signal => {
      try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal); else child.kill(signal); }
      catch (error) { if (error.code !== 'ESRCH') stderr = (stderr + error.message).slice(-2000); }
    };
    const stop = why => { if (reason) return; reason = why; kill('SIGTERM'); killTimer = setTimeout(() => kill('SIGKILL'), 500); killTimer.unref(); };
    const abort = () => stop('request cancelled');
    const timer = setTimeout(() => stop('5 second Git command limit'), 5000); timer.unref();
    options.signal?.addEventListener('abort', abort, { once: true });
    child.stdout.setEncoding('utf8'); child.stdout.on('data', chunk => {
      if (output.length + chunk.length > maxChars) { truncated = true; output = (output + chunk).slice(0, maxChars); stop('output limit'); }
      else output += chunk;
    });
    child.stderr.setEncoding('utf8'); child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-2000); });
    const finish = (exitCode, error) => {
      if (done) return; done = true; clearTimeout(timer); clearTimeout(killTimer); clearTimeout(drainTimer); options.signal?.removeEventListener('abort', abort);
      child.stdout.destroy(); child.stderr.destroy();
      resolve({ text: output, exit_code: exitCode, truncated, ...(reason ? { reason } : {}), ...(error ? { error: error.message } : stderr.trim() ? { [exitCode === 0 ? 'warning' : 'error']: stderr.trim() } : {}) });
    };
    child.once('error', error => finish(null, error));
    child.once('exit', code => { kill('SIGKILL'); drainTimer = setTimeout(() => finish(code), 100); });
    child.once('close', code => finish(code));
    if (options.signal?.aborted) abort();
  });
}
async function gitStatus(args, guard, options) {
  const root = resolveDirectory(args.root, guard);
  const status = await captureGit(['status', '--porcelain=v1', '--branch', '--untracked-files=normal'], root, options, args.max_chars);
  const result = { root, status, read_only: true };
  if (args.diff && status.exit_code === 0 && !options.signal?.aborted) {
    const [unstaged, staged] = await Promise.all([
      captureGit(['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--'], root, options, args.max_chars),
      captureGit(['diff', '--cached', '--no-ext-diff', '--no-textconv', '--no-color', '--'], root, options, args.max_chars)
    ]);
    let remaining = Math.max(0, args.max_chars - status.text.length);
    for (const [key, value] of [['unstaged_diff', unstaged], ['staged_diff', staged]]) {
      if (value.text.length > remaining) { value.text = value.text.slice(0, remaining); value.truncated = true; value.reason ||= 'combined output limit'; }
      remaining -= value.text.length; result[key] = value;
    }
  }
  result.partial = Object.values(result).some(value => value && typeof value === 'object' && (value.truncated || value.reason || value.error));
  result.failed = [result.status, result.unstaged_diff, result.staged_diff].filter(Boolean).some(value => value.error || (value.exit_code !== 0 && !value.truncated));
  return result;
}

export async function callProjectTool(name, input, options = {}) {
  try {
    const validate = validators.get(name);
    if (!validate) throw new Error(`Unknown project tool: ${name}`);
    const args = validate(input);
    failIfAborted(options.signal);
    const guard = createPathGuard({ home: options.home || os.homedir(), roots: options.roots ?? options.env?.FECIMUS_FILE_ROOTS ?? process.env.FECIMUS_FILE_ROOTS });
    let result;
    if (name === 'fecimus_project_read') result = projectRead(args, guard);
    else if (name === 'fecimus_project_edit') result = projectEdit(args, guard, options.signal);
    else if (name === 'fecimus_project_search') result = await projectSearch(args, guard, options);
    else result = await gitStatus(args, guard, options);
    return { content: [{ type: 'text', text: JSON.stringify(result) }], ...(result.failed ? { isError: true } : {}) };
  } catch (error) {
    return { isError: true, content: [{ type: 'text', text: `${name}: ${error.message || error}` }] };
  }
}
