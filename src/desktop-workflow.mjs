import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';

/** Observe a condition immediately, then wait only while it is not satisfied. */
export async function observeUntil(observe, accept, timeoutMs, { now = () => performance.now(), pause = sleep } = {}) {
  const deadline = now() + timeoutMs;
  let value;
  let polls = 0;
  do {
    value = await observe();
    if (accept(value)) return { value, ready: true };
    const remaining = deadline - now();
    if (remaining <= 0) return { value, ready: false };
    await pause(Math.min(remaining, polls++ < 4 ? 40 : 100));
  } while (true);
}

/** A GUI is detached, but launch errors are observed while awaiting readiness. */
export async function launchAndObserve(command, args, { cwd, env, windows, timeoutMs }) {
  const before = new Set(windows().map(window => window.id));
  let failure;
  let stderr = '';
  const child = spawn(command, args, { cwd, env, detached: true, stdio: ['ignore', 'ignore', 'pipe'] });
  const onData = chunk => { stderr = (stderr + chunk.toString()).slice(-8192); };
  const onExit = (code, signal) => {
    if (code !== 0) failure = new Error(`${command} exited ${signal ? `with signal ${signal}` : `with status ${code}`}${stderr.trim() ? `: ${stderr.trim()}` : ''}`);
  };
  child.stderr.on('data', onData);
  child.on('exit', onExit);
  child.on('error', error => { failure = error; });
  try {
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    const observed = await observeUntil(() => {
      if (failure) throw failure;
      return windows();
    }, value => value.some(window => !before.has(window.id)), timeoutMs);
    if (failure) throw failure;
    return {
      pid: child.pid,
      windows: observed.value,
      newWindows: observed.value.filter(window => !before.has(window.id)),
      windowObserved: observed.ready,
    };
  } finally {
    // Continue draining the pipe: closing a live GUI's stderr can cause SIGPIPE.
    child.stderr.removeListener('data', onData);
    child.stderr.resume();
    child.stderr.unref();
    child.unref();
  }
}

/** One ImageMagick transform preserves crop -> cursor -> resize order. */
export function screenshotTransform({ raw, output, display, cursor, region, maxWidth, quality, showCursor }) {
  const crop = region || { x: 0, y: 0, width: display.width, height: display.height };
  const { x, y, width, height } = crop;
  if (![x, y, width, height].every(Number.isInteger) || x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > display.width || y + height > display.height) {
    throw new Error('Requested screenshot region is outside desktop bounds.');
  }
  const args = [raw];
  if (region) args.push('-crop', `${width}x${height}+${x}+${y}`, '+repage');
  const localX = cursor.x - x;
  const localY = cursor.y - y;
  if (showCursor && localX >= 0 && localY >= 0 && localX < width && localY < height) {
    args.push('-fill', 'none', '-stroke', '#ff1744', '-strokewidth', '3',
      '-draw', `circle ${localX},${localY} ${localX + 12},${localY}`,
      '-draw', `line ${localX - 16},${localY} ${localX + 16},${localY}`,
      '-draw', `line ${localX},${localY - 16} ${localX},${localY + 16}`);
  }
  args.push('-resize', `${maxWidth}x>`, '-strip', '-quality', String(quality), output);
  return args;
}

/** Xdotool can execute a whole pointer animation in one X11 connection. */
export function movementCommands(start, target, durationMs) {
  const steps = durationMs === 0 ? 1 : Math.min(60, Math.max(2, Math.round(durationMs / 18)));
  const delaySeconds = durationMs / steps / 1000;
  const args = [];
  for (let step = 1; step <= steps; step++) {
    const progress = step / steps;
    const eased = progress * progress * (3 - 2 * progress);
    const x = Math.round(start.x + (target.x - start.x) * eased);
    const y = Math.round(start.y + (target.y - start.y) * eased);
    args.push('mousemove', String(x), String(y));
    if (step < steps) args.push('sleep', String(delaySeconds));
  }
  return args;
}
