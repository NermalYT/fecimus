import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const MAX_FILE = 8 * 1024 * 1024;
const MAX_TOTAL = 32 * 1024 * 1024;
const MAX_FILES = 1000;
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const semver = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/;
const idPattern = /^[a-z]+-[0-9a-f-]{36}$/;
const manifests = new Set(['SOURCE_MANIFEST.json', 'RELEASE_MANIFEST.json']);
const rootFiles = new Set(['package.json', 'package-lock.json', 'LICENSE', '.gitignore', '.gitattributes', 'INSTALL_FECIMUS.sh', 'INSTALL_FECIMUS.cmd', 'install-fecimus.py', ...manifests]);
const sourceDirs = new Set(['src', 'scripts', 'docs', 'test', 'platform', '.github', 'examples', 'addons']);
const extensions = new Set(['.mjs', '.js', '.cjs', '.py', '.json', '.md', '.sh', '.ps1', '.cmd', '.yml', '.yaml', '.html', '.css', '.txt', '.svg']);
const excluded = new Set(['node_modules', '.git', '.venv', 'venv', '__pycache__', 'private', 'profiles', 'browser-profiles', 'browser-output', 'app-homes', 'workspace-notes', 'runtime', 'backups', 'maintenance', 'dist', '.test-output', '.test-state']);
const same = (a, b) => a?.sha256 === b?.sha256 && a?.mode === b?.mode;
const entry = (name, file) => ({ path: name, size: file.bytes.length, sha256: file.sha256, mode: file.mode });
const abort = signal => { if (signal?.aborted) throw new Error('Service maintenance cancelled; inspect status and backups before retrying.'); };

export const serviceTools = [{
  name: 'fecimus_service',
  description: 'Maintain this installed Fecimus source privately. status discovers its path, source revision and upgrade guide; backup saves source/docs only; check runs bounded syntax/package checks. prepare downloads and verifies an exact official GitHub release without executing it. apply preserves local edits and refuses conflicts or dependency changes. restore/apply require a fresh expected_revision and create a safety backup. No publishing, dependency installation or automatic restart. Source changes activate on the next host restart.',
  inputSchema: { type: 'object', additionalProperties: false, required: ['action'], properties: {
    action: { type: 'string', enum: ['status', 'backup', 'check', 'restore', 'prepare', 'apply'] },
    version: { type: 'string', minLength: 5, maxLength: 80, description: 'Exact released version, without v; required by prepare.' },
    backup_id: { type: 'string', pattern: idPattern.source },
    stage_id: { type: 'string', pattern: idPattern.source },
    expected_revision: { type: 'string', pattern: '^[a-f0-9]{64}$', description: 'Fresh source_revision from status, required by restore/apply.' },
    label: { type: 'string', maxLength: 160 },
  } },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
}];

