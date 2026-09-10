import assert from 'node:assert/strict';
import test from 'node:test';
import { endpointURL, parseArgs, judgeToolCall, judgeContinuation, runCheck } from '../scripts/check-model.mjs';

const nonce = 'synthetic-nonce';
const response = (args = JSON.stringify({ nonce })) => ({ choices: [{ finish_reason: 'tool_calls', message: {
  role: 'assistant', content: null,
  tool_calls: [{ id: 'synthetic-call', type: 'function', function: { name: 'fecimus_echo', arguments: args } }]
} }] });

test('accepts a real parsed echo tool call with exact JSON arguments', () => {
  assert.equal(judgeToolCall(response(), nonce).pass, true);
  assert.equal(judgeToolCall(response('{"extra":1}'), undefined).pass, false);
});

test('rejects malformed JSON, wrong nonce, and extra schema fields', () => {
  for (const args of ['{"nonce":', JSON.stringify({ nonce: 'wrong' }), JSON.stringify({ nonce, extra: true }), 'null', '[]', { nonce }]) {
    assert.equal(judgeToolCall(response(args), nonce).pass, false);
  }
});

test('rejects wrong tools, missing IDs, text-only imitations, refusal, and token exhaustion', () => {
  const wrongTool = response(); wrongTool.choices[0].message.tool_calls[0].function.name = 'shell_run';
  const missingId = response(); delete missingId.choices[0].message.tool_calls[0].id;
  const duplicate = response(); duplicate.choices[0].message.tool_calls.push(duplicate.choices[0].message.tool_calls[0]);
  const refusal = response(); refusal.choices[0].message.refusal = 'Cannot comply';
  const length = response(); length.choices[0].finish_reason = 'length';
  const textOnly = { choices: [{ message: { role: 'assistant', content: '<tool_call>{"name":"fecimus_echo"}</tool_call>' } }] };
  for (const fixture of [wrongTool, missingId, duplicate, refusal, length, textOnly, {}, null]) {
    assert.equal(judgeToolCall(fixture, nonce).pass, false);
  }
});

test('continuation requires the actual receipt, without further tool calls', () => {
  const fixture = { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'receipt' } }] };
  assert.equal(judgeContinuation(fixture, 'receipt').pass, true);
  assert.equal(judgeContinuation(fixture, 'wrong').pass, false);
  fixture.choices[0].message.tool_calls = [{}];
  assert.equal(judgeContinuation(fixture, 'receipt').pass, false);
});

test('rejects remote or credential-bearing endpoints unless remote access is explicit', () => {
  assert.equal(endpointURL('http://localhost:1234').href, 'http://localhost:1234/v1/chat/completions');
  assert.equal(endpointURL('http://[::1]:1234/v1/').hostname, '[::1]');
  assert.equal(endpointURL('http://127.0.0.2:1234/v1/chat/completions').hostname, '127.0.0.2');
  assert.throws(() => endpointURL('https://example.com/v1'), /Non-loopback/);
  assert.throws(() => endpointURL('http://localhost.example.com/v1'), /Non-loopback/);
  assert.equal(endpointURL('https://example.com/v1', true).hostname, 'example.com');
  for (const url of ['file:///v1', 'http://name:password@localhost/v1', 'http://localhost/v1?token=private', 'http://localhost/v1#fragment', 'http://localhost/unrelated']) {
    assert.throws(() => endpointURL(url));
  }
});

test('CLI requires a chosen model and bounded numeric flags', () => {
  assert.throws(() => parseArgs([]), /--model is required/);
  assert.deepEqual(parseArgs(['--help']), { help: true });
  const options = parseArgs(['--model', 'synthetic-model', '--continue']);
  assert.equal(options.maxTokens, 1024);
  assert.equal(options.timeoutSeconds, 120);
  assert.equal(options.continuation, true);
  for (const args of [['--model'], ['--model', 'x', '--max-tokens', '0'], ['--model', 'x', '--timeout-seconds', '601'], ['--model', 'x', '--unknown']]) assert.throws(() => parseArgs(args));
});

test('default makes one synthetic request and never executes a tool', async () => {
  let calls = 0;
  const options = parseArgs(['--model', 'fixture-model']);
  const report = await runCheck(options, { token: 'synthetic-token', fetchImpl: async (url, init) => {
    calls++;
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers.Authorization, 'Bearer synthetic-token');
    const body = JSON.parse(init.body);
    assert.equal(body.model, 'fixture-model');
    assert.equal(body.tools.length, 1);
    assert.equal(body.tools[0].function.name, 'fecimus_echo');
    assert.equal(body.tools[0].function.parameters.additionalProperties, false);
    const requested = body.messages[1].content.match(/nonce ([\w-]+)\./)[1];
    return new Response(JSON.stringify(response(JSON.stringify({ nonce: requested }))));
  } });
  assert.equal(calls, 1);
  assert.equal(report.result, 'PASS');
  assert(!JSON.stringify(report).includes('synthetic-token'));
  assert.match(report.scope, /vision.*not tested/);
});

test('optional continuation uses a new receipt from synthetic tool output', async () => {
  let calls = 0;
  const report = await runCheck(parseArgs(['--model', 'fixture-model', '--continue']), { token: '', fetchImpl: async (_url, init) => {
    const body = JSON.parse(init.body);
    calls++;
    if (calls === 1) {
      const requested = body.messages[1].content.match(/nonce ([\w-]+)\./)[1];
      return new Response(JSON.stringify(response(JSON.stringify({ nonce: requested }))));
    }
    assert.equal(body.tools, undefined);
    assert.equal(body.messages.at(-1).role, 'tool');
    const { receipt, nonce: requested } = JSON.parse(body.messages.at(-1).content);
    assert.notEqual(receipt, requested);
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: receipt }, finish_reason: 'stop' }] }));
  } });
  assert.equal(calls, 2);
  assert.equal(report.result, 'PASS');
  assert.equal(report.continuation.pass, true);
});

test('HTTP failures suppress response bodies and do not retry', async () => {
  let calls = 0;
  await assert.rejects(runCheck(parseArgs(['--model', 'fixture-model']), { token: '', fetchImpl: async () => {
    calls++;
    return new Response('private-value-must-not-be-printed', { status: 401 });
  } }), error => error.message.includes('HTTP 401') && !error.message.includes('private-value'));
  assert.equal(calls, 1);
});

test('timeout and redirect/network failures do not expose provider details or retry', async () => {
  for (const cause of [new DOMException('private-value', 'TimeoutError'), new Error('private-value')]) {
    let calls = 0;
    await assert.rejects(runCheck(parseArgs(['--model', 'fixture-model']), { token: '', fetchImpl: async () => {
      calls++;
      throw cause;
    } }), error => !error.message.includes('private-value') && /retry/.test(error.message));
    assert.equal(calls, 1);
  }
});
