import test from 'node:test';
import assert from 'node:assert/strict';
import { observeUntil, launchAndObserve, screenshotTransform, movementCommands } from '../src/desktop-workflow.mjs';

test('readiness returns immediately, waits only for changes, and is bounded', async () => {
  let clock = 0;
  const pauses = [];
  const options = { now: () => clock, pause: async ms => { pauses.push(ms); clock += ms; } };
  assert.deepEqual(await observeUntil(() => 'ready', value => value === 'ready', 1800, options), { value: 'ready', ready: true });
  assert.deepEqual(pauses, []);
  assert.equal((await observeUntil(() => clock, value => value >= 80, 1800, options)).value, 80);
  assert.equal((await observeUntil(() => false, Boolean, 65, options)).ready, false);
  assert.equal(clock, 145);
  await assert.rejects(observeUntil(() => { throw new Error('launch failed'); }, Boolean, 1800, options), /launch failed/);
});

test('failed or missing executable never reports a successful launch', async () => {
  const options = { cwd: process.cwd(), env: process.env, windows: () => [], timeoutMs: 1000 };
  await assert.rejects(launchAndObserve('fecimus-does-not-exist-diagnostic', [], options), /ENOENT/);
  await assert.rejects(launchAndObserve(process.execPath, ['-e', 'process.stderr.write("fixture failure");process.exit(7)'], options), /status 7.*fixture failure/);
});

test('GUI launch preserves argument boundaries, project directory, and private HOME', async () => {
  const fs = await import('node:fs/promises');
  const { existsSync } = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fecimus launch '));
  const output = path.join(dir, 'result.json');
  try {
    const command = process.platform === 'linux' ? path.join(dir, 'node with spaces') : process.execPath;
    if (process.platform === 'linux') await fs.symlink(process.execPath, command);
    const code = 'require("fs").writeFileSync(process.argv[1],JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),home:process.env.HOME}))';
    await launchAndObserve(command, ['-e', code, output, 'a project with spaces', 'literal;$(echo untouched)'], {
      cwd: dir, env: { ...process.env, HOME: path.join(dir, 'private') }, windows: () => existsSync(output) ? [{ id: 'fixture' }] : [], timeoutMs: 5000,
    });
    const result = JSON.parse(await fs.readFile(output, 'utf8'));
    assert.deepEqual(result.args, ['a project with spaces', 'literal;$(echo untouched)']);
    assert.equal(await fs.realpath(result.cwd), await fs.realpath(dir));
    assert.equal(result.home, path.join(dir, 'private'));
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('screenshot transformations use crop-local cursor coordinates and retain a 256px region', () => {
  const options = { raw: 'raw.png', output: 'out.jpg', display: { width: 1600, height: 1000 }, cursor: { x: 140, y: 240 }, region: { x: 100, y: 200, width: 512, height: 400 }, maxWidth: 256, quality: 90, showCursor: true };
  const args = screenshotTransform(options);
  assert(args.includes('512x400+100+200'));
  assert(args.includes('circle 40,40 52,40'));
  assert(args.includes('256x>'));
  assert(args.indexOf('-crop') < args.indexOf('-draw'));
  assert(args.indexOf('-draw') < args.indexOf('-resize'));
  assert(!screenshotTransform({ ...options, cursor: { x: 10, y: 10 } }).includes('-draw'));
  assert.throws(() => screenshotTransform({ ...options, region: { x: 1500, y: 0, width: 200, height: 100 } }), /outside/);
});

test('one pointer connection has an exact endpoint and preserves bounded animation', () => {
  const start = { x: 100, y: 200 }, target = { x: 420, y: 80 };
  assert.deepEqual(movementCommands(start, target, 0), ['mousemove', '420', '80']);
  const commands = movementCommands(start, target, 3000);
  assert.equal(commands.filter(value => value === 'mousemove').length, 60);
  assert.deepEqual(commands.slice(-3), ['mousemove', '420', '80']);
  assert(!commands.includes('--sync'));
});