function safeName(name) {
  if (typeof name !== 'string' || !name || name.includes('\\') || name.includes(':') || /[\x00-\x1f]/.test(name) || path.posix.isAbsolute(name) || name.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part) || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part))) throw new Error('Unsafe maintenance source path.');
  return name;
}
function publicName(name) {
  safeName(name);
  const parts = name.split('/');
  if (parts.some(part => excluded.has(part) || part.toLowerCase().startsWith('.env'))) return false;
  if (parts.length === 1) return rootFiles.has(name) || name.endsWith('.md');
  return sourceDirs.has(parts[0]) && (extensions.has(path.posix.extname(name)) || parts.at(-1) === 'LICENSE');
}
function inspectPath(filename, missing = false) {
  const absolute = path.resolve(filename);
  let current = path.parse(absolute).root;
  for (const part of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    let stat;
    try { stat = fs.lstatSync(current); } catch (error) { if (missing && error.code === 'ENOENT') return; throw error; }
    if (stat.isSymbolicLink()) throw new Error('Maintenance refuses symbolic-link paths.');
    if (current !== absolute && !stat.isDirectory()) throw new Error('Maintenance path parent is not a directory.');
  }
}
function privateDir(directory) {
  inspectPath(directory, true);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  inspectPath(directory);
  if (!fs.statSync(directory).isDirectory()) throw new Error('Maintenance storage must be a directory.');
  if (process.platform !== 'win32') fs.chmodSync(directory, 0o700);
}
function readFile(filename, maximum = MAX_FILE) {
  inspectPath(filename);
  const before = fs.lstatSync(filename, { bigint: true });
  if (!before.isFile() || before.nlink !== 1n || before.size > BigInt(maximum)) throw new Error('Maintenance requires a regular, unlinked file within its size limit.');
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0));
  try {
    const opened = fs.fstatSync(fd, { bigint: true });
    if (opened.dev !== before.dev || opened.ino !== before.ino || !opened.isFile()) throw new Error('Source changed while opening it.');
    const bytes = Buffer.alloc(Number(before.size) + 1);
    let count = 0;
    while (count < bytes.length) { const n = fs.readSync(fd, bytes, count, bytes.length - count, count); if (!n) break; count += n; }
    const after = fs.fstatSync(fd, { bigint: true });
    if (count !== Number(before.size) || after.size !== before.size || after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs) throw new Error('Source changed while reading it.');
    const data = bytes.subarray(0, count);
    return { bytes: data, sha256: hash(data), mode: Number(before.mode & 0o777n) & 0o111 ? 0o755 : 0o644 };
  } finally { fs.closeSync(fd); }
}
function snapshot(root, signal, excludedRoot) {
  inspectPath(root);
  const files = new Map(); let total = 0;
  function walk(directory, prefix = '') {
    abort(signal);
    const children = fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const child of children) {
      const relative = prefix ? `${prefix}/${child.name}` : child.name;
      if (excluded.has(child.name) || child.name.toLowerCase().startsWith('.env')) continue;
      const target = path.join(directory, child.name);
      if (target === excludedRoot) continue;
      if (child.isDirectory()) { if (prefix || sourceDirs.has(child.name)) walk(target, relative); }
      else if (publicName(relative)) {
        const file = readFile(target);
        total += file.bytes.length;
        if (files.size >= MAX_FILES || total > MAX_TOTAL) throw new Error('Source snapshot exceeds 1,000 files or 32 MiB.');
        files.set(relative, file);
      } else if (!prefix && sourceDirs.has(child.name)) throw new Error('Source directories cannot be symbolic links or files.');
    }
  }
  walk(root);
  const revision = hash(JSON.stringify([...files].map(([name, file]) => entry(name, file)).sort((a, b) => a.path.localeCompare(b.path))));
  return { files, revision, bytes: total };
}
function decodeManifest(bytes) {
  const manifest = JSON.parse(bytes.toString('utf8'));
  if (manifest?.format !== 1 || manifest?.project !== 'fecimus' || !semver.test(manifest.version) || !Array.isArray(manifest.files) || manifest.files.length > MAX_FILES) throw new Error('Invalid installed source manifest.');
  const files = new Map();
  for (const file of manifest.files) {
    if (!publicName(file.path) || files.has(file.path) || !/^[a-f0-9]{64}$/.test(file.sha256) || ![0o644, 0o755].includes(file.mode) || !Number.isInteger(file.size) || file.size < 0 || file.size > MAX_FILE) throw new Error('Invalid installed source manifest entry.');
    files.set(file.path, file);
  }
  return { manifest, files };
}
function baseline(files) {
  for (const name of ['SOURCE_MANIFEST.json', 'RELEASE_MANIFEST.json']) if (files.has(name)) return { name, ...decodeManifest(files.get(name).bytes) };
  return null;
}
function modifications(current, base) {
  if (!base) return { known: false, added: [], modified: [], deleted: [] };
  const added = [], modified = [], deleted = [];
  for (const [name, file] of current) if (!manifests.has(name)) {
    if (!base.files.has(name)) added.push(name);
    else if (!same(file, base.files.get(name))) modified.push(name);
  }
  for (const name of base.files.keys()) if (!manifests.has(name) && !current.has(name)) deleted.push(name);
  return { known: true, added, modified, deleted };
}
function exclusiveWrite(filename, bytes, mode = 0o600) {
  inspectPath(filename, true);
  const fd = fs.openSync(filename, 'wx', mode);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function atomicWrite(filename, file) {
  inspectPath(filename, true);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  inspectPath(path.dirname(filename));
  const temporary = `${filename}.${crypto.randomUUID()}.tmp`;
  try { exclusiveWrite(temporary, file.bytes, file.mode); fs.renameSync(temporary, filename); }
  finally { fs.rmSync(temporary, { force: true }); }
}
function savedRecord(directory, record) { exclusiveWrite(path.join(directory, 'record.json'), Buffer.from(JSON.stringify(record, null, 2) + '\n')); }
function loadSaved(directory, expectedKind, root) {
  const record = JSON.parse(readFile(path.join(directory, 'record.json'), 512 * 1024).bytes);
  if (record.format !== 1 || record.kind !== expectedKind || record.root !== root || !Array.isArray(record.files) || record.files.length > MAX_FILES) throw new Error('Invalid maintenance record or different installation root.');
  const files = new Map(); let total = 0;
  for (const stored of record.files) {
    if (!publicName(stored.path) || files.has(stored.path)) throw new Error('Invalid maintenance record path.');
    const actual = readFile(path.join(directory, 'source', stored.path));
    if (actual.sha256 !== stored.sha256 || actual.bytes.length !== stored.size || ![0o644, 0o755].includes(stored.mode)) throw new Error('Maintenance record checksum mismatch.');
    total += actual.bytes.length;
    if (total > MAX_TOTAL) throw new Error('Maintenance record exceeds 32 MiB.');
    files.set(stored.path, { ...actual, mode: stored.mode });
  }
  return { record, files };
}
function dependencyShape(files) {
  const pkg = JSON.parse(files.get('package.json')?.bytes.toString() || 'null');
  if (!pkg || typeof pkg !== 'object') throw new Error('package.json is missing or invalid.');
  const lock = JSON.parse(files.get('package-lock.json')?.bytes.toString() || 'null');
  if (!lock || typeof lock !== 'object' || !lock.packages?.['']) throw new Error('package-lock.json must use the current packages format.');
  const rootLock = { ...lock.packages[''] }; delete rootLock.version;
  const lockBody = { ...lock, version: undefined, packages: { ...lock.packages, '': rootLock } };
  return JSON.stringify({ dependencies: pkg.dependencies, devDependencies: pkg.devDependencies, optionalDependencies: pkg.optionalDependencies, peerDependencies: pkg.peerDependencies, overrides: pkg.overrides, engines: pkg.engines, packageManager: pkg.packageManager, lock: lockBody });
}
const extractScript = String.raw`
import importlib.util, pathlib, sys, json
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('fecimus_trusted_release_verifier', sys.argv[1])
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)
archive = pathlib.Path(sys.argv[2]).read_bytes()
kind = '.zip' if sys.argv[5] == 'windows' else '.tar.gz'
report = verifier.verify(archive, kind)
if report['version'] != sys.argv[4] or report['platform'] != sys.argv[5]:
    raise ValueError('Release version/platform mismatch.')
_, files = verifier.read_archive(archive, kind)
root = pathlib.Path(sys.argv[3])
root.mkdir(mode=0o700)
for name, (data, mode) in files.items():
    target = root.joinpath(*pathlib.PurePosixPath(name).parts)
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open('xb') as output:
        output.write(data)
    target.chmod(mode)
print(json.dumps(report))
`;

export function createServiceMaintenance({ root, dataDir = path.join(os.homedir(), '.local/share/fecimus'), fetchImpl = globalThis.fetch, pythonCommand = process.platform === 'win32' ? 'python' : 'python3' } = {}) {
  if (!path.isAbsolute(root || '') || !path.isAbsolute(dataDir || '')) throw new Error('Absolute installation root and dataDir are required.');
  root = path.resolve(root); dataDir = path.resolve(dataDir);
  if (root === dataDir) throw new Error('The source installation and private data directories must be separate.');
  const storage = path.join(dataDir, 'maintenance');
  const sourceSnapshot = signal => snapshot(root, signal, dataDir);
  let busy = false;
  function init() { privateDir(storage); }
  function list(kind) {
    if (!fs.existsSync(storage)) return [];
    inspectPath(storage);
    return fs.readdirSync(storage).filter(name => name.startsWith(`${kind}-`) && idPattern.test(name)).sort();
  }
  function status(signal) {
    const current = sourceSnapshot(signal);
    const base = baseline(current.files);
    const pkg = JSON.parse(current.files.get('package.json')?.bytes.toString() || '{}');
    return { installation_root: root, data_directory: dataDir, version: pkg.version || null, source_revision: current.revision, source_files: current.files.size, source_bytes: current.bytes, baseline: base ? { path: path.join(root, base.name), version: base.manifest.version } : null, modifications: modifications(current.files, base), upgrade_guide: path.join(root, 'docs', 'UPGRADING.md'), official_guide: 'https://github.com/NermalYT/fecimus/blob/main/docs/UPGRADING.md', backups: list('backup'), stages: list('stage'), maintenance_lock: fs.existsSync(path.join(storage, 'writer.lock')) ? path.join(storage, 'writer.lock') : null, activation: 'Restart Fecimus through the MCP host after reporting results; this tool never kills the serving process.' };
  }
  async function locked(operation, signal) {
    abort(signal); init();
    if (busy) throw new Error('Another maintenance writer is active.');
    const lock = path.join(storage, 'writer.lock');
    try { exclusiveWrite(lock, Buffer.from(JSON.stringify({ pid: process.pid, root, created_at: new Date().toISOString() }))); }
    catch (error) { if (error.code === 'EEXIST') throw new Error(`Maintenance writer lock exists: ${lock}. If a process crashed, verify its recorded PID is gone before manually removing this file.`); throw error; }
    busy = true;
    try { return await operation(); } finally { busy = false; fs.rmSync(lock, { force: true }); }
  }
  function backup(current, label = '') {
    if (list('backup').length >= 100) throw new Error('100 local source backups exist; review and archive older backups manually.');
    const id = `backup-${crypto.randomUUID()}`;
    const directory = path.join(storage, id); privateDir(directory);
    try {
      for (const [name, file] of current.files) { const target = path.join(directory, 'source', name); fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 }); exclusiveWrite(target, file.bytes); }
      savedRecord(directory, { format: 1, kind: 'backup', root, label, created_at: new Date().toISOString(), source_revision: current.revision, files: [...current.files].map(([name, file]) => entry(name, file)) });
      return { backup_id: id, path: directory, source_revision: current.revision, files: current.files.size, bytes: current.bytes, scope: 'Source and documentation only; settings, addons, profiles, projects and model data are excluded.' };
    } catch (error) { fs.rmSync(directory, { recursive: true, force: true }); throw error; }
  }
  function transact(current, desired, signal, label) {
    abort(signal);
    if (sourceSnapshot(signal).revision !== current.revision) throw new Error('Source revision changed; obtain a fresh status and review the changes.');
    const safety = backup(current, label);
    const changed = [];
    const names = [...new Set([...current.files.keys(), ...desired.keys()])].sort();
    try {
      for (const name of names) {
        abort(signal);
        const before = current.files.get(name), after = desired.get(name);
        if (same(before, after)) continue;
        const target = path.join(root, name);
        let actual;
        try { actual = readFile(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (!same(actual, before)) throw new Error(`Source changed before commit: ${name}`);
        if (after) atomicWrite(target, after); else fs.unlinkSync(target);
        changed.push({ name, before, after });
      }
      return { changed: changed.map(item => item.name), safety_backup: safety.backup_id, source_revision: sourceSnapshot(signal).revision, restart_required: changed.length > 0 };
    } catch (error) {
      const conflicts = [];
      for (const item of changed.reverse()) {
        const target = path.join(root, item.name);
        try {
          let actual;
          try { actual = readFile(target); } catch (readError) { if (readError.code !== 'ENOENT') throw readError; }
          if (!same(actual, item.after)) { conflicts.push(item.name); continue; }
          if (item.before) atomicWrite(target, item.before); else fs.unlinkSync(target);
        } catch { conflicts.push(item.name); }
      }
      throw new Error(`${error.message} Safety backup: ${safety.backup_id}. ${conflicts.length ? `Rollback needs review for: ${conflicts.join(', ')}` : 'Committed files were rolled back.'}`);
    }
  }
  async function check(signal) {
    const current = sourceSnapshot(signal), failures = [], checked = [];
    try {
      const pkg = JSON.parse(current.files.get('package.json')?.bytes.toString() || 'null');
      const lock = JSON.parse(current.files.get('package-lock.json')?.bytes.toString() || 'null');
      if (!pkg || !semver.test(pkg.version) || lock?.version !== pkg.version || lock?.packages?.['']?.version !== pkg.version) throw new Error('Package and lockfile versions must match.');
      for (const key of ['dependencies', 'devDependencies', 'optionalDependencies']) if (JSON.stringify(pkg[key] || {}) !== JSON.stringify(lock.packages[''][key] || {})) throw new Error(`Package and lockfile ${key} differ.`);
      checked.push('package.json/package-lock.json consistency');
    } catch (error) { failures.push({ path: 'package.json', error: error.message }); }
    const deadline = Date.now() + 30000;
    for (const name of current.files.keys()) {
      abort(signal);
      if (!/\.(?:mjs|cjs|js)$/.test(name)) continue;
      if (Date.now() >= deadline) { failures.push({ path: name, error: '30-second maintenance check budget exhausted; remaining files were not checked.' }); break; }
      try { await exec(process.execPath, ['--check', path.join(root, name)], { cwd: root, signal, timeout: Math.min(3000, Math.max(1, deadline - Date.now())), killSignal: 'SIGKILL', maxBuffer: 8192, windowsHide: true, env: { ...process.env, NODE_OPTIONS: '' } }); checked.push(name); }
      catch (error) { abort(signal); failures.push({ path: name, error: String(error.stderr || error.message).slice(0, 2000) }); }
    }
    const unchanged = sourceSnapshot(signal).revision === current.revision;
    if (!unchanged) failures.push({ path: root, error: 'Source changed during checks; rerun them after editing finishes.' });
    return { passed: failures.length === 0, source_revision: current.revision, checked, failures, scope: 'JavaScript syntax and package/lock consistency only. No tests, install scripts or imported source were executed.' };
  }
  async function download(url, limit, signal) {
    const combined = signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000);
    for (let redirects = 0; redirects <= 4; redirects++) {
      abort(combined);
      const address = new URL(url);
      if (address.protocol !== 'https:' || address.username || address.password || address.port || !['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(address.hostname)) throw new Error('Official release redirect escaped approved HTTPS hosts.');
      const response = await fetchImpl(address.href, { signal: combined, redirect: 'manual', headers: { 'User-Agent': 'Fecimus-local-service-maintenance', Accept: 'application/octet-stream' } });
      if ([301, 302, 303, 307, 308].includes(response.status)) { const location = response.headers.get('location'); await response.body?.cancel(); if (!location || redirects === 4) throw new Error('Official release redirect limit exceeded.'); url = new URL(location, address).href; continue; }
      if (!response.ok) { await response.body?.cancel(); throw new Error(`Official release download returned HTTP ${response.status}.`); }
      if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw new Error('Official release download exceeds its byte limit.'); }
      const chunks = []; let count = 0;
      for await (const chunk of response.body || []) { abort(combined); count += chunk.length; if (count > limit) { await response.body?.cancel().catch(() => {}); throw new Error('Official release download exceeds its byte limit.'); } chunks.push(Buffer.from(chunk)); }
      return Buffer.concat(chunks);
    }
    throw new Error('Official release download failed.');
  }
  async function prepare(version, signal) {
    const current = sourceSnapshot(signal), base = baseline(current.files);
    const verifier = current.files.get('scripts/package-release.py');
    if (!base || !verifier || !same(verifier, base.files.get('scripts/package-release.py'))) throw new Error('Official updates need an unchanged, installed package-release.py and a source/release baseline manifest. Reinstall a trusted release alongside this source if either is missing.');
    if (list('stage').length >= 16) throw new Error('16 prepared releases exist; review and archive old maintenance stages manually.');
    const targetPlatform = base.manifest.platform === 'windows' || (!base.manifest.platform && (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP)) ? 'windows' : 'linux';
    const filename = `Fecimus-${version}-${targetPlatform === 'windows' ? 'Windows-11-Pro-WSL2.zip' : 'Linux-Ubuntu-LTS.tar.gz'}`;
    const releaseURL = `https://github.com/NermalYT/fecimus/releases/download/v${version}/`;
    const checksumBytes = await download(`${releaseURL}SHA256SUMS`, 16384, signal);
    const matches = checksumBytes.toString('utf8').split(/\r?\n/).filter(line => line.endsWith(`  ${filename}`));
    if (matches.length !== 1 || !/^[a-f0-9]{64}  [^\r\n]+$/.test(matches[0])) throw new Error('Exact archive checksum is missing or duplicated in SHA256SUMS.');
    const archive = await download(`${releaseURL}${filename}`, MAX_TOTAL + MAX_FILES * 2048, signal);
    if (hash(archive) !== matches[0].slice(0, 64)) throw new Error('Official release archive SHA-256 mismatch.');
    abort(signal);
    const id = `stage-${crypto.randomUUID()}`, directory = path.join(storage, id); privateDir(directory);
    try {
      const archivePath = path.join(directory, filename); exclusiveWrite(archivePath, archive);
      // Copy verified installed code into private storage, avoiding a later edit
      // of the installation changing which verifier is executed.
      const verifierPath = path.join(directory, 'trusted-verifier.py'); exclusiveWrite(verifierPath, verifier.bytes);
      await exec(pythonCommand, ['-I', '-c', extractScript, verifierPath, archivePath, path.join(directory, 'source'), version, targetPlatform], { signal, timeout: 20000, killSignal: 'SIGKILL', maxBuffer: 8192, windowsHide: true, env: { ...process.env, PYTHONPATH: '', PYTHONSTARTUP: '' } });
      abort(signal);
      const staged = snapshot(path.join(directory, 'source'), signal);
      const releaseManifest = decodeManifest(staged.files.get('RELEASE_MANIFEST.json')?.bytes || Buffer.from('{}'));
      if (releaseManifest.manifest.version !== version) throw new Error('Prepared source version mismatch.');
      for (const [name, file] of releaseManifest.files) if (!same(staged.files.get(name), file)) throw new Error(`Prepared source manifest mismatch: ${name}`);
      savedRecord(directory, { format: 1, kind: 'stage', root, version, created_at: new Date().toISOString(), archive: filename, archive_sha256: hash(archive), source_revision: current.revision, files: [...staged.files].map(([name, file]) => entry(name, file)) });
      return { stage_id: id, version, path: path.join(directory, 'source'), archive_sha256: hash(archive), verified: true, installed: false, next_step: 'Review the staged source. Call status, then apply with stage_id and its fresh source_revision. Dependency changes and conflicts require manual review.' };
    } catch (error) { fs.rmSync(directory, { recursive: true, force: true }); throw error; }
  }
  async function run(input, signal) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || !['status', 'backup', 'check', 'restore', 'prepare', 'apply'].includes(input.action) || Object.keys(input).some(key => !['action', 'version', 'backup_id', 'stage_id', 'expected_revision', 'label'].includes(key))) throw new Error('Invalid service maintenance action or arguments.');
    for (const key of ['backup_id', 'stage_id']) if (input[key] !== undefined && (typeof input[key] !== 'string' || !idPattern.test(input[key]))) throw new Error(`Invalid ${key}.`);
    if (input.label !== undefined && (typeof input.label !== 'string' || input.label.length > 160)) throw new Error('Backup label must be at most 160 characters.');
    abort(signal);
    if (input.action === 'status') return status(signal);
    if (input.action === 'check') return check(signal);
    if (input.action === 'prepare' && (typeof input.version !== 'string' || input.version.length > 80 || !semver.test(input.version))) throw new Error('prepare requires an exact version such as 3.0.1.');
    if (['restore', 'apply'].includes(input.action) && (typeof input.expected_revision !== 'string' || !/^[a-f0-9]{64}$/.test(input.expected_revision))) throw new Error('restore/apply require expected_revision from a fresh status.');
    return locked(async () => {
      if (input.action === 'prepare') return prepare(input.version, signal);
      const current = sourceSnapshot(signal);
      if (input.action === 'backup') return backup(current, input.label);
      if (current.revision !== input.expected_revision) throw new Error('Source revision conflict; obtain a fresh status and review the changes.');
      if (input.action === 'restore') {
        if (!input.backup_id?.startsWith('backup-')) throw new Error('restore requires backup_id.');
        const saved = loadSaved(path.join(storage, input.backup_id), 'backup', root);
        let dependencyReview;
        try { dependencyReview = dependencyShape(current.files) !== dependencyShape(saved.files); } catch { dependencyReview = true; }
        return { restored: input.backup_id, dependency_review_required: dependencyReview, ...(dependencyReview ? { activation: 'Source was restored but installed dependencies may differ. Stop Fecimus, review package/lock changes and run the appropriate dependency installation in a recovery terminal before restarting. No dependency command was run.' } : {}), ...transact(current, saved.files, signal, `Before restoring ${input.backup_id}`) };
      }
      if (!input.stage_id?.startsWith('stage-')) throw new Error('apply requires stage_id.');
      const saved = loadSaved(path.join(storage, input.stage_id), 'stage', root);
      const release = decodeManifest(saved.files.get('RELEASE_MANIFEST.json')?.bytes || Buffer.from('{}'));
      if (release.manifest.version !== saved.record.version || JSON.parse(saved.files.get('package.json')?.bytes.toString() || '{}').version !== saved.record.version) throw new Error('Prepared release metadata version mismatch.');
      for (const [name, file] of release.files) if (!same(saved.files.get(name), file)) throw new Error(`Prepared release metadata checksum mismatch: ${name}`);
      const base = baseline(current.files);
      if (!base) throw new Error('An installed source baseline is required for conflict-preserving updates.');
      if (dependencyShape(current.files) !== dependencyShape(saved.files)) throw new Error(`Prepared release changes dependencies, lockfile resolution or runtime requirements. Automatic apply refused. Review ${path.join(storage, input.stage_id, 'source')} and install separately with Fecimus stopped.`);
      const desired = new Map(current.files), conflicts = [], preserved = [];
      for (const name of new Set([...base.files.keys(), ...saved.files.keys()])) {
        if (manifests.has(name)) continue;
        const before = base.files.get(name), local = current.files.get(name), incoming = saved.files.get(name);
        if (!same(local, before) && !same(local, incoming)) {
          if (same(incoming, before)) { preserved.push(name); continue; }
          conflicts.push(name); continue;
        }
        if (incoming) desired.set(name, incoming); else desired.delete(name);
      }
      if (conflicts.length) return { applied: false, stage_id: input.stage_id, conflicts, preserved_local_changes: preserved, manual_source: path.join(storage, input.stage_id, 'source'), source_revision: current.revision };
      // The next comparison remains against official bytes, including when a
      // local customization was deliberately retained during this update.
      const manifest = { format: 1, project: 'fecimus', version: saved.record.version, platform: release.manifest.platform, files: [...saved.files].filter(([name]) => !manifests.has(name)).map(([name, file]) => entry(name, file)) };
      const bytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
      desired.set('SOURCE_MANIFEST.json', { bytes, sha256: hash(bytes), mode: 0o644 });
      if (saved.files.has('RELEASE_MANIFEST.json')) desired.set('RELEASE_MANIFEST.json', saved.files.get('RELEASE_MANIFEST.json'));
      return { applied: true, stage_id: input.stage_id, version: saved.record.version, preserved_local_changes: preserved, ...transact(current, desired, signal, `Before applying ${saved.record.version}`) };
    }, signal);
  }
  return { run, status };
}

export async function callServiceTool(name, input, manager, signal) {
  if (name !== 'fecimus_service') return undefined;
  const value = await manager.run(input, signal);
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], ...(value.passed === false || value.applied === false ? { isError: true } : {}) };
}
