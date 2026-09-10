import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';
import { createPathGuard } from './file-roots.mjs';

const guardScript = fileURLToPath(new URL('./studio-job-guard.py', import.meta.url));
const terminalStates = new Set(['succeeded', 'failed', 'cancelled', 'timed_out']);
const plain = properties => ({ type: 'object', properties, additionalProperties: false });
export const studioTools = [
  {
    name: 'fecimus_job_start',
    description: 'Start a background build, test, render or other command using explicit executable and argv. Returns a job ID immediately; inspect fecimus_job_status later. Private AI display/home; no shell parsing. Commands can modify project files. Never retry a dispatched job without checking its status.',
    inputSchema: { ...plain({
      command: { type: 'string', minLength: 1, maxLength: 4096 },
      args: { type: 'array', items: { type: 'string', maxLength: 8192 }, maxItems: 256, default: [] },
      cwd: { type: 'string', minLength: 1, maxLength: 4096, description: 'Existing project directory inside configured file roots.' },
      timeout_ms: { type: 'integer', minimum: 1000, maximum: 86400000, default: 900000 },
      label: { type: 'string', maxLength: 120 }
    }), required: ['command', 'cwd'] },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
  },
  {
    name: 'fecimus_job_status',
    description: 'List recent background jobs, or read one job and its bounded output without waiting. Pass next_cursor on later reads to continue the log. A completed job reports its exit code; missing older output is explicitly marked.',
    inputSchema: plain({
      job_id: { type: 'string', minLength: 1, maxLength: 64 },
      cursor: { type: 'integer', minimum: 0 },
      max_chars: { type: 'integer', minimum: 1, maximum: 20000, default: 8000 }
    }),
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false }
  },
  {
    name: 'fecimus_job_cancel', description: 'Request cancellation of a background job and its process group. Inspect status to confirm cleanup. Already completed jobs are returned unchanged.',
    inputSchema: { ...plain({ job_id: { type: 'string', minLength: 1, maxLength: 64 } }), required: ['job_id'] },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }
  }
];

export function validateJobInput(input, pathGuard) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Expected job arguments.');
  if (Object.keys(input).some(key => !['command', 'args', 'cwd', 'timeout_ms', 'label'].includes(key))) throw new Error('Unknown job argument; environment overrides are not supported.');
  const { command, args = [], cwd, timeout_ms = 900000, label = '' } = input;
  if (typeof command !== 'string' || !command.trim() || command.length > 4096 || command.includes('\0')) throw new Error('command must be an executable name or path.');
  if (!Array.isArray(args) || args.length > 256 || args.some(arg => typeof arg !== 'string' || arg.length > 8192 || arg.includes('\0'))) throw new Error('args must contain at most 256 valid strings of at most 8192 characters.');
  if (Buffer.byteLength(command) + args.reduce((size, arg) => size + Buffer.byteLength(arg), 0) > 65536) throw new Error('Executable and arguments exceed the 64 KiB limit.');
  if (!Number.isInteger(timeout_ms) || timeout_ms < 1000 || timeout_ms > 86400000) throw new Error('timeout_ms must be between 1000 and 86400000.');
  if (typeof label !== 'string' || label.length > 120 || label.includes('\0')) throw new Error('label must be at most 120 characters.');
  if (typeof cwd !== 'string' || cwd.length > 4096 || cwd.includes('\0')) throw new Error('cwd must be a project directory.');
  const resolvedCwd = pathGuard.resolve(cwd);
  if (!fs.statSync(resolvedCwd).isDirectory()) throw new Error('cwd must be an existing directory.');
  return { command, args: [...args], cwd: resolvedCwd, timeout_ms, label };
}

// Cursors count JavaScript string characters; all cursor arithmetic remains
// internal to these tools. The buffer and each response have independent bounds.
export function readJobLog(job, { cursor, max_chars = 8000 } = {}) {
  if (cursor !== undefined && (!Number.isSafeInteger(cursor) || cursor < 0)) throw new Error('cursor must be a nonnegative safe integer.');
  if (!Number.isInteger(max_chars) || max_chars < 1 || max_chars > 20000) throw new Error('max_chars must be between 1 and 20000.');
  const end = job.logOffset + job.log.length;
  if (cursor !== undefined && cursor > end) throw new Error('cursor is beyond this job log; use the returned next_cursor.');
  const requested = cursor ?? Math.max(0, end - max_chars);
  const start = Math.max(job.logOffset, requested);
  const output = job.log.slice(start - job.logOffset, start - job.logOffset + max_chars);
  return { output, cursor: start, next_cursor: start + output.length, log_start: job.logOffset, log_end: end,
    output_truncated: requested < job.logOffset || (cursor === undefined && start > 0), has_more: start + output.length < end };
}

