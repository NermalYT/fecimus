import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';

// A cooperative session control, not a security boundary against local code.
export function createControlState({ onStop = async () => {} } = {}) {
  let paused = false, closed = false;
  const active = new Map(), history = [];
  const snapshot = () => ({ paused, active: [...active.values()].map(({ id, tool, start }) => ({ id, tool, elapsed_ms: Math.round(performance.now() - start) })), history: [...history] });
  return {
    snapshot,
    pause() { paused = true; return snapshot(); },
    resume() { if (closed) throw new Error('Fecimus session is closing.'); paused = false; return snapshot(); },
    async stop() {
      paused = true;
      for (const entry of active.values()) entry.controller.abort(new Error('Stopped from Fecimus control panel; inspect state before repeating work.'));
      await onStop();
      return snapshot();
    },
    async close() {
      closed = true; paused = true;
      const entries = [...active.values()];
      for (const entry of entries) entry.controller.abort(new Error('Fecimus session is closing.'));
      // Wait for subprocess cancellation and atomic file operations to settle
      // before the server exits; otherwise their cleanup timers would vanish.
      await Promise.all(entries.map(entry => entry.completion));
    },
    async run(name, fn, signal) {
      if (closed) throw new Error('Fecimus session is closing.');
      if (paused) throw new Error('Fecimus is paused from the user control panel. No new action was sent.');
      if (signal?.aborted) throw new Error('Request cancelled before dispatch.');
      const controller = new AbortController(), id = crypto.randomUUID(), start = performance.now();
      const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
      let finish;
      const completion = new Promise(resolve => { finish = resolve; });
      active.set(id, { id, tool: name, start, controller, completion });
      let ok = false;
      try { const result = await fn(combined); ok = !result?.isError; return result; }
      finally {
        active.delete(id);
        history.unshift({ id, tool: name, ok, ms: Math.round(performance.now() - start), ended_at: new Date().toISOString() });
        history.splice(100);
        finish();
      }
    }
  };
}
