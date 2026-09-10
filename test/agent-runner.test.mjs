import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import { agentTools, createAgentRunner, callAgentTool } from '../src/agent-runner.mjs';

const tool = (name = 'echo') => ({ name, description: 'Return a text value.', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false } });
const textResult = text => ({ content: [{ type: 'text', text }] });
const call = (name = 'echo', args = { text: 'hello' }, id = 'call_1') => ({ id, type: 'function', function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) } });
const completion = (content = 'Finished.', calls) => ({ choices: [{ finish_reason: calls ? 'tool_calls' : 'stop', message: { role: 'assistant', content, ...(calls ? { tool_calls: calls } : {}) } }] });
const options = extra => ({ model: 'explicit-local-model', objective: 'Use echo once, then report its result.', allowed_tools: ['echo'], ...extra });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, timeout = 4000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const result = check(); if (result) return result; await pause(10); }
  throw new Error('Agent test condition timed out.');
}
const finished = (runner, id) => until(() => {
  const result = runner.status({ agent_id: id });
  return ['succeeded', 'failed', 'cancelled', 'timed_out'].includes(result.state) && result;
});
async function fixture(t, handler, settings = {}) {
  const requests = [], invoked = [];
  const server = http.createServer(async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      requests.push({ body, headers: req.headers, url: req.url });
      const response = await handler(body, requests.length, req, res);
      if (response !== undefined && !res.writableEnded) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(response)); }
    } catch { if (!res.writableEnded) { res.statusCode = 500; res.end('mock failure'); } }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const runner = createAgentRunner({
    baseURL: `http://127.0.0.1:${server.address().port}/v1`,
    env: { OPENAI_API_KEY: 'do-not-forward-openai', LM_STUDIO_API_TOKEN: 'do-not-forward-lmstudio', SECRET: 'do-not-forward-secret' },
    listTools: () => [tool()],
    invoke: async (name, args, signal) => { invoked.push({ name, args, signal }); return textResult(args.text); },
    ...settings
  });
  t.after(async () => { await runner.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return { runner, requests, invoked, server };
}

test('runner is idle by default; explicit start sends only allowed schemas without environment credentials', async t => {
  const { runner, requests, invoked } = await fixture(t, (body, n) => n === 1 ? completion(null, [call()]) : completion('Echo said hello.'), { listTools: () => [tool(), tool('unlisted')] });
  await pause(20); assert.equal(requests.length, 0);
  await assert.rejects(runner.start({ objective: 'x', allowed_tools: ['echo'] }), /Invalid arguments/);
  assert.equal(requests.length, 0);
  const start = await callAgentTool('fecimus_agent_start', options(), runner);
  const id = JSON.parse(start.content[0].text).agent_id;
  const final = await finished(runner, id);
  assert.equal(final.state, 'succeeded'); assert.equal(final.final, 'Echo said hello.');
  assert.equal(final.turns, 2); assert.equal(final.tool_calls, 1);
  assert.deepEqual(invoked.map(x => [x.name, x.args]), [['echo', { text: 'hello' }]]);
  assert.deepEqual(requests[0].body.tools.map(x => x.function.name), ['echo']);
  assert.equal(requests[0].body.model, 'explicit-local-model');
  assert.equal(requests[0].body.max_tokens, 1024);
  assert.equal(requests[0].url, '/v1/chat/completions');
  assert.equal(requests[0].headers.authorization, undefined);
  assert.ok(!JSON.stringify({ requests, final }).includes('do-not-forward'));
  const history = requests[1].body.messages;
  assert.deepEqual(history.map(x => x.role), ['system', 'user', 'assistant', 'tool']);
  assert.equal(history[2].tool_calls[0].id, history[3].tool_call_id);
  assert.deepEqual(JSON.parse(history[3].content), { isError: false, output: ['hello'] });
  const status = await callAgentTool('fecimus_agent_status', { agent_id: id, cursor: 0, max_chars: 12 }, runner);
  assert.equal(JSON.parse(status.content[0].text).output.length, 12);
  assert.throws(() => runner.status({ agent_id: id, cursor: 1000000 }), /beyond/);
  assert.throws(() => runner.status({ cursor: 0 }), /requires/);
  await assert.rejects(callAgentTool('unknown', {}, runner), /Unknown agent tool/);
});

test('nonlocal endpoints and credential-bearing URLs are rejected without requests', () => {
  for (const baseURL of ['https://example.com/v1', 'http://127.0.0.1.evil.test/v1', 'http://user:pass@127.0.0.1/v1', 'http://127.0.0.1/v1?key=secret', 'file:///v1', 'http://127.0.0.1/admin']) {
    assert.throws(() => createAgentRunner({ invoke() {}, listTools() {}, baseURL }), /loopback/);
  }
  assert.throws(() => createAgentRunner({ invoke() {}, listTools() {}, maxConcurrent: 3 }), /concurrency/);
  const local = createAgentRunner({ invoke() {}, listTools() {}, baseURL: 'http://localhost:1234/v1/' });
  return local.close();
});

test('agent/control/discovery wrappers cannot enter an agent whitelist', async t => {
  const names = ['fecimus_agent_start', 'fecimus_agent_status', 'fecimus_agent_cancel', 'fecimus_control_panel', 'fecimus_control_stop', 'fecimus_call', 'fecimus_tools', 'fecimus_schedule_start'];
  const { runner, requests } = await fixture(t, () => completion(), { listTools: () => names.map(name => tool(name)) });
  for (const name of names) await assert.rejects(runner.start(options({ allowed_tools: [name] })), /forbidden/);
  assert.equal(requests.length, 0);
});

test('a whole tool batch is validated before any action; malformed/unknown calls are never replayed', async t => {
  for (const bad of [call('echo', '{broken', 'bad'), call('unlisted', {}, 'bad'), call('echo', { text: 12 }, 'bad'), call('echo', '[]', 'bad')]) {
    await t.test(bad.function.arguments + bad.function.name, async t => {
      const { runner, requests, invoked } = await fixture(t, () => completion(null, [call(), bad]));
      const run = await runner.start(options()); const final = await finished(runner, run.agent_id);
      assert.equal(final.state, 'failed'); assert.equal(requests.length, 1); assert.equal(invoked.length, 0);
    });
  }
});

test('sequential tool batches preserve complete call/result history and validate repeated identifiers', async t => {
  let active = 0, peak = 0;
  const { runner, requests } = await fixture(t, (body, n) => n === 1 ? completion(null, [call('echo', { text: 'one' }, 'a'), call('echo', { text: 'two' }, 'b')]) : completion(null, [call('echo', { text: 'three' }, 'a')]),
    { invoke: async (name, args) => { active++; peak = Math.max(peak, active); await pause(20); active--; return textResult(args.text); } });
  const run = await runner.start(options()); const final = await finished(runner, run.agent_id);
  assert.equal(final.state, 'failed'); assert.match(final.error, /repeated/); assert.equal(final.tool_calls, 2); assert.equal(peak, 1);
  assert.deepEqual(requests[1].body.messages.map(x => x.role), ['system', 'user', 'assistant', 'tool', 'tool']);
  assert.deepEqual(requests[1].body.messages.slice(-2).map(x => x.tool_call_id), ['a', 'b']);
});

test('tool errors halt the loop and are never automatically retried', async t => {
  let calls = 0;
  const { runner, requests } = await fixture(t, () => completion(null, [call()]), { invoke: async () => { calls++; return { ...textResult('Action outcome uncertain.'), isError: true }; } });
  const run = await runner.start(options()); const final = await finished(runner, run.agent_id);
  assert.equal(final.state, 'failed'); assert.equal(calls, 1); assert.equal(requests.length, 1); assert.match(final.error, /inspect/);
});

test('cancellation aborts network work and close prevents new agents', async t => {
  const { runner, requests, invoked } = await fixture(t, () => undefined);
  const run = await runner.start(options()); await until(() => requests.length === 1);
  await callAgentTool('fecimus_agent_cancel', { agent_id: run.agent_id }, runner);
  const final = await finished(runner, run.agent_id);
  assert.equal(final.state, 'cancelled'); assert.equal(invoked.length, 0); assert.equal(requests.length, 1);
  assert.equal(runner.cancel(run.agent_id).state, 'cancelled');
  const next = await runner.start(options()); await runner.close();
  assert.equal((await finished(runner, next.agent_id)).state, 'cancelled');
  await assert.rejects(runner.start(options()), /closed/);
});

test('cancelled in-flight tools retain their concurrency slot until they settle', async t => {
  let release, seenSignal;
  const pending = new Promise(resolve => { release = resolve; });
  const { runner, requests } = await fixture(t, () => completion(null, [call()]), { maxConcurrent: 1,
    invoke: async (name, args, signal) => { seenSignal = signal; await pending; return textResult('Done after cancellation.'); } });
  t.after(() => release());
  const run = await runner.start(options()); await until(() => seenSignal);
  runner.cancel(run.agent_id); const final = await finished(runner, run.agent_id);
  assert.equal(final.state, 'cancelled'); assert.equal(seenSignal.aborted, true); assert.equal(final.in_flight_tool, 'echo');
  await assert.rejects(runner.start(options()), /busy/);
  release(); await until(() => runner.status().active === 0);
  assert.equal(requests.length, 1);
});

test('concurrent starts cannot exceed the configured limit', async t => {
  const { runner, requests } = await fixture(t, () => undefined);
  const started = await Promise.allSettled(Array.from({ length: 3 }, () => runner.start(options())));
  assert.equal(started.filter(x => x.status === 'fulfilled').length, 2);
  assert.match(started.find(x => x.status === 'rejected').reason.message, /busy/);
  await until(() => requests.length === 2); assert.equal(runner.status().active, 2);
});

test('overall timeout and individual request timeout stop without retry', async t => {
  for (const kind of ['overall', 'request']) await t.test(kind, async t => {
    const { runner, requests } = await fixture(t, () => undefined);
    const run = await runner.start(options(kind === 'overall' ? { timeout_ms: 1000 } : { request_timeout_ms: 1000 }));
    const final = await finished(runner, run.agent_id);
    assert.equal(final.state, kind === 'overall' ? 'timed_out' : 'failed');
    assert.match(final.error, kind === 'overall' ? /cancelled/ : /timed out/); assert.equal(requests.length, 1);
  });
});

test('context budgets fail honestly before dispatch or a following inference request', async t => {
  const { runner, requests, invoked } = await fixture(t, () => completion(null, [call()]), { invoke: async () => textResult('x'.repeat(5000)) });
  await assert.rejects(runner.start(options({ objective: 'x'.repeat(6000), context_bytes: 4096 })), /context byte budget/);
  assert.equal(requests.length, 0);
  const run = await runner.start(options({ context_bytes: 4096 })); const final = await finished(runner, run.agent_id);
  assert.equal(final.state, 'failed'); assert.match(final.error, /no history was silently dropped/);
  assert.equal(final.tool_calls, 1); assert.equal(requests.length, 1); assert.equal(invoked.length, 0);
});

test('vision is opt-in and image messages follow all paired tool results', async t => {
  const img = { type: 'image', mimeType: 'image/png', data: 'aGVsbG8=' };
  for (const vision of [false, true]) await t.test(String(vision), async t => {
    const { runner, requests } = await fixture(t, (body, n) => n === 1 ? completion(null, [call()]) : completion(), { invoke: async () => ({ content: [img] }) });
    const run = await runner.start(options({ vision })); assert.equal((await finished(runner, run.agent_id)).state, 'succeeded');
    const history = requests[1].body.messages;
    if (vision) { assert.deepEqual(history.map(x => x.role), ['system', 'user', 'assistant', 'tool', 'user']); assert.equal(history.at(-1).content[1].image_url.url, 'data:image/png;base64,aGVsbG8='); }
    else { assert.match(history.at(-1).content, /vision=false/); assert.ok(!JSON.stringify(history).includes('aGVsbG8=')); }
  });
});

test('oversize or unsupported images and oversize text stop after one action', async t => {
  for (const content of [
    Array(3).fill({ type: 'image', mimeType: 'image/png', data: 'aGVsbG8=' }),
    [{ type: 'image', mimeType: 'image/svg+xml', data: 'aGVsbG8=' }],
    [{ type: 'text', text: 'x'.repeat(131073) }]
  ]) await t.test(content[0].type + content.length, async t => {
    const { runner, requests } = await fixture(t, () => completion(null, [call()]), { invoke: async () => ({ content }) });
    const run = await runner.start(options({ vision: true }));
    assert.equal((await finished(runner, run.agent_id)).state, 'failed'); assert.equal(requests.length, 1);
  });
});

test('HTTP errors, redirects, invalid shapes, token exhaustion and oversized responses never dispatch or retry', async t => {
  const cases = {
    http: (body, n, req, res) => { res.statusCode = 401; res.end('secret server error body'); },
    redirect: (body, n, req, res) => { res.statusCode = 302; res.setHeader('Location', 'http://example.com/private'); res.end(); },
    malformed: (body, n, req, res) => { res.end('{'); },
    shape: () => ({ choices: [] }),
    length: () => ({ choices: [{ finish_reason: 'length', message: { role: 'assistant', content: null, tool_calls: [call()] } }] }),
    oversize: (body, n, req, res) => { res.end('x'.repeat(2097153)); }
  };
  for (const [name, handler] of Object.entries(cases)) await t.test(name, async t => {
    const { runner, requests, invoked } = await fixture(t, handler);
    const run = await runner.start(options()); const final = await finished(runner, run.agent_id);
    assert.equal(final.state, 'failed'); assert.equal(requests.length, 1); assert.equal(invoked.length, 0);
    assert.ok(!JSON.stringify(final).includes('secret server error body'));
  });
});

test('turn limit is explicit and pre-cancelled starts dispatch nothing', async t => {
  const { runner, requests } = await fixture(t, () => completion(null, [call()]));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(runner.start(options(), controller.signal), /cancelled/); assert.equal(requests.length, 0);
  const run = await runner.start(options({ max_turns: 1 })); const final = await finished(runner, run.agent_id);
  assert.equal(final.state, 'failed'); assert.match(final.error, /max_turns/); assert.equal(final.tool_calls, 1); assert.equal(requests.length, 1);
  assert.deepEqual(agentTools.map(x => x.name), ['fecimus_agent_start', 'fecimus_agent_status', 'fecimus_agent_cancel']);
});

test('final reports and completed history are bounded and report truncation explicitly', async t => {
  const { runner } = await fixture(t, () => completion('x'.repeat(40000)));
  let first;
  for (let i = 0; i < 33; i++) {
    const run = await runner.start(options()); first ??= run.agent_id;
    const final = await finished(runner, run.agent_id);
    assert.equal(final.final.length, 32768); assert.equal(final.final_truncated, true);
  }
  assert.equal(runner.status().agents.length, 32);
  assert.throws(() => runner.status({ agent_id: first }), /expired/);
});