export function createStudioManager({ env = process.env, home = os.homedir(), roots = env.FECIMUS_FILE_ROOTS,
  runtimeStatus = () => ({ healthy: true }), maxConcurrent = 4, maxHistory = 32, maxLogChars = 131072 } = {}) {
  for (const [name, value, minimum, maximum] of [
    ['maxConcurrent', maxConcurrent, 1, 16], ['maxHistory', maxHistory, maxConcurrent, 128], ['maxLogChars', maxLogChars, 1024, 1048576]
  ]) if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`Invalid ${name}.`);
  const pathGuard = createPathGuard({ home, roots });
  const jobs = new Map();
  const jobEnv = { ...env, ...(env.FECIMUS_APP_HOME ? { HOME: env.FECIMUS_APP_HOME } : {}) };
  let closed = false;
  const active = () => [...jobs.values()].filter(job => !terminalStates.has(job.state));
  const snapshot = job => ({ job_id: job.id, label: job.label, command: job.command, cwd: job.cwd, state: job.state,
    started_at: job.startedAt, finished_at: job.finishedAt, elapsed_ms: (job.finishedMs ?? Date.now()) - job.startedMs,
    timeout_ms: job.timeout_ms, exit_code: job.exitCode, signal: job.signal, cpu_nice: job.cpuNice ?? null,
    ...(job.error ? { error: job.error } : {}), ...(job.reason ? { stop_reason: job.reason } : {}) });
  const get = id => { const job = jobs.get(id); if (!job) throw new Error('Unknown or expired job ID; list jobs with fecimus_job_status.'); return job; };
  const append = (job, text) => {
    if (!text) return;
    job.log += text;
    if (job.log.length > maxLogChars) {
      const excess = job.log.length - maxLogChars;
      job.log = job.log.slice(excess); job.logOffset += excess;
    }
  };
  const finish = (job, code, signal) => {
    if (terminalStates.has(job.state)) return;
    clearTimeout(job.timer); clearTimeout(job.killTimer); clearTimeout(job.drainTimer); clearTimeout(job.startupTimer);
    job.exitCode = Number.isInteger(code) ? code : null; job.signal = signal ?? null;
    job.state = job.reason === 'timeout' ? 'timed_out' : job.reason === 'startup failure' ? 'failed' : job.reason ? 'cancelled' : code === 0 ? 'succeeded' : 'failed';
    job.finishedMs = Date.now(); job.finishedAt = new Date(job.finishedMs).toISOString();
    job.child?.stdout?.destroy(); job.child?.stderr?.destroy(); job.child?.stdio?.[3]?.destroy();
    job.ready(); job.resolveDone();
  };
  const stop = (job, reason) => {
    if (terminalStates.has(job.state) || job.reason) return;
    job.reason = reason; job.state = 'cancelling';
    job.child?.kill('SIGTERM');
    // The supervisor handles normal cleanup. This fallback also covers a hung
    // supervisor, while its child process group remains independently known.
    job.killTimer = setTimeout(() => {
      if (job.workerPid) try { process.kill(-job.workerPid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') job.error = String(error.message).slice(0, 1000); }
      job.child?.kill('SIGKILL');
    }, 1800);
    job.killTimer.unref();
  };
  const healthTimer = setInterval(() => {
    try { if (!runtimeStatus().healthy) for (const job of active()) stop(job, 'private runtime unavailable'); }
    catch { for (const job of active()) stop(job, 'private runtime unavailable'); }
  }, 1000);
  healthTimer.unref();
  return {
    async start(input, signal) {
      if (closed) throw new Error('Job manager is closed.');
      if (process.platform !== 'linux') throw new Error('Studio jobs run on Linux; Windows 11 Pro uses Fecimus inside WSL2.');
      if (signal?.aborted) throw new Error('Request cancelled before job dispatch.');
      if (!runtimeStatus().healthy) throw new Error('Private runtime is unavailable; job was not dispatched.');
      const validated = validateJobInput(input, pathGuard);
      if (active().length >= maxConcurrent) throw new Error(`All ${maxConcurrent} job slots are busy; inspect or cancel an existing job.`);
      while (jobs.size >= maxHistory) {
        const oldest = [...jobs.values()].find(job => terminalStates.has(job.state));
        if (!oldest) throw new Error('Job history capacity reached.');
        jobs.delete(oldest.id);
      }
      const startedMs = Date.now();
      const job = { ...validated, id: crypto.randomUUID(), state: 'starting', startedMs, startedAt: new Date(startedMs).toISOString(),
        finishedAt: null, finishedMs: null, exitCode: null, signal: null, log: '', logOffset: 0, workerPid: null };
      let ready;
      const readyPromise = new Promise(resolve => { ready = resolve; });
      job.ready = ready; job.done = new Promise(resolve => { job.resolveDone = resolve; });
      jobs.set(job.id, job);
      let child;
      try {
        child = spawn('python3', [guardScript, String(process.pid), job.command, ...job.args], {
          cwd: job.cwd, env: jobEnv, stdio: ['ignore', 'pipe', 'pipe', 'pipe'], detached: true, windowsHide: true
        });
      } catch (error) {
        job.error = String(error.message).slice(0, 1000); finish(job, null, null); return snapshot(job);
      }
      job.child = child;
      for (const stream of [child.stdout, child.stderr]) {
        const decoder = new StringDecoder('utf8');
        stream.on('data', buffer => append(job, decoder.write(buffer)));
        stream.on('end', () => append(job, decoder.end()));
      }
      let control = '';
      child.stdio[3].on('data', buffer => {
        control += buffer.toString('utf8');
        if (control.length > 2048) { job.error = 'Invalid supervisor startup response.'; stop(job, 'startup failure'); return; }
        if (!control.includes('\n')) return;
        try {
          const message = JSON.parse(control.split('\n')[0]);
          if (Number.isInteger(message.pid) && message.pid > 1) {
            job.workerPid = message.pid;
            if (Number.isInteger(message.cpu_nice)) job.cpuNice = message.cpu_nice;
            if (!job.reason) job.state = 'running';
            clearTimeout(job.startupTimer); job.ready();
          } else if (message.error) job.error = String(message.error).slice(0, 1000);
        } catch { job.error = 'Invalid supervisor startup response.'; stop(job, 'startup failure'); }
      });
      child.on('error', error => { job.error = String(error.message).slice(0, 1000); finish(job, null, null); });
      child.once('exit', (code, exitSignal) => {
        // Also clean the group if the supervisor itself is killed unexpectedly.
        if (job.workerPid) try { process.kill(-job.workerPid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') job.error = String(error.message).slice(0, 1000); }
        // Detached descendants can retain inherited pipes. A finite drain keeps
        // status and shutdown responsive even for deliberately escaped children.
        job.drainTimer = setTimeout(() => finish(job, code, exitSignal), 100);
      });
      child.once('close', (code, exitSignal) => finish(job, code, exitSignal));
      job.timer = setTimeout(() => stop(job, 'timeout'), job.timeout_ms); job.timer.unref();
      job.startupTimer = setTimeout(() => { job.error = 'Supervisor startup exceeded 5 seconds.'; stop(job, 'startup failure'); }, 5000);
      job.startupTimer.unref();
      // Once dispatched, the job has its own lifetime. Cancelling the short MCP
      // start request does not silently cancel/replay a possibly running build.
      await readyPromise;
      return { ...snapshot(job), private_home: Boolean(env.FECIMUS_APP_HOME), next_cursor: 0 };
    },
    status(input = {}) {
      if (input.job_id === undefined) {
        if (input.cursor !== undefined) throw new Error('cursor requires job_id.');
        return { jobs: [...jobs.values()].toReversed().map(snapshot), active: active().length,
          limits: { concurrent: maxConcurrent, history: maxHistory, log_chars_per_job: maxLogChars } };
      }
      const job = get(input.job_id);
      return { ...snapshot(job), ...readJobLog(job, input) };
    },
    cancel(id) { const job = get(id); stop(job, 'cancelled by request'); return snapshot(job); },
    async close() {
      if (closed) return;
      closed = true; clearInterval(healthTimer);
      const pending = active(); for (const job of pending) stop(job, 'server shutdown');
      await Promise.all(pending.map(job => job.done));
    }
  };
}

export async function callStudioTool(name, input, manager, signal) {
  let result;
  if (name === 'fecimus_job_start') result = await manager.start(input, signal);
  else if (name === 'fecimus_job_status') result = manager.status(input);
  else if (name === 'fecimus_job_cancel') result = manager.cancel(input.job_id);
  else throw new Error(`Unknown studio tool: ${name}`);
  return { content: [{ type: 'text', text: JSON.stringify(result) }], ...(['failed', 'timed_out'].includes(result.state) ? { isError: true } : {}) };
}
